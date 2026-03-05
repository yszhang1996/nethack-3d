type FmodOut<T> = { val?: T };

export interface FmodCoreSystem {
  setDSPBufferSize(bufferLength: number, numBuffers: number): number;
  getDriverInfo(
    id: number,
    nameOrNull: unknown,
    guidOrNull: unknown,
    systemRateOut: FmodOut<number>,
    speakerModeOrNull: unknown,
    speakerModeChannelsOrNull: unknown,
  ): number;
  setSoftwareFormat(
    sampleRate: number,
    speakerMode: number,
    numRawSpeakers: number,
  ): number;
  mixerSuspend(): number;
  mixerResume(): number;
}

export interface FmodStudioSystem {
  getCoreSystem(out: FmodOut<FmodCoreSystem>): number;
  initialize(
    maxChannels: number,
    studioFlags: number,
    coreFlags: number,
    extraDriverData: unknown,
  ): number;
  update(): number;
}

export interface FmodRuntimeModule {
  OK: number;
  STUDIO_INIT_NORMAL: number;
  INIT_NORMAL: number;
  SPEAKERMODE_DEFAULT: number;
  Studio_System_Create(out: FmodOut<FmodStudioSystem>): number;
  ErrorString(result: number): string;
  [key: string]: unknown;
}

export type FmodModuleFactory = (
  moduleArg?: Record<string, unknown>,
) => Promise<FmodRuntimeModule>;

export type FmodRuntimeOptions = {
  scriptPath?: string;
  wasmPath?: string;
  initialMemoryBytes?: number;
  maxVirtualChannels?: number;
  dspBufferLength?: number;
  dspBufferCount?: number;
  updateIntervalMs?: number;
};

type RequiredFmodRuntimeOptions = Required<FmodRuntimeOptions>;

export type FmodAudioBackendMode =
  | "audio-worklet-shared"
  | "audio-worklet-copy"
  | "script-processor"
  | "unknown";

export type FmodThreadingDiagnostics = {
  backendMode: FmodAudioBackendMode;
  audioWorkletSupported: boolean;
  crossOriginIsolated: boolean;
  sharedArrayBufferAvailable: boolean;
  updateIntervalMs: number;
};

declare global {
  interface Window {
    FMODModule?: FmodModuleFactory;
  }
}

const defaultFmodRuntimeOptions: RequiredFmodRuntimeOptions = {
  scriptPath: "fmod/fmodstudio.js",
  wasmPath: "fmod/fmodstudio.wasm",
  initialMemoryBytes: 64 * 1024 * 1024,
  maxVirtualChannels: 1024,
  dspBufferLength: 2048,
  dspBufferCount: 2,
  updateIntervalMs: 20,
};

function isAbsoluteUrl(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(value);
}

function resolvePublicAssetUrl(assetPath: string): string {
  if (isAbsoluteUrl(assetPath)) {
    return assetPath;
  }
  if (typeof window === "undefined") {
    return assetPath;
  }
  const normalizedPath = String(assetPath || "").replace(/^\/+/, "");
  const baseUrl =
    typeof import.meta.env.BASE_URL === "string" &&
    import.meta.env.BASE_URL.trim()
      ? import.meta.env.BASE_URL.trim()
      : "/";
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    normalizedPath,
    new URL(normalizedBase, window.location.href),
  ).toString();
}

export class FmodRuntime {
  private readonly options: RequiredFmodRuntimeOptions;
  private readonly scriptUrl: string;
  private readonly wasmUrl: string;
  private readonly scriptDirectoryUrl: string;
  private module: FmodRuntimeModule | null = null;
  private studioSystem: FmodStudioSystem | null = null;
  private coreSystem: FmodCoreSystem | null = null;
  private initializePromise: Promise<void> | null = null;
  private loadScriptPromise: Promise<void> | null = null;
  private updateTimerId: number | null = null;
  private userGestureAudioResumed: boolean = false;
  private updateErrorLogged: boolean = false;
  private enabled: boolean = true;
  private threadingDiagnostics: FmodThreadingDiagnostics = {
    backendMode: "unknown",
    audioWorkletSupported: false,
    crossOriginIsolated: false,
    sharedArrayBufferAvailable: false,
    updateIntervalMs: defaultFmodRuntimeOptions.updateIntervalMs,
  };

  constructor(options?: FmodRuntimeOptions) {
    this.options = {
      ...defaultFmodRuntimeOptions,
      ...(options ?? {}),
    };
    this.scriptUrl = resolvePublicAssetUrl(this.options.scriptPath);
    this.wasmUrl = resolvePublicAssetUrl(this.options.wasmPath);
    this.scriptDirectoryUrl = new URL("./", this.scriptUrl).toString();
  }

  public initialize(): Promise<void> {
    if (!this.initializePromise) {
      this.initializePromise = this.initializeInternal().catch((error) => {
        this.initializePromise = null;
        this.module = null;
        this.studioSystem = null;
        this.coreSystem = null;
        this.userGestureAudioResumed = false;
        this.updateErrorLogged = false;
        this.stopUpdateLoop();
        this.threadingDiagnostics = {
          backendMode: "unknown",
          audioWorkletSupported: false,
          crossOriginIsolated: false,
          sharedArrayBufferAvailable: false,
          updateIntervalMs: this.options.updateIntervalMs,
        };
        throw error;
      });
    }
    return this.initializePromise;
  }

  public isInitialized(): boolean {
    return this.module !== null && this.studioSystem !== null;
  }

  public getModule(): FmodRuntimeModule | null {
    return this.module;
  }

  public getStudioSystem(): FmodStudioSystem | null {
    return this.studioSystem;
  }

  public getCoreSystem(): FmodCoreSystem | null {
    return this.coreSystem;
  }

  public getThreadingDiagnostics(): FmodThreadingDiagnostics {
    return { ...this.threadingDiagnostics };
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(enabled: boolean): void {
    const nextEnabled = Boolean(enabled);
    if (this.enabled === nextEnabled) {
      return;
    }
    this.enabled = nextEnabled;
    if (!this.module || !this.studioSystem) {
      return;
    }
    if (nextEnabled) {
      if (this.resumeMixer()) {
        this.userGestureAudioResumed = true;
      }
      this.startUpdateLoop();
      return;
    }
    this.stopUpdateLoop();
    this.suspendMixer();
    this.userGestureAudioResumed = false;
  }

  public isUsingThreadedAudioMixing(): boolean {
    return (
      this.threadingDiagnostics.backendMode === "audio-worklet-copy" ||
      this.threadingDiagnostics.backendMode === "audio-worklet-shared"
    );
  }

  public update(): void {
    if (!this.module || !this.studioSystem) {
      return;
    }
    const result = this.studioSystem.update();
    if (result === this.module.OK) {
      return;
    }
    if (!this.updateErrorLogged) {
      this.updateErrorLogged = true;
      console.warn(
        `FMOD Studio::System::update failed: ${this.formatResult(result)}`,
      );
    }
  }

  public resumeFromUserGesture(): void {
    if (
      !this.enabled ||
      this.userGestureAudioResumed ||
      !this.module ||
      !this.coreSystem
    ) {
      return;
    }
    if (!this.suspendMixer()) {
      return;
    }
    if (!this.resumeMixer()) {
      return;
    }
    this.userGestureAudioResumed = true;
  }

  private async initializeInternal(): Promise<void> {
    const moduleFactory = await this.getModuleFactory();
    const moduleConfig: Record<string, unknown> = {
      INITIAL_MEMORY: this.options.initialMemoryBytes,
      locateFile: (path: string) => {
        if (path.endsWith(".wasm")) {
          return this.wasmUrl;
        }
        return new URL(path, this.scriptDirectoryUrl).toString();
      },
      printErr: (...parts: unknown[]) => {
        console.error("[FMOD]", ...parts);
      },
      window,
    };

    const module = await moduleFactory(moduleConfig);
    this.module = module;

    const studioOut: FmodOut<FmodStudioSystem> = {};
    this.assertOk(module.Studio_System_Create(studioOut), "Studio_System_Create");
    if (!studioOut.val) {
      throw new Error("FMOD Studio_System_Create returned no system object");
    }
    this.studioSystem = studioOut.val;

    const coreOut: FmodOut<FmodCoreSystem> = {};
    this.assertOk(
      this.studioSystem.getCoreSystem(coreOut),
      "Studio System::getCoreSystem",
    );
    if (!coreOut.val) {
      throw new Error("FMOD getCoreSystem returned no core system object");
    }
    this.coreSystem = coreOut.val;

    this.assertOk(
      this.coreSystem.setDSPBufferSize(
        this.options.dspBufferLength,
        this.options.dspBufferCount,
      ),
      "Core System::setDSPBufferSize",
    );

    const outputRate: FmodOut<number> = {};
    this.assertOk(
      this.coreSystem.getDriverInfo(0, null, null, outputRate, null, null),
      "Core System::getDriverInfo",
    );
    if (
      typeof outputRate.val === "number" &&
      Number.isFinite(outputRate.val) &&
      outputRate.val > 0
    ) {
      this.assertOk(
        this.coreSystem.setSoftwareFormat(
          Math.trunc(outputRate.val),
          this.module.SPEAKERMODE_DEFAULT,
          0,
        ),
        "Core System::setSoftwareFormat",
      );
    }

    this.assertOk(
      this.studioSystem.initialize(
        this.options.maxVirtualChannels,
        this.module.STUDIO_INIT_NORMAL,
        this.module.INIT_NORMAL,
        null,
      ),
      "Studio System::initialize",
    );

    this.threadingDiagnostics = this.inspectThreadingDiagnostics();
    if (this.enabled) {
      this.startUpdateLoop();
    } else {
      this.suspendMixer();
    }
  }

  private async getModuleFactory(): Promise<FmodModuleFactory> {
    if (typeof window === "undefined" || typeof document === "undefined") {
      throw new Error("FMOD requires a browser environment");
    }
    if (window.FMODModule) {
      return window.FMODModule;
    }
    await this.loadScript();
    if (!window.FMODModule) {
      throw new Error(
        `FMOD script loaded from ${this.scriptUrl} but FMODModule is missing`,
      );
    }
    return window.FMODModule;
  }

  private loadScript(): Promise<void> {
    if (this.loadScriptPromise) {
      return this.loadScriptPromise;
    }
    this.loadScriptPromise = new Promise<void>((resolve, reject) => {
      const existing = Array.from(
        document.getElementsByTagName("script"),
      ).find((entry) => entry.src === this.scriptUrl);
      const script = existing ?? document.createElement("script");

      if (existing && existing.dataset.loaded === "true") {
        resolve();
        return;
      }

      const handleLoad = (): void => {
        script.dataset.loaded = "true";
        cleanup();
        resolve();
      };
      const handleError = (): void => {
        cleanup();
        reject(new Error(`Failed to load FMOD script: ${this.scriptUrl}`));
      };
      const cleanup = (): void => {
        script.removeEventListener("load", handleLoad);
        script.removeEventListener("error", handleError);
      };

      script.addEventListener("load", handleLoad, { once: true });
      script.addEventListener("error", handleError, { once: true });

      if (!existing) {
        script.async = true;
        script.src = this.scriptUrl;
        script.dataset.nh3dFmodScript = "1";
        document.head.appendChild(script);
      }
    }).catch((error) => {
      this.loadScriptPromise = null;
      throw error;
    });
    return this.loadScriptPromise;
  }

  private assertOk(result: number, operationName: string): void {
    if (!this.module) {
      throw new Error(`${operationName} failed: FMOD module is not ready`);
    }
    if (result === this.module.OK) {
      return;
    }
    throw new Error(
      `${operationName} failed: ${this.formatResult(result)} (${result})`,
    );
  }

  private formatResult(result: number): string {
    if (!this.module) {
      return "unknown FMOD error";
    }
    try {
      return this.module.ErrorString(result);
    } catch {
      return `FMOD error ${result}`;
    }
  }

  private startUpdateLoop(): void {
    if (typeof window === "undefined" || !this.enabled) {
      return;
    }
    this.stopUpdateLoop();
    const intervalMs = Math.max(5, Math.round(this.options.updateIntervalMs));
    this.updateTimerId = window.setInterval(() => {
      this.update();
    }, intervalMs);
  }

  private stopUpdateLoop(): void {
    if (this.updateTimerId === null || typeof window === "undefined") {
      return;
    }
    window.clearInterval(this.updateTimerId);
    this.updateTimerId = null;
  }

  private suspendMixer(): boolean {
    if (!this.module || !this.coreSystem) {
      return false;
    }
    try {
      this.assertOk(this.coreSystem.mixerSuspend(), "Core System::mixerSuspend");
      return true;
    } catch (error) {
      console.warn("Failed to suspend FMOD mixer:", error);
      return false;
    }
  }

  private resumeMixer(): boolean {
    if (!this.module || !this.coreSystem) {
      return false;
    }
    try {
      this.assertOk(this.coreSystem.mixerResume(), "Core System::mixerResume");
      return true;
    } catch (error) {
      console.warn("Failed to resume FMOD mixer:", error);
      return false;
    }
  }

  private inspectThreadingDiagnostics(): FmodThreadingDiagnostics {
    const moduleAny = this.module as Record<string, unknown> | null;
    const globalScope = globalThis as {
      AudioWorkletNode?: unknown;
      crossOriginIsolated?: boolean;
      SharedArrayBuffer?: unknown;
    };

    const audioWorkletSupported = typeof globalScope.AudioWorkletNode !== "undefined";
    const crossOriginIsolated = globalScope.crossOriginIsolated === true;
    const sharedArrayBufferAvailable =
      typeof globalScope.SharedArrayBuffer !== "undefined";

    const hasWorkletState =
      Boolean(moduleAny && Object.prototype.hasOwnProperty.call(moduleAny, "mContext")) ||
      Boolean(moduleAny && Object.prototype.hasOwnProperty.call(moduleAny, "mWorkletNode")) ||
      Boolean(
        moduleAny &&
          Object.prototype.hasOwnProperty.call(moduleAny, "mSharedArrayBuffers"),
      );
    const hasScriptProcessorState =
      Boolean(moduleAny && Object.prototype.hasOwnProperty.call(moduleAny, "context")) ||
      Boolean(
        moduleAny && Object.prototype.hasOwnProperty.call(moduleAny, "_as_script_node"),
      );
    const sharedPathActive =
      moduleAny &&
      Object.prototype.hasOwnProperty.call(moduleAny, "mSharedArrayBuffers") &&
      moduleAny.mSharedArrayBuffers === true;

    let backendMode: FmodAudioBackendMode = "unknown";
    if (hasWorkletState) {
      backendMode = sharedPathActive
        ? "audio-worklet-shared"
        : "audio-worklet-copy";
    } else if (hasScriptProcessorState) {
      backendMode = "script-processor";
    } else if (audioWorkletSupported) {
      backendMode =
        crossOriginIsolated && sharedArrayBufferAvailable
          ? "audio-worklet-shared"
          : "audio-worklet-copy";
    } else {
      backendMode = "script-processor";
    }

    return {
      backendMode,
      audioWorkletSupported,
      crossOriginIsolated,
      sharedArrayBufferAvailable,
      updateIntervalMs: this.options.updateIntervalMs,
    };
  }
}
