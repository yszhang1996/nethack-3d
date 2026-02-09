import LocalNetHackRuntime from "./LocalNetHackRuntime";
import type {
  RuntimeCommand,
  RuntimeEvent,
  RuntimeStartupOptions,
  RuntimeWorkerEnvelope,
} from "./types";

let runtime: LocalNetHackRuntime | null = null;
let started = false;

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

function ensureRuntime(startupOptions?: RuntimeStartupOptions): LocalNetHackRuntime {
  if (!runtime) {
    runtime = new LocalNetHackRuntime(
      (event: RuntimeEvent) => {
        postEnvelope({ type: "runtime_event", event });
      },
      startupOptions,
    );
  }
  return runtime;
}

self.onmessage = async (message: MessageEvent<RuntimeCommand>) => {
  try {
    const command = message.data;

    switch (command.type) {
      case "start":
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
      default:
        return;
    }
  } catch (error) {
    postEnvelope({
      type: "runtime_error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
