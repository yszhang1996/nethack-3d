import type {
  RuntimeBridge,
  RuntimeCommand,
  RuntimeEvent,
  RuntimeEventHandler,
  RuntimeWorkerEnvelope,
} from "./types";

export default class WorkerRuntimeBridge implements RuntimeBridge {
  private readonly worker: Worker;
  private readonly onEvent: RuntimeEventHandler;
  private startPromise: Promise<void> | null = null;
  private startResolve: (() => void) | null = null;
  private startReject: ((reason?: unknown) => void) | null = null;

  constructor(onEvent: RuntimeEventHandler) {
    this.onEvent = onEvent;
    this.worker = new Worker("runtime-worker.js");
    this.worker.onmessage = (message: MessageEvent<RuntimeWorkerEnvelope>) => {
      this.handleWorkerMessage(message.data);
    };
    this.worker.onerror = (error) => {
      if (this.startReject) {
        this.startReject(error);
      }
      console.error("Runtime worker error:", error);
    };
  }

  start(): Promise<void> {
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = new Promise<void>((resolve, reject) => {
      this.startResolve = resolve;
      this.startReject = reject;
      this.postCommand({ type: "start" });
    });

    return this.startPromise;
  }

  sendInput(input: string): void {
    this.postCommand({ type: "send_input", input });
  }

  requestTileUpdate(x: number, y: number): void {
    this.postCommand({ type: "request_tile_update", x, y });
  }

  requestAreaUpdate(centerX: number, centerY: number, radius: number): void {
    this.postCommand({
      type: "request_area_update",
      centerX,
      centerY,
      radius,
    });
  }

  private postCommand(command: RuntimeCommand): void {
    this.worker.postMessage(command);
  }

  private handleWorkerMessage(message: RuntimeWorkerEnvelope): void {
    switch (message.type) {
      case "runtime_ready":
        if (this.startResolve) {
          this.startResolve();
          this.startResolve = null;
          this.startReject = null;
        }
        break;
      case "runtime_error":
        if (this.startReject) {
          this.startReject(new Error(message.error));
          this.startResolve = null;
          this.startReject = null;
        } else {
          console.error("Runtime error:", message.error);
        }
        break;
      case "runtime_event":
        this.onEvent(message.event as RuntimeEvent);
        break;
      default:
        break;
    }
  }
}
