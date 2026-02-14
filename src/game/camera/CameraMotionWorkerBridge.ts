import type {
  CameraMotionPose,
  CameraMotionStateSnapshot,
  CameraMotionWorkerCommand,
  CameraMotionWorkerEnvelope,
} from "./types";

export default class CameraMotionWorkerBridge {
  private readonly worker: Worker;

  private readonly onPose: (pose: CameraMotionPose) => void;

  constructor(onPose: (pose: CameraMotionPose) => void) {
    this.onPose = onPose;
    this.worker = new Worker(new URL("./camera-motion-worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (
      message: MessageEvent<CameraMotionWorkerEnvelope>,
    ) => {
      this.handleWorkerMessage(message.data);
    };
    this.worker.onerror = (error) => {
      console.error("Camera motion worker error:", error);
    };
  }

  syncState(state: CameraMotionStateSnapshot): void {
    this.postCommand({ type: "sync_state", state });
  }

  shutdown(): void {
    this.postCommand({ type: "shutdown" });
    this.worker.terminate();
  }

  private postCommand(command: CameraMotionWorkerCommand): void {
    this.worker.postMessage(command);
  }

  private handleWorkerMessage(message: CameraMotionWorkerEnvelope): void {
    if (message.type === "pose") {
      this.onPose(message.pose);
    }
  }
}
