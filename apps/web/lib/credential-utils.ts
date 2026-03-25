export function normalizePlatform(platform: string | null | undefined): string {
  return String(platform ?? "").trim().toLowerCase();
}

export function platformToCredentialKind(platform: string): string {
  const normalized = normalizePlatform(platform);
  if (!normalized) return "unknown-cookie";
  if (normalized === "x" || normalized === "twitter") return "x-cookie";
  if (
    normalized === "xhs" ||
    normalized === "xiaohongshu" ||
    normalized === "rednote" ||
    normalized === "little_red_book"
  ) {
    return "xhs-cookie";
  }
  if (normalized === "whatsapp") return "whatsapp-profile";
  if (normalized === "parallel") return "parallel-api-key";
  if (normalized === "tavily" || normalized === "travel") return "tavily-api-key";
  if (normalized === "anspire") return "anspire-api-key";
  return `${normalized}-cookie`;
}

export function kindToPlatform(kind: string): string {
  const normalized = String(kind ?? "").trim().toLowerCase();
  if (normalized === "x-cookie") return "x";
  if (normalized === "xhs-cookie" || normalized === "xiaohongshu-cookie") {
    return "xiaohongshu";
  }
  if (normalized === "whatsapp-profile") return "whatsapp";
  if (normalized === "parallel-api-key") return "parallel";
  if (normalized === "tavily-api-key") return "tavily";
  if (normalized === "anspire-api-key") return "anspire";
  if (normalized.endsWith("-cookie")) {
    return normalized.slice(0, -"cookie".length - 1);
  }
  if (normalized.endsWith("-api-key")) {
    return normalized.slice(0, -"-api-key".length);
  }
  return normalized;
}

export function isApiKeyKind(kind: string): boolean {
  return kind.toLowerCase().endsWith("-api-key");
}

export function buildCredentialStorageKey(input: {
  kind: string;
  credentialId?: string | null;
  ext: "json" | "zip";
}): string {
  const safeKind = input.kind.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  const idPart = input.credentialId?.trim() || "pending";
  const now = Date.now();
  const nonce = Math.random().toString(36).slice(2, 8);
  return `credentials/${safeKind}/${idPart}/${now}_${nonce}.${input.ext}`;
}
