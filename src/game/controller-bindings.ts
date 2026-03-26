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
  | "action_menu"
  | "zoom_in"
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
    | "移动"
    | "视角与镜头"
    | "动作"
    | "系统"
    | "对话";
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
    label: "十字键 上",
    description: "在对话中向上导航，并控制移动高亮。",
    group: "移动",
  },
  {
    id: "dpad_down",
    label: "十字键 下",
    description: "在对话中向下导航，并控制移动高亮。",
    group: "移动",
  },
  {
    id: "dpad_left",
    label: "十字键 左",
    description: "在对话中向左导航，并控制移动高亮。",
    group: "移动",
  },
  {
    id: "dpad_right",
    label: "十字键 右",
    description: "在对话中向右导航，并控制移动高亮。",
    group: "移动",
  },
  {
    id: "left_stick_up",
    label: "左摇杆 上",
    description: "控制移动高亮与虚拟光标向上。",
    group: "移动",
  },
  {
    id: "left_stick_down",
    label: "左摇杆 下",
    description: "控制移动高亮与虚拟光标向下。",
    group: "移动",
  },
  {
    id: "left_stick_left",
    label: "左摇杆 左",
    description: "控制移动高亮与虚拟光标向左。",
    group: "移动",
  },
  {
    id: "left_stick_right",
    label: "左摇杆 右",
    description: "控制移动高亮与虚拟光标向右。",
    group: "移动",
  },
  {
    id: "right_stick_up",
    label: "右摇杆 上",
    description: "向上观察、镜头平移与对话滚动。",
    group: "视角与镜头",
  },
  {
    id: "right_stick_down",
    label: "右摇杆 下",
    description: "向下观察、镜头平移与对话滚动。",
    group: "视角与镜头",
  },
  {
    id: "right_stick_left",
    label: "右摇杆 左",
    description: "向左观察与镜头平移。",
    group: "视角与镜头",
  },
  {
    id: "right_stick_right",
    label: "右摇杆 右",
    description: "向右观察与镜头平移。",
    group: "视角与镜头",
  },
  {
    id: "confirm",
    label: "确认 / 点击",
    description: "确认移动并在对话中点击。",
    group: "动作",
  },
  {
    id: "search",
    label: "搜索",
    description: "在无移动预览时搜索当前地块。",
    group: "动作",
  },
  {
    id: "cancel_or_context",
    label: "取消 / 上下文",
    description: "打开上下文动作或取消当前对话。",
    group: "动作",
  },
  {
    id: "action_menu",
    label: "动作菜单",
    description: "打开手柄径向动作菜单。",
    group: "动作",
  },
  {
    id: "run_modifier",
    label: "奔跑修饰键",
    description: "按住后在移动前发送奔跑前缀。",
    group: "动作",
  },
  {
    id: "zoom_in",
    label: "缩放（按住）",
    description: "按住后用左右摇杆上下进行缩放。",
    group: "视角与镜头",
  },
  {
    id: "recenter_camera",
    label: "镜头回中",
    description: "将镜头返回玩家中心。",
    group: "视角与镜头",
  },
  {
    id: "toggle_large_minimap",
    label: "切换大地图",
    description: "切换超大迷你地图尺寸。",
    group: "系统",
  },
  {
    id: "pause_menu",
    label: "暂停菜单",
    description: "打开或关闭暂停菜单。",
    group: "系统",
  },
  {
    id: "open_inventory",
    label: "背包",
    description: "打开背包窗口。",
    group: "对话",
  },
  {
    id: "open_character",
    label: "角色面板",
    description: "打开角色面板窗口。",
    group: "对话",
  },
];

export const nh3dControllerActionSpecsByGroup = {
  移动: controllerActionSpecs.filter((spec) => spec.group === "移动"),
  视角与镜头: controllerActionSpecs.filter(
    (spec) => spec.group === "视角与镜头",
  ),
  动作: controllerActionSpecs.filter((spec) => spec.group === "动作"),
  对话: controllerActionSpecs.filter((spec) => spec.group === "对话"),
  系统: controllerActionSpecs.filter((spec) => spec.group === "系统"),
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
  action_menu: createBindingSlots(createButtonBinding(4)),
  zoom_in: createBindingSlots(createButtonBinding(5)),
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
  4: "左肩键",
  5: "右肩键",
  6: "左扳机",
  7: "右扳机",
  8: "返回 / 视图",
  9: "开始 / 菜单",
  10: "左摇杆按下",
  11: "右摇杆按下",
  12: "十字键 上",
  13: "十字键 下",
  14: "十字键 左",
  15: "十字键 右",
  16: "主页",
};

const axisLabelByIndex: Record<number, string> = {
  0: "左摇杆 X",
  1: "左摇杆 Y",
  2: "右摇杆 X",
  3: "右摇杆 Y",
};

function formatAxisDirectionLabel(
  axisIndex: number,
  direction: -1 | 1,
): string {
  if (axisIndex === 0) {
    return direction < 0 ? "左摇杆 左" : "左摇杆 右";
  }
  if (axisIndex === 1) {
    return direction < 0 ? "左摇杆 上" : "左摇杆 下";
  }
  if (axisIndex === 2) {
    return direction < 0 ? "右摇杆 左" : "右摇杆 右";
  }
  if (axisIndex === 3) {
    return direction < 0 ? "右摇杆 上" : "右摇杆 下";
  }
  const axisLabel = axisLabelByIndex[axisIndex] ?? `轴 ${axisIndex}`;
  return `${axisLabel} ${direction < 0 ? "-" : "+"}`;
}

export function formatNh3dControllerBindingLabel(
  binding: Nh3dControllerBinding | null | undefined,
): string {
  if (!binding) {
    return "未绑定";
  }
  const parsed = parseNh3dControllerBinding(binding);
  if (!parsed) {
    return "未绑定";
  }
  if (parsed.kind === "button") {
    return buttonLabelByIndex[parsed.index] ?? `按钮 ${parsed.index}`;
  }
  return formatAxisDirectionLabel(parsed.index, parsed.direction);
}
