import fs from "node:fs/promises";
import { generateGlyphCatalogSource, getGeneratedCatalogPath, resolveProjectRoot } from "./catalog-generator.mjs";

async function main() {
  const projectRoot = resolveProjectRoot();
  const outputPath = getGeneratedCatalogPath(projectRoot);
  const [expectedSource, currentSource] = await Promise.all([
    generateGlyphCatalogSource(projectRoot),
    fs.readFile(outputPath, "utf8"),
  ]);

  if (currentSource !== expectedSource) {
    console.error(
      `Glyph catalog is stale: ${outputPath}\nRun: npm run glyphs:generate`
    );
    process.exit(1);
  }

  console.log("Glyph catalog is up to date.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
