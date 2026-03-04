import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export const nh3dSoundEffectDefinitions = [
  { key: "player-footstep", label: "Player footstep" },
  { key: "monster-footstep", label: "Monster footstep" },
  { key: "hit", label: "Hit" },
  { key: "monster-killed", label: "Monster killed" },
  { key: "player-hurt", label: "Player hurt" },
  { key: "missed-attack", label: "Missed attack" },
  { key: "explosion", label: "Explosion" },
  { key: "wand-casting", label: "Wand casting" },
  { key: "wand-fizzle", label: "Wand fizzle" },
  { key: "thrown-weapons", label: "Thrown weapons" },
  { key: "arrow-impact", label: "Arrow impact" },
  { key: "eating", label: "Eating" },
  { key: "quaff-potion", label: "Quaff a potion" },
  { key: "potion-shattering", label: "Potion shattering" },
  { key: "scroll-reading-good", label: "Scroll reading (good)" },
  { key: "scroll-reading-bad", label: "Scroll reading (bad)" },
  { key: "scroll-reading-neutral", label: "Scroll reading (neutral)" },
  { key: "searching", label: "Searching" },
  { key: "magic-cast", label: "Magic cast" },
  { key: "magic-heal", label: "Magic heal" },
  { key: "magic-buff", label: "Magic buff" },
] as const;

export type Nh3dSoundEffectDefinition =
  (typeof nh3dSoundEffectDefinitions)[number];
export type Nh3dSoundEffectKey = Nh3dSoundEffectDefinition["key"];
export type Nh3dSoundEntrySource = "builtin" | "user";

export type Nh3dSoundEffectAssignment = {
  key: Nh3dSoundEffectKey;
  enabled: boolean;
  volume: number;
  fileName: string;
  mimeType: string;
  path: string;
  source: Nh3dSoundEntrySource;
};

export type Nh3dSoundPackSoundMap = Record<
  Nh3dSoundEffectKey,
  Nh3dSoundEffectAssignment
>;

export type Nh3dSoundPackRecord = {
  id: string;
  name: string;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
  sounds: Nh3dSoundPackSoundMap;
};

export type Nh3dLoadedSoundPackState = {
  packs: Nh3dSoundPackRecord[];
  activePackId: string;
};

export type Nh3dSoundFileUploadOverrides = Partial<
  Record<Nh3dSoundEffectKey, Blob | null>
>;

type Nh3dStoredSoundFileRecord = {
  path: string;
  packId: string;
  soundKey: Nh3dSoundEffectKey;
  fileName: string;
  mimeType: string;
  blob: Blob;
  byteLength: number;
  createdAt: number;
  updatedAt: number;
};

type Nh3dMetaRecord = {
  key: string;
  value: unknown;
  updatedAt: number;
};

type Nh3dSoundPackExportManifest = {
  schema: "nh3d-soundpack";
  version: 1;
  exportedAt: string;
  pack: {
    name: string;
    isDefault: boolean;
    sounds: Array<{
      key: Nh3dSoundEffectKey;
      label: string;
      enabled: boolean;
      volume: number;
      fileName: string;
      mimeType: string;
      path: string;
      source: Nh3dSoundEntrySource;
      archivePath: string | null;
    }>;
  };
};

type ParsedImportSoundEntry = {
  key: Nh3dSoundEffectKey;
  enabled: boolean;
  volume: number;
  fileName: string;
  mimeType: string;
  path: string;
  source: Nh3dSoundEntrySource;
  archivePath: string | null;
};

type RecordLike = Record<string, unknown>;

const dbName = "nh3d-soundpacks";
const dbVersion = 1;
const packStoreName = "sound-packs";
const fileStoreName = "sound-files";
const metaStoreName = "meta";
const activePackMetaKey = "active-sound-pack-id";
const soundPackManifestPath = "manifest.json";

export const nh3dDefaultSoundPackId = "default-sound-pack";
export const nh3dDefaultSoundPackName = "Default";

function isRecordLike(value: unknown): value is RecordLike {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function ensureIndexedDbAvailable(): void {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB is not available in this browser context.");
  }
}

function idbRequestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IDB request failed."));
  });
}

function idbTransactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IDB transaction failed."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IDB transaction aborted."));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  ensureIndexedDbAvailable();
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(packStoreName)) {
        db.createObjectStore(packStoreName, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(fileStoreName)) {
        db.createObjectStore(fileStoreName, { keyPath: "path" });
      }
      if (!db.objectStoreNames.contains(metaStoreName)) {
        db.createObjectStore(metaStoreName, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to open IndexedDB."));
  });
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeNh3dSoundPackName(value: string): string {
  return normalizeWhitespace(String(value || ""));
}

function sanitizePathSegment(value: string, fallback: string): string {
  const normalized = String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function sanitizeFileName(value: string, fallback: string): string {
  const rawValue = String(value || "").trim();
  const candidate = rawValue || fallback;
  const normalized = candidate
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || fallback;
}

function resolveDefaultFileName(key: Nh3dSoundEffectKey): string {
  return `${key}.ogg`;
}

export function resolveNh3dDefaultSoundPath(
  key: Nh3dSoundEffectKey,
): string {
  return `soundpacks/default/${resolveDefaultFileName(key)}`;
}

export function resolveNh3dUserSoundPath(
  packName: string,
  soundKey: Nh3dSoundEffectKey,
  fileName: string,
): string {
  const packSegment = sanitizePathSegment(packName, "sound-pack");
  const fileSegment = sanitizeFileName(fileName, `${soundKey}.bin`);
  return `soundpacks/${packSegment}/${soundKey}/${fileSegment}`;
}

function clampUnit(value: unknown, fallback = 1): number {
  const parsed =
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(1, Number(parsed.toFixed(4))));
}

function resolveSoundDefinitionLabel(key: Nh3dSoundEffectKey): string {
  const definition = nh3dSoundEffectDefinitions.find((entry) => entry.key === key);
  return definition?.label ?? key;
}

function createDefaultSoundAssignment(
  key: Nh3dSoundEffectKey,
): Nh3dSoundEffectAssignment {
  const defaultFileName = resolveDefaultFileName(key);
  return {
    key,
    enabled: true,
    volume: 1,
    fileName: defaultFileName,
    mimeType: "audio/ogg",
    path: resolveNh3dDefaultSoundPath(key),
    source: "builtin",
  };
}

function createDefaultSoundMap(): Nh3dSoundPackSoundMap {
  const sounds = {} as Nh3dSoundPackSoundMap;
  for (const definition of nh3dSoundEffectDefinitions) {
    sounds[definition.key] = createDefaultSoundAssignment(definition.key);
  }
  return sounds;
}

function cloneSoundAssignment(
  assignment: Nh3dSoundEffectAssignment,
): Nh3dSoundEffectAssignment {
  return {
    ...assignment,
  };
}

function cloneSoundMap(sounds: Nh3dSoundPackSoundMap): Nh3dSoundPackSoundMap {
  const next = {} as Nh3dSoundPackSoundMap;
  for (const definition of nh3dSoundEffectDefinitions) {
    next[definition.key] = cloneSoundAssignment(sounds[definition.key]);
  }
  return next;
}

export function cloneNh3dSoundPack(pack: Nh3dSoundPackRecord): Nh3dSoundPackRecord {
  return {
    ...pack,
    sounds: cloneSoundMap(pack.sounds),
  };
}

function createDefaultSoundPackRecord(now = Date.now()): Nh3dSoundPackRecord {
  return {
    id: nh3dDefaultSoundPackId,
    name: nh3dDefaultSoundPackName,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
    sounds: createDefaultSoundMap(),
  };
}

function normalizeSoundAssignment(
  rawValue: unknown,
  soundKey: Nh3dSoundEffectKey,
  fallback: Nh3dSoundEffectAssignment,
  packName: string,
): Nh3dSoundEffectAssignment {
  if (!isRecordLike(rawValue)) {
    return cloneSoundAssignment(fallback);
  }
  const source: Nh3dSoundEntrySource = rawValue.source === "user" ? "user" : "builtin";
  const enabled = Boolean(rawValue.enabled);
  const volume = clampUnit(rawValue.volume, fallback.volume);
  const fallbackFileName =
    source === "user"
      ? sanitizeFileName(fallback.fileName, `${soundKey}.bin`)
      : resolveDefaultFileName(soundKey);
  const fileName = sanitizeFileName(
    String(rawValue.fileName || ""),
    fallbackFileName,
  );
  const mimeTypeCandidate = normalizeWhitespace(String(rawValue.mimeType || ""));
  const mimeType =
    mimeTypeCandidate ||
    (source === "user" ? fallback.mimeType || "application/octet-stream" : "audio/ogg");

  if (source === "user") {
    const rawPath = normalizeWhitespace(String(rawValue.path || ""));
    const path = rawPath || resolveNh3dUserSoundPath(packName, soundKey, fileName);
    return {
      key: soundKey,
      enabled,
      volume,
      fileName,
      mimeType,
      path,
      source: "user",
    };
  }

  return {
    key: soundKey,
    enabled,
    volume,
    fileName: resolveDefaultFileName(soundKey),
    mimeType: "audio/ogg",
    path: resolveNh3dDefaultSoundPath(soundKey),
    source: "builtin",
  };
}

function normalizeSoundPackRecord(rawValue: unknown): Nh3dSoundPackRecord | null {
  if (!isRecordLike(rawValue)) {
    return null;
  }
  const rawId = normalizeWhitespace(String(rawValue.id || ""));
  if (!rawId) {
    return null;
  }
  const isDefault = rawId === nh3dDefaultSoundPackId || rawValue.isDefault === true;
  const id = isDefault ? nh3dDefaultSoundPackId : rawId;
  const name = isDefault
    ? nh3dDefaultSoundPackName
    : normalizeNh3dSoundPackName(String(rawValue.name || "")) || "Sound Pack";
  const createdAt =
    typeof rawValue.createdAt === "number" && Number.isFinite(rawValue.createdAt)
      ? rawValue.createdAt
      : Date.now();
  const updatedAt =
    typeof rawValue.updatedAt === "number" && Number.isFinite(rawValue.updatedAt)
      ? rawValue.updatedAt
      : createdAt;
  const rawSounds = isRecordLike(rawValue.sounds) ? rawValue.sounds : null;
  const sounds = {} as Nh3dSoundPackSoundMap;

  for (const definition of nh3dSoundEffectDefinitions) {
    const soundKey = definition.key;
    const fallback = createDefaultSoundAssignment(soundKey);
    const rawSound = rawSounds ? rawSounds[soundKey] : undefined;
    const normalized = normalizeSoundAssignment(rawSound, soundKey, fallback, name);
    sounds[soundKey] =
      isDefault
        ? {
            ...fallback,
            enabled: normalized.enabled,
            volume: normalized.volume,
          }
        : normalized;
  }

  return {
    id,
    name,
    isDefault,
    createdAt,
    updatedAt,
    sounds,
  };
}

function sortSoundPacks(packs: Nh3dSoundPackRecord[]): Nh3dSoundPackRecord[] {
  return [...packs].sort((a, b) => {
    if (a.isDefault && !b.isDefault) {
      return -1;
    }
    if (!a.isDefault && b.isDefault) {
      return 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

function parseActivePackId(rawValue: unknown): string | null {
  if (!isRecordLike(rawValue)) {
    return null;
  }
  const key = normalizeWhitespace(String(rawValue.key || ""));
  if (key !== activePackMetaKey) {
    return null;
  }
  const value = normalizeWhitespace(String(rawValue.value || ""));
  return value || null;
}

function generateSoundPackId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `sound-pack-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function readNormalizedSoundPacks(rawValues: unknown[]): Nh3dSoundPackRecord[] {
  const packsById = new Map<string, Nh3dSoundPackRecord>();
  for (const rawValue of rawValues) {
    const normalized = normalizeSoundPackRecord(rawValue);
    if (!normalized) {
      continue;
    }
    packsById.set(normalized.id, normalized);
  }
  if (!packsById.has(nh3dDefaultSoundPackId)) {
    packsById.set(nh3dDefaultSoundPackId, createDefaultSoundPackRecord());
  }
  return sortSoundPacks(Array.from(packsById.values()));
}

function throwIfPackNameTaken(
  packs: ReadonlyArray<Nh3dSoundPackRecord>,
  nextName: string,
  excludedPackId: string,
): void {
  const normalizedNextName = normalizeNh3dSoundPackName(nextName).toLowerCase();
  if (!normalizedNextName) {
    throw new Error("Sound pack name is required.");
  }
  const nameInUse = packs.some((pack) => {
    if (pack.id === excludedPackId) {
      return false;
    }
    return normalizeNh3dSoundPackName(pack.name).toLowerCase() === normalizedNextName;
  });
  if (nameInUse) {
    throw new Error(`A sound pack named '${nextName}' already exists.`);
  }
}

function resolveUniqueSoundPackName(
  requestedName: string,
  packs: ReadonlyArray<Nh3dSoundPackRecord>,
): string {
  const trimmedRequestedName =
    normalizeNh3dSoundPackName(requestedName) || "Imported Sound Pack";
  const usedNames = new Set(
    packs.map((pack) => normalizeNh3dSoundPackName(pack.name).toLowerCase()),
  );
  if (!usedNames.has(trimmedRequestedName.toLowerCase())) {
    return trimmedRequestedName;
  }
  let suffix = 2;
  while (suffix < 1000) {
    const candidate = `${trimmedRequestedName} (${suffix})`;
    if (!usedNames.has(candidate.toLowerCase())) {
      return candidate;
    }
    suffix += 1;
  }
  return `${trimmedRequestedName} (${Date.now()})`;
}

function normalizeSoundFileRecord(rawValue: unknown): Nh3dStoredSoundFileRecord | null {
  if (!isRecordLike(rawValue)) {
    return null;
  }
  const path = normalizeWhitespace(String(rawValue.path || ""));
  if (!path) {
    return null;
  }
  const blob = rawValue.blob instanceof Blob ? rawValue.blob : null;
  if (!blob) {
    return null;
  }
  const soundKey = String(rawValue.soundKey || "") as Nh3dSoundEffectKey;
  if (!nh3dSoundEffectDefinitions.some((definition) => definition.key === soundKey)) {
    return null;
  }
  const fileName = sanitizeFileName(
    String(rawValue.fileName || ""),
    `${soundKey}.bin`,
  );
  const mimeType =
    normalizeWhitespace(String(rawValue.mimeType || "")) ||
    blob.type ||
    "application/octet-stream";
  const packId = normalizeWhitespace(String(rawValue.packId || ""));
  return {
    path,
    packId,
    soundKey,
    fileName,
    mimeType,
    blob,
    byteLength:
      typeof rawValue.byteLength === "number" && Number.isFinite(rawValue.byteLength)
        ? rawValue.byteLength
        : blob.size,
    createdAt:
      typeof rawValue.createdAt === "number" && Number.isFinite(rawValue.createdAt)
        ? rawValue.createdAt
        : Date.now(),
    updatedAt:
      typeof rawValue.updatedAt === "number" && Number.isFinite(rawValue.updatedAt)
        ? rawValue.updatedAt
        : Date.now(),
  };
}

async function readSoundFileRecord(
  fileStore: IDBObjectStore,
  path: string,
): Promise<Nh3dStoredSoundFileRecord | null> {
  const rawValue = await idbRequestToPromise(fileStore.get(path));
  return normalizeSoundFileRecord(rawValue);
}

async function writeSoundFileRecord(
  fileStore: IDBObjectStore,
  options: {
    path: string;
    packId: string;
    soundKey: Nh3dSoundEffectKey;
    fileName: string;
    mimeType: string;
    blob: Blob;
    now: number;
  },
): Promise<void> {
  const existing = await readSoundFileRecord(fileStore, options.path);
  const record: Nh3dStoredSoundFileRecord = {
    path: options.path,
    packId: options.packId,
    soundKey: options.soundKey,
    fileName: sanitizeFileName(options.fileName, `${options.soundKey}.bin`),
    mimeType:
      normalizeWhitespace(options.mimeType) ||
      options.blob.type ||
      "application/octet-stream",
    blob: options.blob,
    byteLength: options.blob.size,
    createdAt: existing?.createdAt ?? options.now,
    updatedAt: options.now,
  };
  await idbRequestToPromise(fileStore.put(record));
}

async function moveSoundFileRecord(
  fileStore: IDBObjectStore,
  fromPath: string,
  toPath: string,
  now: number,
  forcedPackId: string,
  forcedKey: Nh3dSoundEffectKey,
): Promise<void> {
  if (!fromPath || !toPath || fromPath === toPath) {
    return;
  }
  const existing = await readSoundFileRecord(fileStore, fromPath);
  if (!existing) {
    return;
  }
  await writeSoundFileRecord(fileStore, {
    path: toPath,
    packId: forcedPackId || existing.packId,
    soundKey: forcedKey || existing.soundKey,
    fileName: existing.fileName,
    mimeType: existing.mimeType,
    blob: existing.blob,
    now,
  });
  await idbRequestToPromise(fileStore.delete(fromPath));
}

async function getNormalizedPacksForTransaction(
  packStore: IDBObjectStore,
): Promise<Nh3dSoundPackRecord[]> {
  const rawValues = await idbRequestToPromise(packStore.getAll());
  return readNormalizedSoundPacks(rawValues as unknown[]);
}

export async function loadNh3dSoundPackStateFromIndexedDb(): Promise<
  Nh3dLoadedSoundPackState
> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(
      [packStoreName, metaStoreName],
      "readwrite",
    );
    const packStore = transaction.objectStore(packStoreName);
    const metaStore = transaction.objectStore(metaStoreName);
    const packs = await getNormalizedPacksForTransaction(packStore);

    for (const pack of packs) {
      await idbRequestToPromise(packStore.put(pack));
    }

    const rawActiveRecord = await idbRequestToPromise(metaStore.get(activePackMetaKey));
    const rawActivePackId = parseActivePackId(rawActiveRecord);
    const activePackId =
      rawActivePackId && packs.some((pack) => pack.id === rawActivePackId)
        ? rawActivePackId
        : nh3dDefaultSoundPackId;

    const nextMeta: Nh3dMetaRecord = {
      key: activePackMetaKey,
      value: activePackId,
      updatedAt: Date.now(),
    };
    await idbRequestToPromise(metaStore.put(nextMeta));
    await idbTransactionDone(transaction);

    return {
      packs: packs.map((pack) => cloneNh3dSoundPack(pack)),
      activePackId,
    };
  } finally {
    db.close();
  }
}

export async function setActiveNh3dSoundPackId(packId: string): Promise<void> {
  const normalizedPackId = normalizeWhitespace(String(packId || ""));
  if (!normalizedPackId) {
    throw new Error("Sound pack id is required.");
  }
  const db = await openDatabase();
  try {
    const transaction = db.transaction(
      [packStoreName, metaStoreName],
      "readwrite",
    );
    const packStore = transaction.objectStore(packStoreName);
    const metaStore = transaction.objectStore(metaStoreName);
    const packRecord = await idbRequestToPromise(packStore.get(normalizedPackId));
    const normalizedPack = normalizeSoundPackRecord(packRecord);
    if (!normalizedPack) {
      throw new Error("Selected sound pack no longer exists.");
    }

    const nextMeta: Nh3dMetaRecord = {
      key: activePackMetaKey,
      value: normalizedPackId,
      updatedAt: Date.now(),
    };
    await idbRequestToPromise(metaStore.put(nextMeta));
    await idbTransactionDone(transaction);
  } finally {
    db.close();
  }
}

function cloneDefaultSoundMapForNewPack(
  defaultPack: Nh3dSoundPackRecord,
): Nh3dSoundPackSoundMap {
  const sounds = {} as Nh3dSoundPackSoundMap;
  for (const definition of nh3dSoundEffectDefinitions) {
    const key = definition.key;
    const defaultSound = defaultPack.sounds[key] ?? createDefaultSoundAssignment(key);
    sounds[key] = {
      ...defaultSound,
      key,
      source: "builtin",
      fileName: resolveDefaultFileName(key),
      mimeType: "audio/ogg",
      path: resolveNh3dDefaultSoundPath(key),
    };
  }
  return sounds;
}

export async function createNh3dSoundPack(name: string): Promise<
  Nh3dSoundPackRecord
> {
  const normalizedName = normalizeNh3dSoundPackName(name);
  if (!normalizedName) {
    throw new Error("Sound pack name is required.");
  }

  const db = await openDatabase();
  try {
    const transaction = db.transaction(
      [packStoreName, metaStoreName],
      "readwrite",
    );
    const packStore = transaction.objectStore(packStoreName);
    const metaStore = transaction.objectStore(metaStoreName);
    const packs = await getNormalizedPacksForTransaction(packStore);
    for (const pack of packs) {
      await idbRequestToPromise(packStore.put(pack));
    }
    throwIfPackNameTaken(packs, normalizedName, "");

    const defaultPack =
      packs.find((pack) => pack.id === nh3dDefaultSoundPackId) ??
      createDefaultSoundPackRecord();
    const now = Date.now();
    const nextPack: Nh3dSoundPackRecord = {
      id: generateSoundPackId(),
      name: normalizedName,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
      sounds: cloneDefaultSoundMapForNewPack(defaultPack),
    };

    await idbRequestToPromise(packStore.put(nextPack));
    const nextMeta: Nh3dMetaRecord = {
      key: activePackMetaKey,
      value: nextPack.id,
      updatedAt: now,
    };
    await idbRequestToPromise(metaStore.put(nextMeta));
    await idbTransactionDone(transaction);

    return cloneNh3dSoundPack(nextPack);
  } finally {
    db.close();
  }
}

export async function saveNh3dSoundPackToIndexedDb(
  pack: Nh3dSoundPackRecord,
  uploadedSoundFiles: Nh3dSoundFileUploadOverrides = {},
): Promise<Nh3dSoundPackRecord> {
  const normalizedPackId = normalizeWhitespace(String(pack.id || ""));
  if (!normalizedPackId) {
    throw new Error("Sound pack id is required.");
  }

  const db = await openDatabase();
  try {
    const transaction = db.transaction(
      [packStoreName, fileStoreName],
      "readwrite",
    );
    const packStore = transaction.objectStore(packStoreName);
    const fileStore = transaction.objectStore(fileStoreName);

    const packs = await getNormalizedPacksForTransaction(packStore);
    const existingPack = packs.find((entry) => entry.id === normalizedPackId);
    if (!existingPack) {
      throw new Error("Sound pack no longer exists.");
    }

    const nextName = existingPack.isDefault
      ? nh3dDefaultSoundPackName
      : normalizeNh3dSoundPackName(pack.name);
    if (!nextName) {
      throw new Error("Sound pack name is required.");
    }

    throwIfPackNameTaken(packs, nextName, existingPack.id);
    const now = Date.now();
    const nextSounds = {} as Nh3dSoundPackSoundMap;

    for (const definition of nh3dSoundEffectDefinitions) {
      const soundKey = definition.key;
      const fallbackDefault = createDefaultSoundAssignment(soundKey);
      const existingSound = existingPack.sounds[soundKey] ?? fallbackDefault;
      const incomingSound = pack.sounds[soundKey] ?? existingSound;
      const enabled = Boolean(incomingSound.enabled);
      const volume = clampUnit(incomingSound.volume, existingSound.volume);
      const uploaded = uploadedSoundFiles[soundKey];

      if (existingPack.isDefault) {
        if (existingSound.source === "user" && existingSound.path) {
          await idbRequestToPromise(fileStore.delete(existingSound.path));
        }
        nextSounds[soundKey] = {
          ...fallbackDefault,
          enabled,
          volume,
        };
        continue;
      }

      if (uploaded === null) {
        if (existingSound.source === "user" && existingSound.path) {
          await idbRequestToPromise(fileStore.delete(existingSound.path));
        }
        nextSounds[soundKey] = {
          ...fallbackDefault,
          enabled,
          volume,
        };
        continue;
      }

      if (uploaded instanceof Blob) {
        const uploadedFileName =
          uploaded instanceof File && uploaded.name
            ? uploaded.name
            : incomingSound.fileName || `${soundKey}.bin`;
        const fileName = sanitizeFileName(uploadedFileName, `${soundKey}.bin`);
        const path = resolveNh3dUserSoundPath(nextName, soundKey, fileName);
        const mimeType =
          normalizeWhitespace(uploaded.type) ||
          normalizeWhitespace(incomingSound.mimeType) ||
          "application/octet-stream";

        await writeSoundFileRecord(fileStore, {
          path,
          packId: existingPack.id,
          soundKey,
          fileName,
          mimeType,
          blob: uploaded,
          now,
        });

        if (
          existingSound.source === "user" &&
          existingSound.path &&
          existingSound.path !== path
        ) {
          await idbRequestToPromise(fileStore.delete(existingSound.path));
        }

        nextSounds[soundKey] = {
          key: soundKey,
          enabled,
          volume,
          fileName,
          mimeType,
          path,
          source: "user",
        };
        continue;
      }

      const incomingSource: Nh3dSoundEntrySource =
        incomingSound.source === "user" ? "user" : "builtin";

      if (incomingSource === "user") {
        const fileName = sanitizeFileName(incomingSound.fileName, `${soundKey}.bin`);
        const canonicalPath = resolveNh3dUserSoundPath(nextName, soundKey, fileName);
        const sourcePath = normalizeWhitespace(incomingSound.path || existingSound.path);

        if (sourcePath && sourcePath !== canonicalPath) {
          await moveSoundFileRecord(
            fileStore,
            sourcePath,
            canonicalPath,
            now,
            existingPack.id,
            soundKey,
          );
        }

        if (
          existingSound.source === "user" &&
          existingSound.path &&
          existingSound.path !== canonicalPath &&
          existingSound.path !== sourcePath
        ) {
          await idbRequestToPromise(fileStore.delete(existingSound.path));
        }

        const storedRecord = await readSoundFileRecord(fileStore, canonicalPath);
        if (!storedRecord && sourcePath && sourcePath !== canonicalPath) {
          await moveSoundFileRecord(
            fileStore,
            sourcePath,
            canonicalPath,
            now,
            existingPack.id,
            soundKey,
          );
        }

        nextSounds[soundKey] = {
          key: soundKey,
          enabled,
          volume,
          fileName,
          mimeType:
            normalizeWhitespace(incomingSound.mimeType) ||
            normalizeWhitespace(existingSound.mimeType) ||
            "application/octet-stream",
          path: canonicalPath,
          source: "user",
        };
        continue;
      }

      if (existingSound.source === "user" && existingSound.path) {
        await idbRequestToPromise(fileStore.delete(existingSound.path));
      }
      nextSounds[soundKey] = {
        ...fallbackDefault,
        enabled,
        volume,
      };
    }

    const nextPack: Nh3dSoundPackRecord = {
      id: existingPack.id,
      name: nextName,
      isDefault: existingPack.isDefault,
      createdAt: existingPack.createdAt,
      updatedAt: now,
      sounds: nextSounds,
    };

    await idbRequestToPromise(packStore.put(nextPack));
    await idbTransactionDone(transaction);

    return cloneNh3dSoundPack(nextPack);
  } finally {
    db.close();
  }
}

export async function loadStoredNh3dSoundBlob(path: string): Promise<Blob | null> {
  const normalizedPath = normalizeWhitespace(String(path || ""));
  if (!normalizedPath) {
    return null;
  }
  const db = await openDatabase();
  try {
    const transaction = db.transaction(fileStoreName, "readonly");
    const fileStore = transaction.objectStore(fileStoreName);
    const rawValue = await idbRequestToPromise(fileStore.get(normalizedPath));
    await idbTransactionDone(transaction);
    const normalized = normalizeSoundFileRecord(rawValue);
    return normalized?.blob ?? null;
  } finally {
    db.close();
  }
}

async function readStoredSoundBlobs(paths: string[]): Promise<Map<string, Blob>> {
  const filteredPaths = paths
    .map((path) => normalizeWhitespace(path))
    .filter((path) => path.length > 0);
  const blobByPath = new Map<string, Blob>();
  if (filteredPaths.length === 0) {
    return blobByPath;
  }

  const db = await openDatabase();
  try {
    const transaction = db.transaction(fileStoreName, "readonly");
    const fileStore = transaction.objectStore(fileStoreName);
    for (const path of filteredPaths) {
      const rawValue = await idbRequestToPromise(fileStore.get(path));
      const normalized = normalizeSoundFileRecord(rawValue);
      if (!normalized) {
        continue;
      }
      blobByPath.set(path, normalized.blob);
    }
    await idbTransactionDone(transaction);
    return blobByPath;
  } finally {
    db.close();
  }
}

export async function exportNh3dSoundPackToZip(
  pack: Nh3dSoundPackRecord,
  pendingUploads: Nh3dSoundFileUploadOverrides = {},
): Promise<Blob> {
  const normalizedPack = normalizeSoundPackRecord(pack);
  if (!normalizedPack) {
    throw new Error("Sound pack data is invalid.");
  }

  const storedPaths = nh3dSoundEffectDefinitions
    .map((definition) => {
      const uploaded = pendingUploads[definition.key];
      if (uploaded instanceof Blob || uploaded === null) {
        return "";
      }
      const sound = normalizedPack.sounds[definition.key];
      return sound.source === "user" ? sound.path : "";
    })
    .filter((path) => path.length > 0);

  const storedBlobsByPath = await readStoredSoundBlobs(storedPaths);
  const archiveEntries: Record<string, Uint8Array> = {};
  const manifest: Nh3dSoundPackExportManifest = {
    schema: "nh3d-soundpack",
    version: 1,
    exportedAt: new Date().toISOString(),
    pack: {
      name: normalizedPack.name,
      isDefault: normalizedPack.isDefault,
      sounds: [],
    },
  };

  for (const definition of nh3dSoundEffectDefinitions) {
    const soundKey = definition.key;
    const sound = normalizedPack.sounds[soundKey];
    const pendingUpload = pendingUploads[soundKey];
    const archiveFileName = sanitizeFileName(sound.fileName, `${soundKey}.bin`);
    let archivePath: string | null = null;
    let blobForArchive: Blob | null = null;

    if (pendingUpload instanceof Blob) {
      blobForArchive = pendingUpload;
      archivePath = `sounds/${soundKey}/${archiveFileName}`;
    } else if (pendingUpload === null) {
      blobForArchive = null;
      archivePath = null;
    } else if (sound.source === "user") {
      const storedBlob = storedBlobsByPath.get(sound.path) ?? null;
      if (storedBlob) {
        blobForArchive = storedBlob;
        archivePath = `sounds/${soundKey}/${archiveFileName}`;
      }
    }

    if (archivePath && blobForArchive) {
      archiveEntries[archivePath] = new Uint8Array(await blobForArchive.arrayBuffer());
    }

    manifest.pack.sounds.push({
      key: soundKey,
      label: resolveSoundDefinitionLabel(soundKey),
      enabled: Boolean(sound.enabled),
      volume: clampUnit(sound.volume, 1),
      fileName: archiveFileName,
      mimeType:
        normalizeWhitespace(sound.mimeType) ||
        blobForArchive?.type ||
        "application/octet-stream",
      path: sound.path,
      source: sound.source,
      archivePath,
    });
  }

  archiveEntries[soundPackManifestPath] = strToU8(
    JSON.stringify(manifest, null, 2),
  );
  const zipBytes = zipSync(archiveEntries, { level: 6 });
  return new Blob([zipBytes], { type: "application/zip" });
}

function parseImportManifest(rawManifest: unknown): {
  packName: string;
  soundsByKey: Map<Nh3dSoundEffectKey, ParsedImportSoundEntry>;
} {
  if (!isRecordLike(rawManifest)) {
    throw new Error("Invalid sound pack archive manifest.");
  }
  if (rawManifest.schema !== "nh3d-soundpack" || rawManifest.version !== 1) {
    throw new Error("Unsupported sound pack archive format.");
  }
  if (!isRecordLike(rawManifest.pack)) {
    throw new Error("Sound pack archive is missing pack metadata.");
  }
  const packName =
    normalizeNh3dSoundPackName(String(rawManifest.pack.name || "")) ||
    "Imported Sound Pack";

  const rawSounds = Array.isArray(rawManifest.pack.sounds)
    ? rawManifest.pack.sounds
    : [];
  const soundsByKey = new Map<Nh3dSoundEffectKey, ParsedImportSoundEntry>();

  for (const rawEntry of rawSounds) {
    if (!isRecordLike(rawEntry)) {
      continue;
    }
    const key = String(rawEntry.key || "") as Nh3dSoundEffectKey;
    if (!nh3dSoundEffectDefinitions.some((definition) => definition.key === key)) {
      continue;
    }
    const source: Nh3dSoundEntrySource = rawEntry.source === "user" ? "user" : "builtin";
    const parsedEntry: ParsedImportSoundEntry = {
      key,
      enabled: Boolean(rawEntry.enabled),
      volume: clampUnit(rawEntry.volume, 1),
      fileName: sanitizeFileName(String(rawEntry.fileName || ""), `${key}.bin`),
      mimeType:
        normalizeWhitespace(String(rawEntry.mimeType || "")) ||
        (source === "user" ? "application/octet-stream" : "audio/ogg"),
      path:
        normalizeWhitespace(String(rawEntry.path || "")) ||
        (source === "user"
          ? resolveNh3dUserSoundPath(packName, key, `${key}.bin`)
          : resolveNh3dDefaultSoundPath(key)),
      source,
      archivePath: normalizeWhitespace(String(rawEntry.archivePath || "")) || null,
    };
    soundsByKey.set(key, parsedEntry);
  }

  return {
    packName,
    soundsByKey,
  };
}

async function unzipArchiveEntries(
  zipBlob: Blob,
): Promise<Record<string, Uint8Array>> {
  const bytes = new Uint8Array(await zipBlob.arrayBuffer());
  try {
    return unzipSync(bytes);
  } catch {
    throw new Error("Failed to read sound pack ZIP archive.");
  }
}

export async function importNh3dSoundPackFromZip(
  zipBlob: Blob,
): Promise<Nh3dSoundPackRecord> {
  const archiveEntries = await unzipArchiveEntries(zipBlob);
  const manifestBytes = archiveEntries[soundPackManifestPath];
  if (!manifestBytes) {
    throw new Error("Sound pack ZIP is missing manifest.json.");
  }

  let parsedManifest: unknown;
  try {
    parsedManifest = JSON.parse(strFromU8(manifestBytes));
  } catch {
    throw new Error("Sound pack manifest.json is not valid JSON.");
  }

  const manifest = parseImportManifest(parsedManifest);
  const db = await openDatabase();

  try {
    const transaction = db.transaction(
      [packStoreName, fileStoreName, metaStoreName],
      "readwrite",
    );
    const packStore = transaction.objectStore(packStoreName);
    const fileStore = transaction.objectStore(fileStoreName);
    const metaStore = transaction.objectStore(metaStoreName);

    const existingPacks = await getNormalizedPacksForTransaction(packStore);
    for (const pack of existingPacks) {
      await idbRequestToPromise(packStore.put(pack));
    }

    const uniqueName = resolveUniqueSoundPackName(
      manifest.packName,
      existingPacks,
    );
    const now = Date.now();
    const nextPackId = generateSoundPackId();
    const defaultPack =
      existingPacks.find((pack) => pack.id === nh3dDefaultSoundPackId) ??
      createDefaultSoundPackRecord(now);

    const nextSounds = {} as Nh3dSoundPackSoundMap;

    for (const definition of nh3dSoundEffectDefinitions) {
      const soundKey = definition.key;
      const defaultSound =
        defaultPack.sounds[soundKey] ?? createDefaultSoundAssignment(soundKey);
      const imported = manifest.soundsByKey.get(soundKey);
      const enabled = imported ? imported.enabled : defaultSound.enabled;
      const volume = imported ? imported.volume : defaultSound.volume;
      const archivePath = imported?.archivePath;
      const archiveBytes = archivePath ? archiveEntries[archivePath] : undefined;

      if (archiveBytes instanceof Uint8Array) {
        const fileName = sanitizeFileName(
          imported?.fileName || `${soundKey}.bin`,
          `${soundKey}.bin`,
        );
        const mimeType =
          normalizeWhitespace(imported?.mimeType || "") ||
          "application/octet-stream";
        const path = resolveNh3dUserSoundPath(uniqueName, soundKey, fileName);
        const fileBlob = new Blob([archiveBytes], { type: mimeType });

        await writeSoundFileRecord(fileStore, {
          path,
          packId: nextPackId,
          soundKey,
          fileName,
          mimeType,
          blob: fileBlob,
          now,
        });

        nextSounds[soundKey] = {
          key: soundKey,
          enabled,
          volume,
          fileName,
          mimeType,
          path,
          source: "user",
        };
        continue;
      }

      nextSounds[soundKey] = {
        ...defaultSound,
        enabled,
        volume,
      };
    }

    const importedPack: Nh3dSoundPackRecord = {
      id: nextPackId,
      name: uniqueName,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
      sounds: nextSounds,
    };

    await idbRequestToPromise(packStore.put(importedPack));
    const metaRecord: Nh3dMetaRecord = {
      key: activePackMetaKey,
      value: importedPack.id,
      updatedAt: now,
    };
    await idbRequestToPromise(metaStore.put(metaRecord));
    await idbTransactionDone(transaction);

    return cloneNh3dSoundPack(importedPack);
  } finally {
    db.close();
  }
}
