type NH3DGlobalScope = typeof globalThis & {
  __NH3D_LOGGING_ENABLED__?: boolean;
  __NH3D_ORIGINAL_CONSOLE_LOG__?: typeof console.log;
};

const globalScope = globalThis as NH3DGlobalScope;

const noopLog: typeof console.log = (..._args: unknown[]): void => {};

if (!globalScope.__NH3D_ORIGINAL_CONSOLE_LOG__) {
  globalScope.__NH3D_ORIGINAL_CONSOLE_LOG__ = console.log.bind(console);
}

if (typeof globalScope.__NH3D_LOGGING_ENABLED__ !== "boolean") {
  globalScope.__NH3D_LOGGING_ENABLED__ = false;
}

function applyConsoleLogState(): void {
  const originalLog =
    globalScope.__NH3D_ORIGINAL_CONSOLE_LOG__ || console.log.bind(console);
  console.log = globalScope.__NH3D_LOGGING_ENABLED__ ? originalLog : noopLog;
}

export function isLoggingEnabled(): boolean {
  return Boolean(globalScope.__NH3D_LOGGING_ENABLED__);
}

export function setLoggingEnabled(enabled: boolean): boolean {
  globalScope.__NH3D_LOGGING_ENABLED__ = Boolean(enabled);
  applyConsoleLogState();
  return isLoggingEnabled();
}

export function toggleLoggingEnabled(): boolean {
  return setLoggingEnabled(!isLoggingEnabled());
}

export function logWithOriginal(...args: unknown[]): void {
  const originalLog =
    globalScope.__NH3D_ORIGINAL_CONSOLE_LOG__ || console.log.bind(console);
  originalLog(...args);
}

// Enforce default-off logging policy as soon as this module is loaded.
applyConsoleLogState();
