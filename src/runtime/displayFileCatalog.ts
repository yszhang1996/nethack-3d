import cmdhelpText from "../../third_party/nethack-3.6.7/dat/cmdhelp?raw";
import helpText from "../../third_party/nethack-3.6.7/dat/help?raw";
import hhText from "../../third_party/nethack-3.6.7/dat/hh?raw";
import historyText from "../../third_party/nethack-3.6.7/dat/history?raw";
import keyhelpText from "../../third_party/nethack-3.6.7/dat/keyhelp?raw";
import licenseText from "../../third_party/nethack-3.6.7/dat/license?raw";
import opthelpText from "../../third_party/nethack-3.6.7/dat/opthelp?raw";
import wizhelpText from "../../third_party/nethack-3.6.7/dat/wizhelp?raw";
import portHelpText from "../../third_party/nethack-3.6.7/sys/winnt/porthelp?raw";

type DisplayFilePayload = {
  canonicalName: string;
  title: string;
  lines: string[];
};

type CatalogEntry = {
  title: string;
  text: string;
};

const catalog: Record<string, CatalogEntry> = {
  cmdhelp: {
    title: "Command Help",
    text: cmdhelpText,
  },
  help: {
    title: "NetHack Help",
    text: helpText,
  },
  hh: {
    title: "NetHack Help",
    text: hhText,
  },
  history: {
    title: "NetHack History",
    text: historyText,
  },
  keyhelp: {
    title: "Key Help",
    text: keyhelpText,
  },
  license: {
    title: "NetHack License",
    text: licenseText,
  },
  opthelp: {
    title: "Option Help",
    text: opthelpText,
  },
  wizhelp: {
    title: "Wizard Help",
    text: wizhelpText,
  },
  porthelp: {
    title: "Port Help",
    text: portHelpText,
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

function normalizeDisplayFileLines(rawText: string): string[] {
  const normalizedText = String(rawText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\f/g, "\n\n");
  const lines = normalizedText.split("\n").map((line) => line.trimEnd());

  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines;
}

export function getBundledDisplayFile(
  fileName: unknown,
): DisplayFilePayload | null {
  const normalizedName = normalizeDisplayFileName(fileName);
  if (!normalizedName) {
    return null;
  }

  const canonicalName = aliases[normalizedName] || normalizedName;
  const entry = catalog[canonicalName];
  if (!entry) {
    return null;
  }

  return {
    canonicalName,
    title: entry.title,
    lines: normalizeDisplayFileLines(entry.text),
  };
}
