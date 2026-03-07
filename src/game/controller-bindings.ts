export type Nh3dControllerBinding = string;

export type Nh3dControllerActionId =
  | "dpad_up"
  | "dpad_down"
  | "dpad_left"
  | "dpad_right"
  | "left_stick_up"
  | "left_stick_down"
  | "left_stick_left"
  | "left_stick_right"
  | "right_stick_up"
  | "right_stick_down"
  | "right_stick_left"
  | "right_stick_right"
  | "confirm"
  | "search"
  | "cancel_or_context"
  | "zoom_in"
  | "zoom_out"
  | "toggle_large_minimap"
  | "pause_menu"
  | "open_inventory"
  | "open_character"
  | "run_modifier"
  | "recenter_camera";

export type Nh3dControllerBindingSlots = [
  Nh3dControllerBinding | null,
  Nh3dControllerBinding | null,
];

export type Nh3dControllerBindings = Record<
  Nh3dControllerActionId,
  Nh3dControllerBindingSlots
>;

export type Nh3dControllerActionSpec = {
  id: Nh3dControllerActionId;
  label: string;
  description: string;
  group:
    | "Movement"
    | "Look And Camera"
    | "Actions"
    | "System"
    | "Dialogs";
};

export type ParsedNh3dControllerBinding =
  | {
      kind: "button";
      index: number;
    }
  | {
      kind: "axis";
      index: number;
      direction: -1 | 1;
    };

const axisBindingPattern = /^axis:(\d+):([+-])$/i;
const buttonBindingPattern = /^button:(\d+)$/i;

const controllerActionSpecs: readonly Nh3dControllerActionSpec[] = [
  {
    id: "dpad_up",
    label: "D-Pad Up",
    description: "Navigate upward in dialogs and movement highlight.",
    group: "Movement",
  },
  {
    id: "dpad_down",
    label: "D-Pad Down",
    description: "Navigate downward in dialogs and movement highlight.",
    group: "Movement",
  },
  {
    id: "dpad_left",
    label: "D-Pad Left",
    description: "Navigate left in dialogs and movement highlight.",
    group: "Movement",
  },
  {
    id: "dpad_right",
    label: "D-Pad Right",
    description: "Navigate right in dialogs and movement highlight.",
    group: "Movement",
  },
  {
    id: "left_stick_up",
    label: "Left Stick Up",
    description: "Movement highlight and virtual cursor up.",
    group: "Movement",
  },
  {
    id: "left_stick_down",
    label: "Left Stick Down",
    description: "Movement highlight and virtual cursor down.",
    group: "Movement",
  },
  {
    id: "left_stick_left",
    label: "Left Stick Left",
    description: "Movement highlight and virtual cursor left.",
    group: "Movement",
  },
  {
    id: "left_stick_right",
    label: "Left Stick Right",
    description: "Movement highlight and virtual cursor right.",
    group: "Movement",
  },
  {
    id: "right_stick_up",
    label: "Right Stick Up",
    description: "Look, camera pan, and dialog scrolling up.",
    group: "Look And Camera",
  },
  {
    id: "right_stick_down",
    label: "Right Stick Down",
    description: "Look, camera pan, and dialog scrolling down.",
    group: "Look And Camera",
  },
  {
    id: "right_stick_left",
    label: "Right Stick Left",
    description: "Look and camera pan left.",
    group: "Look And Camera",
  },
  {
    id: "right_stick_right",
    label: "Right Stick Right",
    description: "Look and camera pan right.",
    group: "Look And Camera",
  },
  {
    id: "confirm",
    label: "Confirm / Click",
    description: "Confirm movement and click in dialogs.",
    group: "Actions",
  },
  {
    id: "search",
    label: "Search",
    description: "Search current tile when no movement preview is active.",
    group: "Actions",
  },
  {
    id: "cancel_or_context",
    label: "Cancel / Context",
    description: "Open context actions or cancel current dialog.",
    group: "Actions",
  },
  {
    id: "run_modifier",
    label: "Run Modifier",
    description: "Hold to send run prefix before movement.",
    group: "Actions",
  },
  {
    id: "zoom_in",
    label: "Zoom In",
    description: "Zoom camera in.",
    group: "Look And Camera",
  },
  {
    id: "zoom_out",
    label: "Zoom Out",
    description: "Zoom camera out.",
    group: "Look And Camera",
  },
  {
    id: "recenter_camera",
    label: "Recenter Camera",
    description: "Return camera to player center.",
    group: "Look And Camera",
  },
  {
    id: "toggle_large_minimap",
    label: "Toggle Large Minimap",
    description: "Toggle very large minimap size.",
    group: "System",
  },
  {
    id: "pause_menu",
    label: "Pause Menu",
    description: "Open or close pause menu.",
    group: "System",
  },
  {
    id: "open_inventory",
    label: "Inventory",
    description: "Open inventory window.",
    group: "Dialogs",
  },
  {
    id: "open_character",
    label: "Character Sheet",
    description: "Open character sheet window.",
    group: "Dialogs",
  },
];

export const nh3dControllerActionSpecsByGroup = {
  Movement: controllerActionSpecs.filter((spec) => spec.group === "Movement"),
  "Look And Camera": controllerActionSpecs.filter(
    (spec) => spec.group === "Look And Camera",
  ),
  Actions: controllerActionSpecs.filter((spec) => spec.group === "Actions"),
  Dialogs: controllerActionSpecs.filter((spec) => spec.group === "Dialogs"),
  System: controllerActionSpecs.filter((spec) => spec.group === "System"),
} as const;

export const nh3dControllerActionSpecs = controllerActionSpecs;

function createBindingSlots(
  primary: Nh3dControllerBinding | null,
  secondary: Nh3dControllerBinding | null = null,
): Nh3dControllerBindingSlots {
  return [primary, secondary];
}

export function createButtonBinding(index: number): Nh3dControllerBinding {
  return `button:${Math.max(0, Math.trunc(index))}`;
}

export function createAxisBinding(
  index: number,
  direction: -1 | 1,
): Nh3dControllerBinding {
  return `axis:${Math.max(0, Math.trunc(index))}:${direction < 0 ? "-" : "+"}`;
}

export const defaultNh3dControllerBindings: Nh3dControllerBindings = {
  dpad_up: createBindingSlots(createButtonBinding(12)),
  dpad_down: createBindingSlots(createButtonBinding(13)),
  dpad_left: createBindingSlots(createButtonBinding(14)),
  dpad_right: createBindingSlots(createButtonBinding(15)),
  left_stick_up: createBindingSlots(createAxisBinding(1, -1)),
  left_stick_down: createBindingSlots(createAxisBinding(1, 1)),
  left_stick_left: createBindingSlots(createAxisBinding(0, -1)),
  left_stick_right: createBindingSlots(createAxisBinding(0, 1)),
  right_stick_up: createBindingSlots(createAxisBinding(3, -1)),
  right_stick_down: createBindingSlots(createAxisBinding(3, 1)),
  right_stick_left: createBindingSlots(createAxisBinding(2, -1)),
  right_stick_right: createBindingSlots(createAxisBinding(2, 1)),
  confirm: createBindingSlots(createButtonBinding(0), createButtonBinding(7)),
  search: createBindingSlots(createButtonBinding(2)),
  cancel_or_context: createBindingSlots(createButtonBinding(1)),
  zoom_in: createBindingSlots(createButtonBinding(5)),
  zoom_out: createBindingSlots(createButtonBinding(4)),
  toggle_large_minimap: createBindingSlots(createButtonBinding(11)),
  pause_menu: createBindingSlots(createButtonBinding(9)),
  open_inventory: createBindingSlots(createButtonBinding(3)),
  open_character: createBindingSlots(createButtonBinding(8)),
  run_modifier: createBindingSlots(createButtonBinding(6)),
  recenter_camera: createBindingSlots(null),
};

export function parseNh3dControllerBinding(
  rawValue: unknown,
): ParsedNh3dControllerBinding | null {
  const value = String(rawValue || "").trim();
  if (!value) {
    return null;
  }
  const buttonMatch = value.match(buttonBindingPattern);
  if (buttonMatch) {
    const parsedIndex = Number.parseInt(buttonMatch[1], 10);
    if (!Number.isFinite(parsedIndex) || parsedIndex < 0) {
      return null;
    }
    return {
      kind: "button",
      index: Math.trunc(parsedIndex),
    };
  }
  const axisMatch = value.match(axisBindingPattern);
  if (axisMatch) {
    const parsedIndex = Number.parseInt(axisMatch[1], 10);
    if (!Number.isFinite(parsedIndex) || parsedIndex < 0) {
      return null;
    }
    return {
      kind: "axis",
      index: Math.trunc(parsedIndex),
      direction: axisMatch[2] === "-" ? -1 : 1,
    };
  }
  return null;
}

function normalizeBindingSlot(
  rawValue: unknown,
  fallback: Nh3dControllerBinding | null,
): Nh3dControllerBinding | null {
  if (rawValue === null || rawValue === undefined) {
    return fallback;
  }
  const parsed = parseNh3dControllerBinding(rawValue);
  if (!parsed) {
    return fallback;
  }
  return parsed.kind === "button"
    ? createButtonBinding(parsed.index)
    : createAxisBinding(parsed.index, parsed.direction);
}

function normalizeBindingSlots(
  rawValue: unknown,
  fallback: Nh3dControllerBindingSlots,
): Nh3dControllerBindingSlots {
  const firstFallback = fallback[0] ?? null;
  const secondFallback = fallback[1] ?? null;
  if (Array.isArray(rawValue)) {
    const first = normalizeBindingSlot(rawValue[0], firstFallback);
    const second = normalizeBindingSlot(rawValue[1], secondFallback);
    if (first && second && first === second) {
      return [first, null];
    }
    return [first, second];
  }
  if (typeof rawValue === "string") {
    const normalized = normalizeBindingSlot(rawValue, firstFallback);
    if (normalized && normalized === secondFallback) {
      return [normalized, null];
    }
    return [normalized, secondFallback];
  }
  return [firstFallback, secondFallback];
}

export function normalizeNh3dControllerBindings(
  rawValue: unknown,
): Nh3dControllerBindings {
  const source =
    rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
      ? (rawValue as Partial<Record<Nh3dControllerActionId, unknown>>)
      : {};
  const normalized = {} as Nh3dControllerBindings;
  for (const spec of controllerActionSpecs) {
    normalized[spec.id] = normalizeBindingSlots(
      source[spec.id],
      defaultNh3dControllerBindings[spec.id],
    );
  }
  return normalized;
}

const buttonLabelByIndex: Record<number, string> = {
  0: "A",
  1: "B",
  2: "X",
  3: "Y",
  4: "Left Bumper",
  5: "Right Bumper",
  6: "Left Trigger",
  7: "Right Trigger",
  8: "Back / View",
  9: "Start / Menu",
  10: "Left Stick Click",
  11: "Right Stick Click",
  12: "D-Pad Up",
  13: "D-Pad Down",
  14: "D-Pad Left",
  15: "D-Pad Right",
  16: "Home",
};

const axisLabelByIndex: Record<number, string> = {
  0: "Left Stick X",
  1: "Left Stick Y",
  2: "Right Stick X",
  3: "Right Stick Y",
};

function formatAxisDirectionLabel(
  axisIndex: number,
  direction: -1 | 1,
): string {
  if (axisIndex === 0) {
    return direction < 0 ? "Left Stick Left" : "Left Stick Right";
  }
  if (axisIndex === 1) {
    return direction < 0 ? "Left Stick Up" : "Left Stick Down";
  }
  if (axisIndex === 2) {
    return direction < 0 ? "Right Stick Left" : "Right Stick Right";
  }
  if (axisIndex === 3) {
    return direction < 0 ? "Right Stick Up" : "Right Stick Down";
  }
  const axisLabel = axisLabelByIndex[axisIndex] ?? `Axis ${axisIndex}`;
  return `${axisLabel} ${direction < 0 ? "-" : "+"}`;
}

export function formatNh3dControllerBindingLabel(
  binding: Nh3dControllerBinding | null | undefined,
): string {
  if (!binding) {
    return "Unbound";
  }
  const parsed = parseNh3dControllerBinding(binding);
  if (!parsed) {
    return "Unbound";
  }
  if (parsed.kind === "button") {
    return buttonLabelByIndex[parsed.index] ?? `Button ${parsed.index}`;
  }
  return formatAxisDirectionLabel(parsed.index, parsed.direction);
}
