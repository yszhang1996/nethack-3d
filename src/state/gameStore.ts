import { create } from "zustand";
import type {
  InfoMenuState,
  InventoryDialogState,
  Nethack3DEngineController,
  NethackConnectionState,
  PlayerStatsSnapshot,
  QuestionDialogState,
} from "../game/ui-types";

export type FloatingMessage = {
  id: number;
  text: string;
};

export const defaultPlayerStats: PlayerStatsSnapshot = {
  name: "Adventurer",
  hp: 10,
  maxHp: 10,
  power: 0,
  maxPower: 0,
  level: 1,
  experience: 0,
  strength: 10,
  dexterity: 10,
  constitution: 10,
  intelligence: 10,
  wisdom: 10,
  charisma: 10,
  armor: 10,
  dungeon: "Dungeons of Doom",
  dlevel: 1,
  gold: 0,
  alignment: "Neutral",
  hunger: "Not Hungry",
  encumbrance: "",
  time: 1,
  score: 0,
};

type GameStore = {
  loadingVisible: boolean;
  statusText: string;
  connectionState: NethackConnectionState;
  connectionText: string;
  gameMessages: string[];
  floatingMessages: FloatingMessage[];
  playerStats: PlayerStatsSnapshot;
  question: QuestionDialogState | null;
  directionQuestion: string | null;
  infoMenu: InfoMenuState | null;
  inventory: InventoryDialogState;
  positionRequest: string | null;
  engineController: Nethack3DEngineController | null;
  nextFloatingMessageId: number;
  setLoadingVisible: (visible: boolean) => void;
  setStatusText: (text: string) => void;
  setConnectionStatus: (
    text: string,
    state: NethackConnectionState,
  ) => void;
  setGameMessages: (messages: string[]) => void;
  pushFloatingMessage: (message: string) => void;
  removeFloatingMessage: (id: number) => void;
  setPlayerStats: (stats: PlayerStatsSnapshot) => void;
  setQuestion: (question: QuestionDialogState | null) => void;
  setDirectionQuestion: (text: string | null) => void;
  setInfoMenu: (menu: InfoMenuState | null) => void;
  setInventory: (inventory: InventoryDialogState) => void;
  setPositionRequest: (text: string | null) => void;
  setEngineController: (controller: Nethack3DEngineController | null) => void;
};

const floatingMessageLifetimeMs = 2200;
const maxFloatingMessages = 12;

export const useGameStore = create<GameStore>((set, get) => ({
  loadingVisible: true,
  statusText: "Starting NetHack...",
  connectionState: "disconnected",
  connectionText: "Disconnected",
  gameMessages: [],
  floatingMessages: [],
  playerStats: { ...defaultPlayerStats },
  question: null,
  directionQuestion: null,
  infoMenu: null,
  inventory: { visible: false, items: [] },
  positionRequest: null,
  engineController: null,
  nextFloatingMessageId: 1,
  setLoadingVisible: (visible) => {
    set({ loadingVisible: visible });
  },
  setStatusText: (text) => {
    set({ statusText: text });
  },
  setConnectionStatus: (text, state) => {
    set({
      connectionText: text,
      connectionState: state,
    });
  },
  setGameMessages: (messages) => {
    set({ gameMessages: messages });
  },
  pushFloatingMessage: (message) => {
    const trimmed = (message || "").replace(/\s+/g, " ").trim();
    if (!trimmed) {
      return;
    }
    const id = get().nextFloatingMessageId;
    set((state) => ({
      nextFloatingMessageId: id + 1,
      floatingMessages: [{ id, text: trimmed }, ...state.floatingMessages].slice(
        0,
        maxFloatingMessages,
      ),
    }));
    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        get().removeFloatingMessage(id);
      }, floatingMessageLifetimeMs);
    }
  },
  removeFloatingMessage: (id) => {
    set((state) => ({
      floatingMessages: state.floatingMessages.filter(
        (entry) => entry.id !== id,
      ),
    }));
  },
  setPlayerStats: (stats) => {
    set({ playerStats: stats });
  },
  setQuestion: (question) => {
    set({ question });
  },
  setDirectionQuestion: (text) => {
    set({ directionQuestion: text });
  },
  setInfoMenu: (menu) => {
    set({ infoMenu: menu });
  },
  setInventory: (inventory) => {
    set({ inventory });
  },
  setPositionRequest: (text) => {
    set({ positionRequest: text });
  },
  setEngineController: (controller) => {
    set({ engineController: controller });
  },
}));
