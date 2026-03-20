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
      label: "Play Mode",
      description:
        "Choose startup mode. Wizard mode is NetHack debug mode (`playmode:debug`).",
      control: "select",
      defaultValue: "normal",
      options: [
        { value: "normal", label: "Normal" },
        { value: "explore", label: "Explore" },
        { value: "debug", label: "Wizard/Debug" },
      ],
    },
    {
      key: "autopickup",
      label: "Autopickup",
      description:
        "Automatically pick up item classes selected in pickup types.",
      control: "boolean",
      defaultValue: true,
    },
    {
      key: "pickup_types",
      label: "Pickup Types",
      description:
        'Object class symbols to autopickup (example: $"=/!?+). Leave blank for game default.',
      control: "text",
      defaultValue: "$",
      serializeWhenDefault: true,
      maxLength: 20,
      placeholder: '$"=/!?+',
    },
    {
      key: "pickup_thrown",
      label: "Pickup Thrown Items",
      description: "Automatically pick up thrown items when they land.",
      control: "boolean",
      defaultValue: true,
    },
    {
      key: "pickup_burden",
      label: "Pickup Burden Threshold",
      description:
        "Prompt before pickup when this encumbrance level would be exceeded.",
      control: "select",
      defaultValue: "n",
      options: [
        { value: "u", label: "Unencumbered (u)" },
        { value: "b", label: "Burdened (b)" },
        { value: "s", label: "Stressed (s)" },
        { value: "n", label: "Strained (n)" },
        { value: "t", label: "Overtaxed (t)" },
        { value: "l", label: "Overloaded (l)" },
      ],
    },
    {
      key: "pile_limit",
      label: "Pile Limit",
      description:
        "Item count threshold that triggers a popup list for floor piles.",
      control: "number",
      defaultValue: 5,
      min: 0,
      max: 50,
      step: 1,
    },
    {
      key: "autoquiver",
      label: "Autoquiver",
      description: "Auto-fill quiver or ready a suitable weapon when firing.",
      control: "boolean",
      defaultValue: false,
    },
    {
      key: "autoopen",
      label: "Autoopen",
      description: "Automatically try to open doors while moving into them.",
      control: "boolean",
      defaultValue: true,
    },
    {
      key: "autodig",
      label: "Autodig",
      description:
        "Automatically dig into walls when able and moving into them.",
      control: "boolean",
      defaultValue: false,
    },
    {
      key: "cmdassist",
      label: "Command Assist",
      description: "Show extra help text when commands are mistyped.",
      control: "boolean",
      defaultValue: true,
    },
    {
      key: "confirm",
      label: "Confirm Attacks",
      description: "Ask before attacking peaceful creatures.",
      control: "boolean",
      defaultValue: true,
    },
    {
      key: "safe_pet",
      label: "Safe Pet",
      description: "Ask before hitting your pet.",
      control: "boolean",
      defaultValue: true,
    },
    {
      key: "help",
      label: "In-Game Help",
      description:
        "Prompt to show extra look/help details when more information exists.",
      control: "boolean",
      defaultValue: true,
    },
    {
      key: "legacy",
      label: "Legacy Intro",
      description: "Show the story intro when a new game begins.",
      control: "boolean",
      defaultValue: true,
    },
    {
      key: "rest_on_space",
      label: "Rest On Space",
      description: "Treat space key as wait/rest.",
      control: "boolean",
      defaultValue: false,
    },
    {
      key: "pushweapon",
      label: "Push Weapon",
      description: "Move currently wielded weapon to offhand when swapping.",
      control: "boolean",
      defaultValue: false,
    },
    {
      key: "extmenu",
      label: "Extended Command Menu",
      description: "Use a menu popup for extended commands.",
      control: "boolean",
      defaultValue: false,
    },
    {
      key: "fixinv",
      label: "Fix Inventory Letters",
      description: "Try to preserve inventory letters as items move.",
      control: "boolean",
      defaultValue: true,
    },
    {
      key: "implicit_uncursed",
      label: "Show Uncursed",
      description:
        "Always include the word 'uncursed' in inventory descriptions.",
      control: "boolean",
      defaultValue: true,
    },
    {
      key: "mention_walls",
      label: "Mention Walls",
      description: "Show a message when moving against a wall.",
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
      label: "Sort Loot Lists",
      description: "Sorting behavior for pickup and inventory selection lists.",
      control: "select",
      defaultValue: "l",
      options: [
        { value: "f", label: "Full" },
        { value: "l", label: "Loot-only" },
        { value: "n", label: "None" },
      ],
    },
    {
      key: "sortpack",
      label: "Sort Inventory",
      description: "Sort pack contents by type when showing inventory.",
      control: "boolean",
      defaultValue: true,
    },
    {
      key: "msghistory",
      label: "Message History Size",
      description: "Number of top-line messages retained for recall.",
      control: "number",
      defaultValue: 20,
      min: 20,
      max: 500,
      step: 1,
    },
    {
      key: "dogname",
      label: "Dog Name",
      description: "Default name for your first dog.",
      control: "text",
      defaultValue: "",
      maxLength: 30,
      placeholder: "Fido",
    },
    {
      key: "catname",
      label: "Cat Name",
      description: "Default name for your first cat.",
      control: "text",
      defaultValue: "",
      maxLength: 30,
      placeholder: "Morris",
    },
    {
      key: "horsename",
      label: "Horse Name",
      description: "Default name for your first horse.",
      control: "text",
      defaultValue: "",
      maxLength: 30,
      placeholder: "Silver",
    },
    {
      key: "pettype",
      label: "Preferred Pet",
      description: "Preferred initial pet type for roles that can vary.",
      control: "select",
      defaultValue: "",
      options: [
        { value: "", label: "Game default" },
        { value: "cat", label: "Cat" },
        { value: "dog", label: "Dog" },
        { value: "horse", label: "Horse" },
        { value: "none", label: "None" },
      ],
    },
    {
      key: "fruit",
      label: "Preferred Fruit",
      description: "Name of the fruit type your character enjoys.",
      control: "text",
      defaultValue: "",
      maxLength: 31,
      placeholder: "slime mold",
    },
    {
      key: "packorder",
      label: "Pack Order",
      description: "Order of item classes shown in inventory.",
      control: "text",
      defaultValue: "",
      maxLength: 20,
      placeholder: '")[%?+/=!(*0_`',
    },
    {
      key: "paranoid_confirmation",
      label: "Paranoid Confirmation",
      description:
        "Space-separated extra confirmations (example: confirm quit attack pray).",
      control: "text",
      defaultValue: "",
      maxLength: 64,
      placeholder: "confirm quit attack pray",
    },
    {
      key: "sparkle",
      label: "Magic Resistance Sparkle",
      description: "Show special sparkle effects for magic resistance.",
      control: "boolean",
      defaultValue: true,
    },
    {
      key: "standout",
      label: "Standout Monsters/More",
      description: "Bold monsters and --More-- prompts.",
      control: "boolean",
      defaultValue: false,
    },
    {
      key: "tombstone",
      label: "Tombstone",
      description: "Show tombstone graphic at death.",
      control: "boolean",
      defaultValue: true,
    },
    {
      key: "verbose",
      label: "Verbose Messages",
      description: "Use fuller status and action message wording.",
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

const requiredStartupInitOptionTokens: ReadonlyArray<string> = [
  "getpos.autodescribe:nothing",
];

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
