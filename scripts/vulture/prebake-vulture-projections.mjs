import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

const VULTURE_DATA_ROOT = path.join(
  repoRoot,
  "public",
  "assets",
  "vulture",
  "win",
  "vulture",
  "gamedata",
);
const VULTURE_CONFIG_PATH = path.join(
  VULTURE_DATA_ROOT,
  "config",
  "vulture_tiles.conf",
);
const PREBAKED_OUTPUT_ROOT_RELATIVE = "prebaked/projection";
const PREBAKED_OUTPUT_ROOT = path.join(
  VULTURE_DATA_ROOT,
  ...PREBAKED_OUTPUT_ROOT_RELATIVE.split("/"),
);
const PREBAKED_MANIFEST_PATH = path.join(
  VULTURE_DATA_ROOT,
  "prebaked",
  "projection-manifest.json",
);

const floorProjectionQuad = {
  topLeft: { x: 0, y: 0.4948 },
  topRight: { x: 0.4845, y: 0.3196 },
  bottomRight: { x: 1, y: 0.4897 },
  bottomLeft: { x: 0.5052, y: 0.6907 },
};

const wallProjectionQuadEW = {
  topLeft: { x: 0.2062, y: 0.2216 },
  topRight: { x: 0.7887, y: 0 },
  bottomRight: { x: 0.7938, y: 0.7629 },
  bottomLeft: { x: 0.2113, y: 1 },
};

const wallProjectionQuadSN = {
  topLeft: { x: 0.2165, y: 0 },
  topRight: { x: 0.7938, y: 0.2268 },
  bottomRight: { x: 0.8041, y: 1 },
  bottomLeft: { x: 0.2268, y: 0.7732 },
};

const defaultProjectionRotationByFace = {
  north: 0,
  east: 0,
  south: 0,
  west: 0,
  floor: 0,
};

function normalizeTileNameToken(rawValue) {
  return String(rawValue || "")
    .trim()
    .replace(/[a-z]/g, (char) => char.toUpperCase())
    .replace(/[^A-Z0-9_]/g, "_");
}

function makeTileToken(category, name) {
  return `${category}.${name}`;
}

function normalizePathSeparators(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.?\//, "");
}

function parseCliOptions() {
  const options = {
    tileSize: 112,
    dryRun: false,
  };
  for (const rawArg of process.argv.slice(2)) {
    if (rawArg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (rawArg.startsWith("--size=")) {
      const parsed = Number.parseInt(rawArg.slice("--size=".length), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.tileSize = Math.trunc(parsed);
      }
    }
  }
  return options;
}

function parseVultureTileConfig(configText) {
  const rawEntryByToken = new Map();
  const defaultTargetByCategory = new Map();
  const lines = String(configText || "").split(/\r?\n/g);
  const assetPattern =
    /^([a-z]+)\.([A-Za-z0-9_]+)\s*=\s*"([^"]+)"\s*(-?\d+)\s*(-?\d+)\s*$/;
  const redirectPattern =
    /^([a-z]+)\.([A-Za-z0-9_]+)\s*=>\s*([a-z]+)\.([A-Za-z0-9_]+)\s*$/;

  for (const rawLine of lines) {
    const lineWithoutComment = rawLine.replace(/\s*#.*$/, "").trim();
    if (!lineWithoutComment) {
      continue;
    }

    const assetMatch = lineWithoutComment.match(assetPattern);
    if (assetMatch) {
      const category = assetMatch[1];
      const name = normalizeTileNameToken(assetMatch[2]);
      const assetPath = normalizePathSeparators(assetMatch[3]);
      const hsX = Number.parseInt(assetMatch[4], 10);
      const hsY = Number.parseInt(assetMatch[5], 10);
      const token = makeTileToken(category, name);
      rawEntryByToken.set(token, {
        kind: "asset",
        path: assetPath,
        hsX: Number.isFinite(hsX) ? hsX : 0,
        hsY: Number.isFinite(hsY) ? hsY : 0,
      });
      continue;
    }

    const redirectMatch = lineWithoutComment.match(redirectPattern);
    if (!redirectMatch) {
      continue;
    }

    const sourceCategory = redirectMatch[1];
    const sourceName = redirectMatch[2];
    const targetCategory = redirectMatch[3];
    const targetName = normalizeTileNameToken(redirectMatch[4]);
    if (sourceName.toLowerCase() === "default") {
      defaultTargetByCategory.set(sourceCategory, {
        category: targetCategory,
        name: targetName,
      });
      continue;
    }

    const token = makeTileToken(
      sourceCategory,
      normalizeTileNameToken(sourceName),
    );
    rawEntryByToken.set(token, {
      kind: "redirect",
      target: {
        category: targetCategory,
        name: targetName,
      },
    });
  }

  return { rawEntryByToken, defaultTargetByCategory };
}

function createTileEntryResolver(rawEntryByToken, defaultTargetByCategory) {
  const resolvedEntryByToken = new Map();

  function resolveTileEntryRecursive(category, name, stack) {
    const normalizedName = normalizeTileNameToken(name);
    const token = makeTileToken(category, normalizedName);
    if (resolvedEntryByToken.has(token)) {
      return resolvedEntryByToken.get(token) ?? null;
    }
    if (stack.has(token)) {
      resolvedEntryByToken.set(token, null);
      return null;
    }
    stack.add(token);

    const rawEntry = rawEntryByToken.get(token);
    if (rawEntry?.kind === "asset") {
      const resolved = {
        path: rawEntry.path,
        hsX: rawEntry.hsX,
        hsY: rawEntry.hsY,
      };
      resolvedEntryByToken.set(token, resolved);
      return resolved;
    }

    const target =
      rawEntry?.kind === "redirect"
        ? rawEntry.target
        : defaultTargetByCategory.get(category) ?? null;
    if (!target) {
      resolvedEntryByToken.set(token, null);
      return null;
    }

    const resolved = resolveTileEntryRecursive(
      target.category,
      target.name,
      stack,
    );
    resolvedEntryByToken.set(token, resolved);
    return resolved;
  }

  return (category, name) =>
    resolveTileEntryRecursive(category, name, new Set());
}

function clamp(value, minValue, maxValue) {
  return Math.max(minValue, Math.min(maxValue, value));
}

function parseWallFaceToken(lookupName) {
  const match = String(lookupName || "").toUpperCase().match(/_([WNES])$/);
  return match ? match[1] : null;
}

function resolveFamilyAndFaceForLookup(category, lookupName) {
  if (category === "floor") {
    return {
      family: "floor",
      face: "none",
    };
  }
  if (category !== "wall") {
    return null;
  }
  const faceToken = parseWallFaceToken(lookupName);
  if (!faceToken) {
    return null;
  }
  const face =
    faceToken === "W"
      ? "west"
      : faceToken === "N"
        ? "north"
        : faceToken === "E"
          ? "east"
          : "south";
  const family = faceToken === "W" || faceToken === "E" ? "ew" : "sn";
  return { family, face };
}

function rotateUv(u, v, rotationDegrees) {
  const normalizedRotation = ((Math.trunc(rotationDegrees / 90) % 4) + 4) % 4;
  switch (normalizedRotation) {
    case 1:
      return { u: v, v: 1 - u };
    case 2:
      return { u: 1 - u, v: 1 - v };
    case 3:
      return { u: 1 - v, v: u };
    case 0:
    default:
      return { u, v };
  }
}

function dilateOpaquePixels(pixels, size, iterations) {
  if (iterations <= 0 || size <= 1) {
    return;
  }
  const directions = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  for (let pass = 0; pass < iterations; pass += 1) {
    const source = new Uint8ClampedArray(pixels);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const index = (y * size + x) * 4;
        if (source[index + 3] > 0) {
          continue;
        }
        let bestNeighborIndex = -1;
        let bestNeighborAlpha = 0;
        for (const [dx, dy] of directions) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) {
            continue;
          }
          const neighborIndex = (ny * size + nx) * 4;
          const neighborAlpha = source[neighborIndex + 3];
          if (neighborAlpha <= bestNeighborAlpha) {
            continue;
          }
          bestNeighborAlpha = neighborAlpha;
          bestNeighborIndex = neighborIndex;
        }
        if (bestNeighborIndex < 0) {
          continue;
        }
        pixels[index] = source[bestNeighborIndex];
        pixels[index + 1] = source[bestNeighborIndex + 1];
        pixels[index + 2] = source[bestNeighborIndex + 2];
        pixels[index + 3] = source[bestNeighborIndex + 3];
      }
    }
  }
}

function extendOpaqueRunsToBorders(pixels, size) {
  const rowHasOpaque = new Array(size).fill(false);
  for (let y = 0; y < size; y += 1) {
    let firstOpaqueX = -1;
    let lastOpaqueX = -1;
    for (let x = 0; x < size; x += 1) {
      const alpha = pixels[(y * size + x) * 4 + 3];
      if (alpha <= 0) {
        continue;
      }
      if (firstOpaqueX < 0) {
        firstOpaqueX = x;
      }
      lastOpaqueX = x;
    }
    if (firstOpaqueX < 0 || lastOpaqueX < 0) {
      continue;
    }
    rowHasOpaque[y] = true;
    const firstIndex = (y * size + firstOpaqueX) * 4;
    const lastIndex = (y * size + lastOpaqueX) * 4;
    for (let x = 0; x < firstOpaqueX; x += 1) {
      const index = (y * size + x) * 4;
      pixels[index] = pixels[firstIndex];
      pixels[index + 1] = pixels[firstIndex + 1];
      pixels[index + 2] = pixels[firstIndex + 2];
      pixels[index + 3] = pixels[firstIndex + 3];
    }
    for (let x = lastOpaqueX + 1; x < size; x += 1) {
      const index = (y * size + x) * 4;
      pixels[index] = pixels[lastIndex];
      pixels[index + 1] = pixels[lastIndex + 1];
      pixels[index + 2] = pixels[lastIndex + 2];
      pixels[index + 3] = pixels[lastIndex + 3];
    }
  }
  for (let y = 0; y < size; y += 1) {
    if (rowHasOpaque[y]) {
      continue;
    }
    let sourceRow = -1;
    for (let search = y - 1; search >= 0; search -= 1) {
      if (rowHasOpaque[search]) {
        sourceRow = search;
        break;
      }
    }
    if (sourceRow < 0) {
      for (let search = y + 1; search < size; search += 1) {
        if (rowHasOpaque[search]) {
          sourceRow = search;
          break;
        }
      }
    }
    if (sourceRow < 0) {
      continue;
    }
    for (let x = 0; x < size; x += 1) {
      const srcIndex = (sourceRow * size + x) * 4;
      const destIndex = (y * size + x) * 4;
      pixels[destIndex] = pixels[srcIndex];
      pixels[destIndex + 1] = pixels[srcIndex + 1];
      pixels[destIndex + 2] = pixels[srcIndex + 2];
      pixels[destIndex + 3] = pixels[srcIndex + 3];
    }
    rowHasOpaque[y] = true;
  }
}

function solidifyTexturePixels(pixels, size) {
  dilateOpaquePixels(pixels, size, 3);
  extendOpaqueRunsToBorders(pixels, size);
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] <= 0) {
      continue;
    }
    pixels[index + 3] = 255;
  }
}

function drawScaledSourcePreview(sourcePixels, sourceWidth, sourceHeight, size) {
  const output = new Uint8ClampedArray(size * size * 4);
  const clampedSourceWidth = Math.max(1, Math.trunc(sourceWidth));
  const clampedSourceHeight = Math.max(1, Math.trunc(sourceHeight));
  const scale = Math.max(
    0.001,
    Math.min(size / clampedSourceWidth, size / clampedSourceHeight),
  );
  const drawWidth = Math.max(1, Math.round(clampedSourceWidth * scale));
  const drawHeight = Math.max(1, Math.round(clampedSourceHeight * scale));
  const drawX = Math.floor((size - drawWidth) * 0.5);
  const drawY = Math.floor((size - drawHeight) * 0.5);

  for (let y = 0; y < drawHeight; y += 1) {
    const destY = drawY + y;
    if (destY < 0 || destY >= size) {
      continue;
    }
    const sourceV = drawHeight <= 1 ? 0 : y / (drawHeight - 1);
    const sourceY = clamp(
      Math.round(sourceV * (clampedSourceHeight - 1)),
      0,
      clampedSourceHeight - 1,
    );
    for (let x = 0; x < drawWidth; x += 1) {
      const destX = drawX + x;
      if (destX < 0 || destX >= size) {
        continue;
      }
      const sourceU = drawWidth <= 1 ? 0 : x / (drawWidth - 1);
      const sourceX = clamp(
        Math.round(sourceU * (clampedSourceWidth - 1)),
        0,
        clampedSourceWidth - 1,
      );
      const srcIndex = (sourceY * clampedSourceWidth + sourceX) * 4;
      const destIndex = (destY * size + destX) * 4;
      output[destIndex] = sourcePixels[srcIndex];
      output[destIndex + 1] = sourcePixels[srcIndex + 1];
      output[destIndex + 2] = sourcePixels[srcIndex + 2];
      output[destIndex + 3] = sourcePixels[srcIndex + 3];
    }
  }
  return output;
}

function reprojectPixels(sourcePixels, size, family, face) {
  const output = new Uint8ClampedArray(sourcePixels.length);
  const quad =
    family === "ew"
      ? wallProjectionQuadEW
      : family === "sn"
        ? wallProjectionQuadSN
        : floorProjectionQuad;
  const rotationDegrees =
    family === "floor"
      ? defaultProjectionRotationByFace.floor
      : defaultProjectionRotationByFace[face] ?? 0;
  const sizeMinusOne = Math.max(1, size - 1);

  for (let x = 0; x < size; x += 1) {
    for (let y = 0; y < size; y += 1) {
      const baseU = x / sizeMinusOne;
      const baseV = y / sizeMinusOne;
      const rotated = rotateUv(baseU, baseV, rotationDegrees);
      const u = rotated.u;
      const v = rotated.v;
      const srcU =
        (1 - u) * (1 - v) * quad.topLeft.x +
        u * (1 - v) * quad.topRight.x +
        u * v * quad.bottomRight.x +
        (1 - u) * v * quad.bottomLeft.x;
      const srcV =
        (1 - u) * (1 - v) * quad.topLeft.y +
        u * (1 - v) * quad.topRight.y +
        u * v * quad.bottomRight.y +
        (1 - u) * v * quad.bottomLeft.y;
      const srcX = clamp(Math.round(srcU * sizeMinusOne), 0, sizeMinusOne);
      const srcY = clamp(Math.round(srcV * sizeMinusOne), 0, sizeMinusOne);
      const srcIndex = (srcY * size + srcX) * 4;
      const destIndex = (y * size + x) * 4;
      output[destIndex] = sourcePixels[srcIndex];
      output[destIndex + 1] = sourcePixels[srcIndex + 1];
      output[destIndex + 2] = sourcePixels[srcIndex + 2];
      output[destIndex + 3] = sourcePixels[srcIndex + 3];
    }
  }

  if (family !== "floor" && (face === "east" || face === "south")) {
    solidifyTexturePixels(output, size);
  }
  return output;
}

function roundTo4(value) {
  return Number(Number(value).toFixed(4));
}

function roundPoint(point) {
  return {
    x: roundTo4(point.x),
    y: roundTo4(point.y),
  };
}

function roundQuad(quad) {
  return {
    topLeft: roundPoint(quad.topLeft),
    topRight: roundPoint(quad.topRight),
    bottomRight: roundPoint(quad.bottomRight),
    bottomLeft: roundPoint(quad.bottomLeft),
  };
}

function buildProjectionProfile() {
  return {
    ew: roundQuad(wallProjectionQuadEW),
    sn: roundQuad(wallProjectionQuadSN),
    floor: roundQuad(floorProjectionQuad),
    rotation: {
      north: defaultProjectionRotationByFace.north,
      east: defaultProjectionRotationByFace.east,
      south: defaultProjectionRotationByFace.south,
      west: defaultProjectionRotationByFace.west,
      floor: defaultProjectionRotationByFace.floor,
    },
  };
}

function makeManifestEntryKey(category, lookupName, family, face) {
  return `${category}.${lookupName}|family:${family}|face:${face}`;
}

function sanitizeFileToken(value) {
  return String(value || "").replace(/[^A-Za-z0-9._-]/g, "_");
}

async function ensureParentDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function readPngFile(filePath) {
  const buffer = await fs.readFile(filePath);
  return PNG.sync.read(buffer);
}

async function writePngFile(filePath, width, height, rgbaPixels) {
  const outputPng = new PNG({ width, height });
  outputPng.data = Buffer.from(rgbaPixels);
  const encoded = PNG.sync.write(outputPng);
  await ensureParentDir(filePath);
  await fs.writeFile(filePath, encoded);
}

async function main() {
  const options = parseCliOptions();
  const configText = await fs.readFile(VULTURE_CONFIG_PATH, "utf8");
  const { rawEntryByToken, defaultTargetByCategory } =
    parseVultureTileConfig(configText);
  const resolveTileEntry = createTileEntryResolver(
    rawEntryByToken,
    defaultTargetByCategory,
  );

  const imageByAbsolutePath = new Map();
  const manifestEntries = {};
  const writeJobs = [];

  for (const token of rawEntryByToken.keys()) {
    const dotIndex = token.indexOf(".");
    if (dotIndex <= 0 || dotIndex >= token.length - 1) {
      continue;
    }
    const category = token.slice(0, dotIndex);
    const lookupName = token.slice(dotIndex + 1);
    if (category !== "floor" && category !== "wall") {
      continue;
    }

    const projectionContext = resolveFamilyAndFaceForLookup(category, lookupName);
    if (!projectionContext) {
      continue;
    }
    const resolvedEntry = resolveTileEntry(category, lookupName);
    if (!resolvedEntry) {
      continue;
    }
    if (!/\.png$/i.test(resolvedEntry.path)) {
      continue;
    }

    const sourceAbsolutePath = path.join(
      VULTURE_DATA_ROOT,
      ...normalizePathSeparators(resolvedEntry.path).split("/"),
    );
    let sourcePng = imageByAbsolutePath.get(sourceAbsolutePath);
    if (!sourcePng) {
      try {
        sourcePng = await readPngFile(sourceAbsolutePath);
      } catch (error) {
        console.warn(
          `[vulture:prebake] Failed to read source '${sourceAbsolutePath}':`,
          error,
        );
        continue;
      }
      imageByAbsolutePath.set(sourceAbsolutePath, sourcePng);
    }

    const previewPixels = drawScaledSourcePreview(
      sourcePng.data,
      sourcePng.width,
      sourcePng.height,
      options.tileSize,
    );
    const projectedPixels = reprojectPixels(
      previewPixels,
      options.tileSize,
      projectionContext.family,
      projectionContext.face,
    );
    const entryKey = makeManifestEntryKey(
      category,
      lookupName,
      projectionContext.family,
      projectionContext.face,
    );
    const outputRelativePath = path.posix.join(
      PREBAKED_OUTPUT_ROOT_RELATIVE,
      category,
      `${sanitizeFileToken(lookupName)}__${projectionContext.family}__${projectionContext.face}.png`,
    );
    manifestEntries[entryKey] = outputRelativePath;

    if (!options.dryRun) {
      const outputAbsolutePath = path.join(
        VULTURE_DATA_ROOT,
        ...outputRelativePath.split("/"),
      );
      writeJobs.push({
        outputAbsolutePath,
        projectedPixels,
      });
    }
  }

  const sortedManifestEntries = Object.fromEntries(
    Object.entries(manifestEntries).sort((a, b) => a[0].localeCompare(b[0])),
  );
  const profile = buildProjectionProfile();
  const manifest = {
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    tileSize: options.tileSize,
    sourceConfigPath: "config/vulture_tiles.conf",
    profile,
    profileSignature: JSON.stringify(profile),
    entries: sortedManifestEntries,
  };

  if (!options.dryRun) {
    await fs.rm(PREBAKED_OUTPUT_ROOT, {
      recursive: true,
      force: true,
    });
    await Promise.all(
      writeJobs.map((job) =>
        writePngFile(
          job.outputAbsolutePath,
          options.tileSize,
          options.tileSize,
          job.projectedPixels,
        ),
      ),
    );
    await ensureParentDir(PREBAKED_MANIFEST_PATH);
    await fs.writeFile(PREBAKED_MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  console.log(
    `[vulture:prebake] ${options.dryRun ? "Dry run complete" : "Generated prebaked projection assets"}: ${Object.keys(sortedManifestEntries).length} entries (tileSize=${options.tileSize}).`,
  );
  if (options.dryRun) {
    console.log(
      `[vulture:prebake] Manifest preview path: ${PREBAKED_MANIFEST_PATH}`,
    );
  }
}

main().catch((error) => {
  console.error("[vulture:prebake] Failed:", error);
  process.exitCode = 1;
});
