import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const SOURCE_JS_RELATIVE_PATH = "public/nethack.js";
const SOURCE_WASM_RELATIVE_PATH = "public/nethack.wasm";
const GENERATED_RELATIVE_PATH = "src/game/glyphs/glyph-catalog.generated.ts";

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
  const rawKind = key.replace(/^GLYPH_/, "").replace(/_OFF$/, "").toLowerCase();
  if (!KNOWN_GLYPH_KINDS.has(rawKind)) {
    throw new Error(`Unsupported glyph kind '${rawKind}' from key '${key}'`);
  }
  return /** @type {GlyphKind} */ (rawKind);
}

function normalizeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function createRuntimeCallback() {
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
      default:
        return 0;
    }
  };
}

async function waitFor(predicate, timeoutMs, intervalMs = 20) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for runtime bootstrap after ${timeoutMs}ms`);
}

/**
 * @param {string} projectRoot
 */
async function bootCatalogRuntime(projectRoot) {
  const jsPath = path.join(projectRoot, SOURCE_JS_RELATIVE_PATH);
  const wasmPath = path.join(projectRoot, SOURCE_WASM_RELATIVE_PATH);
  const wasmBinary = await fs.readFile(wasmPath);

  const factory = require(jsPath);
  if (typeof factory !== "function") {
    throw new Error(`NetHack factory not found in ${jsPath}`);
  }

  globalThis.nethackCallback = createRuntimeCallback();

  /** @type {any} */
  const moduleConfig = {
    wasmBinary,
    locateFile: (assetPath) => assetPath,
    print: () => {},
    printErr: () => {},
    preRun: [
      () => {
        moduleConfig.ENV = moduleConfig.ENV || {};
        moduleConfig.ENV.NETHACKOPTIONS = `autoquiver,name:${SAFE_NAME}`;
      },
    ],
    onRuntimeInitialized: () => {
      try {
        moduleConfig.ccall(
          "shim_graphics_set_callback",
          null,
          ["string"],
          ["nethackCallback"],
          { async: true }
        );
      } catch (error) {
        throw new Error(
          `Failed calling shim_graphics_set_callback: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    },
  };
  let bootError = null;
  try {
    const maybePromise = factory(moduleConfig);
    if (maybePromise && typeof maybePromise.then === "function") {
      maybePromise.catch((error) => {
        bootError = error;
      });
    }
  } catch (error) {
    bootError = error;
  }

  await waitFor(
    () =>
      Boolean(
        !bootError &&
        globalThis.nethackGlobal &&
          globalThis.nethackGlobal.constants &&
          globalThis.nethackGlobal.constants.GLYPH &&
          globalThis.nethackGlobal.helpers &&
          typeof globalThis.nethackGlobal.helpers.mapglyphHelper === "function"
      ),
    15000
  );

  if (bootError) {
    throw bootError;
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
      ([key, value]) => /^GLYPH_[A-Z_]+_OFF$/.test(key) && Number.isFinite(value)
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
      index + 1 < offsetEntries.length ? offsetEntries[index + 1].start : maxGlyph;
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
function buildGlyphEntries(helpers, ranges, maxGlyph) {
  /** @type {GlyphEntry[]} */
  const entries = [];
  for (let glyph = 0; glyph < maxGlyph; glyph++) {
    const info = helpers.mapglyphHelper(glyph, 0, 0, 0);
    entries.push({
      glyph,
      kind: glyphKindForGlyph(ranges, glyph),
      ch: normalizeNumber(info?.ch, 0),
      color: normalizeNumber(info?.color, 0),
      special: normalizeNumber(info?.special, 0),
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
      `  { key: "${range.key}", kind: "${range.kind}", start: ${range.start}, endExclusive: ${range.endExclusive} },`
  );

  const entryLines = model.entries.map(
    (entry) =>
      `  { glyph: ${entry.glyph}, kind: "${entry.kind}", ch: ${entry.ch}, color: ${entry.color}, special: ${entry.special} },`
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
  return path.join(projectRoot, GENERATED_RELATIVE_PATH);
}

/**
 * @param {string} projectRoot
 */
export async function generateGlyphCatalogSource(projectRoot) {
  const jsPath = path.join(projectRoot, SOURCE_JS_RELATIVE_PATH);
  const wasmPath = path.join(projectRoot, SOURCE_WASM_RELATIVE_PATH);

  const [jsBuffer, runtimeInfo] = await Promise.all([
    fs.readFile(jsPath),
    bootCatalogRuntime(projectRoot),
  ]);

  const { nethackGlobal, wasmBinary } = runtimeInfo;
  const glyphConstants = nethackGlobal.constants?.GLYPH;
  const mapglyphHelper = nethackGlobal.helpers?.mapglyphHelper;

  if (!glyphConstants || typeof mapglyphHelper !== "function") {
    throw new Error("Runtime did not expose required glyph constants/helpers");
  }

  const noGlyph = normalizeNumber(glyphConstants.NO_GLYPH, normalizeNumber(glyphConstants.MAX_GLYPH, 0));
  const { maxGlyph, ranges } = deriveGlyphRanges(glyphConstants);
  const entries = buildGlyphEntries(nethackGlobal.helpers, ranges, maxGlyph);

  return renderGlyphCatalogModule({
    sourceJsPath: toPosixPath(SOURCE_JS_RELATIVE_PATH),
    sourceWasmPath: toPosixPath(SOURCE_WASM_RELATIVE_PATH),
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
