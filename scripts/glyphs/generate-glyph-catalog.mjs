import fs from "node:fs/promises";
import path from "node:path";
import { generateGlyphCatalogSource, getGeneratedCatalogPath, resolveProjectRoot } from "./catalog-generator.mjs";

async function main() {
  const projectRoot = resolveProjectRoot();
  const outputPath = getGeneratedCatalogPath(projectRoot);
  const source = await generateGlyphCatalogSource(projectRoot);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, source, "utf8");
  console.log(`Generated glyph catalog: ${outputPath}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
