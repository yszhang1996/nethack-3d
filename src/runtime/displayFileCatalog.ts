type DisplayFileMetadata = {
  canonicalName: string;
  title: string;
};

const catalog: Record<string, DisplayFileMetadata> = {
  cmdhelp: {
    canonicalName: "cmdhelp",
    title: "Command Help",
  },
  help: {
    canonicalName: "help",
    title: "NetHack Help",
  },
  hh: {
    canonicalName: "hh",
    title: "NetHack Help",
  },
  history: {
    canonicalName: "history",
    title: "NetHack History",
  },
  keyhelp: {
    canonicalName: "keyhelp",
    title: "Key Help",
  },
  license: {
    canonicalName: "license",
    title: "NetHack License",
  },
  opthelp: {
    canonicalName: "opthelp",
    title: "Option Help",
  },
  wizhelp: {
    canonicalName: "wizhelp",
    title: "Wizard Help",
  },
  porthelp: {
    canonicalName: "porthelp",
    title: "Port Help",
  },
};

const aliases: Record<string, string> = {
  shelp: "cmdhelp",
  help: "help",
  history: "history",
  keyhelp: "keyhelp",
  optionfile: "opthelp",
  wizhelp: "wizhelp",
  license: "license",
  port_help: "porthelp",
};

function normalizeDisplayFileName(nameLike: unknown): string {
  const raw = typeof nameLike === "string" ? nameLike : String(nameLike ?? "");
  return raw.trim().toLowerCase();
}

export function resolveDisplayFileMetadata(
  fileName: unknown,
): DisplayFileMetadata | null {
  const normalizedName = normalizeDisplayFileName(fileName);
  if (!normalizedName) {
    return null;
  }

  const canonicalName = aliases[normalizedName] || normalizedName;
  const entry = catalog[canonicalName];
  if (!entry) {
    return {
      canonicalName,
      title: "NetHack Information",
    };
  }

  return entry;
}
