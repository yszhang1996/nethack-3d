import fs from "node:fs/promises";
import path from "node:path";

function parseTileFile(content) {
  const lines = content.split('\n');
  const palette = new Map();
  const tiles = [];
  let currentTile = null;
  let lineIndex = 0;

  // Parse palette
  while (lineIndex < lines.length) {
    const line = lines[lineIndex].trim();
    lineIndex++;
    if (line.startsWith('# tile')) {
      lineIndex--; // Step back to process the first tile line
      break;
    }
    if (line.includes('=')) {
      const [char, color] = line.split('=').map(s => s.trim());
      const rgb = color.match(/\((\d+), (\d+), (\d+)\)/);
      if (char.length === 1 && rgb) {
        palette.set(char, [parseInt(rgb[1], 10), parseInt(rgb[2], 10), parseInt(rgb[3], 10)]);
      }
    }
  }

  // Parse tiles
  while (lineIndex < lines.length) {
    const line = lines[lineIndex].trim();
    lineIndex++;

    if (line.startsWith('# tile')) {
      if (currentTile) {
        tiles.push(currentTile);
      }
      const nameMatch = line.match(/# tile \d+ \((.*)\)/);
      currentTile = {
        name: nameMatch ? nameMatch[1].trim() : 'unknown',
        pixels: [],
      };
    } else if (line === '{') {
      // Start of tile data
    } else if (line === '}') {
      // End of tile data
    } else if (currentTile && line.length > 0 && !line.startsWith('#')) {
      currentTile.pixels.push(line.split(''));
    }
  }

  if (currentTile) {
    tiles.push(currentTile);
  }

  return { palette, tiles };
}

export async function getAllTiles(projectRoot) {
    const tileFiles = ['monsters.txt', 'objects.txt', 'other.txt'];
    const allTiles = [];
    let palette = null;
    const counts = {};

    for (const file of tileFiles) {
        const filePath = path.join(projectRoot, 'third_party', 'nethack-3.6.7', 'win', 'share', file);
        const content = await fs.readFile(filePath, 'utf-8');
        const parsed = parseTileFile(content);
        if (!palette) {
            palette = parsed.palette;
        }
        allTiles.push(...parsed.tiles);
        counts[file] = parsed.tiles.length;
    }

    return { palette, tiles: allTiles, counts };
}
