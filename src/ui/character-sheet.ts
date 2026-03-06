import type { InfoMenuState } from "../game/ui-types";

export type CharacterSheetSectionId =
  | "background"
  | "basics"
  | "characteristics"
  | "status"
  | "attributes"
  | "misc";

export type CharacterSheetSection = {
  id: CharacterSheetSectionId;
  title: string;
  lines: string[];
};

export type CharacterSheetStatKey =
  | "strength"
  | "dexterity"
  | "constitution"
  | "intelligence"
  | "wisdom"
  | "charisma";

export type CharacterSheetStat = {
  id: CharacterSheetStatKey;
  label: string;
  rawValue: string | null;
  currentValue: string | null;
  limitValue: string | null;
};

export type CharacterSheetData = {
  title: string;
  sections: CharacterSheetSection[];
  extraSections: CharacterSheetSection[];
  backgroundLines: string[];
  basicsLines: string[];
  characteristicsLines: string[];
  statusLines: string[];
  attributeLines: string[];
  identityLine: string | null;
  alignmentLine: string | null;
  locationLine: string | null;
  timelineLine: string | null;
  worldStateLine: string | null;
  experienceLine: string | null;
  scoreLine: string | null;
  hitPointsLine: string | null;
  energyLine: string | null;
  armorClassLine: string | null;
  walletLine: string | null;
  autopickupLine: string | null;
  statEntries: CharacterSheetStat[];
};

const sectionTitleById: Record<
  Exclude<CharacterSheetSectionId, "misc">,
  string
> = {
  background: "Background",
  basics: "Basics",
  characteristics: "Current Characteristics",
  status: "Current Status",
  attributes: "Current Attributes",
};

const sectionIdByHeading: Record<string, CharacterSheetSectionId> = {
  background: "background",
  basics: "basics",
  "current characteristics": "characteristics",
  "current status": "status",
  "current attributes": "attributes",
};

const orderedPrimarySectionIds: Exclude<CharacterSheetSectionId, "misc">[] = [
  "background",
  "basics",
  "characteristics",
  "status",
  "attributes",
];

function normalizeInfoLine(rawLine: unknown): string {
  return String(rawLine || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitCharacterSections(lines: string[]): CharacterSheetSection[] {
  const sections: CharacterSheetSection[] = [];
  let currentSection: CharacterSheetSection | null = null;

  const ensureOverviewSection = (): CharacterSheetSection => {
    if (currentSection) {
      return currentSection;
    }
    const overviewSection: CharacterSheetSection = {
      id: "misc",
      title: "Overview",
      lines: [],
    };
    sections.push(overviewSection);
    currentSection = overviewSection;
    return overviewSection;
  };

  for (const rawLine of lines) {
    const line = normalizeInfoLine(rawLine);
    if (!line) {
      continue;
    }

    const headingMatch = line.match(/^([A-Za-z][A-Za-z ]+):$/);
    if (headingMatch && headingMatch[1]) {
      const rawHeading = headingMatch[1].trim();
      const normalizedHeading = rawHeading.toLowerCase();
      const id = sectionIdByHeading[normalizedHeading] ?? "misc";
      const section: CharacterSheetSection = {
        id,
        title:
          id === "misc"
            ? rawHeading
            : sectionTitleById[id as Exclude<CharacterSheetSectionId, "misc">],
        lines: [],
      };
      sections.push(section);
      currentSection = section;
      continue;
    }

    ensureOverviewSection().lines.push(line);
  }

  return sections.filter((section) => section.lines.length > 0);
}

function getSectionLinesById(
  sections: CharacterSheetSection[],
  id: CharacterSheetSectionId,
): string[] {
  return sections
    .filter((section) => section.id === id)
    .flatMap((section) => section.lines);
}

function findFirstLine(
  lines: string[],
  predicate: (line: string) => boolean,
): string | null {
  for (const line of lines) {
    if (predicate(line)) {
      return line;
    }
  }
  return null;
}

function extractStatValue(lines: string[], statName: string): string | null {
  const pattern = new RegExp(`^Your ${statName} is (.+?)(?:\\.|$)`, "i");
  for (const line of lines) {
    const match = line.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function parseStatCurrentAndLimit(value: string): {
  currentValue: string | null;
  limitValue: string | null;
} {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return { currentValue: null, limitValue: null };
  }

  const currentLimitMatch = normalized.match(
    /^(.+?)\s*\(\s*current\s*;\s*limit\s*:?\s*([^)]+)\)\s*$/i,
  );
  if (currentLimitMatch) {
    return {
      currentValue: currentLimitMatch[1]?.trim() || null,
      limitValue: currentLimitMatch[2]?.trim() || null,
    };
  }

  return {
    currentValue: normalized,
    limitValue: null,
  };
}

function extractCharacterStat(
  lines: string[],
  id: CharacterSheetStatKey,
  label: string,
): CharacterSheetStat {
  const rawValue = extractStatValue(lines, id);
  const { currentValue, limitValue } = parseStatCurrentAndLimit(rawValue || "");
  return {
    id,
    label,
    rawValue,
    currentValue,
    limitValue,
  };
}

export function parseCharacterSheetInfoMenu(
  infoMenu: InfoMenuState | null,
): CharacterSheetData | null {
  if (!infoMenu || !Array.isArray(infoMenu.lines)) {
    return null;
  }

  const normalizedTitle = normalizeInfoLine(infoMenu.title).toLowerCase();
  const normalizedLines = infoMenu.lines
    .map((line) => normalizeInfoLine(line))
    .filter((line) => line.length > 0);

  if (normalizedLines.length === 0) {
    return null;
  }

  const allText = normalizedLines.join("\n").toLowerCase();
  const hasKnownAttributeHeading =
    allText.includes("background:") ||
    allText.includes("basics:") ||
    allText.includes("current characteristics:") ||
    allText.includes("current status:") ||
    allText.includes("current attributes:");
  const hasCoreStats =
    allText.includes("your strength is") &&
    allText.includes("your dexterity is") &&
    allText.includes("your constitution is");
  const hasCharacterIdentitySignals =
    allText.includes("you are ") &&
    (allText.includes("armor class") ||
      allText.includes("experience points") ||
      allText.includes("dungeon"));
  const titleSuggestsCharacterSheet =
    normalizedTitle.includes("attribute") ||
    normalizedTitle.includes("character");

  if (
    !hasKnownAttributeHeading &&
    !(hasCoreStats && hasCharacterIdentitySignals) &&
    !(titleSuggestsCharacterSheet && hasCoreStats)
  ) {
    return null;
  }

  const splitSections = splitCharacterSections(normalizedLines);
  const backgroundLines = getSectionLinesById(splitSections, "background");
  const basicsLines = getSectionLinesById(splitSections, "basics");
  const characteristicsLines = getSectionLinesById(
    splitSections,
    "characteristics",
  );
  const statusLines = getSectionLinesById(splitSections, "status");
  const attributeLines = getSectionLinesById(splitSections, "attributes");

  const backgroundOrAllLines =
    backgroundLines.length > 0 ? backgroundLines : normalizedLines;
  const basicsOrAllLines =
    basicsLines.length > 0 ? basicsLines : normalizedLines;
  const characteristicOrAllLines =
    characteristicsLines.length > 0 ? characteristicsLines : normalizedLines;

  const identityLine = findFirstLine(backgroundOrAllLines, (line) =>
    /^You are (?:a|an|the) /i.test(line),
  );
  const alignmentLine = findFirstLine(backgroundOrAllLines, (line) =>
    /on a mission for/i.test(line),
  );
  const locationLine = findFirstLine(backgroundOrAllLines, (line) =>
    /^You are in the /i.test(line),
  );
  const timelineLine = findFirstLine(backgroundOrAllLines, (line) =>
    /^You entered the dungeon /i.test(line),
  );
  const worldStateLine = findFirstLine(backgroundOrAllLines, (line) =>
    /(in effect|full moon|new moon)/i.test(line),
  );
  const experienceLine = findFirstLine(backgroundOrAllLines, (line) =>
    /experience points/i.test(line),
  );
  const scoreLine = findFirstLine(backgroundOrAllLines, (line) =>
    /^Your score is /i.test(line),
  );

  const hitPointsLine = findFirstLine(basicsOrAllLines, (line) =>
    /hit points/i.test(line),
  );
  const energyLine = findFirstLine(basicsOrAllLines, (line) =>
    /(energy points|spell power)/i.test(line),
  );
  const armorClassLine = findFirstLine(basicsOrAllLines, (line) =>
    /armor class/i.test(line),
  );
  const walletLine = findFirstLine(basicsOrAllLines, (line) =>
    /wallet/i.test(line),
  );
  const autopickupLine = findFirstLine(basicsOrAllLines, (line) =>
    /autopickup/i.test(line),
  );

  const statEntries: CharacterSheetStat[] = [
    extractCharacterStat(characteristicOrAllLines, "strength", "Strength"),
    extractCharacterStat(characteristicOrAllLines, "dexterity", "Dexterity"),
    extractCharacterStat(
      characteristicOrAllLines,
      "constitution",
      "Constitution",
    ),
    extractCharacterStat(
      characteristicOrAllLines,
      "intelligence",
      "Intelligence",
    ),
    extractCharacterStat(characteristicOrAllLines, "wisdom", "Wisdom"),
    extractCharacterStat(characteristicOrAllLines, "charisma", "Charisma"),
  ];

  const primarySections: CharacterSheetSection[] = [];
  for (const id of orderedPrimarySectionIds) {
    const lines = getSectionLinesById(splitSections, id);
    if (lines.length === 0) {
      continue;
    }
    primarySections.push({
      id,
      title: sectionTitleById[id],
      lines,
    });
  }

  const extraSections = splitSections.filter(
    (section) => section.id === "misc",
  );

  return {
    title: normalizeInfoLine(infoMenu.title) || "Character Sheet",
    sections: primarySections,
    extraSections,
    backgroundLines,
    basicsLines,
    characteristicsLines,
    statusLines,
    attributeLines,
    identityLine,
    alignmentLine,
    locationLine,
    timelineLine,
    worldStateLine,
    experienceLine,
    scoreLine,
    hitPointsLine,
    energyLine,
    armorClassLine,
    walletLine,
    autopickupLine,
    statEntries,
  };
}

export type CharacterCommandAction = {
  id: string;
  command: string;
  label: string;
  detail: string;
};

const characterCommandCatalog: readonly CharacterCommandAction[] = [
  {
    id: "enhance",
    command: "enhance",
    label: "Enhance",
    detail: "Level up skills",
  },
  {
    id: "conduct",
    command: "conduct",
    label: "Conduct",
    detail: "Show challenge progress",
  },
  {
    id: "overview",
    command: "overview",
    label: "Overview",
    detail: "Show dungeon progress",
  },
  {
    id: "spells",
    command: "spells",
    label: "Spells",
    detail: "Review known spells",
  },
  {
    id: "seespells",
    command: "seespells",
    label: "Spellbook",
    detail: "List spell inventory",
  },
  {
    id: "known",
    command: "known",
    label: "Discoveries",
    detail: "Known object list",
  },
  {
    id: "pray",
    command: "pray",
    label: "Pray",
    detail: "Attempt prayer",
  },
];

export function resolveCharacterCommandActions(
  availableExtendedCommands: readonly string[],
): CharacterCommandAction[] {
  const available = new Set<string>();
  for (const command of availableExtendedCommands) {
    const normalized = String(command || "")
      .trim()
      .toLowerCase();
    if (normalized) {
      available.add(normalized);
    }
  }

  return characterCommandCatalog.filter((entry) =>
    available.has(entry.command),
  );
}
