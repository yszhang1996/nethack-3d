import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");

const targets = [
  {
    packageName: "@neth4ck/wasm-367",
    src: resolve(PROJECT_ROOT, "node_modules/@neth4ck/wasm-367/build/nethack.wasm"),
    dest: resolve(PROJECT_ROOT, "public/nethack.wasm"),
  },
  {
    packageName: "@neth4ck/wasm-37",
    src: resolve(PROJECT_ROOT, "node_modules/@neth4ck/wasm-37/build/nethack.wasm"),
    dest: resolve(PROJECT_ROOT, "public/nethack-37.wasm"),
  },
];

export function copyWasm() {
  mkdirSync(resolve(PROJECT_ROOT, "public"), { recursive: true });
  for (const target of targets) {
    if (!existsSync(target.src)) {
      throw new Error(`${target.packageName} build not found -- run npm install first`);
    }
    copyFileSync(target.src, target.dest);
  }
}
