import type {
  Source,
  SearchEngineSourceConfig,
  SocialMediaSourceConfig,
} from "@/app/generated/prisma";
import { classifyCategoryByPlatform } from "@/lib/source-capabilities";

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

function normalizeCategory(value: unknown): SourceCategory | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === "STREAM") return "STREAM";
  if (normalized === "INTERACTIVE") return "INTERACTIVE";
  if (normalized === "RETRIEVAL") return "RETRIEVAL";
  return null;
}

export function classifySourceCategory(source: {
  type: Source["type"];
  search?: Pick<SearchEngineSourceConfig, "options"> | null;
  social?: Pick<SocialMediaSourceConfig, "platform" | "config"> | null;
  searchPlatform?: string | null;
}): SourceCategory {
  const configCategory = normalizeCategory(
    asRecord(source.social?.config).category
  );
  if (configCategory) {
    return configCategory;
  }

  const socialCategory = classifyCategoryByPlatform(source.social?.platform);
  if (socialCategory) {
    return socialCategory;
  }
  const searchCategory = classifyCategoryByPlatform(source.searchPlatform);
  if (searchCategory) {
    return searchCategory;
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
