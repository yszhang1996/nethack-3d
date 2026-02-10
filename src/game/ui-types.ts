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

export type CharacterCreationConfig = {
  mode: "random" | "create";
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
  setInfoMenu(state: InfoMenuState | null): void;
  setInventory(state: InventoryDialogState): void;
  setTextInput(state: TextInputRequestState | null): void;
  setExtendedCommands(commands: string[]): void;
  setPositionRequest(text: string | null): void;
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
  runQuickAction(actionId: string): void;
  runExtendedCommand(commandText: string): void;
  closeInventoryDialog(): void;
  closeInfoMenuDialog(): void;
}

export interface Nethack3DEngineOptions {
  mountElement?: HTMLElement | null;
  uiAdapter?: Nethack3DEngineUIAdapter | null;
  characterCreationConfig?: CharacterCreationConfig;
}
