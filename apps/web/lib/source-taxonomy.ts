import type { Source, SearchEngineSourceConfig, SocialMediaSourceConfig } from "@/app/generated/prisma";

export type SourceCategory = "STREAM" | "INTERACTIVE" | "RETRIEVAL";
export type SourceNetworkPolicy = "DEFAULT" | "TOR_SOCKS5H";

const DARKNET_PROVIDER_KEYWORDS = ["darkwebgo", "darksearch", "onion"];
const PLATFORM_CATEGORY_OVERRIDES: Record<string, SourceCategory> = {
  BBC: "STREAM",
  REUTERS: "STREAM",
  X: "INTERACTIVE",
  TWITTER: "INTERACTIVE",
  XIAOHONGSHU: "INTERACTIVE",
  REDDIT: "INTERACTIVE",
  WEIBO: "INTERACTIVE",
  DOUYIN: "INTERACTIVE",
  TIKTOK: "INTERACTIVE",
  YOUTUBE: "INTERACTIVE",
  TELEGRAM: "INTERACTIVE",
  INSTAGRAM: "INTERACTIVE",
  FACEBOOK: "INTERACTIVE",
  WHATSAPP: "INTERACTIVE",
  GOOGLE: "RETRIEVAL",
  BING: "RETRIEVAL",
  BAIDU: "RETRIEVAL",
  DUCKDUCKGO: "RETRIEVAL",
  TAVILY: "RETRIEVAL",
  PARALLEL: "RETRIEVAL",
  ANSPIRE: "RETRIEVAL",
  DARKWEBGO: "RETRIEVAL",
  DARKSEARCH: "RETRIEVAL",
};

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
  searchPlatform?: string | null;
}): SourceCategory {
  const socialPlatform = String(source.social?.platform ?? "").trim().toUpperCase();
  if (socialPlatform && PLATFORM_CATEGORY_OVERRIDES[socialPlatform]) {
    return PLATFORM_CATEGORY_OVERRIDES[socialPlatform];
  }
  const searchPlatform = String(source.searchPlatform ?? "").trim().toUpperCase();
  if (searchPlatform && PLATFORM_CATEGORY_OVERRIDES[searchPlatform]) {
    return PLATFORM_CATEGORY_OVERRIDES[searchPlatform];
  }

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
