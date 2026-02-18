import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyWasm } from "../wasm/copy-wasm.mjs";
import { getAllTiles } from "./tile-parser.mjs";

export const GLYPH_CATALOG_VERSIONS = /** @type {const} */ (["3.6.7", "3.7"]);

const CATALOG_TARGETS = [
  {
    version: "3.6.7",
    packageName: "@neth4ck/wasm-367",
    packageJsPath: "node_modules/@neth4ck/wasm-367/build/nethack.js",
    publicWasmPath: "public/nethack-367.wasm",
    generatedCatalogPath: "src/game/glyphs/glyph-catalog.367.generated.ts",
  },
  {
    version: "3.7",
    packageName: "@neth4ck/wasm-37",
    packageJsPath: "node_modules/@neth4ck/wasm-37/build/nethack.js",
    publicWasmPath: "public/nethack-37.wasm",
    generatedCatalogPath: "src/game/glyphs/glyph-catalog.37.generated.ts",
  },
];

/**
 * @typedef {(
 *  "mon" | "pet" | "invis" | "detect" | "body" | "ridden" | "obj" | "cmap" |
 *  "explode" | "zap" | "swallow" | "warning" | "statue" | "unexplored" | "nothing"
 * )} GlyphKind
 */

/**
 * @typedef {{
 *   key: string;
 *   kind: GlyphKind;
 *   start: number;
 *   endExclusive: number;
 * }} GlyphRange
 */

/**
 * @typedef {{
 *   glyph: number;
 *   kind: GlyphKind;
 *   ch: number;
 *   color: number;
 *   special: number;
 * }} GlyphEntry
 */

const KNOWN_GLYPH_KINDS = new Set([
  "mon",
  "pet",
  "invis",
  "detect",
  "body",
  "ridden",
  "obj",
  "cmap",
  "explode",
  "zap",
  "swallow",
  "warning",
  "statue",
  "unexplored",
  "nothing",
]);

const SAFE_NAME = "GlyphCatalog";

function hashBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function toPosixPath(inputPath) {
  return inputPath.split(path.sep).join("/");
}

function glyphKindFromOffsetKey(key) {
  const rawKind = key
    .replace(/^GLYPH_/, "")
    .replace(/_OFF$/, "")
    .toLowerCase();
  if (!KNOWN_GLYPH_KINDS.has(rawKind)) {
    throw new Error(`Unsupported glyph kind '${rawKind}' from key '${key}'`);
  }
  return /** @type {GlyphKind} */ (rawKind);
}

function normalizeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function createRuntimeCallback() {
  // Intentionally synchronous: _main() will throw at the ASYNCIFY boundary,
  // but js_helpers_init / js_constants_init / js_globals_init have already run
  // by that point, giving us access to mapglyphHelper and glyph constants.
  return function glyphCatalogCallback(name) {
    switch (name) {
      case "shim_get_nh_event":
      case "shim_nhgetch":
      case "shim_nh_poskey":
      case "shim_yn_function":
        return 27;
      case "shim_select_menu":
        return 0;
      case "shim_getmsghistory":
        return "";
      case "shim_askname":
      case "shim_getlin":
        return SAFE_NAME;
      case "shim_create_nhwindow":
        return 1;
      default:
        return 0;
    }
  };
}

/**
 * @param {string} projectRoot
 * @param {{ packageName: string; publicWasmPath: string }} target
 */
async function bootCatalogRuntime(projectRoot, target) {
  copyWasm();
  const wasmPath = path.join(projectRoot, target.publicWasmPath);
  const wasmBinary = await fs.readFile(wasmPath);

  const { default: factory } = await import(target.packageName);
  if (typeof factory !== "function") {
    throw new Error(`NetHack factory not found in ${target.packageName}`);
  }

  delete globalThis.nethackGlobal;

  globalThis.nethackCallback = createRuntimeCallback();

  /** @type {any} */
  const Module = await factory({
    noInitialRun: true,
    wasmBinary,
    locateFile: (assetPath) => assetPath,
    print: () => {},
    printErr: () => {},
    preRun: [
      (mod) => {
        mod.ENV = mod.ENV || {};
        mod.ENV.NETHACKOPTIONS = `autoquiver,name:${SAFE_NAME}`;
      },
    ],
  });

  const setCallback = Module.cwrap("shim_graphics_set_callback", null, [
    "string",
  ]);
  setCallback("nethackCallback");

  // Start main() — with a synchronous callback, _main() will throw at the first
  // ASYNCIFY boundary. By then, js_helpers_init / js_constants_init / js_globals_init
  // have already run, giving us access to mapglyphHelper and glyph constants.
  try {
    Module._main(0, 0);
  } catch {
    // Expected: ASYNCIFY requires async callbacks, but we only need the
    // initialization that runs before the first async suspension point.
  }

  if (
    !globalThis.nethackGlobal ||
    !globalThis.nethackGlobal.constants?.GLYPH ||
    typeof globalThis.nethackGlobal.helpers?.mapglyphHelper !== "function"
  ) {
    throw new Error(
      "Runtime did not expose required glyph constants/helpers after _main()",
    );
  }

  return {
    nethackGlobal: globalThis.nethackGlobal,
    wasmBinary,
  };
}

/**
 * @param {Record<string, number>} glyphConstants
 */
function deriveGlyphRanges(glyphConstants) {
  const maxGlyph = normalizeNumber(glyphConstants.MAX_GLYPH, 0);
  const offsetEntries = Object.entries(glyphConstants)
    .filter(
      ([key, value]) =>
        /^GLYPH_[A-Z_]+_OFF$/.test(key) && Number.isFinite(value),
    )
    .map(([key, value]) => ({ key, start: Number(value) }))
    .sort((a, b) => a.start - b.start);

  if (offsetEntries.length === 0) {
    throw new Error("No GLYPH_*_OFF constants found in runtime");
  }

  /** @type {GlyphRange[]} */
  const ranges = [];
  for (let index = 0; index < offsetEntries.length; index++) {
    const current = offsetEntries[index];
    const nextStart =
      index + 1 < offsetEntries.length
        ? offsetEntries[index + 1].start
        : maxGlyph;
    ranges.push({
      key: current.key,
      kind: glyphKindFromOffsetKey(current.key),
      start: current.start,
      endExclusive: nextStart,
    });
  }

  return { maxGlyph, ranges };
}

/**
 * @param {GlyphRange[]} ranges
 * @param {number} glyph
 */
function glyphKindForGlyph(ranges, glyph) {
  for (const range of ranges) {
    if (glyph >= range.start && glyph < range.endExclusive) {
      return range.kind;
    }
  }
  throw new Error(`No glyph kind range found for glyph ${glyph}`);
}

/**
 * @param {{ mapglyphHelper: (glyph: number, x: number, y: number, mgflags: number) => any }} helpers
 * @param {GlyphRange[]} ranges
 * @param {number} maxGlyph
 */
function buildGlyphEntries(helpers, ranges, maxGlyph, tiles, offsets, counts) {
  /** @type {GlyphEntry[]} */
  const entries = [];
  for (let glyph = 0; glyph < maxGlyph; glyph++) {
    const info = helpers.mapglyphHelper(glyph, 0, 0, 0);
    const kind = glyphKindForGlyph(ranges, glyph);
    let tileIndex = -1;

    if (kind === "mon") {
      tileIndex = glyph - offsets.mon;
    } else if (kind === "pet") {
      tileIndex = glyph - offsets.pet;
    } else if (kind === "obj") {
      tileIndex = counts["monsters.txt"] + glyph - offsets.obj;
    } else if (kind === "cmap") {
      tileIndex =
        counts["monsters.txt"] + counts["objects.txt"] + glyph - offsets.other;
    }

    entries.push({
      glyph,
      kind: kind,
      ch: normalizeNumber(info?.ch, 0),
      color: normalizeNumber(info?.color, 0),
      special: normalizeNumber(info?.special, 0),
      tileIndex: tileIndex,
    });
  }
  return entries;
}

/**
 * @param {{
 *  sourceJsPath: string;
 *  sourceWasmPath: string;
 *  sourceJsSha256: string;
 *  sourceWasmSha256: string;
 *  maxGlyph: number;
 *  noGlyph: number;
 *  ranges: GlyphRange[];
 *  entries: GlyphEntry[];
 * }} model
 */
function renderGlyphCatalogModule(model) {
  const rangeLines = model.ranges.map(
    (range) =>
      `  { key: "${range.key}", kind: "${range.kind}", start: ${range.start}, endExclusive: ${range.endExclusive} },`,
  );

  const entryLines = model.entries.map(
    (entry) =>
      `  { glyph: ${entry.glyph}, kind: "${entry.kind}", ch: ${entry.ch}, color: ${entry.color}, special: ${entry.special}, tileIndex: ${entry.tileIndex} },`,
  );

  return `// @ts-nocheck
/* AUTO-GENERATED FILE. DO NOT EDIT. */
/* Run \`npm run glyphs:generate\` to refresh this file. */

import type { GlyphCatalogEntry, GlyphCatalogMeta, GlyphCatalogRange } from "./types";

export const GLYPH_CATALOG_META: GlyphCatalogMeta = {
  sourceJsPath: "${model.sourceJsPath}",
  sourceWasmPath: "${model.sourceWasmPath}",
  sourceJsSha256: "${model.sourceJsSha256}",
  sourceWasmSha256: "${model.sourceWasmSha256}",
  maxGlyph: ${model.maxGlyph},
  noGlyph: ${model.noGlyph},
};

export const GLYPH_CATALOG_RANGES: readonly GlyphCatalogRange[] = [
${rangeLines.join("\n")}
];

export const GLYPH_CATALOG: readonly GlyphCatalogEntry[] = [
${entryLines.join("\n")}
];
`;
}

/**
 * @param {string} projectRoot
 */
export function getGeneratedCatalogPath(projectRoot) {
  const target = CATALOG_TARGETS[0];
  return path.join(projectRoot, target.generatedCatalogPath);
}

/**
 * @param {string} projectRoot
 */
function resolvePackageJsPath(projectRoot, target) {
  return path.join(projectRoot, target.packageJsPath);
}

function normalizeCatalogVersion(version) {
  if (version === "3.7") {
    return "3.7";
  }
  return "3.6.7";
}

function resolveCatalogTarget(version) {
  const normalized = normalizeCatalogVersion(version);
  const target = CATALOG_TARGETS.find((entry) => entry.version === normalized);
  if (!target) {
    throw new Error(`Unsupported glyph catalog version: ${String(version)}`);
  }
  return target;
}

export function getGlyphCatalogTargets() {
  return CATALOG_TARGETS.map((target) => ({ ...target }));
}

export function getGeneratedCatalogPathForVersion(projectRoot, version) {
  const target = resolveCatalogTarget(version);
  return path.join(projectRoot, target.generatedCatalogPath);
}

export async function generateGlyphCatalogSource(
  projectRoot,
  version = "3.6.7",
) {
  const target = resolveCatalogTarget(version);
  const jsPath = resolvePackageJsPath(projectRoot, target);
  const wasmPath = path.join(projectRoot, target.publicWasmPath);

  const [jsBuffer, runtimeInfo] = await Promise.all([
    fs.readFile(jsPath),
    bootCatalogRuntime(projectRoot, target),
  ]);

  const { nethackGlobal, wasmBinary } = runtimeInfo;
  const { tiles, counts } = await getAllTiles(projectRoot);

  const glyphConstants = nethackGlobal.constants?.GLYPH;
  const mapglyphHelper = nethackGlobal.helpers?.mapglyphHelper;

  if (!glyphConstants || typeof mapglyphHelper !== "function") {
    throw new Error("Runtime did not expose required glyph constants/helpers");
  }

  const noGlyph = normalizeNumber(
    glyphConstants.NO_GLYPH,
    normalizeNumber(glyphConstants.MAX_GLYPH, 0),
  );
  const { maxGlyph, ranges } = deriveGlyphRanges(glyphConstants);
  const offsets = {
    mon: glyphConstants.GLYPH_MON_OFF,
    obj: glyphConstants.GLYPH_OBJ_OFF,
    other: glyphConstants.GLYPH_CMAP_OFF, // Assuming 'other.txt' maps to cmap
    pet: glyphConstants.GLYPH_PET_OFF,
    detect: glyphConstants.GLYPH_DETECT_OFF,
    ridden: glyphConstants.GLYPH_RIDDEN_OFF,
    invis: glyphConstants.GLYPH_INVIS_OFF,
    body: glyphConstants.GLYPH_BODY_OFF,
    other: glyphConstants.GLYPH_CMAP_OFF,
  };
  const entries = buildGlyphEntries(
    nethackGlobal.helpers,
    ranges,
    maxGlyph,
    tiles,
    offsets,
    counts,
  );

  return renderGlyphCatalogModule({
    sourceJsPath: `${target.packageName}/build/nethack.js`,
    sourceWasmPath: toPosixPath(target.publicWasmPath),
    sourceJsSha256: hashBuffer(jsBuffer),
    sourceWasmSha256: hashBuffer(wasmBinary),
    maxGlyph,
    noGlyph,
    ranges,
    entries,
  });
}

export function resolveProjectRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..");
}
