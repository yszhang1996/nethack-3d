import type { NethackRuntimeVersion } from "../runtime/types";
import {
  defaultNh3dTilesetPath,
  isNh3dTilesetPathAvailable,
  resolveDefaultNh3dTilesetBackgroundTileId,
} from "./tilesets";

export type NethackConnectionState =
  | "disconnected"
  | "starting"
  | "running"
  | "error";

export type NethackMenuItem = {
  text?: string;
  accelerator?: string;
  isCategory?: boolean;
  glyph?: number;
  glyphChar?: string;
  [key: string]: unknown;
};

export type PlayerStatsSnapshot = {
  name: string;
  hp: number;
  maxHp: number;
  power: number;
  maxPower: number;
  level: number;
  experience: number;
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
  armor: number;
  dungeon: string;
  dlevel: number;
  gold: number;
  alignment: string;
  hunger: string;
  encumbrance: string;
  time: number;
  score: number;
};

export type QuestionDialogState = {
  text: string;
  choices: string;
  defaultChoice: string;
  menuItems: NethackMenuItem[];
  isPickupDialog: boolean;
  selectedAccelerators: string[];
  activePickupSelectionInput?: string | null;
  activeMenuSelectionInput?: string | null;
  activeActionButton?: "confirm" | "cancel" | null;
  menuPageIndex?: number;
  menuPageCount?: number;
};

export type InfoMenuState = {
  title: string;
  lines: string[];
};

export type InventoryDialogState = {
  visible: boolean;
  items: NethackMenuItem[];
};

export type TextInputRequestState = {
  text: string;
  maxLength?: number;
  placeholder?: string;
};

export type NewGamePromptState = {
  visible: boolean;
  reason: string | null;
};

export type FpsContextAction = {
  id: string;
  label: string;
  kind: "quick" | "extended";
  value: string;
};

export type FpsCrosshairContextState = {
  title: string;
  tileX: number;
  tileY: number;
  actions: FpsContextAction[];
};

export type PlayMode = "normal" | "fps";
export type Nh3dAntialiasingMode = "taa" | "fxaa";
export type DarkCorridorWallTileOverrideByTileset = Record<string, number>;
export type TilesetBackgroundTileByTileset = Record<string, number>;

export type Nh3dClientOptions = {
  fpsMode: boolean;
  fpsFov: number;
  fpsLookSensitivityX: number;
  fpsLookSensitivityY: number;
  invertLookYAxis: boolean;
  invertTouchPanningDirection: boolean;
  minimap: boolean;
  damageNumbers: boolean;
  tileShakeOnHit: boolean;
  blood: boolean;
  liveMessageLog: boolean;
  darkCorridorWalls367: boolean;
  darkCorridorWallTileOverrideEnabled: boolean;
  darkCorridorWallTileOverrideTileId: number;
  darkCorridorWallTileOverrideTileIdByTileset: DarkCorridorWallTileOverrideByTileset;
  tilesetBackgroundTileId: number;
  tilesetBackgroundTileIdByTileset: TilesetBackgroundTileByTileset;
  tilesetMode: "ascii" | "tiles";
  tilesetPath: string;
  antialiasing: Nh3dAntialiasingMode;
  brightness: number;
  contrast: number;
  gamma: number;
};

export const nh3dFpsLookSensitivityMin = 0.4;
export const nh3dFpsLookSensitivityMax = 2.6;

const isMobilePortrait = window.matchMedia(
  "(orientation: portrait) and (pointer: coarse)",
);
const isMobile = window.matchMedia("(pointer: coarse)");

export const defaultNh3dClientOptions: Nh3dClientOptions = {
  fpsMode: false,
  fpsFov: isMobilePortrait ? 95 : 62,
  fpsLookSensitivityX: isMobile ? 1.5 : 1,
  fpsLookSensitivityY: isMobile ? 1.5 : 1,
  invertLookYAxis: false,
  invertTouchPanningDirection: true,
  minimap: true,
  damageNumbers: true,
  tileShakeOnHit: true,
  blood: true,
  liveMessageLog: true,
  darkCorridorWalls367: true,
  darkCorridorWallTileOverrideEnabled: false,
  darkCorridorWallTileOverrideTileId: 850,
  darkCorridorWallTileOverrideTileIdByTileset: {},
  tilesetBackgroundTileId: resolveDefaultNh3dTilesetBackgroundTileId(
    defaultNh3dTilesetPath,
  ),
  tilesetBackgroundTileIdByTileset: {},
  tilesetMode: "tiles",
  tilesetPath: defaultNh3dTilesetPath,
  antialiasing: "taa",
  brightness: 0,
  contrast: 0,
  gamma: 1.5,
};

function normalizeDarkCorridorWallTileOverrideByTileset(
  rawValue: unknown,
): DarkCorridorWallTileOverrideByTileset {
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
    return {};
  }
  const normalized: DarkCorridorWallTileOverrideByTileset = {};
  for (const [rawPath, rawTileId] of Object.entries(rawValue)) {
    const tilesetPath = String(rawPath || "").trim();
    if (!tilesetPath || !isNh3dTilesetPathAvailable(tilesetPath)) {
      continue;
    }
    if (typeof rawTileId !== "number" || !Number.isFinite(rawTileId)) {
      continue;
    }
    normalized[tilesetPath] = Math.max(0, Math.trunc(rawTileId));
  }
  return normalized;
}

function normalizeTilesetBackgroundTileIdByTileset(
  rawValue: unknown,
): TilesetBackgroundTileByTileset {
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
    return {};
  }
  const normalized: TilesetBackgroundTileByTileset = {};
  for (const [rawPath, rawTileId] of Object.entries(rawValue)) {
    const tilesetPath = String(rawPath || "").trim();
    if (!tilesetPath || !isNh3dTilesetPathAvailable(tilesetPath)) {
      continue;
    }
    if (typeof rawTileId !== "number" || !Number.isFinite(rawTileId)) {
      continue;
    }
    normalized[tilesetPath] = Math.max(0, Math.trunc(rawTileId));
  }
  return normalized;
}

export function normalizeNh3dClientOptions(
  overrides?: Partial<Nh3dClientOptions> | null,
): Nh3dClientOptions {
  const rawFpsFov =
    typeof overrides?.fpsFov === "number" && Number.isFinite(overrides.fpsFov)
      ? overrides.fpsFov
      : defaultNh3dClientOptions.fpsFov;
  const fpsFov = Math.round(Math.max(45, Math.min(110, rawFpsFov)));
  const rawFpsLookSensitivityX =
    typeof overrides?.fpsLookSensitivityX === "number" &&
    Number.isFinite(overrides.fpsLookSensitivityX)
      ? overrides.fpsLookSensitivityX
      : defaultNh3dClientOptions.fpsLookSensitivityX;
  const rawFpsLookSensitivityY =
    typeof overrides?.fpsLookSensitivityY === "number" &&
    Number.isFinite(overrides.fpsLookSensitivityY)
      ? overrides.fpsLookSensitivityY
      : defaultNh3dClientOptions.fpsLookSensitivityY;
  const fpsLookSensitivityX = Number(
    Math.max(
      nh3dFpsLookSensitivityMin,
      Math.min(nh3dFpsLookSensitivityMax, rawFpsLookSensitivityX),
    ).toFixed(2),
  );
  const fpsLookSensitivityY = Number(
    Math.max(
      nh3dFpsLookSensitivityMin,
      Math.min(nh3dFpsLookSensitivityMax, rawFpsLookSensitivityY),
    ).toFixed(2),
  );
  const antialiasing =
    overrides?.antialiasing === "taa" || overrides?.antialiasing === "fxaa"
      ? overrides.antialiasing
      : defaultNh3dClientOptions.antialiasing;
  const rawBrightness =
    typeof overrides?.brightness === "number" &&
    Number.isFinite(overrides.brightness)
      ? overrides.brightness
      : defaultNh3dClientOptions.brightness;
  const brightness = Number(
    Math.max(-0.25, Math.min(0.25, rawBrightness)).toFixed(2),
  );
  const rawContrast =
    typeof overrides?.contrast === "number" &&
    Number.isFinite(overrides.contrast)
      ? overrides.contrast
      : defaultNh3dClientOptions.contrast;
  const contrast = Number(
    Math.max(-0.25, Math.min(0.25, rawContrast)).toFixed(2),
  );
  const rawGamma =
    typeof overrides?.gamma === "number" && Number.isFinite(overrides.gamma)
      ? overrides.gamma
      : defaultNh3dClientOptions.gamma;
  const gamma = Number(Math.max(0.5, Math.min(2.5, rawGamma)).toFixed(2));
  const requestedTilesetPath =
    typeof overrides?.tilesetPath === "string"
      ? overrides.tilesetPath.trim()
      : defaultNh3dClientOptions.tilesetPath;
  const tilesetPathExists = isNh3dTilesetPathAvailable(requestedTilesetPath);
  const tilesetPath = tilesetPathExists
    ? requestedTilesetPath
    : defaultNh3dClientOptions.tilesetPath;
  const requestedTilesetMode =
    overrides?.tilesetMode === "tiles"
      ? "tiles"
      : overrides?.tilesetMode === "ascii"
        ? "ascii"
        : defaultNh3dClientOptions.tilesetMode;
  const resolvedTilesetPathExists = isNh3dTilesetPathAvailable(tilesetPath);
  const tilesetMode =
    requestedTilesetMode === "tiles" && resolvedTilesetPathExists
      ? "tiles"
      : "ascii";
  const darkCorridorWallTileOverrideTileIdByTileset =
    normalizeDarkCorridorWallTileOverrideByTileset(
      overrides?.darkCorridorWallTileOverrideTileIdByTileset,
    );
  const tilesetBackgroundTileIdByTileset =
    normalizeTilesetBackgroundTileIdByTileset(
      overrides?.tilesetBackgroundTileIdByTileset,
    );
  const selectedTilesetDarkWallOverrideTileId = tilesetPath
    ? darkCorridorWallTileOverrideTileIdByTileset[tilesetPath]
    : undefined;
  const selectedTilesetBackgroundTileId = tilesetPath
    ? tilesetBackgroundTileIdByTileset[tilesetPath]
    : undefined;
  const darkCorridorWallTileOverrideTileId =
    typeof selectedTilesetDarkWallOverrideTileId === "number" &&
    Number.isFinite(selectedTilesetDarkWallOverrideTileId)
      ? Math.max(0, Math.trunc(selectedTilesetDarkWallOverrideTileId))
      : defaultNh3dClientOptions.darkCorridorWallTileOverrideTileId;
  const tilesetBackgroundTileId =
    typeof selectedTilesetBackgroundTileId === "number" &&
    Number.isFinite(selectedTilesetBackgroundTileId)
      ? Math.max(0, Math.trunc(selectedTilesetBackgroundTileId))
      : resolveDefaultNh3dTilesetBackgroundTileId(tilesetPath);
  return {
    fpsMode:
      typeof overrides?.fpsMode === "boolean"
        ? overrides.fpsMode
        : defaultNh3dClientOptions.fpsMode,
    fpsFov,
    fpsLookSensitivityX,
    fpsLookSensitivityY,
    invertLookYAxis:
      typeof overrides?.invertLookYAxis === "boolean"
        ? overrides.invertLookYAxis
        : defaultNh3dClientOptions.invertLookYAxis,
    invertTouchPanningDirection:
      typeof overrides?.invertTouchPanningDirection === "boolean"
        ? overrides.invertTouchPanningDirection
        : defaultNh3dClientOptions.invertTouchPanningDirection,
    minimap:
      typeof overrides?.minimap === "boolean"
        ? overrides.minimap
        : defaultNh3dClientOptions.minimap,
    damageNumbers:
      typeof overrides?.damageNumbers === "boolean"
        ? overrides.damageNumbers
        : defaultNh3dClientOptions.damageNumbers,
    tileShakeOnHit:
      typeof overrides?.tileShakeOnHit === "boolean"
        ? overrides.tileShakeOnHit
        : defaultNh3dClientOptions.tileShakeOnHit,
    blood:
      typeof overrides?.blood === "boolean"
        ? overrides.blood
        : defaultNh3dClientOptions.blood,
    liveMessageLog:
      typeof overrides?.liveMessageLog === "boolean"
        ? overrides.liveMessageLog
        : defaultNh3dClientOptions.liveMessageLog,
    darkCorridorWalls367:
      typeof overrides?.darkCorridorWalls367 === "boolean"
        ? overrides.darkCorridorWalls367
        : defaultNh3dClientOptions.darkCorridorWalls367,
    darkCorridorWallTileOverrideEnabled:
      typeof overrides?.darkCorridorWallTileOverrideEnabled === "boolean"
        ? overrides.darkCorridorWallTileOverrideEnabled
        : defaultNh3dClientOptions.darkCorridorWallTileOverrideEnabled,
    darkCorridorWallTileOverrideTileId,
    darkCorridorWallTileOverrideTileIdByTileset,
    tilesetBackgroundTileId,
    tilesetBackgroundTileIdByTileset,
    tilesetMode,
    tilesetPath,
    antialiasing,
    brightness,
    contrast,
    gamma,
  };
}

export type CharacterCreationConfig = {
  mode: "random" | "create";
  playMode?: PlayMode;
  runtimeVersion?: NethackRuntimeVersion;
  name?: string;
  role?: string;
  race?: string;
  gender?: string;
  align?: string;
};

export interface Nethack3DEngineUIAdapter {
  setStatus(status: string): void;
  setConnectionStatus(status: string, state: NethackConnectionState): void;
  setLoadingVisible(visible: boolean): void;
  setGameMessages(messages: string[]): void;
  pushFloatingMessage(message: string): void;
  setPlayerStats(stats: PlayerStatsSnapshot): void;
  setQuestion(state: QuestionDialogState | null): void;
  setDirectionQuestion(question: string | null): void;
  setNumberPadModeEnabled(enabled: boolean): void;
  setInfoMenu(state: InfoMenuState | null): void;
  setInventory(state: InventoryDialogState): void;
  setTextInput(state: TextInputRequestState | null): void;
  setExtendedCommands(commands: string[]): void;
  setPositionRequest(text: string | null): void;
  setFpsCrosshairContext(state: FpsCrosshairContextState | null): void;
  setRepeatActionVisible(visible: boolean): void;
  setNewGamePrompt(state: NewGamePromptState): void;
}

export interface Nethack3DEngineController {
  chooseDirection(directionKey: string): void;
  chooseQuestionChoice(choice: string): void;
  confirmQuestionMenuChoice(): void;
  togglePickupChoice(accelerator: string): void;
  goToPreviousQuestionMenuPage(): void;
  goToNextQuestionMenuPage(): void;
  confirmPickupChoices(): void;
  submitTextInput(text: string): void;
  cancelActivePrompt(): void;
  toggleInventoryDialog(): void;
  runInventoryItemAction(actionId: string, itemAccelerator: string): void;
  dismissFpsCrosshairContextMenu(): void;
  runQuickAction(
    actionId: string,
    options?: { autoDirectionFromFpsAim?: boolean },
  ): void;
  runExtendedCommand(
    commandText: string,
    options?: { autoDirectionFromFpsAim?: boolean },
  ): void;
  repeatLastAction(): void;
  setClientOptions(options: Nh3dClientOptions): void;
  closeInventoryDialog(): void;
  closeInfoMenuDialog(): void;
}

export interface Nethack3DEngineOptions {
  mountElement?: HTMLElement | null;
  uiAdapter?: Nethack3DEngineUIAdapter | null;
  characterCreationConfig?: CharacterCreationConfig;
  clientOptions?: Partial<Nh3dClientOptions>;
  loggingEnabled?: boolean;
}
