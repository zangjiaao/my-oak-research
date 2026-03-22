import type { Source, SearchEngineSourceConfig, SocialMediaSourceConfig } from "@/app/generated/prisma";

export type SourceCategory = "STREAM" | "INTERACTIVE" | "RETRIEVAL";
export type SourceNetworkPolicy = "DEFAULT" | "TOR_SOCKS5H";

const DARKNET_PROVIDER_KEYWORDS = ["darkwebgo", "darksearch", "onion"];

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function hasDarknetProvider(options: unknown): boolean {
  const obj = asRecord(options);
  const provider = String(obj.provider ?? obj.engine ?? "").toLowerCase();
  return DARKNET_PROVIDER_KEYWORDS.some((item) => provider.includes(item));
}

export function classifySourceCategory(source: {
  type: Source["type"];
  search?: Pick<SearchEngineSourceConfig, "options"> | null;
  social?: Pick<SocialMediaSourceConfig, "platform"> | null;
}): SourceCategory {
  if (source.type === "SOCIAL_MEDIA") return "INTERACTIVE";
  if (source.type === "WEB") return "STREAM";
  if (source.type === "DARKNET") return "RETRIEVAL";
  if (source.type === "SEARCH_ENGINE") return "RETRIEVAL";
  return "RETRIEVAL";
}

export function detectDarknetTag(input: {
  type: Source["type"];
  search?: Pick<SearchEngineSourceConfig, "options"> | null;
}): boolean {
  if (input.type === "DARKNET") return true;
  if (input.type !== "SEARCH_ENGINE") return false;
  return hasDarknetProvider(input.search?.options);
}

export function displayCategoryLabel(category: SourceCategory): string {
  if (category === "STREAM") return "Stream";
  if (category === "INTERACTIVE") return "Interactive";
  return "Retrieval";
}
