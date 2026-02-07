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
