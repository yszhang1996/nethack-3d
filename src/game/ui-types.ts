import type { NethackRuntimeVersion } from "../runtime/types";

export type NethackConnectionState =
  | "disconnected"
  | "starting"
  | "running"
  | "error";

export type NethackMenuItem = {
  text?: string;
  accelerator?: string;
  isCategory?: boolean;
  glyph?: number;
  glyphChar?: string;
  [key: string]: unknown;
};

export type PlayerStatsSnapshot = {
  name: string;
  hp: number;
  maxHp: number;
  power: number;
  maxPower: number;
  level: number;
  experience: number;
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
  armor: number;
  dungeon: string;
  dlevel: number;
  gold: number;
  alignment: string;
  hunger: string;
  encumbrance: string;
  time: number;
  score: number;
};

export type QuestionDialogState = {
  text: string;
  choices: string;
  defaultChoice: string;
  menuItems: NethackMenuItem[];
  isPickupDialog: boolean;
  selectedAccelerators: string[];
  activePickupSelectionInput?: string | null;
  activeMenuSelectionInput?: string | null;
  activeActionButton?: "confirm" | "cancel" | null;
  menuPageIndex?: number;
  menuPageCount?: number;
};

export type InfoMenuState = {
  title: string;
  lines: string[];
};

export type InventoryDialogState = {
  visible: boolean;
  items: NethackMenuItem[];
};

export type TextInputRequestState = {
  text: string;
  maxLength?: number;
  placeholder?: string;
};

export type FpsContextAction = {
  id: string;
  label: string;
  kind: "quick" | "extended";
  value: string;
};

export type FpsCrosshairContextState = {
  title: string;
  tileX: number;
  tileY: number;
  actions: FpsContextAction[];
};

export type PlayMode = "normal" | "fps";

export type Nh3dClientOptions = {
  fpsMode: boolean;
  fpsFov: number;
  fpsLookSensitivityX: number;
  fpsLookSensitivityY: number;
  minimap: boolean;
  damageNumbers: boolean;
  tileShakeOnHit: boolean;
  blood: boolean;
  liveMessageLog: boolean;
};

export const nh3dFpsLookSensitivityMin = 0.4;
export const nh3dFpsLookSensitivityMax = 2.6;

export const defaultNh3dClientOptions: Nh3dClientOptions = {
  fpsMode: false,
  fpsFov: 62,
  fpsLookSensitivityX: 1,
  fpsLookSensitivityY: 1,
  minimap: true,
  damageNumbers: true,
  tileShakeOnHit: true,
  blood: true,
  liveMessageLog: true,
};

export function normalizeNh3dClientOptions(
  overrides?: Partial<Nh3dClientOptions> | null,
): Nh3dClientOptions {
  const rawFpsFov =
    typeof overrides?.fpsFov === "number" && Number.isFinite(overrides.fpsFov)
      ? overrides.fpsFov
      : defaultNh3dClientOptions.fpsFov;
  const fpsFov = Math.round(Math.max(45, Math.min(110, rawFpsFov)));
  const rawFpsLookSensitivityX =
    typeof overrides?.fpsLookSensitivityX === "number" &&
    Number.isFinite(overrides.fpsLookSensitivityX)
      ? overrides.fpsLookSensitivityX
      : defaultNh3dClientOptions.fpsLookSensitivityX;
  const rawFpsLookSensitivityY =
    typeof overrides?.fpsLookSensitivityY === "number" &&
    Number.isFinite(overrides.fpsLookSensitivityY)
      ? overrides.fpsLookSensitivityY
      : defaultNh3dClientOptions.fpsLookSensitivityY;
  const fpsLookSensitivityX = Number(
    Math.max(
      nh3dFpsLookSensitivityMin,
      Math.min(nh3dFpsLookSensitivityMax, rawFpsLookSensitivityX),
    ).toFixed(2),
  );
  const fpsLookSensitivityY = Number(
    Math.max(
      nh3dFpsLookSensitivityMin,
      Math.min(nh3dFpsLookSensitivityMax, rawFpsLookSensitivityY),
    ).toFixed(2),
  );
  return {
    fpsMode:
      typeof overrides?.fpsMode === "boolean"
        ? overrides.fpsMode
        : defaultNh3dClientOptions.fpsMode,
    fpsFov,
    fpsLookSensitivityX,
    fpsLookSensitivityY,
    minimap:
      typeof overrides?.minimap === "boolean"
        ? overrides.minimap
        : defaultNh3dClientOptions.minimap,
    damageNumbers:
      typeof overrides?.damageNumbers === "boolean"
        ? overrides.damageNumbers
        : defaultNh3dClientOptions.damageNumbers,
    tileShakeOnHit:
      typeof overrides?.tileShakeOnHit === "boolean"
        ? overrides.tileShakeOnHit
        : defaultNh3dClientOptions.tileShakeOnHit,
    blood:
      typeof overrides?.blood === "boolean"
        ? overrides.blood
        : defaultNh3dClientOptions.blood,
    liveMessageLog:
      typeof overrides?.liveMessageLog === "boolean"
        ? overrides.liveMessageLog
        : defaultNh3dClientOptions.liveMessageLog,
  };
}

export type CharacterCreationConfig = {
  mode: "random" | "create";
  playMode?: PlayMode;
  runtimeVersion?: NethackRuntimeVersion;
  name?: string;
  role?: string;
  race?: string;
  gender?: string;
  align?: string;
};

export interface Nethack3DEngineUIAdapter {
  setStatus(status: string): void;
  setConnectionStatus(status: string, state: NethackConnectionState): void;
  setLoadingVisible(visible: boolean): void;
  setGameMessages(messages: string[]): void;
  pushFloatingMessage(message: string): void;
  setPlayerStats(stats: PlayerStatsSnapshot): void;
  setQuestion(state: QuestionDialogState | null): void;
  setDirectionQuestion(question: string | null): void;
  setNumberPadModeEnabled(enabled: boolean): void;
  setInfoMenu(state: InfoMenuState | null): void;
  setInventory(state: InventoryDialogState): void;
  setTextInput(state: TextInputRequestState | null): void;
  setExtendedCommands(commands: string[]): void;
  setPositionRequest(text: string | null): void;
  setFpsCrosshairContext(state: FpsCrosshairContextState | null): void;
}

export interface Nethack3DEngineController {
  chooseDirection(directionKey: string): void;
  chooseQuestionChoice(choice: string): void;
  confirmQuestionMenuChoice(): void;
  togglePickupChoice(accelerator: string): void;
  goToPreviousQuestionMenuPage(): void;
  goToNextQuestionMenuPage(): void;
  confirmPickupChoices(): void;
  submitTextInput(text: string): void;
  cancelActivePrompt(): void;
  toggleInventoryDialog(): void;
  runInventoryItemAction(actionId: string, itemAccelerator: string): void;
  dismissFpsCrosshairContextMenu(): void;
  runQuickAction(actionId: string): void;
  runExtendedCommand(commandText: string): void;
  setClientOptions(options: Nh3dClientOptions): void;
  closeInventoryDialog(): void;
  closeInfoMenuDialog(): void;
}

export interface Nethack3DEngineOptions {
  mountElement?: HTMLElement | null;
  uiAdapter?: Nethack3DEngineUIAdapter | null;
  characterCreationConfig?: CharacterCreationConfig;
  clientOptions?: Partial<Nh3dClientOptions>;
  loggingEnabled?: boolean;
}
