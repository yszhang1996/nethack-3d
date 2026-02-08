export function resolveRuntimeAssetUrl(assetPath: string): string {
  const normalizedAsset = String(assetPath || "").replace(/^\/+/, "");
  const baseUrl =
    typeof import.meta !== "undefined" &&
    (import.meta as any).env &&
    typeof (import.meta as any).env.BASE_URL === "string"
      ? (import.meta as any).env.BASE_URL
      : "/";
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}${normalizedAsset}`;
}
