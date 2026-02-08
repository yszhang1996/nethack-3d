import LocalNetHackRuntime from "./LocalNetHackRuntime";
import type { RuntimeCommand, RuntimeEvent, RuntimeWorkerEnvelope } from "./types";

let runtime: LocalNetHackRuntime | null = null;
let started = false;

function postEnvelope(envelope: RuntimeWorkerEnvelope): void {
  (self as unknown as Worker).postMessage(envelope);
}

function ensureRuntime(): LocalNetHackRuntime {
  if (!runtime) {
    runtime = new LocalNetHackRuntime((event: RuntimeEvent) => {
      postEnvelope({ type: "runtime_event", event });
    });
  }
  return runtime;
}

self.onmessage = async (message: MessageEvent<RuntimeCommand>) => {
  try {
    const command = message.data;
    const instance = ensureRuntime();

    switch (command.type) {
      case "start":
        if (!started) {
          await instance.start();
          started = true;
        }
        postEnvelope({ type: "runtime_ready" });
        return;
      case "send_input":
        instance.sendInput(command.input);
        return;
      case "send_input_sequence":
        instance.sendInputSequence(command.inputs);
        return;
      case "request_tile_update":
        instance.requestTileUpdate(command.x, command.y);
        return;
      case "request_area_update":
        instance.requestAreaUpdate(
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
