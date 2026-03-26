export type StartupInitOptionBooleanDefinition = {
  key: string;
  label: string;
  description: string;
  control: "boolean";
  defaultValue: boolean;
  serializeWhenDefault?: boolean;
};

export type StartupInitOptionSelectDefinition = {
  key: string;
  label: string;
  description: string;
  control: "select";
  defaultValue: string;
  serializeWhenDefault?: boolean;
  options: ReadonlyArray<{
    value: string;
    label: string;
  }>;
};

export type StartupInitOptionTextDefinition = {
  key: string;
  label: string;
  description: string;
  control: "text";
  defaultValue: string;
  serializeWhenDefault?: boolean;
  maxLength: number;
  placeholder?: string;
};

export type StartupInitOptionNumberDefinition = {
  key: string;
  label: string;
  description: string;
  control: "number";
  defaultValue: number;
  serializeWhenDefault?: boolean;
  min: number;
  max: number;
  step: number;
};

export type StartupInitOptionDefinition =
  | StartupInitOptionBooleanDefinition
  | StartupInitOptionSelectDefinition
  | StartupInitOptionTextDefinition
  | StartupInitOptionNumberDefinition;

export type StartupInitOptionValue = boolean | string | number;
export type StartupInitOptionValues = Record<string, StartupInitOptionValue>;

export const startupInitOptionDefinitions: ReadonlyArray<StartupInitOptionDefinition> =
  [
    {
      key: "playmode",
      label: "游戏模式",
      description:
        "选择启动模式。巫师模式是 NetHack 调试模式（`playmode:debug`）。",
      control: "select",
      defaultValue: "normal",
      options: [
        { value: "normal", label: "普通" },
        { value: "explore", label: "探索" },
        { value: "debug", label: "巫师/调试" },
      ],
    },
    {
      key: "autopickup",
      label: "自动拾取",
      description:
        "自动拾取在“拾取类型”中选择的物品类别。",
      control: "boolean",
      defaultValue: true,
    },
    {
      key: "pickup_types",
      label: "拾取类型",
      description:
        '要自动拾取的物品类别符号（例如：$"=/!?+）。留空则使用游戏默认。',
      control: "text",
      defaultValue: "$",
      serializeWhenDefault: true,
      maxLength: 20,
      placeholder: '$"=/!?+',
    },
    {
      key: "pickup_thrown",
      label: "拾取投掷物",
      description: "投掷物落地后自动拾取。",
      control: "boolean",
      defaultValue: true,
    },
    {
      key: "pickup_burden",
      label: "拾取负重阈值",
      description:
        "当拾取会超过该负重等级时先进行提示。",
      control: "select",
      defaultValue: "n",
      options: [
        { value: "u", label: "无负重 (u)" },
        { value: "b", label: "负重 (b)" },
        { value: "s", label: "吃力 (s)" },
        { value: "n", label: "沉重吃力 (n)" },
        { value: "t", label: "超负荷 (t)" },
        { value: "l", label: "严重超载 (l)" },
      ],
    },
    {
      key: "pile_limit",
      label: "堆叠阈值",
      description:
        "地面堆叠触发弹出列表的物品数量阈值。",
      control: "number",
      defaultValue: 5,
      min: 0,
      max: 50,
      step: 1,
    },
    {
      key: "autoquiver",
      label: "自动箭袋",
      description: "发射时自动填充箭袋或准备合适武器。",
      control: "boolean",
      defaultValue: false,
    },
    {
      key: "autoopen",
      label: "自动开门",
      description: "移动撞门时自动尝试开门。",
      control: "boolean",
      defaultValue: true,
    },
    {
      key: "autodig",
      label: "自动挖掘",
      description:
        "可挖掘且移动撞墙时自动挖掘。",
      control: "boolean",
      defaultValue: false,
    },
    {
      key: "cmdassist",
      label: "命令辅助",
      description: "输入错误命令时显示额外帮助文本。",
      control: "boolean",
      defaultValue: true,
    },
    {
      key: "confirm",
      label: "攻击确认",
      description: "攻击和平生物前先确认。",
      control: "boolean",
      defaultValue: true,
    },
    {
      key: "safe_pet",
      label: "宠物保护",
      description: "攻击自己的宠物前先确认。",
      control: "boolean",
      defaultValue: true,
    },
    {
      key: "help",
      label: "游戏内帮助",
      description:
        "当存在更多信息时提示显示额外观察/帮助详情。",
      control: "boolean",
      defaultValue: true,
    },
    {
      key: "legacy",
      label: "经典开场",
      description: "新游戏开始时显示故事开场。",
      control: "boolean",
      defaultValue: true,
    },
    {
      key: "rest_on_space",
      label: "空格休息",
      description: "将空格键视为等待/休息。",
      control: "boolean",
      defaultValue: false,
    },
    {
      key: "pushweapon",
      label: "推送武器",
      description: "切换武器时将当前主手武器移到副手。",
      control: "boolean",
      defaultValue: false,
    },
    {
      key: "extmenu",
      label: "扩展命令菜单",
      description: "使用弹出菜单执行扩展命令。",
      control: "boolean",
      defaultValue: false,
    },
    {
      key: "fixinv",
      label: "固定背包字母",
      description: "尽量在物品变化时保留背包字母。",
      control: "boolean",
      defaultValue: true,
    },
    {
      key: "implicit_uncursed",
      label: "显示未诅咒",
      description:
        "在背包描述中始终包含“未诅咒”字样。",
      control: "boolean",
      defaultValue: true,
    },
    {
      key: "mention_walls",
      label: "提示撞墙",
      description: "移动撞墙时显示提示信息。",
      control: "boolean",
      defaultValue: false,
    },
    // {
    //   key: "news",
    //   label: "Startup News",
    //   description: "Show NetHack news text at startup when available.",
    //   control: "boolean",
    //   defaultValue: true,
    // },
    {
      key: "sortloot",
      label: "战利品列表排序",
      description: "拾取与背包选择列表的排序方式。",
      control: "select",
      defaultValue: "l",
      options: [
        { value: "f", label: "完整排序" },
        { value: "l", label: "仅战利品" },
        { value: "n", label: "不排序" },
      ],
    },
    {
      key: "sortpack",
      label: "背包排序",
      description: "显示背包时按类型排序内容。",
      control: "boolean",
      defaultValue: true,
    },
    {
      key: "msghistory",
      label: "消息历史数量",
      description: "可回看的顶部消息保留条数。",
      control: "number",
      defaultValue: 20,
      min: 20,
      max: 500,
      step: 1,
    },
    {
      key: "dogname",
      label: "狗名",
      description: "第一只狗的默认名字。",
      control: "text",
      defaultValue: "",
      maxLength: 30,
      placeholder: "Fido",
    },
    {
      key: "catname",
      label: "猫名",
      description: "第一只猫的默认名字。",
      control: "text",
      defaultValue: "",
      maxLength: 30,
      placeholder: "Morris",
    },
    {
      key: "horsename",
      label: "马名",
      description: "第一匹马的默认名字。",
      control: "text",
      defaultValue: "",
      maxLength: 30,
      placeholder: "Silver",
    },
    {
      key: "pettype",
      label: "偏好宠物",
      description: "可变职业的初始宠物偏好类型。",
      control: "select",
      defaultValue: "",
      options: [
        { value: "", label: "游戏默认" },
        { value: "cat", label: "猫" },
        { value: "dog", label: "狗" },
        { value: "horse", label: "马" },
        { value: "none", label: "无" },
      ],
    },
    {
      key: "fruit",
      label: "偏好水果",
      description: "角色偏好的水果名称。",
      control: "text",
      defaultValue: "",
      maxLength: 31,
      placeholder: "slime mold",
    },
    {
      key: "packorder",
      label: "背包顺序",
      description: "背包中物品类别的显示顺序。",
      control: "text",
      defaultValue: "",
      maxLength: 20,
      placeholder: '")[%?+/=!(*0_`',
    },
    {
      key: "paranoid_confirmation",
      label: "谨慎确认",
      description:
        "以空格分隔的额外确认项（例如：confirm quit attack pray）。",
      control: "text",
      defaultValue: "",
      maxLength: 64,
      placeholder: "confirm quit attack pray",
    },
    {
      key: "sparkle",
      label: "魔抗闪光",
      description: "显示魔法抗性的特殊闪光效果。",
      control: "boolean",
      defaultValue: true,
    },
    {
      key: "standout",
      label: "高亮怪物/更多提示",
      description: "加粗怪物与 --More-- 提示。",
      control: "boolean",
      defaultValue: false,
    },
    {
      key: "tombstone",
      label: "墓碑",
      description: "死亡时显示墓碑图。",
      control: "boolean",
      defaultValue: true,
    },
    {
      key: "verbose",
      label: "详细消息",
      description: "使用更完整的状态与动作消息文本。",
      control: "boolean",
      defaultValue: true,
    },
  ];

const startupInitOptionDefinitionByKey = new Map<
  string,
  StartupInitOptionDefinition
>(
  startupInitOptionDefinitions.map((definition) => [
    definition.key.toLowerCase(),
    definition,
  ]),
);

const requiredStartupInitOptionTokens: ReadonlyArray<string> = ["checkpoint"];

const supportedPassthroughStartupInitOptionValuesByKey = new Map<
  string,
  string
>([["getpos.autodescribe", "nothing"]]);

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getStepDecimalPlaces(step: number): number {
  const text = String(step);
  const dotIndex = text.indexOf(".");
  return dotIndex < 0 ? 0 : Math.max(0, text.length - dotIndex - 1);
}

function normalizeNumberValue(
  definition: StartupInitOptionNumberDefinition,
  rawValue: unknown,
): number {
  const numeric =
    typeof rawValue === "number" && Number.isFinite(rawValue)
      ? rawValue
      : Number(rawValue);
  if (!Number.isFinite(numeric)) {
    return definition.defaultValue;
  }
  const clamped = clampNumber(numeric, definition.min, definition.max);
  const step = Math.max(0.000001, definition.step);
  const stepsFromMin = Math.round((clamped - definition.min) / step);
  const snapped = definition.min + stepsFromMin * step;
  const decimals = getStepDecimalPlaces(step);
  return Number(
    clampNumber(snapped, definition.min, definition.max).toFixed(decimals),
  );
}

function sanitizeTextValue(rawValue: unknown, maxLength: number): string {
  if (typeof rawValue !== "string") {
    return "";
  }
  const sanitized = rawValue
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized.slice(0, Math.max(0, maxLength));
}

function normalizeSelectValue(
  definition: StartupInitOptionSelectDefinition,
  rawValue: unknown,
): string {
  if (typeof rawValue !== "string") {
    return definition.defaultValue;
  }
  const normalized = rawValue.trim().toLowerCase();
  const allowedValue = definition.options.find(
    (option) => option.value.toLowerCase() === normalized,
  );
  return allowedValue ? allowedValue.value : definition.defaultValue;
}

function normalizeOptionValue(
  definition: StartupInitOptionDefinition,
  rawValue: unknown,
): StartupInitOptionValue {
  switch (definition.control) {
    case "boolean":
      return typeof rawValue === "boolean" ? rawValue : definition.defaultValue;
    case "select":
      return normalizeSelectValue(definition, rawValue);
    case "text":
      return sanitizeTextValue(rawValue, definition.maxLength);
    case "number":
      return normalizeNumberValue(definition, rawValue);
    default:
      return "";
  }
}

function extractOptionKey(token: string): string {
  const withoutNegation = token.startsWith("!") ? token.slice(1) : token;
  const separatorIndex = withoutNegation.indexOf(":");
  if (separatorIndex < 0) {
    return withoutNegation.toLowerCase();
  }
  return withoutNegation.slice(0, separatorIndex).toLowerCase();
}

function sanitizePassthroughStartupInitOptionToken(
  optionKey: string,
  rawValue: string,
): string | null {
  const requiredValue =
    supportedPassthroughStartupInitOptionValuesByKey.get(optionKey);
  if (!requiredValue) {
    return null;
  }
  const normalizedValue = String(rawValue || "")
    .trim()
    .toLowerCase();
  if (normalizedValue !== requiredValue) {
    return null;
  }
  return `${optionKey}:${requiredValue}`;
}

export function createDefaultStartupInitOptionValues(): StartupInitOptionValues {
  const values: StartupInitOptionValues = {};
  for (const definition of startupInitOptionDefinitions) {
    values[definition.key] = definition.defaultValue;
  }
  return values;
}

export function normalizeStartupInitOptionValues(
  rawValues: unknown,
): StartupInitOptionValues {
  const source =
    rawValues && typeof rawValues === "object"
      ? (rawValues as Record<string, unknown>)
      : {};
  const normalized = createDefaultStartupInitOptionValues();
  for (const definition of startupInitOptionDefinitions) {
    normalized[definition.key] = normalizeOptionValue(
      definition,
      source[definition.key],
    );
  }
  return normalized;
}

export function serializeStartupInitOptionTokens(
  values: StartupInitOptionValues,
): string[] {
  const tokens: string[] = [];
  for (const definition of startupInitOptionDefinitions) {
    const normalizedValue = normalizeOptionValue(
      definition,
      values[definition.key],
    );
    if (
      normalizedValue === definition.defaultValue &&
      !definition.serializeWhenDefault
    ) {
      continue;
    }
    if (definition.control === "boolean") {
      tokens.push(normalizedValue ? definition.key : `!${definition.key}`);
      continue;
    }
    const serializedValue = String(normalizedValue ?? "").trim();
    if (!serializedValue) {
      continue;
    }
    tokens.push(`${definition.key}:${serializedValue}`);
  }
  return tokens;
}

export function sanitizeStartupInitOptionToken(
  rawToken: unknown,
): string | null {
  if (typeof rawToken !== "string") {
    return null;
  }
  const trimmedToken = rawToken.trim();
  if (!trimmedToken || trimmedToken.includes(",")) {
    return null;
  }
  const negated = trimmedToken.startsWith("!");
  const withoutNegation = negated ? trimmedToken.slice(1).trim() : trimmedToken;
  if (!withoutNegation) {
    return null;
  }
  const separatorIndex = withoutNegation.indexOf(":");
  const optionKey = (
    separatorIndex < 0
      ? withoutNegation
      : withoutNegation.slice(0, separatorIndex)
  )
    .trim()
    .toLowerCase();
  const definition = startupInitOptionDefinitionByKey.get(optionKey);
  if (!definition) {
    if (negated || separatorIndex < 0) {
      return null;
    }
    const rawValue = withoutNegation.slice(separatorIndex + 1);
    return sanitizePassthroughStartupInitOptionToken(optionKey, rawValue);
  }
  if (definition.control === "boolean") {
    if (separatorIndex >= 0) {
      return null;
    }
    return negated ? `!${definition.key}` : definition.key;
  }
  if (negated || separatorIndex < 0) {
    return null;
  }
  const rawValue = withoutNegation.slice(separatorIndex + 1);
  const normalizedValue = normalizeOptionValue(definition, rawValue);
  const serializedValue = String(normalizedValue ?? "").trim();
  if (!serializedValue) {
    return null;
  }
  return `${definition.key}:${serializedValue}`;
}

export function sanitizeStartupInitOptionTokens(rawTokens: unknown): string[] {
  if (!Array.isArray(rawTokens) || rawTokens.length === 0) {
    return [];
  }
  const tokenByKey = new Map<string, string>();
  for (const rawToken of rawTokens) {
    const sanitizedToken = sanitizeStartupInitOptionToken(rawToken);
    if (!sanitizedToken) {
      continue;
    }
    tokenByKey.set(extractOptionKey(sanitizedToken), sanitizedToken);
  }
  return Array.from(tokenByKey.values());
}

export function appendRequiredStartupInitOptionTokens(
  rawTokens: unknown,
): string[] {
  const tokenByKey = new Map<string, string>();
  for (const token of sanitizeStartupInitOptionTokens(rawTokens)) {
    tokenByKey.set(extractOptionKey(token), token);
  }
  for (const requiredToken of requiredStartupInitOptionTokens) {
    tokenByKey.set(extractOptionKey(requiredToken), requiredToken);
  }
  return Array.from(tokenByKey.values());
}
