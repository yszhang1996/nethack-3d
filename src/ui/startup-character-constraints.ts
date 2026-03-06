export const startupRoleOptions = [
  "Archeologist",
  "Barbarian",
  "Caveman",
  "Healer",
  "Knight",
  "Monk",
  "Priest",
  "Ranger",
  "Rogue",
  "Samurai",
  "Tourist",
  "Valkyrie",
  "Wizard",
] as const;

export const startupRaceOptions = [
  "human",
  "elf",
  "dwarf",
  "gnome",
  "orc",
] as const;

export const startupGenderOptions = ["male", "female"] as const;

export const startupAlignOptions = ["lawful", "neutral", "chaotic"] as const;

export type StartupRole = (typeof startupRoleOptions)[number];
export type StartupRace = (typeof startupRaceOptions)[number];
export type StartupGender = (typeof startupGenderOptions)[number];
export type StartupAlign = (typeof startupAlignOptions)[number];

export type StartupCreateCharacterSelection = {
  role: StartupRole;
  race: StartupRace;
  gender: StartupGender;
  align: StartupAlign;
};

export type StartupCreateCharacterOptionSet = {
  roleOptions: readonly StartupRole[];
  raceOptions: StartupRace[];
  genderOptions: StartupGender[];
  alignOptions: StartupAlign[];
  selection: StartupCreateCharacterSelection;
};

type StartupRoleConstraint = {
  races: readonly StartupRace[];
  genders: readonly StartupGender[];
  aligns: readonly StartupAlign[];
};

// Mirrors role and race allow-masks from NetHack role tables:
// third_party/nethack-3.6.7/src/role.c (`roles[]` and `races[]`).
const startupRoleConstraints: Record<StartupRole, StartupRoleConstraint> = {
  Archeologist: {
    races: ["human", "dwarf", "gnome"],
    genders: ["male", "female"],
    aligns: ["lawful", "neutral"],
  },
  Barbarian: {
    races: ["human", "orc"],
    genders: ["male", "female"],
    aligns: ["neutral", "chaotic"],
  },
  Caveman: {
    races: ["human", "dwarf", "gnome"],
    genders: ["male", "female"],
    aligns: ["lawful", "neutral"],
  },
  Healer: {
    races: ["human", "gnome"],
    genders: ["male", "female"],
    aligns: ["neutral"],
  },
  Knight: {
    races: ["human"],
    genders: ["male", "female"],
    aligns: ["lawful"],
  },
  Monk: {
    races: ["human"],
    genders: ["male", "female"],
    aligns: ["lawful", "neutral", "chaotic"],
  },
  Priest: {
    races: ["human", "elf"],
    genders: ["male", "female"],
    aligns: ["lawful", "neutral", "chaotic"],
  },
  Ranger: {
    races: ["human", "orc"],
    genders: ["male", "female"],
    aligns: ["chaotic"],
  },
  Rogue: {
    races: ["human", "elf", "gnome", "orc"],
    genders: ["male", "female"],
    aligns: ["neutral", "chaotic"],
  },
  Samurai: {
    races: ["human"],
    genders: ["male", "female"],
    aligns: ["lawful"],
  },
  Tourist: {
    races: ["human"],
    genders: ["male", "female"],
    aligns: ["neutral"],
  },
  Valkyrie: {
    races: ["human", "dwarf"],
    genders: ["female"],
    aligns: ["lawful", "neutral"],
  },
  Wizard: {
    races: ["human", "elf", "gnome", "orc"],
    genders: ["male", "female"],
    aligns: ["neutral", "chaotic"],
  },
};

const startupRaceGenderConstraints: Record<StartupRace, readonly StartupGender[]> = {
  human: ["male", "female"],
  elf: ["male", "female"],
  dwarf: ["male", "female"],
  gnome: ["male", "female"],
  orc: ["male", "female"],
};

const startupRaceAlignConstraints: Record<StartupRace, readonly StartupAlign[]> = {
  human: ["lawful", "neutral", "chaotic"],
  elf: ["chaotic"],
  dwarf: ["lawful"],
  gnome: ["neutral"],
  orc: ["chaotic"],
};

function normalizeOption<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  fallbackValue: T,
): T {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized) {
    const matchedValue = allowedValues.find(
      (candidate) => candidate.toLowerCase() === normalized,
    );
    if (matchedValue) {
      return matchedValue;
    }
  }
  return fallbackValue;
}

function intersectAllowedValues<T extends string>(
  preferredOrder: readonly T[],
  ...allowedGroups: readonly (readonly T[])[]
): T[] {
  if (allowedGroups.length === 0) {
    return [...preferredOrder];
  }
  return preferredOrder.filter((candidate) =>
    allowedGroups.every((group) => group.includes(candidate)),
  );
}

function pickRandomItem<T extends string>(
  options: readonly T[],
  fallback: T,
): T {
  if (options.length === 0) {
    return fallback;
  }
  const randomIndex = Math.floor(Math.random() * options.length);
  return options[randomIndex] ?? fallback;
}

export function resolveStartupCreateCharacterOptionSet(rawSelection: {
  role?: unknown;
  race?: unknown;
  gender?: unknown;
  align?: unknown;
}): StartupCreateCharacterOptionSet {
  const defaultRole = startupRoleOptions[0] ?? "Archeologist";
  const role = normalizeOption(rawSelection.role, startupRoleOptions, defaultRole);
  const roleConstraint = startupRoleConstraints[role];

  const raceOptions = [...roleConstraint.races];
  const defaultRace = raceOptions[0] ?? startupRaceOptions[0] ?? "human";
  const race = normalizeOption(rawSelection.race, raceOptions, defaultRace);

  const raceGenders =
    startupRaceGenderConstraints[race] ?? startupGenderOptions;
  const genderOptions = intersectAllowedValues(
    startupGenderOptions,
    roleConstraint.genders,
    raceGenders,
  );
  const defaultGender = genderOptions[0] ?? startupGenderOptions[0] ?? "male";
  const gender = normalizeOption(rawSelection.gender, genderOptions, defaultGender);

  const raceAligns =
    startupRaceAlignConstraints[race] ?? startupAlignOptions;
  const alignOptions = intersectAllowedValues(
    startupAlignOptions,
    roleConstraint.aligns,
    raceAligns,
  );
  const defaultAlign = alignOptions[0] ?? startupAlignOptions[0] ?? "lawful";
  const align = normalizeOption(rawSelection.align, alignOptions, defaultAlign);

  return {
    roleOptions: startupRoleOptions,
    raceOptions,
    genderOptions,
    alignOptions,
    selection: {
      role,
      race,
      gender,
      align,
    },
  };
}

export function normalizeStartupCreateCharacterSelection(rawSelection: {
  role?: unknown;
  race?: unknown;
  gender?: unknown;
  align?: unknown;
}): StartupCreateCharacterSelection {
  return resolveStartupCreateCharacterOptionSet(rawSelection).selection;
}

export function pickRandomStartupRole(): StartupRole {
  return pickRandomItem(startupRoleOptions, startupRoleOptions[0] ?? "Archeologist");
}

export function pickRandomStartupGenderForRole(role: unknown): StartupGender {
  const optionSet = resolveStartupCreateCharacterOptionSet({ role });
  return pickRandomItem(
    optionSet.genderOptions,
    startupGenderOptions[0] ?? "male",
  );
}
