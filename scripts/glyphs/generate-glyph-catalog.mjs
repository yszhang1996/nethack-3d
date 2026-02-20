import fs from "node:fs/promises";
import path from "node:path";
import {
  generateGlyphCatalogSource,
  getGeneratedCatalogPathForVersion,
  getGlyphCatalogTargets,
  resolveProjectRoot,
} from "./catalog-generator.mjs";

async function main() {
  const projectRoot = resolveProjectRoot();
  for (const target of getGlyphCatalogTargets()) {
    const outputPath = getGeneratedCatalogPathForVersion(
      projectRoot,
      target.version,
    );
    const source = await generateGlyphCatalogSource(projectRoot, target.version);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, source, "utf8");
    console.log(`Generated glyph catalog (${target.version}): ${outputPath}`);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
