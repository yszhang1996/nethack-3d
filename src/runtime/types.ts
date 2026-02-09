export type RuntimeEvent = {
  type: string;
  [key: string]: unknown;
};

export type RuntimeEventHandler = (event: RuntimeEvent) => void;

export interface RuntimeBridge {
  start(): Promise<void>;
  sendInput(input: string): void;
  sendInputSequence(inputs: string[]): void;
  sendMouseInput(x: number, y: number, button: number): void;
  requestTileUpdate(x: number, y: number): void;
  requestAreaUpdate(centerX: number, centerY: number, radius: number): void;
}

export type RuntimeCharacterCreationConfig = {
  mode: "random" | "create";
  name?: string;
  role?: string;
  race?: string;
  gender?: string;
  align?: string;
};

export type RuntimeStartupOptions = {
  characterCreation?: RuntimeCharacterCreationConfig;
};

export type RuntimeCommand =
  | { type: "start"; startupOptions?: RuntimeStartupOptions }
  | { type: "send_input"; input: string }
  | { type: "send_input_sequence"; inputs: string[] }
  | { type: "send_mouse_input"; x: number; y: number; button: number }
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
