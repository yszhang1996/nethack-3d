import type { NethackMenuItem } from "../../game/ui-types";

export type EnhanceSkillAvailability =
  | "available_now"
  | "needs_experience"
  | "needs_practice"
  | "maxed_out";

export type EnhanceSkillEntry = {
  id: string;
  category: string;
  name: string;
  currentRank: string;
  nextRank: string | null;
  slotCostForNextRank: number | null;
  availability: EnhanceSkillAvailability;
  availabilityLabel: string;
  menuItem: NethackMenuItem;
};

export type EnhanceSkillGroup = {
  id: string;
  title: string;
  entries: EnhanceSkillEntry[];
};

export type EnhanceMenuData = {
  prompt: string;
  legendLines: string[];
  groups: EnhanceSkillGroup[];
  showSlotCost: boolean;
  availableCount: number;
  needsExperienceCount: number;
  needsPracticeCount: number;
  maxedOutCount: number;
};

const knownEnhanceCategoryTitles = new Set([
  "fighting skills",
  "weapon skills",
  "spellcasting skills",
]);

const skillRankByValue: Record<number, string> = {
  1: "Unskilled",
  2: "Basic",
  3: "Skilled",
  4: "Expert",
  5: "Master",
  6: "Grand Master",
};

const skillRankValueByName: Record<string, number> = Object.entries(
  skillRankByValue,
).reduce<Record<string, number>>((acc, [value, label]) => {
  acc[normalizeToken(label)] = Number(value);
  return acc;
}, {});

function normalizeToken(rawValue: unknown): string {
  return String(rawValue || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");
}

function normalizeMenuLine(rawLine: unknown): string {
  return String(rawLine || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLegendLine(rawLine: string): string {
  return normalizeMenuLine(rawLine)
    .replace(/^\(\s*/, "")
    .replace(/\s*\)\.?\s*$/, "")
    .trim();
}

function slugify(value: string): string {
  return normalizeToken(value).replace(/[^a-z0-9]+/g, "-");
}

function toTitleCase(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

function parseSkillRow(
  menuText: string,
): { marker: "*" | "#" | null; name: string; rank: string } | null {
  const normalized = String(menuText || "");
  const match = normalized.match(
    /^\s*(?:([*#])\s+)?(.+?)\s+\[([^\]]+)\]\s*$/,
  );
  if (!match || !match[2] || !match[3]) {
    return null;
  }
  const marker = match[1] === "*" || match[1] === "#" ? match[1] : null;
  const name = toTitleCase(normalizeMenuLine(match[2]));
  const rank = normalizeMenuLine(match[3]);
  if (!name || !rank) {
    return null;
  }
  return { marker, name, rank };
}

function isMenuItemSelectable(item: NethackMenuItem): boolean {
  if (!item || item.isCategory) {
    return false;
  }
  if (typeof item.isSelectable === "boolean") {
    return item.isSelectable;
  }
  if (typeof item.identifier === "number") {
    return item.identifier !== 0;
  }
  if (Number.isInteger(item.menuIndex)) {
    return true;
  }
  return (
    typeof item.accelerator === "string" && item.accelerator.trim().length > 0
  );
}

function resolveAvailabilityLabel(state: EnhanceSkillAvailability): string {
  switch (state) {
    case "available_now":
      return "可提升";
    case "needs_experience":
      return "经验/槽位";
    case "maxed_out":
      return "已满级";
    case "needs_practice":
    default:
      return "需练习";
  }
}

function resolveNextRank(currentRank: string): string | null {
  const rankValue = skillRankValueByName[normalizeToken(currentRank)];
  if (!Number.isFinite(rankValue) || rankValue >= 6) {
    return null;
  }
  return skillRankByValue[rankValue + 1] || null;
}

function usesReducedSlotFormula(categoryTitle: string, skillName: string): boolean {
  const category = normalizeToken(categoryTitle);
  if (category === "spellcasting skills") {
    return true;
  }
  if (category === "weapon skills") {
    return false;
  }
  if (category === "fighting skills") {
    return normalizeToken(skillName) !== "two weapon combat";
  }
  // Fallback mirrors NetHack behavior for "other" non-weapon skills.
  return true;
}

function resolveSlotCostForNextRank(
  categoryTitle: string,
  skillName: string,
  currentRank: string,
  availability: EnhanceSkillAvailability,
): number | null {
  if (availability === "maxed_out") {
    return null;
  }
  const rankValue = skillRankValueByName[normalizeToken(currentRank)];
  if (!Number.isFinite(rankValue) || rankValue < 1) {
    return null;
  }
  if (usesReducedSlotFormula(categoryTitle, skillName)) {
    return Math.floor((rankValue + 1) / 2);
  }
  return rankValue;
}

export function parseEnhanceMenu(
  questionText: string,
  menuItems: NethackMenuItem[],
): EnhanceMenuData | null {
  const prompt = normalizeMenuLine(questionText);
  const normalizedPrompt = normalizeToken(prompt);
  const looksLikeEnhancePrompt =
    normalizedPrompt.includes("pick a skill to advance") ||
    normalizedPrompt.includes("current skills");
  if (!looksLikeEnhancePrompt || !Array.isArray(menuItems)) {
    return null;
  }

  let currentCategoryTitle = "技能";
  const groupsByTitle = new Map<string, EnhanceSkillGroup>();
  const groupOrder: string[] = [];
  const legendLines: string[] = [];

  const ensureGroup = (title: string): EnhanceSkillGroup => {
    const normalizedTitle = normalizeMenuLine(title) || "技能";
    if (!groupsByTitle.has(normalizedTitle)) {
      groupsByTitle.set(normalizedTitle, {
        id: slugify(normalizedTitle),
        title: normalizedTitle,
        entries: [],
      });
      groupOrder.push(normalizedTitle);
    }
    return groupsByTitle.get(normalizedTitle)!;
  };

  for (let index = 0; index < menuItems.length; index += 1) {
    const menuItem = menuItems[index];
    const line = normalizeMenuLine(menuItem?.text);
    if (!line) {
      continue;
    }

    const normalizedLine = normalizeToken(line);
    if (menuItem?.isCategory || knownEnhanceCategoryTitles.has(normalizedLine)) {
      currentCategoryTitle = line;
      ensureGroup(currentCategoryTitle);
      continue;
    }

    if (line.startsWith("(Skill") || line.startsWith("(skill")) {
      const cleanedLegend = normalizeLegendLine(line);
      legendLines.push(cleanedLegend);
      continue;
    }

    const parsedRow = parseSkillRow(String(menuItem?.text || ""));
    if (!parsedRow) {
      continue;
    }

    const selectable = isMenuItemSelectable(menuItem);
    const availability: EnhanceSkillAvailability = selectable
      ? "available_now"
      : parsedRow.marker === "*"
        ? "needs_experience"
        : parsedRow.marker === "#"
          ? "maxed_out"
          : "needs_practice";
    const nextRank =
      availability === "maxed_out" ? null : resolveNextRank(parsedRow.rank);
    const slotCostForNextRank = resolveSlotCostForNextRank(
      currentCategoryTitle,
      parsedRow.name,
      parsedRow.rank,
      availability,
    );

    const group = ensureGroup(currentCategoryTitle);
    group.entries.push({
      id: `${group.id}-${slugify(parsedRow.name)}-${index}`,
      category: group.title,
      name: parsedRow.name,
      currentRank: parsedRow.rank,
      nextRank,
      slotCostForNextRank,
      availability,
      availabilityLabel: resolveAvailabilityLabel(availability),
      menuItem,
    });
  }

  const groups = groupOrder
    .map((title) => groupsByTitle.get(title))
    .filter((group): group is EnhanceSkillGroup => Boolean(group))
    .filter((group) => group.entries.length > 0);

  if (groups.length === 0) {
    return null;
  }

  const entries = groups.flatMap((group) => group.entries);
  const uniqueSlotCosts = new Set<number>(
    entries
      .map((entry) => entry.slotCostForNextRank)
      .filter(
        (slotCost): slotCost is number =>
          typeof slotCost === "number" &&
          Number.isFinite(slotCost) &&
          slotCost > 0,
      ),
  );
  const showSlotCost = uniqueSlotCosts.size > 1;
  const availableCount = entries.filter(
    (entry) => entry.availability === "available_now",
  ).length;
  const needsExperienceCount = entries.filter(
    (entry) => entry.availability === "needs_experience",
  ).length;
  const needsPracticeCount = entries.filter(
    (entry) => entry.availability === "needs_practice",
  ).length;
  const maxedOutCount = entries.filter(
    (entry) => entry.availability === "maxed_out",
  ).length;

  return {
    prompt,
    legendLines,
    groups,
    showSlotCost,
    availableCount,
    needsExperienceCount,
    needsPracticeCount,
    maxedOutCount,
  };
}
