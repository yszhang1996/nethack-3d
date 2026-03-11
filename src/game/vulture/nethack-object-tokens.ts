import objectsSource367 from "../../../imported/nethack-3.6.7/src/objects.c?raw";

type ParsedCall = {
  macro: string;
  args: string[];
};

type ObjectClassKey =
  | "ILLOBJ"
  | "WEAPON"
  | "ARMOR"
  | "RING"
  | "AMULET"
  | "TOOL"
  | "FOOD"
  | "POTION"
  | "SCROLL"
  | "SPBOOK"
  | "WAND"
  | "COIN"
  | "GEM"
  | "ROCK"
  | "BALL"
  | "CHAIN"
  | "VENOM";

const objectClassByMacro: Readonly<Record<string, ObjectClassKey>> = {
  PROJECTILE: "WEAPON",
  WEAPON: "WEAPON",
  BOW: "WEAPON",
  HELM: "ARMOR",
  ARMOR: "ARMOR",
  CLOAK: "ARMOR",
  SHIELD: "ARMOR",
  GLOVES: "ARMOR",
  BOOTS: "ARMOR",
  DRGN_ARMR: "ARMOR",
  RING: "RING",
  AMULET: "AMULET",
  TOOL: "TOOL",
  WEPTOOL: "TOOL",
  CONTAINER: "TOOL",
  FOOD: "FOOD",
  POTION: "POTION",
  SCROLL: "SCROLL",
  SPBOOK: "SPBOOK",
  SPELL: "SPBOOK",
  WAND: "WAND",
  COIN: "COIN",
  GEM: "GEM",
  ROCK: "ROCK",
  BALL: "BALL",
  CHAIN: "CHAIN",
  VENOM: "VENOM",
};

const objectClassByLiteral: Readonly<Record<string, ObjectClassKey>> = {
  ILLOBJ_CLASS: "ILLOBJ",
  WEAPON_CLASS: "WEAPON",
  ARMOR_CLASS: "ARMOR",
  RING_CLASS: "RING",
  AMULET_CLASS: "AMULET",
  TOOL_CLASS: "TOOL",
  FOOD_CLASS: "FOOD",
  POTION_CLASS: "POTION",
  SCROLL_CLASS: "SCROLL",
  SPBOOK_CLASS: "SPBOOK",
  WAND_CLASS: "WAND",
  COIN_CLASS: "COIN",
  GEM_CLASS: "GEM",
  ROCK_CLASS: "ROCK",
  BALL_CLASS: "BALL",
  CHAIN_CLASS: "CHAIN",
  VENOM_CLASS: "VENOM",
};

const unnamedPrefixByClass: Readonly<Record<ObjectClassKey, string>> = {
  ILLOBJ: "ILL",
  WEAPON: "WEA",
  ARMOR: "ARM",
  RING: "RIN",
  AMULET: "AMU",
  TOOL: "TOO",
  FOOD: "COM",
  POTION: "POT",
  SCROLL: "SCR",
  SPBOOK: "SPE",
  WAND: "WAN",
  COIN: "COI",
  GEM: "GEM",
  ROCK: "BOU",
  BALL: "IRO",
  CHAIN: "CHA",
  VENOM: "VEN",
};

function stripInactiveSourceBlocks(source: string): string {
  return String(source || "")
    .replace(/#if\s+0\b[\s\S]*?#endif/g, "")
    .replace(/#ifdef\s+MAIL\b[\s\S]*?#endif/g, "");
}

function skipTrivia(source: string, startIndex: number): number {
  let index = startIndex;
  while (index < source.length) {
    const ch = source[index];
    const next = source[index + 1];
    if (ch === "/" && next === "*") {
      index += 2;
      while (
        index < source.length &&
        !(source[index] === "*" && source[index + 1] === "/")
      ) {
        index += 1;
      }
      index += 2;
      continue;
    }
    if (ch === "/" && next === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") {
        index += 1;
      }
      continue;
    }
    if (ch === "#") {
      while (index < source.length && source[index] !== "\n") {
        index += 1;
      }
      continue;
    }
    if (/\s/.test(ch)) {
      index += 1;
      continue;
    }
    break;
  }
  return index;
}

function readIdentifier(
  source: string,
  startIndex: number,
): { value: string; nextIndex: number } | null {
  let index = startIndex;
  while (
    index < source.length &&
    /[A-Za-z0-9_]/.test(source.charAt(index))
  ) {
    index += 1;
  }
  if (index <= startIndex) {
    return null;
  }
  return {
    value: source.slice(startIndex, index),
    nextIndex: index,
  };
}

function readBalancedParens(
  source: string,
  openParenIndex: number,
): { inside: string; nextIndex: number } | null {
  if (source.charAt(openParenIndex) !== "(") {
    return null;
  }

  let index = openParenIndex;
  let depth = 0;
  let inString = false;
  let quoteChar = "";
  while (index < source.length) {
    const ch = source.charAt(index);
    const next = source.charAt(index + 1);
    if (inString) {
      if (ch === "\\") {
        index += 2;
        continue;
      }
      if (ch === quoteChar) {
        inString = false;
        quoteChar = "";
      }
      index += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quoteChar = ch;
      index += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      index += 2;
      while (
        index < source.length &&
        !(source.charAt(index) === "*" && source.charAt(index + 1) === "/")
      ) {
        index += 1;
      }
      index += 2;
      continue;
    }
    if (ch === "/" && next === "/") {
      index += 2;
      while (index < source.length && source.charAt(index) !== "\n") {
        index += 1;
      }
      continue;
    }
    if (ch === "(") {
      depth += 1;
      index += 1;
      continue;
    }
    if (ch === ")") {
      depth -= 1;
      index += 1;
      if (depth === 0) {
        return {
          inside: source.slice(openParenIndex + 1, index - 1),
          nextIndex: index,
        };
      }
      continue;
    }
    index += 1;
  }

  return null;
}

function splitTopLevelArgs(raw: string): string[] {
  const args: string[] = [];
  let current = "";
  let depth = 0;
  let inString = false;
  let quoteChar = "";
  for (let index = 0; index < raw.length; index += 1) {
    const ch = raw.charAt(index);
    if (inString) {
      current += ch;
      if (ch === "\\") {
        current += raw.charAt(index + 1);
        index += 1;
        continue;
      }
      if (ch === quoteChar) {
        inString = false;
        quoteChar = "";
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quoteChar = ch;
      current += ch;
      continue;
    }
    if (ch === "(") {
      depth += 1;
      current += ch;
      continue;
    }
    if (ch === ")") {
      depth = Math.max(0, depth - 1);
      current += ch;
      continue;
    }
    if (ch === "," && depth === 0) {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        args.push(trimmed);
      } else {
        args.push("");
      }
      current = "";
      continue;
    }
    current += ch;
  }
  const tail = current.trim();
  if (tail.length > 0) {
    args.push(tail);
  }
  return args;
}

function parseCStringLiteral(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^None$/i.test(trimmed)) {
    return null;
  }
  const match = trimmed.match(/^"((?:[^"\\]|\\.)*)"$/);
  if (!match) {
    return null;
  }
  return match[1]
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\");
}

function normalizeToken(raw: string): string {
  return String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function resolveObjectNameAndClass(
  call: ParsedCall,
): { classKey: ObjectClassKey; name: string | null } | null {
  if (call.macro === "OBJECT") {
    const classLiteral = (call.args[3] || "").trim();
    const classKey = objectClassByLiteral[classLiteral];
    if (!classKey) {
      return null;
    }
    const objArg = call.args[0] || "";
    const objMatch = objArg.match(/^OBJ\(([\s\S]*)\)$/);
    if (!objMatch) {
      return null;
    }
    const objArgs = splitTopLevelArgs(objMatch[1]);
    return {
      classKey,
      name: parseCStringLiteral(objArgs[0] || ""),
    };
  }

  const classKey = objectClassByMacro[call.macro];
  if (!classKey) {
    return null;
  }
  return {
    classKey,
    name: parseCStringLiteral(call.args[0] || ""),
  };
}

function resolveGlassGemToken(name: string): string {
  const match = name.match(/^worthless piece of (.+) glass$/i);
  if (!match) {
    return normalizeToken(name);
  }
  const colorName = match[1].toLowerCase();
  let colorToken = "WHITE";
  if (colorName.includes("blue")) {
    colorToken = "BLUE";
  } else if (colorName.includes("red")) {
    colorToken = "RED";
  } else if (colorName.includes("yellow") && colorName.includes("brown")) {
    colorToken = "BROWN";
  } else if (colorName.includes("brown")) {
    colorToken = "BROWN";
  } else if (colorName.includes("orange")) {
    colorToken = "ORANGE";
  } else if (colorName.includes("yellow")) {
    colorToken = "YELLOW";
  } else if (colorName.includes("black")) {
    colorToken = "BLACK";
  } else if (colorName.includes("green")) {
    colorToken = "GREEN";
  } else if (
    colorName.includes("violet") ||
    colorName.includes("magenta")
  ) {
    colorToken = "VIOLET";
  }
  return `GEM_${colorToken}_GLASS`;
}

function resolveObjectToken(
  classKey: ObjectClassKey,
  name: string | null,
  unnamedCounters: Record<string, number>,
): string {
  if (name === null) {
    const unnamedPrefix = unnamedPrefixByClass[classKey] || "OBJ";
    unnamedCounters[unnamedPrefix] = (unnamedCounters[unnamedPrefix] || 0) + 1;
    return `${unnamedPrefix}_UNNAMED_${unnamedCounters[unnamedPrefix]}`;
  }

  if (
    classKey === "AMULET" &&
    /cheap plastic imitation of the amulet of yendor/i.test(name)
  ) {
    return "FAKE_AMULET_OF_YENDOR";
  }

  if (classKey === "GEM") {
    return resolveGlassGemToken(name);
  }

  const normalized = normalizeToken(name);
  switch (classKey) {
    case "WAND":
      return `WAN_${normalized}`;
    case "RING":
      return `RIN_${normalized}`;
    case "POTION":
      return `POT_${normalized}`;
    case "SCROLL":
      return `SCR_${normalized}`;
    case "SPBOOK":
      return `SPE_${normalized}`;
    default:
      return normalized;
  }
}

function parseObjectCalls(source: string): ParsedCall[] {
  const tableHeaderMatch = source.match(
    /^\s*(?:NEARDATA\s+)?struct\s+objclass\s+objects\s*\[\s*\]\s*=/m,
  );
  if (!tableHeaderMatch || typeof tableHeaderMatch.index !== "number") {
    return [];
  }

  const openBraceIndex = source.indexOf(
    "{",
    tableHeaderMatch.index + tableHeaderMatch[0].length,
  );
  if (openBraceIndex < 0) {
    return [];
  }

  let closeBraceIndex = -1;
  let braceDepth = 0;
  for (let index = openBraceIndex; index < source.length; index += 1) {
    const ch = source.charAt(index);
    if (ch === "{") {
      braceDepth += 1;
    } else if (ch === "}") {
      braceDepth -= 1;
      if (braceDepth === 0) {
        closeBraceIndex = index;
        break;
      }
    }
  }
  if (closeBraceIndex <= openBraceIndex) {
    return [];
  }

  const tableBody = stripInactiveSourceBlocks(
    source.slice(openBraceIndex + 1, closeBraceIndex),
  );
  const calls: ParsedCall[] = [];
  let index = 0;
  while (index < tableBody.length) {
    index = skipTrivia(tableBody, index);
    if (index >= tableBody.length) {
      break;
    }

    const identifier = readIdentifier(tableBody, index);
    if (!identifier) {
      index += 1;
      continue;
    }

    const afterIdent = skipTrivia(tableBody, identifier.nextIndex);
    if (tableBody.charAt(afterIdent) !== "(") {
      index = identifier.nextIndex;
      continue;
    }

    const balanced = readBalancedParens(tableBody, afterIdent);
    if (!balanced) {
      break;
    }
    const afterCall = skipTrivia(tableBody, balanced.nextIndex);
    if (tableBody.charAt(afterCall) !== ",") {
      index = balanced.nextIndex;
      continue;
    }

    calls.push({
      macro: identifier.value,
      args: splitTopLevelArgs(balanced.inside),
    });
    index = afterCall + 1;
  }
  return calls;
}

function parseObjectTokensFromSource(source: string): string[] {
  const calls = parseObjectCalls(source);
  const tokens: string[] = [];
  const unnamedCounters: Record<string, number> = {};
  for (const call of calls) {
    const resolved = resolveObjectNameAndClass(call);
    if (!resolved) {
      continue;
    }
    tokens.push(
      resolveObjectToken(resolved.classKey, resolved.name, unnamedCounters),
    );
  }
  return tokens;
}

export const NETHACK_367_OBJECT_TOKENS: ReadonlyArray<string> = (() => {
  const parsed = parseObjectTokensFromSource(objectsSource367);
  if (parsed.length !== 453) {
    console.warn(
      `Unexpected NetHack 3.6.7 object token count: expected 453, got ${parsed.length}.`,
    );
  }
  return parsed;
})();
