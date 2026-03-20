import type { NethackRuntimeVersion } from "./types";

const knownSaveRuntimeRoots = ["/", "/nethack"] as const;

function normalizeCompatTag(value: unknown, fallback: string): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function normalizeRuntimeRoot(root: string): string {
  const slashNormalized = String(root || "/")
    .replace(/\\/g, "/")
    .trim()
    .replace(/\/+$/, "");
  if (!slashNormalized) {
    return "/";
  }
  return slashNormalized.startsWith("/") ? slashNormalized : `/${slashNormalized}`;
}

export function getRuntimeSaveCompatTag(
  runtimeVersion: NethackRuntimeVersion,
): string {
  const fallback = runtimeVersion === "3.7" ? "wasm-37" : "wasm-367";
  const rawCompatTag =
    runtimeVersion === "3.7"
      ? import.meta.env.VITE_NH3D_WASM_37_COMPAT_TAG
      : import.meta.env.VITE_NH3D_WASM_367_COMPAT_TAG;
  return normalizeCompatTag(rawCompatTag, fallback);
}

export function getRuntimeSaveMountDir(
  runtimeVersion: NethackRuntimeVersion,
  cwd = "/",
): string {
  void runtimeVersion;
  const normalizedRoot = normalizeRuntimeRoot(cwd);
  const saveLeaf = "save";
  return normalizedRoot === "/"
    ? `/${saveLeaf}`
    : `${normalizedRoot}/${saveLeaf}`;
}

export function getRuntimeSaveDbName(
  runtimeVersion: NethackRuntimeVersion,
  cwd = "/",
): string {
  const normalizedRoot = normalizeRuntimeRoot(cwd);
  const saveLeaf = `save-${getRuntimeSaveCompatTag(runtimeVersion)}`;
  return normalizedRoot === "/"
    ? `/${saveLeaf}`
    : `${normalizedRoot}/${saveLeaf}`;
}

export function getRuntimeSaveDbNames(
  runtimeVersion: NethackRuntimeVersion,
): string[] {
  return Array.from(
    new Set(
      knownSaveRuntimeRoots.map((root) =>
        getRuntimeSaveDbName(runtimeVersion, root),
      ),
    ),
  );
}
