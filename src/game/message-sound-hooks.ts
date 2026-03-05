import {
  nh3dBaseSoundVariationId,
  loadNh3dSoundPackStateFromIndexedDb,
  loadStoredNh3dSoundBlob,
  resolveNh3dMessageLogSoundEffectKeys,
  resolveNh3dDefaultSoundPath,
  type Nh3dSoundEffectKey,
  type Nh3dSoundEffectVariation,
  type Nh3dSoundPackRecord,
} from "../audio/sound-pack-storage";

type MessageSoundHooksOptions = {
  isSoundEnabled: () => boolean;
  debounceMs?: number;
  soundPackCacheTtlMs?: number;
};

export class MessageSoundHooks {
  private readonly isSoundEnabled: () => boolean;
  private readonly debounceMs: number;
  private readonly soundPackCacheTtlMs: number;
  private readonly repeatedVariationWeight: number = 0.35;
  private readonly footstepFullVolumeRecoveryMs: number = 350;
  private readonly footstepRecencyVolumeCurvePower: number = 1.35;
  private soundPackCacheLoadedAtMs: number = 0;
  private cachedSoundPack: Nh3dSoundPackRecord | null = null;
  private cachedSoundPackRevision: string = "";
  private soundPackLookupInFlight: Promise<Nh3dSoundPackRecord | null> | null =
    null;
  private soundPackLoadErrorLogged: boolean = false;
  private lastPlayedAtByKey: Map<Nh3dSoundEffectKey, number> = new Map();
  private lastPlayedVariationIdByKey: Map<Nh3dSoundEffectKey, string> =
    new Map();
  private userSoundBlobUrlByPath: Map<string, string> = new Map();

  constructor(options: MessageSoundHooksOptions) {
    this.isSoundEnabled = options.isSoundEnabled;
    this.debounceMs = Math.max(1, Math.round(options.debounceMs ?? 120));
    this.soundPackCacheTtlMs = Math.max(
      250,
      Math.round(options.soundPackCacheTtlMs ?? 3000),
    );
  }

  public playDamageEffectSound(variant: "hit" | "defeat"): void {
    if (variant === "defeat") {
      void this.playSoundEffect("monster-killed");
      return;
    }
    void this.playSoundEffect("hit");
  }

  public playOtherMonsterKilledSound(): void {
    void this.playSoundEffect("monster-killed-other");
  }

  public playPlayerFootstepSound(): void {
    void this.playSoundEffect("player-walk");
  }

  public playMessageLogSoundEffects(messageLike: unknown): void {
    const soundKeys = resolveNh3dMessageLogSoundEffectKeys(messageLike);
    for (const soundKey of soundKeys) {
      void this.playSoundEffect(soundKey);
    }
  }

  public reset(): void {
    this.lastPlayedAtByKey.clear();
    this.lastPlayedVariationIdByKey.clear();
  }

  public dispose(): void {
    this.reset();
    this.clearUserSoundBlobUrlCache();
  }

  private clearUserSoundBlobUrlCache(): void {
    for (const blobUrl of this.userSoundBlobUrlByPath.values()) {
      URL.revokeObjectURL(blobUrl);
    }
    this.userSoundBlobUrlByPath.clear();
  }

  private async resolveActiveSoundPack(): Promise<Nh3dSoundPackRecord | null> {
    const now = Date.now();
    if (
      this.cachedSoundPack &&
      now - this.soundPackCacheLoadedAtMs <= this.soundPackCacheTtlMs
    ) {
      return this.cachedSoundPack;
    }

    if (this.soundPackLookupInFlight) {
      return this.soundPackLookupInFlight;
    }

    this.soundPackLookupInFlight = (async () => {
      try {
        const state = await loadNh3dSoundPackStateFromIndexedDb();
        const activePack =
          state.packs.find((pack) => pack.id === state.activePackId) ??
          state.packs.find((pack) => pack.isDefault) ??
          null;
        const nextRevision = activePack
          ? `${activePack.id}:${activePack.updatedAt}`
          : "";
        if (nextRevision !== this.cachedSoundPackRevision) {
          this.clearUserSoundBlobUrlCache();
          this.cachedSoundPackRevision = nextRevision;
        }
        this.cachedSoundPack = activePack;
        this.soundPackCacheLoadedAtMs = Date.now();
        this.soundPackLoadErrorLogged = false;
        return activePack;
      } catch (error) {
        if (!this.soundPackLoadErrorLogged) {
          this.soundPackLoadErrorLogged = true;
          console.warn(
            "Unable to load sound-pack state for gameplay message hooks.",
            error,
          );
        }
        this.cachedSoundPack = null;
        this.soundPackCacheLoadedAtMs = Date.now();
        return null;
      } finally {
        this.soundPackLookupInFlight = null;
      }
    })();

    return this.soundPackLookupInFlight;
  }

  private async resolveSoundEffectSourceUrl(
    soundKey: Nh3dSoundEffectKey,
    entry: {
      path: string;
      source: "builtin" | "user";
    } | null,
  ): Promise<string | null> {
    const defaultPath = resolveNh3dDefaultSoundPath(soundKey);
    if (!entry) {
      return defaultPath;
    }

    const assignmentPath = String(entry.path || "").trim();
    if (entry.source !== "user") {
      return assignmentPath || defaultPath;
    }
    if (!assignmentPath) {
      return defaultPath;
    }

    const cachedBlobUrl = this.userSoundBlobUrlByPath.get(assignmentPath);
    if (cachedBlobUrl) {
      return cachedBlobUrl;
    }

    try {
      const blob = await loadStoredNh3dSoundBlob(assignmentPath);
      if (!blob) {
        return defaultPath;
      }
      const blobUrl = URL.createObjectURL(blob);
      this.userSoundBlobUrlByPath.set(assignmentPath, blobUrl);
      return blobUrl;
    } catch {
      return defaultPath;
    }
  }

  private collectSoundVariations(
    soundKey: Nh3dSoundEffectKey,
    soundPack: Nh3dSoundPackRecord | null,
  ): Nh3dSoundEffectVariation[] {
    const assignment = soundPack?.sounds[soundKey];
    if (!assignment) {
      return [
        {
          id: nh3dBaseSoundVariationId,
          key: soundKey,
          enabled: true,
          volume: 1,
          fileName: `${soundKey}.ogg`,
          mimeType: "audio/ogg",
          path: resolveNh3dDefaultSoundPath(soundKey),
          source: "builtin",
          attribution: "",
        },
      ];
    }
    const baseVariation: Nh3dSoundEffectVariation = {
      id: nh3dBaseSoundVariationId,
      key: soundKey,
      enabled: assignment.enabled,
      volume: assignment.volume,
      fileName: assignment.fileName,
      mimeType: assignment.mimeType,
      path: assignment.path,
      source: assignment.source,
      attribution: assignment.attribution,
    };
    return [baseVariation, ...(assignment.variations ?? [])];
  }

  private selectWeightedVariation(
    soundKey: Nh3dSoundEffectKey,
    variations: Nh3dSoundEffectVariation[],
  ): Nh3dSoundEffectVariation | null {
    if (!variations.length) {
      return null;
    }
    if (variations.length === 1) {
      return variations[0] ?? null;
    }

    const lastPlayedVariationId =
      this.lastPlayedVariationIdByKey.get(soundKey) ?? null;
    const weights = variations.map((variation) =>
      variation.id === lastPlayedVariationId ? this.repeatedVariationWeight : 1,
    );
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    if (!(totalWeight > 0)) {
      return variations[0] ?? null;
    }

    let remaining = Math.random() * totalWeight;
    for (let i = 0; i < variations.length; i += 1) {
      remaining -= weights[i] ?? 0;
      if (remaining <= 0) {
        return variations[i] ?? null;
      }
    }

    return variations[variations.length - 1] ?? null;
  }

  private resolveRecencyVolumeScale(
    soundKey: Nh3dSoundEffectKey,
    elapsedSinceLastMs: number,
  ): number {
    if (soundKey !== "player-walk") {
      return 1;
    }
    const normalizedElapsed = Number.isFinite(elapsedSinceLastMs)
      ? Math.max(0, elapsedSinceLastMs)
      : this.footstepFullVolumeRecoveryMs;
    const linearScale = Math.min(
      1,
      normalizedElapsed / this.footstepFullVolumeRecoveryMs,
    );
    return Math.pow(linearScale, this.footstepRecencyVolumeCurvePower);
  }

  private async playSoundEffect(soundKey: Nh3dSoundEffectKey): Promise<void> {
    if (!this.isSoundEnabled()) {
      return;
    }

    const now = Date.now();
    const lastPlayedAt = this.lastPlayedAtByKey.get(soundKey) ?? 0;
    if (now - lastPlayedAt < this.debounceMs) {
      return;
    }
    this.lastPlayedAtByKey.set(soundKey, now);

    const soundPack = await this.resolveActiveSoundPack();
    const variations = this.collectSoundVariations(soundKey, soundPack).filter(
      (entry) => entry.enabled,
    );
    if (variations.length === 0) {
      return;
    }

    const selectedVariation = this.selectWeightedVariation(
      soundKey,
      variations,
    );
    if (!selectedVariation) {
      return;
    }
    this.lastPlayedVariationIdByKey.set(soundKey, selectedVariation.id);

    const volume = Math.max(
      0,
      Math.min(1, Number(selectedVariation.volume ?? 1)),
    );
    const recencyVolumeScale = this.resolveRecencyVolumeScale(
      soundKey,
      now - lastPlayedAt,
    );
    const effectiveVolume = volume * recencyVolumeScale;
    if (effectiveVolume <= 0) {
      return;
    }

    const sourceUrl = await this.resolveSoundEffectSourceUrl(soundKey, {
      path: selectedVariation.path,
      source: selectedVariation.source,
    });
    if (!sourceUrl) {
      return;
    }

    try {
      const audio = new Audio(sourceUrl);
      audio.volume = effectiveVolume;
      audio.preload = "auto";
      void audio.play().catch(() => undefined);
    } catch {
      // Browser autoplay policies can block playback until a user gesture.
    }
  }
}
