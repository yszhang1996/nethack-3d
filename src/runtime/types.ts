export type RuntimeEvent = {
  type: string;
  [key: string]: unknown;
};

export type RuntimeEventHandler = (event: RuntimeEvent) => void;

export interface RuntimeBridge {
  start(): Promise<void>;
  sendInput(input: string): void;
  requestTileUpdate(x: number, y: number): void;
  requestAreaUpdate(centerX: number, centerY: number, radius: number): void;
}

export type RuntimeCommand =
  | { type: "start" }
  | { type: "send_input"; input: string }
  | { type: "request_tile_update"; x: number; y: number }
  | {
      type: "request_area_update";
      centerX: number;
      centerY: number;
      radius: number;
    };

export type RuntimeWorkerEnvelope =
  | { type: "runtime_event"; event: RuntimeEvent }
  | { type: "runtime_ready" }
  | { type: "runtime_error"; error: string };
