import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  cloneNh3dSoundPack,
  createNh3dSoundPack,
  exportNh3dSoundPackToZip,
  importNh3dSoundPackFromZip,
  loadNh3dSoundPackStateFromIndexedDb,
  loadStoredNh3dSoundBlob,
  nh3dDefaultSoundPackId,
  nh3dSoundEffectDefinitions,
  normalizeNh3dSoundPackName,
  resolveNh3dDefaultSoundPath,
  resolveNh3dUserSoundPath,
  saveNh3dSoundPackToIndexedDb,
  setActiveNh3dSoundPackId,
  type Nh3dSoundEffectKey,
  type Nh3dSoundPackRecord,
  type Nh3dSoundFileUploadOverrides,
} from "../audio/sound-pack-storage";

type SoundPackSettingsProps = {
  visible: boolean;
};

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function sanitizeArchiveFileName(value: string): string {
  const normalized = String(value || "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return "sound-pack";
  }
  return normalized;
}

export default function SoundPackSettings({
  visible,
}: SoundPackSettingsProps): JSX.Element | null {
  const [packs, setPacks] = useState<Nh3dSoundPackRecord[]>([]);
  const [activePackId, setActivePackId] = useState("");
  const [draftPack, setDraftPack] = useState<Nh3dSoundPackRecord | null>(null);
  const [pendingUploads, setPendingUploads] =
    useState<Nh3dSoundFileUploadOverrides>({});
  const [isDraftDirty, setIsDraftDirty] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [statusText, setStatusText] = useState("");
  const [isCreateMode, setIsCreateMode] = useState(false);
  const [newPackName, setNewPackName] = useState("");
  const [playingSoundKey, setPlayingSoundKey] =
    useState<Nh3dSoundEffectKey | null>(null);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const soundFileInputRefs = useRef<
    Partial<Record<Nh3dSoundEffectKey, HTMLInputElement | null>>
  >({});
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewObjectUrlRef = useRef<string | null>(null);
  const hasLoadedRef = useRef(false);

  const defaultPack = useMemo(
    () => packs.find((pack) => pack.id === nh3dDefaultSoundPackId) ?? null,
    [packs],
  );
  const isDefaultDraft = Boolean(draftPack?.isDefault);

  const stopPreview = useCallback((): void => {
    const audio = previewAudioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.onended = null;
      audio.onerror = null;
    }
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current);
      previewObjectUrlRef.current = null;
    }
    setPlayingSoundKey(null);
  }, []);

  useEffect(() => {
    return () => {
      stopPreview();
    };
  }, [stopPreview]);

  const applyLoadedState = useCallback(
    (loadedPacks: Nh3dSoundPackRecord[], preferredPackId?: string): void => {
      const fallbackPack = loadedPacks[0] ?? null;
      const nextActivePack =
        (preferredPackId
          ? loadedPacks.find((pack) => pack.id === preferredPackId)
          : null) ?? fallbackPack;
      setPacks(loadedPacks);
      setActivePackId(nextActivePack?.id ?? "");
      setDraftPack(nextActivePack ? cloneNh3dSoundPack(nextActivePack) : null);
      setPendingUploads({});
      setIsDraftDirty(false);
      setIsCreateMode(false);
      setNewPackName("");
      stopPreview();
    },
    [stopPreview],
  );

  const reloadSoundPacks = useCallback(
    async (preferredPackId?: string): Promise<void> => {
      setIsLoading(true);
      setErrorText("");
      try {
        const state = await loadNh3dSoundPackStateFromIndexedDb();
        const activePackIdToUse =
          preferredPackId && state.packs.some((pack) => pack.id === preferredPackId)
            ? preferredPackId
            : state.activePackId;
        applyLoadedState(state.packs, activePackIdToUse);
      } catch (error) {
        setErrorText(
          getErrorMessage(error, "Failed to load sound packs from IndexedDB."),
        );
      } finally {
        setIsLoading(false);
      }
    },
    [applyLoadedState],
  );

  useEffect(() => {
    if (!visible || hasLoadedRef.current) {
      return;
    }
    hasLoadedRef.current = true;
    void reloadSoundPacks();
  }, [reloadSoundPacks, visible]);

  const markDraftAsDirty = (): void => {
    setIsDraftDirty(true);
    setStatusText("");
    setErrorText("");
  };

  const updateDraftSound = (
    soundKey: Nh3dSoundEffectKey,
    updater: (current: Nh3dSoundPackRecord["sounds"][Nh3dSoundEffectKey]) => Nh3dSoundPackRecord["sounds"][Nh3dSoundEffectKey],
  ): void => {
    setDraftPack((previous) => {
      if (!previous) {
        return previous;
      }
      const current = previous.sounds[soundKey];
      const nextSound = updater(current);
      return {
        ...previous,
        sounds: {
          ...previous.sounds,
          [soundKey]: nextSound,
        },
      };
    });
    markDraftAsDirty();
  };

  const discardPendingChangesIfNeeded = (): boolean => {
    if (!isDraftDirty) {
      return true;
    }
    if (typeof window === "undefined") {
      return false;
    }
    return window.confirm(
      "Discard unsaved sound pack changes and continue?",
    );
  };

  const handleSelectPack = async (nextPackId: string): Promise<void> => {
    if (!nextPackId || nextPackId === activePackId) {
      return;
    }
    if (!discardPendingChangesIfNeeded()) {
      return;
    }
    setErrorText("");
    setStatusText("");
    try {
      await setActiveNh3dSoundPackId(nextPackId);
      const selectedPack = packs.find((pack) => pack.id === nextPackId) ?? null;
      if (selectedPack) {
        applyLoadedState(packs, selectedPack.id);
      } else {
        await reloadSoundPacks(nextPackId);
      }
    } catch (error) {
      setErrorText(
        getErrorMessage(error, "Failed to select the requested sound pack."),
      );
      await reloadSoundPacks();
    }
  };

  const handleCreatePack = async (): Promise<void> => {
    const normalizedName = normalizeNh3dSoundPackName(newPackName);
    if (!normalizedName) {
      setErrorText("Provide a sound pack name.");
      return;
    }
    if (!discardPendingChangesIfNeeded()) {
      return;
    }
    setIsBusy(true);
    setErrorText("");
    setStatusText("");
    try {
      const createdPack = await createNh3dSoundPack(normalizedName);
      await reloadSoundPacks(createdPack.id);
      setStatusText(`Created sound pack '${createdPack.name}'.`);
    } catch (error) {
      setErrorText(getErrorMessage(error, "Failed to create sound pack."));
    } finally {
      setIsBusy(false);
    }
  };

  const handleSaveDraft = async (): Promise<void> => {
    if (!draftPack || !isDraftDirty) {
      return;
    }
    setIsBusy(true);
    setErrorText("");
    setStatusText("");
    try {
      const savedPack = await saveNh3dSoundPackToIndexedDb(draftPack, pendingUploads);
      await reloadSoundPacks(savedPack.id);
      setStatusText(`Saved sound pack '${savedPack.name}'.`);
    } catch (error) {
      setErrorText(getErrorMessage(error, "Failed to save sound pack."));
    } finally {
      setIsBusy(false);
    }
  };

  const handleExportDraft = async (): Promise<void> => {
    if (!draftPack) {
      return;
    }
    setIsBusy(true);
    setErrorText("");
    setStatusText("");
    try {
      const archiveBlob = await exportNh3dSoundPackToZip(draftPack, pendingUploads);
      const archiveName = `${sanitizeArchiveFileName(draftPack.name)}.soundpack.zip`;
      const objectUrl = URL.createObjectURL(archiveBlob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = archiveName;
      anchor.rel = "noopener";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      setStatusText(`Exported '${draftPack.name}'.`);
    } catch (error) {
      setErrorText(getErrorMessage(error, "Failed to export sound pack ZIP."));
    } finally {
      setIsBusy(false);
    }
  };

  const handleImportArchiveChange = async (
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) {
      return;
    }
    if (!discardPendingChangesIfNeeded()) {
      return;
    }
    setIsBusy(true);
    setErrorText("");
    setStatusText("");
    try {
      const importedPack = await importNh3dSoundPackFromZip(file);
      await reloadSoundPacks(importedPack.id);
      setStatusText(`Imported sound pack '${importedPack.name}'.`);
    } catch (error) {
      setErrorText(getErrorMessage(error, "Failed to import sound pack ZIP."));
    } finally {
      setIsBusy(false);
    }
  };

  const handlePlayPreview = async (soundKey: Nh3dSoundEffectKey): Promise<void> => {
    if (!draftPack) {
      return;
    }
    setErrorText("");
    stopPreview();
    const pendingUpload = pendingUploads[soundKey];
    const sound = draftPack.sounds[soundKey];
    const fallbackSound = defaultPack?.sounds[soundKey];
    let previewUrl = "";
    let revokeAfterPlay = false;

    try {
      if (pendingUpload instanceof Blob) {
        previewUrl = URL.createObjectURL(pendingUpload);
        revokeAfterPlay = true;
      } else if (pendingUpload === null) {
        previewUrl = fallbackSound?.path || resolveNh3dDefaultSoundPath(soundKey);
      } else if (sound.source === "user") {
        const storedBlob = await loadStoredNh3dSoundBlob(sound.path);
        if (storedBlob) {
          previewUrl = URL.createObjectURL(storedBlob);
          revokeAfterPlay = true;
        } else {
          previewUrl = sound.path;
        }
      } else {
        previewUrl = sound.path;
      }

      if (!previewUrl) {
        throw new Error("No preview source available for this sound.");
      }

      const audio = previewAudioRef.current ?? new Audio();
      previewAudioRef.current = audio;
      audio.pause();
      audio.currentTime = 0;
      audio.src = previewUrl;
      audio.onended = () => {
        setPlayingSoundKey(null);
        if (revokeAfterPlay && previewObjectUrlRef.current) {
          URL.revokeObjectURL(previewObjectUrlRef.current);
          previewObjectUrlRef.current = null;
        }
      };
      audio.onerror = () => {
        setPlayingSoundKey(null);
        if (revokeAfterPlay && previewObjectUrlRef.current) {
          URL.revokeObjectURL(previewObjectUrlRef.current);
          previewObjectUrlRef.current = null;
        }
        setErrorText("Unable to preview this sound.");
      };

      if (revokeAfterPlay) {
        previewObjectUrlRef.current = previewUrl;
      }

      await audio.play();
      setPlayingSoundKey(soundKey);
    } catch (error) {
      if (revokeAfterPlay) {
        URL.revokeObjectURL(previewUrl);
      }
      previewObjectUrlRef.current = null;
      setErrorText(getErrorMessage(error, "Unable to preview this sound."));
    }
  };

  if (!visible) {
    return null;
  }

  return (
    <div className="nh3d-soundpack-manager">
      <div className="nh3d-option-row">
        <div className="nh3d-option-copy">
          <div className="nh3d-option-label">Sound pack</div>
          <div className="nh3d-option-description">
            Select the active sound pack used for sound path resolution.
          </div>
        </div>
        <div className="nh3d-option-select-controls nh3d-soundpack-select-controls">
          <select
            className="nh3d-startup-config-select"
            disabled={isLoading || isBusy || packs.length === 0}
            onChange={(event) => {
              void handleSelectPack(event.target.value);
            }}
            value={activePackId}
          >
            {packs.map((pack) => (
              <option key={pack.id} value={pack.id}>
                {pack.name}
                {pack.isDefault ? " (default)" : ""}
              </option>
            ))}
          </select>
          <button
            className="nh3d-menu-action-button"
            disabled={isBusy || isLoading}
            onClick={() => {
              setIsCreateMode((previous) => !previous);
              setErrorText("");
              setStatusText("");
            }}
            type="button"
          >
            + Add new soundpack
          </button>
        </div>
      </div>

      {isCreateMode ? (
        <div className="nh3d-soundpack-create-panel">
          <label className="nh3d-option-label" htmlFor="nh3d-soundpack-new-name">
            New sound pack name
          </label>
          <input
            className="nh3d-text-input"
            id="nh3d-soundpack-new-name"
            onChange={(event) => setNewPackName(event.target.value)}
            placeholder="My Sound Pack"
            type="text"
            value={newPackName}
          />
          <div className="nh3d-soundpack-create-actions">
            <button
              className="nh3d-menu-action-button nh3d-menu-action-confirm"
              disabled={isBusy}
              onClick={() => {
                void handleCreatePack();
              }}
              type="button"
            >
              Create and save
            </button>
            <button
              className="nh3d-menu-action-button nh3d-menu-action-cancel"
              disabled={isBusy}
              onClick={() => {
                setIsCreateMode(false);
                setNewPackName("");
              }}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {draftPack ? (
        <div className="nh3d-option-row nh3d-soundpack-name-row">
          <div className="nh3d-option-copy">
            <div className="nh3d-option-label">Pack name</div>
            <div className="nh3d-option-description">
              {isDefaultDraft
                ? "The default pack keeps built-in sound files read-only."
                : "Rename this pack and save to update its sound file namespace."}
            </div>
          </div>
          <div className="nh3d-soundpack-name-controls">
            <input
              className="nh3d-text-input"
              onChange={(event) => {
                setDraftPack((previous) =>
                  previous
                    ? {
                        ...previous,
                        name: event.target.value,
                      }
                    : previous,
                );
                markDraftAsDirty();
              }}
              readOnly={isDefaultDraft}
              type="text"
              value={draftPack.name}
            />
            <button
              className="nh3d-menu-action-button nh3d-menu-action-confirm"
              disabled={isBusy || isLoading || !isDraftDirty}
              onClick={() => {
                void handleSaveDraft();
              }}
              type="button"
            >
              Save sound pack
            </button>
          </div>
        </div>
      ) : null}

      <div className="nh3d-soundpack-top-actions">
        <button
          className="nh3d-menu-action-button"
          disabled={isBusy || isLoading || !draftPack}
          onClick={() => {
            void handleExportDraft();
          }}
          type="button"
        >
          Export soundpack
        </button>
        <button
          className="nh3d-menu-action-button"
          disabled={isBusy || isLoading}
          onClick={() => importFileInputRef.current?.click()}
          type="button"
        >
          Import soundpack
        </button>
        {playingSoundKey ? (
          <button
            className="nh3d-menu-action-button"
            onClick={stopPreview}
            type="button"
          >
            Stop preview
          </button>
        ) : null}
        <input
          accept=".zip,application/zip,application/x-zip-compressed"
          className="nh3d-soundpack-hidden-input"
          onChange={(event) => {
            void handleImportArchiveChange(event);
          }}
          ref={importFileInputRef}
          type="file"
        />
      </div>

      {isLoading ? (
        <div className="nh3d-option-description">Loading sound packs...</div>
      ) : null}
      {statusText ? (
        <div className="nh3d-soundpack-status">{statusText}</div>
      ) : null}
      {errorText ? <div className="nh3d-soundpack-error">{errorText}</div> : null}

      {draftPack ? (
        <div className="nh3d-soundpack-list">
          {nh3dSoundEffectDefinitions.map((definition) => {
            const soundKey = definition.key;
            const sound = draftPack.sounds[soundKey];
            const fallbackSound = defaultPack?.sounds[soundKey];
            const pendingUpload = pendingUploads[soundKey];
            const pendingFileName =
              pendingUpload instanceof File && pendingUpload.name
                ? pendingUpload.name
                : sound.fileName;
            const displayFileName =
              pendingUpload instanceof Blob
                ? `${pendingFileName} (pending save)`
                : pendingUpload === null
                  ? `${fallbackSound?.fileName || resolveNh3dDefaultSoundPath(soundKey)} (default)`
                  : sound.source === "user"
                    ? `${sound.fileName} (custom)`
                    : `${sound.fileName} (built-in)`;
            const volumePercent = Math.round(sound.volume * 100);
            const canResetCustom =
              !isDefaultDraft &&
              (pendingUpload instanceof Blob || sound.source === "user");
            const isPlaying = playingSoundKey === soundKey;
            return (
              <div className="nh3d-soundpack-row" key={soundKey}>
                <div className="nh3d-soundpack-control-row nh3d-soundpack-control-row-primary">
                  <button
                    aria-checked={sound.enabled}
                    aria-label={`Enable ${definition.label} sound`}
                    className={`nh3d-option-switch nh3d-soundpack-toggle${
                      sound.enabled ? " is-on" : ""
                    }`}
                    disabled={isBusy}
                    onClick={() =>
                      updateDraftSound(soundKey, (current) => ({
                        ...current,
                        enabled: !current.enabled,
                      }))
                    }
                    role="switch"
                    type="button"
                  >
                    <span className="nh3d-option-switch-thumb" />
                  </button>
                  <div className="nh3d-soundpack-sound-type">
                    <div className="nh3d-option-label">{definition.label}</div>
                  </div>
                  <div className="nh3d-soundpack-info-box nh3d-soundpack-volume-box">
                    <div className="nh3d-option-description">Volume</div>
                    <div className="nh3d-soundpack-volume-control">
                      <input
                        aria-label={`Volume for ${definition.label}`}
                        className="nh3d-option-slider"
                        disabled={isBusy}
                        max={100}
                        min={0}
                        onChange={(event) =>
                          updateDraftSound(soundKey, (current) => ({
                            ...current,
                            volume: Math.max(
                              0,
                              Math.min(1, Number(event.target.value) / 100),
                            ),
                          }))
                        }
                        step={1}
                        type="range"
                        value={volumePercent}
                      />
                      <span className="nh3d-soundpack-volume-value">
                        {volumePercent}%
                      </span>
                    </div>
                  </div>
                  <button
                    className={`nh3d-menu-action-button nh3d-soundpack-play-button${
                      isPlaying ? " nh3d-menu-action-confirm" : ""
                    }`}
                    disabled={isBusy}
                    onClick={() => {
                      void handlePlayPreview(soundKey);
                    }}
                    type="button"
                  >
                    {isPlaying ? "Playing..." : "Play"}
                  </button>
                </div>
                <div className="nh3d-soundpack-control-row nh3d-soundpack-control-row-secondary">
                  <button
                    className="nh3d-menu-action-button nh3d-soundpack-choose-file-button"
                    disabled={isDefaultDraft || isBusy}
                    onClick={() => {
                      soundFileInputRefs.current[soundKey]?.click();
                    }}
                    type="button"
                  >
                    Choose File
                  </button>
                  <input
                    accept=".wav,.ogg,.mp3,.m4a,.aac,.flac,.opus,audio/*"
                    className="nh3d-soundpack-file-input-hidden"
                    disabled={isDefaultDraft || isBusy}
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      event.target.value = "";
                      if (!file || !draftPack || isDefaultDraft) {
                        return;
                      }
                      setPendingUploads((previous) => ({
                        ...previous,
                        [soundKey]: file,
                      }));
                      updateDraftSound(soundKey, (current) => ({
                        ...current,
                        fileName: file.name || current.fileName,
                        mimeType: file.type || current.mimeType,
                        path: resolveNh3dUserSoundPath(
                          draftPack.name,
                          soundKey,
                          file.name || current.fileName,
                        ),
                        source: "user",
                      }));
                    }}
                    ref={(node) => {
                      soundFileInputRefs.current[soundKey] = node;
                    }}
                    type="file"
                  />
                  <div className="nh3d-soundpack-info-box nh3d-soundpack-path">
                    <div className="nh3d-option-description">Sound file</div>
                    <div className="nh3d-soundpack-path-value">
                      {displayFileName}
                    </div>
                  </div>
                  <button
                    className="nh3d-menu-action-button nh3d-soundpack-reset-button"
                    disabled={!canResetCustom || isBusy}
                    onClick={() => {
                      if (!draftPack || isDefaultDraft) {
                        return;
                      }
                      setPendingUploads((previous) => ({
                        ...previous,
                        [soundKey]: null,
                      }));
                      updateDraftSound(soundKey, (current) => ({
                        ...current,
                        fileName:
                          fallbackSound?.fileName || resolveNh3dDefaultSoundPath(soundKey),
                        mimeType: fallbackSound?.mimeType || "audio/ogg",
                        path:
                          fallbackSound?.path ||
                          resolveNh3dDefaultSoundPath(soundKey),
                        source: "builtin",
                      }));
                    }}
                    type="button"
                  >
                    Reset
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
