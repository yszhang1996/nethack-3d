import LocalNetHackRuntime from "./LocalNetHackRuntime";
import { setLoggingEnabled } from "../logging";
import type {
  RuntimeCommand,
  RuntimeEvent,
  RuntimeStartupOptions,
  RuntimeWorkerEnvelope,
} from "./types";

let runtime: LocalNetHackRuntime | null = null;
let started = false;
let terminationReported = false;
let asyncifyWakeUpTrapInstalled = false;

function isLikelyNameInputForDebug(input: string): boolean {
  const trimmed = String(input || "").trim();
  if (trimmed.length < 2 || trimmed.length > 30) {
    return false;
  }
  if (trimmed.startsWith("__") || trimmed.includes(":")) {
    return false;
  }
  return /^[A-Za-z][A-Za-z0-9 _'-]*$/.test(trimmed);
}

function postEnvelope(envelope: RuntimeWorkerEnvelope): void {
  (self as unknown as Worker).postMessage(envelope);
}

function getErrorStatus(errorLike: unknown): number | null {
  if (!errorLike || typeof errorLike !== "object") {
    return null;
  }
  const candidate = errorLike as { status?: unknown };
  if (typeof candidate.status === "number" && Number.isFinite(candidate.status)) {
    return candidate.status;
  }
  return null;
}

function extractErrorMessage(errorLike: unknown): string {
  if (typeof errorLike === "string") {
    return errorLike;
  }
  if (!errorLike || typeof errorLike !== "object") {
    return String(errorLike ?? "");
  }
  const candidate = errorLike as {
    message?: unknown;
    reason?: unknown;
    error?: { message?: unknown; reason?: unknown } | unknown;
  };
  if (typeof candidate.message === "string" && candidate.message.trim()) {
    return candidate.message;
  }
  if (typeof candidate.reason === "string" && candidate.reason.trim()) {
    return candidate.reason;
  }
  if (candidate.error && typeof candidate.error === "object") {
    const inner = candidate.error as { message?: unknown; reason?: unknown };
    if (typeof inner.message === "string" && inner.message.trim()) {
      return inner.message;
    }
    if (typeof inner.reason === "string" && inner.reason.trim()) {
      return inner.reason;
    }
  }
  return String(errorLike);
}

function isNormalRuntimeTermination(message: string, status: number | null): boolean {
  if (status === 0) {
    return true;
  }
  const normalized = String(message || "").toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    (normalized.includes("exitstatus") && normalized.includes("exit(0)")) ||
    normalized.includes("program terminated with exit(0)") ||
    normalized.includes("asyncify wakeup failed")
  );
}

function reportTermination(reason: string, status: number | null = 0): void {
  if (terminationReported) {
    return;
  }
  terminationReported = true;
  postEnvelope({
    type: "runtime_event",
    event: {
      type: "runtime_terminated",
      reason: reason || "Program terminated with exit(0)",
      exitCode: status ?? 0,
    },
  });
}

function reportRuntimeError(errorMessage: string): void {
  postEnvelope({
    type: "runtime_error",
    error: errorMessage || "Runtime worker error",
  });
}

function installAsyncifyWakeUpTrap(): void {
  if (asyncifyWakeUpTrapInstalled) {
    return;
  }
  asyncifyWakeUpTrapInstalled = true;

  const originalConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      const first = args[0];
      const second = args[1];
      const firstText = typeof first === "string" ? first.toLowerCase() : "";
      const secondText = extractErrorMessage(second).toLowerCase();
      const secondStatus = getErrorStatus(second);
      const isWakeUpFailure = firstText.includes("asyncify wakeup failed");
      if (isWakeUpFailure && isNormalRuntimeTermination(secondText, secondStatus)) {
        reportTermination(
          extractErrorMessage(second) || "Program terminated with exit(0)",
          secondStatus ?? 0,
        );
        return;
      }
    } catch {
      // Preserve original logging path even if the detector fails.
    }
    originalConsoleError(...args);
  };
}

function ensureRuntime(startupOptions?: RuntimeStartupOptions): LocalNetHackRuntime {
  if (!runtime) {
    installAsyncifyWakeUpTrap();
    runtime = new LocalNetHackRuntime(
      (event: RuntimeEvent) => {
        postEnvelope({ type: "runtime_event", event });
      },
      (startupOptions ?? null) as any,
    );
  }
  return runtime;
}

self.addEventListener("error", (event: ErrorEvent) => {
  const status = getErrorStatus((event as unknown as { error?: unknown }).error);
  const message = extractErrorMessage(
    (event as unknown as { error?: unknown }).error ?? event.message,
  );
  if (isNormalRuntimeTermination(message, status)) {
    reportTermination(message, status ?? 0);
    event.preventDefault();
    return;
  }
  reportRuntimeError(message);
});

self.addEventListener("unhandledrejection", (event: any) => {
  const status = getErrorStatus(event.reason);
  const message = extractErrorMessage(event.reason);
  if (isNormalRuntimeTermination(message, status)) {
    reportTermination(message, status ?? 0);
    event.preventDefault();
    return;
  }
  reportRuntimeError(message);
});

self.onmessage = async (message: MessageEvent<RuntimeCommand>) => {
  try {
    const command = message.data;

    switch (command.type) {
      case "start":
        setLoggingEnabled(Boolean(command.startupOptions?.loggingEnabled));
        const startInstance = ensureRuntime(command.startupOptions);
        if (!started) {
          await startInstance.start();
          started = true;
        }
        postEnvelope({ type: "runtime_ready" });
        return;
      case "send_input":
        if (isLikelyNameInputForDebug(command.input)) {
          console.log("[NAME_DEBUG] Worker received send_input(name-like)", {
            input: command.input,
          });
        }
        ensureRuntime().sendInput(command.input);
        return;
      case "send_input_sequence":
        ensureRuntime().sendInputSequence(command.inputs);
        return;
      case "send_mouse_input":
        ensureRuntime().sendMouseInput(command.x, command.y, command.button);
        return;
      case "request_tile_update":
        ensureRuntime().requestTileUpdate(command.x, command.y);
        return;
      case "request_area_update":
        ensureRuntime().requestAreaUpdate(
          command.centerX,
          command.centerY,
          command.radius,
        );
        return;
      case "set_logging":
        setLoggingEnabled(Boolean(command.enabled));
        return;
      default:
        return;
    }
  } catch (error) {
    const status = getErrorStatus(error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (isNormalRuntimeTermination(errorMessage, status)) {
      reportTermination(errorMessage, status ?? 0);
      return;
    }
    reportRuntimeError(errorMessage);
  }
};
