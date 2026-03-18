import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { createPortal } from "react-dom";
import { Nethack3DEngine } from "../game";
import type {
  CharacterCreationConfig,
  FpsCrosshairContextState,
  Nh3dClientOptions,
  NethackMenuItem,
  PlayerStatsSnapshot,
} from "../game/ui-types";
import {
  nh3dCloseControllerActionWheelEventName,
  nh3dCloseInventoryContextMenuEventName,
  defaultNh3dClientOptions,
  nh3dOpenCharacterSheetEventName,
  nh3dFpsLookSensitivityMax,
  nh3dFpsLookSensitivityMin,
  nh3dToggleControllerActionWheelEventName,
  normalizeNh3dClientOptions,
} from "../game/ui-types";
import {
  createAxisBinding,
  createButtonBinding,
  defaultNh3dControllerBindings,
  formatNh3dControllerBindingLabel,
  nh3dControllerActionSpecsByGroup,
  normalizeNh3dControllerBindings,
  parseNh3dControllerBinding,
  type Nh3dControllerActionId,
  type Nh3dControllerBinding,
  type Nh3dControllerBindings,
} from "../game/controller-bindings";
import { registerDebugHelpers } from "../app";
import { createEngineUiAdapter } from "../state/engineUiAdapter";
import { useGameStore } from "../state/gameStore";
import type { NethackRuntimeVersion } from "../runtime/types";
import {
  createDefaultStartupInitOptionValues,
  sanitizeStartupInitOptionTokens,
  serializeStartupInitOptionTokens,
  type StartupInitOptionValue,
  type StartupInitOptionValues,
} from "../runtime/startup-init-options";
import { GLYPH_CATALOG as GLYPH_CATALOG_367 } from "../game/glyphs/glyph-catalog.367.generated";
import {
  findNh3dTilesetByPath,
  inferNh3dTilesetTileSizeFromAtlasWidth,
  isNh3dTilesetPathAvailable,
  nh3dTilesetAtlasTileColumns,
  getNh3dTilesetCatalog,
  getNh3dUserTilesetPath,
  resolveDefaultNh3dTilesetBackgroundTileId,
  resolveDefaultNh3dTilesetSolidChromaKeyColorHex,
  resolveNh3dTilesetAssetUrl,
  setNh3dUserTilesets,
} from "../game/tilesets";
import {
  deleteStoredUserTileset,
  listStoredUserTilesets,
  saveStoredUserTileset,
  type StoredUserTilesetRecord,
} from "../game/user-tileset-storage";
import {
  loadPersistedNh3dClientOptionsWithMigration,
  loadPersistedNh3dStartupCharacterPreferences,
  loadPersistedNh3dStartupInitOptions,
  persistNh3dClientOptionsToIndexedDb,
  persistNh3dStartupCharacterPreferencesToIndexedDb,
  persistNh3dStartupInitOptionsToIndexedDb,
  type StartupCharacterPreferences,
} from "../storage/client-options-storage";
import { resetNh3dDefaultSoundPackVolumeLevelsToDefaults } from "../audio/sound-pack-storage";
import SoundPackSettings, {
  type SoundPackDialogActions,
} from "./SoundPackSettings";
import { CastSpellMenu, parseCastSpellMenu } from "./modals/cast-menu";
import { useConfirmationDialog } from "./modals/useConfirmationDialog";
import StartupInitOptionsAccordion from "./componenets/StartupInitOptionsAccordion";
import ConfirmationModal from "./modals/ConfirmationModal";
import AnimatedDialog from "./modals/AnimatedDialog";
import {
  normalizeStartupCreateCharacterSelection,
  pickRandomStartupGenderForRole,
  pickRandomStartupRole,
  resolveStartupCreateCharacterOptionSet,
} from "../game/helpers/startup-character-constraints";
import {
  CharacterSheetStatKey,
  parseCharacterSheetInfoMenu,
  resolveCharacterCommandActions,
} from "./modals/character-sheet";
import { parseEnhanceMenu } from "./modals/enhance-menu";

type CoreStatKey =
  | "strength"
  | "dexterity"
  | "constitution"
  | "intelligence"
  | "wisdom"
  | "charisma"
  | "armor";

type CoreStatSnapshot = {
  turn: number;
  playerName: string;
  values: Record<CoreStatKey, number>;
};

type StatusSeverity = "good" | "warning" | "danger";

type PlayerStatusBadge = {
  label: string;
  severity: StatusSeverity;
};

const playerConditionStatusDefinitions: ReadonlyArray<{
  mask: number;
  label: string;
  severity: StatusSeverity;
}> = [
  { mask: 0x00000001, label: "Stone", severity: "danger" },
  { mask: 0x00000002, label: "Slime", severity: "danger" },
  { mask: 0x00000004, label: "Strngl", severity: "danger" },
  { mask: 0x00000008, label: "FoodPois", severity: "danger" },
  { mask: 0x00000010, label: "TermIll", severity: "danger" },
  { mask: 0x00000020, label: "Blind", severity: "warning" },
  { mask: 0x00000040, label: "Deaf", severity: "warning" },
  { mask: 0x00000080, label: "Stun", severity: "warning" },
  { mask: 0x00000100, label: "Conf", severity: "warning" },
  { mask: 0x00000200, label: "Hallu", severity: "warning" },
  { mask: 0x00000400, label: "Lev", severity: "good" },
  { mask: 0x00000800, label: "Fly", severity: "good" },
  { mask: 0x00001000, label: "Ride", severity: "good" },
];

function resolveHungerStatusBadge(
  rawHunger: unknown,
): PlayerStatusBadge | null {
  const label = String(rawHunger || "").trim();
  if (!label) {
    return null;
  }
  const normalized = label.toLowerCase();
  if (normalized === "not hungry" || normalized === "satiated") {
    return { label, severity: "good" };
  }
  if (normalized === "hungry") {
    return { label, severity: "warning" };
  }
  if (
    normalized === "weak" ||
    normalized === "fainting" ||
    normalized === "fainted" ||
    normalized === "starved"
  ) {
    return { label, severity: "danger" };
  }
  return { label, severity: "warning" };
}

function resolveEncumbranceStatusBadge(
  rawEncumbrance: unknown,
): PlayerStatusBadge | null {
  const label = String(rawEncumbrance || "").trim();
  if (!label) {
    return null;
  }
  const normalized = label.toLowerCase();
  if (normalized.includes("unencumbered")) {
    return { label, severity: "good" };
  }
  if (normalized.includes("burdened") || normalized.includes("stressed")) {
    return { label, severity: "warning" };
  }
  if (
    normalized.includes("strained") ||
    normalized.includes("overtaxed") ||
    normalized.includes("overloaded")
  ) {
    return { label, severity: "danger" };
  }
  return { label, severity: "warning" };
}

function resolveConditionStatusBadges(rawMask: unknown): PlayerStatusBadge[] {
  const conditionMask =
    typeof rawMask === "number" && Number.isFinite(rawMask)
      ? Math.trunc(rawMask) >>> 0
      : 0;
  if (conditionMask === 0) {
    return [];
  }
  return playerConditionStatusDefinitions
    .filter((entry) => (conditionMask & entry.mask) !== 0)
    .map((entry) => ({
      label: entry.label,
      severity: entry.severity,
    }));
}

function buildPlayerStatusBadges(
  stats: PlayerStatsSnapshot,
): PlayerStatusBadge[] {
  const badges: PlayerStatusBadge[] = [];
  const seen = new Set<string>();
  const pushUnique = (badge: PlayerStatusBadge | null): void => {
    if (!badge) {
      return;
    }
    const key = badge.label.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    badges.push(badge);
  };

  pushUnique(resolveHungerStatusBadge(stats.hunger));
  pushUnique(resolveEncumbranceStatusBadge(stats.encumbrance));
  for (const badge of resolveConditionStatusBadges(stats.conditionMask)) {
    pushUnique(badge);
  }
  return badges;
}

const trackedCoreStatKeys: CoreStatKey[] = [
  "strength",
  "dexterity",
  "constitution",
  "intelligence",
  "wisdom",
  "charisma",
  "armor",
];

const characterStatDescriptionById: Record<CharacterSheetStatKey, string> = {
  strength: "Affects melee damage, carrying capacity, and forcing actions.",
  dexterity: "Affects hit chance, trap interaction, and defensive agility.",
  constitution: "Affects HP growth and resistance to poison and drain effects.",
  intelligence: "Affects reading and success with many spell-related actions.",
  wisdom: "Affects spell energy growth and spell-casting reliability.",
  charisma: "Affects shop interactions, pet handling, and social outcomes.",
};

const armorClassDescription =
  "Lower is better. Armor Class reduces enemy hit chance against you.";

const maxExperienceLevel = 30;

function getExperienceThresholdForLevel(level: number): number {
  if (!Number.isFinite(level)) {
    return 0;
  }
  const normalizedLevel = Math.trunc(level);
  if (normalizedLevel < 1) {
    return 0;
  }
  if (normalizedLevel < 10) {
    return 10 * (1 << normalizedLevel);
  }
  if (normalizedLevel < 20) {
    return 10000 * (1 << (normalizedLevel - 10));
  }
  return 10000000 * (normalizedLevel - 19);
}

function formatCharacterNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return Math.max(0, Math.trunc(value)).toLocaleString("en-US");
}

const getCoreStatValuesFromSnapshot = (
  stats: PlayerStatsSnapshot,
): Record<CoreStatKey, number> => ({
  strength: Number(stats.strength) || 0,
  dexterity: Number(stats.dexterity) || 0,
  constitution: Number(stats.constitution) || 0,
  intelligence: Number(stats.intelligence) || 0,
  wisdom: Number(stats.wisdom) || 0,
  charisma: Number(stats.charisma) || 0,
  armor: Number(stats.armor) || 0,
});

const getDirectionHelpText = (
  numberPadModeEnabled: boolean,
  controllerEnabled: boolean,
) =>
  numberPadModeEnabled
    ? controllerEnabled
      ? "Click a direction, or use left stick/DPAD to preview and release to confirm. Center circle targets self. Use < or > for stairs. Press ESC to cancel."
      : "Click a direction. Center circle targets self. You can also use numpad (1-4,6-9), arrow keys, <, >, or s. Press ESC to cancel."
    : controllerEnabled
      ? "Click a direction, or use left stick/DPAD to preview and release to confirm. Center circle targets self. Use < or > for stairs. Press ESC to cancel."
      : "Click a direction. Center circle targets self. You can also use hjkl/yubn, arrow keys, <, >, or s. Press ESC to cancel.";

function expandChoiceSpec(spec: string): string[] {
  const normalized = String(spec || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+or\s+/gi, " ")
    .replace(/[,/|]/g, " ")
    .replace(/\s+/g, "")
    .replace(/[\[\]]/g, "");

  if (!normalized) {
    return [];
  }

  const expanded: string[] = [];
  const seen = new Set<string>();
  const addChoice = (value: string): void => {
    if (!value || seen.has(value)) {
      return;
    }
    seen.add(value);
    expanded.push(value);
  };

  const canExpandRange = (start: string, end: string): boolean => {
    const isLower = (value: string) => value >= "a" && value <= "z";
    const isUpper = (value: string) => value >= "A" && value <= "Z";
    const isDigit = (value: string) => value >= "0" && value <= "9";
    return (
      (isLower(start) && isLower(end)) ||
      (isUpper(start) && isUpper(end)) ||
      (isDigit(start) && isDigit(end))
    );
  };

  for (let i = 0; i < normalized.length; i += 1) {
    const current = normalized[i];
    const hasRangeEnd = i + 2 < normalized.length && normalized[i + 1] === "-";

    if (hasRangeEnd) {
      const end = normalized[i + 2];
      if (canExpandRange(current, end)) {
        const startCode = current.charCodeAt(0);
        const endCode = end.charCodeAt(0);
        const step = startCode <= endCode ? 1 : -1;
        for (
          let code = startCode;
          step > 0 ? code <= endCode : code >= endCode;
          code += step
        ) {
          addChoice(String.fromCharCode(code));
        }
        i += 2;
        continue;
      }
    }

    if (current !== "-") {
      addChoice(current);
    }
  }

  return expanded;
}

function parseQuestionChoices(question: string, choices: string): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  const addChoice = (value: string): void => {
    if (!value || seen.has(value)) {
      return;
    }
    seen.add(value);
    merged.push(value);
  };

  for (const choice of expandChoiceSpec(choices)) {
    addChoice(choice);
  }

  const bracketMatch = String(question || "").match(/\[([^\]]+)\]/);
  if (bracketMatch && bracketMatch[1]) {
    for (const choice of expandChoiceSpec(bracketMatch[1])) {
      addChoice(choice);
    }
  }

  return merged;
}

function isYesNoChoicePrompt(parsedChoices: string[]): boolean {
  if (!Array.isArray(parsedChoices) || parsedChoices.length === 0) {
    return false;
  }

  const normalized = parsedChoices
    .map((choice) =>
      String(choice || "")
        .trim()
        .toLowerCase(),
    )
    .filter((choice) => choice.length > 0);
  if (normalized.length === 0) {
    return false;
  }

  // Include common yes/no prompt auxiliaries so we never map these to inventory labels.
  const allowedChoices = new Set(["y", "n", "a", "q", "#", "?"]);
  const hasYes = normalized.includes("y");
  const hasNo = normalized.includes("n");
  const onlySimpleChoices = normalized.every(
    (choice) => choice.length === 1 && allowedChoices.has(choice),
  );
  return hasYes && hasNo && onlySimpleChoices;
}

function normalizeTileIndexCandidate(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.trunc(value);
}

function resolveTileIndexForGlyph(glyph: unknown): number | null {
  if (typeof glyph !== "number" || !Number.isFinite(glyph) || glyph < 0) {
    return null;
  }
  const normalizedGlyph = Math.trunc(glyph);
  const helpers =
    (
      globalThis as {
        nethackGlobal?: {
          helpers?: {
            tileIndexForGlyph?: (glyphValue: number) => unknown;
          };
        };
      }
    ).nethackGlobal?.helpers ?? null;
  const tileIndexForGlyphHelper =
    typeof helpers?.tileIndexForGlyph === "function"
      ? helpers.tileIndexForGlyph
      : null;
  if (!tileIndexForGlyphHelper) {
    return null;
  }
  try {
    return normalizeTileIndexCandidate(
      tileIndexForGlyphHelper(normalizedGlyph),
    );
  } catch {
    return null;
  }
}

function resolveNoGlyphValueFromRuntime(): number | null {
  const glyphConstants =
    (
      globalThis as {
        nethackGlobal?: {
          constants?: {
            GLYPH?: {
              NO_GLYPH?: unknown;
              MAX_GLYPH?: unknown;
            };
          };
        };
      }
    ).nethackGlobal?.constants?.GLYPH ?? null;
  if (!glyphConstants) {
    return null;
  }
  const explicitNoGlyph = normalizeTileIndexCandidate(glyphConstants.NO_GLYPH);
  if (explicitNoGlyph !== null) {
    return explicitNoGlyph;
  }
  return normalizeTileIndexCandidate(glyphConstants.MAX_GLYPH);
}

function isMenuItemTileApplicable(
  item: NethackMenuItem | null | undefined,
): boolean {
  if (!item || item.isCategory) {
    return false;
  }
  if (typeof item.isTileApplicable === "boolean") {
    return item.isTileApplicable;
  }
  const glyphCandidate =
    typeof item.glyphChar === "string" ? item.glyphChar : "";
  if (glyphCandidate.length > 0 && glyphCandidate.trim().length === 0) {
    return false;
  }
  if (typeof item.glyph === "number" && Number.isFinite(item.glyph)) {
    const noGlyphValue = resolveNoGlyphValueFromRuntime();
    if (noGlyphValue !== null && Math.trunc(item.glyph) === noGlyphValue) {
      return false;
    }
  }
  if (normalizeTileIndexCandidate(item.tileIndex) !== null) {
    return true;
  }
  return (
    typeof item.glyph === "number" &&
    Number.isFinite(item.glyph) &&
    item.glyph >= 0
  );
}

function resolveMenuItemTileIndex(
  item: NethackMenuItem | null | undefined,
): number | null {
  if (!isMenuItemTileApplicable(item) || !item) {
    return null;
  }
  const explicitTileIndex = normalizeTileIndexCandidate(item.tileIndex);
  if (explicitTileIndex !== null) {
    return explicitTileIndex;
  }
  if (typeof item.isTileApplicable === "boolean") {
    // Runtime already made a deterministic tile/non-tile decision.
    return null;
  }
  return resolveTileIndexForGlyph(item.glyph);
}

function resolveMenuItemTilePreviewDataUrl(
  item: NethackMenuItem | null | undefined,
): string | null {
  const candidate =
    typeof item?.tilePreviewDataUrl === "string"
      ? item.tilePreviewDataUrl.trim()
      : "";
  return candidate.length > 0 ? candidate : null;
}

function resolveMenuItemFallbackGlyph(
  item: NethackMenuItem | null | undefined,
  fallback = "?",
): string {
  const glyphCandidate =
    typeof item?.glyphChar === "string" ? item.glyphChar : "";
  const glyphCodePoint = glyphCandidate.codePointAt(0);
  if (
    typeof glyphCodePoint === "number" &&
    glyphCodePoint >= 32 &&
    glyphCodePoint !== 127
  ) {
    return glyphCandidate.charAt(0);
  }
  return fallback;
}

function getInventoryItemForQuestionChoice(
  choice: string,
  inventoryItems: NethackMenuItem[],
): NethackMenuItem | null {
  const normalizedChoice = choice.trim();
  if (!normalizedChoice) {
    return null;
  }
  return (
    inventoryItems.find((item) => {
      if (!item || item.isCategory || typeof item.accelerator !== "string") {
        return false;
      }
      return (
        item.accelerator === normalizedChoice ||
        item.accelerator.toLowerCase() === normalizedChoice.toLowerCase()
      );
    }) ?? null
  );
}

function getQuestionChoiceLabel(
  questionText: string,
  choice: string,
  inventoryItems: NethackMenuItem[],
  useInventoryLabels = true,
): string {
  const normalizedChoice = choice.trim();
  if (questionText.includes("Which ring-finger")) {
    if (normalizedChoice === "l") {
      return "l) Left ring-finger";
    }
    if (normalizedChoice === "r") {
      return "r) Right ring-finger";
    }
  }

  if (!normalizedChoice) {
    return choice;
  }
  if (!useInventoryLabels) {
    return normalizedChoice;
  }
  const inventoryItem = getInventoryItemForQuestionChoice(
    normalizedChoice,
    inventoryItems,
  );
  if (!inventoryItem || typeof inventoryItem.text !== "string") {
    return normalizedChoice;
  }
  return `${normalizedChoice}) ${inventoryItem.text.trim()}`;
}

function getMenuSelectionInput(item: NethackMenuItem): string {
  if (typeof item.selectionInput === "string" && item.selectionInput.trim()) {
    return item.selectionInput;
  }
  return typeof item.accelerator === "string" ? item.accelerator : "";
}

function isSelectableQuestionMenuItem(item: NethackMenuItem): boolean {
  if (!item || item.isCategory) {
    return false;
  }
  if (typeof item.isSelectable === "boolean") {
    return item.isSelectable;
  }
  if (typeof item.identifier === "number") {
    return item.identifier !== 0;
  }
  return getMenuSelectionInput(item).trim().length > 0;
}

function isReadOnlyQuestionOptionMenuItem(
  item: NethackMenuItem | null | undefined,
  questionText: string,
): boolean {
  if (!item || item.isCategory || isSelectableQuestionMenuItem(item)) {
    return false;
  }
  const normalizedQuestion = String(questionText || "")
    .trim()
    .toLowerCase();
  if (normalizedQuestion !== "set what options?") {
    return false;
  }
  const menuText = String(item.text || "");
  if (menuText.trim().length === 0) {
    return false;
  }
  // NetHack emits non-modifiable options with indentation and [value] suffix.
  return /^\s{2,}\S.*\[[^\]]+\]\s*$/.test(menuText);
}

type TileAtlasState = {
  loaded: boolean;
  failed: boolean;
  tileSourceSize: number;
  columns: number;
  rows: number;
  tileCount: number;
};

const createDefaultTileAtlasState = (): TileAtlasState => ({
  loaded: false,
  failed: false,
  tileSourceSize: 32,
  columns: 0,
  rows: 0,
  tileCount: 0,
});

type TilePickerEntry = {
  tileId: number;
  glyphLabel: string;
  glyphNumber: number | null;
};

type TilesetTilePickerDialogProps = {
  visible: boolean;
  dialogId: string;
  title: string;
  helperText?: string;
  closeLabel: string;
  selectedTileId: number;
  defaultTileId: number;
  selectedGlyphLabel: string;
  selectedGlyphNumber: number | null;
  showGlyphNumber: boolean;
  statusText: string;
  tileAtlasLoaded: boolean;
  entries: TilePickerEntry[];
  renderTilePreviewImage: (tileId: number) => JSX.Element | null;
  onSelectTile: (tileId: number) => void;
  onResetToDefault: () => void;
  onDone: () => void;
  renderMobileCloseButton: (
    onClick: () => void,
    label: string,
  ) => JSX.Element | null;
};

function TilesetTilePickerDialog({
  visible,
  dialogId,
  title,
  helperText,
  closeLabel,
  selectedTileId,
  defaultTileId,
  selectedGlyphLabel,
  selectedGlyphNumber,
  showGlyphNumber,
  statusText,
  tileAtlasLoaded,
  entries,
  renderTilePreviewImage,
  onSelectTile,
  onResetToDefault,
  onDone,
  renderMobileCloseButton,
}: TilesetTilePickerDialogProps): JSX.Element | null {
  if (!visible) {
    return null;
  }

  return (
    <div
      className="nh3d-dialog nh3d-dialog-options nh3d-dialog-fixed-actions nh3d-dialog-has-mobile-close is-visible nh3d-dialog-tile-picker"
      id={dialogId}
    >
      {renderMobileCloseButton(onDone, closeLabel)}
      <div className="nh3d-options-title">{title}</div>
      {helperText ? (
        <div className="nh3d-option-description">{helperText}</div>
      ) : null}
      <div className="nh3d-dark-wall-picker-selected">
        <span className="nh3d-dark-wall-picker-selected-preview">
          {renderTilePreviewImage(selectedTileId)}
        </span>
        <div className="nh3d-dark-wall-picker-selected-copy">
          <div className="nh3d-option-label">
            Selected: tile #{selectedTileId}
            {selectedTileId === defaultTileId ? " (default)" : ""}
          </div>
          <div className="nh3d-option-description">
            Glyph {selectedGlyphLabel}
            {showGlyphNumber && typeof selectedGlyphNumber === "number"
              ? ` (${selectedGlyphNumber})`
              : ""}
          </div>
        </div>
      </div>
      {!tileAtlasLoaded ? (
        <div className="nh3d-dark-wall-picker-status">{statusText}</div>
      ) : (
        <div className="nh3d-overflow-glow-frame">
          <div
            className="nh3d-dark-wall-tile-grid"
            data-nh3d-overflow-glow
            data-nh3d-overflow-glow-host="parent"
          >
            {entries.map((entry) => {
              const isSelected = entry.tileId === selectedTileId;
              const isDefault = entry.tileId === defaultTileId;
              return (
                <button
                  className={`nh3d-dark-wall-tile-card${
                    isSelected ? " is-selected" : ""
                  }${isDefault ? " is-default" : ""}`}
                  key={entry.tileId}
                  onClick={() => onSelectTile(entry.tileId)}
                  type="button"
                >
                  <span className="nh3d-dark-wall-tile-card-preview">
                    {renderTilePreviewImage(entry.tileId)}
                  </span>
                  <span className="nh3d-dark-wall-tile-card-glyph">
                    Glyph {entry.glyphLabel}
                    {showGlyphNumber && typeof entry.glyphNumber === "number"
                      ? ` (${entry.glyphNumber})`
                      : ""}
                  </span>
                  <span className="nh3d-dark-wall-tile-card-id">
                    Tile {entry.tileId}
                  </span>
                  {isDefault ? (
                    <span className="nh3d-dark-wall-tile-card-default">
                      Default
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="nh3d-menu-actions">
        <button
          className="nh3d-menu-action-button"
          disabled={selectedTileId === defaultTileId}
          onClick={onResetToDefault}
          type="button"
        >
          Reset to default
        </button>
        <button
          className="nh3d-menu-action-button nh3d-menu-action-confirm"
          onClick={onDone}
          type="button"
        >
          Done
        </button>
      </div>
    </div>
  );
}

type TilesetSolidColorPickerDialogProps = {
  visible: boolean;
  dialogId: string;
  title: string;
  closeLabel: string;
  selectedColorHex: string;
  statusText: string;
  tileAtlasLoaded: boolean;
  tileSourceSize: number;
  atlasWidthPx: number;
  atlasImage: HTMLImageElement | null;
  onSelectColorHex: (hexValue: string) => void;
  onDone: () => void;
  renderMobileCloseButton: (
    onClick: () => void,
    label: string,
  ) => JSX.Element | null;
};

type SolidColorPickerHoverState = {
  clientX: number;
  clientY: number;
  sourceX: number;
  sourceY: number;
  hexColor: string;
};

const defaultSolidChromaKeyHex = "#466d6c";

function normalizeSolidChromaKeyHex(
  rawValue: string,
  fallback: string = defaultSolidChromaKeyHex,
): string {
  const normalized = String(rawValue || "").trim();
  const match = normalized.match(/^#?([0-9a-fA-F]{6})$/);
  if (!match) {
    return fallback;
  }
  return `#${match[1].toLowerCase()}`;
}

function formatSolidChromaKeyHex(rawValue: string): string {
  return normalizeSolidChromaKeyHex(rawValue).toUpperCase();
}

function rgbToSolidChromaKeyHex(r: number, g: number, b: number): string {
  const toHex = (value: number) =>
    Math.max(0, Math.min(255, Math.trunc(value)))
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function TilesetSolidColorPickerDialog({
  visible,
  dialogId,
  title,
  closeLabel,
  selectedColorHex,
  statusText,
  tileAtlasLoaded,
  tileSourceSize,
  atlasWidthPx,
  atlasImage,
  onSelectColorHex,
  onDone,
  renderMobileCloseButton,
}: TilesetSolidColorPickerDialogProps): JSX.Element | null {
  const atlasCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const zoomCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceWidthRef = useRef(0);
  const sourceHeightRef = useRef(0);
  const sourcePixelsRef = useRef<Uint8ClampedArray | null>(null);
  const [displayScale, setDisplayScale] = useState(1);
  const [hoverState, setHoverState] =
    useState<SolidColorPickerHoverState | null>(null);

  useEffect(() => {
    if (!visible || !tileAtlasLoaded || !atlasImage) {
      sourceCanvasRef.current = null;
      sourceWidthRef.current = 0;
      sourceHeightRef.current = 0;
      sourcePixelsRef.current = null;
      setHoverState(null);
      return;
    }

    const naturalWidth = Math.max(0, Math.trunc(atlasImage.naturalWidth));
    const configuredWidth = Math.max(0, Math.trunc(atlasWidthPx));
    const sourceWidth =
      configuredWidth > 0
        ? Math.min(naturalWidth, configuredWidth)
        : naturalWidth;
    const sourceHeight = Math.max(0, Math.trunc(atlasImage.naturalHeight));
    if (sourceWidth <= 0 || sourceHeight <= 0) {
      sourceCanvasRef.current = null;
      sourceWidthRef.current = 0;
      sourceHeightRef.current = 0;
      sourcePixelsRef.current = null;
      setHoverState(null);
      return;
    }

    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = sourceWidth;
    sourceCanvas.height = sourceHeight;
    const sourceContext = sourceCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    if (!sourceContext) {
      sourceCanvasRef.current = null;
      sourceWidthRef.current = 0;
      sourceHeightRef.current = 0;
      sourcePixelsRef.current = null;
      setHoverState(null);
      return;
    }
    sourceContext.imageSmoothingEnabled = false;
    sourceContext.clearRect(0, 0, sourceWidth, sourceHeight);
    sourceContext.drawImage(
      atlasImage,
      0,
      0,
      sourceWidth,
      sourceHeight,
      0,
      0,
      sourceWidth,
      sourceHeight,
    );
    sourceCanvasRef.current = sourceCanvas;
    sourceWidthRef.current = sourceWidth;
    sourceHeightRef.current = sourceHeight;
    sourcePixelsRef.current = sourceContext.getImageData(
      0,
      0,
      sourceWidth,
      sourceHeight,
    ).data;

    const preferredScale =
      tileSourceSize <= 24
        ? 3.5
        : tileSourceSize <= 32
          ? 2.75
          : tileSourceSize <= 48
            ? 2
            : 1.6;
    const maxUpscaledDimension = 3200;
    const maxAllowedScale = Math.min(
      maxUpscaledDimension / sourceWidth,
      maxUpscaledDimension / sourceHeight,
    );
    const nextScale = Number(
      Math.max(1, Math.min(preferredScale, maxAllowedScale)).toFixed(2),
    );
    setDisplayScale(nextScale);

    const atlasCanvas = atlasCanvasRef.current;
    if (atlasCanvas) {
      const displayWidth = Math.max(1, Math.trunc(sourceWidth * nextScale));
      const displayHeight = Math.max(1, Math.trunc(sourceHeight * nextScale));
      atlasCanvas.width = displayWidth;
      atlasCanvas.height = displayHeight;
      const atlasContext = atlasCanvas.getContext("2d");
      if (atlasContext) {
        atlasContext.imageSmoothingEnabled = false;
        atlasContext.clearRect(0, 0, displayWidth, displayHeight);
        atlasContext.drawImage(
          sourceCanvas,
          0,
          0,
          sourceWidth,
          sourceHeight,
          0,
          0,
          displayWidth,
          displayHeight,
        );
      }
    }

    setHoverState(null);
  }, [atlasImage, atlasWidthPx, tileAtlasLoaded, tileSourceSize, visible]);

  const drawZoomPreview = (sourceX: number, sourceY: number): void => {
    const sourceCanvas = sourceCanvasRef.current;
    const zoomCanvas = zoomCanvasRef.current;
    const sourceWidth = sourceWidthRef.current;
    const sourceHeight = sourceHeightRef.current;
    if (!sourceCanvas || !zoomCanvas || sourceWidth <= 0 || sourceHeight <= 0) {
      return;
    }
    const zoomContext = zoomCanvas.getContext("2d");
    if (!zoomContext) {
      return;
    }
    const sampleSize = 15;
    const half = Math.floor(sampleSize / 2);
    const maxStartX = Math.max(0, sourceWidth - sampleSize);
    const maxStartY = Math.max(0, sourceHeight - sampleSize);
    const startX = Math.max(0, Math.min(maxStartX, sourceX - half));
    const startY = Math.max(0, Math.min(maxStartY, sourceY - half));
    const localX = sourceX - startX;
    const localY = sourceY - startY;
    zoomContext.clearRect(0, 0, zoomCanvas.width, zoomCanvas.height);
    zoomContext.imageSmoothingEnabled = false;
    zoomContext.drawImage(
      sourceCanvas,
      startX,
      startY,
      sampleSize,
      sampleSize,
      0,
      0,
      zoomCanvas.width,
      zoomCanvas.height,
    );
    const crossX = ((localX + 0.5) / sampleSize) * zoomCanvas.width;
    const crossY = ((localY + 0.5) / sampleSize) * zoomCanvas.height;
    zoomContext.strokeStyle = "rgba(255, 255, 255, 0.92)";
    zoomContext.lineWidth = 1;
    zoomContext.beginPath();
    zoomContext.moveTo(crossX, 0);
    zoomContext.lineTo(crossX, zoomCanvas.height);
    zoomContext.moveTo(0, crossY);
    zoomContext.lineTo(zoomCanvas.width, crossY);
    zoomContext.stroke();
  };

  useEffect(() => {
    if (!hoverState) {
      return;
    }
    drawZoomPreview(hoverState.sourceX, hoverState.sourceY);
  }, [hoverState]);

  const sampleSolidColorFromCanvasPoint = (
    canvasX: number,
    canvasY: number,
  ): { sourceX: number; sourceY: number; hexColor: string } | null => {
    const sourcePixels = sourcePixelsRef.current;
    const sourceWidth = sourceWidthRef.current;
    const sourceHeight = sourceHeightRef.current;
    if (
      !sourcePixels ||
      sourceWidth <= 0 ||
      sourceHeight <= 0 ||
      !Number.isFinite(canvasX) ||
      !Number.isFinite(canvasY)
    ) {
      return null;
    }
    const safeScale = Math.max(0.001, displayScale);
    const sourceX = Math.max(
      0,
      Math.min(sourceWidth - 1, Math.floor(canvasX / safeScale)),
    );
    const sourceY = Math.max(
      0,
      Math.min(sourceHeight - 1, Math.floor(canvasY / safeScale)),
    );
    const pixelIndex = (sourceY * sourceWidth + sourceX) * 4;
    const r = sourcePixels[pixelIndex];
    const g = sourcePixels[pixelIndex + 1];
    const b = sourcePixels[pixelIndex + 2];
    return {
      sourceX,
      sourceY,
      hexColor: rgbToSolidChromaKeyHex(r, g, b),
    };
  };

  const handleAtlasMouseMove = (
    event: ReactMouseEvent<HTMLCanvasElement>,
  ): void => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      setHoverState(null);
      return;
    }
    const normalizedX = (event.clientX - rect.left) / rect.width;
    const normalizedY = (event.clientY - rect.top) / rect.height;
    const canvasX = Math.max(
      0,
      Math.min(canvas.width - 1, normalizedX * canvas.width),
    );
    const canvasY = Math.max(
      0,
      Math.min(canvas.height - 1, normalizedY * canvas.height),
    );
    const sample = sampleSolidColorFromCanvasPoint(canvasX, canvasY);
    if (!sample) {
      setHoverState(null);
      return;
    }
    drawZoomPreview(sample.sourceX, sample.sourceY);
    setHoverState({
      clientX: event.clientX,
      clientY: event.clientY,
      sourceX: sample.sourceX,
      sourceY: sample.sourceY,
      hexColor: sample.hexColor,
    });
  };

  const handleAtlasClick = (
    event: ReactMouseEvent<HTMLCanvasElement>,
  ): void => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const normalizedX = (event.clientX - rect.left) / rect.width;
    const normalizedY = (event.clientY - rect.top) / rect.height;
    const canvasX = Math.max(
      0,
      Math.min(canvas.width - 1, normalizedX * canvas.width),
    );
    const canvasY = Math.max(
      0,
      Math.min(canvas.height - 1, normalizedY * canvas.height),
    );
    const sample = sampleSolidColorFromCanvasPoint(canvasX, canvasY);
    if (!sample) {
      return;
    }
    onSelectColorHex(sample.hexColor);
  };

  const hoverTooltipStyle: CSSProperties | undefined = useMemo(() => {
    if (!hoverState || typeof window === "undefined") {
      return undefined;
    }
    const tooltipWidth = 190;
    const tooltipHeight = 160;
    const left = Math.max(
      8,
      Math.min(window.innerWidth - tooltipWidth - 8, hoverState.clientX + 18),
    );
    const top = Math.max(
      8,
      Math.min(window.innerHeight - tooltipHeight - 8, hoverState.clientY + 18),
    );
    return {
      left,
      top,
    };
  }, [hoverState]);
  const hoverTooltip =
    hoverState && hoverTooltipStyle ? (
      <div className="nh3d-solid-chroma-picker-hover" style={hoverTooltipStyle}>
        <canvas
          className="nh3d-solid-chroma-picker-hover-zoom"
          height={112}
          ref={zoomCanvasRef}
          width={112}
        />
        <div className="nh3d-solid-chroma-picker-hover-copy">
          <div className="nh3d-solid-chroma-picker-hover-hex">
            {formatSolidChromaKeyHex(hoverState.hexColor)}
          </div>
          <div
            className="nh3d-solid-chroma-picker-hover-color"
            style={{
              backgroundColor: normalizeSolidChromaKeyHex(hoverState.hexColor),
            }}
          />
        </div>
      </div>
    ) : null;

  if (!visible) {
    return null;
  }

  return (
    <div
      className="nh3d-dialog nh3d-dialog-options nh3d-dialog-fixed-actions nh3d-dialog-has-mobile-close is-visible nh3d-dialog-tile-picker nh3d-dialog-solid-chroma-picker"
      id={dialogId}
    >
      {renderMobileCloseButton(onDone, closeLabel)}
      <div className="nh3d-options-title">{title}</div>
      <div className="nh3d-dark-wall-picker-selected">
        <span
          aria-hidden="true"
          className="nh3d-solid-chroma-selected-color-preview"
          style={{
            backgroundColor: normalizeSolidChromaKeyHex(selectedColorHex),
          }}
        />
        <div className="nh3d-dark-wall-picker-selected-copy">
          <div className="nh3d-option-label">
            Selected color: {formatSolidChromaKeyHex(selectedColorHex)}
          </div>
          <div className="nh3d-option-description">
            Move over the full atlas and click a pixel to set the solid chroma
            key color.
          </div>
        </div>
      </div>
      {!tileAtlasLoaded ? (
        <div className="nh3d-dark-wall-picker-status">{statusText}</div>
      ) : (
        <div className="nh3d-overflow-glow-frame">
          <div
            className="nh3d-solid-chroma-picker-atlas-shell"
            data-nh3d-overflow-glow
            data-nh3d-overflow-glow-host="parent"
          >
            <canvas
              className="nh3d-solid-chroma-picker-atlas-canvas"
              onClick={handleAtlasClick}
              onMouseLeave={() => setHoverState(null)}
              onMouseMove={handleAtlasMouseMove}
              ref={atlasCanvasRef}
            />
          </div>
        </div>
      )}
      {typeof document !== "undefined" && hoverTooltip
        ? createPortal(hoverTooltip, document.body)
        : hoverTooltip}
      <div className="nh3d-menu-actions">
        <button
          className="nh3d-menu-action-button nh3d-menu-action-confirm"
          onClick={onDone}
          type="button"
        >
          Done
        </button>
      </div>
    </div>
  );
}

function glyphCodePointToChar(codePoint: unknown): string | null {
  if (
    typeof codePoint !== "number" ||
    !Number.isInteger(codePoint) ||
    codePoint < 0 ||
    codePoint > 0x10ffff
  ) {
    return null;
  }
  return String.fromCodePoint(codePoint);
}

function formatTileGlyphLabel(glyphChar: string): string {
  if (glyphChar === " ") {
    return "space";
  }
  const codePoint = glyphChar.codePointAt(0);
  if (typeof codePoint === "number" && (codePoint < 32 || codePoint === 127)) {
    return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
  }
  return `'${glyphChar}'`;
}

function buildRepresentativeGlyphByTileId(
  glyphCatalog: ReadonlyArray<{
    tileIndex: number;
    ch?: number;
    ttychar?: number;
  }>,
): Map<number, string> {
  const representativeByTile = new Map<number, string>();
  for (const entry of glyphCatalog) {
    const tileId = Math.trunc(entry.tileIndex);
    if (!Number.isFinite(tileId) || tileId < 0) {
      continue;
    }
    const candidate =
      glyphCodePointToChar(entry.ch) ?? glyphCodePointToChar(entry.ttychar);
    if (!candidate || candidate.length === 0) {
      continue;
    }
    const glyphChar = candidate.charAt(0);
    const existing = representativeByTile.get(tileId);
    if (!existing) {
      representativeByTile.set(tileId, glyphChar);
      continue;
    }
    if (existing.trim().length === 0 && glyphChar.trim().length > 0) {
      representativeByTile.set(tileId, glyphChar);
    }
  }
  return representativeByTile;
}

function buildRepresentativeGlyphNumberByTileId(
  glyphCatalog: ReadonlyArray<{
    glyph?: number;
    tileIndex: number;
    ch?: number;
    ttychar?: number;
  }>,
): Map<number, number> {
  const representativeByTile = new Map<
    number,
    { glyphChar: string; glyph: number }
  >();
  for (const entry of glyphCatalog) {
    const tileId = Math.trunc(entry.tileIndex);
    if (!Number.isFinite(tileId) || tileId < 0) {
      continue;
    }
    const candidate =
      glyphCodePointToChar(entry.ch) ?? glyphCodePointToChar(entry.ttychar);
    if (!candidate || candidate.length === 0) {
      continue;
    }
    const glyph = Math.trunc(Number(entry.glyph));
    if (!Number.isFinite(glyph) || glyph < 0) {
      continue;
    }
    const glyphChar = candidate.charAt(0);
    const existing = representativeByTile.get(tileId);
    if (!existing) {
      representativeByTile.set(tileId, { glyphChar, glyph });
      continue;
    }
    if (existing.glyphChar.trim().length === 0 && glyphChar.trim().length > 0) {
      representativeByTile.set(tileId, { glyphChar, glyph });
    }
  }
  const glyphByTileId = new Map<number, number>();
  for (const [tileId, entry] of representativeByTile.entries()) {
    glyphByTileId.set(tileId, entry.glyph);
  }
  return glyphByTileId;
}

function createIsolatedAtlasTilePreviewDataUrl(
  atlasImage: HTMLImageElement,
  tileId: number,
  tileSourceSize: number,
  tileColumns: number,
  tileRows: number,
  backgroundRemoval?: {
    enabled: boolean;
    mode: "tile" | "solid";
    solidChromaKeyColorHex: string;
    backgroundTilePixels: Uint8ClampedArray | null;
  },
): string | null {
  if (
    typeof document === "undefined" ||
    !atlasImage ||
    tileSourceSize <= 0 ||
    !Number.isFinite(tileId)
  ) {
    return null;
  }
  const tilesPerRow = Math.max(0, Math.trunc(tileColumns));
  const rows = Math.max(0, Math.trunc(tileRows));
  const tileCount = tilesPerRow > 0 && rows > 0 ? tilesPerRow * rows : 0;
  const safeTileId = Math.trunc(tileId);
  if (tileCount <= 0 || safeTileId < 0 || safeTileId >= tileCount) {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = tileSourceSize;
  canvas.height = tileSourceSize;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  const sx = (safeTileId % tilesPerRow) * tileSourceSize;
  const sy = Math.floor(safeTileId / tilesPerRow) * tileSourceSize;
  context.clearRect(0, 0, tileSourceSize, tileSourceSize);
  context.drawImage(
    atlasImage,
    sx,
    sy,
    tileSourceSize,
    tileSourceSize,
    0,
    0,
    tileSourceSize,
    tileSourceSize,
  );

  if (backgroundRemoval?.enabled) {
    const imageData = context.getImageData(
      0,
      0,
      tileSourceSize,
      tileSourceSize,
    );
    const data = imageData.data;
    if (backgroundRemoval.mode === "solid") {
      const match = String(backgroundRemoval.solidChromaKeyColorHex || "")
        .trim()
        .match(/^#?([0-9a-fA-F]{6})$/);
      if (match) {
        const hex = match[1];
        const targetR = Number.parseInt(hex.slice(0, 2), 16);
        const targetG = Number.parseInt(hex.slice(2, 4), 16);
        const targetB = Number.parseInt(hex.slice(4, 6), 16);
        for (let i = 0; i < data.length; i += 4) {
          if (
            data[i] === targetR &&
            data[i + 1] === targetG &&
            data[i + 2] === targetB
          ) {
            data[i + 3] = 0;
          }
        }
      }
    } else if (backgroundRemoval.backgroundTilePixels) {
      const alphaSoftMin = 12;
      const alphaSoftMax = 40;
      const backgroundPixels = backgroundRemoval.backgroundTilePixels;
      for (let i = 0; i < data.length; i += 4) {
        const sourceAlpha = data[i + 3];
        if (sourceAlpha === 0) {
          continue;
        }
        const deltaR = Math.abs(data[i] - backgroundPixels[i]);
        const deltaG = Math.abs(data[i + 1] - backgroundPixels[i + 1]);
        const deltaB = Math.abs(data[i + 2] - backgroundPixels[i + 2]);
        const delta = Math.max(deltaR, deltaG, deltaB);
        const visibility = Math.max(
          0,
          Math.min(1, (delta - alphaSoftMin) / (alphaSoftMax - alphaSoftMin)),
        );
        const nextAlpha = Math.round(sourceAlpha * visibility);
        data[i + 3] = nextAlpha;
        if (nextAlpha === 0) {
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
        }
      }
    }
    context.putImageData(imageData, 0, 0);
  }

  return canvas.toDataURL("image/png");
}

function getAtlasTilePixels(
  atlasImage: HTMLImageElement,
  tileSourceSize: number,
  tileId: number,
  tileColumns: number,
  tileRows: number,
): Uint8ClampedArray | null {
  if (
    typeof document === "undefined" ||
    !atlasImage ||
    tileSourceSize <= 0 ||
    !Number.isFinite(tileId)
  ) {
    return null;
  }
  const tilesPerRow = Math.max(0, Math.trunc(tileColumns));
  const rows = Math.max(0, Math.trunc(tileRows));
  const tileCount = tilesPerRow > 0 && rows > 0 ? tilesPerRow * rows : 0;
  const safeTileId = Math.trunc(tileId);
  if (tileCount <= 0 || safeTileId < 0 || safeTileId >= tileCount) {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = tileSourceSize;
  canvas.height = tileSourceSize;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return null;
  }

  const sx = (safeTileId % tilesPerRow) * tileSourceSize;
  const sy = Math.floor(safeTileId / tilesPerRow) * tileSourceSize;
  context.clearRect(0, 0, tileSourceSize, tileSourceSize);
  context.drawImage(
    atlasImage,
    sx,
    sy,
    tileSourceSize,
    tileSourceSize,
    0,
    0,
    tileSourceSize,
    tileSourceSize,
  );
  return context.getImageData(0, 0, tileSourceSize, tileSourceSize).data;
}

type StartupFlowStep = "choose" | "create" | "random" | "resume";
const startupDefaultCharacterName = "Web_user";

function createDefaultStartupCharacterPreferences(): StartupCharacterPreferences {
  const defaultCreateSelection = normalizeStartupCreateCharacterSelection({});
  return {
    randomName: startupDefaultCharacterName,
    createName: startupDefaultCharacterName,
    createRole: defaultCreateSelection.role,
    createRace: defaultCreateSelection.race,
    createGender: defaultCreateSelection.gender,
    createAlign: defaultCreateSelection.align,
  };
}

type MobileActionEntry = {
  id: string;
  label: string;
  kind: "quick" | "extended";
  value: string;
};
type ControllerActionWheelEntry = MobileActionEntry & {
  index: number;
  angleDeg: number;
  clipPath: string;
  labelXPercent: number;
  labelYPercent: number;
};
type MobileActionSheetMode = "quick" | "extended";
type InventoryContextAction = {
  id: string;
  label: string;
  kind?: "quick" | "extended";
  value?: string;
  armInventorySelection?: boolean;
};
type InventoryContextMenuState = {
  accelerator: string;
  itemText: string;
  x: number;
  y: number;
  anchorBottomY?: number;
  anchorRightX?: number;
};
type InventoryRowPressCandidate = {
  source: "pointer" | "touch";
  pointerId: number;
  accelerator: string;
  item: NethackMenuItem;
  rowElement: HTMLDivElement | null;
  startClientX: number;
  startClientY: number;
  startedAtMs: number;
};
type TilesetBackgroundRemovalMode =
  Nh3dClientOptions["tilesetBackgroundRemovalMode"];
type ClientOptionToggle = {
  key: ClientOptionToggleKey;
  label: string;
  description: string;
  type: "boolean";
  developerOnly?: boolean;
};

type ClientOptionSelect = {
  key:
    | "tilesetMode"
    | "tilesetPath"
    | "antialiasing"
    | "inventoryFixedTileSize"
    | "desktopTouchInterfaceMode";
  label: string;
  description: string;
  type: "select";
  disabled?: boolean;
  developerOnly?: boolean;
  options: {
    value: string;
    label: string;
  }[];
};

type ClientOptionSlider = {
  key:
    | "brightness"
    | "contrast"
    | "gamma"
    | "minimapScale"
    | "uiFontScale"
    | "liveMessageLogFontScale"
    | "controllerFpsMoveRepeatMs"
    | "fpsFov"
    | "fpsLookSensitivityX"
    | "fpsLookSensitivityY"
    | "liveMessageDisplayTimeMs"
    | "liveMessageFadeOutTimeMs";
  label: string;
  description: string;
  type: "slider";
  min: number;
  max: number;
  step: number;
  developerOnly?: boolean;
};

type ClientOptionGroupHeader = {
  key: string;
  label: string;
  type: "group";
  developerOnly?: boolean;
};

type ClientOption =
  | ClientOptionGroupHeader
  | ClientOptionToggle
  | ClientOptionSelect
  | ClientOptionSlider;

type ClientOptionsTabId =
  | "display"
  | "mobile"
  | "controls"
  | "sound"
  | "combat"
  | "compatibility";

type ClientOptionsTab = {
  id: ClientOptionsTabId;
  label: string;
  description: string;
  groupKey: string;
};

type ClientOptionToggleKey =
  | "fpsMode"
  | "controllerEnabled"
  | "invertLookYAxis"
  | "cameraRelativeMovement"
  | "snapCameraYawToNearest45"
  | "invertTouchPanningDirection"
  | "disableAnimatedTransitions"
  | "uiTileBackgroundRemoval"
  | "minimap"
  | "reduceInventoryMotion"
  | "inventoryTileOnlyMotion"
  | "damageNumbers"
  | "displayStatChangesAbovePlayer"
  | "displayXpGainsAbovePlayer"
  | "tileShakeOnHit"
  | "blood"
  | "monsterShatter"
  | "monsterShatterBloodBorders"
  | "liveMessageLog"
  | "soundEnabled"
  | "blockAmbientOcclusion"
  | "darkCorridorWalls367"
  | "darkCorridorWallTileOverrideEnabled"
  | "darkCorridorWallSolidColorOverrideEnabled";

type ClientOptionLookSensitivityKey =
  | "fpsLookSensitivityX"
  | "fpsLookSensitivityY";

type ControllerRemapSlotIndex = 0 | 1;

type ControllerRemapListeningState = {
  actionId: Nh3dControllerActionId;
  slotIndex: ControllerRemapSlotIndex;
  startedAtMs: number;
  blockedBindings: Nh3dControllerBinding[];
};

type InventoryCategoryId =
  | "illegal_objects"
  | "weapons"
  | "armor"
  | "rings"
  | "amulets"
  | "tools"
  | "comestibles"
  | "potions"
  | "scrolls"
  | "spellbooks"
  | "wands"
  | "coins"
  | "gems_stones"
  | "boulders_statues"
  | "iron_balls"
  | "chains"
  | "venoms"
  | "bagged_boxed_items";

const inventoryContextActions: InventoryContextAction[] = [
  { id: "apply", label: "Apply" },
  { id: "invoke", label: "Invoke", kind: "extended", value: "invoke" },
  { id: "tip", label: "Tip", kind: "extended", value: "tip" },
  {
    id: "loot",
    label: "Loot",
    kind: "extended",
    value: "loot",
    armInventorySelection: false,
  },
  { id: "drop", label: "Drop" },
  { id: "eat", label: "Eat" },
  { id: "quaff", label: "Quaff" },
  { id: "read", label: "Read" },
  { id: "rub", label: "Rub", kind: "extended", value: "rub" },
  { id: "throw", label: "Throw" },
  { id: "wield", label: "Wield" },
  { id: "quiver", label: "Quiver" },
  { id: "wear", label: "Wear" },
  { id: "take-off", label: "Take Off" },
  { id: "put-on", label: "Put On" },
  { id: "remove", label: "Remove" },
  { id: "zap", label: "Zap" },
  {
    id: "untrap",
    label: "Untrap",
    kind: "extended",
    value: "untrap",
    armInventorySelection: false,
  },
  {
    id: "offer",
    label: "Offer",
    kind: "extended",
    value: "offer",
    armInventorySelection: false,
  },
  {
    id: "name",
    label: "Name",
    kind: "extended",
    value: "name",
  },
  {
    id: "call",
    label: "Call",
    kind: "extended",
    value: "call",
    armInventorySelection: false,
  },
  { id: "adjust", label: "Adjust", kind: "extended", value: "adjust" },
  { id: "engrave", label: "Engrave", kind: "extended", value: "engrave" },
  { id: "dip", label: "Dip", kind: "extended", value: "dip" },
  { id: "info", label: "Info" },
];

const emptyInventoryActionIdSet: ReadonlySet<string> = new Set<string>();

const inventoryCategoryActionBlocklist: Record<
  InventoryCategoryId,
  ReadonlySet<string>
> = {
  illegal_objects: new Set([
    "quaff",
    "wear",
    "take-off",
    "put-on",
    "remove",
    "zap",
    "engrave",
  ]),
  weapons: new Set(["quaff", "wear", "take-off", "put-on", "remove", "zap"]),
  armor: new Set(["quaff", "put-on", "remove", "zap"]),
  rings: new Set(["quaff", "wear", "take-off", "zap"]),
  amulets: new Set(["quaff", "wear", "take-off", "zap"]),
  tools: new Set(["quaff", "wear", "take-off", "zap"]),
  comestibles: new Set([
    "quaff",
    "wear",
    "take-off",
    "put-on",
    "remove",
    "zap",
  ]),
  potions: new Set(["wear", "take-off", "put-on", "remove", "zap", "engrave"]),
  scrolls: new Set([
    "quaff",
    "wear",
    "take-off",
    "put-on",
    "remove",
    "zap",
    "engrave",
  ]),
  spellbooks: new Set([
    "quaff",
    "wear",
    "take-off",
    "put-on",
    "remove",
    "zap",
    "engrave",
  ]),
  wands: new Set(["quaff", "wear", "take-off", "put-on", "remove"]),
  coins: new Set([
    "quaff",
    "wear",
    "take-off",
    "put-on",
    "remove",
    "zap",
    "engrave",
  ]),
  gems_stones: new Set([
    "quaff",
    "wear",
    "take-off",
    "put-on",
    "remove",
    "zap",
  ]),
  boulders_statues: new Set([
    "quaff",
    "wear",
    "take-off",
    "put-on",
    "remove",
    "zap",
    "engrave",
  ]),
  iron_balls: new Set([
    "quaff",
    "wear",
    "take-off",
    "put-on",
    "remove",
    "zap",
    "engrave",
  ]),
  chains: new Set([
    "quaff",
    "wear",
    "take-off",
    "put-on",
    "remove",
    "zap",
    "engrave",
  ]),
  venoms: new Set(["wear", "take-off", "put-on", "remove", "zap"]),
  // Mixed contents; keep this category permissive.
  bagged_boxed_items: emptyInventoryActionIdSet,
};

function normalizeInventoryCategoryLabel(raw: unknown): string {
  return String(raw || "")
    .replace(/[\s:]+$/g, "")
    .trim();
}

function classifyInventoryCategory(
  categoryLabel: string,
): InventoryCategoryId | null {
  const normalized =
    normalizeInventoryCategoryLabel(categoryLabel).toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized.includes("illegal object")) {
    return "illegal_objects";
  }
  if (normalized.startsWith("weapon")) {
    return "weapons";
  }
  if (normalized.startsWith("armor")) {
    return "armor";
  }
  if (normalized.startsWith("ring")) {
    return "rings";
  }
  if (normalized.startsWith("amulet")) {
    return "amulets";
  }
  if (normalized.startsWith("tool")) {
    return "tools";
  }
  if (normalized.startsWith("comestible")) {
    return "comestibles";
  }
  if (normalized.startsWith("potion")) {
    return "potions";
  }
  if (normalized.startsWith("scroll")) {
    return "scrolls";
  }
  if (normalized.startsWith("spellbook")) {
    return "spellbooks";
  }
  if (normalized.startsWith("wand")) {
    return "wands";
  }
  if (normalized.startsWith("coin")) {
    return "coins";
  }
  if (normalized.includes("gem") || normalized.includes("stone")) {
    return "gems_stones";
  }
  if (normalized.includes("boulder") || normalized.includes("statue")) {
    return "boulders_statues";
  }
  if (normalized.includes("iron ball")) {
    return "iron_balls";
  }
  if (normalized.includes("chain")) {
    return "chains";
  }
  if (normalized.includes("venom")) {
    return "venoms";
  }
  if (normalized.includes("bagged") || normalized.includes("boxed")) {
    return "bagged_boxed_items";
  }
  return null;
}

function getBlockedInventoryActionIdsForCategory(
  categoryLabel: string,
): ReadonlySet<string> {
  const categoryId = classifyInventoryCategory(categoryLabel);
  if (!categoryId) {
    return emptyInventoryActionIdSet;
  }
  return (
    inventoryCategoryActionBlocklist[categoryId] ?? emptyInventoryActionIdSet
  );
}

// NetHack 3.6.7 #rub accepts:
// - TOOL_CLASS: oil lamp, magic lamp, brass lantern
// - GEM_CLASS: graystones (luckstone/loadstone/touchstone/flint, including "gray stone")
function inventoryItemSupportsRub(
  categoryId: InventoryCategoryId | null,
  itemText: string,
): boolean {
  const normalizedText = String(itemText || "")
    .trim()
    .toLowerCase();
  if (!normalizedText) {
    return false;
  }

  const isLampOrLantern =
    /\b(?:oil lamp|magic lamp|brass lantern|lamp|lantern)s?\b/i.test(
      normalizedText,
    );
  const isGraystone =
    /\b(?:gray stone(?:s)?|luckstone(?:s)?|loadstone(?:s)?|touchstone(?:s)?|flint(?: stones?)?)\b/i.test(
      normalizedText,
    );

  if (categoryId === "tools") {
    return isLampOrLantern;
  }
  if (categoryId === "gems_stones") {
    return isGraystone;
  }
  if (categoryId === "bagged_boxed_items" || !categoryId) {
    return isLampOrLantern || isGraystone;
  }
  return false;
}

function inventoryItemLooksLikeContainer(itemText: string): boolean {
  return /\b(?:sack|bag|box|chest|ice box|large box|bag of holding|oilskin sack)s?\b/i.test(
    itemText,
  );
}

function inventoryItemSupportsTip(
  categoryId: InventoryCategoryId | null,
  itemText: string,
): boolean {
  const normalizedText = String(itemText || "")
    .trim()
    .toLowerCase();
  if (!normalizedText) {
    return false;
  }

  const isHornOfPlenty = /\bhorn of plenty\b/i.test(normalizedText);
  if (isHornOfPlenty) {
    return true;
  }

  if (categoryId === "tools" || categoryId === "bagged_boxed_items") {
    return inventoryItemLooksLikeContainer(normalizedText);
  }
  return false;
}

function inventoryItemSupportsLoot(
  categoryId: InventoryCategoryId | null,
  itemText: string,
): boolean {
  if (categoryId !== "tools" && categoryId !== "bagged_boxed_items") {
    return false;
  }
  return inventoryItemLooksLikeContainer(String(itemText || "").toLowerCase());
}

function inventoryItemSupportsUntrap(itemText: string): boolean {
  const normalizedText = String(itemText || "")
    .trim()
    .toLowerCase();
  if (!normalizedText) {
    return false;
  }
  return /\b(?:can of grease|potion(?:s)? of oil)\b/i.test(normalizedText);
}

function inventoryItemSupportsOffer(itemText: string): boolean {
  const normalizedText = String(itemText || "")
    .trim()
    .toLowerCase();
  if (!normalizedText) {
    return false;
  }
  return /\b(?:corpse|(?:fake )?amulet of yendor)\b/i.test(normalizedText);
}

function inventoryItemSupportsInvoke(
  categoryId: InventoryCategoryId | null,
  itemText: string,
): boolean {
  const normalizedText = String(itemText || "")
    .trim()
    .toLowerCase();
  if (!normalizedText) {
    return false;
  }

  if (
    /\b(?:crystal ball|magic lamp|oil lamp|brass lantern|mirror|bell of opening|candelabrum of invocation|book of the dead|(?:fake )?amulet of yendor)\b/i.test(
      normalizedText,
    )
  ) {
    return true;
  }

  return (
    categoryId === "weapons" ||
    categoryId === "armor" ||
    categoryId === "rings" ||
    categoryId === "amulets" ||
    categoryId === "tools" ||
    categoryId === "spellbooks"
  );
}

function inventoryItemSupportsCall(
  categoryId: InventoryCategoryId | null,
): boolean {
  return (
    categoryId === "scrolls" ||
    categoryId === "potions" ||
    categoryId === "wands" ||
    categoryId === "rings" ||
    categoryId === "amulets" ||
    categoryId === "gems_stones" ||
    categoryId === "spellbooks" ||
    categoryId === "armor" ||
    categoryId === "tools"
  );
}

function inventoryItemSupportsContextAction(
  actionId: string,
  categoryId: InventoryCategoryId | null,
  itemText: string,
): boolean {
  switch (actionId) {
    case "rub":
      return inventoryItemSupportsRub(categoryId, itemText);
    case "tip":
      return inventoryItemSupportsTip(categoryId, itemText);
    case "loot":
      return inventoryItemSupportsLoot(categoryId, itemText);
    case "invoke":
      return inventoryItemSupportsInvoke(categoryId, itemText);
    case "offer":
      return inventoryItemSupportsOffer(itemText);
    case "untrap":
      return inventoryItemSupportsUntrap(itemText);
    case "call":
      return inventoryItemSupportsCall(categoryId);
    case "name":
    case "adjust":
      return true;
    default:
      return true;
  }
}

const mobileDefaultFpsLookSensitivity = 1.35;
const nh3dClientOptionsStorageKey = "nh3d-client-options:v1";
const controllerCaptureButtonThreshold = 0.7;
const controllerCaptureAxisThreshold = 0.72;
const controllerCaptureIgnoreDurationMs = 150;
const startupControllerActionThreshold = 0.5;
const startupControllerScrollSpeedPxPerSec = 1150;
const startupControllerCursorDeadzone = 0.2;
const startupControllerCursorSpeedPxPerSec = 820;
const startupControllerSliderFastStepsPerSec = 13;
const controllerActionGroupOrder: Array<
  keyof typeof nh3dControllerActionSpecsByGroup
> = ["Movement", "Look And Camera", "Actions", "Dialogs", "System"];
const startupControllerNavActionIds: readonly Nh3dControllerActionId[] = [
  "dpad_up",
  "dpad_down",
  "dpad_left",
  "dpad_right",
  "left_stick_up",
  "left_stick_down",
  "left_stick_left",
  "left_stick_right",
  "right_stick_up",
  "right_stick_down",
  "confirm",
  "cancel_or_context",
];

function getConnectedGamepadsForCapture(): Gamepad[] {
  if (typeof navigator === "undefined" || !navigator.getGamepads) {
    return [];
  }
  const gamepads = navigator.getGamepads();
  if (!gamepads || gamepads.length === 0) {
    return [];
  }
  const connected: Gamepad[] = [];
  for (const gamepad of gamepads) {
    if (gamepad && gamepad.connected) {
      connected.push(gamepad);
    }
  }
  return connected;
}

function sampleActiveControllerBindingCandidates(
  buttonThreshold: number = controllerCaptureButtonThreshold,
  axisThreshold: number = controllerCaptureAxisThreshold,
): Nh3dControllerBinding[] {
  const gamepads = getConnectedGamepadsForCapture();
  if (gamepads.length === 0) {
    return [];
  }
  const maxMagnitudeByBinding = new Map<Nh3dControllerBinding, number>();
  for (const gamepad of gamepads) {
    const buttons = Array.isArray(gamepad.buttons) ? gamepad.buttons : [];
    for (let buttonIndex = 0; buttonIndex < buttons.length; buttonIndex += 1) {
      const button = buttons[buttonIndex];
      if (!button) {
        continue;
      }
      const rawValue = button.pressed ? 1 : button.value;
      const value =
        typeof rawValue === "number" && Number.isFinite(rawValue)
          ? Math.max(0, Math.min(1, rawValue))
          : 0;
      if (value < buttonThreshold) {
        continue;
      }
      const binding = createButtonBinding(buttonIndex);
      const previousMagnitude = maxMagnitudeByBinding.get(binding) ?? 0;
      if (value > previousMagnitude) {
        maxMagnitudeByBinding.set(binding, value);
      }
    }

    const axes = Array.isArray(gamepad.axes) ? gamepad.axes : [];
    for (let axisIndex = 0; axisIndex < axes.length; axisIndex += 1) {
      const rawAxisValue = axes[axisIndex];
      if (!Number.isFinite(rawAxisValue)) {
        continue;
      }
      const magnitude = Math.abs(rawAxisValue);
      if (magnitude < axisThreshold) {
        continue;
      }
      const direction: -1 | 1 = rawAxisValue < 0 ? -1 : 1;
      const binding = createAxisBinding(axisIndex, direction);
      const previousMagnitude = maxMagnitudeByBinding.get(binding) ?? 0;
      if (magnitude > previousMagnitude) {
        maxMagnitudeByBinding.set(binding, magnitude);
      }
    }
  }
  return [...maxMagnitudeByBinding.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    })
    .map(([binding]) => binding);
}

function getControllerBindingValueFromGamepad(
  gamepad: Gamepad,
  binding: Nh3dControllerBinding | null | undefined,
  axisDeadzone: number = 0.35,
): number {
  if (!binding) {
    return 0;
  }
  const parsedBinding = parseNh3dControllerBinding(binding);
  if (!parsedBinding) {
    return 0;
  }
  if (parsedBinding.kind === "button") {
    const button = gamepad.buttons[parsedBinding.index];
    if (!button) {
      return 0;
    }
    const rawButtonValue = button.pressed ? 1 : button.value;
    if (!Number.isFinite(rawButtonValue)) {
      return 0;
    }
    return Math.max(0, Math.min(1, rawButtonValue));
  }
  const rawAxisValue = gamepad.axes[parsedBinding.index];
  if (!Number.isFinite(rawAxisValue)) {
    return 0;
  }
  const directionalValue = rawAxisValue * parsedBinding.direction;
  if (directionalValue <= axisDeadzone) {
    return 0;
  }
  const normalizedValue =
    (directionalValue - axisDeadzone) / (1 - axisDeadzone);
  return Math.max(0, Math.min(1, normalizedValue));
}

function getControllerActionValueFromGamepads(
  actionId: Nh3dControllerActionId,
  bindings: Nh3dControllerBindings,
  gamepads: readonly Gamepad[],
): number {
  const slots = bindings[actionId];
  if (!slots) {
    return 0;
  }
  let maxValue = 0;
  for (const gamepad of gamepads) {
    const firstValue = getControllerBindingValueFromGamepad(gamepad, slots[0]);
    const secondValue = getControllerBindingValueFromGamepad(gamepad, slots[1]);
    maxValue = Math.max(maxValue, firstValue, secondValue);
    if (maxValue >= 1) {
      return 1;
    }
  }
  return Math.max(0, Math.min(1, maxValue));
}

function getTopVisibleControllerDialogElement(): HTMLElement | null {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      ".nh3d-dialog.is-visible, #position-dialog.is-visible",
    ),
  );
  if (candidates.length === 0) {
    return null;
  }
  let best = candidates[0];
  let bestZIndex =
    Number.parseInt(window.getComputedStyle(best).zIndex, 10) || 0;
  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const zIndex =
      Number.parseInt(window.getComputedStyle(candidate).zIndex, 10) || 0;
    if (zIndex > bestZIndex || (zIndex === bestZIndex && index > 0)) {
      best = candidate;
      bestZIndex = zIndex;
    }
  }
  return best;
}

function getControllerFocusableElements(root: HTMLElement): HTMLElement[] {
  const selector = [
    "button:not(:disabled)",
    "summary",
    "a[href]",
    "input:not(:disabled)",
    "select:not(:disabled)",
    "textarea:not(:disabled)",
    '[role="button"][tabindex]:not([tabindex="-1"])',
    "[tabindex]:not([tabindex='-1'])",
  ].join(", ");
  const elements = Array.from(root.querySelectorAll<HTMLElement>(selector));
  return elements.filter((element) => {
    if (!element.isConnected) {
      return false;
    }
    let current: HTMLElement | null = element;
    while (current && current !== root) {
      const parentElement: HTMLElement | null = current.parentElement;
      if (parentElement instanceof HTMLDetailsElement && !parentElement.open) {
        const isSummaryOfClosedDetails =
          current.tagName === "SUMMARY" &&
          current.parentElement === parentElement;
        if (!isSummaryOfClosedDetails) {
          return false;
        }
      }
      current = parentElement;
    }
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    return element.getClientRects().length > 0;
  });
}

function isControllerScrollableElement(element: HTMLElement): boolean {
  if (element.scrollHeight <= element.clientHeight + 2) {
    return false;
  }
  const style = window.getComputedStyle(element);
  return (
    style.overflowY === "auto" ||
    style.overflowY === "scroll" ||
    style.overflowY === "overlay"
  );
}

function findNearestControllerScrollableAncestor(
  element: HTMLElement,
  boundary: HTMLElement,
): HTMLElement | null {
  let current: HTMLElement | null = element;
  while (current && current !== boundary) {
    if (isControllerScrollableElement(current)) {
      return current;
    }
    current = current.parentElement;
  }
  if (isControllerScrollableElement(boundary)) {
    return boundary;
  }
  return null;
}

function getControllerDialogFixedActionButtons(
  dialogRoot: HTMLElement,
): HTMLElement[] {
  const selector = [
    ".nh3d-menu-actions button:not(:disabled)",
    ".nh3d-pickup-actions button:not(:disabled)",
    ".nh3d-menu-actions [role='button'][tabindex]:not([tabindex='-1'])",
    ".nh3d-pickup-actions [role='button'][tabindex]:not([tabindex='-1'])",
  ].join(", ");
  const candidates = Array.from(
    dialogRoot.querySelectorAll<HTMLElement>(selector),
  );
  return candidates.filter((candidate) => {
    if (!candidate.isConnected) {
      return false;
    }
    const style = window.getComputedStyle(candidate);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    return candidate.getClientRects().length > 0;
  });
}

function focusControllerDialogElement(target: HTMLElement): void {
  target.focus();
  target.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function findDirectionalControllerFocusTarget(
  source: HTMLElement,
  candidates: readonly HTMLElement[],
  direction: "left" | "right",
): HTMLElement | null {
  const sourceRect = source.getBoundingClientRect();
  const sourceCenterX = sourceRect.left + sourceRect.width * 0.5;
  const sourceCenterY = sourceRect.top + sourceRect.height * 0.5;
  const minHorizontalDelta = 8;
  let bestTarget: HTMLElement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (candidate === source) {
      continue;
    }
    const rect = candidate.getBoundingClientRect();
    const centerX = rect.left + rect.width * 0.5;
    const centerY = rect.top + rect.height * 0.5;
    const dx = centerX - sourceCenterX;
    if (direction === "right" && dx <= minHorizontalDelta) {
      continue;
    }
    if (direction === "left" && dx >= -minHorizontalDelta) {
      continue;
    }
    const horizontalDistance = Math.abs(dx);
    const verticalDistance = Math.abs(centerY - sourceCenterY);
    const score = horizontalDistance + verticalDistance * 2;
    if (score < bestScore) {
      bestScore = score;
      bestTarget = candidate;
    }
  }

  return bestTarget;
}

function moveClientOptionsDialogFocus(
  dialogRoot: HTMLElement,
  activeElement: HTMLElement,
  direction: "up" | "down" | "left" | "right",
): boolean {
  if (direction !== "left" && direction !== "right") {
    return false;
  }
  if (dialogRoot.id !== "nh3d-client-options-dialog") {
    return false;
  }

  const nav = dialogRoot.querySelector<HTMLElement>(".nh3d-options-nav");
  const panel = dialogRoot.querySelector<HTMLElement>(".nh3d-options-panel");
  if (!nav || !panel) {
    return false;
  }

  const navTabs = getControllerFocusableElements(nav).filter((element) =>
    element.classList.contains("nh3d-options-tab"),
  );
  const panelFocusable = getControllerFocusableElements(panel).filter(
    (element) =>
      !element.classList.contains("nh3d-mobile-dialog-close") &&
      !element.closest(".nh3d-options-panel-heading"),
  );
  if (navTabs.length === 0 || panelFocusable.length === 0) {
    return false;
  }

  if (direction === "right" && nav.contains(activeElement)) {
    const target =
      findDirectionalControllerFocusTarget(
        activeElement,
        panelFocusable,
        "right",
      ) ?? panelFocusable[0];
    if (!target) {
      return false;
    }
    focusControllerDialogElement(target);
    return true;
  }

  if (direction === "left" && panel.contains(activeElement)) {
    const leftTarget = findDirectionalControllerFocusTarget(
      activeElement,
      panelFocusable,
      "left",
    );
    if (leftTarget) {
      focusControllerDialogElement(leftTarget);
      return true;
    }
    const selectedTab =
      nav.querySelector<HTMLElement>(".nh3d-options-tab.is-selected") ??
      navTabs[0];
    if (!selectedTab) {
      return false;
    }
    focusControllerDialogElement(selectedTab);
    return true;
  }

  return false;
}

function moveControllerDialogFocus(
  direction: "up" | "down" | "left" | "right",
): boolean {
  const topDialog = getTopVisibleControllerDialogElement();
  if (!topDialog) {
    return false;
  }
  const focusable = getControllerFocusableElements(topDialog);
  if (focusable.length === 0) {
    return false;
  }
  const activeElement =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  const activeInDialog =
    activeElement && topDialog.contains(activeElement) ? activeElement : null;
  if (
    activeInDialog &&
    moveClientOptionsDialogFocus(topDialog, activeInDialog, direction)
  ) {
    return true;
  }
  const fixedActionButtons = getControllerDialogFixedActionButtons(topDialog);
  const activeIsFixedAction =
    !!activeInDialog &&
    fixedActionButtons.some((button) => button === activeInDialog);

  if (
    activeIsFixedAction &&
    (direction === "left" || direction === "right") &&
    fixedActionButtons.length > 0
  ) {
    const activeFixedIndex = activeInDialog
      ? fixedActionButtons.findIndex((button) => button === activeInDialog)
      : -1;
    const fixedDelta = direction === "left" ? -1 : 1;
    const targetFixedIndex =
      activeFixedIndex < 0
        ? fixedDelta > 0
          ? 0
          : fixedActionButtons.length - 1
        : (((activeFixedIndex + fixedDelta) % fixedActionButtons.length) +
            fixedActionButtons.length) %
          fixedActionButtons.length;
    const targetFixedButton = fixedActionButtons[targetFixedIndex];
    if (targetFixedButton) {
      focusControllerDialogElement(targetFixedButton);
      return true;
    }
  }

  if (
    (direction === "down" || direction === "right") &&
    activeInDialog &&
    !activeIsFixedAction &&
    fixedActionButtons.length > 0
  ) {
    const nearestScrollable = findNearestControllerScrollableAncestor(
      activeInDialog,
      topDialog,
    );
    const atScrollableEnd =
      !!nearestScrollable &&
      nearestScrollable.scrollTop + nearestScrollable.clientHeight >=
        nearestScrollable.scrollHeight - 2;
    const atLastScrollableFocusable =
      !!nearestScrollable &&
      (() => {
        const scrollableFocusable = getControllerFocusableElements(
          nearestScrollable,
        ).filter(
          (element) => !fixedActionButtons.some((button) => button === element),
        );
        if (scrollableFocusable.length === 0) {
          return false;
        }
        return (
          scrollableFocusable[scrollableFocusable.length - 1] === activeInDialog
        );
      })();
    if (atScrollableEnd && atLastScrollableFocusable) {
      const targetButton = fixedActionButtons[0];
      focusControllerDialogElement(targetButton);
      return true;
    }
  }

  if (direction === "up" && activeIsFixedAction) {
    const topScrollable = findControllerScrollableElement(topDialog);
    if (topScrollable) {
      const scrollableFocusable = getControllerFocusableElements(
        topScrollable,
      ).filter(
        (element) => !fixedActionButtons.some((button) => button === element),
      );
      const fallbackTarget =
        scrollableFocusable[scrollableFocusable.length - 1] ??
        focusable[focusable.length - 1];
      if (fallbackTarget) {
        focusControllerDialogElement(fallbackTarget);
        return true;
      }
    }
  }

  const activeIndex = activeInDialog ? focusable.indexOf(activeInDialog) : -1;
  const delta = direction === "up" || direction === "left" ? -1 : 1;
  let nextIndex: number;
  if (activeIndex < 0) {
    nextIndex = delta > 0 ? 0 : focusable.length - 1;
  } else {
    nextIndex =
      (((activeIndex + delta) % focusable.length) + focusable.length) %
      focusable.length;
  }
  const nextElement = focusable[nextIndex];
  if (nextElement) {
    focusControllerDialogElement(nextElement);
  }
  return true;
}

function clickFocusedControllerDialogElement(): HTMLElement | null {
  const activeElement =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  if (activeElement && typeof activeElement.click === "function") {
    activeElement.click();
    return activeElement;
  }
  const topDialog = getTopVisibleControllerDialogElement();
  if (!topDialog) {
    return null;
  }
  const focusable = getControllerFocusableElements(topDialog);
  const first = focusable[0];
  if (!first) {
    return null;
  }
  first.focus();
  first.scrollIntoView({ block: "nearest", inline: "nearest" });
  first.click();
  return first;
}

function clickControllerDialogElementAtPoint(
  clientX: number,
  clientY: number,
): HTMLElement | null {
  const target = document.elementFromPoint(clientX, clientY);
  if (!(target instanceof HTMLElement)) {
    return null;
  }
  const clickableSelector = [
    "button",
    "summary",
    "[role='button']",
    "a",
    "input",
    "select",
    "textarea",
    "label",
    "[tabindex]",
  ].join(", ");
  const clickable = target.closest(clickableSelector) ?? target;
  if (!(clickable instanceof HTMLElement)) {
    return null;
  }
  clickable.focus();
  clickable.scrollIntoView({ block: "nearest", inline: "nearest" });
  clickable.click();
  return clickable;
}

function getFocusedControllerRangeInput(
  dialogRoot: HTMLElement | null,
): HTMLInputElement | null {
  if (!dialogRoot) {
    return null;
  }
  const activeElement =
    document.activeElement instanceof HTMLInputElement
      ? document.activeElement
      : null;
  if (!activeElement || !dialogRoot.contains(activeElement)) {
    return null;
  }
  if (activeElement.type !== "range" || activeElement.disabled) {
    return null;
  }
  return activeElement;
}

function stepControllerRangeInput(
  slider: HTMLInputElement,
  stepCount: number,
): boolean {
  if (!Number.isFinite(stepCount) || stepCount === 0 || slider.disabled) {
    return false;
  }
  const minValue = Number.parseFloat(slider.min);
  const maxValue = Number.parseFloat(slider.max);
  const min = Number.isFinite(minValue) ? minValue : 0;
  const max = Number.isFinite(maxValue) ? maxValue : 100;
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  const stepValue = Number.parseFloat(slider.step);
  const step = Number.isFinite(stepValue) && stepValue > 0 ? stepValue : 1;
  const currentValue = Number.parseFloat(slider.value);
  const current = Number.isFinite(currentValue) ? currentValue : low;
  const normalizedStepCount =
    stepCount > 0 ? Math.floor(stepCount) : Math.ceil(stepCount);
  if (normalizedStepCount === 0) {
    return false;
  }
  const currentIndex = Math.round((current - low) / step);
  const nextValue = Math.max(
    low,
    Math.min(high, low + (currentIndex + normalizedStepCount) * step),
  );
  if (Math.abs(nextValue - current) < step * 0.001) {
    return false;
  }
  slider.value = String(nextValue);
  slider.dispatchEvent(new Event("input", { bubbles: true }));
  slider.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function maintainControllerDialogFocusAfterKeyboardScroll(
  scrollElement: HTMLElement,
  direction: "up" | "down",
): void {
  const activeElement =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  if (!activeElement || !scrollElement.contains(activeElement)) {
    return;
  }

  const activeRect = activeElement.getBoundingClientRect();
  const scrollRect = scrollElement.getBoundingClientRect();
  const isVisibleInScrollFrame =
    activeRect.bottom > scrollRect.top + 2 &&
    activeRect.top < scrollRect.bottom - 2;
  if (isVisibleInScrollFrame) {
    return;
  }

  const focusableInScrollElement =
    getControllerFocusableElements(scrollElement);
  if (focusableInScrollElement.length === 0) {
    return;
  }

  const visibleFocusable = focusableInScrollElement.filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.bottom > scrollRect.top + 2 && rect.top < scrollRect.bottom - 2;
  });
  if (visibleFocusable.length === 0) {
    return;
  }

  const targetElement =
    direction === "down"
      ? visibleFocusable[0]
      : visibleFocusable[visibleFocusable.length - 1];
  if (targetElement && targetElement !== activeElement) {
    focusControllerDialogElement(targetElement);
  }
}

function handleControllerDialogKeyboardScrollKey(
  dialogRoot: HTMLElement,
  key: string,
): boolean {
  if (
    key !== "Home" &&
    key !== "End" &&
    key !== "PageUp" &&
    key !== "PageDown"
  ) {
    return false;
  }

  const activeElement =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  let scrollElement: HTMLElement | null = null;
  if (activeElement && dialogRoot.contains(activeElement)) {
    scrollElement = findNearestControllerScrollableAncestor(
      activeElement,
      dialogRoot,
    );
  }
  if (!scrollElement) {
    scrollElement = findControllerScrollableElement(dialogRoot);
  }
  if (!scrollElement) {
    return false;
  }

  const direction: "up" | "down" =
    key === "Home" || key === "PageUp" ? "up" : "down";
  if (key === "Home") {
    scrollElement.scrollTop = 0;
  } else if (key === "End") {
    scrollElement.scrollTop = scrollElement.scrollHeight;
  } else {
    const pageDeltaPx = Math.max(
      96,
      Math.round(scrollElement.clientHeight * 0.9),
    );
    const scrollDelta = direction === "down" ? pageDeltaPx : -pageDeltaPx;
    scrollElement.scrollTop += scrollDelta;
  }

  maintainControllerDialogFocusAfterKeyboardScroll(scrollElement, direction);
  return true;
}

function findControllerScrollableElement(
  root: HTMLElement | null,
): HTMLElement | null {
  if (!root) {
    return null;
  }
  if (isControllerScrollableElement(root)) {
    return root;
  }
  const descendants = Array.from(root.querySelectorAll<HTMLElement>("*"));
  for (const descendant of descendants) {
    if (isControllerScrollableElement(descendant)) {
      return descendant;
    }
  }
  return null;
}

const clientOptionsConfig: ClientOption[] = [
  {
    key: "group-controls",
    label: "Controller and first-person mode",
    type: "group",
  },
  {
    key: "controllerEnabled",
    label: "Enable controller support",
    description: "Enable gamepad input for gameplay and UI dialogs.",
    type: "boolean",
  },
  {
    key: "controllerFpsMoveRepeatMs",
    label: "FPS left-stick move repeat",
    description:
      "Movement repeat delay for left stick in FPS mode (lower is faster).",
    type: "slider",
    min: 80,
    max: 900,
    step: 10,
  },
  {
    key: "invertLookYAxis",
    label: "Invert Y-axis look",
    description: "Invert vertical mouselook and touch-look direction.",
    type: "boolean",
  },
  {
    key: "cameraRelativeMovement",
    label: "Camera-relative movement and swipes",
    description:
      "Rotate movement keys and swipe directions based on the camera Y-axis angle.",
    type: "boolean",
  },
  {
    key: "snapCameraYawToNearest45",
    label: "Snap camera yaw to 45 degrees",
    description:
      "When camera rotation input is released, smoothly snap yaw to the nearest 45 degree angle.",
    type: "boolean",
  },
  {
    key: "fpsLookSensitivityX",
    label: "FPS Look Sensitivity X",
    description: "Horizontal mouselook/touch-look sensitivity.",
    type: "slider",
    min: nh3dFpsLookSensitivityMin,
    max: nh3dFpsLookSensitivityMax,
    step: 0.01,
  },
  {
    key: "fpsLookSensitivityY",
    label: "FPS Look Sensitivity Y",
    description: "Vertical mouselook/touch-look sensitivity.",
    type: "slider",
    min: nh3dFpsLookSensitivityMin,
    max: nh3dFpsLookSensitivityMax,
    step: 0.01,
  },
  {
    key: "group-interface",
    label: "Interface",
    type: "group",
  },
  {
    key: "fpsMode",
    label: "First-person mode",
    description: "Use first-person controls and mouselook.",
    type: "boolean",
  },
  {
    key: "fpsFov",
    label: "FPS Field of View",
    description: "Adjust first-person camera FOV.",
    type: "slider",
    min: 45,
    max: 110,
    step: 1,
  },
  {
    key: "uiFontScale",
    label: "UI font scale",
    description: "Scale all game UI font sizes from their defaults.",
    type: "slider",
    min: 0.7,
    max: 1.8,
    step: 0.01,
  },
  {
    key: "tilesetMode",
    label: "Display",
    description: "Use graphical tiles instead of ASCII.",
    type: "select",
    options: [
      { value: "ascii", label: "ASCII" },
      { value: "tiles", label: "Tiles" },
    ],
  },
  {
    key: "tilesetPath",
    label: "Tileset",
    description: "Built-in and uploaded tilesets.",
    type: "select",
    options: [],
    disabled: false,
  },
  {
    key: "desktopTouchInterfaceMode",
    label: "Desktop touch interface",
    description:
      "Show touch controls on desktop and choose portrait or landscape layout.",
    type: "select",
    options: [
      { value: "off", label: "Off" },
      { value: "portrait", label: "Use portrait touch UI" },
      { value: "landscape", label: "Use landscape touch UI" },
    ],
  },
  {
    key: "disableAnimatedTransitions",
    label: "Disable animated transitions",
    description:
      "Turn off interface fade, motion, and transition animations for snappier UI changes.",
    type: "boolean",
  },
  {
    key: "uiTileBackgroundRemoval",
    label: "Remove tile backgrounds in UI",
    description:
      "Apply tile/chroma background removal to tile icons shown in UI panels.",
    type: "boolean",
  },
  {
    key: "antialiasing",
    label: "Antialiasing",
    description: "Edge smoothing mode for 3D rendering.",
    type: "select",
    options: [
      { value: "taa", label: "TAA" },
      { value: "fxaa", label: "FXAA" },
    ],
  },
  {
    key: "blockAmbientOcclusion",
    label: "Ambient occlusion",
    description: "Adds subtle contact shadowing between floor and wall blocks.",
    type: "boolean",
  },
  {
    key: "brightness",
    label: "Brightness",
    description: "Adjust overall scene brightness.",
    type: "slider",
    min: -0.25,
    max: 0.25,
    step: 0.01,
  },
  {
    key: "contrast",
    label: "Contrast",
    description: "Adjust global contrast of rendered scene content.",
    type: "slider",
    min: -0.25,
    max: 0.25,
    step: 0.01,
  },
  {
    key: "gamma",
    label: "Gamma",
    description: "Adjust display gamma for rendered scene content.",
    type: "slider",
    min: 0.5,
    max: 2.5,
    step: 0.01,
  },
  {
    key: "minimap",
    label: "Minimap",
    description: "Show or hide the dungeon minimap.",
    type: "boolean",
  },
  {
    key: "minimapScale",
    label: "Minimap scale",
    description: "Scale the minimap size from its default.",
    type: "slider",
    min: 0.6,
    max: 2.2,
    step: 0.01,
  },
  {
    key: "reduceInventoryMotion",
    label: "Reduce inventory motion",
    description:
      "Disable animated inventory row expansion and use simpler interactions.",
    type: "boolean",
  },
  {
    key: "inventoryTileOnlyMotion",
    label: "Animate inventory tiles only",
    description:
      "Animate icon tiles while keeping inventory row height and spacing fixed.",
    type: "boolean",
  },
  {
    key: "inventoryFixedTileSize",
    label: "Fixed inventory tile size",
    description:
      "Applies only when Reduce inventory motion is enabled. Choose a fixed icon size.",
    type: "select",
    options: [
      { value: "none", label: "None" },
      { value: "small", label: "Small" },
      { value: "medium", label: "Medium" },
      { value: "large", label: "Large" },
    ],
  },
  {
    key: "liveMessageLog",
    label: "Live message log",
    description: "Display the scrolling in-game message log.",
    type: "boolean",
  },
  {
    key: "liveMessageLogFontScale",
    label: "Live message font scale",
    description:
      "Scale the fade-up floating action messages from their default size.",
    type: "slider",
    min: 0.7,
    max: 2.2,
    step: 0.01,
  },
  {
    key: "liveMessageDisplayTimeMs",
    label: "Live message display time",
    description: "Time a floating message stays fully visible before fading.",
    type: "slider",
    min: 250,
    max: 6000,
    step: 50,
  },
  {
    key: "liveMessageFadeOutTimeMs",
    label: "Live message fade-out time",
    description: "Duration of floating message fade-out animation.",
    type: "slider",
    min: 120,
    max: 4000,
    step: 20,
  },
  {
    key: "group-sound",
    label: "Sound",
    type: "group",
  },
  {
    key: "soundEnabled",
    label: "Enable sound",
    description:
      "Turn FMOD audio on or off. Disabling reduces audio processing overhead on lower-end devices.",
    type: "boolean",
  },
  {
    key: "group-mobile-controls",
    label: "Mobile controls",
    type: "group",
  },
  {
    key: "invertTouchPanningDirection",
    label: "Invert touch panning direction",
    description:
      "Reverse drag direction for touch panning after hold-to-pan starts.",
    type: "boolean",
  },
  {
    key: "group-combat",
    label: "Combat feedback",
    type: "group",
  },
  {
    key: "damageNumbers",
    label: "Damage numbers",
    description: "Show floating damage and healing numbers.",
    type: "boolean",
  },
  {
    key: "displayStatChangesAbovePlayer",
    label: "Display stat changes above player",
    description:
      "Show floating labels for stat changes such as Strength and AC.",
    type: "boolean",
  },
  {
    key: "displayXpGainsAbovePlayer",
    label: "Display XP gains above player",
    description: "Show floating XP gain labels when experience increases.",
    type: "boolean",
  },
  {
    key: "tileShakeOnHit",
    label: "Tile shake on hit",
    description: "Shake impact tiles when combat lands.",
    type: "boolean",
  },
  {
    key: "blood",
    label: "Blood",
    description: "Render blood mist particle effects on hits.",
    type: "boolean",
  },
  {
    key: "monsterShatter",
    label: "Monster shatter",
    description:
      "Split defeated monster billboards into physical shard pieces.",
    type: "boolean",
  },
  {
    key: "monsterShatterBloodBorders",
    label: "Shatter blood borders",
    description:
      "Tint shard pixels near split lines with randomized blood-red edges.",
    type: "boolean",
  },
  {
    key: "group-compatibility",
    label: "Runtime compatibility",
    type: "group",
  },
  {
    key: "darkCorridorWalls367",
    label: "NetHack 3.6.7 dark corridor walls",
    description:
      "Infer and cache dark corridor wall tiles (NetHack 3.6.7 behavior).",
    type: "boolean",
  },
  {
    key: "darkCorridorWallTileOverrideEnabled",
    label: "Override inferred dark wall tile",
    description:
      "Use a custom atlas tile for inferred dark corridor walls, saved per tileset.",
    type: "boolean",
  },
  {
    key: "darkCorridorWallSolidColorOverrideEnabled",
    label: "Use solid color for inferred dark walls",
    description: "Use a picked RGB color instead of a tileset tile.",
    type: "boolean",
  },
];

const clientOptionsDefaultTabId: ClientOptionsTabId = "display";

const clientOptionsTabs: ClientOptionsTab[] = [
  {
    id: "display",
    label: "Display",
    description: "Interface and display settings.",
    groupKey: "group-interface",
  },
  {
    id: "mobile",
    label: "Mobile",
    description: "Touch control settings for mobile gameplay.",
    groupKey: "group-mobile-controls",
  },
  {
    id: "controls",
    label: "Controls",
    description: "Controller mappings, FPS mode, and look behavior.",
    groupKey: "group-controls",
  },
  {
    id: "sound",
    label: "Sound",
    description: "Audio output and performance-related sound controls.",
    groupKey: "group-sound",
  },
  {
    id: "combat",
    label: "Combat",
    description: "Combat impact feedback and visual response.",
    groupKey: "group-combat",
  },
  {
    id: "compatibility",
    label: "Compatibility",
    description: "Runtime compatibility and NetHack behavior toggles.",
    groupKey: "group-compatibility",
  },
];

function getClientOptionsForGroup(groupKey: string): ClientOption[] {
  const options: ClientOption[] = [];
  let currentGroupKey = "";
  for (const option of clientOptionsConfig) {
    if (option.type === "group") {
      currentGroupKey = option.key;
      continue;
    }
    if (currentGroupKey === groupKey) {
      options.push(option);
    }
  }
  return options;
}

const clampInventoryContextMenuPosition = (
  x: number,
  y: number,
  width: number,
  height: number,
): { x: number; y: number } => {
  const padding = 8;
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 220;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 260;
  const maxX = Math.max(padding, window.innerWidth - safeWidth - padding);
  const maxY = Math.max(padding, window.innerHeight - safeHeight - padding);
  return {
    x: Math.min(Math.max(x, padding), maxX),
    y: Math.min(Math.max(y, padding), maxY),
  };
};

const inventoryContextMenuAnchorGapPx = 8;
const inventoryContextMenuAnchorBottomGapPx = 6;
const inventoryContextMenuScrollRegionPaddingPx = 4;
const inventoryRowPressPreferInitialMs = 200;

const resolveInventoryContextMenuPosition = (
  state: InventoryContextMenuState,
  width: number,
  height: number,
  scrollRegionRect?: DOMRect | null,
): { x: number; y: number } => {
  const anchorRightX =
    typeof state.anchorRightX === "number" &&
    Number.isFinite(state.anchorRightX)
      ? state.anchorRightX
      : state.x;
  const anchorBottomY =
    typeof state.anchorBottomY === "number" &&
    Number.isFinite(state.anchorBottomY)
      ? state.anchorBottomY
      : state.y;
  const clampedToViewport = clampInventoryContextMenuPosition(
    anchorRightX,
    anchorBottomY,
    width,
    height,
  );
  const regionLeft = scrollRegionRect?.left;
  const regionRight = scrollRegionRect?.right;
  const regionTop = scrollRegionRect?.top;
  const regionBottom = scrollRegionRect?.bottom;
  if (
    typeof regionLeft !== "number" ||
    !Number.isFinite(regionLeft) ||
    typeof regionRight !== "number" ||
    !Number.isFinite(regionRight) ||
    typeof regionTop !== "number" ||
    !Number.isFinite(regionTop) ||
    typeof regionBottom !== "number" ||
    !Number.isFinite(regionBottom)
  ) {
    return clampedToViewport;
  }
  const minX = regionLeft + inventoryContextMenuScrollRegionPaddingPx;
  const maxX = regionRight - width - inventoryContextMenuScrollRegionPaddingPx;
  const minY = regionTop + inventoryContextMenuScrollRegionPaddingPx;
  const maxY =
    regionBottom - height - inventoryContextMenuScrollRegionPaddingPx;
  const canClampX =
    Number.isFinite(minX) && Number.isFinite(maxX) && maxX >= minX;
  const canClampY =
    Number.isFinite(minY) && Number.isFinite(maxY) && maxY >= minY;
  if (!canClampX && !canClampY) {
    return clampedToViewport;
  }
  return {
    x: canClampX
      ? Math.min(Math.max(clampedToViewport.x, minX), maxX)
      : clampedToViewport.x,
    y: canClampY
      ? Math.min(Math.max(clampedToViewport.y, minY), maxY)
      : clampedToViewport.y,
  };
};

const parseCssPixelValue = (value: string, fallback = 0): number => {
  const parsed = Number.parseFloat(String(value || "").trim());
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clampTileContextMenuPosition = (
  x: number,
  y: number,
  width: number,
  height: number,
): { x: number; y: number } => {
  const rootStyle = getComputedStyle(document.documentElement);
  const safeLeft =
    parseCssPixelValue(
      rootStyle.getPropertyValue("--nh3d-modal-safe-left-inset"),
      8,
    ) + 4;
  const safeRight =
    parseCssPixelValue(
      rootStyle.getPropertyValue("--nh3d-modal-safe-right-inset"),
      8,
    ) + 4;
  const safeTop =
    parseCssPixelValue(
      rootStyle.getPropertyValue("--nh3d-mobile-overlay-top-inset"),
      8,
    ) + 4;
  const safeBottom =
    parseCssPixelValue(
      rootStyle.getPropertyValue("--nh3d-mobile-overlay-bottom-inset"),
      8,
    ) + 4;
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 260;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 220;
  const maxX = Math.max(safeLeft, window.innerWidth - safeRight - safeWidth);
  const maxY = Math.max(safeTop, window.innerHeight - safeBottom - safeHeight);
  return {
    x: Math.min(Math.max(x, safeLeft), maxX),
    y: Math.min(Math.max(y, safeTop), maxY),
  };
};

const tileContextMenuAnchorOffsetY = 30;

const mobileActions: MobileActionEntry[] = [
  { id: "wait", label: "Wait", kind: "quick", value: "wait" },
  { id: "zap", label: "Zap", kind: "extended", value: "zap" },
  { id: "cast", label: "Cast", kind: "extended", value: "cast" },
  { id: "kick", label: "Kick", kind: "extended", value: "kick" },
  { id: "read", label: "Read", kind: "extended", value: "read" },
  { id: "quaff", label: "Quaff", kind: "extended", value: "quaff" },
  { id: "eat", label: "Eat", kind: "extended", value: "eat" },
  { id: "glance", label: "Glance", kind: "extended", value: "glance" },
  { id: "loot", label: "Loot", kind: "quick", value: "loot" },
  { id: "open", label: "Open", kind: "quick", value: "open" },
  { id: "wield", label: "Wield", kind: "extended", value: "wield" },
  { id: "wear", label: "Wear", kind: "extended", value: "wear" },
  { id: "put-on", label: "Put On", kind: "extended", value: "puton" },
  { id: "take-off", label: "Take Off", kind: "extended", value: "takeoff" },
  { id: "extended", label: "Extended", kind: "quick", value: "extended" },
];

const controllerActionWheelOuterRadiusPercent = 50;
const controllerActionWheelLabelRadiusPercent = 29;
const controllerActionWheelSliceGapDeg = 1;

function getControllerActionWheelPolarPoint(
  angleDeg: number,
  radiusPercent: number,
): { x: number; y: number } {
  const radians = (angleDeg * Math.PI) / 180;
  return {
    x: 50 + Math.cos(radians) * radiusPercent,
    y: 50 + Math.sin(radians) * radiusPercent,
  };
}

function createControllerActionWheelEntries(
  actions: readonly MobileActionEntry[],
): ControllerActionWheelEntry[] {
  if (actions.length === 0) {
    return [];
  }
  const sliceSpanDeg = 360 / actions.length;
  return actions.map((action, index) => {
    const angleDeg = -90 + index * sliceSpanDeg;
    const halfGapDeg = Math.min(
      sliceSpanDeg * 0.35,
      controllerActionWheelSliceGapDeg / 2,
    );
    const startDeg = angleDeg - sliceSpanDeg / 2 + halfGapDeg;
    const endDeg = angleDeg + sliceSpanDeg / 2 - halfGapDeg;
    const startPoint = getControllerActionWheelPolarPoint(
      startDeg,
      controllerActionWheelOuterRadiusPercent,
    );
    const endPoint = getControllerActionWheelPolarPoint(
      endDeg,
      controllerActionWheelOuterRadiusPercent,
    );
    const labelPoint = getControllerActionWheelPolarPoint(
      angleDeg,
      controllerActionWheelLabelRadiusPercent,
    );
    const clipPath = `polygon(50% 50%, ${startPoint.x.toFixed(2)}% ${startPoint.y.toFixed(2)}%, ${endPoint.x.toFixed(2)}% ${endPoint.y.toFixed(2)}%)`;
    return {
      ...action,
      index,
      angleDeg,
      clipPath,
      labelXPercent: labelPoint.x,
      labelYPercent: labelPoint.y,
    };
  });
}

const fallbackExtendedCommandNames = [
  "adjust",
  "annotate",
  "apply",
  "attributes",
  "autopickup",
  "call",
  "cast",
  "chat",
  "close",
  "conduct",
  "dip",
  "drop",
  "droptype",
  "eat",
  "engrave",
  "enhance",
  "explode",
  "fight",
  "fire",
  "force",
  "getpos",
  "glance",
  "history",
  "invoke",
  "jump",
  "kick",
  "known",
  "knownclass",
  "look",
  "loot",
  "monster",
  "monsters",
  "name",
  "namefloor",
  "offer",
  "open",
  "options",
  "overview",
  "pay",
  "pickup",
  "pray",
  "prevmsg",
  "puton",
  "quaff",
  "quit",
  "quiver",
  "read",
  "redraw",
  "remove",
  "ride",
  "rub",
  "seeall",
  "seeamulet",
  "seegold",
  "seeinv",
  "seespells",
  "semicolon",
  "set",
  "shell",
  "sit",
  "spells",
  "takeoff",
  "takeoffall",
  "teleport",
  "terrain",
  "throw",
  "tip",
  "travel",
  "turn",
  "twoweapon",
  "untrap",
  "version",
  "versionshort",
  "wield",
  "wipe",
  "wear",
  "whatdoes",
  "whatis",
  "wieldquiver",
  "zap",
];
const commonExtendedCommandWhitelist = [
  "apply",
  "autopickup",
  "attributes",
  "drop",
  "engrave",
  "fire",
  "options",
  "pray",
  "quiver",
  "remove",
  "throw",
  "travel",
];

const wizardExtendedCommandNameSet = new Set([
  "levelchange",
  "lightsources",
  "migratemons",
  "panic",
  "polyself",
  "seenv",
  "stats",
  "timeout",
  "vanquished",
  "vision",
  "wizbury",
  "wizdetect",
  "wizgenesis",
  "wizidentify",
  "wizintrinsic",
  "wizlevelport",
  "wizmakemap",
  "wizmap",
  "wizrumorcheck",
  "wizsmell",
  "wizwhere",
  "wizwish",
  "wmode",
]);

const fallbackWizardExtendedCommandNames = Array.from(
  wizardExtendedCommandNameSet,
).sort((left, right) => left.localeCompare(right));

function isWizardExtendedCommandName(commandName: string): boolean {
  const normalized = String(commandName || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.startsWith("wiz") || wizardExtendedCommandNameSet.has(normalized)
  );
}

const overflowGlowClassName = "nh3d-overflow-glow";
const overflowGlowStartXClassName = "nh3d-overflow-glow-x-start";
const overflowGlowEndXClassName = "nh3d-overflow-glow-x-end";
const overflowGlowStartYClassName = "nh3d-overflow-glow-y-start";
const overflowGlowEndYClassName = "nh3d-overflow-glow-y-end";
const overflowGlowAxisThresholdPx = 1;
const overflowGlowTargetSelector = "[data-nh3d-overflow-glow]";

function resolveOverflowGlowHost(element: HTMLElement): HTMLElement {
  if (
    element.dataset.nh3dOverflowGlowHost === "parent" &&
    element.parentElement instanceof HTMLElement
  ) {
    return element.parentElement;
  }
  return element;
}

function supportsScrollableOverflowAxis(value: string): boolean {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return (
    normalized === "auto" || normalized === "scroll" || normalized === "overlay"
  );
}

function clearOverflowGlowState(element: HTMLElement): void {
  const hostElement = resolveOverflowGlowHost(element);
  hostElement.classList.remove(
    overflowGlowClassName,
    overflowGlowStartXClassName,
    overflowGlowEndXClassName,
    overflowGlowStartYClassName,
    overflowGlowEndYClassName,
  );
  hostElement.style.removeProperty("--nh3d-overflow-existing-shadow");
}

function updateOverflowGlowState(element: HTMLElement): boolean {
  const hostElement = resolveOverflowGlowHost(element);
  const computedStyle = window.getComputedStyle(element);
  const canOverflowX = supportsScrollableOverflowAxis(computedStyle.overflowX);
  const canOverflowY = supportsScrollableOverflowAxis(computedStyle.overflowY);
  const overflowX = Math.max(0, element.scrollWidth - element.clientWidth);
  const overflowY = Math.max(0, element.scrollHeight - element.clientHeight);
  const hasOverflowX = canOverflowX && overflowX > overflowGlowAxisThresholdPx;
  const hasOverflowY = canOverflowY && overflowY > overflowGlowAxisThresholdPx;

  if (!hasOverflowX && !hasOverflowY) {
    clearOverflowGlowState(element);
    return false;
  }

  if (!hostElement.classList.contains(overflowGlowClassName)) {
    const hostStyle = window.getComputedStyle(hostElement);
    const existingShadow =
      hostStyle.boxShadow && hostStyle.boxShadow !== "none"
        ? hostStyle.boxShadow
        : "none";
    hostElement.style.setProperty(
      "--nh3d-overflow-existing-shadow",
      existingShadow,
    );
    hostElement.classList.add(overflowGlowClassName);
  }

  if (hasOverflowX) {
    hostElement.classList.toggle(
      overflowGlowStartXClassName,
      element.scrollLeft > overflowGlowAxisThresholdPx,
    );
    hostElement.classList.toggle(
      overflowGlowEndXClassName,
      element.scrollLeft < overflowX - overflowGlowAxisThresholdPx,
    );
  } else {
    hostElement.classList.remove(
      overflowGlowStartXClassName,
      overflowGlowEndXClassName,
    );
  }

  if (hasOverflowY) {
    hostElement.classList.toggle(
      overflowGlowStartYClassName,
      element.scrollTop > overflowGlowAxisThresholdPx,
    );
    hostElement.classList.toggle(
      overflowGlowEndYClassName,
      element.scrollTop < overflowY - overflowGlowAxisThresholdPx,
    );
  } else {
    hostElement.classList.remove(
      overflowGlowStartYClassName,
      overflowGlowEndYClassName,
    );
  }

  return true;
}

function normalizeStartupCharacterName(value: string): string {
  const normalized = String(value || "")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return "Web_user";
  }
  return normalized.slice(0, 30);
}

function resolveDeviceDefaultClientOptions(): Nh3dClientOptions {
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  ) {
    return normalizeNh3dClientOptions({
      ...defaultNh3dClientOptions,
      fpsLookSensitivityX: mobileDefaultFpsLookSensitivity,
      fpsLookSensitivityY: mobileDefaultFpsLookSensitivity,
    });
  }
  return normalizeNh3dClientOptions(defaultNh3dClientOptions);
}

function resolveInitialClientOptionsFromPersisted(
  persisted: Partial<Nh3dClientOptions> | null,
): Nh3dClientOptions {
  const deviceDefaults = resolveDeviceDefaultClientOptions();
  if (!persisted) {
    return deviceDefaults;
  }
  const hydrated = normalizeNh3dClientOptions({
    ...deviceDefaults,
    ...persisted,
  });
  hydrated.controllerEnabled = false;
  return hydrated;
}

function isRunningOnLocalhost(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const hostname = String(window.location.hostname || "")
    .trim()
    .toLowerCase();
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
}

function stripUserTilesetNameSuffix(value: string): string {
  return String(value || "")
    .replace(/\s*\(user\)\s*$/i, "")
    .trim();
}

function appendUserTilesetNameSuffix(value: string): string {
  const normalized = stripUserTilesetNameSuffix(value);
  return normalized ? `${normalized} (user)` : "User Tileset (user)";
}

function toUserTilesetRegistrations(
  records: ReadonlyArray<StoredUserTilesetRecord>,
): ReadonlyArray<{
  id: string;
  label: string;
  tileSize: number;
  blob: Blob;
}> {
  return records.map((record) => ({
    id: record.id,
    label: record.label,
    tileSize: record.tileSize,
    blob: record.blob,
  }));
}

async function inferTilesetTileSizeFromBlob(blob: Blob): Promise<number> {
  if (typeof window === "undefined") {
    return 32;
  }
  const objectUrl = URL.createObjectURL(blob);
  try {
    const size = await new Promise<number>((resolve, reject) => {
      const image = new window.Image();
      image.onload = () =>
        resolve(inferNh3dTilesetTileSizeFromAtlasWidth(image.naturalWidth));
      image.onerror = () => reject(new Error("Failed to read tileset image."));
      image.src = objectUrl;
    });
    return size;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function normalizeUserTilesetTileSizes(
  records: ReadonlyArray<StoredUserTilesetRecord>,
): Promise<StoredUserTilesetRecord[]> {
  return Promise.all(
    records.map(async (record) => {
      const fallbackTileSize = Math.max(
        1,
        Math.trunc(Number.isFinite(record.tileSize) ? record.tileSize : 32),
      );
      try {
        const tileSize = await inferTilesetTileSizeFromBlob(record.blob);
        return {
          ...record,
          tileSize,
        };
      } catch {
        return {
          ...record,
          tileSize: fallbackTileSize,
        };
      }
    }),
  );
}

type SaveGameRecord = {
  key: string;
  name: string;
  filename: string;
  timestamp: Date;
  dateFormatted: string;
};

async function fetchSavedGames(): Promise<SaveGameRecord[]> {
  const saves: SaveGameRecord[] = [];
  const dbNames = ["/save", "/nethack/save"];

  for (const dbName of dbNames) {
    try {
      const db = await new Promise<IDBDatabase | null>((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = (e) => {
          (e.target as IDBOpenDBRequest).transaction?.abort();
          resolve(null);
        };
      });

      if (!db) continue;

      if (!db.objectStoreNames.contains("FILE_DATA")) {
        db.close();
        continue;
      }

      const records = await new Promise<{ key: string; value: any }[]>(
        (resolve, reject) => {
          const transaction = db.transaction(["FILE_DATA"], "readonly");
          const store = transaction.objectStore("FILE_DATA");
          const request = store.getAll();
          const keysRequest = store.getAllKeys();

          request.onsuccess = () => {
            keysRequest.onsuccess = () => {
              const result = [];
              for (let i = 0; i < request.result.length; i++) {
                result.push({
                  key: keysRequest.result[i] as string,
                  value: request.result[i],
                });
              }
              resolve(result);
            };
            keysRequest.onerror = () => reject(keysRequest.error);
          };
          request.onerror = () => reject(request.error);
        },
      );

      for (const record of records) {
        const key = record.key;
        const value = record.value;
        if (!key || typeof key !== "string") continue;

        const filename = key.split("/").pop();
        if (!filename) continue;

        // Ignore structural/metadata files used by NetHack
        const knownNonSaves = [
          "record",
          "logfile",
          "xlogfile",
          "perm",
          "timestamp",
          ".keep",
        ];
        if (knownNonSaves.includes(filename)) continue;
        if (filename.includes("level") || filename.includes("lock")) continue;

        // NetHack prepends a user ID (usually 0) to save files, e.g. "0Web_user". Strip it.
        const name = filename.replace(/^\d+/, "");
        if (name && value && value.timestamp) {
          saves.push({
            key,
            name,
            filename,
            timestamp: new Date(value.timestamp),
            dateFormatted: new Date(value.timestamp).toLocaleString(),
          });
        }
      }

      db.close();
    } catch (e) {
      console.warn(`Could not read IndexedDB ${dbName}:`, e);
    }
  }

  // Deduplicate by name and sort by newest first
  const uniqueSaves = new Map<string, SaveGameRecord>();
  for (const save of saves) {
    const existing = uniqueSaves.get(save.name);
    if (!existing || existing.timestamp < save.timestamp) {
      uniqueSaves.set(save.name, save);
    }
  }

  return Array.from(uniqueSaves.values()).sort(
    (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
  );
}

async function deleteSavedGame(filename: string): Promise<void> {
  const dbNames = ["/save", "/nethack/save"];

  for (const dbName of dbNames) {
    try {
      const db = await new Promise<IDBDatabase | null>((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = (e) => {
          (e.target as IDBOpenDBRequest).transaction?.abort();
          resolve(null);
        };
      });

      if (!db) continue;

      if (!db.objectStoreNames.contains("FILE_DATA")) {
        db.close();
        continue;
      }

      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(["FILE_DATA"], "readwrite");
        const store = transaction.objectStore("FILE_DATA");

        // Emscripten IDBFS uses the absolute path as the object store key
        const fullKey = `${dbName}/${filename}`;

        const request = store.delete(fullKey);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });

      db.close();
    } catch (e) {
      console.warn(`Could not delete from IndexedDB ${dbName}:`, e);
    }
  }
}

type Nh3dElectronBridge = {
  quitGame?: () => Promise<unknown>;
  signalAppRendered?: () => void;
};

type Nh3dAndroidBridge = {
  quitGame?: () => void;
};

type Nh3dWindowBridges = Window & {
  nh3dElectron?: Nh3dElectronBridge;
  nh3dAndroid?: Nh3dAndroidBridge;
};

async function requestGameQuit(): Promise<void> {
  const bridgeWindow = window as Nh3dWindowBridges;
  const electronBridge = bridgeWindow.nh3dElectron;
  if (typeof electronBridge?.quitGame === "function") {
    await electronBridge.quitGame();
    return;
  }

  const androidBridge = bridgeWindow.nh3dAndroid;
  if (typeof androidBridge?.quitGame === "function") {
    androidBridge.quitGame();
    return;
  }

  window.close();
}

export default function App(): JSX.Element {
  const startupDefaultCharacterPreferences = useMemo(
    () => createDefaultStartupCharacterPreferences(),
    [],
  );
  const canvasRootRef = useRef<HTMLDivElement | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);
  const startupRenderSignalSentRef = useRef(false);
  const [characterCreationConfig, setCharacterCreationConfig] =
    useState<CharacterCreationConfig | null>(null);
  const [startupFlowStep, setStartupFlowStep] =
    useState<StartupFlowStep>("choose");
  const [runtimeVersion, setRuntimeVersion] =
    useState<NethackRuntimeVersion>("3.6.7");
  const [createRole, setCreateRole] = useState(
    startupDefaultCharacterPreferences.createRole,
  );
  const [createRace, setCreateRace] = useState(
    startupDefaultCharacterPreferences.createRace,
  );
  const [createGender, setCreateGender] = useState(
    startupDefaultCharacterPreferences.createGender,
  );
  const [createAlign, setCreateAlign] = useState(
    startupDefaultCharacterPreferences.createAlign,
  );
  const [randomCharacterName, setRandomCharacterName] = useState(
    startupDefaultCharacterPreferences.randomName,
  );
  const [createCharacterName, setCreateCharacterName] = useState(
    startupDefaultCharacterPreferences.createName,
  );
  const [
    hasHydratedStartupCharacterPreferences,
    setHasHydratedStartupCharacterPreferences,
  ] = useState(false);
  const [startupInitOptionsExpanded, setStartupInitOptionsExpanded] =
    useState(false);
  const [startupInitOptionValues, setStartupInitOptionValues] =
    useState<StartupInitOptionValues>(() =>
      createDefaultStartupInitOptionValues(),
    );
  const [hasHydratedStartupInitOptions, setHasHydratedStartupInitOptions] =
    useState(false);
  const [savedGames, setSavedGames] = useState<SaveGameRecord[]>([]);
  const [isLoadingSaves, setIsLoadingSaves] = useState(false);
  const startupCreateCharacterOptionSet = useMemo(
    () =>
      resolveStartupCreateCharacterOptionSet({
        role: createRole,
        race: createRace,
        gender: createGender,
        align: createAlign,
      }),
    [createRole, createRace, createGender, createAlign],
  );
  const normalizedCreateCharacterSelection =
    startupCreateCharacterOptionSet.selection;

  const handleDeleteSave = async (
    e: ReactMouseEvent<HTMLButtonElement>,
    save: SaveGameRecord,
  ) => {
    e.stopPropagation();
    const confirmed = await requestConfirmation({
      title: "Delete Saved Game?",
      message: `Are you sure you want to delete ${save.name}?`,
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      confirmClassName: "nh3d-menu-action-cancel",
    });
    if (!confirmed) {
      return;
    }
    await deleteSavedGame(save.filename);
    setSavedGames((prev) => prev.filter((s) => s.filename !== save.filename));
  };

  const handleResumeClick = async () => {
    setStartupFlowStep("resume");
    setIsLoadingSaves(true);
    try {
      const saves = await fetchSavedGames();
      setSavedGames(saves);
    } catch (e) {
      console.error("Error loading saves", e);
    } finally {
      setIsLoadingSaves(false);
    }
  };

  const handleStartNewGame = async (config: CharacterCreationConfig) => {
    if (config.mode === "random" || config.mode === "create") {
      try {
        const saves = await fetchSavedGames();
        const configName = config.name || "Web_user";
        const existingSave = saves.find((s) => s.name === configName);
        if (existingSave) {
          const confirmed = await requestConfirmation({
            title: "Overwrite Saved Game?",
            message: `A saved game named "${configName}" already exists. Do you want to overwrite it with a new character?`,
            confirmLabel: "Overwrite",
            cancelLabel: "Cancel",
            confirmClassName: "nh3d-menu-action-cancel",
          });
          if (!confirmed) {
            return;
          }
          await deleteSavedGame(existingSave.filename);
        }
      } catch (e) {
        console.warn("Failed to check for existing saves:", e);
      }
    }
    setCharacterCreationConfig(config);
  };

  const updateStartupInitOptionValue = useCallback(
    (key: string, value: StartupInitOptionValue): void => {
      setStartupInitOptionValues((previous) => ({
        ...previous,
        [key]: value,
      }));
    },
    [],
  );
  const resetStartupInitOptionValues = useCallback((): void => {
    setStartupInitOptionValues(createDefaultStartupInitOptionValues());
  }, []);
  const startupInitOptionTokens = useMemo(
    () => serializeStartupInitOptionTokens(startupInitOptionValues),
    [startupInitOptionValues],
  );
  const startupCharacterPreferences = useMemo<StartupCharacterPreferences>(
    () => ({
      randomName: randomCharacterName,
      createName: createCharacterName,
      createRole: normalizedCreateCharacterSelection.role,
      createRace: normalizedCreateCharacterSelection.race,
      createGender: normalizedCreateCharacterSelection.gender,
      createAlign: normalizedCreateCharacterSelection.align,
    }),
    [
      randomCharacterName,
      createCharacterName,
      normalizedCreateCharacterSelection.role,
      normalizedCreateCharacterSelection.race,
      normalizedCreateCharacterSelection.gender,
      normalizedCreateCharacterSelection.align,
    ],
  );
  useEffect(() => {
    if (createRole !== normalizedCreateCharacterSelection.role) {
      setCreateRole(normalizedCreateCharacterSelection.role);
    }
    if (createRace !== normalizedCreateCharacterSelection.race) {
      setCreateRace(normalizedCreateCharacterSelection.race);
    }
    if (createGender !== normalizedCreateCharacterSelection.gender) {
      setCreateGender(normalizedCreateCharacterSelection.gender);
    }
    if (createAlign !== normalizedCreateCharacterSelection.align) {
      setCreateAlign(normalizedCreateCharacterSelection.align);
    }
  }, [
    createRole,
    createRace,
    createGender,
    createAlign,
    normalizedCreateCharacterSelection.role,
    normalizedCreateCharacterSelection.race,
    normalizedCreateCharacterSelection.gender,
    normalizedCreateCharacterSelection.align,
  ]);

  const initialPersistedClientOptionsRef =
    useRef<Partial<Nh3dClientOptions> | null>(null);
  const initialClientOptions = useMemo(
    () => resolveDeviceDefaultClientOptions(),
    [],
  );
  const [clientOptions, setClientOptions] = useState<Nh3dClientOptions>(
    () => initialClientOptions,
  );
  const [clientOptionsDraft, setClientOptionsDraft] =
    useState<Nh3dClientOptions>(() => initialClientOptions);
  const [hasHydratedUserTilesets, setHasHydratedUserTilesets] = useState(false);
  const [isClientOptionsVisible, setIsClientOptionsVisible] = useState(false);
  const [activeClientOptionsTab, setActiveClientOptionsTab] =
    useState<ClientOptionsTabId>(clientOptionsDefaultTabId);
  const [isDarkWallTilePickerVisible, setIsDarkWallTilePickerVisible] =
    useState(false);
  const [
    isTilesetBackgroundTilePickerVisible,
    setIsTilesetBackgroundTilePickerVisible,
  ] = useState(false);
  const [
    isTilesetSolidColorPickerVisible,
    setIsTilesetSolidColorPickerVisible,
  ] = useState(false);
  const [isTilesetManagerVisible, setIsTilesetManagerVisible] = useState(false);
  const [isPauseMenuVisible, setIsPauseMenuVisible] = useState(false);
  const [isExitConfirmationVisible, setIsExitConfirmationVisible] =
    useState(false);
  const [
    isResetClientOptionsConfirmationVisible,
    setIsResetClientOptionsConfirmationVisible,
  ] = useState(false);
  const [isControllerRemapVisible, setIsControllerRemapVisible] =
    useState(false);
  const [controllerRemapListening, setControllerRemapListening] =
    useState<ControllerRemapListeningState | null>(null);
  const [
    hasAskedControllerSupportThisSession,
    setHasAskedControllerSupportThisSession,
  ] = useState(false);
  const [
    isControllerSupportPromptVisible,
    setIsControllerSupportPromptVisible,
  ] = useState(false);
  const [userTilesets, setUserTilesets] = useState<StoredUserTilesetRecord[]>(
    [],
  );
  const [tilesetManagerMode, setTilesetManagerMode] = useState<"edit" | "new">(
    "edit",
  );
  const [tilesetManagerName, setTilesetManagerName] = useState("");
  const [tilesetManagerEditPath, setTilesetManagerEditPath] = useState("");
  const [tilesetManagerFile, setTilesetManagerFile] = useState<File | null>(
    null,
  );
  const [tilesetManagerError, setTilesetManagerError] = useState("");
  const [tilesetManagerBusy, setTilesetManagerBusy] = useState(false);
  const tilesetManagerFileInputRef = useRef<HTMLInputElement | null>(null);
  const [tileAtlasImage, setTileAtlasImage] = useState<HTMLImageElement | null>(
    null,
  );
  const [tileAtlasState, setTileAtlasState] = useState<TileAtlasState>(
    () => createDefaultTileAtlasState(),
  );
  const [tilesetManagerAtlasImage, setTilesetManagerAtlasImage] =
    useState<HTMLImageElement | null>(null);
  const [tilesetManagerAtlasState, setTilesetManagerAtlasState] =
    useState<TileAtlasState>(() => createDefaultTileAtlasState());
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [isMobileActionSheetVisible, setIsMobileActionSheetVisible] =
    useState(false);
  const [mobileActionSheetMode, setMobileActionSheetMode] =
    useState<MobileActionSheetMode>("quick");
  const [isControllerActionWheelVisible, setIsControllerActionWheelVisible] =
    useState(false);
  const [controllerActionWheelMode, setControllerActionWheelMode] =
    useState<MobileActionSheetMode>("quick");
  const [
    controllerActionWheelChosenIndex,
    setControllerActionWheelChosenIndex,
  ] = useState(0);
  const controllerActionWheelDialogRef = useRef<HTMLDivElement | null>(null);
  const [isMobileLogVisible, setIsMobileLogVisible] = useState(false);
  const [isWizardCommandsVisible, setIsWizardCommandsVisible] = useState(false);
  const wizardCommandsButtonRef = useRef<HTMLButtonElement | null>(null);
  const wizardCommandsSheetRef = useRef<HTMLDivElement | null>(null);
  const [characterSheetInterceptionArmed, setCharacterSheetInterceptionArmed] =
    useState(false);
  const characterSheetAwaitingInfoRef = useRef(false);
  const [statsBarHeight, setStatsBarHeight] = useState(0);
  const [coreStatBoldUntilTurn, setCoreStatBoldUntilTurn] = useState<
    Partial<Record<CoreStatKey, number>>
  >({});
  const previousCoreStatSnapshotRef = useRef<CoreStatSnapshot | null>(null);
  const [textInputValue, setTextInputValue] = useState("");
  const soundPackDialogActionsRef = useRef<SoundPackDialogActions | null>(null);
  const {
    dialog: globalConfirmationDialog,
    requestConfirmation,
    resolveConfirmation,
  } = useConfirmationDialog();
  const startupControllerPreviousActionActiveRef = useRef<
    Partial<Record<Nh3dControllerActionId, boolean>>
  >({});
  const startupAccordionConfirmReleaseLatchRef = useRef(false);
  const startupControllerSliderInteractionActiveRef = useRef(false);
  const startupControllerSliderStepCarryRef = useRef(0);
  const startupControllerActiveSliderElementRef =
    useRef<HTMLInputElement | null>(null);
  const startupControllerCursorElementRef = useRef<HTMLDivElement | null>(null);
  const startupControllerCursorPulseElementRef = useRef<HTMLDivElement | null>(
    null,
  );
  const startupControllerCursorHighlightElementRef = useRef<HTMLElement | null>(
    null,
  );
  const startupControllerCursorPulseTimerRef = useRef<number | null>(null);
  const startupControllerCursorVisibleRef = useRef(false);
  const startupControllerCursorXRef = useRef<number>(Number.NaN);
  const startupControllerCursorYRef = useRef<number>(Number.NaN);
  const adapter = useMemo(() => createEngineUiAdapter(), []);
  const setEngineController = useGameStore(
    (state) => state.setEngineController,
  );
  const setPositionRequest = useGameStore((state) => state.setPositionRequest);
  const setFloatingMessageTiming = useGameStore(
    (state) => state.setFloatingMessageTiming,
  );
  const setNewGamePrompt = useGameStore((state) => state.setNewGamePrompt);

  const loadingVisible = useGameStore((state) => state.loadingVisible);
  const statusText = useGameStore((state) => state.statusText);
  const gameMessages = useGameStore((state) => state.gameMessages);
  const floatingMessages = useGameStore((state) => state.floatingMessages);
  const playerStats = useGameStore((state) => state.playerStats);
  const question = useGameStore((state) => state.question);
  const directionQuestion = useGameStore((state) => state.directionQuestion);
  const numberPadModeEnabled = useGameStore(
    (state) => state.numberPadModeEnabled,
  );
  const infoMenu = useGameStore((state) => state.infoMenu);
  const inventory = useGameStore((state) => state.inventory);
  const textInputRequest = useGameStore((state) => state.textInput);
  const fpsCrosshairContext = useGameStore(
    (state) => state.fpsCrosshairContext,
  );
  const repeatActionVisible = useGameStore(
    (state) => state.repeatActionVisible,
  );
  const positionRequest = useGameStore((state) => state.positionRequest);
  const connectionState = useGameStore((state) => state.connectionState);
  const extendedCommands = useGameStore((state) => state.extendedCommands);
  const controller = useGameStore((state) => state.engineController);
  const newGamePrompt = useGameStore((state) => state.newGamePrompt);
  const characterSheet = useMemo(
    () => parseCharacterSheetInfoMenu(infoMenu),
    [infoMenu],
  );
  const isCharacterSheetVisible = Boolean(
    infoMenu && characterSheet && characterSheetInterceptionArmed,
  );
  const hasCharacterStatValues = Boolean(
    characterSheet?.statEntries.some((entry) =>
      Boolean(entry.currentValue || entry.rawValue || entry.limitValue),
    ),
  );
  const hasCharacterStatLimits = Boolean(
    characterSheet?.statEntries.some((entry) => Boolean(entry.limitValue)),
  );
  const characterExperienceProgress = useMemo(() => {
    const level = Number.isFinite(playerStats.level)
      ? Math.max(1, Math.trunc(playerStats.level))
      : 1;
    const experiencePoints = Number.isFinite(playerStats.experience)
      ? Math.max(0, Math.trunc(playerStats.experience))
      : 0;
    const currentLevelStart = getExperienceThresholdForLevel(level - 1);
    if (level >= maxExperienceLevel) {
      return {
        level,
        experiencePoints,
        isMaxLevel: true,
        currentLevelStart,
        nextLevelThreshold: currentLevelStart,
        toNextLevel: 0,
        progressPercent: 100,
      };
    }
    const nextLevelThreshold = getExperienceThresholdForLevel(level);
    const levelSpan = Math.max(1, nextLevelThreshold - currentLevelStart);
    const gainedThisLevel = Math.max(
      0,
      Math.min(levelSpan, experiencePoints - currentLevelStart),
    );
    const toNextLevel = Math.max(0, nextLevelThreshold - experiencePoints);
    return {
      level,
      experiencePoints,
      isMaxLevel: false,
      currentLevelStart,
      nextLevelThreshold,
      toNextLevel,
      progressPercent: Math.max(
        0,
        Math.min(100, (gainedThisLevel / levelSpan) * 100),
      ),
    };
  }, [playerStats.level, playerStats.experience]);
  const floatingMessageTextStyle = useMemo(
    () =>
      ({
        "--floating-message-fade-delay-ms": `${clientOptions.liveMessageDisplayTimeMs}ms`,
        "--floating-message-fade-duration-ms": `${clientOptions.liveMessageFadeOutTimeMs}ms`,
      }) as React.CSSProperties,
    [
      clientOptions.liveMessageDisplayTimeMs,
      clientOptions.liveMessageFadeOutTimeMs,
    ],
  );
  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const root = document.documentElement;
    root.style.setProperty(
      "--nh3d-ui-font-scale",
      String(clientOptions.uiFontScale),
    );
    root.style.setProperty(
      "--nh3d-live-log-font-scale",
      String(clientOptions.liveMessageLogFontScale),
    );
    root.style.setProperty(
      "--nh3d-minimap-scale",
      String(clientOptions.minimapScale),
    );
    return () => {
      root.style.removeProperty("--nh3d-ui-font-scale");
      root.style.removeProperty("--nh3d-live-log-font-scale");
      root.style.removeProperty("--nh3d-minimap-scale");
    };
  }, [
    clientOptions.uiFontScale,
    clientOptions.liveMessageLogFontScale,
    clientOptions.minimapScale,
  ]);
  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const root = document.documentElement;
    root.classList.toggle(
      "nh3d-disable-animated-transitions",
      clientOptions.disableAnimatedTransitions,
    );
    return () => {
      root.classList.remove("nh3d-disable-animated-transitions");
    };
  }, [clientOptions.disableAnimatedTransitions]);
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }
    const trackedElements = new Map<HTMLElement, () => void>();
    let refreshRafId: number | null = null;

    const refreshOverflowGlowTargets = (): void => {
      const activeElements = new Set<HTMLElement>();
      const candidates = document.querySelectorAll<HTMLElement>(
        overflowGlowTargetSelector,
      );
      for (const element of candidates) {
        if (!element.isConnected) {
          continue;
        }
        const hasOverflowGlow = updateOverflowGlowState(element);
        if (!hasOverflowGlow) {
          continue;
        }
        activeElements.add(element);
        if (trackedElements.has(element)) {
          continue;
        }
        const onScroll = (): void => {
          updateOverflowGlowState(element);
        };
        element.addEventListener("scroll", onScroll, { passive: true });
        trackedElements.set(element, onScroll);
      }

      for (const [element, onScroll] of trackedElements.entries()) {
        if (activeElements.has(element) && element.isConnected) {
          continue;
        }
        element.removeEventListener("scroll", onScroll);
        trackedElements.delete(element);
        clearOverflowGlowState(element);
      }
    };

    const scheduleOverflowGlowRefresh = (): void => {
      if (refreshRafId !== null) {
        return;
      }
      refreshRafId = window.requestAnimationFrame(() => {
        refreshRafId = null;
        refreshOverflowGlowTargets();
      });
    };

    scheduleOverflowGlowRefresh();

    const mutationObserver = new MutationObserver(() => {
      scheduleOverflowGlowRefresh();
    });
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    window.addEventListener("resize", scheduleOverflowGlowRefresh);
    window.addEventListener("orientationchange", scheduleOverflowGlowRefresh);

    return () => {
      mutationObserver.disconnect();
      window.removeEventListener("resize", scheduleOverflowGlowRefresh);
      window.removeEventListener(
        "orientationchange",
        scheduleOverflowGlowRefresh,
      );
      if (refreshRafId !== null) {
        window.cancelAnimationFrame(refreshRafId);
      }
      for (const [element, onScroll] of trackedElements.entries()) {
        element.removeEventListener("scroll", onScroll);
        clearOverflowGlowState(element);
      }
      trackedElements.clear();
    };
  }, []);
  const [
    reopenNewGamePromptOnInteraction,
    setReopenNewGamePromptOnInteraction,
  ] = useState(false);
  const [deferredNewGamePromptReason, setDeferredNewGamePromptReason] =
    useState<string | null>(null);
  const newGamePromptYesButtonRef = useRef<HTMLButtonElement | null>(null);
  const newGamePromptNoButtonRef = useRef<HTMLButtonElement | null>(null);
  const startupLikelyOpenSelectElementsRef = useRef<Set<HTMLSelectElement>>(
    new Set(),
  );
  const startupLikelyOpenSelectInitialValueByElementRef = useRef<
    Map<HTMLSelectElement, string>
  >(new Map());
  const clientOptionsLikelyOpenSelectElementsRef = useRef<
    Set<HTMLSelectElement>
  >(new Set());
  const clientOptionsLikelyOpenSelectInitialValueByElementRef = useRef<
    Map<HTMLSelectElement, string>
  >(new Map());
  const tilesetCatalog = useMemo(() => getNh3dTilesetCatalog(), [userTilesets]);
  const showBuiltInTilesetsInTilesetManagerList = useMemo(
    () => isRunningOnLocalhost(),
    [],
  );
  const showDeveloperClientSettings = showBuiltInTilesetsInTilesetManagerList;
  const userTilesetRecordByPath = useMemo(() => {
    const recordByPath = new Map<string, StoredUserTilesetRecord>();
    for (const record of userTilesets) {
      recordByPath.set(getNh3dUserTilesetPath(record.id), record);
    }
    return recordByPath;
  }, [userTilesets]);
  const tilesetManagerListTilesets = useMemo(
    () =>
      tilesetCatalog.filter(
        (tileset) =>
          tileset.source === "user" || showBuiltInTilesetsInTilesetManagerList,
      ),
    [showBuiltInTilesetsInTilesetManagerList, tilesetCatalog],
  );
  const hasAnyTilesets = tilesetCatalog.length > 0;
  const tilesetDropdownOptions = useMemo(
    () =>
      hasAnyTilesets
        ? tilesetCatalog.map((tileset) => ({
            value: tileset.path,
            label: tileset.label,
          }))
        : [{ value: "", label: "No tilesets found" }],
    [hasAnyTilesets, tilesetCatalog],
  );
  const selectedClientOptionsTab = useMemo<ClientOptionsTab>(
    () =>
      clientOptionsTabs.find((tab) => tab.id === activeClientOptionsTab) ??
      clientOptionsTabs[0],
    [activeClientOptionsTab],
  );
  const visibleClientOptions = useMemo(
    () => getClientOptionsForGroup(selectedClientOptionsTab.groupKey),
    [selectedClientOptionsTab.groupKey],
  );
  const controllerRemapListeningActionLabel = useMemo(() => {
    if (!controllerRemapListening) {
      return "";
    }
    for (const group of controllerActionGroupOrder) {
      const spec = nh3dControllerActionSpecsByGroup[group].find(
        (entry) => entry.id === controllerRemapListening.actionId,
      );
      if (spec) {
        return spec.label;
      }
    }
    return controllerRemapListening.actionId;
  }, [controllerRemapListening]);
  const connectedControllerCount = useMemo(
    () =>
      isControllerRemapVisible ? getConnectedGamepadsForCapture().length : 0,
    [isControllerRemapVisible, controllerRemapListening],
  );
  const isFpsPlayMode = clientOptions.fpsMode;
  const fpsContextTitle = String(fpsCrosshairContext?.title || "");
  const shouldScrollFpsContextTitle = fpsContextTitle.length > 0;
  const fpsContextTitleDurationSec = Math.max(
    6,
    Math.min(20, fpsContextTitle.length * 0.14),
  );
  const fpsContextTitleStyle: CSSProperties | undefined =
    shouldScrollFpsContextTitle
      ? ({
          "--nh3d-context-title-scroll-duration": `${fpsContextTitleDurationSec}s`,
        } as CSSProperties)
      : undefined;
  const fpsCrosshairContextMenuRef = useRef<HTMLDivElement | null>(null);
  const [tileContextMenuPosition, setTileContextMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const inventoryItemActions = inventoryContextActions;
  const inventoryContextMenuRef = useRef<HTMLDivElement | null>(null);
  const inventoryItemsContainerRef = useRef<HTMLDivElement | null>(null);
  const inventoryRowRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const inventoryContextMenuStateRef = useRef<InventoryContextMenuState | null>(
    null,
  );
  const inventoryRowHoverValueByIndexRef = useRef<Map<number, number>>(
    new Map(),
  );
  const inventoryKeyboardActivationKeysDownRef = useRef<Set<string>>(new Set());
  const inventoryPointerClientYRef = useRef<number | null>(null);
  const inventoryPointerActiveRef = useRef(false);
  const inventoryRowProximityAnimationFrameRef = useRef<number | null>(null);
  const inventoryTouchFallbackClearTimerRef = useRef<number | null>(null);
  const inventoryRowPressCandidateRef =
    useRef<InventoryRowPressCandidate | null>(null);
  const tilesUiEnabled = clientOptions.tilesetMode === "tiles";
  const inventoryAsciiModeEnabled = !tilesUiEnabled;
  const inventoryReducedMotionEnabled =
    inventoryAsciiModeEnabled || clientOptions.reduceInventoryMotion === true;
  const inventoryTileOnlyMotionEnabled =
    !inventoryReducedMotionEnabled &&
    clientOptions.inventoryTileOnlyMotion === true;
  const inventoryUsesFullRowAnimation =
    !inventoryReducedMotionEnabled && !inventoryTileOnlyMotionEnabled;
  const inventoryFixedTileSizeMode = clientOptions.inventoryFixedTileSize;
  const inventoryFixedIconSizePx =
    inventoryFixedTileSizeMode === "small"
      ? 20
      : inventoryFixedTileSizeMode === "large"
        ? 50
        : 35;
  const [inventoryContextMenu, setInventoryContextMenu] =
    useState<InventoryContextMenuState | null>(null);
  useEffect(() => {
    inventoryContextMenuStateRef.current = inventoryContextMenu;
  }, [inventoryContextMenu]);
  const inventoryContextTitle = inventoryContextMenu
    ? `${inventoryContextMenu.itemText} (${inventoryContextMenu.accelerator})`
    : "";
  const shouldScrollInventoryContextTitle = inventoryContextTitle.length > 36;
  const inventoryContextTitleDurationSec = Math.max(
    6,
    Math.min(20, inventoryContextTitle.length * 0.14),
  );
  const inventoryContextTitleStyle: CSSProperties | undefined =
    shouldScrollInventoryContextTitle
      ? ({
          "--nh3d-context-title-scroll-duration": `${inventoryContextTitleDurationSec}s`,
        } as CSSProperties)
      : undefined;
  const inventoryItemCategoryByAccelerator = useMemo(() => {
    const categoryByAccelerator = new Map<string, string>();
    let currentCategory = "";
    for (const item of inventory.items) {
      if (item?.isCategory) {
        currentCategory = normalizeInventoryCategoryLabel(item.text);
        continue;
      }
      const accelerator =
        typeof item?.accelerator === "string" ? item.accelerator.trim() : "";
      if (!accelerator) {
        continue;
      }
      categoryByAccelerator.set(accelerator, currentCategory);
    }
    return categoryByAccelerator;
  }, [inventory.items]);
  const inventoryContextCategory = useMemo(() => {
    if (!inventoryContextMenu) {
      return "";
    }
    return (
      inventoryItemCategoryByAccelerator.get(
        String(inventoryContextMenu.accelerator || "").trim(),
      ) || ""
    );
  }, [inventoryContextMenu, inventoryItemCategoryByAccelerator]);
  const inventoryContextCategoryId = useMemo(
    () => classifyInventoryCategory(inventoryContextCategory),
    [inventoryContextCategory],
  );
  const inventoryContextMenuActions = useMemo(() => {
    const blocked = getBlockedInventoryActionIdsForCategory(
      inventoryContextCategory,
    );
    const filteredByCategory = blocked.size
      ? inventoryItemActions.filter((action) => !blocked.has(action.id))
      : inventoryItemActions;
    const selectedItemText = String(inventoryContextMenu?.itemText || "");
    const filteredByItemSupport = filteredByCategory.filter((action) =>
      inventoryItemSupportsContextAction(
        action.id,
        inventoryContextCategoryId,
        selectedItemText,
      ),
    );
    const visibleActions =
      inventoryContextCategoryId === "weapons"
        ? filteredByItemSupport
        : filteredByItemSupport.filter((action) => action.id !== "quiver");
    const selectedItemIsWeaponInHand = /\bweapon in hand\b/i.test(
      selectedItemText,
    );
    if (!selectedItemIsWeaponInHand) {
      return visibleActions;
    }
    return visibleActions.map((action) =>
      action.id === "wield"
        ? { ...action, id: "unwield", label: "Unwield" }
        : action,
    );
  }, [
    inventoryContextCategory,
    inventoryContextCategoryId,
    inventoryContextMenu?.itemText,
    inventoryItemActions,
  ]);
  const applyInventoryRowProximity = useCallback((): void => {
    inventoryRowProximityAnimationFrameRef.current = null;
    const rows = inventoryRowRefs.current;
    const hoverValuesByIndex = inventoryRowHoverValueByIndexRef.current;
    if (rows.size === 0) {
      hoverValuesByIndex.clear();
      return;
    }
    if (inventoryReducedMotionEnabled) {
      for (const [index, rowElement] of rows.entries()) {
        hoverValuesByIndex.set(index, 0);
        rowElement.style.setProperty("--nh3d-inv-hover", "0");
      }
      return;
    }
    const pointerY = inventoryPointerClientYRef.current;
    const rawPointerIsActive =
      inventoryPointerActiveRef.current &&
      typeof pointerY === "number" &&
      Number.isFinite(pointerY);
    const proximityFalloffPx = 240;
    let needsAnotherFrame = false;
    const activeIndexes = new Set<number>();
    let pinnedActiveIndex: number | null = null;
    let pinnedActiveRowRect: DOMRect | null = null;
    let virtualPointerY: number | null = null;

    for (const [index, rowElement] of rows.entries()) {
      if (
        rowElement.classList.contains("nh3d-inventory-item-active") &&
        !rowElement.classList.contains("nh3d-inventory-item-disabled")
      ) {
        pinnedActiveIndex = index;
        const activeRowRect = rowElement.getBoundingClientRect();
        pinnedActiveRowRect = activeRowRect;
        if (activeRowRect.height > 0) {
          virtualPointerY = activeRowRect.top + activeRowRect.height / 2;
        }
        break;
      }
    }
    const effectivePointerY =
      typeof virtualPointerY === "number" && Number.isFinite(virtualPointerY)
        ? virtualPointerY
        : pointerY;
    const pointerIsActive =
      typeof effectivePointerY === "number" &&
      Number.isFinite(effectivePointerY) &&
      (pinnedActiveIndex !== null || rawPointerIsActive);
    const smoothing = pointerIsActive ? 0.26 : 0.2;

    for (const [index, rowElement] of rows.entries()) {
      activeIndexes.add(index);
      let targetValue = 0;
      if (rowElement.classList.contains("nh3d-inventory-item-disabled")) {
        targetValue = 0;
      } else if (pointerIsActive) {
        const rowRect = rowElement.getBoundingClientRect();
        if (rowRect.height > 0) {
          const rowCenterY = rowRect.top + rowRect.height / 2;
          const distancePx = Math.abs(effectivePointerY - rowCenterY);
          const normalized = Math.max(0, 1 - distancePx / proximityFalloffPx);
          targetValue = normalized * normalized * (3 - 2 * normalized);
        }
      }

      const currentValue = hoverValuesByIndex.get(index) ?? 0;
      let nextValue = currentValue + (targetValue - currentValue) * smoothing;
      if (Math.abs(targetValue - nextValue) < 0.0015) {
        nextValue = targetValue;
      } else {
        needsAnotherFrame = true;
      }

      hoverValuesByIndex.set(index, nextValue);
      rowElement.style.setProperty("--nh3d-inv-hover", nextValue.toFixed(4));
    }

    for (const index of Array.from(hoverValuesByIndex.keys())) {
      if (!activeIndexes.has(index)) {
        hoverValuesByIndex.delete(index);
      }
    }

    const inventoryItemsContainer = inventoryItemsContainerRef.current;
    const inventoryItemsRect =
      inventoryItemsContainer?.getBoundingClientRect() ?? null;
    if (pinnedActiveRowRect && inventoryItemsContainer && inventoryItemsRect) {
      const viewportInsetPx = 6;
      const lowerBound = inventoryItemsRect.bottom - viewportInsetPx;
      const upperBound = inventoryItemsRect.top + viewportInsetPx;
      const overflowBelow = pinnedActiveRowRect.bottom - lowerBound;
      const overflowAbove = upperBound - pinnedActiveRowRect.top;
      if (overflowBelow > 0.5) {
        inventoryItemsContainer.scrollTop += overflowBelow;
      } else if (overflowAbove > 0.5) {
        inventoryItemsContainer.scrollTop -= overflowAbove;
      }
    }

    if (pinnedActiveRowRect && inventoryContextMenuRef.current) {
      const menuRect = inventoryContextMenuRef.current.getBoundingClientRect();
      const menuWidth =
        Number.isFinite(menuRect.width) && menuRect.width > 0
          ? menuRect.width
          : 220;
      const menuHeight =
        Number.isFinite(menuRect.height) && menuRect.height > 0
          ? menuRect.height
          : 260;
      const anchorRightX =
        pinnedActiveRowRect.right + inventoryContextMenuAnchorGapPx;
      const anchorBottomY =
        pinnedActiveRowRect.bottom + inventoryContextMenuAnchorBottomGapPx;
      setInventoryContextMenu((previous) => {
        if (!previous) {
          return previous;
        }
        const next = resolveInventoryContextMenuPosition(
          {
            ...previous,
            anchorBottomY,
            anchorRightX,
          },
          menuWidth,
          menuHeight,
          inventoryItemsRect,
        );
        const previousAnchorBottomY =
          typeof previous.anchorBottomY === "number" &&
          Number.isFinite(previous.anchorBottomY)
            ? previous.anchorBottomY
            : previous.y;
        const previousAnchorRightX =
          typeof previous.anchorRightX === "number" &&
          Number.isFinite(previous.anchorRightX)
            ? previous.anchorRightX
            : previous.x;
        if (
          Math.abs(next.x - previous.x) < 0.02 &&
          Math.abs(next.y - previous.y) < 0.02 &&
          Math.abs(anchorBottomY - previousAnchorBottomY) < 0.02 &&
          Math.abs(anchorRightX - previousAnchorRightX) < 0.02
        ) {
          return previous;
        }
        return {
          ...previous,
          x: next.x,
          y: next.y,
          anchorBottomY,
          anchorRightX,
        };
      });
    }

    if (needsAnotherFrame && typeof window !== "undefined") {
      inventoryRowProximityAnimationFrameRef.current =
        window.requestAnimationFrame(() => {
          applyInventoryRowProximity();
        });
    }
  }, [inventoryReducedMotionEnabled]);
  const scheduleInventoryRowProximityUpdate = useCallback((): void => {
    if (typeof window === "undefined") {
      return;
    }
    if (inventoryRowProximityAnimationFrameRef.current !== null) {
      return;
    }
    inventoryRowProximityAnimationFrameRef.current =
      window.requestAnimationFrame(() => {
        applyInventoryRowProximity();
      });
  }, [applyInventoryRowProximity]);
  const clearInventoryTouchFallbackClearTimer = useCallback((): void => {
    if (typeof window === "undefined") {
      return;
    }
    const activeTimer = inventoryTouchFallbackClearTimerRef.current;
    if (activeTimer === null) {
      return;
    }
    window.clearTimeout(activeTimer);
    inventoryTouchFallbackClearTimerRef.current = null;
  }, []);
  const scheduleInventoryTouchFallbackClear = useCallback((): void => {
    if (typeof window === "undefined") {
      return;
    }
    clearInventoryTouchFallbackClearTimer();
    inventoryTouchFallbackClearTimerRef.current = window.setTimeout(() => {
      inventoryTouchFallbackClearTimerRef.current = null;
      inventoryPointerActiveRef.current = false;
      inventoryPointerClientYRef.current = null;
      scheduleInventoryRowProximityUpdate();
    }, 220);
  }, [
    clearInventoryTouchFallbackClearTimer,
    scheduleInventoryRowProximityUpdate,
  ]);
  const normalizeInventoryActivationKey = useCallback(
    (key: string): "Enter" | "Space" | null => {
      if (key === "Enter" || key === "NumpadEnter") {
        return "Enter";
      }
      if (key === " " || key === "Space" || key === "Spacebar") {
        return "Space";
      }
      return null;
    },
    [],
  );
  const setInventoryRowRef = useCallback(
    (index: number, element: HTMLDivElement | null): void => {
      if (element) {
        inventoryRowRefs.current.set(index, element);
        const existingValue =
          inventoryRowHoverValueByIndexRef.current.get(index) ?? 0;
        element.style.setProperty("--nh3d-inv-hover", existingValue.toFixed(4));
      } else {
        inventoryRowRefs.current.delete(index);
      }
      if (inventory.visible) {
        scheduleInventoryRowProximityUpdate();
      }
    },
    [inventory.visible, scheduleInventoryRowProximityUpdate],
  );
  const handleInventoryPointerUpdate = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      clearInventoryTouchFallbackClearTimer();
      inventoryPointerActiveRef.current = true;
      inventoryPointerClientYRef.current = event.clientY;
      scheduleInventoryRowProximityUpdate();
    },
    [
      clearInventoryTouchFallbackClearTimer,
      scheduleInventoryRowProximityUpdate,
    ],
  );
  const handleInventoryPointerLeave = useCallback((): void => {
    if (
      inventoryRowPressCandidateRef.current &&
      inventoryRowPressCandidateRef.current.source === "pointer"
    ) {
      inventoryRowPressCandidateRef.current = null;
    }
    clearInventoryTouchFallbackClearTimer();
    inventoryPointerActiveRef.current = false;
    inventoryPointerClientYRef.current = null;
    scheduleInventoryRowProximityUpdate();
  }, [
    clearInventoryTouchFallbackClearTimer,
    scheduleInventoryRowProximityUpdate,
  ]);
  const handleInventoryPointerUp = (
    event: ReactPointerEvent<HTMLDivElement>,
  ): void => {
    activateInventoryRowPressCandidateFromRelease(
      "pointer",
      event.pointerId,
      event.clientX,
      event.clientY,
      event.target,
    );
    if (event.pointerType === "mouse") {
      return;
    }
    clearInventoryTouchFallbackClearTimer();
    inventoryPointerActiveRef.current = false;
    inventoryPointerClientYRef.current = null;
    scheduleInventoryRowProximityUpdate();
  };
  const handleInventoryPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      const pressCandidate = inventoryRowPressCandidateRef.current;
      if (
        pressCandidate &&
        pressCandidate.source === "pointer" &&
        pressCandidate.pointerId === event.pointerId
      ) {
        inventoryRowPressCandidateRef.current = null;
      }
      if (event.pointerType === "touch") {
        scheduleInventoryTouchFallbackClear();
        return;
      }
      handleInventoryPointerLeave();
    },
    [handleInventoryPointerLeave, scheduleInventoryTouchFallbackClear],
  );
  const handleInventoryTouchUpdate = useCallback(
    (event: ReactTouchEvent<HTMLDivElement>): void => {
      const primaryTouch = event.touches[0] ?? event.changedTouches[0];
      if (!primaryTouch) {
        return;
      }
      clearInventoryTouchFallbackClearTimer();
      inventoryPointerActiveRef.current = true;
      inventoryPointerClientYRef.current = primaryTouch.clientY;
      scheduleInventoryRowProximityUpdate();
    },
    [
      clearInventoryTouchFallbackClearTimer,
      scheduleInventoryRowProximityUpdate,
    ],
  );
  const handleInventoryTouchEnd = (
    event: ReactTouchEvent<HTMLDivElement>,
  ): void => {
    const releaseTouch = event.changedTouches[0] ?? event.touches[0];
    if (releaseTouch) {
      activateInventoryRowPressCandidateFromRelease(
        "touch",
        releaseTouch.identifier,
        releaseTouch.clientX,
        releaseTouch.clientY,
        event.target,
      );
    } else {
      const pressCandidate = inventoryRowPressCandidateRef.current;
      if (pressCandidate && pressCandidate.source === "touch") {
        inventoryRowPressCandidateRef.current = null;
      }
    }
    clearInventoryTouchFallbackClearTimer();
    inventoryPointerActiveRef.current = false;
    inventoryPointerClientYRef.current = null;
    scheduleInventoryRowProximityUpdate();
  };
  const handleInventoryTouchCancel = useCallback((): void => {
    if (
      inventoryRowPressCandidateRef.current &&
      inventoryRowPressCandidateRef.current.source === "touch"
    ) {
      inventoryRowPressCandidateRef.current = null;
    }
    scheduleInventoryTouchFallbackClear();
  }, [scheduleInventoryTouchFallbackClear]);
  const handleInventoryTouchMove = useCallback(
    (event: ReactTouchEvent<HTMLDivElement>): void => {
      handleInventoryTouchUpdate(event);
    },
    [handleInventoryTouchUpdate],
  );
  const handleInventoryItemsScroll = useCallback((): void => {
    if (!inventoryPointerActiveRef.current) {
      return;
    }
    scheduleInventoryRowProximityUpdate();
  }, [scheduleInventoryRowProximityUpdate]);
  const beginInventoryRowPressCandidate = useCallback(
    (
      source: InventoryRowPressCandidate["source"],
      pointerId: number,
      item: NethackMenuItem,
      accelerator: string,
      rowElement: HTMLDivElement | null,
      startClientX: number,
      startClientY: number,
    ): void => {
      if (!inventoryUsesFullRowAnimation) {
        return;
      }
      if (inventoryContextMenu) {
        return;
      }
      const normalizedAccelerator = String(accelerator || "").trim();
      if (
        !normalizedAccelerator ||
        !Number.isFinite(startClientX) ||
        !Number.isFinite(startClientY)
      ) {
        return;
      }
      inventoryRowPressCandidateRef.current = {
        source,
        pointerId,
        accelerator: normalizedAccelerator,
        item,
        rowElement,
        startClientX,
        startClientY,
        startedAtMs: Date.now(),
      };
    },
    [inventoryContextMenu, inventoryUsesFullRowAnimation],
  );
  const activateInventoryRowPressCandidateFromRelease = useCallback(
    (
      source: InventoryRowPressCandidate["source"],
      pointerId: number,
      releaseClientX: number,
      releaseClientY: number,
      releaseTarget: EventTarget | null,
    ): void => {
      if (!inventoryUsesFullRowAnimation) {
        inventoryRowPressCandidateRef.current = null;
        return;
      }
      const candidate = inventoryRowPressCandidateRef.current;
      if (
        !candidate ||
        candidate.source !== source ||
        candidate.pointerId !== pointerId
      ) {
        return;
      }
      inventoryRowPressCandidateRef.current = null;
      if (
        !Number.isFinite(releaseClientX) ||
        !Number.isFinite(releaseClientY)
      ) {
        return;
      }
      const elapsedMs = Date.now() - candidate.startedAtMs;
      const preferInitialSelection =
        elapsedMs <= inventoryRowPressPreferInitialMs;
      if (!preferInitialSelection) {
        // After the short tap window, fall back to normal release-target behavior.
        return;
      }

      const releaseElement =
        releaseTarget instanceof Element ? releaseTarget : null;
      const releaseRowElement = releaseElement?.closest(".nh3d-inventory-item");
      const releaseAccelerator =
        releaseRowElement instanceof HTMLElement
          ? String(releaseRowElement.dataset.nh3dAccelerator || "").trim()
          : "";
      if (releaseAccelerator && releaseAccelerator === candidate.accelerator) {
        return;
      }

      const activeAccelerator = String(
        inventoryContextMenu?.accelerator || "",
      ).trim();
      if (activeAccelerator && activeAccelerator === candidate.accelerator) {
        setInventoryContextMenu(null);
        return;
      }

      const anchorRect =
        candidate.rowElement && candidate.rowElement.isConnected
          ? candidate.rowElement.getBoundingClientRect()
          : undefined;
      openInventoryContextMenu(
        candidate.item,
        candidate.startClientX,
        candidate.startClientY,
        anchorRect,
      );
    },
    [inventoryContextMenu?.accelerator, inventoryUsesFullRowAnimation],
  );
  const handleInventoryRowActivationDismissCapture = useCallback(
    (target: EventTarget | null): void => {
      if (!inventoryUsesFullRowAnimation) {
        return;
      }
      if (!inventoryContextMenu) {
        return;
      }
      const targetElement = target instanceof Element ? target : null;
      if (!targetElement) {
        return;
      }
      const rowElement = targetElement.closest(".nh3d-inventory-item");
      if (!(rowElement instanceof HTMLElement)) {
        return;
      }
      const accelerator = rowElement.dataset.nh3dAccelerator || "";
      const normalizedAccelerator = String(accelerator).trim();
      if (!normalizedAccelerator) {
        return;
      }
      inventoryRowPressCandidateRef.current = null;
      setInventoryContextMenu(null);
    },
    [inventoryContextMenu, inventoryUsesFullRowAnimation],
  );
  const handleInventoryRowPointerDownCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      handleInventoryRowActivationDismissCapture(event.target);
    },
    [handleInventoryRowActivationDismissCapture],
  );
  const handleInventoryRowTouchStartCapture = useCallback(
    (event: ReactTouchEvent<HTMLDivElement>): void => {
      handleInventoryRowActivationDismissCapture(event.target);
    },
    [handleInventoryRowActivationDismissCapture],
  );
  const representativeGlyphByTileId = useMemo(
    () => buildRepresentativeGlyphByTileId(GLYPH_CATALOG_367),
    [],
  );
  const representativeGlyphNumberByTileId = useMemo(
    () => buildRepresentativeGlyphNumberByTileId(GLYPH_CATALOG_367),
    [],
  );
  const showTilePickerGlyphNumber = import.meta.env.DEV;
  const defaultDarkWallTileId = Math.max(
    0,
    Math.trunc(defaultNh3dClientOptions.darkCorridorWallTileOverrideTileId),
  );
  const defaultDarkWallSolidColorHex = normalizeSolidChromaKeyHex(
    defaultNh3dClientOptions.darkCorridorWallSolidColorHex,
  );
  const defaultDarkWallSolidColorHexFps = normalizeSolidChromaKeyHex(
    defaultNh3dClientOptions.darkCorridorWallSolidColorHexFps,
  );
  const selectedDarkWallTileId = useMemo(() => {
    const tilesetPath = String(clientOptionsDraft.tilesetPath || "").trim();
    const mappedTileId = tilesetPath
      ? clientOptionsDraft.darkCorridorWallTileOverrideTileIdByTileset[
          tilesetPath
        ]
      : undefined;
    if (typeof mappedTileId === "number" && Number.isFinite(mappedTileId)) {
      return Math.max(0, Math.trunc(mappedTileId));
    }
    return defaultDarkWallTileId;
  }, [
    clientOptionsDraft.darkCorridorWallTileOverrideTileIdByTileset,
    clientOptionsDraft.tilesetPath,
    defaultDarkWallTileId,
  ]);
  const selectedDarkWallSolidColorHex = useMemo(() => {
    const tilesetPath = String(clientOptionsDraft.tilesetPath || "").trim();
    const mappedColorHex = tilesetPath
      ? clientOptionsDraft.darkCorridorWallSolidColorHexByTileset[tilesetPath]
      : undefined;
    if (typeof mappedColorHex === "string") {
      return normalizeSolidChromaKeyHex(mappedColorHex);
    }
    return defaultDarkWallSolidColorHex;
  }, [
    clientOptionsDraft.darkCorridorWallSolidColorHexByTileset,
    clientOptionsDraft.tilesetPath,
    defaultDarkWallSolidColorHex,
  ]);
  const selectedDarkWallSolidColorHexFps = useMemo(() => {
    const tilesetPath = String(clientOptionsDraft.tilesetPath || "").trim();
    const mappedColorHex = tilesetPath
      ? clientOptionsDraft.darkCorridorWallSolidColorHexFpsByTileset[
          tilesetPath
        ]
      : undefined;
    if (typeof mappedColorHex === "string") {
      return normalizeSolidChromaKeyHex(mappedColorHex);
    }
    return defaultDarkWallSolidColorHexFps;
  }, [
    clientOptionsDraft.darkCorridorWallSolidColorHexFpsByTileset,
    clientOptionsDraft.tilesetPath,
    defaultDarkWallSolidColorHexFps,
  ]);
  const selectedDarkWallSolidColorGridEnabled = useMemo(() => {
    const tilesetPath = String(clientOptionsDraft.tilesetPath || "").trim();
    const mappedEnabled = tilesetPath
      ? clientOptionsDraft.darkCorridorWallSolidColorGridEnabledByTileset[
          tilesetPath
        ]
      : undefined;
    if (typeof mappedEnabled === "boolean") {
      return mappedEnabled;
    }
    return Boolean(clientOptionsDraft.darkCorridorWallSolidColorGridEnabled);
  }, [
    clientOptionsDraft.darkCorridorWallSolidColorGridEnabled,
    clientOptionsDraft.darkCorridorWallSolidColorGridEnabledByTileset,
    clientOptionsDraft.tilesetPath,
  ]);
  const selectedDarkWallSolidColorGridDarknessPercent = useMemo(() => {
    const tilesetPath = String(clientOptionsDraft.tilesetPath || "").trim();
    const mappedPercent = tilesetPath
      ? clientOptionsDraft
          .darkCorridorWallSolidColorGridDarknessPercentByTileset[tilesetPath]
      : undefined;
    const fallback =
      clientOptionsDraft.darkCorridorWallSolidColorGridDarknessPercent;
    const source =
      typeof mappedPercent === "number" && Number.isFinite(mappedPercent)
        ? mappedPercent
        : fallback;
    return Math.max(0, Math.min(100, Math.round(source)));
  }, [
    clientOptionsDraft.darkCorridorWallSolidColorGridDarknessPercent,
    clientOptionsDraft.darkCorridorWallSolidColorGridDarknessPercentByTileset,
    clientOptionsDraft.tilesetPath,
  ]);
  const selectedDarkWallGlyphChar =
    representativeGlyphByTileId.get(selectedDarkWallTileId) ?? " ";
  const selectedDarkWallGlyphLabel = formatTileGlyphLabel(
    selectedDarkWallGlyphChar,
  );
  const selectedDarkWallGlyphNumber =
    representativeGlyphNumberByTileId.get(selectedDarkWallTileId) ?? null;
  const resolveDraftBackgroundTileIdByTilesetPath = (
    rawTilesetPath: string | null | undefined,
  ): number => {
    const tilesetPath = String(rawTilesetPath || "").trim();
    const mappedTileId = tilesetPath
      ? clientOptionsDraft.tilesetBackgroundTileIdByTileset[tilesetPath]
      : undefined;
    if (typeof mappedTileId === "number" && Number.isFinite(mappedTileId)) {
      return Math.max(0, Math.trunc(mappedTileId));
    }
    return resolveDefaultNh3dTilesetBackgroundTileId(tilesetPath);
  };
  const resolveDraftBackgroundRemovalModeByTilesetPath = (
    rawTilesetPath: string | null | undefined,
  ): TilesetBackgroundRemovalMode => {
    const tilesetPath = String(rawTilesetPath || "").trim();
    const mappedMode = tilesetPath
      ? clientOptionsDraft.tilesetBackgroundRemovalModeByTileset[tilesetPath]
      : undefined;
    if (mappedMode === "solid" || mappedMode === "tile") {
      return mappedMode;
    }
    return "tile";
  };
  const resolveDraftSolidChromaKeyByTilesetPath = (
    rawTilesetPath: string | null | undefined,
  ): string => {
    const tilesetPath = String(rawTilesetPath || "").trim();
    const mappedColorHex = tilesetPath
      ? clientOptionsDraft.tilesetSolidChromaKeyColorHexByTileset[tilesetPath]
      : undefined;
    if (typeof mappedColorHex === "string") {
      return normalizeSolidChromaKeyHex(mappedColorHex);
    }
    return normalizeSolidChromaKeyHex(
      resolveDefaultNh3dTilesetSolidChromaKeyColorHex(tilesetPath),
    );
  };
  const selectedTilesetManagerEditPath = String(
    tilesetManagerEditPath || "",
  ).trim();
  const selectedTilesetManagerEditEntry = useMemo(
    () => findNh3dTilesetByPath(selectedTilesetManagerEditPath),
    [selectedTilesetManagerEditPath, tilesetCatalog],
  );
  const selectedTilesetManagerEditUserRecord = useMemo(
    () => userTilesetRecordByPath.get(selectedTilesetManagerEditPath) ?? null,
    [selectedTilesetManagerEditPath, userTilesetRecordByPath],
  );
  const tilesetManagerInNewMode = tilesetManagerMode === "new";
  const tilesetManagerNameInputDisabled =
    !tilesetManagerInNewMode && !selectedTilesetManagerEditUserRecord;
  const tilesetManagerDefaultBackgroundTileId = useMemo(
    () =>
      resolveDefaultNh3dTilesetBackgroundTileId(selectedTilesetManagerEditPath),
    [selectedTilesetManagerEditPath, tilesetCatalog],
  );
  const tilesetManagerBackgroundTileId = useMemo(
    () =>
      resolveDraftBackgroundTileIdByTilesetPath(selectedTilesetManagerEditPath),
    [
      clientOptionsDraft.tilesetBackgroundTileIdByTileset,
      selectedTilesetManagerEditPath,
      tilesetCatalog,
    ],
  );
  const tilesetManagerBackgroundRemovalMode =
    useMemo<TilesetBackgroundRemovalMode>(
      () =>
        resolveDraftBackgroundRemovalModeByTilesetPath(
          selectedTilesetManagerEditPath,
        ),
      [
        clientOptionsDraft.tilesetBackgroundRemovalModeByTileset,
        selectedTilesetManagerEditPath,
        tilesetCatalog,
      ],
    );
  const tilesetManagerSolidChromaKeyColorHex = useMemo(
    () =>
      resolveDraftSolidChromaKeyByTilesetPath(selectedTilesetManagerEditPath),
    [
      clientOptionsDraft.tilesetSolidChromaKeyColorHexByTileset,
      selectedTilesetManagerEditPath,
      tilesetCatalog,
    ],
  );
  const tilesetManagerBackgroundGlyphChar =
    representativeGlyphByTileId.get(tilesetManagerBackgroundTileId) ?? " ";
  const tilesetManagerBackgroundGlyphLabel = formatTileGlyphLabel(
    tilesetManagerBackgroundGlyphChar,
  );
  const tilesetManagerBackgroundGlyphNumber =
    representativeGlyphNumberByTileId.get(tilesetManagerBackgroundTileId) ??
    null;
  const selectedTilesetEntry = useMemo(
    () => findNh3dTilesetByPath(clientOptionsDraft.tilesetPath),
    [clientOptionsDraft.tilesetPath, tilesetCatalog],
  );
  const isVultureTilesetSelected =
    clientOptionsDraft.tilesetMode === "tiles" &&
    selectedTilesetEntry?.source === "vulture";
  const tilePickerEntries = useMemo<TilePickerEntry[]>(() => {
    if (!tileAtlasState.loaded || tileAtlasState.tileCount <= 0) {
      return [];
    }
    const entries: TilePickerEntry[] = [];
    for (let tileId = 0; tileId < tileAtlasState.tileCount; tileId += 1) {
      const glyphChar = representativeGlyphByTileId.get(tileId) ?? " ";
      entries.push({
        tileId,
        glyphLabel: formatTileGlyphLabel(glyphChar),
        glyphNumber: representativeGlyphNumberByTileId.get(tileId) ?? null,
      });
    }
    return entries;
  }, [
    representativeGlyphByTileId,
    representativeGlyphNumberByTileId,
    tileAtlasState.loaded,
    tileAtlasState.tileCount,
  ]);
  const tilePickerStatusText = !selectedTilesetEntry
    ? "No tileset atlas available."
    : tileAtlasState.failed
      ? "Unable to load tile atlas."
      : tileAtlasState.loaded
        ? "Tile atlas loaded."
        : "Loading tile atlas...";
  const tilePreviewDataUrlByIdRaw = useMemo(() => {
    const previewByTileId = new Map<number, string>();
    if (
      !tileAtlasState.loaded ||
      !tileAtlasImage ||
      tileAtlasState.tileCount <= 0
    ) {
      return previewByTileId;
    }
    for (let tileId = 0; tileId < tileAtlasState.tileCount; tileId += 1) {
      const dataUrl = createIsolatedAtlasTilePreviewDataUrl(
        tileAtlasImage,
        tileId,
        tileAtlasState.tileSourceSize,
        tileAtlasState.columns,
        tileAtlasState.rows,
      );
      if (!dataUrl) {
        continue;
      }
      previewByTileId.set(tileId, dataUrl);
    }
    return previewByTileId;
  }, [
    tileAtlasImage,
    tileAtlasState.columns,
    tileAtlasState.loaded,
    tileAtlasState.rows,
    tileAtlasState.tileCount,
    tileAtlasState.tileSourceSize,
  ]);
  const tilePreviewDataUrlById = useMemo(() => {
    if (!clientOptions.uiTileBackgroundRemoval) {
      return tilePreviewDataUrlByIdRaw;
    }
    const previewByTileId = new Map<number, string>();
    if (
      !tileAtlasState.loaded ||
      !tileAtlasImage ||
      tileAtlasState.tileCount <= 0
    ) {
      return previewByTileId;
    }
    const tilePreviewBackgroundRemoval = {
      enabled: true,
      mode: clientOptions.tilesetBackgroundRemovalMode,
      solidChromaKeyColorHex: clientOptions.tilesetSolidChromaKeyColorHex,
      backgroundTilePixels:
        clientOptions.tilesetBackgroundRemovalMode === "tile"
          ? getAtlasTilePixels(
              tileAtlasImage,
              tileAtlasState.tileSourceSize,
              clientOptions.tilesetBackgroundTileId,
              tileAtlasState.columns,
              tileAtlasState.rows,
            )
          : null,
    };
    for (let tileId = 0; tileId < tileAtlasState.tileCount; tileId += 1) {
      const dataUrl = createIsolatedAtlasTilePreviewDataUrl(
        tileAtlasImage,
        tileId,
        tileAtlasState.tileSourceSize,
        tileAtlasState.columns,
        tileAtlasState.rows,
        tilePreviewBackgroundRemoval,
      );
      if (!dataUrl) {
        continue;
      }
      previewByTileId.set(tileId, dataUrl);
    }
    return previewByTileId;
  }, [
    clientOptions.tilesetBackgroundRemovalMode,
    clientOptions.tilesetBackgroundTileId,
    clientOptions.tilesetSolidChromaKeyColorHex,
    clientOptions.uiTileBackgroundRemoval,
    tileAtlasImage,
    tileAtlasState.columns,
    tileAtlasState.loaded,
    tileAtlasState.rows,
    tileAtlasState.tileCount,
    tileAtlasState.tileSourceSize,
    tilePreviewDataUrlByIdRaw,
  ]);
  const getTilePreviewDataUrlForOptions = (tileId: number): string | null => {
    if (tileAtlasState.tileCount <= 0) {
      return null;
    }
    const clampedTileId = Math.max(
      0,
      Math.min(tileAtlasState.tileCount - 1, Math.trunc(tileId)),
    );
    return tilePreviewDataUrlByIdRaw.get(clampedTileId) ?? null;
  };
  const renderTilePreviewImageForOptions = (
    tileId: number,
  ): JSX.Element | null => {
    const tilePreviewDataUrl = getTilePreviewDataUrlForOptions(tileId);
    if (!tilePreviewDataUrl) {
      return null;
    }
    return (
      <img
        alt=""
        aria-hidden="true"
        draggable={false}
        src={tilePreviewDataUrl}
      />
    );
  };
  const getTilePreviewDataUrl = (tileId: number): string | null => {
    if (tileAtlasState.tileCount <= 0) {
      return null;
    }
    const clampedTileId = Math.max(
      0,
      Math.min(tileAtlasState.tileCount - 1, Math.trunc(tileId)),
    );
    return tilePreviewDataUrlById.get(clampedTileId) ?? null;
  };
  const renderTilePreviewImageFromDataUrl = (
    tilePreviewDataUrl: string,
  ): JSX.Element | null => {
    if (!tilePreviewDataUrl) {
      return null;
    }
    return (
      <img
        alt=""
        aria-hidden="true"
        draggable={false}
        src={tilePreviewDataUrl}
      />
    );
  };
  const renderTilePreviewImage = (tileId: number): JSX.Element | null => {
    const tilePreviewDataUrl = getTilePreviewDataUrl(tileId);
    if (!tilePreviewDataUrl) {
      return null;
    }
    return renderTilePreviewImageFromDataUrl(tilePreviewDataUrl);
  };
  const renderMenuItemTilePreview = (
    item: NethackMenuItem | null | undefined,
    tileId: number | null,
  ): JSX.Element | null => {
    const dataUrl = resolveMenuItemTilePreviewDataUrl(item);
    if (dataUrl) {
      return renderTilePreviewImageFromDataUrl(dataUrl);
    }
    if (tileId === null) {
      return null;
    }
    return renderTilePreviewImage(tileId);
  };
  const tilesetManagerTilePickerEntries = useMemo<TilePickerEntry[]>(() => {
    if (
      !tilesetManagerAtlasState.loaded ||
      tilesetManagerAtlasState.tileCount <= 0
    ) {
      return [];
    }
    const entries: TilePickerEntry[] = [];
    for (
      let tileId = 0;
      tileId < tilesetManagerAtlasState.tileCount;
      tileId += 1
    ) {
      const glyphChar = representativeGlyphByTileId.get(tileId) ?? " ";
      entries.push({
        tileId,
        glyphLabel: formatTileGlyphLabel(glyphChar),
        glyphNumber: representativeGlyphNumberByTileId.get(tileId) ?? null,
      });
    }
    return entries;
  }, [
    representativeGlyphByTileId,
    representativeGlyphNumberByTileId,
    tilesetManagerAtlasState.loaded,
    tilesetManagerAtlasState.tileCount,
  ]);
  const tilesetManagerTilePickerStatusText = !selectedTilesetManagerEditEntry
    ? "No tileset atlas available."
    : tilesetManagerAtlasState.failed
      ? "Unable to load tile atlas."
      : tilesetManagerAtlasState.loaded
        ? "Tile atlas loaded."
        : "Loading tile atlas...";
  const tilesetManagerTilePreviewDataUrlById = useMemo(() => {
    const previewByTileId = new Map<number, string>();
    if (
      !tilesetManagerAtlasState.loaded ||
      !tilesetManagerAtlasImage ||
      tilesetManagerAtlasState.tileCount <= 0
    ) {
      return previewByTileId;
    }
    for (
      let tileId = 0;
      tileId < tilesetManagerAtlasState.tileCount;
      tileId += 1
    ) {
      const dataUrl = createIsolatedAtlasTilePreviewDataUrl(
        tilesetManagerAtlasImage,
        tileId,
        tilesetManagerAtlasState.tileSourceSize,
        tilesetManagerAtlasState.columns,
        tilesetManagerAtlasState.rows,
      );
      if (!dataUrl) {
        continue;
      }
      previewByTileId.set(tileId, dataUrl);
    }
    return previewByTileId;
  }, [
    tilesetManagerAtlasImage,
    tilesetManagerAtlasState.columns,
    tilesetManagerAtlasState.loaded,
    tilesetManagerAtlasState.rows,
    tilesetManagerAtlasState.tileCount,
    tilesetManagerAtlasState.tileSourceSize,
  ]);
  const getTilesetManagerTilePreviewDataUrl = (
    tileId: number,
  ): string | null => {
    if (tilesetManagerAtlasState.tileCount <= 0) {
      return null;
    }
    const clampedTileId = Math.max(
      0,
      Math.min(tilesetManagerAtlasState.tileCount - 1, Math.trunc(tileId)),
    );
    return tilesetManagerTilePreviewDataUrlById.get(clampedTileId) ?? null;
  };
  const renderTilesetManagerTilePreviewImage = (
    tileId: number,
  ): JSX.Element | null => {
    const tilePreviewDataUrl = getTilesetManagerTilePreviewDataUrl(tileId);
    if (!tilePreviewDataUrl) {
      return null;
    }
    return (
      <img
        alt=""
        aria-hidden="true"
        draggable={false}
        src={tilePreviewDataUrl}
      />
    );
  };

  useEffect(() => {
    if (!canvasRootRef.current || !characterCreationConfig) {
      return;
    }
    const engine = new Nethack3DEngine({
      mountElement: canvasRootRef.current,
      uiAdapter: adapter,
      characterCreationConfig,
      clientOptions,
    });
    setEngineController(engine);
    registerDebugHelpers(engine);
    return () => {
      setEngineController(null);
    };
  }, [adapter, characterCreationConfig, setEngineController]);

  useEffect(() => {
    if (!controller) {
      return;
    }
    controller.setClientOptions(clientOptions);
  }, [controller, clientOptions]);

  useEffect(() => {
    if (!controller || !isControllerSupportPromptVisible) {
      return;
    }
    controller.setClientOptions(
      normalizeNh3dClientOptions({
        ...clientOptions,
        controllerEnabled: true,
      }),
    );
  }, [clientOptions, controller, isControllerSupportPromptVisible]);

  useEffect(() => {
    if (!hasHydratedUserTilesets) {
      return;
    }
    persistNh3dClientOptionsToIndexedDb(clientOptions).catch((error) => {
      console.warn("Failed to persist client options to IndexedDB:", error);
    });
  }, [clientOptions, hasHydratedUserTilesets]);

  useEffect(() => {
    let disposed = false;
    loadPersistedNh3dStartupCharacterPreferences()
      .then((persistedPreferences) => {
        if (disposed || !persistedPreferences) {
          return;
        }
        setRandomCharacterName(
          persistedPreferences.randomName ||
            startupDefaultCharacterPreferences.randomName,
        );
        setCreateCharacterName(
          persistedPreferences.createName ||
            startupDefaultCharacterPreferences.createName,
        );
        const normalizedPersistedCreateSelection =
          normalizeStartupCreateCharacterSelection({
            role: persistedPreferences.createRole,
            race: persistedPreferences.createRace,
            gender: persistedPreferences.createGender,
            align: persistedPreferences.createAlign,
          });
        setCreateRole(normalizedPersistedCreateSelection.role);
        setCreateRace(normalizedPersistedCreateSelection.race);
        setCreateGender(normalizedPersistedCreateSelection.gender);
        setCreateAlign(normalizedPersistedCreateSelection.align);
      })
      .catch((error) => {
        if (disposed) {
          return;
        }
        console.warn(
          "Failed to hydrate startup character preferences from IndexedDB:",
          error,
        );
      })
      .finally(() => {
        if (disposed) {
          return;
        }
        setHasHydratedStartupCharacterPreferences(true);
      });

    return () => {
      disposed = true;
    };
  }, [startupDefaultCharacterPreferences]);

  useEffect(() => {
    if (!hasHydratedStartupCharacterPreferences) {
      return;
    }
    persistNh3dStartupCharacterPreferencesToIndexedDb(
      startupCharacterPreferences,
    ).catch((error) => {
      console.warn(
        "Failed to persist startup character preferences to IndexedDB:",
        error,
      );
    });
  }, [hasHydratedStartupCharacterPreferences, startupCharacterPreferences]);

  useEffect(() => {
    let disposed = false;
    loadPersistedNh3dStartupInitOptions()
      .then((persistedValues) => {
        if (disposed || !persistedValues) {
          return;
        }
        setStartupInitOptionValues(persistedValues);
      })
      .catch((error) => {
        if (disposed) {
          return;
        }
        console.warn(
          "Failed to hydrate startup init options from IndexedDB:",
          error,
        );
      })
      .finally(() => {
        if (disposed) {
          return;
        }
        setHasHydratedStartupInitOptions(true);
      });

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!hasHydratedStartupInitOptions) {
      return;
    }
    persistNh3dStartupInitOptionsToIndexedDb(startupInitOptionValues).catch(
      (error) => {
        console.warn(
          "Failed to persist startup init options to IndexedDB:",
          error,
        );
      },
    );
  }, [hasHydratedStartupInitOptions, startupInitOptionValues]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!selectedTilesetEntry) {
      setTileAtlasState(createDefaultTileAtlasState());
      setTileAtlasImage(null);
      return;
    }
    let disposed = false;
    const atlasImage = new window.Image();
    const tilesetAssetUrl =
      resolveNh3dTilesetAssetUrl(selectedTilesetEntry.path) ??
      selectedTilesetEntry.path;

    const handleLoad = (): void => {
      if (disposed) {
        return;
      }
      const naturalWidth = Math.max(0, Math.trunc(atlasImage.naturalWidth));
      const tileSourceSize =
        inferNh3dTilesetTileSizeFromAtlasWidth(naturalWidth);
      const height = Math.max(0, Math.trunc(atlasImage.naturalHeight));
      const columns = nh3dTilesetAtlasTileColumns;
      const rows = Math.max(0, Math.floor(height / tileSourceSize));
      const tileCount = columns > 0 && rows > 0 ? columns * rows : 0;
      setTileAtlasState({
        loaded: tileCount > 0,
        failed: tileCount <= 0,
        tileSourceSize,
        columns,
        rows,
        tileCount,
      });
      setTileAtlasImage(tileCount > 0 ? atlasImage : null);
    };

    const handleError = (): void => {
      if (disposed) {
        return;
      }
      setTileAtlasState({
        ...createDefaultTileAtlasState(),
        failed: true,
      });
      setTileAtlasImage(null);
    };

    atlasImage.addEventListener("load", handleLoad);
    atlasImage.addEventListener("error", handleError);
    atlasImage.src = tilesetAssetUrl;

    return () => {
      disposed = true;
      atlasImage.removeEventListener("load", handleLoad);
      atlasImage.removeEventListener("error", handleError);
    };
  }, [selectedTilesetEntry]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!selectedTilesetManagerEditEntry) {
      setTilesetManagerAtlasState(createDefaultTileAtlasState());
      setTilesetManagerAtlasImage(null);
      return;
    }
    let disposed = false;
    const atlasImage = new window.Image();
    const tilesetAssetUrl =
      resolveNh3dTilesetAssetUrl(selectedTilesetManagerEditEntry.path) ??
      selectedTilesetManagerEditEntry.path;

    const handleLoad = (): void => {
      if (disposed) {
        return;
      }
      const naturalWidth = Math.max(0, Math.trunc(atlasImage.naturalWidth));
      const tileSourceSize =
        inferNh3dTilesetTileSizeFromAtlasWidth(naturalWidth);
      const height = Math.max(0, Math.trunc(atlasImage.naturalHeight));
      const columns = nh3dTilesetAtlasTileColumns;
      const rows = Math.max(0, Math.floor(height / tileSourceSize));
      const tileCount = columns > 0 && rows > 0 ? columns * rows : 0;
      setTilesetManagerAtlasState({
        loaded: tileCount > 0,
        failed: tileCount <= 0,
        tileSourceSize,
        columns,
        rows,
        tileCount,
      });
      setTilesetManagerAtlasImage(tileCount > 0 ? atlasImage : null);
    };

    const handleError = (): void => {
      if (disposed) {
        return;
      }
      setTilesetManagerAtlasState({
        ...createDefaultTileAtlasState(),
        failed: true,
      });
      setTilesetManagerAtlasImage(null);
    };

    atlasImage.addEventListener("load", handleLoad);
    atlasImage.addEventListener("error", handleError);
    atlasImage.src = tilesetAssetUrl;

    return () => {
      disposed = true;
      atlasImage.removeEventListener("load", handleLoad);
      atlasImage.removeEventListener("error", handleError);
    };
  }, [selectedTilesetManagerEditEntry]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return;
    }

    const mediaQuery = window.matchMedia("(pointer: coarse)");
    const handleMediaQueryChange = (): void => {
      setIsMobileViewport(mediaQuery.matches);
    };

    handleMediaQueryChange();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleMediaQueryChange);
    } else {
      mediaQuery.addListener(handleMediaQueryChange);
    }
    return () => {
      if (typeof mediaQuery.removeEventListener === "function") {
        mediaQuery.removeEventListener("change", handleMediaQueryChange);
      } else {
        mediaQuery.removeListener(handleMediaQueryChange);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const statsBar = document.getElementById("stats-bar");
    if (!statsBar) {
      setStatsBarHeight(0);
      return;
    }

    const updateHeight = (): void => {
      setStatsBarHeight(statsBar.getBoundingClientRect().height);
    };

    updateHeight();

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(updateHeight);
      resizeObserver.observe(statsBar);
    }

    window.addEventListener("resize", updateHeight);
    return () => {
      window.removeEventListener("resize", updateHeight);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [
    characterCreationConfig,
    connectionState,
    loadingVisible,
    isMobileViewport,
  ]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof document === "undefined" ||
      !window.matchMedia
    ) {
      return;
    }

    const root = document.documentElement;
    if (!isMobileViewport) {
      root.classList.remove("nh3d-mobile-browser-mode");
      return;
    }

    const standaloneQuery = window.matchMedia("(display-mode: standalone)");
    const fullscreenQuery = window.matchMedia("(display-mode: fullscreen)");
    const minimalUiQuery = window.matchMedia("(display-mode: minimal-ui)");

    const updateMobileBrowserModeClass = (): void => {
      const iOSStandalone =
        typeof (window.navigator as { standalone?: boolean }).standalone ===
          "boolean" &&
        Boolean((window.navigator as { standalone?: boolean }).standalone);
      const isStandaloneDisplayMode =
        iOSStandalone ||
        standaloneQuery.matches ||
        fullscreenQuery.matches ||
        minimalUiQuery.matches;
      root.classList.toggle(
        "nh3d-mobile-browser-mode",
        !isStandaloneDisplayMode,
      );
    };

    updateMobileBrowserModeClass();

    const queries = [standaloneQuery, fullscreenQuery, minimalUiQuery];
    const addChangeListener = (query: MediaQueryList): void => {
      if (typeof query.addEventListener === "function") {
        query.addEventListener("change", updateMobileBrowserModeClass);
      } else {
        query.addListener(updateMobileBrowserModeClass);
      }
    };
    const removeChangeListener = (query: MediaQueryList): void => {
      if (typeof query.removeEventListener === "function") {
        query.removeEventListener("change", updateMobileBrowserModeClass);
      } else {
        query.removeListener(updateMobileBrowserModeClass);
      }
    };

    for (const query of queries) {
      addChangeListener(query);
    }

    return () => {
      for (const query of queries) {
        removeChangeListener(query);
      }
      root.classList.remove("nh3d-mobile-browser-mode");
    };
  }, [isMobileViewport]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const root = document.documentElement;
    if (!isMobileViewport) {
      root.style.removeProperty("--nh3d-mobile-visible-height");
      root.style.removeProperty("--nh3d-mobile-visible-top-offset");
      root.style.removeProperty("--nh3d-mobile-visible-bottom-offset");
      return;
    }

    const updateMobileVisibleViewportMetrics = (): void => {
      const visualViewport = window.visualViewport;
      const layoutViewportHeight = window.innerHeight;
      const viewportOffsetTop = visualViewport ? visualViewport.offsetTop : 0;
      const viewportBottomOffset = visualViewport
        ? Math.max(
            0,
            layoutViewportHeight -
              (visualViewport.height + visualViewport.offsetTop),
          )
        : 0;

      root.style.setProperty(
        "--nh3d-mobile-visible-height",
        `${Math.max(0, Math.round(layoutViewportHeight))}px`,
      );
      root.style.setProperty(
        "--nh3d-mobile-visible-top-offset",
        `${Math.max(0, Math.round(viewportOffsetTop))}px`,
      );
      root.style.setProperty(
        "--nh3d-mobile-visible-bottom-offset",
        `${Math.max(0, Math.round(viewportBottomOffset))}px`,
      );
    };

    updateMobileVisibleViewportMetrics();
    window.addEventListener("resize", updateMobileVisibleViewportMetrics);
    const orientationRefreshTimeoutIds: number[] = [];
    const handleOrientationViewportRefresh = (): void => {
      updateMobileVisibleViewportMetrics();
      const triggerResize = () => {
        updateMobileVisibleViewportMetrics();
        window.dispatchEvent(new Event("resize"));
      };
      orientationRefreshTimeoutIds.push(window.setTimeout(triggerResize, 120));
      orientationRefreshTimeoutIds.push(window.setTimeout(triggerResize, 280));
    };
    window.addEventListener(
      "orientationchange",
      handleOrientationViewportRefresh,
    );

    const visualViewport = window.visualViewport;
    if (visualViewport) {
      visualViewport.addEventListener(
        "resize",
        updateMobileVisibleViewportMetrics,
      );
      visualViewport.addEventListener(
        "scroll",
        updateMobileVisibleViewportMetrics,
      );
    }
    const screenOrientation = window.screen?.orientation;
    if (
      screenOrientation &&
      typeof screenOrientation.addEventListener === "function"
    ) {
      screenOrientation.addEventListener(
        "change",
        handleOrientationViewportRefresh,
      );
    }

    return () => {
      window.removeEventListener("resize", updateMobileVisibleViewportMetrics);
      window.removeEventListener(
        "orientationchange",
        handleOrientationViewportRefresh,
      );
      if (visualViewport) {
        visualViewport.removeEventListener(
          "resize",
          updateMobileVisibleViewportMetrics,
        );
        visualViewport.removeEventListener(
          "scroll",
          updateMobileVisibleViewportMetrics,
        );
      }
      if (
        screenOrientation &&
        typeof screenOrientation.removeEventListener === "function"
      ) {
        screenOrientation.removeEventListener(
          "change",
          handleOrientationViewportRefresh,
        );
      }
      for (const timeoutId of orientationRefreshTimeoutIds) {
        window.clearTimeout(timeoutId);
      }
      root.style.removeProperty("--nh3d-mobile-visible-height");
      root.style.removeProperty("--nh3d-mobile-visible-top-offset");
      root.style.removeProperty("--nh3d-mobile-visible-bottom-offset");
    };
  }, [isMobileViewport]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const root = document.documentElement;
    root.style.setProperty("--nh3d-stats-bar-height", `${statsBarHeight}px`);
    return () => {
      root.style.removeProperty("--nh3d-stats-bar-height");
    };
  }, [statsBarHeight]);

  const isMobileGameRunning =
    (isMobileViewport ||
      (!isMobileViewport &&
        clientOptions.desktopTouchInterfaceMode !== "off")) &&
    characterCreationConfig !== null &&
    connectionState === "running" &&
    !loadingVisible;

  const isDesktopGameRunning =
    !(isMobileViewport || clientOptions.desktopTouchInterfaceMode !== "off") &&
    characterCreationConfig !== null &&
    connectionState === "running" &&
    !loadingVisible;

  const forcedDesktopTouchInterfaceMode = !isMobileViewport
    ? clientOptions.desktopTouchInterfaceMode
    : "off";
  const isDesktopTouchInterfaceForced =
    forcedDesktopTouchInterfaceMode !== "off";

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const root = document.documentElement;
    root.classList.toggle(
      "nh3d-force-touch-layout",
      isDesktopTouchInterfaceForced,
    );
    root.classList.toggle(
      "nh3d-force-touch-layout-portrait",
      forcedDesktopTouchInterfaceMode === "portrait",
    );
    root.classList.toggle(
      "nh3d-force-touch-layout-landscape",
      forcedDesktopTouchInterfaceMode === "landscape",
    );
    return () => {
      root.classList.remove(
        "nh3d-force-touch-layout",
        "nh3d-force-touch-layout-portrait",
        "nh3d-force-touch-layout-landscape",
      );
    };
  }, [forcedDesktopTouchInterfaceMode, isDesktopTouchInterfaceForced]);

  const startup = !isMobileGameRunning && !isDesktopGameRunning;
  const startupScreenReady =
    startup &&
    hasHydratedUserTilesets &&
    hasHydratedStartupCharacterPreferences &&
    hasHydratedStartupInitOptions;
  const startupUiVisible = startupScreenReady;
  const startupLoadingVisible = startup && !startupScreenReady;
  const runtimeLoadingVisible =
    loadingVisible && characterCreationConfig !== null;
  const tilesetLoadingVisible =
    (Boolean(selectedTilesetEntry) &&
      !tileAtlasState.loaded &&
      !tileAtlasState.failed) ||
    (Boolean(selectedTilesetManagerEditEntry) &&
      !tilesetManagerAtlasState.loaded &&
      !tilesetManagerAtlasState.failed);
  const loadingOverlayVisible =
    startupLoadingVisible || runtimeLoadingVisible || tilesetLoadingVisible;
  const loadingSubtitle = startupLoadingVisible
    ? "Loading startup data..."
    : tilesetLoadingVisible
      ? "Loading tileset..."
      : "Starting local runtime...";
  const startupMenuVisible =
    startupUiVisible && characterCreationConfig === null;
  const startupChooseDialogVisible =
    startupMenuVisible && startupFlowStep === "choose";
  const startupResumeDialogVisible =
    startupMenuVisible && startupFlowStep === "resume";
  const startupRandomDialogVisible =
    startupMenuVisible && startupFlowStep === "random";
  const startupCreateDialogVisible =
    startupMenuVisible && startupFlowStep === "create";

  useLayoutEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const root = document.getElementById("root");
    if (!root) {
      return;
    }

    if (loadingOverlayVisible) {
      root.setAttribute("inert", "");
      root.setAttribute("aria-hidden", "true");
    } else {
      root.removeAttribute("inert");
      root.removeAttribute("aria-hidden");
    }

    return () => {
      root.removeAttribute("inert");
      root.removeAttribute("aria-hidden");
    };
  }, [loadingOverlayVisible]);

  useLayoutEffect(() => {
    useGameStore.getState().setUiBlockingVisible(loadingOverlayVisible);
    return () => {
      useGameStore.getState().setUiBlockingVisible(false);
    };
  }, [loadingOverlayVisible]);

  useEffect(() => {
    if (!startupUiVisible || startupRenderSignalSentRef.current) {
      return;
    }
    const bridgeWindow = window as Nh3dWindowBridges;
    const signalAppRendered = bridgeWindow.nh3dElectron?.signalAppRendered;
    if (typeof signalAppRendered !== "function") {
      startupRenderSignalSentRef.current = true;
      return;
    }
    startupRenderSignalSentRef.current = true;
    signalAppRendered();
  }, [startupUiVisible]);

  useEffect(() => {
    if (!characterSheetInterceptionArmed) {
      characterSheetAwaitingInfoRef.current = false;
      return;
    }
    if (!infoMenu) {
      if (!characterSheetAwaitingInfoRef.current) {
        setCharacterSheetInterceptionArmed(false);
      }
      return;
    }
    characterSheetAwaitingInfoRef.current = false;
    if (!characterSheet) {
      setCharacterSheetInterceptionArmed(false);
    }
  }, [infoMenu, characterSheet, characterSheetInterceptionArmed]);

  useLayoutEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") {
      return;
    }
    const root = document.documentElement;
    if (!startupUiVisible) {
      root.style.removeProperty("--nh3d-startup-logo-bottom");
      return;
    }

    const measureLogoBottom = (): void => {
      const logos = Array.from(
        document.querySelectorAll<HTMLElement>(".nethack-ascii-logo"),
      );
      if (logos.length === 0) {
        root.style.removeProperty("--nh3d-startup-logo-bottom");
        return;
      }
      const maxBottom = logos.reduce((max, logo) => {
        const rect = logo.getBoundingClientRect();
        return Math.max(max, rect.bottom);
      }, 0);
      if (!Number.isFinite(maxBottom) || maxBottom <= 0) {
        root.style.removeProperty("--nh3d-startup-logo-bottom");
        return;
      }
      root.style.setProperty(
        "--nh3d-startup-logo-bottom",
        `${Math.ceil(maxBottom)}px`,
      );
    };

    measureLogoBottom();
    const rafId = window.requestAnimationFrame(measureLogoBottom);
    window.addEventListener("resize", measureLogoBottom);
    window.addEventListener("orientationchange", measureLogoBottom);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(measureLogoBottom);
      const logos = document.querySelectorAll<HTMLElement>(
        ".nethack-ascii-logo",
      );
      logos.forEach((logo) => resizeObserver?.observe(logo));
    }

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", measureLogoBottom);
      window.removeEventListener("orientationchange", measureLogoBottom);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      root.style.removeProperty("--nh3d-startup-logo-bottom");
    };
  }, [startupUiVisible]);

  const hasGameplayOverlayOpen =
    Boolean(question) ||
    Boolean(directionQuestion) ||
    Boolean(infoMenu) ||
    inventory.visible ||
    Boolean(textInputRequest) ||
    Boolean(positionRequest) ||
    Boolean(inventoryContextMenu) ||
    Boolean(fpsCrosshairContext) ||
    isWizardCommandsVisible ||
    isControllerActionWheelVisible ||
    isControllerSupportPromptVisible ||
    newGamePrompt.visible;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!hasHydratedUserTilesets || hasAskedControllerSupportThisSession) {
      return;
    }

    const handleControllerDetection = (): void => {
      if (
        !hasHydratedUserTilesets ||
        hasAskedControllerSupportThisSession ||
        isControllerSupportPromptVisible
      ) {
        return;
      }
      if (getConnectedGamepadsForCapture().length <= 0) {
        return;
      }
      setIsControllerSupportPromptVisible(true);
    };

    handleControllerDetection();
    const pollId = window.setInterval(handleControllerDetection, 1200);
    window.addEventListener("gamepadconnected", handleControllerDetection);

    return () => {
      window.clearInterval(pollId);
      window.removeEventListener("gamepadconnected", handleControllerDetection);
    };
  }, [
    hasAskedControllerSupportThisSession,
    hasHydratedUserTilesets,
    isControllerSupportPromptVisible,
  ]);

  useEffect(() => {
    if (!isMobileGameRunning) {
      setIsMobileActionSheetVisible(false);
      setMobileActionSheetMode("quick");
      setIsMobileLogVisible(false);
    }
  }, [isMobileGameRunning]);

  useEffect(() => {
    if (isMobileGameRunning || isDesktopGameRunning) {
      return;
    }
    setIsControllerActionWheelVisible(false);
    setControllerActionWheelMode("quick");
    setControllerActionWheelChosenIndex(0);
  }, [isDesktopGameRunning, isMobileGameRunning]);

  useEffect(() => {
    setFloatingMessageTiming(
      clientOptions.liveMessageDisplayTimeMs,
      clientOptions.liveMessageFadeOutTimeMs,
    );
  }, [
    clientOptions.liveMessageDisplayTimeMs,
    clientOptions.liveMessageFadeOutTimeMs,
    setFloatingMessageTiming,
  ]);

  useEffect(() => {
    if (!clientOptions.liveMessageLog) {
      setIsMobileLogVisible(false);
    }
  }, [clientOptions.liveMessageLog]);

  useEffect(() => {
    if (!textInputRequest) {
      return;
    }
    setTextInputValue("");
    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        textInputRef.current?.focus();
      }, 0);
    }
  }, [textInputRequest]);

  useEffect(() => {
    const currentTurn = Number.isFinite(playerStats.time)
      ? Math.trunc(playerStats.time)
      : 0;
    const nextSnapshot: CoreStatSnapshot = {
      turn: currentTurn,
      playerName: String(playerStats.name || ""),
      values: getCoreStatValuesFromSnapshot(playerStats),
    };
    const previousSnapshot = previousCoreStatSnapshotRef.current;
    if (
      !previousSnapshot ||
      nextSnapshot.turn < previousSnapshot.turn ||
      nextSnapshot.playerName !== previousSnapshot.playerName
    ) {
      previousCoreStatSnapshotRef.current = nextSnapshot;
      setCoreStatBoldUntilTurn({});
      return;
    }

    const changedKeys = trackedCoreStatKeys.filter(
      (key) => nextSnapshot.values[key] !== previousSnapshot.values[key],
    );
    if (changedKeys.length > 0) {
      const highlightUntilTurn = nextSnapshot.turn + 20;
      setCoreStatBoldUntilTurn((current) => {
        const next = { ...current };
        for (const key of changedKeys) {
          next[key] = highlightUntilTurn;
        }
        return next;
      });
    }

    previousCoreStatSnapshotRef.current = nextSnapshot;
  }, [playerStats]);

  useEffect(() => {
    const currentTurn = Number.isFinite(playerStats.time)
      ? Math.trunc(playerStats.time)
      : 0;
    setCoreStatBoldUntilTurn((current) => {
      let changed = false;
      const next: Partial<Record<CoreStatKey, number>> = {};
      for (const key of trackedCoreStatKeys) {
        const untilTurn = current[key];
        if (typeof untilTurn !== "number") {
          continue;
        }
        if (currentTurn < untilTurn) {
          next[key] = untilTurn;
          continue;
        }
        changed = true;
      }
      return changed ? next : current;
    });
  }, [playerStats.time]);

  const hpPercentage =
    playerStats.maxHp > 0
      ? Math.max(0, Math.min(100, (playerStats.hp / playerStats.maxHp) * 100))
      : 0;
  const hpColor =
    hpPercentage > 60 ? "#00ff00" : hpPercentage > 30 ? "#ffaa00" : "#ff0000";
  const powerPercentage =
    playerStats.maxPower > 0
      ? Math.max(
          0,
          Math.min(100, (playerStats.power / playerStats.maxPower) * 100),
        )
      : 0;
  const highlightedCoreStatStyle = useMemo<CSSProperties>(
    () => ({
      fontWeight: 700,
    }),
    [],
  );
  const currentStatsTurn = Number.isFinite(playerStats.time)
    ? Math.trunc(playerStats.time)
    : 0;
  const resolveCoreStatStyle = useCallback(
    (key: CoreStatKey): CSSProperties | undefined => {
      const untilTurn = coreStatBoldUntilTurn[key];
      if (typeof untilTurn !== "number" || currentStatsTurn >= untilTurn) {
        return undefined;
      }
      return highlightedCoreStatStyle;
    },
    [coreStatBoldUntilTurn, currentStatsTurn, highlightedCoreStatStyle],
  );
  const playerStatusBadges = useMemo(
    () => buildPlayerStatusBadges(playerStats),
    [playerStats],
  );
  const locationLabel = String(playerStats.locationLabel || "").trim();
  const fallbackLocationLabel = Number.isFinite(playerStats.dlevel)
    ? `${playerStats.dungeon} ${Math.trunc(playerStats.dlevel)}`.trim()
    : String(playerStats.dungeon || "").trim();
  const visibleLocationLabel = locationLabel || fallbackLocationLabel;
  const parsedQuestionChoices = question
    ? parseQuestionChoices(question.text, question.choices)
    : [];
  const isYesNoQuestionChoices = isYesNoChoicePrompt(parsedQuestionChoices);
  const useInventoryChoiceLabels = !isYesNoQuestionChoices;
  const questionMenuPageIndex = question?.menuPageIndex ?? 0;
  const questionMenuPageCount = Math.max(1, question?.menuPageCount ?? 1);
  const enhanceMenuData = useMemo(
    () =>
      question ? parseEnhanceMenu(question.text, question.menuItems) : null,
    [question],
  );
  const castMenuData = useMemo(
    () =>
      question ? parseCastSpellMenu(question.text, question.menuItems) : null,
    [question],
  );
  const questionSelectableMenuItemCount = question
    ? question.menuItems.filter((item) => isSelectableQuestionMenuItem(item))
        .length
    : 0;
  const showPickupActionButtons =
    Boolean(question?.isPickupDialog) &&
    (questionSelectableMenuItemCount > 0 || isMobileViewport);
  const showPickupToggleAllButton =
    Boolean(question?.isPickupDialog) && questionSelectableMenuItemCount > 1;
  const inventoryContextActionsEnabled =
    inventory.contextActionsEnabled !== false;
  const inventoryCloseInstructionText = inventoryContextActionsEnabled
    ? "Select an item to open contextual commands. Press ENTER, ESC, or 'i' to close"
    : "Press ENTER, ESC, or 'i' to close.";

  useLayoutEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const visibleOverlays = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".nh3d-context-menu, .nh3d-dialog.is-visible, #position-dialog.is-visible, .nh3d-wizard-commands-sheet.is-visible, #loading:not(.is-hidden)",
      ),
    ).filter((element) => {
      if (!element.isConnected) {
        return false;
      }
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      return element.getClientRects().length > 0;
    });
    if (visibleOverlays.length === 0) {
      return;
    }

    let topOverlay = visibleOverlays[0];
    let topOverlayZIndex =
      Number.parseInt(window.getComputedStyle(topOverlay).zIndex, 10) || 0;
    for (let index = 1; index < visibleOverlays.length; index += 1) {
      const candidate = visibleOverlays[index];
      const zIndex =
        Number.parseInt(window.getComputedStyle(candidate).zIndex, 10) || 0;
      if (
        zIndex > topOverlayZIndex ||
        (zIndex === topOverlayZIndex && index > 0)
      ) {
        topOverlay = candidate;
        topOverlayZIndex = zIndex;
      }
    }

    if (topOverlay.id === "text-input-dialog") {
      return;
    }

    if (topOverlay.id === "loading") {
      topOverlay.focus({ preventScroll: true });
      return;
    }

    const focusableSelector = [
      ".nh3d-context-menu-button:not(:disabled)",
      "button:not(:disabled):not(.nh3d-mobile-dialog-close)",
      "summary",
      "a[href]",
      "input:not(:disabled)",
      "select:not(:disabled)",
      "textarea:not(:disabled)",
      '[role="button"][tabindex="0"]',
      "[tabindex]:not([tabindex='-1'])",
    ].join(", ");

    const explicitActiveTarget = topOverlay.querySelector<HTMLElement>(
      ".nh3d-menu-button.nh3d-menu-button-active, button.nh3d-enhance-skill-card.nh3d-menu-button-active, .nh3d-menu-action-button.nh3d-action-button-active, .nh3d-pickup-action-button.nh3d-action-button-active, .nh3d-pickup-item.nh3d-pickup-item-active .nh3d-pickup-checkbox:not(:disabled)",
    );
    const firstContextActionButton = topOverlay.classList.contains(
      "nh3d-context-menu",
    )
      ? topOverlay.querySelector<HTMLElement>(
          ".nh3d-context-menu-button:not(:disabled)",
        )
      : null;
    const firstActionWheelButton = topOverlay.classList.contains(
      "nh3d-controller-action-wheel-dialog",
    )
      ? topOverlay.querySelector<HTMLElement>(
          "[data-nh3d-wheel-angle]:not(:disabled), .nh3d-controller-action-wheel-extended .nh3d-mobile-actions-button:not(:disabled)",
        )
      : null;
    const firstSelectableButton =
      topOverlay.querySelector<HTMLElement>(focusableSelector);
    const activeElement =
      typeof document.activeElement === "object" &&
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const activeElementInDialog =
      activeElement &&
      topOverlay.contains(activeElement) &&
      activeElement.matches(focusableSelector)
        ? activeElement
        : null;
    const shouldTrackExplicitActiveTarget =
      topOverlay.id === "question-dialog" ||
      topOverlay.classList.contains("nh3d-dialog-question");
    if (shouldTrackExplicitActiveTarget && explicitActiveTarget) {
      if (activeElementInDialog !== explicitActiveTarget) {
        explicitActiveTarget.focus({ preventScroll: true });
        explicitActiveTarget.scrollIntoView({
          block: "nearest",
          inline: "nearest",
        });
      }
      return;
    }
    const targetButton =
      activeElementInDialog ??
      firstActionWheelButton ??
      firstContextActionButton ??
      explicitActiveTarget ??
      firstSelectableButton;
    if (!targetButton) {
      return;
    }
    if (activeElementInDialog) {
      return;
    }
    targetButton.focus({ preventScroll: true });
  }, [
    characterCreationConfig,
    directionQuestion,
    infoMenu,
    inventory.visible,
    inventory.items,
    inventory.contextActionsEnabled,
    isClientOptionsVisible,
    isControllerRemapVisible,
    isDarkWallTilePickerVisible,
    isTilesetBackgroundTilePickerVisible,
    isTilesetManagerVisible,
    isTilesetSolidColorPickerVisible,
    newGamePrompt.visible,
    question,
    textInputRequest,
    inventoryContextMenu,
    inventoryContextMenuActions.length,
    fpsCrosshairContext,
    fpsCrosshairContext?.actions.length,
    tileContextMenuPosition,
    isWizardCommandsVisible,
    isControllerActionWheelVisible,
    controllerActionWheelMode,
    globalConfirmationDialog,
    loadingOverlayVisible,
  ]);

  const mobileExtendedCommandNames = useMemo(() => {
    const rawCommands =
      Array.isArray(extendedCommands) && extendedCommands.length > 0
        ? extendedCommands
        : fallbackExtendedCommandNames;
    const uniqueCommands: string[] = [];
    const seen = new Set<string>();
    for (const rawCommand of rawCommands) {
      const normalized = String(rawCommand || "")
        .trim()
        .toLowerCase();
      if (!normalized || normalized === "#" || normalized === "?") {
        continue;
      }
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      uniqueCommands.push(normalized);
    }
    return uniqueCommands;
  }, [extendedCommands]);
  const mobileCommonExtendedCommandNames = useMemo(() => {
    const available = new Set(mobileExtendedCommandNames);
    return commonExtendedCommandWhitelist.filter((command) =>
      available.has(command),
    );
  }, [mobileExtendedCommandNames]);
  const isWizardModeSession = useMemo(() => {
    if (!characterCreationConfig) {
      return false;
    }
    const initOptionTokens = sanitizeStartupInitOptionTokens(
      characterCreationConfig.initOptions,
    );
    for (const token of initOptionTokens) {
      const normalizedToken = String(token || "")
        .trim()
        .toLowerCase();
      if (!normalizedToken.startsWith("playmode:")) {
        continue;
      }
      const playmodeValue = normalizedToken.slice("playmode:".length).trim();
      return playmodeValue === "debug";
    }
    return false;
  }, [characterCreationConfig]);
  const wizardExtendedCommandNames = useMemo(() => {
    const availableWizardCommands = mobileExtendedCommandNames.filter(
      isWizardExtendedCommandName,
    );
    return availableWizardCommands.length > 0
      ? availableWizardCommands
      : fallbackWizardExtendedCommandNames;
  }, [mobileExtendedCommandNames]);
  const wizardCommandsSupported =
    (isMobileGameRunning || isDesktopGameRunning) &&
    isWizardModeSession &&
    wizardExtendedCommandNames.length > 0;
  const controllerActionWheelEntries = useMemo(
    () => createControllerActionWheelEntries(mobileActions),
    [],
  );
  const characterCommandActions = useMemo(
    () => resolveCharacterCommandActions(mobileExtendedCommandNames),
    [mobileExtendedCommandNames],
  );
  const closeControllerActionWheel = useCallback((): void => {
    setIsControllerActionWheelVisible(false);
    setControllerActionWheelMode("quick");
    setControllerActionWheelChosenIndex(0);
  }, []);
  const closeWizardCommands = useCallback((): void => {
    setIsWizardCommandsVisible(false);
  }, []);
  const toggleWizardCommands = useCallback((): void => {
    if (!wizardCommandsSupported) {
      return;
    }
    controller?.dismissFpsCrosshairContextMenu();
    setIsWizardCommandsVisible((visible) => {
      const nextVisible = !visible;
      if (nextVisible) {
        closeControllerActionWheel();
        setIsMobileActionSheetVisible(false);
        setMobileActionSheetMode("quick");
        setIsMobileLogVisible(false);
      }
      return nextVisible;
    });
  }, [closeControllerActionWheel, controller, wizardCommandsSupported]);
  const runWizardExtendedCommand = useCallback(
    (command: string): void => {
      controller?.dismissFpsCrosshairContextMenu();
      controller?.runExtendedCommand(command);
      closeWizardCommands();
    },
    [closeWizardCommands, controller],
  );
  const runControllerWheelEntry = useCallback(
    (action: ControllerActionWheelEntry): void => {
      controller?.dismissFpsCrosshairContextMenu();
      if (action.id === "extended") {
        setControllerActionWheelMode("extended");
        return;
      }
      if (action.kind === "quick") {
        controller?.runQuickAction(action.value);
      } else {
        controller?.runExtendedCommand(action.value);
      }
      closeControllerActionWheel();
    },
    [closeControllerActionWheel, controller],
  );
  const runControllerWheelExtendedCommand = useCallback(
    (command: string): void => {
      controller?.dismissFpsCrosshairContextMenu();
      controller?.runExtendedCommand(command);
      closeControllerActionWheel();
    },
    [closeControllerActionWheel, controller],
  );
  const openCharacterDialog = useCallback((): void => {
    setCharacterSheetInterceptionArmed(true);
    characterSheetAwaitingInfoRef.current = true;
    controller?.dismissFpsCrosshairContextMenu();
    closeControllerActionWheel();
    setIsMobileActionSheetVisible(false);
    setMobileActionSheetMode("quick");
    setIsMobileLogVisible(false);
    closeWizardCommands();
    controller?.runExtendedCommand("attributes");
  }, [closeControllerActionWheel, closeWizardCommands, controller]);
  useEffect(() => {
    if (loadingOverlayVisible || typeof window === "undefined") {
      return;
    }
    const handleControllerCharacterSheetRequest = (event: Event): void => {
      if (event.cancelable) {
        event.preventDefault();
      }
      openCharacterDialog();
    };
    window.addEventListener(
      nh3dOpenCharacterSheetEventName,
      handleControllerCharacterSheetRequest,
    );
    return () => {
      window.removeEventListener(
        nh3dOpenCharacterSheetEventName,
        handleControllerCharacterSheetRequest,
      );
    };
  }, [loadingOverlayVisible, openCharacterDialog]);
  useEffect(() => {
    if (loadingOverlayVisible || typeof window === "undefined") {
      return;
    }
    const handleControllerActionWheelToggle = (event: Event): void => {
      if (event.cancelable) {
        event.preventDefault();
      }
      if (!isMobileGameRunning && !isDesktopGameRunning) {
        return;
      }
      controller?.dismissFpsCrosshairContextMenu();
      closeWizardCommands();
      setIsMobileActionSheetVisible(false);
      setMobileActionSheetMode("quick");
      setIsControllerActionWheelVisible((wasVisible) => {
        const nextVisible = !wasVisible;
        if (nextVisible) {
          setControllerActionWheelMode("quick");
          setControllerActionWheelChosenIndex(0);
        }
        return nextVisible;
      });
    };
    const handleControllerActionWheelClose = (event: Event): void => {
      if (event.cancelable) {
        event.preventDefault();
      }
      closeControllerActionWheel();
    };
    window.addEventListener(
      nh3dToggleControllerActionWheelEventName,
      handleControllerActionWheelToggle,
    );
    window.addEventListener(
      nh3dCloseControllerActionWheelEventName,
      handleControllerActionWheelClose,
    );
    return () => {
      window.removeEventListener(
        nh3dToggleControllerActionWheelEventName,
        handleControllerActionWheelToggle,
      );
      window.removeEventListener(
        nh3dCloseControllerActionWheelEventName,
        handleControllerActionWheelClose,
      );
    };
  }, [
    closeControllerActionWheel,
    closeWizardCommands,
    controller,
    isDesktopGameRunning,
    isMobileGameRunning,
    loadingOverlayVisible,
  ]);
  useEffect(() => {
    if (
      !isControllerActionWheelVisible ||
      loadingOverlayVisible ||
      typeof window === "undefined"
    ) {
      return;
    }
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      closeControllerActionWheel();
    };
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (target && controllerActionWheelDialogRef.current?.contains(target)) {
        return;
      }
      closeControllerActionWheel();
    };
    window.addEventListener("keydown", handleEscape, true);
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      window.removeEventListener("keydown", handleEscape, true);
      window.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [
    closeControllerActionWheel,
    isControllerActionWheelVisible,
    loadingOverlayVisible,
  ]);
  useEffect(() => {
    if (
      !isControllerActionWheelVisible ||
      loadingOverlayVisible ||
      controllerActionWheelMode !== "quick"
    ) {
      return;
    }
    const dialog = controllerActionWheelDialogRef.current;
    if (!dialog) {
      return;
    }
    const syncChosenIndexFromElement = (element: HTMLElement | null): void => {
      const wheelArc = element?.closest<HTMLElement>("[data-nh3d-wheel-index]");
      if (!wheelArc || !dialog.contains(wheelArc)) {
        return;
      }
      const rawIndex = Number.parseInt(
        wheelArc.dataset.nh3dWheelIndex || "",
        10,
      );
      if (!Number.isFinite(rawIndex) || rawIndex < 0) {
        return;
      }
      setControllerActionWheelChosenIndex((previous) =>
        previous === rawIndex ? previous : rawIndex,
      );
    };
    const handleFocusIn = (event: FocusEvent): void => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      syncChosenIndexFromElement(target);
    };
    const activeElement =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    syncChosenIndexFromElement(activeElement);
    dialog.addEventListener("focusin", handleFocusIn);
    return () => {
      dialog.removeEventListener("focusin", handleFocusIn);
    };
  }, [
    controllerActionWheelMode,
    isControllerActionWheelVisible,
    controllerActionWheelEntries.length,
    loadingOverlayVisible,
  ]);
  useEffect(() => {
    if (
      !isControllerActionWheelVisible ||
      loadingOverlayVisible ||
      controllerActionWheelMode !== "extended"
    ) {
      return;
    }
    if (typeof document === "undefined") {
      return;
    }
    const overlay = controllerActionWheelDialogRef.current;
    if (!overlay) {
      return;
    }
    const activeElement =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (activeElement && overlay.contains(activeElement)) {
      return;
    }
    const timerId = window.setTimeout(() => {
      const firstExtendedButton = overlay.querySelector<HTMLElement>(
        ".nh3d-controller-action-wheel-extended .nh3d-mobile-actions-button:not(:disabled)",
      );
      firstExtendedButton?.focus({ preventScroll: true });
    }, 0);
    return () => {
      window.clearTimeout(timerId);
    };
  }, [
    isControllerActionWheelVisible,
    controllerActionWheelMode,
    mobileCommonExtendedCommandNames.length,
    mobileExtendedCommandNames.length,
    loadingOverlayVisible,
  ]);
  useEffect(() => {
    if (wizardCommandsSupported) {
      return;
    }
    setIsWizardCommandsVisible(false);
  }, [wizardCommandsSupported]);
  useEffect(() => {
    if (
      !isWizardCommandsVisible ||
      loadingOverlayVisible ||
      typeof window === "undefined" ||
      typeof document === "undefined"
    ) {
      return;
    }
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      closeWizardCommands();
    };
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (target && wizardCommandsButtonRef.current?.contains(target)) {
        return;
      }
      if (target && wizardCommandsSheetRef.current?.contains(target)) {
        return;
      }
      closeWizardCommands();
    };
    window.addEventListener("keydown", handleEscape, true);
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      window.removeEventListener("keydown", handleEscape, true);
      window.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [closeWizardCommands, isWizardCommandsVisible, loadingOverlayVisible]);
  useEffect(() => {
    if (!isWizardCommandsVisible || typeof window === "undefined") {
      return;
    }
    const focusTimerId = window.setTimeout(() => {
      const firstWizardCommandButton =
        wizardCommandsSheetRef.current?.querySelector<HTMLElement>(
          ".nh3d-mobile-actions-button:not(:disabled)",
        );
      firstWizardCommandButton?.focus({ preventScroll: true });
    }, 0);
    return () => {
      window.clearTimeout(focusTimerId);
    };
  }, [isWizardCommandsVisible, wizardExtendedCommandNames.length]);
  const runCharacterExtendedCommand = useCallback(
    (command: string): void => {
      const normalizedCommand = String(command || "")
        .trim()
        .toLowerCase();
      setCharacterSheetInterceptionArmed(normalizedCommand === "attributes");
      characterSheetAwaitingInfoRef.current =
        normalizedCommand === "attributes";
      controller?.dismissFpsCrosshairContextMenu();
      controller?.runExtendedCommand(command);
    },
    [controller],
  );
  const closeInfoMenuDialog = useCallback((): void => {
    setCharacterSheetInterceptionArmed(false);
    characterSheetAwaitingInfoRef.current = false;
    controller?.closeInfoMenuDialog();
  }, [controller]);

  const submitTextInput = (value: string): void => {
    controller?.submitTextInput(value);
    setTextInputValue("");
  };

  const startNewGameFromPrompt = (): void => {
    if (typeof window === "undefined") {
      return;
    }
    window.location.reload();
  };

  const dismissNewGamePromptUntilInteraction = (): void => {
    const nextReason =
      typeof newGamePrompt.reason === "string" && newGamePrompt.reason.trim()
        ? newGamePrompt.reason.trim()
        : deferredNewGamePromptReason;
    setDeferredNewGamePromptReason(nextReason ?? null);
    setReopenNewGamePromptOnInteraction(true);
    setNewGamePrompt({ visible: false, reason: null });
  };

  const handleNewGamePromptKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      const actionButtons = [
        newGamePromptYesButtonRef.current,
        newGamePromptNoButtonRef.current,
      ].filter((button): button is HTMLButtonElement => Boolean(button));
      if (actionButtons.length === 0) {
        return;
      }
      const activeElement =
        typeof document !== "undefined" &&
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      const activeIndex = activeElement
        ? actionButtons.findIndex((button) => button === activeElement)
        : -1;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        const delta = event.key === "ArrowLeft" ? -1 : 1;
        const targetIndex =
          activeIndex < 0
            ? delta > 0
              ? 0
              : actionButtons.length - 1
            : (((activeIndex + delta) % actionButtons.length) +
                actionButtons.length) %
              actionButtons.length;
        actionButtons[targetIndex]?.focus({ preventScroll: true });
        return;
      }
      if (
        event.key === "Enter" ||
        event.key === "NumpadEnter" ||
        event.key === " " ||
        event.key === "Space" ||
        event.key === "Spacebar"
      ) {
        if (
          activeIndex < 0 &&
          activeElement?.classList.contains("nh3d-mobile-dialog-close")
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (activeIndex === 1) {
          dismissNewGamePromptUntilInteraction();
        } else {
          startNewGameFromPrompt();
        }
      }
    },
    [dismissNewGamePromptUntilInteraction, startNewGameFromPrompt],
  );

  const resolveStartupMenuNavigationDirection = useCallback(
    (key: string, code?: string): "up" | "down" | "left" | "right" | null => {
      switch (key) {
        case "ArrowUp":
        case "k":
        case "K":
        case "y":
        case "Y":
        case "u":
        case "U":
          return "up";
        case "ArrowDown":
        case "j":
        case "J":
        case "b":
        case "B":
        case "n":
        case "N":
          return "down";
        case "ArrowLeft":
        case "h":
        case "H":
          return "left";
        case "ArrowRight":
        case "l":
        case "L":
          return "right";
        default:
          break;
      }
      switch (code) {
        case "Numpad8":
        case "Numpad7":
        case "Numpad9":
          return "up";
        case "Numpad2":
        case "Numpad1":
        case "Numpad3":
          return "down";
        case "Numpad4":
          return "left";
        case "Numpad6":
          return "right";
        default:
          return null;
      }
    },
    [],
  );

  const resolveEditableFieldVerticalNavigationDirection = useCallback(
    (key: string, code?: string): "up" | "down" | null => {
      if (key === "ArrowUp") {
        return "up";
      }
      if (key === "ArrowDown") {
        return "down";
      }
      switch (code) {
        case "Numpad8":
        case "Numpad7":
        case "Numpad9":
          return "up";
        case "Numpad2":
        case "Numpad1":
        case "Numpad3":
          return "down";
        default:
          return null;
      }
    },
    [],
  );

  const applyDialogDirectionalNavigation = useCallback(
    (
      direction: "up" | "down" | "left" | "right",
      dialogRoot: HTMLElement | null,
      options?: {
        focusedSlider?: HTMLInputElement | null;
        stepFocusedSliderOnHorizontal?: boolean;
      },
    ): boolean => {
      if (!dialogRoot) {
        return false;
      }
      const focusedSlider =
        options?.focusedSlider ?? getFocusedControllerRangeInput(dialogRoot);
      const stepFocusedSliderOnHorizontal =
        options?.stepFocusedSliderOnHorizontal ?? true;
      if (
        stepFocusedSliderOnHorizontal &&
        focusedSlider &&
        (direction === "left" || direction === "right")
      ) {
        return stepControllerRangeInput(
          focusedSlider,
          direction === "left" ? -1 : 1,
        );
      }
      if (moveControllerDialogFocus(direction)) {
        return true;
      }
      const focusable = getControllerFocusableElements(dialogRoot);
      if (focusable.length === 0) {
        return false;
      }
      const targetElement =
        direction === "up" || direction === "left"
          ? focusable[focusable.length - 1]
          : focusable[0];
      focusControllerDialogElement(targetElement);
      return true;
    },
    [],
  );

  const handleInfoMenuDialogKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (
        event.key === "Home" ||
        event.key === "End" ||
        event.key === "PageUp" ||
        event.key === "PageDown"
      ) {
        if (
          handleControllerDialogKeyboardScrollKey(
            event.currentTarget,
            event.key,
          )
        ) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }

      if (event.key === "Home" || event.key === "End") {
        const focusable = getControllerFocusableElements(event.currentTarget);
        if (focusable.length === 0) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const targetElement =
          event.key === "End" ? focusable[focusable.length - 1] : focusable[0];
        focusControllerDialogElement(targetElement);
        return;
      }

      const direction = resolveStartupMenuNavigationDirection(
        event.key,
        event.code,
      );
      if (!direction) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      applyDialogDirectionalNavigation(direction, event.currentTarget, {
        stepFocusedSliderOnHorizontal: false,
      });
    },
    [applyDialogDirectionalNavigation, resolveStartupMenuNavigationDirection],
  );

  const handleStartupMainMenuKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      const target = event.target as HTMLElement | null;
      const targetSelect = target instanceof HTMLSelectElement ? target : null;
      const selectLikelyOpen = !!targetSelect
        ? startupLikelyOpenSelectElementsRef.current.has(targetSelect)
        : false;
      if (targetSelect) {
        const closeLikelyOpenSelect = (): void => {
          const previousValue =
            startupLikelyOpenSelectInitialValueByElementRef.current.get(
              targetSelect,
            ) ?? targetSelect.value;
          startupLikelyOpenSelectElementsRef.current.delete(targetSelect);
          startupLikelyOpenSelectInitialValueByElementRef.current.delete(
            targetSelect,
          );
          if (typeof window !== "undefined") {
            window.requestAnimationFrame(() => {
              if (!targetSelect.isConnected) {
                return;
              }
              if (targetSelect.value !== previousValue) {
                targetSelect.dispatchEvent(
                  new Event("input", { bubbles: true }),
                );
                targetSelect.dispatchEvent(
                  new Event("change", { bubbles: true }),
                );
              }
              targetSelect.blur();
            });
          }
        };
        if (selectLikelyOpen) {
          if (
            event.key === "Enter" ||
            event.key === "NumpadEnter" ||
            event.key === " " ||
            event.key === "Space" ||
            event.key === "Spacebar"
          ) {
            if (
              event.key === " " ||
              event.key === "Space" ||
              event.key === "Spacebar"
            ) {
              event.preventDefault();
              event.stopPropagation();
            }
            closeLikelyOpenSelect();
            return;
          }
          if (event.key === "Escape") {
            startupLikelyOpenSelectElementsRef.current.delete(targetSelect);
            startupLikelyOpenSelectInitialValueByElementRef.current.delete(
              targetSelect,
            );
            return;
          }
          return;
        }
        const opensSelect =
          event.key === "F4" ||
          event.key === "Enter" ||
          event.key === "NumpadEnter" ||
          event.key === " " ||
          event.key === "Space" ||
          event.key === "Spacebar" ||
          ((event.key === "ArrowDown" || event.key === "ArrowUp") &&
            event.altKey);
        if (opensSelect) {
          startupLikelyOpenSelectElementsRef.current.add(targetSelect);
          startupLikelyOpenSelectInitialValueByElementRef.current.set(
            targetSelect,
            targetSelect.value,
          );
          return;
        }
      }
      const targetInput = target instanceof HTMLInputElement ? target : null;
      const targetInputType = String(targetInput?.type || "").toLowerCase();
      const targetRangeInput =
        targetInput && targetInputType === "range" && !targetInput.disabled
          ? targetInput
          : null;
      if (targetRangeInput) {
        const inputDirection = resolveStartupMenuNavigationDirection(
          event.key,
          event.code,
        );
        if (inputDirection) {
          event.preventDefault();
          event.stopPropagation();
          applyDialogDirectionalNavigation(
            inputDirection,
            event.currentTarget,
            {
              focusedSlider: targetRangeInput,
            },
          );
          return;
        }
      }
      const isTextLikeInput =
        !!targetInput &&
        targetInputType !== "checkbox" &&
        targetInputType !== "radio" &&
        targetInputType !== "range" &&
        targetInputType !== "color" &&
        targetInputType !== "button" &&
        targetInputType !== "submit" &&
        targetInputType !== "reset";
      if (
        target &&
        (isTextLikeInput ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        const editableVerticalDirection =
          resolveEditableFieldVerticalNavigationDirection(
            event.key,
            event.code,
          );
        if (!editableVerticalDirection) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        applyDialogDirectionalNavigation(
          editableVerticalDirection,
          event.currentTarget,
          {
            stepFocusedSliderOnHorizontal: false,
          },
        );
        return;
      }

      if (
        event.key === "Home" ||
        event.key === "End" ||
        event.key === "PageUp" ||
        event.key === "PageDown"
      ) {
        if (
          handleControllerDialogKeyboardScrollKey(
            event.currentTarget,
            event.key,
          )
        ) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }

      if (event.key === "Home" || event.key === "End") {
        const focusable = getControllerFocusableElements(event.currentTarget);
        if (focusable.length === 0) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const targetElement =
          event.key === "End" ? focusable[focusable.length - 1] : focusable[0];
        focusControllerDialogElement(targetElement);
        return;
      }

      const direction = resolveStartupMenuNavigationDirection(
        event.key,
        event.code,
      );
      if (!direction) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      applyDialogDirectionalNavigation(direction, event.currentTarget, {
        stepFocusedSliderOnHorizontal: false,
      });
    },
    [
      applyDialogDirectionalNavigation,
      resolveEditableFieldVerticalNavigationDirection,
      resolveStartupMenuNavigationDirection,
    ],
  );

  const handleStartupMainMenuPointerDownCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      const target = event.target as EventTarget | null;
      if (target instanceof HTMLSelectElement) {
        startupLikelyOpenSelectElementsRef.current.add(target);
        startupLikelyOpenSelectInitialValueByElementRef.current.set(
          target,
          target.value,
        );
      } else {
        startupLikelyOpenSelectElementsRef.current.clear();
        startupLikelyOpenSelectInitialValueByElementRef.current.clear();
      }
    },
    [],
  );

  const handleStartupMainMenuBlurCapture = useCallback(
    (event: React.FocusEvent<HTMLDivElement>): void => {
      const target = event.target as EventTarget | null;
      if (target instanceof HTMLSelectElement) {
        startupLikelyOpenSelectElementsRef.current.delete(target);
        startupLikelyOpenSelectInitialValueByElementRef.current.delete(target);
      }
    },
    [],
  );

  const handleStartupMainMenuChangeCapture = useCallback(
    (event: React.FormEvent<HTMLDivElement>): void => {
      const target = event.target as EventTarget | null;
      if (target instanceof HTMLSelectElement) {
        startupLikelyOpenSelectElementsRef.current.delete(target);
        startupLikelyOpenSelectInitialValueByElementRef.current.delete(target);
      }
    },
    [],
  );

  const handleClientOptionsDialogKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      const target = event.target as HTMLElement | null;
      const targetSelect = target instanceof HTMLSelectElement ? target : null;
      const selectLikelyOpen = !!targetSelect
        ? clientOptionsLikelyOpenSelectElementsRef.current.has(targetSelect)
        : false;
      if (targetSelect) {
        const closeLikelyOpenSelect = (): void => {
          const previousValue =
            clientOptionsLikelyOpenSelectInitialValueByElementRef.current.get(
              targetSelect,
            ) ?? targetSelect.value;
          clientOptionsLikelyOpenSelectElementsRef.current.delete(targetSelect);
          clientOptionsLikelyOpenSelectInitialValueByElementRef.current.delete(
            targetSelect,
          );
          if (typeof window !== "undefined") {
            window.requestAnimationFrame(() => {
              if (!targetSelect.isConnected) {
                return;
              }
              if (targetSelect.value !== previousValue) {
                targetSelect.dispatchEvent(
                  new Event("input", { bubbles: true }),
                );
                targetSelect.dispatchEvent(
                  new Event("change", { bubbles: true }),
                );
              }
              targetSelect.blur();
            });
          }
        };
        if (selectLikelyOpen) {
          if (
            event.key === "Enter" ||
            event.key === "NumpadEnter" ||
            event.key === " " ||
            event.key === "Space" ||
            event.key === "Spacebar"
          ) {
            if (
              event.key === " " ||
              event.key === "Space" ||
              event.key === "Spacebar"
            ) {
              event.preventDefault();
              event.stopPropagation();
            }
            closeLikelyOpenSelect();
            return;
          }
          if (event.key === "Escape") {
            clientOptionsLikelyOpenSelectElementsRef.current.delete(
              targetSelect,
            );
            clientOptionsLikelyOpenSelectInitialValueByElementRef.current.delete(
              targetSelect,
            );
            return;
          }
          return;
        }
        const opensSelect =
          event.key === "F4" ||
          event.key === "Enter" ||
          event.key === "NumpadEnter" ||
          event.key === " " ||
          event.key === "Space" ||
          event.key === "Spacebar" ||
          ((event.key === "ArrowDown" || event.key === "ArrowUp") &&
            event.altKey);
        if (opensSelect) {
          clientOptionsLikelyOpenSelectElementsRef.current.add(targetSelect);
          clientOptionsLikelyOpenSelectInitialValueByElementRef.current.set(
            targetSelect,
            targetSelect.value,
          );
          return;
        }
      }

      const targetInput = target instanceof HTMLInputElement ? target : null;
      const targetInputType = String(targetInput?.type || "").toLowerCase();
      if (targetInputType === "range" && targetInput && !targetInput.disabled) {
        const inputDirection = resolveStartupMenuNavigationDirection(
          event.key,
          event.code,
        );
        if (inputDirection) {
          event.preventDefault();
          event.stopPropagation();
          applyDialogDirectionalNavigation(
            inputDirection,
            event.currentTarget,
            {
              focusedSlider: targetInput,
            },
          );
          return;
        }
      }
      const isTextLikeInput =
        !!targetInput &&
        targetInputType !== "checkbox" &&
        targetInputType !== "radio" &&
        targetInputType !== "range" &&
        targetInputType !== "color" &&
        targetInputType !== "button" &&
        targetInputType !== "submit" &&
        targetInputType !== "reset";
      if (
        target &&
        (isTextLikeInput ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        const editableVerticalDirection =
          resolveEditableFieldVerticalNavigationDirection(
            event.key,
            event.code,
          );
        if (!editableVerticalDirection) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        applyDialogDirectionalNavigation(
          editableVerticalDirection,
          event.currentTarget,
          {
            stepFocusedSliderOnHorizontal: false,
          },
        );
        return;
      }

      if (
        event.key === "Home" ||
        event.key === "End" ||
        event.key === "PageUp" ||
        event.key === "PageDown"
      ) {
        if (
          handleControllerDialogKeyboardScrollKey(
            event.currentTarget,
            event.key,
          )
        ) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }

      if (event.key === "Home" || event.key === "End") {
        const focusable = getControllerFocusableElements(event.currentTarget);
        if (focusable.length === 0) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const targetElement =
          event.key === "End" ? focusable[focusable.length - 1] : focusable[0];
        focusControllerDialogElement(targetElement);
        return;
      }

      const direction = resolveStartupMenuNavigationDirection(
        event.key,
        event.code,
      );
      if (!direction) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      applyDialogDirectionalNavigation(direction, event.currentTarget, {
        stepFocusedSliderOnHorizontal: false,
      });
    },
    [
      applyDialogDirectionalNavigation,
      resolveEditableFieldVerticalNavigationDirection,
      resolveStartupMenuNavigationDirection,
    ],
  );

  const handleClientOptionsDialogPointerDownCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      const target = event.target as EventTarget | null;
      if (target instanceof HTMLSelectElement) {
        clientOptionsLikelyOpenSelectElementsRef.current.add(target);
        clientOptionsLikelyOpenSelectInitialValueByElementRef.current.set(
          target,
          target.value,
        );
      } else {
        clientOptionsLikelyOpenSelectElementsRef.current.clear();
        clientOptionsLikelyOpenSelectInitialValueByElementRef.current.clear();
      }
    },
    [],
  );

  const handleClientOptionsDialogBlurCapture = useCallback(
    (event: React.FocusEvent<HTMLDivElement>): void => {
      const target = event.target as EventTarget | null;
      if (target instanceof HTMLSelectElement) {
        clientOptionsLikelyOpenSelectElementsRef.current.delete(target);
        clientOptionsLikelyOpenSelectInitialValueByElementRef.current.delete(
          target,
        );
      }
    },
    [],
  );

  const handleClientOptionsDialogChangeCapture = useCallback(
    (event: React.FormEvent<HTMLDivElement>): void => {
      const target = event.target as EventTarget | null;
      if (target instanceof HTMLSelectElement) {
        clientOptionsLikelyOpenSelectElementsRef.current.delete(target);
        clientOptionsLikelyOpenSelectInitialValueByElementRef.current.delete(
          target,
        );
      }
    },
    [],
  );

  const refreshUserTilesetCatalog = useCallback(
    async (rehydrateFromStorage: boolean): Promise<void> => {
      try {
        const records = await listStoredUserTilesets();
        const normalizedRecords = await normalizeUserTilesetTileSizes(records);
        setUserTilesets(normalizedRecords);
        setNh3dUserTilesets(toUserTilesetRegistrations(normalizedRecords));
        if (rehydrateFromStorage) {
          const persistedOptions =
            await loadPersistedNh3dClientOptionsWithMigration(
              nh3dClientOptionsStorageKey,
            );
          initialPersistedClientOptionsRef.current = persistedOptions;
          const nextOptions =
            resolveInitialClientOptionsFromPersisted(persistedOptions);
          setClientOptions(nextOptions);
          setClientOptionsDraft(nextOptions);
          return;
        }
        setClientOptions((previous) => normalizeNh3dClientOptions(previous));
        setClientOptionsDraft((previous) =>
          normalizeNh3dClientOptions(previous),
        );
      } finally {
        if (rehydrateFromStorage) {
          setHasHydratedUserTilesets(true);
        }
      }
    },
    [],
  );

  const resetTilesetManagerSelectedFile = (): void => {
    setTilesetManagerFile(null);
    if (tilesetManagerFileInputRef.current) {
      tilesetManagerFileInputRef.current.value = "";
    }
  };

  const openTilesetManagerNewEditor = (): void => {
    setTilesetManagerMode("new");
    setTilesetManagerEditPath("");
    setTilesetManagerName("");
    setTilesetManagerAtlasState(createDefaultTileAtlasState());
    setTilesetManagerAtlasImage(null);
    resetTilesetManagerSelectedFile();
    setIsTilesetBackgroundTilePickerVisible(false);
    setIsTilesetSolidColorPickerVisible(false);
    setTilesetManagerError("");
  };

  const openTilesetManagerEditor = (rawTilesetPath: string): void => {
    const tilesetPath = String(rawTilesetPath || "").trim();
    if (!tilesetPath) {
      return;
    }
    const tilesetEntry = findNh3dTilesetByPath(tilesetPath);
    if (!tilesetEntry) {
      return;
    }
    const userRecord = userTilesetRecordByPath.get(tilesetPath);
    const currentEditPath = String(tilesetManagerEditPath || "").trim();
    setTilesetManagerMode("edit");
    setTilesetManagerEditPath(tilesetPath);
    setTilesetManagerName(
      userRecord
        ? stripUserTilesetNameSuffix(userRecord.label)
        : tilesetEntry.label,
    );
    if (tilesetPath !== currentEditPath) {
      setTilesetManagerAtlasState(createDefaultTileAtlasState());
      setTilesetManagerAtlasImage(null);
    }
    resetTilesetManagerSelectedFile();
    setIsTilesetBackgroundTilePickerVisible(false);
    setIsTilesetSolidColorPickerVisible(false);
    setTilesetManagerError("");
  };

  const openTilesetManager = (): void => {
    const activeTilesetPath = String(
      clientOptionsDraft.tilesetPath || "",
    ).trim();
    const fallbackTilesetPath = tilesetCatalog[0]?.path ?? "";
    const nextEditPath =
      (activeTilesetPath && isNh3dTilesetPathAvailable(activeTilesetPath)
        ? activeTilesetPath
        : "") || fallbackTilesetPath;
    if (nextEditPath) {
      openTilesetManagerEditor(nextEditPath);
    } else {
      openTilesetManagerNewEditor();
    }
    setIsTilesetManagerVisible(true);
  };

  const closeTilesetManager = (): void => {
    setIsTilesetManagerVisible(false);
    setTilesetManagerMode("edit");
    setTilesetManagerEditPath("");
    setTilesetManagerName("");
    setTilesetManagerAtlasState(createDefaultTileAtlasState());
    setTilesetManagerAtlasImage(null);
    resetTilesetManagerSelectedFile();
    setIsTilesetBackgroundTilePickerVisible(false);
    setIsTilesetSolidColorPickerVisible(false);
    setTilesetManagerError("");
  };

  const handleTilesetManagerFileChange = (
    event: ChangeEvent<HTMLInputElement>,
  ): void => {
    const file = event.target.files?.[0] ?? null;
    setTilesetManagerFile(file);
    if (!file) {
      return;
    }
    const strippedName = String(file.name || "")
      .replace(/\.[^.]+$/g, "")
      .trim();
    if (!tilesetManagerName.trim()) {
      setTilesetManagerName(strippedName || "User Tileset");
    }
  };

  const removeUserTileset = async (
    record: StoredUserTilesetRecord,
  ): Promise<void> => {
    const label = String(record.label || "this tileset");
    const confirmed = await requestConfirmation({
      title: "Delete Uploaded Tileset?",
      message: `Delete '${label}' from uploaded tilesets?`,
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      confirmClassName: "nh3d-menu-action-cancel",
    });
    if (!confirmed) {
      return;
    }
    setTilesetManagerBusy(true);
    setTilesetManagerError("");
    try {
      await deleteStoredUserTileset(record.id);
      await refreshUserTilesetCatalog(false);
      const deletedPath = getNh3dUserTilesetPath(record.id);
      if (selectedTilesetManagerEditPath === deletedPath) {
        const activeTilesetPath = String(
          clientOptionsDraft.tilesetPath || "",
        ).trim();
        const fallbackTilesetPath = getNh3dTilesetCatalog()[0]?.path ?? "";
        const nextEditPath =
          (activeTilesetPath &&
          activeTilesetPath !== deletedPath &&
          isNh3dTilesetPathAvailable(activeTilesetPath)
            ? activeTilesetPath
            : "") || fallbackTilesetPath;
        if (nextEditPath && nextEditPath !== deletedPath) {
          openTilesetManagerEditor(nextEditPath);
        } else {
          openTilesetManagerNewEditor();
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to delete tileset.";
      setTilesetManagerError(message);
    } finally {
      setTilesetManagerBusy(false);
    }
  };

  const saveTilesetManagerSettingsDraft = (): void => {
    const next = normalizeNh3dClientOptions({
      ...clientOptions,
      tilesetBackgroundTileIdByTileset:
        clientOptionsDraft.tilesetBackgroundTileIdByTileset,
      tilesetBackgroundRemovalModeByTileset:
        clientOptionsDraft.tilesetBackgroundRemovalModeByTileset,
      tilesetSolidChromaKeyColorHexByTileset:
        clientOptionsDraft.tilesetSolidChromaKeyColorHexByTileset,
    });
    setClientOptions(next);
    setClientOptionsDraft((previous) =>
      normalizeNh3dClientOptions({
        ...previous,
        tilesetBackgroundTileIdByTileset: next.tilesetBackgroundTileIdByTileset,
        tilesetBackgroundRemovalModeByTileset:
          next.tilesetBackgroundRemovalModeByTileset,
        tilesetSolidChromaKeyColorHexByTileset:
          next.tilesetSolidChromaKeyColorHexByTileset,
        tilesetBackgroundTileId: next.tilesetBackgroundTileId,
        tilesetBackgroundRemovalMode: next.tilesetBackgroundRemovalMode,
        tilesetSolidChromaKeyColorHex: next.tilesetSolidChromaKeyColorHex,
      }),
    );
    controller?.setClientOptions(next);
  };

  const saveTilesetManager = async (): Promise<void> => {
    const file = tilesetManagerFile;
    const label = stripUserTilesetNameSuffix(tilesetManagerName);
    const userLabel = appendUserTilesetNameSuffix(label);
    if (tilesetManagerInNewMode) {
      if (!file) {
        setTilesetManagerError("Choose a PNG/BMP/GIF/JPEG tileset file.");
        return;
      }
      if (!label) {
        setTilesetManagerError("Provide a name for this tileset.");
        return;
      }
    }
    if (
      !tilesetManagerInNewMode &&
      selectedTilesetManagerEditUserRecord &&
      !label
    ) {
      setTilesetManagerError("Provide a name for this tileset.");
      return;
    }

    setTilesetManagerBusy(true);
    setTilesetManagerError("");
    try {
      if (tilesetManagerInNewMode) {
        const tileSize = await inferTilesetTileSizeFromBlob(file as File);
        const savedRecord = await saveStoredUserTileset({
          label: userLabel,
          tileSize,
          fileName: (file as File).name,
          file: file as File,
        });
        await refreshUserTilesetCatalog(false);
        openTilesetManagerEditor(getNh3dUserTilesetPath(savedRecord.id));
        setTilesetManagerName(label);
      } else if (selectedTilesetManagerEditUserRecord) {
        const nextFile = file ?? selectedTilesetManagerEditUserRecord.blob;
        const nextFileName = file
          ? file.name
          : selectedTilesetManagerEditUserRecord.fileName;
        const nextTileSize = file
          ? await inferTilesetTileSizeFromBlob(file)
          : selectedTilesetManagerEditUserRecord.tileSize;
        await saveStoredUserTileset({
          id: selectedTilesetManagerEditUserRecord.id,
          label: userLabel,
          tileSize: nextTileSize,
          fileName: nextFileName,
          file: nextFile,
        });
        await refreshUserTilesetCatalog(false);
        openTilesetManagerEditor(
          getNh3dUserTilesetPath(selectedTilesetManagerEditUserRecord.id),
        );
        setTilesetManagerName(label);
      }
      saveTilesetManagerSettingsDraft();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save tileset.";
      setTilesetManagerError(message);
    } finally {
      setTilesetManagerBusy(false);
    }
  };

  useEffect(() => {
    refreshUserTilesetCatalog(true).catch((error) => {
      console.warn("Failed to load uploaded tilesets:", error);
    });
  }, [refreshUserTilesetCatalog]);

  const confirmControllerSupportPromptChoice = useCallback(
    (enabled: boolean): void => {
      const next = normalizeNh3dClientOptions({
        ...clientOptions,
        controllerEnabled: enabled,
      });
      setClientOptions(next);
      setClientOptionsDraft((previous) =>
        normalizeNh3dClientOptions({
          ...previous,
          controllerEnabled: enabled,
        }),
      );
      controller?.setClientOptions(next);
      setIsControllerSupportPromptVisible(false);
      setHasAskedControllerSupportThisSession(true);
    },
    [clientOptions, controller],
  );

  const openClientOptionsDialog = (): void => {
    setClientOptionsDraft({ ...clientOptions });
    setActiveClientOptionsTab(clientOptionsDefaultTabId);
    setIsClientOptionsVisible(true);
    setIsDarkWallTilePickerVisible(false);
    setIsTilesetBackgroundTilePickerVisible(false);
    setIsTilesetSolidColorPickerVisible(false);
    setIsTilesetManagerVisible(false);
    setIsResetClientOptionsConfirmationVisible(false);
    setIsControllerRemapVisible(false);
    setControllerRemapListening(null);
    controller?.dismissFpsCrosshairContextMenu();
  };

  const closeClientOptionsDialog = async (): Promise<void> => {
    const canDiscardSoundPackChanges =
      (await soundPackDialogActionsRef.current?.confirmDiscardIfNeeded()) ??
      true;
    if (!canDiscardSoundPackChanges) {
      return;
    }
    setIsClientOptionsVisible(false);
    setIsDarkWallTilePickerVisible(false);
    setIsTilesetBackgroundTilePickerVisible(false);
    setIsTilesetSolidColorPickerVisible(false);
    setIsTilesetManagerVisible(false);
    setIsResetClientOptionsConfirmationVisible(false);
    setIsControllerRemapVisible(false);
    setControllerRemapListening(null);
    setClientOptionsDraft({ ...clientOptions });
  };

  const confirmClientOptionsDialog = async (): Promise<void> => {
    const didSaveSoundPackChanges =
      (await soundPackDialogActionsRef.current?.saveIfNeeded()) ?? true;
    if (!didSaveSoundPackChanges) {
      return;
    }
    const next = normalizeNh3dClientOptions(clientOptionsDraft);
    setClientOptions(next);
    setClientOptionsDraft(next);
    setIsClientOptionsVisible(false);
    setIsDarkWallTilePickerVisible(false);
    setIsTilesetBackgroundTilePickerVisible(false);
    setIsTilesetSolidColorPickerVisible(false);
    setIsTilesetManagerVisible(false);
    setIsResetClientOptionsConfirmationVisible(false);
    setIsControllerRemapVisible(false);
    setControllerRemapListening(null);
    controller?.setClientOptions(next);
  };

  const requestCloseClientOptionsDialog = (): void => {
    void closeClientOptionsDialog();
  };

  const requestConfirmClientOptionsDialog = (): void => {
    void confirmClientOptionsDialog();
  };

  const openResetClientOptionsConfirmation = (): void => {
    setIsResetClientOptionsConfirmationVisible(true);
  };

  const cancelResetClientOptionsConfirmation = (): void => {
    setIsResetClientOptionsConfirmationVisible(false);
  };

  const confirmResetClientOptionsToDefaults = (): void => {
    const next = normalizeNh3dClientOptions(defaultNh3dClientOptions);
    setClientOptions(next);
    setClientOptionsDraft(next);
    setIsDarkWallTilePickerVisible(false);
    setIsTilesetBackgroundTilePickerVisible(false);
    setIsTilesetSolidColorPickerVisible(false);
    setIsTilesetManagerVisible(false);
    setIsResetClientOptionsConfirmationVisible(false);
    setIsControllerRemapVisible(false);
    setControllerRemapListening(null);
    controller?.setClientOptions(next);
    void (async () => {
      try {
        await resetNh3dDefaultSoundPackVolumeLevelsToDefaults();
      } catch (error) {
        console.warn(
          "Failed to reset default sound-pack volume levels to defaults:",
          error,
        );
      } finally {
        try {
          await soundPackDialogActionsRef.current?.reloadFromStorage();
        } catch (error) {
          console.warn(
            "Failed to reload sound-pack state after resetting defaults:",
            error,
          );
        }
      }
    })();
  };

  const updateClientOptionDraft = <
    K extends
      | ClientOptionToggleKey
      | ClientOptionSelect["key"]
      | ClientOptionSlider["key"],
  >(
    optionKey: K,
    value: Nh3dClientOptions[K],
  ): void => {
    setClientOptionsDraft((previous) => ({
      ...previous,
      [optionKey]: value,
    }));
  };

  const closeControllerRemapDialog = useCallback((): void => {
    setControllerRemapListening(null);
    setIsControllerRemapVisible(false);
  }, []);

  const openControllerRemapDialog = useCallback((): void => {
    setControllerRemapListening(null);
    setIsControllerRemapVisible(true);
  }, []);

  const setControllerBindingSlotDraft = useCallback(
    (
      actionId: Nh3dControllerActionId,
      slotIndex: ControllerRemapSlotIndex,
      nextBinding: Nh3dControllerBinding | null,
    ): void => {
      setClientOptionsDraft((previous) => {
        const nextBindings = normalizeNh3dControllerBindings({
          ...previous.controllerBindings,
        });
        const currentSlots = nextBindings[actionId] ?? [null, null];
        const updatedSlots: [
          Nh3dControllerBinding | null,
          Nh3dControllerBinding | null,
        ] = [currentSlots[0] ?? null, currentSlots[1] ?? null];
        updatedSlots[slotIndex] = nextBinding;
        nextBindings[actionId] = updatedSlots;
        return {
          ...previous,
          controllerBindings: normalizeNh3dControllerBindings(nextBindings),
        };
      });
    },
    [],
  );

  const resetControllerBindingsToDefaultsDraft = useCallback((): void => {
    setClientOptionsDraft((previous) => ({
      ...previous,
      controllerBindings: normalizeNh3dControllerBindings(
        defaultNh3dControllerBindings,
      ),
    }));
    setControllerRemapListening(null);
  }, []);

  const beginControllerBindingCapture = useCallback(
    (
      actionId: Nh3dControllerActionId,
      slotIndex: ControllerRemapSlotIndex,
    ): void => {
      const blockedBindings = sampleActiveControllerBindingCandidates();
      setControllerRemapListening({
        actionId,
        slotIndex,
        startedAtMs: performance.now(),
        blockedBindings,
      });
    },
    [],
  );

  const clearControllerBindingCapture = useCallback((): void => {
    setControllerRemapListening(null);
  }, []);

  useEffect(() => {
    if (!controllerRemapListening || loadingOverlayVisible) {
      return;
    }

    let frameHandle = 0;
    const scan = (): void => {
      const elapsedMs =
        performance.now() - controllerRemapListening.startedAtMs;
      const candidates = sampleActiveControllerBindingCandidates();
      const blockedSet = new Set(controllerRemapListening.blockedBindings);
      const capturedBinding =
        elapsedMs >= controllerCaptureIgnoreDurationMs
          ? (candidates.find((binding) => !blockedSet.has(binding)) ?? null)
          : null;
      if (capturedBinding) {
        setControllerBindingSlotDraft(
          controllerRemapListening.actionId,
          controllerRemapListening.slotIndex,
          capturedBinding,
        );
        setControllerRemapListening(null);
        return;
      }
      frameHandle = window.requestAnimationFrame(scan);
    };

    frameHandle = window.requestAnimationFrame(scan);
    return () => {
      window.cancelAnimationFrame(frameHandle);
    };
  }, [
    controllerRemapListening,
    loadingOverlayVisible,
    setControllerBindingSlotDraft,
  ]);

  const updateTilesetPathDraft = (rawTilesetPath: string): void => {
    const tilesetPath = String(rawTilesetPath || "").trim();
    const currentTilesetPath = String(clientOptionsDraft.tilesetPath || "").trim();
    if (tilesetPath !== currentTilesetPath) {
      setTileAtlasState(createDefaultTileAtlasState());
      setTileAtlasImage(null);
    }
    setClientOptionsDraft((previous) => {
      const mappedDarkWallTileOverrideEnabled = tilesetPath
        ? previous.darkCorridorWallTileOverrideEnabledByTileset[tilesetPath]
        : undefined;
      const mappedDarkWallTileId = tilesetPath
        ? previous.darkCorridorWallTileOverrideTileIdByTileset[tilesetPath]
        : undefined;
      const mappedDarkWallSolidColorOverrideEnabled = tilesetPath
        ? previous.darkCorridorWallSolidColorOverrideEnabledByTileset[
            tilesetPath
          ]
        : undefined;
      const mappedDarkWallSolidColorHex = tilesetPath
        ? previous.darkCorridorWallSolidColorHexByTileset[tilesetPath]
        : undefined;
      const mappedDarkWallSolidColorHexFps = tilesetPath
        ? previous.darkCorridorWallSolidColorHexFpsByTileset[tilesetPath]
        : undefined;
      const mappedDarkWallSolidColorGridEnabled = tilesetPath
        ? previous.darkCorridorWallSolidColorGridEnabledByTileset[tilesetPath]
        : undefined;
      const mappedDarkWallSolidColorGridDarknessPercent = tilesetPath
        ? previous.darkCorridorWallSolidColorGridDarknessPercentByTileset[
            tilesetPath
          ]
        : undefined;
      const mappedBackgroundTileId = tilesetPath
        ? previous.tilesetBackgroundTileIdByTileset[tilesetPath]
        : undefined;
      const mappedBackgroundRemovalMode = tilesetPath
        ? previous.tilesetBackgroundRemovalModeByTileset[tilesetPath]
        : undefined;
      const mappedSolidColorHex = tilesetPath
        ? previous.tilesetSolidChromaKeyColorHexByTileset[tilesetPath]
        : undefined;
      const nextDarkWallTileId =
        typeof mappedDarkWallTileId === "number" &&
        Number.isFinite(mappedDarkWallTileId)
          ? Math.max(0, Math.trunc(mappedDarkWallTileId))
          : defaultDarkWallTileId;
      const nextDarkWallTileOverrideEnabled =
        typeof mappedDarkWallTileOverrideEnabled === "boolean"
          ? mappedDarkWallTileOverrideEnabled
          : Boolean(previous.darkCorridorWallTileOverrideEnabled);
      let nextDarkWallSolidColorOverrideEnabled =
        typeof mappedDarkWallSolidColorOverrideEnabled === "boolean"
          ? mappedDarkWallSolidColorOverrideEnabled
          : Boolean(previous.darkCorridorWallSolidColorOverrideEnabled);
      if (
        nextDarkWallTileOverrideEnabled &&
        nextDarkWallSolidColorOverrideEnabled
      ) {
        nextDarkWallSolidColorOverrideEnabled = false;
      }
      const nextDarkWallSolidColorHex = normalizeSolidChromaKeyHex(
        typeof mappedDarkWallSolidColorHex === "string"
          ? mappedDarkWallSolidColorHex
          : defaultDarkWallSolidColorHex,
      );
      const nextDarkWallSolidColorHexFps = normalizeSolidChromaKeyHex(
        typeof mappedDarkWallSolidColorHexFps === "string"
          ? mappedDarkWallSolidColorHexFps
          : defaultDarkWallSolidColorHexFps,
      );
      const nextDarkWallSolidColorGridEnabled =
        typeof mappedDarkWallSolidColorGridEnabled === "boolean"
          ? mappedDarkWallSolidColorGridEnabled
          : Boolean(previous.darkCorridorWallSolidColorGridEnabled);
      const nextDarkWallSolidColorGridDarknessPercent = Math.max(
        0,
        Math.min(
          100,
          Math.round(
            typeof mappedDarkWallSolidColorGridDarknessPercent === "number" &&
              Number.isFinite(mappedDarkWallSolidColorGridDarknessPercent)
              ? mappedDarkWallSolidColorGridDarknessPercent
              : previous.darkCorridorWallSolidColorGridDarknessPercent,
          ),
        ),
      );
      const nextBackgroundTileId =
        typeof mappedBackgroundTileId === "number" &&
        Number.isFinite(mappedBackgroundTileId)
          ? Math.max(0, Math.trunc(mappedBackgroundTileId))
          : resolveDefaultNh3dTilesetBackgroundTileId(tilesetPath);
      const nextBackgroundRemovalMode: TilesetBackgroundRemovalMode =
        mappedBackgroundRemovalMode === "solid" ? "solid" : "tile";
      const nextSolidColorHex = normalizeSolidChromaKeyHex(
        typeof mappedSolidColorHex === "string"
          ? mappedSolidColorHex
          : resolveDefaultNh3dTilesetSolidChromaKeyColorHex(tilesetPath),
      );
      return {
        ...previous,
        tilesetPath,
        darkCorridorWallTileOverrideEnabled: nextDarkWallTileOverrideEnabled,
        darkCorridorWallTileOverrideTileId: nextDarkWallTileId,
        darkCorridorWallSolidColorOverrideEnabled:
          nextDarkWallSolidColorOverrideEnabled,
        darkCorridorWallSolidColorHex: nextDarkWallSolidColorHex,
        darkCorridorWallSolidColorHexFps: nextDarkWallSolidColorHexFps,
        darkCorridorWallSolidColorGridEnabled:
          nextDarkWallSolidColorGridEnabled,
        darkCorridorWallSolidColorGridDarknessPercent:
          nextDarkWallSolidColorGridDarknessPercent,
        tilesetBackgroundTileId: nextBackgroundTileId,
        tilesetBackgroundRemovalMode: nextBackgroundRemovalMode,
        tilesetSolidChromaKeyColorHex: nextSolidColorHex,
      };
    });
  };

  const updateClientFovDraft = (rawValue: number): void => {
    const clamped = Math.max(45, Math.min(110, Math.round(rawValue)));
    setClientOptionsDraft((previous) => ({
      ...previous,
      fpsFov: clamped,
    }));
  };

  const updateClientLookSensitivityDraft = (
    key: ClientOptionLookSensitivityKey,
    rawValue: number,
  ): void => {
    const clamped = Number(
      Math.max(
        nh3dFpsLookSensitivityMin,
        Math.min(nh3dFpsLookSensitivityMax, rawValue),
      ).toFixed(2),
    );
    setClientOptionsDraft((previous) => ({
      ...previous,
      [key]: clamped,
    }));
  };

  const updateClientSliderDraft = (
    key: ClientOptionSlider["key"],
    rawValue: number,
  ): void => {
    if (key === "fpsFov") {
      updateClientFovDraft(rawValue);
      return;
    }
    if (key === "fpsLookSensitivityX" || key === "fpsLookSensitivityY") {
      updateClientLookSensitivityDraft(key, rawValue);
      return;
    }
    let clamped = rawValue;
    if (key === "brightness") {
      clamped = Math.max(-0.25, Math.min(0.25, rawValue));
    } else if (key === "contrast") {
      clamped = Math.max(-0.25, Math.min(0.25, rawValue));
    } else if (key === "gamma") {
      clamped = Math.max(0.5, Math.min(2.5, rawValue));
    } else if (key === "minimapScale") {
      clamped = Math.max(0.6, Math.min(2.2, rawValue));
    } else if (key === "liveMessageDisplayTimeMs") {
      clamped = Math.max(250, Math.min(6000, rawValue));
    } else if (key === "uiFontScale") {
      clamped = Math.max(0.7, Math.min(1.8, rawValue));
    } else if (key === "liveMessageLogFontScale") {
      clamped = Math.max(0.7, Math.min(2.2, rawValue));
    } else if (key === "controllerFpsMoveRepeatMs") {
      clamped = Math.max(80, Math.min(900, rawValue));
    } else {
      clamped = Math.max(120, Math.min(4000, rawValue));
    }
    if (
      key === "controllerFpsMoveRepeatMs" ||
      key === "liveMessageDisplayTimeMs" ||
      key === "liveMessageFadeOutTimeMs"
    ) {
      updateClientOptionDraft(key, Math.round(clamped));
      return;
    }
    updateClientOptionDraft(key, Number(clamped.toFixed(2)));
  };

  const updateDarkWallTileOverrideEnabledDraft = (
    enabled: boolean,
    rawTilesetPath?: string,
  ): void => {
    setClientOptionsDraft((previous) => {
      const selectedTilesetPath = String(previous.tilesetPath || "").trim();
      const tilesetPath = String(rawTilesetPath || selectedTilesetPath).trim();
      const nextTileByTileset = {
        ...previous.darkCorridorWallTileOverrideEnabledByTileset,
      };
      const nextSolidByTileset = {
        ...previous.darkCorridorWallSolidColorOverrideEnabledByTileset,
      };
      if (tilesetPath) {
        nextTileByTileset[tilesetPath] = enabled;
        if (enabled) {
          nextSolidByTileset[tilesetPath] = false;
        }
      }
      const appliesToSelected =
        Boolean(tilesetPath) && tilesetPath === selectedTilesetPath;
      return {
        ...previous,
        darkCorridorWallTileOverrideEnabled: appliesToSelected
          ? enabled
          : previous.darkCorridorWallTileOverrideEnabled,
        darkCorridorWallTileOverrideEnabledByTileset: nextTileByTileset,
        darkCorridorWallSolidColorOverrideEnabled: appliesToSelected
          ? enabled
            ? false
            : previous.darkCorridorWallSolidColorOverrideEnabled
          : previous.darkCorridorWallSolidColorOverrideEnabled,
        darkCorridorWallSolidColorOverrideEnabledByTileset: nextSolidByTileset,
      };
    });
  };

  const updateDarkWallTileOverrideTileIdDraft = (rawTileId: number): void => {
    const maxTileId =
      tileAtlasState.tileCount > 0 ? tileAtlasState.tileCount - 1 : Infinity;
    const nextTileId = Math.max(0, Math.min(maxTileId, Math.trunc(rawTileId)));
    setClientOptionsDraft((previous) => {
      const tilesetPath = String(previous.tilesetPath || "").trim();
      const nextByTileset = {
        ...previous.darkCorridorWallTileOverrideTileIdByTileset,
      };
      if (tilesetPath) {
        nextByTileset[tilesetPath] = nextTileId;
      }
      return {
        ...previous,
        darkCorridorWallTileOverrideTileId: nextTileId,
        darkCorridorWallTileOverrideTileIdByTileset: nextByTileset,
      };
    });
  };

  const updateDarkWallSolidColorOverrideEnabledDraft = (
    enabled: boolean,
    rawTilesetPath?: string,
  ): void => {
    setClientOptionsDraft((previous) => {
      const selectedTilesetPath = String(previous.tilesetPath || "").trim();
      const tilesetPath = String(rawTilesetPath || selectedTilesetPath).trim();
      const nextSolidByTileset = {
        ...previous.darkCorridorWallSolidColorOverrideEnabledByTileset,
      };
      const nextTileByTileset = {
        ...previous.darkCorridorWallTileOverrideEnabledByTileset,
      };
      if (tilesetPath) {
        nextSolidByTileset[tilesetPath] = enabled;
        if (enabled) {
          nextTileByTileset[tilesetPath] = false;
        }
      }
      const appliesToSelected =
        Boolean(tilesetPath) && tilesetPath === selectedTilesetPath;
      return {
        ...previous,
        darkCorridorWallSolidColorOverrideEnabled: appliesToSelected
          ? enabled
          : previous.darkCorridorWallSolidColorOverrideEnabled,
        darkCorridorWallSolidColorOverrideEnabledByTileset: nextSolidByTileset,
        darkCorridorWallTileOverrideEnabled: appliesToSelected
          ? enabled
            ? false
            : previous.darkCorridorWallTileOverrideEnabled
          : previous.darkCorridorWallTileOverrideEnabled,
        darkCorridorWallTileOverrideEnabledByTileset: nextTileByTileset,
      };
    });
  };

  const updateDarkWallSolidColorHexDraft = (
    rawHex: string,
    rawTilesetPath?: string,
  ): void => {
    const normalizedHex = normalizeSolidChromaKeyHex(rawHex);
    setClientOptionsDraft((previous) => {
      const selectedTilesetPath = String(previous.tilesetPath || "").trim();
      const tilesetPath = String(rawTilesetPath || selectedTilesetPath).trim();
      const nextByTileset = {
        ...previous.darkCorridorWallSolidColorHexByTileset,
      };
      if (tilesetPath) {
        nextByTileset[tilesetPath] = normalizedHex;
      }
      return {
        ...previous,
        darkCorridorWallSolidColorHex:
          tilesetPath && tilesetPath === selectedTilesetPath
            ? normalizedHex
            : previous.darkCorridorWallSolidColorHex,
        darkCorridorWallSolidColorHexByTileset: nextByTileset,
      };
    });
  };

  const updateDarkWallSolidColorHexFpsDraft = (
    rawHex: string,
    rawTilesetPath?: string,
  ): void => {
    const normalizedHex = normalizeSolidChromaKeyHex(rawHex);
    setClientOptionsDraft((previous) => {
      const selectedTilesetPath = String(previous.tilesetPath || "").trim();
      const tilesetPath = String(rawTilesetPath || selectedTilesetPath).trim();
      const nextByTileset = {
        ...previous.darkCorridorWallSolidColorHexFpsByTileset,
      };
      if (tilesetPath) {
        nextByTileset[tilesetPath] = normalizedHex;
      }
      return {
        ...previous,
        darkCorridorWallSolidColorHexFps:
          tilesetPath && tilesetPath === selectedTilesetPath
            ? normalizedHex
            : previous.darkCorridorWallSolidColorHexFps,
        darkCorridorWallSolidColorHexFpsByTileset: nextByTileset,
      };
    });
  };

  const updateDarkWallSolidColorGridEnabledDraft = (
    enabled: boolean,
    rawTilesetPath?: string,
  ): void => {
    setClientOptionsDraft((previous) => {
      const selectedTilesetPath = String(previous.tilesetPath || "").trim();
      const tilesetPath = String(rawTilesetPath || selectedTilesetPath).trim();
      const nextByTileset = {
        ...previous.darkCorridorWallSolidColorGridEnabledByTileset,
      };
      if (tilesetPath) {
        nextByTileset[tilesetPath] = enabled;
      }
      const appliesToSelected =
        Boolean(tilesetPath) && tilesetPath === selectedTilesetPath;
      return {
        ...previous,
        darkCorridorWallSolidColorGridEnabled: appliesToSelected
          ? enabled
          : previous.darkCorridorWallSolidColorGridEnabled,
        darkCorridorWallSolidColorGridEnabledByTileset: nextByTileset,
      };
    });
  };

  const updateDarkWallSolidColorGridDarknessPercentDraft = (
    rawPercent: number,
    rawTilesetPath?: string,
  ): void => {
    const parsed =
      typeof rawPercent === "number" && Number.isFinite(rawPercent)
        ? rawPercent
        : defaultNh3dClientOptions.darkCorridorWallSolidColorGridDarknessPercent;
    const percent = Math.max(0, Math.min(100, Math.round(parsed)));
    setClientOptionsDraft((previous) => {
      const selectedTilesetPath = String(previous.tilesetPath || "").trim();
      const tilesetPath = String(rawTilesetPath || selectedTilesetPath).trim();
      const nextByTileset = {
        ...previous.darkCorridorWallSolidColorGridDarknessPercentByTileset,
      };
      if (tilesetPath) {
        nextByTileset[tilesetPath] = percent;
      }
      const appliesToSelected =
        Boolean(tilesetPath) && tilesetPath === selectedTilesetPath;
      return {
        ...previous,
        darkCorridorWallSolidColorGridDarknessPercent: appliesToSelected
          ? percent
          : previous.darkCorridorWallSolidColorGridDarknessPercent,
        darkCorridorWallSolidColorGridDarknessPercentByTileset: nextByTileset,
      };
    });
  };

  const updateTilesetBackgroundTileIdDraft = (
    rawTileId: number,
    rawTilesetPath?: string,
    tileCountHint?: number,
  ): void => {
    const maxTileId =
      Number.isFinite(tileCountHint) && Number(tileCountHint) > 0
        ? Number(tileCountHint) - 1
        : Infinity;
    const nextTileId = Math.max(0, Math.min(maxTileId, Math.trunc(rawTileId)));
    setClientOptionsDraft((previous) => {
      const selectedTilesetPath = String(previous.tilesetPath || "").trim();
      const tilesetPath = String(rawTilesetPath || selectedTilesetPath).trim();
      const nextByTileset = {
        ...previous.tilesetBackgroundTileIdByTileset,
      };
      if (tilesetPath) {
        nextByTileset[tilesetPath] = nextTileId;
      }
      return {
        ...previous,
        tilesetBackgroundTileId:
          tilesetPath && tilesetPath === selectedTilesetPath
            ? nextTileId
            : previous.tilesetBackgroundTileId,
        tilesetBackgroundTileIdByTileset: nextByTileset,
      };
    });
  };

  const updateTilesetBackgroundRemovalModeDraft = (
    mode: TilesetBackgroundRemovalMode,
    rawTilesetPath?: string,
  ): void => {
    const resolvedMode: TilesetBackgroundRemovalMode =
      mode === "solid" ? "solid" : "tile";
    setClientOptionsDraft((previous) => {
      const selectedTilesetPath = String(previous.tilesetPath || "").trim();
      const tilesetPath = String(rawTilesetPath || selectedTilesetPath).trim();
      const nextByTileset = {
        ...previous.tilesetBackgroundRemovalModeByTileset,
      };
      if (tilesetPath) {
        nextByTileset[tilesetPath] = resolvedMode;
      }
      return {
        ...previous,
        tilesetBackgroundRemovalMode:
          tilesetPath && tilesetPath === selectedTilesetPath
            ? resolvedMode
            : previous.tilesetBackgroundRemovalMode,
        tilesetBackgroundRemovalModeByTileset: nextByTileset,
      };
    });
  };

  const updateTilesetSolidChromaKeyColorHexDraft = (
    rawHex: string,
    rawTilesetPath?: string,
  ): void => {
    const normalizedHex = normalizeSolidChromaKeyHex(rawHex);
    setClientOptionsDraft((previous) => {
      const selectedTilesetPath = String(previous.tilesetPath || "").trim();
      const tilesetPath = String(rawTilesetPath || selectedTilesetPath).trim();
      const nextByTileset = {
        ...previous.tilesetSolidChromaKeyColorHexByTileset,
      };
      if (tilesetPath) {
        nextByTileset[tilesetPath] = normalizedHex;
      }
      return {
        ...previous,
        tilesetSolidChromaKeyColorHex:
          tilesetPath && tilesetPath === selectedTilesetPath
            ? normalizedHex
            : previous.tilesetSolidChromaKeyColorHex,
        tilesetSolidChromaKeyColorHexByTileset: nextByTileset,
      };
    });
  };

  useEffect(() => {
    if (!clientOptionsDraft.darkCorridorWallTileOverrideEnabled) {
      setIsDarkWallTilePickerVisible(false);
    }
  }, [clientOptionsDraft.darkCorridorWallTileOverrideEnabled]);

  useEffect(() => {
    if (!clientOptionsDraft.darkCorridorWalls367) {
      setIsDarkWallTilePickerVisible(false);
    }
  }, [clientOptionsDraft.darkCorridorWalls367]);

  useEffect(() => {
    if (isVultureTilesetSelected) {
      setIsDarkWallTilePickerVisible(false);
    }
  }, [isVultureTilesetSelected]);

  useEffect(() => {
    if (clientOptionsDraft.tilesetMode !== "tiles" || !selectedTilesetEntry) {
      setIsTilesetBackgroundTilePickerVisible(false);
      setIsTilesetSolidColorPickerVisible(false);
      setIsTilesetManagerVisible(false);
    }
  }, [clientOptionsDraft.tilesetMode, selectedTilesetEntry]);

  useEffect(() => {
    if (!isTilesetManagerVisible || !selectedTilesetManagerEditPath) {
      setIsTilesetBackgroundTilePickerVisible(false);
      setIsTilesetSolidColorPickerVisible(false);
      return;
    }
    if (tilesetManagerBackgroundRemovalMode !== "tile") {
      setIsTilesetBackgroundTilePickerVisible(false);
    }
    if (tilesetManagerBackgroundRemovalMode !== "solid") {
      setIsTilesetSolidColorPickerVisible(false);
    }
  }, [
    isTilesetManagerVisible,
    selectedTilesetManagerEditPath,
    tilesetManagerBackgroundRemovalMode,
  ]);

  useEffect(() => {
    if (!isTilesetManagerVisible || tilesetManagerMode !== "edit") {
      return;
    }
    const hasActiveEditTileset =
      selectedTilesetManagerEditPath &&
      isNh3dTilesetPathAvailable(selectedTilesetManagerEditPath);
    if (hasActiveEditTileset) {
      return;
    }
    const activeTilesetPath = String(
      clientOptionsDraft.tilesetPath || "",
    ).trim();
    const fallbackTilesetPath = tilesetCatalog[0]?.path ?? "";
    const nextEditPath =
      (activeTilesetPath && isNh3dTilesetPathAvailable(activeTilesetPath)
        ? activeTilesetPath
        : "") || fallbackTilesetPath;
    if (nextEditPath) {
      openTilesetManagerEditor(nextEditPath);
      return;
    }
    openTilesetManagerNewEditor();
  }, [
    clientOptionsDraft.tilesetPath,
    isTilesetManagerVisible,
    selectedTilesetManagerEditPath,
    tilesetManagerMode,
    tilesetCatalog,
  ]);

  const renderMobileDialogCloseButton = (
    onClick: () => void,
    label = "Close",
  ): JSX.Element | null =>
    isMobileViewport ? (
      <button
        aria-label={label}
        className="nh3d-mobile-dialog-close"
        onClick={onClick}
        type="button"
      >
        {"\u00D7"}
      </button>
    ) : null;

  const focusInventoryItemByAccelerator = useCallback(
    (accelerator: string): void => {
      const normalizedAccelerator = String(accelerator || "").trim();
      if (!normalizedAccelerator) {
        return;
      }
      const focusTargetRow = (): void => {
        let targetRow: HTMLDivElement | null = null;
        for (const rowElement of inventoryRowRefs.current.values()) {
          const rowAccelerator = String(
            rowElement.dataset.nh3dAccelerator || "",
          ).trim();
          if (rowAccelerator === normalizedAccelerator) {
            targetRow = rowElement;
            break;
          }
        }
        if (!targetRow || !targetRow.isConnected) {
          return;
        }
        targetRow.focus({ preventScroll: true });
        targetRow.scrollIntoView({ block: "nearest", inline: "nearest" });
      };
      if (typeof window === "undefined") {
        focusTargetRow();
        return;
      }
      window.requestAnimationFrame(focusTargetRow);
    },
    [],
  );

  const moveInventoryItemFocusByArrowKey = useCallback(
    (
      currentRow: HTMLDivElement,
      direction: "previous" | "next",
    ): HTMLDivElement | null => {
      const focusableRows = Array.from(inventoryRowRefs.current.entries())
        .sort((left, right) => left[0] - right[0])
        .map(([, rowElement]) => rowElement)
        .filter(
          (rowElement) =>
            rowElement.isConnected &&
            !rowElement.classList.contains("nh3d-inventory-item-disabled"),
        );
      if (focusableRows.length === 0) {
        return null;
      }

      const currentIndex = focusableRows.findIndex(
        (rowElement) => rowElement === currentRow,
      );
      const delta = direction === "previous" ? -1 : 1;
      const targetIndex =
        currentIndex < 0
          ? delta > 0
            ? 0
            : focusableRows.length - 1
          : (((currentIndex + delta) % focusableRows.length) +
              focusableRows.length) %
            focusableRows.length;
      const targetRow = focusableRows[targetIndex] ?? null;
      if (!targetRow) {
        return null;
      }
      targetRow.focus({ preventScroll: true });
      targetRow.scrollIntoView({ block: "nearest", inline: "nearest" });
      return targetRow;
    },
    [],
  );

  const closeInventoryContextMenu = useCallback(
    (options?: { restoreItemFocus?: boolean }): void => {
      const shouldRestoreItemFocus = options?.restoreItemFocus === true;
      const activeContextMenu = inventoryContextMenuStateRef.current;
      setInventoryContextMenu(null);
      if (shouldRestoreItemFocus && activeContextMenu?.accelerator) {
        focusInventoryItemByAccelerator(activeContextMenu.accelerator);
      }
    },
    [focusInventoryItemByAccelerator],
  );

  const resolveInventoryContextNavigationDirection = useCallback(
    (key: string, code?: string): "up" | "down" | "left" | "right" | null => {
      switch (key) {
        case "ArrowUp":
        case "PageUp":
        case "k":
        case "K":
        case "y":
        case "Y":
        case "u":
        case "U":
          return "up";
        case "ArrowDown":
        case "PageDown":
        case "j":
        case "J":
        case "b":
        case "B":
        case "n":
        case "N":
          return "down";
        case "ArrowLeft":
        case "h":
        case "H":
          return "left";
        case "ArrowRight":
        case "l":
        case "L":
          return "right";
        default:
          break;
      }
      switch (code) {
        case "Numpad8":
        case "Numpad7":
        case "Numpad9":
          return "up";
        case "Numpad2":
        case "Numpad1":
        case "Numpad3":
          return "down";
        case "Numpad4":
          return "left";
        case "Numpad6":
          return "right";
        default:
          return null;
      }
    },
    [],
  );

  const moveInventoryContextMenuActionFocus = useCallback(
    (direction: "up" | "down" | "left" | "right"): boolean => {
      const actionButtons =
        inventoryContextMenuRef.current?.querySelectorAll<HTMLButtonElement>(
          ".nh3d-context-menu-button:not(:disabled)",
        ) ?? null;
      if (!actionButtons || actionButtons.length === 0) {
        return false;
      }
      const focusableButtons = Array.from(actionButtons).filter(
        (button) => button.isConnected,
      );
      if (focusableButtons.length === 0) {
        return false;
      }

      const measuredButtons = focusableButtons
        .map((button) => {
          const rect = button.getBoundingClientRect();
          return {
            button,
            centerX: rect.left + rect.width * 0.5,
            centerY: rect.top + rect.height * 0.5,
          };
        })
        .sort((left, right) =>
          left.centerY === right.centerY
            ? left.centerX - right.centerX
            : left.centerY - right.centerY,
        );
      const rows: Array<{
        centerY: number;
        items: Array<{
          button: HTMLButtonElement;
          centerX: number;
          centerY: number;
        }>;
      }> = [];
      const rowTolerancePx = 12;
      for (const measured of measuredButtons) {
        const lastRow = rows[rows.length - 1];
        if (
          lastRow &&
          Math.abs(measured.centerY - lastRow.centerY) <= rowTolerancePx
        ) {
          lastRow.items.push(measured);
          const rowSize = lastRow.items.length;
          lastRow.centerY =
            (lastRow.centerY * (rowSize - 1) + measured.centerY) / rowSize;
        } else {
          rows.push({
            centerY: measured.centerY,
            items: [measured],
          });
        }
      }
      for (const row of rows) {
        row.items.sort((left, right) => left.centerX - right.centerX);
      }

      const activeElement =
        typeof document !== "undefined" &&
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      const focusLinear = (delta: -1 | 1): HTMLButtonElement | null => {
        const activeIndex = activeElement
          ? focusableButtons.findIndex((button) => button === activeElement)
          : -1;
        const targetIndex =
          activeIndex < 0
            ? delta > 0
              ? 0
              : focusableButtons.length - 1
            : (((activeIndex + delta) % focusableButtons.length) +
                focusableButtons.length) %
              focusableButtons.length;
        return focusableButtons[targetIndex] ?? null;
      };

      const hasMultipleColumns = rows.some((row) => row.items.length > 1);
      let targetButton: HTMLButtonElement | null = null;
      if (rows.length > 0 && hasMultipleColumns) {
        let activeRowIndex = -1;
        let activeColumnIndex = -1;
        let activeCenterX = Number.NaN;
        if (activeElement) {
          for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
            const columnIndex = rows[rowIndex].items.findIndex(
              (item) => item.button === activeElement,
            );
            if (columnIndex >= 0) {
              activeRowIndex = rowIndex;
              activeColumnIndex = columnIndex;
              activeCenterX = rows[rowIndex].items[columnIndex].centerX;
              break;
            }
          }
        }

        if (activeRowIndex < 0 || activeColumnIndex < 0) {
          if (direction === "up" || direction === "left") {
            const lastRow = rows[rows.length - 1];
            targetButton =
              lastRow.items[lastRow.items.length - 1]?.button ?? null;
          } else {
            targetButton = rows[0].items[0]?.button ?? null;
          }
        } else if (direction === "right") {
          const currentRow = rows[activeRowIndex];
          if (activeColumnIndex < currentRow.items.length - 1) {
            targetButton =
              currentRow.items[activeColumnIndex + 1]?.button ?? null;
          } else if (activeRowIndex < rows.length - 1) {
            targetButton = rows[activeRowIndex + 1].items[0]?.button ?? null;
          } else {
            targetButton = rows[0].items[0]?.button ?? null;
          }
        } else if (direction === "left") {
          const currentRow = rows[activeRowIndex];
          if (activeColumnIndex > 0) {
            targetButton =
              currentRow.items[activeColumnIndex - 1]?.button ?? null;
          } else if (activeRowIndex > 0) {
            const previousRow = rows[activeRowIndex - 1];
            targetButton =
              previousRow.items[previousRow.items.length - 1]?.button ?? null;
          } else {
            const lastRow = rows[rows.length - 1];
            targetButton =
              lastRow.items[lastRow.items.length - 1]?.button ?? null;
          }
        } else {
          const rowDelta = direction === "up" ? -1 : 1;
          let nextRowIndex = activeRowIndex + rowDelta;
          if (nextRowIndex < 0) {
            nextRowIndex = rows.length - 1;
          } else if (nextRowIndex >= rows.length) {
            nextRowIndex = 0;
          }
          const nextRow = rows[nextRowIndex];
          targetButton =
            nextRow.items.reduce<{
              button: HTMLButtonElement;
              distance: number;
            } | null>((best, item) => {
              const distance = Math.abs(item.centerX - activeCenterX);
              if (!best || distance < best.distance) {
                return { button: item.button, distance };
              }
              return best;
            }, null)?.button ?? null;
        }
      }
      if (!targetButton) {
        const linearDelta = direction === "up" || direction === "left" ? -1 : 1;
        targetButton = focusLinear(linearDelta);
      }
      if (!targetButton) {
        return false;
      }
      targetButton.focus({ preventScroll: true });
      targetButton.scrollIntoView({ block: "nearest", inline: "nearest" });
      return true;
    },
    [],
  );

  const openInventoryContextMenu = (
    item: NethackMenuItem,
    clientX: number,
    clientY: number,
    anchorRect?: DOMRect | null,
  ): void => {
    if (!inventoryContextActionsEnabled) {
      return;
    }
    if (typeof item.accelerator !== "string") {
      return;
    }
    const itemAccelerator = item.accelerator.trim();
    if (!itemAccelerator) {
      return;
    }

    const estimatedMenuWidthPx = 220;
    const estimatedMenuHeightPx = 260;
    const pointerOffsetPx = 8;
    let anchorBottomY: number | undefined;
    let anchorRightX: number | undefined;

    let initial = clampInventoryContextMenuPosition(
      clientX + pointerOffsetPx,
      clientY + pointerOffsetPx,
      estimatedMenuWidthPx,
      estimatedMenuHeightPx,
    );

    if (anchorRect) {
      if (Number.isFinite(anchorRect.right)) {
        anchorRightX = anchorRect.right + inventoryContextMenuAnchorGapPx;
      }
      if (Number.isFinite(anchorRect.bottom)) {
        anchorBottomY =
          anchorRect.bottom + inventoryContextMenuAnchorBottomGapPx;
      }
      const preferredRightX =
        typeof anchorRightX === "number" && Number.isFinite(anchorRightX)
          ? anchorRightX
          : clientX + pointerOffsetPx;
      const preferredRightY =
        typeof anchorBottomY === "number" && Number.isFinite(anchorBottomY)
          ? anchorBottomY
          : clientY + pointerOffsetPx;
      const rightCandidate = clampInventoryContextMenuPosition(
        preferredRightX,
        preferredRightY,
        estimatedMenuWidthPx,
        estimatedMenuHeightPx,
      );

      // Always start as far right as possible.
      initial = rightCandidate;
    }
    const inventoryItemsRect =
      inventoryItemsContainerRef.current?.getBoundingClientRect() ?? null;
    const initialWithRegionClamp = resolveInventoryContextMenuPosition(
      {
        accelerator: itemAccelerator,
        itemText: String(item.text || "Unknown item"),
        x: initial.x,
        y: initial.y,
        anchorBottomY,
        anchorRightX,
      },
      estimatedMenuWidthPx,
      estimatedMenuHeightPx,
      inventoryItemsRect,
    );

    setInventoryContextMenu({
      accelerator: itemAccelerator,
      itemText: String(item.text || "Unknown item"),
      x: initialWithRegionClamp.x,
      y: initialWithRegionClamp.y,
      anchorBottomY,
      anchorRightX,
    });
  };

  const runFpsCrosshairContextAction = (
    action: FpsCrosshairContextState["actions"][number],
  ): void => {
    // Workaround for a race condition in context-menu command submission.
    // TODO: remove once the underlying ordering issue is fixed.
    const contextualSubmitDelayMs = 0;
    const autoDirectionFromFpsAim =
      fpsCrosshairContext?.autoDirectionFromFpsAim === true;
    if (action.kind === "quick") {
      controller?.runQuickAction(action.value, {
        autoDirectionFromFpsAim,
        submitDelayMs: contextualSubmitDelayMs,
      });
      return;
    }
    controller?.runExtendedCommand(action.value, {
      autoDirectionFromFpsAim,
      submitDelayMs: contextualSubmitDelayMs,
    });
  };

  useEffect(() => {
    if (!inventory.visible) {
      setInventoryContextMenu(null);
    }
  }, [inventory.visible]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleCloseInventoryContextMenu = (): void => {
      closeInventoryContextMenu({ restoreItemFocus: true });
    };
    window.addEventListener(
      nh3dCloseInventoryContextMenuEventName,
      handleCloseInventoryContextMenu,
    );
    return () => {
      window.removeEventListener(
        nh3dCloseInventoryContextMenuEventName,
        handleCloseInventoryContextMenu,
      );
    };
  }, [closeInventoryContextMenu]);

  useEffect(() => {
    if (!inventory.visible) {
      return;
    }
    scheduleInventoryRowProximityUpdate();
  }, [
    inventory.visible,
    inventoryContextMenu,
    scheduleInventoryRowProximityUpdate,
  ]);

  useEffect(() => {
    if (inventory.visible) {
      scheduleInventoryRowProximityUpdate();
      return;
    }
    inventoryPointerActiveRef.current = false;
    inventoryPointerClientYRef.current = null;
    inventoryRowPressCandidateRef.current = null;
    inventoryRowHoverValueByIndexRef.current.clear();
    for (const rowElement of inventoryRowRefs.current.values()) {
      rowElement.style.setProperty("--nh3d-inv-hover", "0");
    }
  }, [inventory.items, inventory.visible, scheduleInventoryRowProximityUpdate]);

  useEffect(() => {
    if (!inventoryReducedMotionEnabled) {
      return;
    }
    inventoryRowPressCandidateRef.current = null;
    inventoryPointerActiveRef.current = false;
    inventoryPointerClientYRef.current = null;
    for (const rowElement of inventoryRowRefs.current.values()) {
      rowElement.style.setProperty("--nh3d-inv-hover", "0");
    }
  }, [inventoryReducedMotionEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleViewportResize = (): void => {
      if (!inventory.visible) {
        return;
      }
      scheduleInventoryRowProximityUpdate();
    };
    window.addEventListener("resize", handleViewportResize);
    return () => {
      window.removeEventListener("resize", handleViewportResize);
    };
  }, [inventory.visible, scheduleInventoryRowProximityUpdate]);

  useEffect(
    () => () => {
      if (typeof window === "undefined") {
        return;
      }
      clearInventoryTouchFallbackClearTimer();
      if (inventoryRowProximityAnimationFrameRef.current === null) {
        return;
      }
      window.cancelAnimationFrame(
        inventoryRowProximityAnimationFrameRef.current,
      );
      inventoryRowProximityAnimationFrameRef.current = null;
      inventoryRowHoverValueByIndexRef.current.clear();
    },
    [clearInventoryTouchFallbackClearTimer],
  );

  useEffect(() => {
    if (inventoryContextActionsEnabled) {
      return;
    }
    setInventoryContextMenu(null);
  }, [inventoryContextActionsEnabled]);

  useEffect(() => {
    if (!inventory.visible || loadingOverlayVisible || typeof window === "undefined") {
      inventoryKeyboardActivationKeysDownRef.current.clear();
      return;
    }

    const handleKeyUp = (event: KeyboardEvent): void => {
      const normalizedKey = normalizeInventoryActivationKey(event.key);
      if (!normalizedKey) {
        return;
      }
      inventoryKeyboardActivationKeysDownRef.current.delete(normalizedKey);
    };

    const handleWindowBlur = (): void => {
      inventoryKeyboardActivationKeysDownRef.current.clear();
    };

    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("blur", handleWindowBlur);
      inventoryKeyboardActivationKeysDownRef.current.clear();
    };
  }, [inventory.visible, loadingOverlayVisible, normalizeInventoryActivationKey]);

  useEffect(() => {
    if (!newGamePrompt.visible) {
      return;
    }
    setReopenNewGamePromptOnInteraction(false);
    if (
      typeof newGamePrompt.reason === "string" &&
      newGamePrompt.reason.trim().length > 0
    ) {
      setDeferredNewGamePromptReason(newGamePrompt.reason.trim());
    }
  }, [newGamePrompt.reason, newGamePrompt.visible]);

  useEffect(() => {
    if (
      !reopenNewGamePromptOnInteraction ||
      newGamePrompt.visible ||
      loadingOverlayVisible ||
      typeof window === "undefined"
    ) {
      return;
    }
    let handled = false;
    const handleFirstInteraction = (): void => {
      if (handled) {
        return;
      }
      handled = true;
      setReopenNewGamePromptOnInteraction(false);
      setNewGamePrompt({
        visible: true,
        reason: deferredNewGamePromptReason,
      });
    };
    const handleInteractionKey = (event: KeyboardEvent): void => {
      if (
        event.key !== "Enter" &&
        event.key !== "NumpadEnter" &&
        event.key !== " " &&
        event.key !== "Space" &&
        event.key !== "Spacebar"
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      handleFirstInteraction();
    };
    window.addEventListener("pointerdown", handleFirstInteraction, true);
    window.addEventListener("keydown", handleInteractionKey, true);
    return () => {
      window.removeEventListener("pointerdown", handleFirstInteraction, true);
      window.removeEventListener("keydown", handleInteractionKey, true);
    };
  }, [
    deferredNewGamePromptReason,
    newGamePrompt.visible,
    reopenNewGamePromptOnInteraction,
    setNewGamePrompt,
    loadingOverlayVisible,
  ]);

  useEffect(() => {
    if (!inventoryContextMenu || loadingOverlayVisible) {
      return;
    }

    const handlePointerDown = (event: MouseEvent): void => {
      const target = event.target as Node | null;
      if (target && inventoryContextMenuRef.current?.contains(target)) {
        return;
      }
      setInventoryContextMenu(null);
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        closeInventoryContextMenu({ restoreItemFocus: true });
      }
    };

    const handleViewportResize = (): void => {
      setInventoryContextMenu((previous) => {
        if (!previous) {
          return previous;
        }
        const menuElement = inventoryContextMenuRef.current;
        const rect = menuElement?.getBoundingClientRect();
        const inventoryItemsRect =
          inventoryItemsContainerRef.current?.getBoundingClientRect() ?? null;
        const clamped = resolveInventoryContextMenuPosition(
          previous,
          rect?.width ?? 220,
          rect?.height ?? 260,
          inventoryItemsRect,
        );
        if (clamped.x === previous.x && clamped.y === previous.y) {
          return previous;
        }
        return {
          ...previous,
          x: clamped.x,
          y: clamped.y,
        };
      });
    };

    window.addEventListener("mousedown", handlePointerDown, true);
    window.addEventListener("contextmenu", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("resize", handleViewportResize);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown, true);
      window.removeEventListener("contextmenu", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("resize", handleViewportResize);
    };
  }, [closeInventoryContextMenu, inventoryContextMenu, loadingOverlayVisible]);

  useLayoutEffect(() => {
    if (!inventoryContextMenu) {
      return;
    }

    const menuElement = inventoryContextMenuRef.current;
    if (!menuElement) {
      return;
    }

    const rect = menuElement.getBoundingClientRect();
    const inventoryItemsRect =
      inventoryItemsContainerRef.current?.getBoundingClientRect() ?? null;
    const clamped = resolveInventoryContextMenuPosition(
      inventoryContextMenu,
      rect.width,
      rect.height,
      inventoryItemsRect,
    );
    if (
      clamped.x === inventoryContextMenu.x &&
      clamped.y === inventoryContextMenu.y
    ) {
      return;
    }

    setInventoryContextMenu((previous) => {
      if (!previous) {
        return previous;
      }
      return {
        ...previous,
        x: clamped.x,
        y: clamped.y,
      };
    });
  }, [inventoryContextMenu]);

  useLayoutEffect(() => {
    if (!fpsCrosshairContext) {
      setTileContextMenuPosition(null);
      return;
    }
    const anchorX = fpsCrosshairContext.anchorClientX;
    const anchorY = fpsCrosshairContext.anchorClientY;
    if (
      typeof anchorX !== "number" ||
      typeof anchorY !== "number" ||
      !Number.isFinite(anchorX) ||
      !Number.isFinite(anchorY)
    ) {
      setTileContextMenuPosition(null);
      return;
    }

    const menuElement = fpsCrosshairContextMenuRef.current;
    const rect = menuElement?.getBoundingClientRect();
    const width = rect?.width ?? 260;
    const height = rect?.height ?? 220;
    const unclampedX = anchorX - width / 2;
    const unclampedY = anchorY - height - tileContextMenuAnchorOffsetY;
    const clamped = clampTileContextMenuPosition(
      unclampedX,
      unclampedY,
      width,
      height,
    );
    setTileContextMenuPosition((previous) => {
      if (previous && previous.x === clamped.x && previous.y === clamped.y) {
        return previous;
      }
      return clamped;
    });
  }, [
    fpsCrosshairContext,
    fpsCrosshairContext?.anchorClientX,
    fpsCrosshairContext?.anchorClientY,
  ]);

  useEffect(() => {
    if (!fpsCrosshairContext || loadingOverlayVisible) {
      return;
    }

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (target && fpsCrosshairContextMenuRef.current?.contains(target)) {
        return;
      }
      controller?.dismissFpsCrosshairContextMenu();
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        controller?.dismissFpsCrosshairContextMenu();
      }
    };

    const handleViewportResize = (): void => {
      const menuElement = fpsCrosshairContextMenuRef.current;
      const rect = menuElement?.getBoundingClientRect();
      const width = rect?.width ?? 260;
      const height = rect?.height ?? 220;
      const anchorX =
        typeof fpsCrosshairContext.anchorClientX === "number"
          ? fpsCrosshairContext.anchorClientX
          : window.innerWidth * 0.5;
      const anchorY =
        typeof fpsCrosshairContext.anchorClientY === "number"
          ? fpsCrosshairContext.anchorClientY
          : window.innerHeight * 0.5;
      const clamped = clampTileContextMenuPosition(
        anchorX - width / 2,
        anchorY - height - tileContextMenuAnchorOffsetY,
        width,
        height,
      );
      setTileContextMenuPosition((previous) => {
        if (previous && previous.x === clamped.x && previous.y === clamped.y) {
          return previous;
        }
        return clamped;
      });
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("resize", handleViewportResize);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("resize", handleViewportResize);
    };
  }, [controller, fpsCrosshairContext, loadingOverlayVisible]);

  useEffect(() => {
    if (loadingOverlayVisible || typeof window === "undefined") {
      return;
    }

    const handleEscapeForClientOptions = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || isMobileViewport) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (isControllerSupportPromptVisible) {
        event.preventDefault();
        event.stopPropagation();
        confirmControllerSupportPromptChoice(false);
        return;
      }

      if (isPauseMenuVisible) {
        if (isExitConfirmationVisible) {
          setIsExitConfirmationVisible(false);
        } else {
          setIsPauseMenuVisible(false);
        }
        return;
      }

      if (isClientOptionsVisible) {
        event.preventDefault();
        event.stopPropagation();
        if (controllerRemapListening) {
          clearControllerBindingCapture();
          return;
        }
        if (isControllerRemapVisible) {
          closeControllerRemapDialog();
          return;
        }
        if (isResetClientOptionsConfirmationVisible) {
          setIsResetClientOptionsConfirmationVisible(false);
          return;
        }
        if (isTilesetManagerVisible) {
          closeTilesetManager();
          return;
        }
        if (isDarkWallTilePickerVisible) {
          setIsDarkWallTilePickerVisible(false);
          return;
        }
        if (isTilesetBackgroundTilePickerVisible) {
          setIsTilesetBackgroundTilePickerVisible(false);
          return;
        }
        if (isTilesetSolidColorPickerVisible) {
          setIsTilesetSolidColorPickerVisible(false);
          return;
        }
        requestCloseClientOptionsDialog();
        return;
      }

      if (!isDesktopGameRunning || hasGameplayOverlayOpen) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setIsPauseMenuVisible(true);
    };

    window.addEventListener("keydown", handleEscapeForClientOptions, true);
    return () => {
      window.removeEventListener("keydown", handleEscapeForClientOptions, true);
    };
  }, [
    clientOptions,
    clearControllerBindingCapture,
    closeControllerRemapDialog,
    confirmControllerSupportPromptChoice,
    controller,
    controllerRemapListening,
    hasGameplayOverlayOpen,
    isClientOptionsVisible,
    isControllerSupportPromptVisible,
    isControllerRemapVisible,
    isDarkWallTilePickerVisible,
    isTilesetBackgroundTilePickerVisible,
    isTilesetSolidColorPickerVisible,
    isTilesetManagerVisible,
    isResetClientOptionsConfirmationVisible,
    isPauseMenuVisible,
    isExitConfirmationVisible,
    isDesktopGameRunning,
    isMobileViewport,
    loadingOverlayVisible,
  ]);

  const clearStartupControllerCursorHighlight = useCallback((): void => {
    const highlightedElement =
      startupControllerCursorHighlightElementRef.current;
    if (highlightedElement) {
      highlightedElement.classList.remove("nh3d-controller-hover-target");
      startupControllerCursorHighlightElementRef.current = null;
    }
  }, []);

  const ensureStartupControllerCursorOverlay = useCallback((): void => {
    if (
      startupControllerCursorElementRef.current &&
      startupControllerCursorPulseElementRef.current
    ) {
      return;
    }
    const cursor = document.createElement("div");
    cursor.className =
      "nh3d-controller-virtual-cursor nh3d-controller-virtual-cursor-app";
    cursor.setAttribute("aria-hidden", "true");
    cursor.style.display = "none";
    const pulse = document.createElement("div");
    pulse.className =
      "nh3d-controller-virtual-cursor-pulse nh3d-controller-virtual-cursor-pulse-app";
    pulse.setAttribute("aria-hidden", "true");
    pulse.style.display = "none";
    document.body.appendChild(cursor);
    document.body.appendChild(pulse);
    startupControllerCursorElementRef.current = cursor;
    startupControllerCursorPulseElementRef.current = pulse;
  }, []);

  const setStartupControllerCursorVisible = useCallback(
    (visible: boolean): void => {
      ensureStartupControllerCursorOverlay();
      startupControllerCursorVisibleRef.current = visible;
      const cursor = startupControllerCursorElementRef.current;
      if (cursor) {
        cursor.style.display = visible ? "block" : "none";
      }
      if (!visible) {
        clearStartupControllerCursorHighlight();
      }
    },
    [
      clearStartupControllerCursorHighlight,
      ensureStartupControllerCursorOverlay,
    ],
  );

  const updateStartupControllerCursorHighlightAtPoint = useCallback(
    (clientX: number, clientY: number): void => {
      const target = document.elementFromPoint(clientX, clientY);
      const highlightedCandidate =
        target instanceof HTMLElement
          ? ((target.closest(
              "button, summary, [role='button'], a, input, select, textarea, label, [tabindex]",
            ) as HTMLElement | null) ?? target)
          : null;
      const previousHighlight =
        startupControllerCursorHighlightElementRef.current;
      if (previousHighlight && previousHighlight !== highlightedCandidate) {
        previousHighlight.classList.remove("nh3d-controller-hover-target");
        startupControllerCursorHighlightElementRef.current = null;
      }
      if (
        highlightedCandidate &&
        highlightedCandidate !== previousHighlight &&
        highlightedCandidate.isConnected
      ) {
        highlightedCandidate.classList.add("nh3d-controller-hover-target");
        startupControllerCursorHighlightElementRef.current =
          highlightedCandidate;
      }
    },
    [],
  );

  const setStartupControllerCursorPosition = useCallback(
    (clientX: number, clientY: number): void => {
      ensureStartupControllerCursorOverlay();
      const clampedX = Math.max(0, Math.min(window.innerWidth, clientX));
      const clampedY = Math.max(0, Math.min(window.innerHeight, clientY));
      startupControllerCursorXRef.current = clampedX;
      startupControllerCursorYRef.current = clampedY;
      const cursor = startupControllerCursorElementRef.current;
      if (cursor) {
        cursor.style.left = `${Math.round(clampedX)}px`;
        cursor.style.top = `${Math.round(clampedY)}px`;
      }
      if (startupControllerCursorVisibleRef.current) {
        updateStartupControllerCursorHighlightAtPoint(clampedX, clampedY);
      }
    },
    [
      ensureStartupControllerCursorOverlay,
      updateStartupControllerCursorHighlightAtPoint,
    ],
  );

  const ensureStartupControllerCursorSeedPosition = useCallback((): void => {
    if (
      Number.isFinite(startupControllerCursorXRef.current) &&
      Number.isFinite(startupControllerCursorYRef.current)
    ) {
      return;
    }
    const topDialog = getTopVisibleControllerDialogElement();
    if (topDialog) {
      const rect = topDialog.getBoundingClientRect();
      setStartupControllerCursorPosition(
        rect.left + rect.width * 0.5,
        rect.top + rect.height * 0.5,
      );
      return;
    }
    setStartupControllerCursorPosition(
      window.innerWidth * 0.5,
      window.innerHeight * 0.5,
    );
  }, [setStartupControllerCursorPosition]);

  const pulseStartupControllerCursor = useCallback((): void => {
    const pulse = startupControllerCursorPulseElementRef.current;
    const x = startupControllerCursorXRef.current;
    const y = startupControllerCursorYRef.current;
    if (!pulse || !Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }
    pulse.style.left = `${Math.round(x)}px`;
    pulse.style.top = `${Math.round(y)}px`;
    pulse.style.display = "block";
    pulse.classList.remove("is-active");
    void pulse.offsetWidth;
    pulse.classList.add("is-active");
    if (startupControllerCursorPulseTimerRef.current !== null) {
      window.clearTimeout(startupControllerCursorPulseTimerRef.current);
      startupControllerCursorPulseTimerRef.current = null;
    }
    startupControllerCursorPulseTimerRef.current = window.setTimeout(() => {
      pulse.classList.remove("is-active");
      pulse.style.display = "none";
      startupControllerCursorPulseTimerRef.current = null;
    }, 260);
  }, []);

  const resetStartupControllerCursor = useCallback((): void => {
    startupControllerCursorVisibleRef.current = false;
    if (startupControllerCursorElementRef.current) {
      startupControllerCursorElementRef.current.style.display = "none";
    }
    if (startupControllerCursorPulseTimerRef.current !== null) {
      window.clearTimeout(startupControllerCursorPulseTimerRef.current);
      startupControllerCursorPulseTimerRef.current = null;
    }
    if (startupControllerCursorPulseElementRef.current) {
      startupControllerCursorPulseElementRef.current.classList.remove(
        "is-active",
      );
      startupControllerCursorPulseElementRef.current.style.display = "none";
    }
    clearStartupControllerCursorHighlight();
  }, [clearStartupControllerCursorHighlight]);

  const clearStartupControllerActiveSliderVisual = useCallback((): void => {
    const previousSlider = startupControllerActiveSliderElementRef.current;
    if (previousSlider && previousSlider.isConnected) {
      previousSlider.classList.remove("nh3d-controller-slider-active");
    }
    startupControllerActiveSliderElementRef.current = null;
  }, []);

  const setStartupControllerActiveSliderVisual = useCallback(
    (slider: HTMLInputElement | null): void => {
      const previousSlider = startupControllerActiveSliderElementRef.current;
      if (
        previousSlider &&
        previousSlider !== slider &&
        previousSlider.isConnected
      ) {
        previousSlider.classList.remove("nh3d-controller-slider-active");
      }
      startupControllerActiveSliderElementRef.current = slider;
      if (slider && slider.isConnected) {
        slider.classList.add("nh3d-controller-slider-active");
      }
    },
    [],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const startupControllerContextActive =
      startupMenuVisible && !loadingOverlayVisible;
    if (!startupControllerContextActive) {
      startupControllerPreviousActionActiveRef.current = {};
      startupAccordionConfirmReleaseLatchRef.current = false;
      startupControllerSliderInteractionActiveRef.current = false;
      startupControllerSliderStepCarryRef.current = 0;
      clearStartupControllerActiveSliderVisual();
      resetStartupControllerCursor();
      return;
    }

    ensureStartupControllerCursorOverlay();
    let frameHandle = 0;
    let lastFrameAtMs = performance.now();

    const tick = (nowMs: number): void => {
      const deltaSeconds = Math.max(
        0,
        Math.min(0.2, (nowMs - lastFrameAtMs) / 1000),
      );
      lastFrameAtMs = nowMs;

      const sourceOptions = isClientOptionsVisible
        ? clientOptionsDraft
        : clientOptions;
      const controllerSupportEnabled =
        sourceOptions.controllerEnabled === true ||
        isControllerSupportPromptVisible;
      if (!controllerSupportEnabled) {
        startupControllerPreviousActionActiveRef.current = {};
        startupAccordionConfirmReleaseLatchRef.current = false;
        startupControllerSliderInteractionActiveRef.current = false;
        startupControllerSliderStepCarryRef.current = 0;
        clearStartupControllerActiveSliderVisual();
        resetStartupControllerCursor();
        frameHandle = window.requestAnimationFrame(tick);
        return;
      }

      const bindings = normalizeNh3dControllerBindings(
        sourceOptions.controllerBindings,
      );
      const gamepads = getConnectedGamepadsForCapture();
      const previousActionActive =
        startupControllerPreviousActionActiveRef.current;
      const nextActionActive: Partial<Record<Nh3dControllerActionId, boolean>> =
        {};
      const actionPressed: Partial<Record<Nh3dControllerActionId, boolean>> =
        {};
      const actionValues: Partial<Record<Nh3dControllerActionId, number>> = {};

      for (const actionId of startupControllerNavActionIds) {
        const value = getControllerActionValueFromGamepads(
          actionId,
          bindings,
          gamepads,
        );
        actionValues[actionId] = value;
        const isActive = value >= startupControllerActionThreshold;
        const wasActive = previousActionActive[actionId] === true;
        actionPressed[actionId] = isActive && !wasActive;
        nextActionActive[actionId] = isActive;
      }
      startupControllerPreviousActionActiveRef.current = nextActionActive;

      if (controllerRemapListening) {
        startupControllerSliderInteractionActiveRef.current = false;
        startupControllerSliderStepCarryRef.current = 0;
        clearStartupControllerActiveSliderVisual();
        if (actionPressed.cancel_or_context) {
          clearControllerBindingCapture();
        }
        frameHandle = window.requestAnimationFrame(tick);
        return;
      }

      const topDialog = getTopVisibleControllerDialogElement();
      const focusedSlider = getFocusedControllerRangeInput(topDialog);
      if (!focusedSlider) {
        startupControllerSliderInteractionActiveRef.current = false;
        startupControllerSliderStepCarryRef.current = 0;
        clearStartupControllerActiveSliderVisual();
      }

      if (
        focusedSlider &&
        actionPressed.confirm &&
        !startupControllerSliderInteractionActiveRef.current &&
        !startupAccordionConfirmReleaseLatchRef.current
      ) {
        startupControllerSliderInteractionActiveRef.current = true;
        startupControllerSliderStepCarryRef.current = 0;
        startupAccordionConfirmReleaseLatchRef.current = true;
        setStartupControllerActiveSliderVisual(focusedSlider);
        setStartupControllerCursorVisible(false);
        frameHandle = window.requestAnimationFrame(tick);
        return;
      }

      if (startupControllerSliderInteractionActiveRef.current) {
        if (!focusedSlider) {
          startupControllerSliderInteractionActiveRef.current = false;
          startupControllerSliderStepCarryRef.current = 0;
          clearStartupControllerActiveSliderVisual();
        } else {
          setStartupControllerActiveSliderVisual(focusedSlider);
          if (actionPressed.cancel_or_context) {
            startupControllerSliderInteractionActiveRef.current = false;
            startupControllerSliderStepCarryRef.current = 0;
            clearStartupControllerActiveSliderVisual();
            frameHandle = window.requestAnimationFrame(tick);
            return;
          }

          const dpadStepDirection = actionPressed.dpad_right
            ? 1
            : actionPressed.dpad_left
              ? -1
              : 0;
          if (dpadStepDirection !== 0) {
            stepControllerRangeInput(focusedSlider, dpadStepDirection);
          }

          const sliderAxisX =
            (actionValues.left_stick_right ?? 0) -
            (actionValues.left_stick_left ?? 0);
          if (Math.abs(sliderAxisX) > startupControllerCursorDeadzone) {
            const nextStepCarry =
              startupControllerSliderStepCarryRef.current +
              sliderAxisX *
                startupControllerSliderFastStepsPerSec *
                deltaSeconds;
            const fastStepCount =
              nextStepCarry > 0
                ? Math.floor(nextStepCarry)
                : Math.ceil(nextStepCarry);
            startupControllerSliderStepCarryRef.current =
              nextStepCarry - fastStepCount;
            if (fastStepCount !== 0) {
              stepControllerRangeInput(focusedSlider, fastStepCount);
            }
          } else {
            startupControllerSliderStepCarryRef.current = 0;
          }

          frameHandle = window.requestAnimationFrame(tick);
          return;
        }
      }

      let focusDirection: "up" | "down" | "left" | "right" | null = null;
      if (actionPressed.dpad_up) {
        focusDirection = "up";
      } else if (actionPressed.dpad_down) {
        focusDirection = "down";
      } else if (actionPressed.dpad_left) {
        focusDirection = "left";
      } else if (actionPressed.dpad_right) {
        focusDirection = "right";
      }
      if (focusDirection) {
        setStartupControllerCursorVisible(false);
        applyDialogDirectionalNavigation(focusDirection, topDialog, {
          focusedSlider,
        });
      }

      const leftAxisX =
        (actionValues.left_stick_right ?? 0) -
        (actionValues.left_stick_left ?? 0);
      const leftAxisY =
        (actionValues.left_stick_down ?? 0) - (actionValues.left_stick_up ?? 0);
      const leftAxisMagnitude = Math.hypot(leftAxisX, leftAxisY);
      if (leftAxisMagnitude > startupControllerCursorDeadzone) {
        ensureStartupControllerCursorSeedPosition();
        setStartupControllerCursorVisible(true);
        const nextCursorX =
          startupControllerCursorXRef.current +
          leftAxisX * startupControllerCursorSpeedPxPerSec * deltaSeconds;
        const nextCursorY =
          startupControllerCursorYRef.current +
          leftAxisY * startupControllerCursorSpeedPxPerSec * deltaSeconds;
        setStartupControllerCursorPosition(nextCursorX, nextCursorY);
      }

      const scrollAxisY =
        (actionValues.right_stick_down ?? 0) -
        (actionValues.right_stick_up ?? 0);
      if (Math.abs(scrollAxisY) > 0.02) {
        const scrollElement = findControllerScrollableElement(topDialog);
        if (scrollElement) {
          scrollElement.scrollTop +=
            scrollAxisY * startupControllerScrollSpeedPxPerSec * deltaSeconds;
        }
      }

      const confirmValue = actionValues.confirm ?? 0;
      if (confirmValue <= 0.12) {
        startupAccordionConfirmReleaseLatchRef.current = false;
      }

      if (
        actionPressed.confirm &&
        !controllerRemapListening &&
        !startupAccordionConfirmReleaseLatchRef.current
      ) {
        let confirmConsumed = false;
        const clickedElement =
          startupControllerCursorVisibleRef.current &&
          Number.isFinite(startupControllerCursorXRef.current) &&
          Number.isFinite(startupControllerCursorYRef.current)
            ? clickControllerDialogElementAtPoint(
                startupControllerCursorXRef.current,
                startupControllerCursorYRef.current,
              )
            : null;
        if (clickedElement) {
          pulseStartupControllerCursor();
          confirmConsumed = true;
        } else {
          const focusedClickElement = clickFocusedControllerDialogElement();
          if (focusedClickElement) {
            confirmConsumed = true;
          }
        }
        if (confirmConsumed) {
          startupAccordionConfirmReleaseLatchRef.current = true;
        }
      }

      if (actionPressed.cancel_or_context) {
        if (isControllerSupportPromptVisible) {
          confirmControllerSupportPromptChoice(false);
        } else if (controllerRemapListening) {
          clearControllerBindingCapture();
        } else if (isControllerRemapVisible) {
          closeControllerRemapDialog();
        } else if (isClientOptionsVisible) {
          requestCloseClientOptionsDialog();
        } else if (startupFlowStep !== "choose") {
          setStartupFlowStep("choose");
        }
      }

      frameHandle = window.requestAnimationFrame(tick);
    };

    frameHandle = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frameHandle);
      startupControllerPreviousActionActiveRef.current = {};
      startupAccordionConfirmReleaseLatchRef.current = false;
      startupControllerSliderInteractionActiveRef.current = false;
      startupControllerSliderStepCarryRef.current = 0;
      clearStartupControllerActiveSliderVisual();
      resetStartupControllerCursor();
    };
  }, [
    applyDialogDirectionalNavigation,
    characterCreationConfig,
    clearStartupControllerActiveSliderVisual,
    clearControllerBindingCapture,
    clientOptions,
    clientOptionsDraft,
    closeControllerRemapDialog,
    confirmControllerSupportPromptChoice,
    controllerRemapListening,
    ensureStartupControllerCursorOverlay,
    ensureStartupControllerCursorSeedPosition,
    isClientOptionsVisible,
    isControllerSupportPromptVisible,
    isControllerRemapVisible,
    pulseStartupControllerCursor,
    resetStartupControllerCursor,
    requestCloseClientOptionsDialog,
    setStartupControllerActiveSliderVisual,
    setStartupControllerCursorPosition,
    setStartupControllerCursorVisible,
    startup,
    startupFlowStep,
    loadingOverlayVisible,
  ]);

  const renderPauseMenu = () => {
    return (
      <AnimatedDialog
        className="nh3d-dialog nh3d-dialog-question nh3d-dialog-fixed-actions"
        open={isPauseMenuVisible}
        id="pause-menu-dialog"
      >
        {isExitConfirmationVisible ? (
          <>
            <div className="nh3d-question-text">
              Do you want to save before quitting?
            </div>
            <div className="nh3d-menu-actions">
              <button
                className="nh3d-menu-action-button nh3d-menu-action-confirm"
                onClick={() => {
                  controller?.sendInput("S");
                  setTimeout(() => window.location.reload(), 1000);
                }}
                type="button"
              >
                Yes
              </button>
              <button
                className="nh3d-menu-action-button"
                onClick={() => {
                  window.location.reload();
                }}
                type="button"
              >
                No
              </button>
              <button
                className="nh3d-menu-action-button nh3d-menu-action-cancel"
                onClick={() => setIsExitConfirmationVisible(false)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="nh3d-options-title">Game Paused</div>
            <div className="nh3d-overflow-glow-frame">
              <div
                className="nh3d-choice-list"
                data-nh3d-overflow-glow
                data-nh3d-overflow-glow-host="parent"
              >
                <button
                  className="nh3d-choice-button"
                  onClick={() => setIsPauseMenuVisible(false)}
                  type="button"
                >
                  Resume
                </button>
                <button
                  className="nh3d-choice-button"
                  onClick={openClientOptionsDialog}
                  type="button"
                >
                  Options
                </button>
                <button
                  className="nh3d-choice-button"
                  onClick={() => {
                    controller?.sendInput("S");
                    setIsPauseMenuVisible(false);
                  }}
                  type="button"
                >
                  Save game
                </button>
                <button
                  className="nh3d-choice-button"
                  onClick={() => setIsExitConfirmationVisible(true)}
                  type="button"
                >
                  Exit to main menu
                </button>
                <button
                  className="nh3d-choice-button"
                  onClick={() => {
                    void requestGameQuit();
                  }}
                  type="button"
                >
                  Quit Game
                </button>
              </div>
            </div>
          </>
        )}
      </AnimatedDialog>
    );
  };

  return (
    <>
      <div className="nh3d-canvas-root" ref={canvasRootRef} />
      {renderPauseMenu()}
      {startupUiVisible && (
        <div className="logo-container">
          <pre className="nethack-ascii-logo">
            {`                
  +$$&&&&&$;         :X$&&&&$X:                       :X$&&&&&$X;     :X&&&&&&&$+                               .;;+X$;                                               
    +X&&&&&$X          X&&&$+                           +X&&&$+:        xX&&&&+:                              .$&&&&&+:                                               
    :x&&&&&&&$:        X$&&X;                           ;X&&&$x.        +X&&&$x.                                X$&&$+:                                               
    :x&&&&&&&&$x       X&&&X;                   x&:     ;X&&&$X.        +X&&&$x.                                X$&&&x:                                               
    :x&&x&&&&&&&$      X&&&X:        _       .$&&+:     ;X&&&$x.        +X&&&$x.                                X$&&&x.                                               
    :X&&x;X&&&&&&&:    X&&&X:   :+$&&&&&+   :&&&&$Xxxx; ;X&&&$X;.:;::::.xX&&&$x.   ;+$&&&&$+        :;+XXXXx;:  X$&&$x.   .XXXX+                                      
    :X&&x::+&&&&&&&x   X$&&x:  X&&$;;X&&&$ ;$&&&&XXXX;  ;x$$$$&&&&&&&&&&&&$$$$x  +&$X+;+$&&&$.    :$&&$x++$&&$+ X$$$$+.   +$$+:                                       
    :X&$x:  ;$&$&&$&&  +$&&x: $&&x:  :X&&x+  $&&&;.     ;+XXXXXXXXXXXXXXXX$$$X+  :+:    ;$$$Xx   X&&$;:   .++:  xX$$X+. ;&$+:                                         
    :X$$x:   ;+$$$$$&&:;X$$+.;X&&x  +$$&&xx  $&&&+.     ;+XXX+;. .. .   ;xXXXX+        :$$$$X+  x$$$;;          xXXXX+:$$Xx;                                          
    :X$Xx:    .;$XXXX$&$XX$+.;X&&&$Xx;:      $&$$;.     :+Xxx+;.        ;xXXxx+    ;XXX++XXXX+  xXXX;:          +XxxxxX$XXxx;                                         
    :+Xx+:      ;XXXXXX&&xX+ ;;$$Xx:         $$XX;.     :+x+++;.        ;+x+++;  ;XX+:. ;xxxx+  +xxX++          +x+++::+XxX++:                                        
    :+X++:       :+xxxxxX+x; .;xXX$$:     ,  XXxX+:     :;x+++;.        ;+++++; ;xx++   ;x++++  ;+x+x++         +x+++:.:;++x++:                                       
    :;x++:        :;x+++++x;  :;+XX$&&$XXX;  ++xx&&X+x; :;+++;;.        ;+++++; ;;++xX;;xx++++: .;;++xXXx;:;;+: ;x+++:. :;+++++;                                      
    X$++X&+         :x++++x;   .::+X$$$+::   .;;XX$+::  xX;;;;+;        xx;;;;+: ::+++;:: ++;;;.  ::;++++x+::.  Xx;;;+:  .:++++++.                                    
  :+;;:::::;x+        ;++X+:       :;;;:        ::;:.  ;::::::::::;   .;::::::::::: ...    ::.       .:::::.  .;::::::::::  ::::::::                                   
                                                                                                                                                                      
                                                                                                                                                                      
                                            ;&&&&&&&&&&&&&&&&&&x   x&&&&&&&&&&&&&$X+:.                                                                                
                                            :;&&&&&&&&&&&&&&&&+:   :;&&&&&$&&&&&&&&&&&&+                                                                              
                                            ;+:::::::::$&&&&$:.    :+&&&&&:.    ::&&&&&&$;                                                                            
                                                      $&&&&X:.      ;X&&&&&:.     :;$&&&&&&                                                                           
                                                    $&&&&X;:;+;:    +$&&&&&:.      ++&&&&&XX                                                                           
                                                  :X$$$$&&&&&&&&&+  ;x&&&&&:.      +X&&&&&+x                                                                           
                                                        .:X&&&&&&$; :+$$$$$:.      +X&$$$&++                                                                           
                                                          :+$$$$$:: :;XxxxX..      xxXXxxX;+                                                                           
                                                          :;XxxxX.. .:x+++x..     :+X++++::                                                                            
                                            x&+         :XX;;;;;.   :+;;;+.     XXx;;;+::                                                                             
                                            :;xx$&&$$XXX$X;:::;:.   .;+;;;++&$&&&x;;;+;:                                                                               
                                             ::::::;;;;;::::::      x+;:::;;;;:::::::                                                                                  
                                                                      `}
          </pre>
          <pre className="nethack-ascii-logo">
            {`                
  +$$&&&&&$;         :X$&&&&$X:                       :X$&&&&&$X;     :X&&&&&&&$+                               .;;+X$;                                               
    +X&&&&&$X          X&&&$+                           +X&&&$+:        xX&&&&+:                              .$&&&&&+:                                               
    :x&&&&&&&$:        X$&&X;                           ;X&&&$x.        +X&&&$x.                                X$&&$+:                                               
    :x&&&&&&&&$x       X&&&X;                   x&:     ;X&&&$X.        +X&&&$x.                                X$&&&x:                                               
    :x&&x&&&&&&&$      X&&&X:        _       .$&&+:     ;X&&&$x.        +X&&&$x.                                X$&&&x.                                               
    :X&&x;X&&&&&&&:    X&&&X:   :+$&&&&&+   :&&&&$Xxxx; ;X&&&$X;.:;::::.xX&&&$x.   ;+$&&&&$+        :;+XXXXx;:  X$&&$x.   .XXXX+                                      
    :X&&x::+&&&&&&&x   X$&&x:  X&&$;;X&&&$ ;$&&&&XXXX;  ;x$$$$&&&&&&&&&&&&$$$$x  +&$X+;+$&&&$.    :$&&$x++$&&$+ X$$$$+.   +$$+:                                       
    :X&$x:  ;$&$&&$&&  +$&&x: $&&x:  :X&&x+  $&&&;.     ;+XXXXXXXXXXXXXXXX$$$X+  :+:    ;$$$Xx   X&&$;:   .++:  xX$$X+. ;&$+:                                         
    :X$$x:   ;+$$$$$&&:;X$$+.;X&&x  +$$&&xx  $&&&+.     ;+XXX+;. .. .   ;xXXXX+        :$$$$X+  x$$$;;          xXXXX+:$$Xx;                                          
    :X$Xx:    .;$XXXX$&$XX$+.;X&&&$Xx;:      $&$$;.     :+Xxx+;.        ;xXXxx+    ;XXX++XXXX+  xXXX;:          +XxxxxX$XXxx;                                         
    :+Xx+:      ;XXXXXX&&xX+ ;;$$Xx:         $$XX;.     :+x+++;.        ;+x+++;  ;XX+:. ;xxxx+  +xxX++          +x+++::+XxX++:                                        
    :+X++:       :+xxxxxX+x; .;xXX$$:     ,  XXxX+:     :;x+++;.        ;+++++; ;xx++   ;x++++  ;+x+x++         +x+++:.:;++x++:                                       
    :;x++:        :;x+++++x;  :;+XX$&&$XXX;  ++xx&&X+x; :;+++;;.        ;+++++; ;;++xX;;xx++++: .;;++xXXx;:;;+: ;x+++:. :;+++++;                                      
    X$++X&+         :x++++x;   .::+X$$$+::   .;;XX$+::  xX;;;;+;        xx;;;;+: ::+++;:: ++;;;.  ::;++++x+::.  Xx;;;+:  .:++++++.                                    
  :+;;:::::;x+        ;++X+:       :;;;:        ::;:.  ;::::::::::;   .;::::::::::: ...    ::.       .:::::.  .;::::::::::  ::::::::                                   
                                                                                                                                                                      
                                                                                                                                                                      
                                            ;&&&&&&&&&&&&&&&&&&x   x&&&&&&&&&&&&&$X+:.                                                                                
                                            :;&&&&&&&&&&&&&&&&+:   :;&&&&&$&&&&&&&&&&&&+                                                                              
                                            ;+:::::::::$&&&&$:.    :+&&&&&:.    ::&&&&&&$;                                                                            
                                                      $&&&&X:.      ;X&&&&&:.     :;$&&&&&&                                                                            
                                                    $&&&&X;:;+;:    +$&&&&&:.      ++&&&&&XX                                                                           
                                                  :X$$$$&&&&&&&&&+  ;x&&&&&:.      +X&&&&&+x                                                                           
                                                        .:X&&&&&&$; :+$$$$$:.      +X&$$$&++                                                                           
                                                          :+$$$$$:: :;XxxxX..      xxXXxxX;+                                                                           
                                                          :;XxxxX.. .:x+++x..     :+X++++::                                                                            
                                            x&+         :XX;;;;;.   :+;;;+.     XXx;;;+::                                                                             
                                            :;xx$&&$$XXX$X;:::;:.   .;+;;;++&$&&&x;;;+;:                                                                               
                                             ::::::;;;;;::::::      x+;:::;;;;:::::::                                                                                  
                                                                      `}
          </pre>
        </div>
      )}

      <AnimatedDialog
        className="nh3d-dialog nh3d-dialog-question nh3d-dialog-fixed-actions startup nh3d-character-setup-dialog"
        open={startupChooseDialogVisible}
        id="character-setup-dialog-choose"
        onBlurCapture={handleStartupMainMenuBlurCapture}
        onChangeCapture={handleStartupMainMenuChangeCapture}
        onKeyDown={handleStartupMainMenuKeyDown}
        onPointerDownCapture={handleStartupMainMenuPointerDownCapture}
      >
        <div className="nh3d-question-text">Choose your character setup:</div>
        <div className="nh3d-overflow-glow-frame">
          <div
            className="nh3d-choice-list nh3d-choice-list-startup-choose"
            data-nh3d-overflow-glow
            data-nh3d-overflow-glow-host="parent"
          >
            <div className="nh3d-startup-config-grid centered">
              <label className="nh3d-startup-config-field">
                <span>NetHack Version</span>
                <select
                  className="nh3d-startup-config-select"
                  onChange={(event) =>
                    setRuntimeVersion(event.target.value as NethackRuntimeVersion)
                  }
                  value={runtimeVersion}
                >
                  <option value="3.6.7">3.6.x (3.6.7)</option>
                  {import.meta.env.DEV && <option value="3.7">3.7</option>}
                </select>
              </label>
            </div>
            <button
              className="nh3d-choice-button nh3d-character-setup-choice-button"
              onClick={() => setStartupFlowStep("random")}
              type="button"
            >
              Random character
            </button>
            <button
              className="nh3d-choice-button nh3d-character-setup-choice-button"
              onClick={() => setStartupFlowStep("create")}
              type="button"
            >
              Create character
            </button>
            <button
              className="nh3d-choice-button nh3d-character-setup-choice-button"
              onClick={handleResumeClick}
              type="button"
            >
              Load game
            </button>
            <button
              className="nh3d-choice-button nh3d-character-setup-choice-button"
              onClick={openClientOptionsDialog}
              type="button"
            >
              NetHack 3D Options
            </button>
            <button
              className="nh3d-choice-button nh3d-character-setup-choice-button"
              onClick={() => {
                void requestGameQuit();
              }}
              type="button"
            >
              Quit Game
            </button>
          </div>
        </div>
      </AnimatedDialog>

      <AnimatedDialog
        className="nh3d-dialog nh3d-dialog-question nh3d-dialog-fixed-actions startup nh3d-character-setup-dialog"
        open={startupResumeDialogVisible}
        id="character-setup-dialog-resume"
        onBlurCapture={handleStartupMainMenuBlurCapture}
        onChangeCapture={handleStartupMainMenuChangeCapture}
        onKeyDown={handleStartupMainMenuKeyDown}
        onPointerDownCapture={handleStartupMainMenuPointerDownCapture}
      >
        <div className="nh3d-question-text">Select a saved game:</div>
        <div className="nh3d-overflow-glow-frame">
          <div
            className="nh3d-choice-list"
            data-nh3d-overflow-glow
            data-nh3d-overflow-glow-host="parent"
            style={{ width: "100%" }}
          >
            {isLoadingSaves ? (
              <div
                style={{
                  padding: "20px",
                  color: "var(--nh3d-ui-text-muted)",
                }}
              >
                Loading saves...
              </div>
            ) : savedGames.length > 0 ? (
              savedGames.map((save) => (
                <button
                  key={save.name}
                  className="nh3d-choice-button nh3d-character-setup-choice-button"
                  style={{
                    flexDirection: "column",
                    alignItems: "flex-start",
                    padding: "12px",
                    width: "100%",
                  }}
                  onClick={() => {
                    setCharacterCreationConfig({
                      mode: "resume" as any,
                      playMode: clientOptions.fpsMode ? "fps" : "normal",
                      runtimeVersion,
                      name: save.name,
                    });
                  }}
                  type="button"
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      width: "100%",
                      alignItems: "center",
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontWeight: "bold",
                          fontSize: "calc(16px * var(--nh3d-ui-font-scale, 1))",
                        }}
                      >
                        {save.name}
                      </div>
                      <div
                        style={{
                          fontSize: "calc(12px * var(--nh3d-ui-font-scale, 1))",
                          color: "var(--nh3d-ui-text-muted)",
                          marginTop: "4px",
                          fontWeight: "normal",
                        }}
                      >
                        Saved: {save.dateFormatted}
                      </div>
                    </div>
                    <button
                      className="delete-button"
                      onClick={(e) => handleDeleteSave(e, save)}
                    >
                      X
                    </button>
                  </div>
                </button>
              ))
            ) : (
              <div
                style={{
                  padding: "20px",
                  color: "var(--nh3d-ui-text-muted)",
                }}
              >
                No saved games found.
              </div>
            )}
          </div>
        </div>
        <div className="nh3d-menu-actions">
          <button
            className="nh3d-menu-action-button nh3d-menu-action-cancel"
            onClick={() => setStartupFlowStep("choose")}
            type="button"
          >
            Back
          </button>
        </div>
      </AnimatedDialog>

      <AnimatedDialog
        className={`nh3d-dialog nh3d-dialog-question nh3d-dialog-fixed-actions startup nh3d-character-setup-dialog${
          startupInitOptionsExpanded ? " nh3d-startup-init-expanded" : ""
        }`}
        open={startupRandomDialogVisible}
        id="character-setup-dialog-random"
        onBlurCapture={handleStartupMainMenuBlurCapture}
        onChangeCapture={handleStartupMainMenuChangeCapture}
        onKeyDown={handleStartupMainMenuKeyDown}
        onPointerDownCapture={handleStartupMainMenuPointerDownCapture}
      >
        <div className="nh3d-question-text">
          Enter a name for your random character:
        </div>
        <div className="nh3d-startup-config-grid centered">
          <label className="nh3d-startup-config-field">
            <span>Name</span>
            <input
              className="nh3d-startup-config-input"
              maxLength={30}
              onChange={(event) => setRandomCharacterName(event.target.value)}
              placeholder={startupDefaultCharacterName}
              type="text"
              value={randomCharacterName}
            />
          </label>
        </div>
        <StartupInitOptionsAccordion
          expanded={startupInitOptionsExpanded}
          onExpandedChange={setStartupInitOptionsExpanded}
          onOptionValueChange={updateStartupInitOptionValue}
          onResetDefaults={resetStartupInitOptionValues}
          values={startupInitOptionValues}
        />
        <div className="nh3d-menu-actions">
          <button
            className="nh3d-menu-action-button nh3d-menu-action-confirm"
            onClick={() => {
              const randomRole = pickRandomStartupRole();
              const randomGender = pickRandomStartupGenderForRole(randomRole);
              handleStartNewGame({
                mode: "random",
                playMode: clientOptions.fpsMode ? "fps" : "normal",
                runtimeVersion,
                name: normalizeStartupCharacterName(randomCharacterName),
                role: randomRole,
                gender: randomGender,
                initOptions: startupInitOptionTokens,
              });
            }}
            type="button"
          >
            Start game
          </button>
          <button
            className="nh3d-menu-action-button nh3d-menu-action-cancel"
            onClick={() => setStartupFlowStep("choose")}
            type="button"
          >
            Back
          </button>
          <button
            className="nh3d-menu-action-button"
            onClick={openClientOptionsDialog}
            type="button"
          >
            NetHack 3D Options
          </button>
        </div>
      </AnimatedDialog>

      <AnimatedDialog
        className={`nh3d-dialog nh3d-dialog-question nh3d-dialog-fixed-actions startup nh3d-character-setup-dialog${
          startupInitOptionsExpanded ? " nh3d-startup-init-expanded" : ""
        }`}
        open={startupCreateDialogVisible}
        id="character-setup-dialog-create"
        onBlurCapture={handleStartupMainMenuBlurCapture}
        onChangeCapture={handleStartupMainMenuChangeCapture}
        onKeyDown={handleStartupMainMenuKeyDown}
        onPointerDownCapture={handleStartupMainMenuPointerDownCapture}
      >
        <div className="nh3d-question-text">Create your character:</div>
        <div className="nh3d-startup-config-grid">
          <label className="nh3d-startup-config-field">
            <span>Name</span>
            <input
              className="nh3d-startup-config-input"
              maxLength={30}
              onChange={(event) => setCreateCharacterName(event.target.value)}
              placeholder={startupDefaultCharacterName}
              type="text"
              value={createCharacterName}
            />
          </label>
          <label className="nh3d-startup-config-field">
            <span>Role</span>
            <select
              className="nh3d-startup-config-select"
              onChange={(event) => setCreateRole(event.target.value)}
              value={normalizedCreateCharacterSelection.role}
            >
              {startupCreateCharacterOptionSet.roleOptions.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>
          <label className="nh3d-startup-config-field">
            <span>Race</span>
            <select
              className="nh3d-startup-config-select"
              onChange={(event) => setCreateRace(event.target.value)}
              value={normalizedCreateCharacterSelection.race}
            >
              {startupCreateCharacterOptionSet.raceOptions.map((race) => (
                <option key={race} value={race}>
                  {race}
                </option>
              ))}
            </select>
          </label>
          <label className="nh3d-startup-config-field">
            <span>Gender</span>
            <select
              className="nh3d-startup-config-select"
              onChange={(event) => setCreateGender(event.target.value)}
              value={normalizedCreateCharacterSelection.gender}
            >
              {startupCreateCharacterOptionSet.genderOptions.map((gender) => (
                <option key={gender} value={gender}>
                  {gender}
                </option>
              ))}
            </select>
          </label>
          <label className="nh3d-startup-config-field">
            <span>Alignment</span>
            <select
              className="nh3d-startup-config-select"
              onChange={(event) => setCreateAlign(event.target.value)}
              value={normalizedCreateCharacterSelection.align}
            >
              {startupCreateCharacterOptionSet.alignOptions.map((align) => (
                <option key={align} value={align}>
                  {align}
                </option>
              ))}
            </select>
          </label>
        </div>
        <StartupInitOptionsAccordion
          expanded={startupInitOptionsExpanded}
          onExpandedChange={setStartupInitOptionsExpanded}
          onOptionValueChange={updateStartupInitOptionValue}
          onResetDefaults={resetStartupInitOptionValues}
          values={startupInitOptionValues}
        />
        <div className="nh3d-menu-actions">
          <button
            className="nh3d-menu-action-button nh3d-menu-action-confirm"
            onClick={() =>
              handleStartNewGame({
                mode: "create",
                playMode: clientOptions.fpsMode ? "fps" : "normal",
                runtimeVersion,
                name: normalizeStartupCharacterName(createCharacterName),
                role: normalizedCreateCharacterSelection.role,
                race: normalizedCreateCharacterSelection.race,
                gender: normalizedCreateCharacterSelection.gender,
                align: normalizedCreateCharacterSelection.align,
                initOptions: startupInitOptionTokens,
              })
            }
            type="button"
          >
            Start game
          </button>
          <button
            className="nh3d-menu-action-button nh3d-menu-action-cancel"
            onClick={() => setStartupFlowStep("choose")}
            type="button"
          >
            Back
          </button>
          <button
            className="nh3d-menu-action-button"
            onClick={openClientOptionsDialog}
            type="button"
          >
            NetHack 3D Options
          </button>
        </div>
      </AnimatedDialog>

      {loadingOverlayVisible && typeof document !== "undefined"
        ? createPortal(
            <div
              aria-atomic="true"
              aria-live="polite"
              className="loading"
              id="loading"
              role="status"
              tabIndex={-1}
            >
              <div>NetHack 3D</div>
              <div className="loading-subtitle">{loadingSubtitle}</div>
            </div>,
            document.body,
          )
        : null}

      {!isMobileViewport && isDesktopGameRunning ? (
        <div className="top-left-ui with-stats">
          <div id="game-status">{statusText}</div>
          {clientOptions.liveMessageLog ? (
            <div className="nh3d-overflow-glow-frame">
              <div
                data-nh3d-overflow-glow
                data-nh3d-overflow-glow-host="parent"
                id="game-log"
              >
                {gameMessages.map((message, index) => (
                  <div key={`${index}-${message}`}>{message}</div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : isMobileGameRunning && clientOptions.liveMessageLog ? (
        <div
          className={`nh3d-mobile-log nh3d-overflow-glow-frame${
            isMobileLogVisible ? "" : " nh3d-mobile-log-hidden"
          }`}
          style={
            {
              "--nh3d-mobile-log-top": `${statsBarHeight}px`,
            } as React.CSSProperties
          }
        >
          <div
            className="nh3d-mobile-log-scroll"
            data-nh3d-overflow-glow
            data-nh3d-overflow-glow-host="parent"
            id="game-log"
          >
            {renderMobileDialogCloseButton(
              () => setIsMobileLogVisible(false),
              "Close message log",
            )}
            {gameMessages.map((message, index) => (
              <div key={`${index}-${message}`}>{message}</div>
            ))}
          </div>
        </div>
      ) : null}

      <div id="floating-log-message-layer">
        {floatingMessages.map((entry, index) => (
          <div
            className="floating-message-container"
            key={entry.id}
            style={{
              top: `calc(${-index * 30}px * var(--nh3d-live-log-font-scale, 1))`,
            }}
          >
            <div
              className="floating-message-text"
              style={floatingMessageTextStyle}
            >
              {entry.text}
            </div>
          </div>
        ))}
      </div>

      {!startup && (
        <div id="stats-bar">
          <div className="nh3d-stats-name">
            {playerStats.name}
            <span className="nh3d-stats-name-level">
              {" "}
              (Lvl {playerStats.level})
            </span>
          </div>
          <div className="nh3d-stats-meter">
            <div className="nh3d-stats-meter-label nh3d-stats-meter-label-hp">
              HP: {playerStats.hp}/{playerStats.maxHp}
            </div>
            <div className="nh3d-stats-meter-track">
              <div
                className="nh3d-stats-meter-fill"
                style={{
                  width: `${hpPercentage}%`,
                  backgroundColor: hpColor,
                }}
              />
            </div>
          </div>
          {playerStats.maxPower > 0 ? (
            <div className="nh3d-stats-meter">
              <div className="nh3d-stats-meter-label nh3d-stats-meter-label-pw">
                Pw: {playerStats.power}/{playerStats.maxPower}
              </div>
              <div className="nh3d-stats-meter-track">
                <div
                  className="nh3d-stats-meter-fill nh3d-stats-meter-fill-pw"
                  style={{ width: `${powerPercentage}%` }}
                />
              </div>
            </div>
          ) : null}
          <div className="nh3d-stats-group nh3d-stats-group-core">
            <div className="nh3d-stats-core-row nh3d-stats-core-row-primary">
              <div
                className="nh3d-stats-core"
                style={resolveCoreStatStyle("strength")}
              >
                St:{playerStats.strength}
              </div>
              <div
                className="nh3d-stats-core"
                style={resolveCoreStatStyle("dexterity")}
              >
                Dx:{playerStats.dexterity}
              </div>
              <div
                className="nh3d-stats-core"
                style={resolveCoreStatStyle("constitution")}
              >
                Co:{playerStats.constitution}
              </div>
              <div
                className="nh3d-stats-core"
                style={resolveCoreStatStyle("intelligence")}
              >
                In:{playerStats.intelligence}
              </div>
              <div
                className="nh3d-stats-core"
                style={resolveCoreStatStyle("wisdom")}
              >
                Wi:{playerStats.wisdom}
              </div>
            </div>
            <div className="nh3d-stats-core-row nh3d-stats-core-row-secondary">
              <div
                className="nh3d-stats-core"
                style={resolveCoreStatStyle("charisma")}
              >
                Ch:{playerStats.charisma}
              </div>
              <div
                className="nh3d-stats-secondary-ac nh3d-stats-mobile-inline-secondary"
                style={resolveCoreStatStyle("armor")}
              >
                AC:{playerStats.armor}
              </div>
              <div className="nh3d-stats-secondary-exp nh3d-stats-mobile-inline-secondary">
                Exp:{playerStats.experience}
              </div>
              <div className="nh3d-stats-secondary-time nh3d-stats-mobile-inline-secondary">
                T:{playerStats.time}
              </div>
              <div className="nh3d-stats-secondary-gold nh3d-stats-mobile-inline-secondary">
                $:{playerStats.gold}
              </div>
            </div>
          </div>
          <div className="nh3d-stats-group nh3d-stats-group-secondary">
            <div
              className="nh3d-stats-secondary-ac nh3d-stats-desktop-secondary"
              style={resolveCoreStatStyle("armor")}
            >
              AC:{playerStats.armor}
            </div>
            <div className="nh3d-stats-secondary-exp nh3d-stats-desktop-secondary">
              Exp:{playerStats.experience}
            </div>
            <div className="nh3d-stats-secondary-gold nh3d-stats-desktop-secondary">
              $:{playerStats.gold}
            </div>
            <div className="nh3d-stats-secondary-time nh3d-stats-desktop-secondary">
              T:{playerStats.time}
            </div>
            <div className="nh3d-stats-hunger nh3d-stats-desktop-secondary">
              <span className="nh3d-stats-status-list">
                {playerStatusBadges.map((status) => (
                  <span
                    className={`nh3d-stats-status-badge is-${status.severity}`}
                    key={`desktop-status-${status.label}`}
                  >
                    {status.label}
                  </span>
                ))}
              </span>
            </div>
          </div>
          <div className="nh3d-stats-location">
            <div className="nh3d-stats-dungeon">
              {visibleLocationLabel}
              {playerStatusBadges.length > 0 ? (
                <span className="nh3d-stats-mobile-location-status">
                  <span className="nh3d-stats-status-list">
                    {playerStatusBadges.map((status) => (
                      <span
                        className={`nh3d-stats-status-badge is-${status.severity}`}
                        key={`mobile-status-${status.label}`}
                      >
                        {status.label}
                      </span>
                    ))}
                  </span>
                </span>
              ) : null}
            </div>
          </div>
        </div>
      )}

      <AnimatedDialog
        className="nh3d-dialog nh3d-dialog-options nh3d-dialog-fixed-actions nh3d-dialog-has-mobile-close"
        open={isClientOptionsVisible}
        id="nh3d-client-options-dialog"
        onBlurCapture={handleClientOptionsDialogBlurCapture}
        onChangeCapture={handleClientOptionsDialogChangeCapture}
        onKeyDown={handleClientOptionsDialogKeyDown}
        onPointerDownCapture={handleClientOptionsDialogPointerDownCapture}
      >
          {renderMobileDialogCloseButton(
            requestCloseClientOptionsDialog,
            "Close NetHack 3D options",
          )}
          <div className="nh3d-options-title">NetHack 3D Client Options</div>
          <div className="nh3d-options-layout">
            <div className="nh3d-overflow-glow-frame nh3d-options-nav-shell">
              <div
                aria-label="Settings categories"
                className="nh3d-options-nav"
                data-nh3d-overflow-glow
                data-nh3d-overflow-glow-host="parent"
                role="tablist"
              >
                {clientOptionsTabs.map((tab) => {
                  const isSelected = tab.id === selectedClientOptionsTab.id;
                  return (
                    <button
                      aria-controls="nh3d-client-options-panel"
                      aria-selected={isSelected}
                      className={`nh3d-options-tab${isSelected ? " is-selected" : ""}`}
                      id={`nh3d-client-options-tab-${tab.id}`}
                      key={tab.id}
                      onClick={() => setActiveClientOptionsTab(tab.id)}
                      role="tab"
                      tabIndex={isSelected ? 0 : -1}
                      type="button"
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="nh3d-overflow-glow-frame nh3d-options-panel-shell">
              <div
                aria-labelledby={`nh3d-client-options-tab-${selectedClientOptionsTab.id}`}
                className="nh3d-options-panel"
                data-nh3d-overflow-glow
                data-nh3d-overflow-glow-host="parent"
                id="nh3d-client-options-panel"
                role="tabpanel"
              >
                <div className="nh3d-options-panel-heading">
                  <div className="nh3d-options-panel-title">
                    {selectedClientOptionsTab.label}
                  </div>
                  <div className="nh3d-options-panel-description">
                    {selectedClientOptionsTab.description}
                  </div>
                </div>
                <div className="nh3d-options-list">
                  {visibleClientOptions.map((option) => {
                    if (option.developerOnly && !showDeveloperClientSettings) {
                      return null;
                    }
                    if (option.type === "boolean") {
                      const isInventoryTileOnlyMotionOption =
                        option.key === "inventoryTileOnlyMotion";
                      const isDarkCorridorWallsOption =
                        option.key === "darkCorridorWalls367";
                      const isDarkWallTileOverrideOption =
                        option.key === "darkCorridorWallTileOverrideEnabled";
                      const isDarkWallSolidColorOverrideOption =
                        option.key ===
                        "darkCorridorWallSolidColorOverrideEnabled";
                      const isDarkWallOverrideOption =
                        isDarkWallTileOverrideOption ||
                        isDarkWallSolidColorOverrideOption;
                      const darkCorridorOptionSuppressedByVulture =
                        isVultureTilesetSelected &&
                        (isDarkCorridorWallsOption || isDarkWallOverrideOption);
                      const darkCorridorWallsForcedOnByVulture =
                        isVultureTilesetSelected && isDarkCorridorWallsOption;
                      const invertLookOptionDisabledByFpsMode =
                        option.key === "invertLookYAxis" &&
                        !clientOptionsDraft.fpsMode;
                      const darkWallOverrideDisabledByDarkCorridorWalls =
                        isDarkWallOverrideOption &&
                        !clientOptionsDraft.darkCorridorWalls367;
                      const enabled = darkCorridorWallsForcedOnByVulture
                        ? true
                        : Boolean(clientOptionsDraft[option.key]);
                      const toggleDisabled =
                        (isInventoryTileOnlyMotionOption &&
                          clientOptionsDraft.reduceInventoryMotion) ||
                        darkCorridorOptionSuppressedByVulture ||
                        darkWallOverrideDisabledByDarkCorridorWalls ||
                        invertLookOptionDisabledByFpsMode;
                      const toggleDisabledHint =
                        darkCorridorWallsForcedOnByVulture
                          ? " Always enabled while Vulture tiles are active."
                          : darkCorridorOptionSuppressedByVulture
                            ? " Disabled while Vulture tiles are active."
                            : darkWallOverrideDisabledByDarkCorridorWalls
                              ? " Enable NetHack 3.6.7 dark corridor walls first."
                              : invertLookOptionDisabledByFpsMode
                                ? " Enable First-person mode in Display first."
                                : "";
                      const darkWallSecondaryControlsDisabled =
                        !enabled || toggleDisabled;
                      return (
                        <div
                          className={`nh3d-option-row nh3d-option-row-inline-toggle${
                            isDarkWallOverrideOption
                              ? " nh3d-option-row-has-secondary-controls"
                              : ""
                          }${
                            toggleDisabled
                              ? " nh3d-option-row-mode-inactive"
                              : ""
                          }${
                            isDarkWallOverrideOption && !enabled
                              ? " nh3d-option-row-mode-inactive"
                              : ""
                          }`}
                          key={option.key}
                        >
                          <div className="nh3d-option-copy">
                            <div className="nh3d-option-label">
                              {option.label}
                            </div>
                            <div className="nh3d-option-description">
                              {option.description}
                              {toggleDisabledHint}
                            </div>
                          </div>
                          {isDarkWallTileOverrideOption ? (
                            <div className="nh3d-option-toggle-controls nh3d-option-secondary-controls">
                              <button
                                className={`nh3d-option-tile-picker-button${
                                  darkWallSecondaryControlsDisabled
                                    ? " is-disabled"
                                    : ""
                                }`}
                                disabled={darkWallSecondaryControlsDisabled}
                                onClick={() =>
                                  setIsDarkWallTilePickerVisible(true)
                                }
                                type="button"
                              >
                                <span className="nh3d-option-tile-picker-preview">
                                  {renderTilePreviewImageForOptions(
                                    selectedDarkWallTileId,
                                  )}
                                </span>
                                <span className="nh3d-option-tile-picker-copy">
                                  <span className="nh3d-option-tile-picker-glyph">
                                    {selectedDarkWallGlyphLabel}
                                  </span>
                                  <span className="nh3d-option-tile-picker-id">
                                    tile #{selectedDarkWallTileId}
                                  </span>
                                </span>
                              </button>
                            </div>
                          ) : isDarkWallSolidColorOverrideOption ? (
                            <div className="nh3d-option-toggle-controls nh3d-option-secondary-controls">
                              <div className="nh3d-dark-wall-solid-color-controls">
                                <div className="nh3d-dark-wall-solid-color-input-row">
                                  <div className="nh3d-dark-wall-solid-color-input-group">
                                    <label className="nh3d-dark-wall-mode-color">
                                      <span>Normal</span>
                                      <input
                                        aria-label="Dark wall solid color (normal mode)"
                                        className="nh3d-option-solid-color-native-picker"
                                        disabled={
                                          darkWallSecondaryControlsDisabled
                                        }
                                        onChange={(event) =>
                                          updateDarkWallSolidColorHexDraft(
                                            event.target.value,
                                          )
                                        }
                                        type="color"
                                        value={normalizeSolidChromaKeyHex(
                                          selectedDarkWallSolidColorHex,
                                        )}
                                      />
                                    </label>
                                    <label className="nh3d-dark-wall-mode-color">
                                      <span>FPS</span>
                                      <input
                                        aria-label="Dark wall solid color (FPS mode)"
                                        className="nh3d-option-solid-color-native-picker"
                                        disabled={
                                          darkWallSecondaryControlsDisabled
                                        }
                                        onChange={(event) =>
                                          updateDarkWallSolidColorHexFpsDraft(
                                            event.target.value,
                                          )
                                        }
                                        type="color"
                                        value={normalizeSolidChromaKeyHex(
                                          selectedDarkWallSolidColorHexFps,
                                        )}
                                      />
                                    </label>
                                  </div>
                                  <div className="nh3d-dark-wall-solid-color-input-group">
                                    <label className="nh3d-dark-wall-grid-toggle">
                                      <input
                                        checked={
                                          selectedDarkWallSolidColorGridEnabled
                                        }
                                        disabled={
                                          darkWallSecondaryControlsDisabled
                                        }
                                        onChange={(event) =>
                                          updateDarkWallSolidColorGridEnabledDraft(
                                            event.target.checked,
                                          )
                                        }
                                        type="checkbox"
                                      />
                                      <span>Grid lines</span>
                                    </label>
                                    <label className="nh3d-dark-wall-grid-darkness">
                                      <span>Intensity</span>
                                      <span className="nh3d-dark-wall-grid-darkness-input-wrap">
                                        <input
                                          className="nh3d-dark-wall-grid-darkness-input"
                                          disabled={
                                            darkWallSecondaryControlsDisabled ||
                                            !selectedDarkWallSolidColorGridEnabled
                                          }
                                          max={100}
                                          min={0}
                                          onChange={(event) =>
                                            updateDarkWallSolidColorGridDarknessPercentDraft(
                                              Number(event.target.value),
                                            )
                                          }
                                          step={1}
                                          type="number"
                                          value={
                                            selectedDarkWallSolidColorGridDarknessPercent
                                          }
                                        />
                                        <span
                                          aria-hidden="true"
                                          className="nh3d-dark-wall-grid-darkness-suffix"
                                        >
                                          %
                                        </span>
                                      </span>
                                    </label>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : null}
                          <button
                            aria-checked={enabled}
                            className={`nh3d-option-switch nh3d-option-inline-switch${
                              enabled ? " is-on" : ""
                            }`}
                            disabled={toggleDisabled}
                            onClick={() => {
                              if (toggleDisabled) {
                                return;
                              }
                              if (isDarkWallTileOverrideOption) {
                                updateDarkWallTileOverrideEnabledDraft(
                                  !enabled,
                                );
                                return;
                              }
                              if (isDarkWallSolidColorOverrideOption) {
                                updateDarkWallSolidColorOverrideEnabledDraft(
                                  !enabled,
                                );
                                return;
                              }
                              updateClientOptionDraft(option.key, !enabled);
                            }}
                            role="switch"
                            type="button"
                          >
                            <span className="nh3d-option-switch-thumb" />
                          </button>
                        </div>
                      );
                    }
                    if (option.type === "select") {
                      const isTilesetSelect = option.key === "tilesetPath";
                      const isInventoryFixedTileSizeSelect =
                        option.key === "inventoryFixedTileSize";
                      const selectOptions = isTilesetSelect
                        ? tilesetDropdownOptions
                        : option.options;
                      const tilesetSelectDisabledByDisplayMode =
                        isTilesetSelect &&
                        clientOptionsDraft.tilesetMode !== "tiles";
                      const selectDisabled = isTilesetSelect
                        ? tilesetSelectDisabledByDisplayMode || !hasAnyTilesets
                        : isInventoryFixedTileSizeSelect
                          ? !clientOptionsDraft.reduceInventoryMotion
                          : Boolean(option.disabled);
                      return (
                        <div
                          className={`nh3d-option-row${
                            selectDisabled
                              ? " nh3d-option-row-mode-inactive"
                              : ""
                          }`}
                          key={option.key}
                        >
                          <div className="nh3d-option-copy">
                            <div className="nh3d-option-label">
                              {option.label}
                            </div>
                            <div className="nh3d-option-description">
                              {option.description}
                            </div>
                          </div>
                          <div
                            className={`nh3d-option-select-controls${
                              isTilesetSelect
                                ? " nh3d-option-select-controls-tileset"
                                : ""
                            }`}
                          >
                            {isTilesetSelect ? (
                              <button
                                className="nh3d-menu-action-button"
                                onClick={openTilesetManager}
                                type="button"
                              >
                                Manage Tile Sets
                              </button>
                            ) : null}
                            <select
                              className="nh3d-startup-config-select"
                              disabled={selectDisabled}
                              onChange={(event) => {
                                if (option.key === "tilesetMode") {
                                  updateClientOptionDraft(
                                    option.key,
                                    event.target.value === "tiles"
                                      ? "tiles"
                                      : "ascii",
                                  );
                                  return;
                                }
                                if (option.key === "tilesetPath") {
                                  updateTilesetPathDraft(event.target.value);
                                  return;
                                }
                                if (option.key === "inventoryFixedTileSize") {
                                  const nextValue =
                                    event.target.value === "none" ||
                                    event.target.value === "small" ||
                                    event.target.value === "large"
                                      ? event.target.value
                                      : "medium";
                                  updateClientOptionDraft(
                                    option.key,
                                    nextValue,
                                  );
                                  return;
                                }
                                if (
                                  option.key === "desktopTouchInterfaceMode"
                                ) {
                                  const nextValue =
                                    event.target.value === "portrait" ||
                                    event.target.value === "landscape"
                                      ? event.target.value
                                      : "off";
                                  updateClientOptionDraft(
                                    option.key,
                                    nextValue,
                                  );
                                  return;
                                }
                                updateClientOptionDraft(
                                  option.key,
                                  event.target.value === "taa" ? "taa" : "fxaa",
                                );
                              }}
                              value={String(clientOptionsDraft[option.key])}
                            >
                              {selectOptions.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      );
                    }
                    if (option.type === "slider") {
                      const sliderValue = clientOptionsDraft[option.key];
                      const sliderDisabledByFpsMode =
                        (option.key === "controllerFpsMoveRepeatMs" ||
                          option.key === "fpsFov" ||
                          option.key === "fpsLookSensitivityX" ||
                          option.key === "fpsLookSensitivityY") &&
                        !clientOptionsDraft.fpsMode;
                      const sliderDisabledByController =
                        option.key === "controllerFpsMoveRepeatMs" &&
                        !clientOptionsDraft.controllerEnabled;
                      const sliderDisabled =
                        sliderDisabledByFpsMode || sliderDisabledByController;
                      const sliderLabel =
                        option.key === "gamma"
                          ? `${sliderValue.toFixed(2)}x`
                          : option.key === "fpsFov"
                            ? `${Math.round(sliderValue)}\u00b0`
                            : option.key === "fpsLookSensitivityX" ||
                                option.key === "fpsLookSensitivityY"
                              ? `${sliderValue.toFixed(2)}x`
                              : option.key === "uiFontScale" ||
                                  option.key === "liveMessageLogFontScale"
                                ? `${Math.round(sliderValue * 100)}%`
                                : option.key === "controllerFpsMoveRepeatMs" ||
                                    option.key === "liveMessageDisplayTimeMs" ||
                                    option.key === "liveMessageFadeOutTimeMs"
                                  ? `${Math.round(sliderValue)}ms`
                                  : `${Math.round(sliderValue * 100)}%`;
                      return (
                        <div
                          className={`nh3d-option-row nh3d-option-row-slider${
                            sliderDisabled
                              ? " nh3d-option-row-mode-inactive"
                              : ""
                          }`}
                          key={option.key}
                        >
                          <div className="nh3d-option-copy">
                            <div className="nh3d-option-label">
                              {option.label}
                            </div>
                            <div className="nh3d-option-description">
                              {option.description}
                            </div>
                          </div>
                          <div className="nh3d-option-slider-control">
                            <input
                              aria-label={option.label}
                              className="nh3d-option-slider"
                              disabled={sliderDisabled}
                              max={option.max}
                              min={option.min}
                              onInput={(event) =>
                                updateClientSliderDraft(
                                  option.key,
                                  Number(event.currentTarget.value),
                                )
                              }
                              onChange={(event) =>
                                updateClientSliderDraft(
                                  option.key,
                                  Number(event.currentTarget.value),
                                )
                              }
                              step={option.step}
                              type="range"
                              value={sliderValue}
                            />
                            <div className="nh3d-option-slider-value">
                              {sliderLabel}
                            </div>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  })}
                  {selectedClientOptionsTab.id === "controls" ? (
                    <div className="nh3d-option-row nh3d-option-row-controller-remap">
                      <div className="nh3d-option-copy">
                        <div className="nh3d-option-label">
                          Controller remap
                        </div>
                        <div className="nh3d-option-description">
                          Set two bindings per action for gameplay and dialog
                          controls.
                        </div>
                      </div>
                      <div className="nh3d-option-select-controls">
                        <button
                          className="nh3d-menu-action-button"
                          onClick={openControllerRemapDialog}
                          type="button"
                        >
                          Remap Controller
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <SoundPackSettings
                    onDialogActionsChange={(actions) => {
                      soundPackDialogActionsRef.current = actions;
                    }}
                    requestConfirmation={requestConfirmation}
                    visible={selectedClientOptionsTab.id === "sound"}
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="nh3d-menu-actions">
            <button
              className="nh3d-menu-action-button nh3d-menu-action-confirm"
              onClick={requestConfirmClientOptionsDialog}
              type="button"
            >
              Confirm
            </button>
            <button
              className="nh3d-menu-action-button nh3d-menu-action-cancel"
              onClick={requestCloseClientOptionsDialog}
              type="button"
            >
              Cancel
            </button>
            <button
              className="nh3d-menu-action-button"
              onClick={openResetClientOptionsConfirmation}
              type="button"
            >
              Reset to Defaults
            </button>
          </div>
      </AnimatedDialog>

      <AnimatedDialog
        className="nh3d-dialog nh3d-dialog-question nh3d-dialog-fixed-actions"
        open={isClientOptionsVisible && isResetClientOptionsConfirmationVisible}
        id="nh3d-reset-client-options-confirmation-dialog"
      >
          <div className="nh3d-question-text">
            Reset NetHack 3D options to defaults? Custom tile sets will be kept.
          </div>
          <div className="nh3d-menu-actions">
            <button
              className="nh3d-menu-action-button nh3d-menu-action-confirm"
              onClick={confirmResetClientOptionsToDefaults}
              type="button"
            >
              Yes
            </button>
            <button
              className="nh3d-menu-action-button nh3d-menu-action-cancel"
              onClick={cancelResetClientOptionsConfirmation}
              type="button"
            >
              No
            </button>
          </div>
      </AnimatedDialog>

      <AnimatedDialog
        className="nh3d-dialog nh3d-dialog-options nh3d-dialog-fixed-actions nh3d-dialog-has-mobile-close nh3d-dialog-controller-remap"
        open={isClientOptionsVisible && isControllerRemapVisible}
        id="nh3d-controller-remap-dialog"
      >
          {renderMobileDialogCloseButton(
            closeControllerRemapDialog,
            "Close controller remap",
          )}
          <div className="nh3d-options-title">Controller Remap</div>
          <div className="nh3d-controller-remap-hint">
            Select a slot, then press a button or move a stick. Each action has
            two slots.
          </div>
          <div className="nh3d-controller-remap-status">
            {controllerRemapListening ? (
              <>
                Listening for{" "}
                <strong>{controllerRemapListeningActionLabel}</strong> (slot{" "}
                {controllerRemapListening.slotIndex + 1}). Press ESC to cancel.
              </>
            ) : connectedControllerCount > 0 ? (
              `${connectedControllerCount} controller${connectedControllerCount === 1 ? "" : "s"} detected.`
            ) : (
              "No controller detected."
            )}
          </div>
          <div className="nh3d-overflow-glow-frame nh3d-controller-remap-list-shell">
            <div
              className="nh3d-controller-remap-list"
              data-nh3d-overflow-glow
              data-nh3d-overflow-glow-host="parent"
            >
              {controllerActionGroupOrder.map((group) => (
                <section
                  className="nh3d-controller-remap-group"
                  key={`controller-remap-group-${group}`}
                >
                  <div className="nh3d-controller-remap-group-title">
                    {group}
                  </div>
                  {nh3dControllerActionSpecsByGroup[group].map((spec) => {
                    const slots = clientOptionsDraft.controllerBindings[
                      spec.id
                    ] ?? [null, null];
                    return (
                      <div
                        className="nh3d-controller-remap-action-row"
                        key={spec.id}
                      >
                        <div className="nh3d-controller-remap-action-copy">
                          <div className="nh3d-controller-remap-action-label">
                            {spec.label}
                          </div>
                          <div className="nh3d-controller-remap-action-description">
                            {spec.description}
                          </div>
                        </div>
                        <div className="nh3d-controller-remap-slots">
                          {([0, 1] as const).map((slotIndex) => {
                            const binding = slots[slotIndex] ?? null;
                            const listeningForSlot =
                              controllerRemapListening?.actionId === spec.id &&
                              controllerRemapListening?.slotIndex === slotIndex;
                            return (
                              <div
                                className="nh3d-controller-remap-slot"
                                key={`${spec.id}-slot-${slotIndex}`}
                              >
                                <button
                                  className={`nh3d-controller-remap-slot-button${
                                    listeningForSlot ? " is-listening" : ""
                                  }`}
                                  onClick={() =>
                                    beginControllerBindingCapture(
                                      spec.id,
                                      slotIndex,
                                    )
                                  }
                                  type="button"
                                >
                                  <span className="nh3d-controller-remap-slot-label">
                                    Slot {slotIndex + 1}
                                  </span>
                                  <span className="nh3d-controller-remap-slot-value">
                                    {listeningForSlot
                                      ? "Press input..."
                                      : formatNh3dControllerBindingLabel(
                                          binding,
                                        )}
                                  </span>
                                </button>
                                <button
                                  className="nh3d-controller-remap-clear-button"
                                  onClick={() => {
                                    setControllerBindingSlotDraft(
                                      spec.id,
                                      slotIndex,
                                      null,
                                    );
                                    if (listeningForSlot) {
                                      clearControllerBindingCapture();
                                    }
                                  }}
                                  type="button"
                                >
                                  Clear
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </section>
              ))}
            </div>
          </div>
          <div className="nh3d-menu-actions">
            <button
              className="nh3d-menu-action-button nh3d-menu-action-confirm"
              onClick={closeControllerRemapDialog}
              type="button"
            >
              Done
            </button>
            <button
              className="nh3d-menu-action-button"
              onClick={resetControllerBindingsToDefaultsDraft}
              type="button"
            >
              Reset Controller Defaults
            </button>
          </div>
      </AnimatedDialog>

      <AnimatedDialog
        className="nh3d-dialog nh3d-dialog-options nh3d-dialog-fixed-actions nh3d-dialog-has-mobile-close nh3d-dialog-tileset-manager"
        open={isClientOptionsVisible && isTilesetManagerVisible}
        id="nh3d-tileset-manager-dialog"
      >
          {renderMobileDialogCloseButton(
            closeTilesetManager,
            "Close tileset manager",
          )}
          <div className="nh3d-options-title">Manage Tile Sets</div>
          <div className="nh3d-option-description">
            Add tile sets and edit per-tileset background/chroma settings.
          </div>
          <div className="nh3d-overflow-glow-frame">
            <div
              className="nh3d-tileset-manager-upload"
              data-nh3d-overflow-glow
              data-nh3d-overflow-glow-host="parent"
            >
              <div className="nh3d-tileset-manager-header">
                <div className="nh3d-option-label">
                  {tilesetManagerInNewMode
                    ? "Create New Tile Set"
                    : selectedTilesetManagerEditEntry
                      ? `Edit Tile Set: ${selectedTilesetManagerEditEntry.label}`
                      : "Edit Tile Set"}
                </div>
              </div>
              <div className="nh3d-tileset-manager-upload-row">
                <label
                  className="nh3d-option-label"
                  htmlFor="nh3d-tileset-name"
                >
                  Tile Set Name
                </label>
                <input
                  className="nh3d-text-input nh3d-tileset-manager-input"
                  id="nh3d-tileset-name"
                  onChange={(event) =>
                    setTilesetManagerName(event.target.value)
                  }
                  placeholder="My Tileset"
                  readOnly={tilesetManagerNameInputDisabled}
                  type="text"
                  value={tilesetManagerName}
                />
                {tilesetManagerNameInputDisabled ? (
                  <div className="nh3d-option-description">
                    Built-in tile set names cannot be changed.
                  </div>
                ) : null}
              </div>
              {tilesetManagerInNewMode ||
              selectedTilesetManagerEditUserRecord ? (
                <div className="nh3d-tileset-manager-upload-row">
                  <label
                    className="nh3d-option-label"
                    htmlFor="nh3d-tileset-upload-file"
                  >
                    {tilesetManagerInNewMode
                      ? "Tileset Image"
                      : "Tileset Image (optional replacement)"}
                  </label>
                  <input
                    accept=".png,.bmp,.gif,.jpg,.jpeg,image/*"
                    className="nh3d-tileset-manager-file-input"
                    id="nh3d-tileset-upload-file"
                    onChange={handleTilesetManagerFileChange}
                    ref={tilesetManagerFileInputRef}
                    type="file"
                  />
                  <div className="nh3d-option-description">
                    {tilesetManagerFile
                      ? `Selected: ${tilesetManagerFile.name}`
                      : tilesetManagerInNewMode
                        ? "Choose a tileset image file."
                        : `Current: ${selectedTilesetManagerEditUserRecord?.fileName || "uploaded image"}`}
                  </div>
                </div>
              ) : null}
              {selectedTilesetManagerEditEntry ? (
                <Fragment>
                  <div className="nh3d-option-description">
                    Configure billboard background removal for this tileset.
                  </div>
                  <div
                    className={`nh3d-option-row nh3d-option-row-inline-toggle nh3d-option-row-has-secondary-controls${
                      tilesetManagerBackgroundRemovalMode === "tile"
                        ? ""
                        : " nh3d-option-row-mode-inactive"
                    }`}
                  >
                    <div className="nh3d-option-copy">
                      <div className="nh3d-option-label">
                        Background Tile Removal
                      </div>
                      <div className="nh3d-option-description">
                        Use a selected atlas tile for billboard background
                        removal.
                      </div>
                    </div>
                    <div className="nh3d-option-toggle-controls nh3d-option-secondary-controls">
                      <button
                        className={`nh3d-option-tile-picker-button${
                          tilesetManagerBackgroundRemovalMode === "tile"
                            ? ""
                            : " is-disabled"
                        }`}
                        disabled={
                          tilesetManagerBackgroundRemovalMode !== "tile"
                        }
                        onClick={() =>
                          setIsTilesetBackgroundTilePickerVisible(true)
                        }
                        type="button"
                      >
                        <span className="nh3d-option-tile-picker-preview">
                          {renderTilesetManagerTilePreviewImage(
                            tilesetManagerBackgroundTileId,
                          )}
                        </span>
                        <span className="nh3d-option-tile-picker-copy">
                          <span className="nh3d-option-tile-picker-glyph">
                            {tilesetManagerBackgroundGlyphLabel}
                          </span>
                          <span className="nh3d-option-tile-picker-id">
                            tile #{tilesetManagerBackgroundTileId}
                          </span>
                        </span>
                      </button>
                    </div>
                    <button
                      aria-checked={
                        tilesetManagerBackgroundRemovalMode === "tile"
                      }
                      className={`nh3d-option-switch nh3d-option-inline-switch${
                        tilesetManagerBackgroundRemovalMode === "tile"
                          ? " is-on"
                          : ""
                      }`}
                      onClick={() =>
                        updateTilesetBackgroundRemovalModeDraft(
                          "tile",
                          selectedTilesetManagerEditPath,
                        )
                      }
                      role="switch"
                      type="button"
                    >
                      <span className="nh3d-option-switch-thumb" />
                    </button>
                  </div>
                  <div
                    className={`nh3d-option-row nh3d-option-row-inline-toggle nh3d-option-row-has-secondary-controls${
                      tilesetManagerBackgroundRemovalMode === "solid"
                        ? ""
                        : " nh3d-option-row-mode-inactive"
                    }`}
                  >
                    <div className="nh3d-option-copy">
                      <div className="nh3d-option-label">
                        Solid Color Chroma Key
                      </div>
                      <div className="nh3d-option-description">
                        Use a single solid RGB color for billboard background
                        removal.
                      </div>
                    </div>
                    <div className="nh3d-option-toggle-controls nh3d-option-secondary-controls">
                      <button
                        className={`nh3d-option-tile-picker-button${
                          tilesetManagerBackgroundRemovalMode === "solid"
                            ? ""
                            : " is-disabled"
                        }`}
                        disabled={
                          tilesetManagerBackgroundRemovalMode !== "solid"
                        }
                        onClick={() =>
                          setIsTilesetSolidColorPickerVisible(true)
                        }
                        type="button"
                      >
                        <span
                          aria-hidden="true"
                          className="nh3d-option-solid-color-preview"
                          style={{
                            backgroundColor: normalizeSolidChromaKeyHex(
                              tilesetManagerSolidChromaKeyColorHex,
                            ),
                          }}
                        />
                        <span className="nh3d-option-tile-picker-copy">
                          <span className="nh3d-option-tile-picker-glyph">
                            {formatSolidChromaKeyHex(
                              tilesetManagerSolidChromaKeyColorHex,
                            )}
                          </span>
                          <span className="nh3d-option-tile-picker-id">
                            click to pick from atlas
                          </span>
                        </span>
                      </button>
                      <input
                        className="nh3d-option-solid-color-input"
                        readOnly
                        type="text"
                        value={formatSolidChromaKeyHex(
                          tilesetManagerSolidChromaKeyColorHex,
                        )}
                      />
                    </div>
                    <button
                      aria-checked={
                        tilesetManagerBackgroundRemovalMode === "solid"
                      }
                      className={`nh3d-option-switch nh3d-option-inline-switch${
                        tilesetManagerBackgroundRemovalMode === "solid"
                          ? " is-on"
                          : ""
                      }`}
                      onClick={() =>
                        updateTilesetBackgroundRemovalModeDraft(
                          "solid",
                          selectedTilesetManagerEditPath,
                        )
                      }
                      role="switch"
                      type="button"
                    >
                      <span className="nh3d-option-switch-thumb" />
                    </button>
                  </div>
                </Fragment>
              ) : (
                <div className="nh3d-option-description">
                  Save the new tile set first, then edit background/chroma
                  settings.
                </div>
              )}
              <div className="nh3d-tileset-manager-upload-actions">
                <button
                  className="nh3d-menu-action-button nh3d-menu-action-confirm"
                  disabled={tilesetManagerBusy}
                  onClick={() => {
                    void saveTilesetManager();
                  }}
                  type="button"
                >
                  {tilesetManagerInNewMode
                    ? "Create Tile Set"
                    : selectedTilesetManagerEditUserRecord
                      ? "Save Tile Set"
                      : "Save Tile Settings"}
                </button>
              </div>
            </div>
          </div>
          {tilesetManagerError ? (
            <div className="nh3d-tileset-manager-error">
              {tilesetManagerError}
            </div>
          ) : null}
          <div className="nh3d-tileset-manager-divider" />
          <button
            className="nh3d-menu-action-button"
            disabled={tilesetManagerBusy}
            onClick={openTilesetManagerNewEditor}
            type="button"
          >
            + Import New Tile Set
          </button>
          <div className="nh3d-overflow-glow-frame">
            <div
              className="nh3d-tileset-manager-list"
              data-nh3d-overflow-glow
              data-nh3d-overflow-glow-host="parent"
            >
              {tilesetManagerListTilesets.length === 0 ? (
                <div className="nh3d-option-description">
                  No uploaded tilesets available.
                </div>
              ) : (
                tilesetManagerListTilesets.map((tileset) => {
                  const tilesetPath = String(tileset.path || "").trim();
                  const isSelected =
                    clientOptionsDraft.tilesetPath === tilesetPath;
                  const isEditing =
                    !tilesetManagerInNewMode &&
                    selectedTilesetManagerEditPath === tilesetPath;
                  const userRecord = userTilesetRecordByPath.get(tilesetPath);
                  const isUserTileset = tileset.source === "user";
                  return (
                    <div
                      className="nh3d-tileset-manager-item"
                      key={tilesetPath}
                    >
                      <div className="nh3d-tileset-manager-item-copy">
                        <div className="nh3d-option-label">
                          {tileset.label}
                          {isSelected ? " (selected)" : ""}
                          {isEditing ? " (editing)" : ""}
                        </div>
                        <div className="nh3d-option-description">
                          {isUserTileset
                            ? `${userRecord?.fileName || tilesetPath} | uploaded`
                            : `${tilesetPath} | built-in`}
                        </div>
                      </div>
                      <div className="nh3d-tileset-manager-item-actions">
                        <button
                          className="nh3d-menu-action-button"
                          onClick={() => openTilesetManagerEditor(tilesetPath)}
                          type="button"
                        >
                          Edit
                        </button>
                        {isUserTileset ? (
                          <button
                            aria-label={`Delete ${tileset.label}`}
                            className="delete-button"
                            disabled={tilesetManagerBusy || !userRecord}
                            onClick={() => {
                              if (!userRecord) {
                                return;
                              }
                              void removeUserTileset(userRecord);
                            }}
                            type="button"
                          >
                            X
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
          <div className="nh3d-menu-actions">
            <button
              className="nh3d-menu-action-button"
              onClick={closeTilesetManager}
              type="button"
            >
              Done
            </button>
          </div>
      </AnimatedDialog>

      <TilesetTilePickerDialog
        closeLabel="Close dark wall tile picker"
        defaultTileId={defaultDarkWallTileId}
        dialogId="nh3d-dark-wall-tile-picker-dialog"
        entries={tilePickerEntries}
        onDone={() => setIsDarkWallTilePickerVisible(false)}
        onResetToDefault={() =>
          updateDarkWallTileOverrideTileIdDraft(defaultDarkWallTileId)
        }
        onSelectTile={updateDarkWallTileOverrideTileIdDraft}
        renderMobileCloseButton={renderMobileDialogCloseButton}
        renderTilePreviewImage={renderTilePreviewImageForOptions}
        selectedGlyphLabel={selectedDarkWallGlyphLabel}
        selectedGlyphNumber={selectedDarkWallGlyphNumber}
        selectedTileId={selectedDarkWallTileId}
        showGlyphNumber={showTilePickerGlyphNumber}
        statusText={tilePickerStatusText}
        tileAtlasLoaded={tileAtlasState.loaded}
        title="Dark Wall Tile Picker"
        visible={isClientOptionsVisible && isDarkWallTilePickerVisible}
      />

      <TilesetTilePickerDialog
        closeLabel="Close tileset background tile picker"
        defaultTileId={tilesetManagerDefaultBackgroundTileId}
        dialogId="nh3d-tileset-background-tile-picker-dialog"
        entries={tilesetManagerTilePickerEntries}
        helperText="Used for removing shared tileset background from monster/loot billboards."
        onDone={() => setIsTilesetBackgroundTilePickerVisible(false)}
        onResetToDefault={() =>
          updateTilesetBackgroundTileIdDraft(
            tilesetManagerDefaultBackgroundTileId,
            selectedTilesetManagerEditPath,
            tilesetManagerAtlasState.tileCount,
          )
        }
        onSelectTile={(tileId) =>
          updateTilesetBackgroundTileIdDraft(
            tileId,
            selectedTilesetManagerEditPath,
            tilesetManagerAtlasState.tileCount,
          )
        }
        renderMobileCloseButton={renderMobileDialogCloseButton}
        renderTilePreviewImage={renderTilesetManagerTilePreviewImage}
        selectedGlyphLabel={tilesetManagerBackgroundGlyphLabel}
        selectedGlyphNumber={tilesetManagerBackgroundGlyphNumber}
        selectedTileId={tilesetManagerBackgroundTileId}
        showGlyphNumber={showTilePickerGlyphNumber}
        statusText={tilesetManagerTilePickerStatusText}
        tileAtlasLoaded={tilesetManagerAtlasState.loaded}
        title={
          selectedTilesetManagerEditEntry
            ? `Tileset Background Tile Picker: ${selectedTilesetManagerEditEntry.label}`
            : "Tileset Background Tile Picker"
        }
        visible={
          isClientOptionsVisible &&
          isTilesetManagerVisible &&
          Boolean(selectedTilesetManagerEditPath) &&
          isTilesetBackgroundTilePickerVisible
        }
      />

      <TilesetSolidColorPickerDialog
        atlasImage={tilesetManagerAtlasImage}
        atlasWidthPx={
          tilesetManagerAtlasState.columns *
          tilesetManagerAtlasState.tileSourceSize
        }
        closeLabel="Close solid chroma key color picker"
        dialogId="nh3d-tileset-solid-color-picker-dialog"
        onDone={() => setIsTilesetSolidColorPickerVisible(false)}
        onSelectColorHex={(rawHex) =>
          updateTilesetSolidChromaKeyColorHexDraft(
            rawHex,
            selectedTilesetManagerEditPath,
          )
        }
        renderMobileCloseButton={renderMobileDialogCloseButton}
        selectedColorHex={tilesetManagerSolidChromaKeyColorHex}
        statusText={tilesetManagerTilePickerStatusText}
        tileAtlasLoaded={tilesetManagerAtlasState.loaded}
        tileSourceSize={tilesetManagerAtlasState.tileSourceSize}
        title={
          selectedTilesetManagerEditEntry
            ? `Solid Color Chroma Key Picker: ${selectedTilesetManagerEditEntry.label}`
            : "Solid Color Chroma Key Picker"
        }
        visible={
          isClientOptionsVisible &&
          isTilesetManagerVisible &&
          Boolean(selectedTilesetManagerEditPath) &&
          isTilesetSolidColorPickerVisible
        }
      />

      <AnimatedDialog
        className="nh3d-dialog nh3d-dialog-text nh3d-dialog-fixed-actions nh3d-dialog-has-mobile-close"
        open={Boolean(textInputRequest)}
        id="text-input-dialog"
      >
        {textInputRequest ? (
          <>
          {renderMobileDialogCloseButton(
            () => submitTextInput(""),
            "Cancel text input",
          )}
          <div className="nh3d-question-text">{textInputRequest.text}</div>
          <input
            className="nh3d-text-input"
            maxLength={textInputRequest.maxLength ?? 256}
            onChange={(event) => setTextInputValue(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                submitTextInput(textInputValue);
              } else if (event.key === "Escape") {
                event.preventDefault();
                submitTextInput("");
              }
            }}
            placeholder={textInputRequest.placeholder ?? "Enter text"}
            ref={textInputRef}
            type="text"
            value={textInputValue}
          />
          <div className="nh3d-menu-actions">
            <button
              className="nh3d-menu-action-button nh3d-menu-action-confirm"
              onClick={() => submitTextInput(textInputValue)}
              type="button"
            >
              OK
            </button>
            <button
              className="nh3d-menu-action-button nh3d-menu-action-cancel"
              onClick={() => submitTextInput("")}
              type="button"
            >
              Cancel
            </button>
          </div>
          </>
        ) : null}
      </AnimatedDialog>

      <AnimatedDialog
        className={`nh3d-dialog nh3d-dialog-question nh3d-dialog-fixed-actions nh3d-dialog-has-mobile-close${
          question?.menuItems.length === 0 && isYesNoQuestionChoices
            ? " nh3d-dialog-question-yes-no"
            : ""
        }${enhanceMenuData ? " nh3d-dialog-question-enhance" : ""}${
          castMenuData ? " nh3d-dialog-question-cast" : ""
        }`}
        open={Boolean(question)}
        id="question-dialog"
      >
        {question ? (
          <>
          {renderMobileDialogCloseButton(
            () => controller?.cancelActivePrompt(),
            "Cancel prompt",
          )}
          <div className="nh3d-question-text">{question.text}</div>
          {question.menuItems.length > 0 ? (
            question.isPickupDialog ? (
              <>
                {question.menuItems.map((item, index) => {
                  if (!isSelectableQuestionMenuItem(item)) {
                    return (
                      <div
                        className={
                          item.isCategory
                            ? "nh3d-menu-category"
                            : "nh3d-menu-row"
                        }
                        key={`cat-${index}`}
                      >
                        {item.text}
                      </div>
                    );
                  }
                  const tileApplicable =
                    tilesUiEnabled && isMenuItemTileApplicable(item);
                  const tileIndex = tileApplicable
                    ? resolveMenuItemTileIndex(item)
                    : null;
                  const tilePreview = renderMenuItemTilePreview(
                    item,
                    tileIndex,
                  );
                  const fallbackGlyph = resolveMenuItemFallbackGlyph(item);
                  return (
                    <div
                      className={`nh3d-pickup-item${
                        question.selectedAccelerators.includes(
                          String(item.accelerator),
                        )
                          ? " nh3d-pickup-item-selected"
                          : ""
                      }${
                        question.activeMenuSelectionInput ===
                        getMenuSelectionInput(item)
                          ? " nh3d-pickup-item-active"
                          : ""
                      }`}
                      key={`pickup-${item.accelerator}-${index}`}
                      onClick={() =>
                        controller?.togglePickupChoice(
                          getMenuSelectionInput(item),
                        )
                      }
                    >
                      <input
                        checked={question.selectedAccelerators.includes(
                          String(item.accelerator),
                        )}
                        className="nh3d-pickup-checkbox"
                        onClick={(event) => event.stopPropagation()}
                        onChange={() =>
                          controller?.togglePickupChoice(
                            getMenuSelectionInput(item),
                          )
                        }
                        type="checkbox"
                      />
                      <span className="nh3d-question-item-leading">
                        {tileApplicable ? (
                          <span
                            className="nh3d-question-item-icon-shell"
                            aria-hidden="true"
                          >
                            {tilePreview ? (
                              <span className="nh3d-question-item-icon-art">
                                {tilePreview}
                              </span>
                            ) : (
                              <span className="nh3d-question-item-icon-fallback">
                                {fallbackGlyph}
                              </span>
                            )}
                          </span>
                        ) : null}
                        <span className="nh3d-pickup-key">
                          {item.accelerator})
                        </span>
                      </span>
                      <span className="nh3d-pickup-text">{item.text}</span>
                    </div>
                  );
                })}
                {showPickupActionButtons ? (
                  <div className="nh3d-pickup-actions">
                    {showPickupToggleAllButton ? (
                      <button
                        className={`nh3d-pickup-action-button${
                          question.activeActionButton === "select-all"
                            ? " nh3d-action-button-active"
                            : ""
                        }`}
                        onClick={() => controller?.toggleAllPickupChoices()}
                        type="button"
                      >
                        {question.allPickupSelected
                          ? "Deselect All"
                          : "Select All"}
                      </button>
                    ) : null}
                    <button
                      className={`nh3d-pickup-action-button nh3d-pickup-action-confirm${
                        question.activeActionButton === "confirm"
                          ? " nh3d-action-button-active"
                          : ""
                      }`}
                      onClick={() => controller?.confirmPickupChoices()}
                      type="button"
                    >
                      Confirm
                    </button>
                    <button
                      className={`nh3d-pickup-action-button nh3d-pickup-action-cancel${
                        question.activeActionButton === "cancel"
                          ? " nh3d-action-button-active"
                          : ""
                      }`}
                      onClick={() => controller?.cancelActivePrompt()}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                ) : null}
              </>
            ) : enhanceMenuData ? (
              <>
                <div className="nh3d-enhance-menu">
                  <div className="nh3d-enhance-summary">
                    <span className="nh3d-enhance-summary-chip is-available">
                      {enhanceMenuData.availableCount} available
                    </span>
                    <span className="nh3d-enhance-summary-chip is-gated">
                      {enhanceMenuData.needsExperienceCount} gated by
                      experience/slots
                    </span>
                    <span className="nh3d-enhance-summary-chip is-practice">
                      {enhanceMenuData.needsPracticeCount} need practice
                    </span>
                    <span className="nh3d-enhance-summary-chip is-maxed">
                      {enhanceMenuData.maxedOutCount} maxed
                    </span>
                  </div>
                  {enhanceMenuData.legendLines.length > 0 ? (
                    <div className="nh3d-enhance-legend">
                      {enhanceMenuData.legendLines.map((line, index) => (
                        <div
                          className="nh3d-enhance-legend-line"
                          key={`enhance-legend-${index}`}
                        >
                          {line}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {enhanceMenuData.groups.map((group) => (
                    <section
                      className="nh3d-enhance-group"
                      key={`enhance-group-${group.id}`}
                    >
                      <div className="nh3d-menu-category nh3d-enhance-group-title">
                        {group.title}
                      </div>
                      <div className="nh3d-enhance-skill-grid">
                        {group.entries.map((entry) => {
                          const selectionInput = getMenuSelectionInput(
                            entry.menuItem,
                          );
                          const isSelectable = isSelectableQuestionMenuItem(
                            entry.menuItem,
                          );
                          const isActive =
                            question.activeMenuSelectionInput ===
                            selectionInput;
                          const acceleratorLabel =
                            typeof entry.menuItem.accelerator === "string" &&
                            entry.menuItem.accelerator.trim().length > 0
                              ? `${entry.menuItem.accelerator})`
                              : "";
                          return isSelectable ? (
                            <button
                              className={`nh3d-enhance-skill-card is-${entry.availability}${
                                isActive ? " nh3d-menu-button-active" : ""
                              }`}
                              key={`enhance-skill-${entry.id}`}
                              onClick={() =>
                                controller?.chooseQuestionChoice(selectionInput)
                              }
                              type="button"
                            >
                              <div className="nh3d-enhance-skill-head">
                                <span className="nh3d-enhance-skill-name">
                                  {entry.name}
                                </span>
                                <span className="nh3d-enhance-skill-badges">
                                  {acceleratorLabel ? (
                                    <span className="nh3d-enhance-key">
                                      {acceleratorLabel}
                                    </span>
                                  ) : null}
                                  <span className="nh3d-enhance-state-chip">
                                    {entry.availabilityLabel}
                                  </span>
                                </span>
                              </div>
                              <div className="nh3d-enhance-rank-row">
                                <span>{entry.currentRank}</span>
                                {entry.nextRank ? (
                                  <>
                                    <span className="nh3d-enhance-rank-arrow">
                                      {"->"}
                                    </span>
                                    <span>{entry.nextRank}</span>
                                  </>
                                ) : (
                                  <span className="nh3d-enhance-rank-max">
                                    Max
                                  </span>
                                )}
                              </div>
                              {enhanceMenuData.showSlotCost &&
                              entry.slotCostForNextRank ? (
                                <div className="nh3d-enhance-slot-cost">
                                  {entry.slotCostForNextRank} slot
                                  {entry.slotCostForNextRank === 1 ? "" : "s"}
                                </div>
                              ) : null}
                            </button>
                          ) : (
                            <div
                              className={`nh3d-enhance-skill-card is-${entry.availability} is-disabled${
                                isActive ? " nh3d-menu-button-active" : ""
                              }`}
                              key={`enhance-skill-${entry.id}`}
                            >
                              <div className="nh3d-enhance-skill-head">
                                <span className="nh3d-enhance-skill-name">
                                  {entry.name}
                                </span>
                                <span className="nh3d-enhance-state-chip">
                                  {entry.availabilityLabel}
                                </span>
                              </div>
                              <div className="nh3d-enhance-rank-row">
                                <span>{entry.currentRank}</span>
                                {entry.nextRank ? (
                                  <>
                                    <span className="nh3d-enhance-rank-arrow">
                                      {"->"}
                                    </span>
                                    <span>{entry.nextRank}</span>
                                  </>
                                ) : (
                                  <span className="nh3d-enhance-rank-max">
                                    Max
                                  </span>
                                )}
                              </div>
                              {enhanceMenuData.showSlotCost &&
                              entry.slotCostForNextRank ? (
                                <div className="nh3d-enhance-slot-cost">
                                  {entry.slotCostForNextRank} slot
                                  {entry.slotCostForNextRank === 1 ? "" : "s"}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
                <div className="nh3d-menu-actions">
                  <button
                    className={`nh3d-menu-action-button nh3d-menu-action-cancel${
                      question.activeActionButton === "cancel"
                        ? " nh3d-action-button-active"
                      : ""
                    }`}
                    onClick={() => controller?.cancelActivePrompt()}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : castMenuData ? (
              <>
                <CastSpellMenu
                  activeSelectionInput={question.activeMenuSelectionInput}
                  menuData={castMenuData}
                  onChooseSpell={(selectionInput) =>
                    controller?.chooseQuestionChoice(selectionInput)
                  }
                />
                <div className="nh3d-menu-actions">
                  <button
                    className={`nh3d-menu-action-button nh3d-menu-action-cancel${
                      question.activeActionButton === "cancel"
                        ? " nh3d-action-button-active"
                        : ""
                    }`}
                    onClick={() => controller?.cancelActivePrompt()}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                {question.menuItems.map((item, index) => {
                  if (!isSelectableQuestionMenuItem(item)) {
                    if (isReadOnlyQuestionOptionMenuItem(item, question.text)) {
                      return (
                        <button
                          className="nh3d-menu-button nh3d-menu-button-readonly"
                          disabled
                          key={`readonly-${index}`}
                          type="button"
                        >
                          <span className="nh3d-menu-button-key">{"-"}</span>
                          <span className="nh3d-menu-button-label">
                            {String(item.text || "").trimStart()}
                          </span>
                        </button>
                      );
                    }
                    return (
                      <div
                        className={
                          item.isCategory
                            ? "nh3d-menu-category"
                            : "nh3d-menu-row"
                        }
                        key={`cat-${index}`}
                      >
                        {item.text}
                      </div>
                    );
                  }
                  const tileApplicable =
                    tilesUiEnabled && isMenuItemTileApplicable(item);
                  const tileIndex = tileApplicable
                    ? resolveMenuItemTileIndex(item)
                    : null;
                  const tilePreview = renderMenuItemTilePreview(
                    item,
                    tileIndex,
                  );
                  const fallbackGlyph = resolveMenuItemFallbackGlyph(item);
                  return (
                    <button
                      className={`nh3d-menu-button${
                        question.activeMenuSelectionInput ===
                        getMenuSelectionInput(item)
                          ? " nh3d-menu-button-active"
                          : ""
                      }`}
                      key={`menu-${getMenuSelectionInput(item)}-${index}`}
                      onClick={() =>
                        controller?.chooseQuestionChoice(
                          getMenuSelectionInput(item),
                        )
                      }
                      type="button"
                    >
                      <span className="nh3d-question-item-leading">
                        {tileApplicable ? (
                          <span
                            className="nh3d-question-item-icon-shell"
                            aria-hidden="true"
                          >
                            {tilePreview ? (
                              <span className="nh3d-question-item-icon-art">
                                {tilePreview}
                              </span>
                            ) : (
                              <span className="nh3d-question-item-icon-fallback">
                                {fallbackGlyph}
                              </span>
                            )}
                          </span>
                        ) : null}
                        <span className="nh3d-menu-button-key">
                          {item.accelerator})
                        </span>
                      </span>
                      <span className="nh3d-menu-button-label">
                        {item.text}
                      </span>
                    </button>
                  );
                })}
                {questionSelectableMenuItemCount > 1 ? (
                  <div className="nh3d-menu-actions">
                    <button
                      className={`nh3d-menu-action-button nh3d-menu-action-cancel${
                        question.activeActionButton === "cancel"
                          ? " nh3d-action-button-active"
                          : ""
                      }`}
                      onClick={() => controller?.cancelActivePrompt()}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                ) : null}
              </>
            )
          ) : (
            <div className="nh3d-overflow-glow-frame">
              <div
                className={`nh3d-choice-list${
                  parsedQuestionChoices.length > 0 &&
                  parsedQuestionChoices.every(
                    (choice) => choice.trim().length === 1,
                  )
                    ? " is-compact"
                    : ""
                }${isYesNoQuestionChoices ? " is-yes-no" : ""}`}
                data-nh3d-overflow-glow
                data-nh3d-overflow-glow-host="parent"
              >
                {parsedQuestionChoices.map((choice) => {
                  const inventoryChoiceItem = useInventoryChoiceLabels
                    ? getInventoryItemForQuestionChoice(choice, inventory.items)
                    : null;
                  const tileApplicable =
                    tilesUiEnabled &&
                    Boolean(inventoryChoiceItem) &&
                    isMenuItemTileApplicable(inventoryChoiceItem);
                  const tileIndex =
                    tileApplicable && inventoryChoiceItem
                      ? resolveMenuItemTileIndex(inventoryChoiceItem)
                      : null;
                  const tilePreview = renderMenuItemTilePreview(
                    inventoryChoiceItem,
                    tileIndex,
                  );
                  const fallbackGlyph = resolveMenuItemFallbackGlyph(
                    inventoryChoiceItem,
                    choice.trim().charAt(0) || "?",
                  );
                  return (
                    <button
                      className={`nh3d-choice-button${
                        choice === question.defaultChoice
                          ? " nh3d-choice-button-default"
                          : ""
                      }${
                        tileApplicable ? " nh3d-choice-button-with-tile" : ""
                      }`}
                      data-nh3d-choice-value={choice}
                      key={choice}
                      onClick={() => controller?.chooseQuestionChoice(choice)}
                      type="button"
                    >
                      {tileApplicable ? (
                        <span
                          className="nh3d-question-item-icon-shell"
                          aria-hidden="true"
                        >
                          {tilePreview ? (
                            <span className="nh3d-question-item-icon-art">
                              {tilePreview}
                            </span>
                          ) : (
                            <span className="nh3d-question-item-icon-fallback">
                              {fallbackGlyph}
                            </span>
                          )}
                        </span>
                      ) : null}
                      <span className="nh3d-choice-button-item-label">
                        {getQuestionChoiceLabel(
                          question.text,
                          choice,
                          inventory.items,
                          useInventoryChoiceLabels,
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {question.menuItems.length > 0 && questionMenuPageCount > 1 ? (
            <div className="nh3d-question-pagination">
              <button
                className="nh3d-question-page-button"
                disabled={questionMenuPageIndex <= 0}
                onClick={() => controller?.goToPreviousQuestionMenuPage()}
                type="button"
              >
                {"<"}
              </button>
              <div className="nh3d-question-page-indicator">
                Page {questionMenuPageIndex + 1} / {questionMenuPageCount}
              </div>
              <button
                className="nh3d-question-page-button"
                disabled={questionMenuPageIndex >= questionMenuPageCount - 1}
                onClick={() => controller?.goToNextQuestionMenuPage()}
                type="button"
              >
                {">"}
              </button>
            </div>
          ) : null}
          <div className="nh3d-dialog-hint">
            {question.menuItems.length > 0 && questionMenuPageCount > 1
              ? "Use < and > to change pages. Press ESC to cancel"
              : "Press ESC to cancel"}
          </div>
          </>
        ) : null}
      </AnimatedDialog>

      <AnimatedDialog
        className="nh3d-dialog nh3d-dialog-question nh3d-dialog-fixed-actions nh3d-dialog-has-mobile-close nh3d-dialog-new-game"
        open={newGamePrompt.visible && !infoMenu && !question}
        id="new-game-dialog"
        onKeyDown={handleNewGamePromptKeyDown}
      >
          {renderMobileDialogCloseButton(
            () => setNewGamePrompt({ visible: false, reason: null }),
            "Close new game prompt",
          )}
          <div className="nh3d-question-text">Return to main menu?</div>
          <div className="nh3d-menu-actions">
            <button
              className="nh3d-menu-action-button nh3d-menu-action-confirm"
              onClick={startNewGameFromPrompt}
              ref={newGamePromptYesButtonRef}
              type="button"
            >
              Yes
            </button>
            <button
              className="nh3d-menu-action-button nh3d-menu-action-cancel"
              onClick={dismissNewGamePromptUntilInteraction}
              ref={newGamePromptNoButtonRef}
              type="button"
            >
              No
            </button>
          </div>
      </AnimatedDialog>

      <AnimatedDialog
        className="nh3d-dialog nh3d-dialog-direction nh3d-dialog-direction-fps nh3d-dialog-has-mobile-close"
        open={Boolean(directionQuestion)}
        id="direction-dialog"
      >
        {directionQuestion ? (
          <>
          {renderMobileDialogCloseButton(
            () => controller?.cancelActivePrompt(),
            "Cancel direction prompt",
          )}
          <div className="nh3d-direction-text">{directionQuestion}</div>
          <div className="nh3d-direction-fps-hint">
            {isFpsPlayMode
              ? "Look to aim. Left-click or W confirms. S targets self. A/D or right-click cancels."
              : getDirectionHelpText(
                  numberPadModeEnabled,
                  clientOptions.controllerEnabled,
                )}
          </div>
          </>
        ) : null}
      </AnimatedDialog>

      <AnimatedDialog
        className={`nh3d-dialog ${
          isCharacterSheetVisible
            ? "nh3d-dialog-character"
            : "nh3d-dialog-info"
        } nh3d-dialog-fixed-actions nh3d-dialog-has-mobile-close nh3d-overflow-glow-frame`}
        open={Boolean(infoMenu)}
        id={isCharacterSheetVisible ? "character-dialog" : "info-menu-dialog"}
        onKeyDown={handleInfoMenuDialogKeyDown}
      >
        {infoMenu ? (
          <>
          {renderMobileDialogCloseButton(
            closeInfoMenuDialog,
            isCharacterSheetVisible
              ? "Close character window"
              : "Close information window",
          )}
          {isCharacterSheetVisible && characterSheet ? (
            <>
              <div
                className="nh3d-character-sheet-scroll"
                data-nh3d-overflow-glow
                data-nh3d-overflow-glow-host="parent"
              >
                <div className="nh3d-info-title">Character</div>
                <div className="nh3d-character-xp-block nh3d-character-xp-block-top">
                  <div className="nh3d-character-xp-header">
                    <span>Experience Progress</span>
                    <span>Level {characterExperienceProgress.level}</span>
                  </div>
                  <div className="nh3d-character-xp-track">
                    <div
                      className="nh3d-character-xp-fill"
                      style={{
                        width: `${characterExperienceProgress.progressPercent}%`,
                      }}
                    />
                  </div>
                  <div className="nh3d-character-xp-meta">
                    {characterExperienceProgress.isMaxLevel ? (
                      <>
                        XP{" "}
                        {formatCharacterNumber(
                          characterExperienceProgress.experiencePoints,
                        )}{" "}
                        (max level reached)
                      </>
                    ) : (
                      <>
                        XP{" "}
                        {formatCharacterNumber(
                          characterExperienceProgress.experiencePoints,
                        )}{" "}
                        /{" "}
                        {formatCharacterNumber(
                          characterExperienceProgress.nextLevelThreshold,
                        )}
                        {" \u2022 "}
                        {formatCharacterNumber(
                          characterExperienceProgress.toNextLevel,
                        )}{" "}
                        to next level
                      </>
                    )}
                  </div>
                </div>
                <div className="nh3d-character-grid">
                  <section className="nh3d-character-panel">
                    <div className="nh3d-character-panel-title">Background</div>
                    <div className="nh3d-character-line-stack">
                      {characterSheet.backgroundLines.length > 0 ? (
                        characterSheet.backgroundLines.map((line, index) => (
                          <div
                            className="nh3d-character-line"
                            key={`character-bg-${index}`}
                          >
                            {line}
                          </div>
                        ))
                      ) : characterSheet.identityLine ? (
                        <div className="nh3d-character-line">
                          {characterSheet.identityLine}
                        </div>
                      ) : null}
                    </div>
                  </section>

                  <section className="nh3d-character-panel">
                    <div className="nh3d-character-panel-title">Vitals</div>
                    <div className="nh3d-character-line-stack">
                      {characterSheet.hitPointsLine ? (
                        <div className="nh3d-character-line">
                          {characterSheet.hitPointsLine}
                        </div>
                      ) : null}
                      {characterSheet.energyLine ? (
                        <div className="nh3d-character-line">
                          {characterSheet.energyLine}
                        </div>
                      ) : null}
                      {characterSheet.armorClassLine ? (
                        <div className="nh3d-character-line">
                          {characterSheet.armorClassLine}
                        </div>
                      ) : null}
                      {characterSheet.experienceLine ? (
                        <div className="nh3d-character-line">
                          {characterSheet.experienceLine}
                        </div>
                      ) : null}
                      {characterSheet.scoreLine ? (
                        <div className="nh3d-character-line">
                          {characterSheet.scoreLine}
                        </div>
                      ) : null}
                      {characterSheet.walletLine ? (
                        <div className="nh3d-character-line">
                          {characterSheet.walletLine}
                        </div>
                      ) : null}
                      {characterSheet.autopickupLine ? (
                        <div className="nh3d-character-line">
                          {characterSheet.autopickupLine}
                        </div>
                      ) : null}
                    </div>
                  </section>

                  <section className="nh3d-character-panel nh3d-character-panel-characteristics">
                    <div className="nh3d-character-panel-title">
                      Characteristics
                    </div>
                    {hasCharacterStatValues ? (
                      <div className="nh3d-character-stat-grid">
                        {hasCharacterStatLimits ? (
                          <div className="nh3d-character-stat-grid-hint">
                            Current / Limit
                          </div>
                        ) : null}
                        {characterSheet.statEntries.map((entry) => (
                          <div
                            className="nh3d-character-stat"
                            key={`character-stat-${entry.id}`}
                          >
                            <div className="nh3d-character-stat-label">
                              {entry.label}
                            </div>
                            <div className="nh3d-character-stat-value">
                              <span className="nh3d-character-stat-current">
                                {entry.currentValue || entry.rawValue || "--"}
                              </span>
                              {entry.limitValue ? (
                                <>
                                  <span className="nh3d-character-stat-divider">
                                    /
                                  </span>
                                  <span className="nh3d-character-stat-limit">
                                    {entry.limitValue}
                                  </span>
                                </>
                              ) : null}
                            </div>
                            <div className="nh3d-character-stat-description">
                              {characterStatDescriptionById[entry.id]}
                            </div>
                          </div>
                        ))}
                        <div className="nh3d-character-stat">
                          <div className="nh3d-character-stat-label">
                            Armor Class
                          </div>
                          <div className="nh3d-character-stat-value">
                            <span className="nh3d-character-stat-current">
                              {playerStats.armor}
                            </span>
                          </div>
                          <div className="nh3d-character-stat-description">
                            {armorClassDescription}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="nh3d-character-line-stack">
                        {characterSheet.characteristicsLines.map(
                          (line, index) => (
                            <div
                              className="nh3d-character-line"
                              key={`character-characteristics-${index}`}
                            >
                              {line}
                            </div>
                          ),
                        )}
                      </div>
                    )}
                  </section>

                  <section className="nh3d-character-panel">
                    <div className="nh3d-character-panel-title">
                      Current Status
                    </div>
                    <div className="nh3d-character-chip-list">
                      {characterSheet.statusLines.length > 0 ? (
                        characterSheet.statusLines.map((line, index) => (
                          <div
                            className="nh3d-character-chip"
                            key={`character-status-${index}`}
                          >
                            {line}
                          </div>
                        ))
                      ) : (
                        <div className="nh3d-character-line">
                          No active status.
                        </div>
                      )}
                    </div>
                  </section>

                  <section className="nh3d-character-panel">
                    <div className="nh3d-character-panel-title">
                      Current Attributes
                    </div>
                    <div className="nh3d-character-chip-list">
                      {characterSheet.attributeLines.length > 0 ? (
                        characterSheet.attributeLines.map((line, index) => (
                          <div
                            className="nh3d-character-chip"
                            key={`character-attributes-${index}`}
                          >
                            {line}
                          </div>
                        ))
                      ) : (
                        <div className="nh3d-character-line">
                          No temporary attribute effects.
                        </div>
                      )}
                    </div>
                  </section>

                  <section className="nh3d-character-panel nh3d-character-panel-actions">
                    <div className="nh3d-character-panel-title">
                      Character Actions
                    </div>
                    <div className="nh3d-character-actions-grid">
                      <button
                        className="nh3d-character-action-button"
                        onClick={() => controller?.toggleInventoryDialog()}
                        type="button"
                      >
                        <span className="nh3d-character-action-label">
                          Inventory
                        </span>
                        <span className="nh3d-character-action-detail">
                          Open carried items
                        </span>
                      </button>
                      {characterCommandActions.map((action) => (
                        <button
                          className="nh3d-character-action-button"
                          key={`character-action-${action.id}`}
                          onClick={() =>
                            runCharacterExtendedCommand(action.command)
                          }
                          type="button"
                        >
                          <span className="nh3d-character-action-label">
                            {action.label}
                          </span>
                          <span className="nh3d-character-action-detail">
                            {action.detail}
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>

                  {characterSheet.extraSections.map((section, sectionIndex) => (
                    <section
                      className="nh3d-character-panel"
                      key={`character-extra-${section.title}-${sectionIndex}`}
                    >
                      <div className="nh3d-character-panel-title">
                        {section.title}
                      </div>
                      <div className="nh3d-character-line-stack">
                        {section.lines.map((line, lineIndex) => (
                          <div
                            className="nh3d-character-line"
                            key={`character-extra-line-${sectionIndex}-${lineIndex}`}
                          >
                            {line}
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>

                <div className="nh3d-info-hint">
                  Press SPACE, ENTER, or ESC to close. Press Ctrl+M to reopen.
                </div>
              </div>
              <div className="nh3d-menu-actions">
                <button
                  className="nh3d-menu-action-button nh3d-menu-action-cancel"
                  onClick={closeInfoMenuDialog}
                  type="button"
                >
                  Close
                </button>
              </div>
            </>
          ) : (
            <>
              <div
                className="nh3d-dialog-info-scroll"
                data-nh3d-overflow-glow
                data-nh3d-overflow-glow-host="parent"
              >
                <div className="nh3d-info-title">
                  {infoMenu.title || "NetHack Information"}
                </div>
                <div className="nh3d-info-body">
                  {infoMenu.lines.length > 0
                    ? infoMenu.lines.join("\n")
                    : "(No details)"}
                </div>
                <div className="nh3d-info-hint">
                  Press SPACE, ENTER, or ESC to close. Press Ctrl+M to reopen.
                </div>
              </div>
              <div className="nh3d-menu-actions">
                <button
                  className="nh3d-menu-action-button nh3d-menu-action-cancel"
                  onClick={closeInfoMenuDialog}
                  type="button"
                >
                  Close
                  </button>
                </div>
              </>
            )}
          </>
        ) : null}
      </AnimatedDialog>

      <AnimatedDialog
        className={`nh3d-dialog nh3d-dialog-inventory nh3d-dialog-fixed-actions nh3d-dialog-has-mobile-close${
          inventoryReducedMotionEnabled
            ? " nh3d-dialog-inventory-reduced-motion"
            : ""
        }${inventoryAsciiModeEnabled ? " nh3d-dialog-inventory-ascii" : ""}${
          inventoryTileOnlyMotionEnabled
            ? " nh3d-dialog-inventory-tile-motion-only"
            : ""
        }`}
        open={inventory.visible}
        id="inventory-dialog"
      >
          {renderMobileDialogCloseButton(
            () => controller?.closeInventoryDialog(),
            "Close inventory",
          )}
          <div className="nh3d-inventory-title">INVENTORY</div>
          <div className="nh3d-overflow-glow-frame nh3d-overflow-glow-shell-fill">
            <div
              className={`nh3d-inventory-items${
                inventoryReducedMotionEnabled
                  ? " nh3d-inventory-items-fixed-size"
                  : ""
              }`}
              data-nh3d-overflow-glow
              data-nh3d-overflow-glow-host="parent"
              data-nh3d-inv-fixed-size={inventoryFixedTileSizeMode}
              onPointerDownCapture={
                inventoryReducedMotionEnabled
                  ? undefined
                  : handleInventoryRowPointerDownCapture
              }
              onPointerDown={
                inventoryReducedMotionEnabled
                  ? undefined
                  : handleInventoryPointerUpdate
              }
              onPointerEnter={
                inventoryReducedMotionEnabled
                  ? undefined
                  : handleInventoryPointerUpdate
              }
              onPointerCancel={
                inventoryReducedMotionEnabled
                  ? undefined
                  : handleInventoryPointerCancel
              }
              onPointerLeave={
                inventoryReducedMotionEnabled
                  ? undefined
                  : handleInventoryPointerLeave
              }
              onPointerMove={
                inventoryReducedMotionEnabled
                  ? undefined
                  : handleInventoryPointerUpdate
              }
              onPointerUp={
                inventoryReducedMotionEnabled
                  ? undefined
                  : handleInventoryPointerUp
              }
              onTouchStartCapture={
                inventoryReducedMotionEnabled
                  ? undefined
                  : handleInventoryRowTouchStartCapture
              }
              onTouchStart={
                inventoryReducedMotionEnabled
                  ? undefined
                  : handleInventoryTouchUpdate
              }
              onTouchMove={
                inventoryReducedMotionEnabled
                  ? undefined
                  : handleInventoryTouchMove
              }
              onTouchEnd={
                inventoryReducedMotionEnabled
                  ? undefined
                  : handleInventoryTouchEnd
              }
              onTouchCancel={
                inventoryReducedMotionEnabled
                  ? undefined
                  : handleInventoryTouchCancel
              }
              onScroll={
                inventoryReducedMotionEnabled
                  ? undefined
                  : handleInventoryItemsScroll
              }
              ref={inventoryItemsContainerRef}
              style={
                inventoryReducedMotionEnabled
                  ? ({
                      "--nh3d-inv-fixed-icon-size-px": `${inventoryFixedIconSizePx}px`,
                    } as CSSProperties)
                  : undefined
              }
            >
              {inventory.items.length === 0 ? (
                <div className="nh3d-inventory-empty">
                  Your inventory is empty.
                </div>
              ) : (
                inventory.items.map((item, index) => {
                  if (item.isCategory) {
                    return (
                      <div
                        className={`nh3d-inventory-category${
                          index === 0 ? " nh3d-inventory-category-first" : ""
                        }`}
                        key={`cat-${index}`}
                      >
                        {item.text}
                      </div>
                    );
                  }

                  const tileApplicable = isMenuItemTileApplicable(item);
                  const tileIndex =
                    tilesUiEnabled && tileApplicable
                      ? resolveMenuItemTileIndex(item)
                      : null;
                  const tilePreview = renderMenuItemTilePreview(
                    item,
                    tileIndex,
                  );
                  const fallbackGlyph = resolveMenuItemFallbackGlyph(item);
                  const itemAccelerator =
                    typeof item.accelerator === "string"
                      ? item.accelerator.trim()
                      : "";
                  const isContextMenuItemActive =
                    inventoryContextMenu?.accelerator === itemAccelerator;
                  const showInventoryTileIcon =
                    tilesUiEnabled &&
                    tileApplicable &&
                    (!inventoryReducedMotionEnabled ||
                      inventoryFixedTileSizeMode !== "none");

                  return (
                    <div
                      className={`nh3d-inventory-item${
                        !inventoryContextActionsEnabled
                          ? " nh3d-inventory-item-disabled"
                          : ""
                      }${
                        isContextMenuItemActive
                          ? " nh3d-inventory-item-active"
                          : ""
                      }`}
                      data-nh3d-accelerator={itemAccelerator}
                      key={`item-${index}`}
                      ref={(element) => {
                        setInventoryRowRef(index, element);
                      }}
                      style={
                        inventoryTileOnlyMotionEnabled
                          ? ({
                              "--nh3d-inv-row-order": String(index + 1),
                            } as CSSProperties)
                          : undefined
                      }
                      onPointerDown={(event) => {
                        if (!inventoryUsesFullRowAnimation) {
                          return;
                        }
                        if (
                          event.pointerType === "mouse" &&
                          event.button !== 0
                        ) {
                          return;
                        }
                        beginInventoryRowPressCandidate(
                          "pointer",
                          event.pointerId,
                          item,
                          itemAccelerator,
                          event.currentTarget,
                          event.clientX,
                          event.clientY,
                        );
                      }}
                      onTouchStart={(event) => {
                        if (!inventoryUsesFullRowAnimation) {
                          return;
                        }
                        const primaryTouch =
                          event.changedTouches[0] ?? event.touches[0];
                        if (!primaryTouch) {
                          return;
                        }
                        beginInventoryRowPressCandidate(
                          "touch",
                          primaryTouch.identifier,
                          item,
                          itemAccelerator,
                          event.currentTarget,
                          primaryTouch.clientX,
                          primaryTouch.clientY,
                        );
                      }}
                      onClick={(event) => {
                        if (!inventoryContextActionsEnabled) {
                          return;
                        }
                        if (isContextMenuItemActive) {
                          setInventoryContextMenu(null);
                          return;
                        }
                        const targetRect =
                          event.currentTarget.getBoundingClientRect();
                        openInventoryContextMenu(
                          item,
                          event.clientX,
                          event.clientY,
                          targetRect,
                        );
                      }}
                      onContextMenu={(event) => {
                        if (!inventoryContextActionsEnabled) {
                          return;
                        }
                        event.preventDefault();
                        const targetRect =
                          event.currentTarget.getBoundingClientRect();
                        openInventoryContextMenu(
                          item,
                          event.clientX,
                          event.clientY,
                          targetRect,
                        );
                      }}
                      onKeyDown={(event) => {
                        if (!inventoryContextActionsEnabled) {
                          return;
                        }
                        const moveDirection =
                          resolveInventoryContextNavigationDirection(
                            event.key,
                            event.code,
                          );
                        if (moveDirection) {
                          event.preventDefault();
                          event.stopPropagation();
                          if (inventoryContextMenu) {
                            moveInventoryContextMenuActionFocus(moveDirection);
                            return;
                          }
                          moveInventoryItemFocusByArrowKey(
                            event.currentTarget,
                            moveDirection === "up" || moveDirection === "left"
                              ? "previous"
                              : "next",
                          );
                          return;
                        }

                        const activationKey = normalizeInventoryActivationKey(
                          event.key,
                        );
                        if (!activationKey) {
                          return;
                        }

                        if (
                          inventoryKeyboardActivationKeysDownRef.current.has(
                            activationKey,
                          )
                        ) {
                          event.preventDefault();
                          event.stopPropagation();
                          return;
                        }
                        inventoryKeyboardActivationKeysDownRef.current.add(
                          activationKey,
                        );
                        event.preventDefault();
                        event.stopPropagation();

                        const target =
                          event.currentTarget.getBoundingClientRect();
                        openInventoryContextMenu(
                          item,
                          target.right,
                          target.top + target.height / 2,
                          target,
                        );
                        if (typeof window !== "undefined") {
                          window.requestAnimationFrame(() => {
                            moveInventoryContextMenuActionFocus("right");
                          });
                        }
                      }}
                      role={
                        inventoryContextActionsEnabled ? "button" : undefined
                      }
                      tabIndex={inventoryContextActionsEnabled ? 0 : -1}
                    >
                      <span className="nh3d-inventory-item-leading">
                        {showInventoryTileIcon ? (
                          <span
                            className="nh3d-inventory-icon-anchor"
                            aria-hidden="true"
                          >
                            <span className="nh3d-inventory-icon-shell">
                              {tilePreview ? (
                                <span className="nh3d-inventory-icon-art">
                                  {tilePreview}
                                </span>
                              ) : (
                                <span className="nh3d-inventory-icon-fallback">
                                  {fallbackGlyph}
                                </span>
                              )}
                            </span>
                          </span>
                        ) : null}
                        <span className="nh3d-inventory-key">
                          {item.accelerator || "?"})
                        </span>
                      </span>
                      <span className={item.className as string}>
                        {item.text || "Unknown item"}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
          <div className="nh3d-inventory-close">
            {inventoryCloseInstructionText}
          </div>
          <div className="nh3d-menu-actions">
            <button
              className="nh3d-menu-action-button nh3d-menu-action-cancel"
              onClick={() => controller?.closeInventoryDialog()}
              type="button"
            >
              Close
            </button>
          </div>
      </AnimatedDialog>

      {inventoryContextMenu && inventoryContextActionsEnabled ? (
        <div
          className="nh3d-context-menu nh3d-inventory-context-menu nh3d-overflow-glow-frame"
          onContextMenu={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            const moveDirection = resolveInventoryContextNavigationDirection(
              event.key,
              event.code,
            );
            if (moveDirection) {
              event.preventDefault();
              event.stopPropagation();
              moveInventoryContextMenuActionFocus(moveDirection);
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              closeInventoryContextMenu({ restoreItemFocus: true });
            }
          }}
          ref={inventoryContextMenuRef}
          style={{
            left: `${inventoryContextMenu.x}px`,
            top: `${inventoryContextMenu.y}px`,
          }}
        >
          <div
            className="nh3d-inventory-context-menu-scroll"
            data-nh3d-overflow-glow
            data-nh3d-overflow-glow-host="parent"
          >
            <div
              className={`nh3d-context-menu-title${
                shouldScrollInventoryContextTitle
                  ? " nh3d-context-menu-title-scroll"
                  : ""
              }`}
              style={inventoryContextTitleStyle}
            >
              {shouldScrollInventoryContextTitle ? (
                <span className="nh3d-context-menu-title-scroll-track">
                  <span>{inventoryContextTitle}</span>
                  <span aria-hidden="true">{inventoryContextTitle}</span>
                </span>
              ) : (
                inventoryContextTitle
              )}
            </div>
            <div className="nh3d-context-menu-actions nh3d-context-menu-actions-inventory">
              {inventoryContextMenuActions.map((action) => (
                <button
                  className="nh3d-context-menu-button"
                  key={`inventory-${inventoryContextMenu.accelerator}-${action.id}`}
                  onClick={() => {
                    if (action.kind === "extended" && action.value) {
                      if (action.armInventorySelection !== false) {
                        // Use the special prefix to ensure the runtime intercepts it and reliably
                        // applies it to the next inventory prompt menu without race conditions.
                        controller?.sendInput(
                          `__INVCTX_SELECT__:${inventoryContextMenu.accelerator}`,
                        );
                      }
                      controller?.runExtendedCommand(action.value);
                    } else {
                      controller?.runInventoryItemAction(
                        action.id,
                        inventoryContextMenu.accelerator,
                      );
                    }
                    setInventoryContextMenu(null);
                  }}
                  type="button"
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {isFpsPlayMode &&
      characterCreationConfig !== null &&
      connectionState === "running" &&
      !loadingVisible ? (
        <div aria-hidden="true" className="nh3d-fps-crosshair">
          <div className="nh3d-fps-crosshair-dot" />
        </div>
      ) : null}

      {fpsCrosshairContext ? (
        <div
          className={`nh3d-context-menu ${
            isFpsPlayMode &&
            fpsCrosshairContext.autoDirectionFromFpsAim !== false &&
            tileContextMenuPosition === null
              ? "nh3d-fps-crosshair-context"
              : "nh3d-tile-context-menu"
          }`}
          ref={fpsCrosshairContextMenuRef}
          style={
            tileContextMenuPosition
              ? {
                  left: `${tileContextMenuPosition.x}px`,
                  top: `${tileContextMenuPosition.y}px`,
                }
              : undefined
          }
        >
          <div
            className={`nh3d-context-menu-title${
              shouldScrollFpsContextTitle
                ? " nh3d-context-menu-title-scroll"
                : ""
            }`}
            style={fpsContextTitleStyle}
          >
            {shouldScrollFpsContextTitle ? (
              <span className="nh3d-context-menu-title-scroll-track">
                <span>{fpsContextTitle}</span>
                <span aria-hidden="true">{fpsContextTitle}</span>
              </span>
            ) : (
              fpsContextTitle
            )}
          </div>
          <div className="nh3d-context-menu-actions">
            {fpsCrosshairContext.actions.map((action) => (
              <button
                className="nh3d-context-menu-button"
                key={`crosshair-${action.kind}-${action.id}-${action.value}`}
                onClick={() => runFpsCrosshairContextAction(action)}
                type="button"
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <AnimatedDialog
        className={`nh3d-dialog nh3d-controller-action-wheel-dialog ${
          controllerActionWheelMode === "quick" ? "is-quick" : "is-extended"
        }`}
        open={isControllerActionWheelVisible}
        id="nh3d-controller-action-wheel-dialog"
        ref={controllerActionWheelDialogRef}
      >
          {controllerActionWheelMode === "quick" ? (
            <div
              className="nh3d-controller-action-wheel-ring is-on"
              data-chosen={String(controllerActionWheelChosenIndex + 1)}
              data-count={String(controllerActionWheelEntries.length)}
            >
              {controllerActionWheelEntries.map((action) => {
                const isChosen =
                  controllerActionWheelChosenIndex === action.index;
                const arcStyle = {
                  clipPath: action.clipPath,
                  ["--nh3d-wheel-stagger-delay" as string]: `${(action.index % 2) * 15}ms`,
                } as CSSProperties;
                const labelStyle: CSSProperties = {
                  left: `${action.labelXPercent.toFixed(2)}%`,
                  top: `${action.labelYPercent.toFixed(2)}%`,
                };
                return (
                  <button
                    aria-label={action.label}
                    className={`nh3d-controller-action-wheel-arc${
                      isChosen ? " is-chosen" : ""
                    }`}
                    data-nh3d-wheel-angle={action.angleDeg.toFixed(2)}
                    data-nh3d-wheel-index={String(action.index)}
                    key={`controller-wheel-${action.id}`}
                    onClick={() => runControllerWheelEntry(action)}
                    onFocus={() =>
                      setControllerActionWheelChosenIndex(action.index)
                    }
                    onMouseEnter={() =>
                      setControllerActionWheelChosenIndex(action.index)
                    }
                    style={arcStyle}
                    type="button"
                  >
                    <span
                      className="nh3d-controller-action-wheel-arc-label"
                      style={labelStyle}
                    >
                      {action.label}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <Fragment>
              <div className="nh3d-controller-action-wheel-title-row">
                <div className="nh3d-controller-action-wheel-title">
                  Extended Commands
                </div>
              </div>
              <div className="nh3d-overflow-glow-frame nh3d-controller-action-wheel-extended-shell">
                <div
                  className="nh3d-mobile-actions-sections nh3d-controller-action-wheel-extended"
                  data-nh3d-overflow-glow
                  data-nh3d-overflow-glow-host="parent"
                >
                  {mobileCommonExtendedCommandNames.length > 0 ? (
                    <div className="nh3d-mobile-actions-section">
                      <div className="nh3d-mobile-actions-subheader">
                        Common commands
                      </div>
                      <div className="nh3d-mobile-actions-grid is-extended">
                        {mobileCommonExtendedCommandNames.map((command) => (
                          <button
                            className="nh3d-mobile-actions-button"
                            key={`wheel-common-${command}`}
                            onClick={() =>
                              runControllerWheelExtendedCommand(command)
                            }
                            type="button"
                          >
                            {command}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="nh3d-mobile-actions-section">
                    <div className="nh3d-mobile-actions-subheader">
                      All commands
                    </div>
                    <div className="nh3d-mobile-actions-grid is-extended">
                      {mobileExtendedCommandNames.map((command) => (
                        <button
                          className="nh3d-mobile-actions-button"
                          key={`wheel-all-${command}`}
                          onClick={() =>
                            runControllerWheelExtendedCommand(command)
                          }
                          type="button"
                        >
                          {command}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </Fragment>
          )}
      </AnimatedDialog>

      {isMobileGameRunning && isMobileActionSheetVisible ? (
        <div className="nh3d-mobile-actions-sheet">
          <div className="nh3d-mobile-actions-title-row">
            <div className="nh3d-mobile-actions-title">
              {mobileActionSheetMode === "quick"
                ? "Actions"
                : "Extended Commands"}
            </div>
            <div className="nh3d-mobile-actions-controls">
              {mobileActionSheetMode === "extended" ? (
                <button
                  className="nh3d-mobile-actions-back"
                  onClick={() => setMobileActionSheetMode("quick")}
                  type="button"
                >
                  Back
                </button>
              ) : null}

              <div className="nh3d-mobile-actions-divider" />

              <button
                className="nh3d-mobile-actions-back"
                onClick={() => {
                  setIsMobileActionSheetVisible(false);

                  setMobileActionSheetMode("quick");

                  setIsPauseMenuVisible(true);
                }}
                type="button"
              >
                Menu
              </button>

              <button
                className="nh3d-mobile-actions-close"
                onClick={() => {
                  setIsMobileActionSheetVisible(false);
                  setMobileActionSheetMode("quick");
                }}
                type="button"
              >
                Close
              </button>
            </div>
          </div>
          {mobileActionSheetMode === "quick" ? (
            <div className="nh3d-overflow-glow-frame">
              <div
                className="nh3d-mobile-actions-grid is-fixed-layout"
                data-nh3d-overflow-glow
                data-nh3d-overflow-glow-host="parent"
              >
                {mobileActions.map((action) => (
                  <button
                    className="nh3d-mobile-actions-button"
                    key={action.id}
                    onClick={() => {
                      controller?.dismissFpsCrosshairContextMenu();
                      if (action.id === "extended") {
                        setMobileActionSheetMode("extended");
                        return;
                      }
                      if (action.kind === "quick") {
                        controller?.runQuickAction(action.value);
                      } else {
                        controller?.runExtendedCommand(action.value);
                      }
                      setIsMobileActionSheetVisible(false);
                      setMobileActionSheetMode("quick");
                    }}
                    type="button"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="nh3d-overflow-glow-frame">
              <div
                className="nh3d-mobile-actions-sections"
                data-nh3d-overflow-glow
                data-nh3d-overflow-glow-host="parent"
              >
                {mobileCommonExtendedCommandNames.length > 0 ? (
                  <div className="nh3d-mobile-actions-section">
                    <div className="nh3d-mobile-actions-subheader">
                      Common commands
                    </div>
                    <div className="nh3d-mobile-actions-grid is-extended">
                      {mobileCommonExtendedCommandNames.map((command) => (
                        <button
                          className="nh3d-mobile-actions-button"
                          key={`common-${command}`}
                          onClick={() => {
                            controller?.dismissFpsCrosshairContextMenu();
                            controller?.runExtendedCommand(command);
                            setIsMobileActionSheetVisible(false);
                            setMobileActionSheetMode("quick");
                          }}
                          type="button"
                        >
                          {command}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="nh3d-mobile-actions-section">
                  <div className="nh3d-mobile-actions-subheader">
                    All commands
                  </div>
                  <div className="nh3d-mobile-actions-grid is-extended">
                    {mobileExtendedCommandNames.map((command) => (
                      <button
                        className="nh3d-mobile-actions-button"
                        key={`all-${command}`}
                        onClick={() => {
                          controller?.dismissFpsCrosshairContextMenu();
                          controller?.runExtendedCommand(command);
                          setIsMobileActionSheetVisible(false);
                          setMobileActionSheetMode("quick");
                        }}
                        type="button"
                      >
                        {command}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {wizardCommandsSupported && isWizardCommandsVisible ? (
        <div
          className={`nh3d-wizard-commands-sheet is-visible ${
            isMobileGameRunning ? "is-mobile" : "is-desktop"
          }`}
          ref={wizardCommandsSheetRef}
        >
          <div className="nh3d-mobile-actions-title-row">
            <div className="nh3d-mobile-actions-title">Wizard Commands</div>
            <div className="nh3d-mobile-actions-controls">
              <button
                className="nh3d-mobile-actions-close"
                onClick={closeWizardCommands}
                type="button"
              >
                Close
              </button>
            </div>
          </div>
          <div className="nh3d-overflow-glow-frame">
            <div
              className="nh3d-mobile-actions-sections nh3d-wizard-commands-sections"
              data-nh3d-overflow-glow
              data-nh3d-overflow-glow-host="parent"
            >
              <div className="nh3d-mobile-actions-section">
                <div className="nh3d-mobile-actions-grid is-extended">
                  {wizardExtendedCommandNames.map((command) => (
                    <button
                      className="nh3d-mobile-actions-button"
                      key={`wizard-${command}`}
                      onClick={() => runWizardExtendedCommand(command)}
                      type="button"
                    >
                      {command}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {wizardCommandsSupported && isMobileGameRunning ? (
        <button
          className={`nh3d-wizard-commands-button${
            isWizardCommandsVisible ? " is-active" : ""
          }`}
          onClick={toggleWizardCommands}
          ref={wizardCommandsButtonRef}
          type="button"
        >
          Wizard
        </button>
      ) : null}

      {isMobileGameRunning && repeatActionVisible ? (
        <button
          className="nh3d-mobile-repeat-button"
          onClick={() => {
            controller?.dismissFpsCrosshairContextMenu();
            controller?.repeatLastAction();
          }}
          type="button"
        >
          Repeat
        </button>
      ) : null}

      {isDesktopGameRunning && !clientOptions.controllerEnabled ? (
        <div className="nh3d-desktop-bottom-actions">
          {wizardCommandsSupported ? (
            <button
              className={`nh3d-desktop-bottom-button${
                isWizardCommandsVisible ? " is-active" : ""
              }`}
              onClick={toggleWizardCommands}
              ref={wizardCommandsButtonRef}
              type="button"
            >
              Wizard
            </button>
          ) : null}
          <button
            className={`nh3d-desktop-bottom-button${
              isCharacterSheetVisible ? " is-active" : ""
            }`}
            onClick={openCharacterDialog}
            type="button"
          >
            Character
          </button>
          <button
            className={`nh3d-desktop-bottom-button${
              inventory.visible ? " is-active" : ""
            }`}
            onClick={() => {
              controller?.dismissFpsCrosshairContextMenu();
              closeWizardCommands();
              controller?.toggleInventoryDialog();
            }}
            type="button"
          >
            Inventory
          </button>
        </div>
      ) : null}

      {isMobileGameRunning ? (
        <div className="nh3d-mobile-bottom-bar">
          <button
            className={`nh3d-mobile-bottom-button${
              isCharacterSheetVisible ? " is-active" : ""
            }`}
            onClick={openCharacterDialog}
            type="button"
          >
            Character
          </button>
          <button
            className={`nh3d-mobile-bottom-button${
              inventory.visible ? " is-active" : ""
            }`}
            onClick={() => {
              controller?.dismissFpsCrosshairContextMenu();
              closeWizardCommands();
              controller?.toggleInventoryDialog();
            }}
            type="button"
          >
            Inventory
          </button>
          <button
            className="nh3d-mobile-bottom-button"
            disabled={!clientOptions.liveMessageLog}
            onClick={() => {
              controller?.dismissFpsCrosshairContextMenu();
              if (!clientOptions.liveMessageLog) {
                return;
              }
              setIsMobileLogVisible((visible) => {
                const next = !visible;
                if (next) {
                  setIsMobileActionSheetVisible(false);
                  setMobileActionSheetMode("quick");
                  closeWizardCommands();
                }
                return next;
              });
            }}
            type="button"
          >
            Log
          </button>
          <button
            className="nh3d-mobile-bottom-button"
            onClick={() => {
              controller?.dismissFpsCrosshairContextMenu();
              controller?.runQuickAction("pickup");
            }}
            type="button"
          >
            Pick Up
          </button>
          <button
            className="nh3d-mobile-bottom-button"
            onClick={() => {
              controller?.dismissFpsCrosshairContextMenu();
              controller?.runQuickAction("search");
            }}
            type="button"
          >
            Search
          </button>
          <button
            className={`nh3d-mobile-bottom-button${
              isMobileActionSheetVisible ? " is-active" : ""
            }`}
            onClick={() => {
              controller?.dismissFpsCrosshairContextMenu();
              setIsMobileActionSheetVisible((visible) => {
                const next = !visible;
                if (next) {
                  setMobileActionSheetMode("quick");
                  setIsMobileLogVisible(false);
                  closeWizardCommands();
                }
                return next;
              });
            }}
            type="button"
          >
            Actions
          </button>
        </div>
      ) : null}

      <div
        className={`${positionRequest ? "is-visible" : ""} nh3d-overflow-glow-frame`.trim()}
        id="position-dialog"
      >
        <div
          className="nh3d-position-dialog-scroll"
          data-nh3d-overflow-glow
          data-nh3d-overflow-glow-host="parent"
        >
          {isMobileViewport && positionRequest ? (
            <button
              aria-label="Close position prompt"
              className="nh3d-position-dialog-close"
              onClick={() => {
                controller?.cancelActivePrompt();
                setPositionRequest(null);
              }}
              type="button"
            >
              {"\u00D7"}
            </button>
          ) : null}
          {positionRequest}
        </div>
      </div>

      <AnimatedDialog
        className="nh3d-dialog nh3d-dialog-question nh3d-dialog-fixed-actions"
        open={isControllerSupportPromptVisible}
        id="nh3d-controller-support-dialog"
      >
          <div className="nh3d-question-text">
            Controller detected. Enable controller support?
          </div>
          <div className="nh3d-menu-actions">
            <button
              className="nh3d-menu-action-button nh3d-menu-action-confirm"
              onClick={() => confirmControllerSupportPromptChoice(true)}
              type="button"
            >
              Yes
            </button>
            <button
              className="nh3d-menu-action-button nh3d-menu-action-cancel"
              onClick={() => confirmControllerSupportPromptChoice(false)}
              type="button"
            >
              No
            </button>
          </div>
      </AnimatedDialog>

      <ConfirmationModal
        dialog={globalConfirmationDialog}
        dialogId="nh3d-global-confirmation-dialog"
        onCancel={() => resolveConfirmation(false)}
        onConfirm={() => resolveConfirmation(true)}
      />
    </>
  );
}
