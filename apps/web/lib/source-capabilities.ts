import type { SourceCategory } from "@/lib/source-taxonomy";
import { classifyCategoryByPlatform } from "@/lib/source-taxonomy";

export type SourceExecutionEngine = "gather_playwright" | "worker_api";

export type SourceCapabilityIntent = {
  key: string;
  intent: string;
  mode: string;
  sample?: {
    intentType?: string;
    intentArgs?: Record<string, unknown>;
    outputField?: unknown;
  };
};

export type SourceCapability = {
  platform: string;
  category: SourceCategory;
  execution: {
    engine: SourceExecutionEngine;
    driver: string;
  };
  tags: string[];
  authRequirement: {
    required: boolean;
    kind?: string;
    description?: string;
  };
  intents: SourceCapabilityIntent[];
};

type GatherCatalogItem = {
  key: string;
  platform: string;
  intent: string;
  mode: string;
  sample?: {
    intentType?: string;
    intentArgs?: Record<string, unknown>;
    outputField?: unknown;
  };
};

const DOMESTIC_PLATFORMS = new Set(["XIAOHONGSHU", "DOUYIN", "WEIBO"]);
const AUTH_REQUIRED_PLATFORMS = new Set([
  "X",
  "XIAOHONGSHU",
  "DOUYIN",
  "TIKTOK",
  "WEIBO",
  "WHATSAPP",
  "INSTAGRAM",
  "FACEBOOK",
]);

const WORKER_API_CAPABILITIES: SourceCapability[] = [
  {
    platform: "PARALLEL",
    category: "RETRIEVAL",
    execution: { engine: "worker_api", driver: "http" },
    tags: ["foreign"],
    authRequirement: {
      required: true,
      kind: "parallel-api-key",
      description: "Parallel API credential",
    },
    intents: [
      {
        key: "parallel.search.worker_api",
        intent: "search",
        mode: "api",
        sample: {
          intentType: "search",
          intentArgs: { query: "" },
        },
      },
    ],
  },
  {
    platform: "TAVILY",
    category: "RETRIEVAL",
    execution: { engine: "worker_api", driver: "http" },
    tags: ["foreign"],
    authRequirement: {
      required: true,
      kind: "tavily-api-key",
      description: "Tavily API credential",
    },
    intents: [
      {
        key: "tavily.search.worker_api",
        intent: "search",
        mode: "api",
        sample: {
          intentType: "search",
          intentArgs: { query: "" },
        },
      },
    ],
  },
  {
    platform: "ANSPIRE",
    category: "RETRIEVAL",
    execution: { engine: "worker_api", driver: "http" },
    tags: ["domestic"],
    authRequirement: {
      required: false,
    },
    intents: [
      {
        key: "anspire.search.worker_api",
        intent: "search",
        mode: "api",
        sample: {
          intentType: "search",
          intentArgs: { query: "" },
        },
      },
    ],
  },
  {
    platform: "GOOGLE",
    category: "RETRIEVAL",
    execution: { engine: "worker_api", driver: "http" },
    tags: ["foreign"],
    authRequirement: {
      required: false,
    },
    intents: [
      {
        key: "google.search.worker_api",
        intent: "search",
        mode: "api",
        sample: {
          intentType: "search",
          intentArgs: { query: "" },
        },
      },
    ],
  },
  {
    platform: "DARKWEBGO",
    category: "RETRIEVAL",
    execution: { engine: "worker_api", driver: "http" },
    tags: ["darknet", "tor"],
    authRequirement: {
      required: false,
    },
    intents: [
      {
        key: "darkwebgo.search.worker_api",
        intent: "search",
        mode: "api",
        sample: {
          intentType: "search",
          intentArgs: { query: "" },
        },
      },
    ],
  },
];

function normalizePlatform(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

export function getCredentialKindForPlatform(platform: string): string {
  const normalized = platform.trim().toLowerCase();
  if (!normalized) return "unknown-cookie";
  if (normalized === "x" || normalized === "twitter") return "x-cookie";
  if (normalized === "whatsapp") return "whatsapp-profile";
  return `${normalized}-cookie`;
}

export function requiresAuthForPlatform(platform: string): boolean {
  return AUTH_REQUIRED_PLATFORMS.has(normalizePlatform(platform));
}

export function getRegionTag(platform: string): "domestic" | "foreign" {
  return DOMESTIC_PLATFORMS.has(normalizePlatform(platform))
    ? "domestic"
    : "foreign";
}

export function buildGatherCapabilities(items: GatherCatalogItem[]): SourceCapability[] {
  const grouped = new Map<string, SourceCapability>();

  for (const item of items) {
    const platform = normalizePlatform(item.platform);
    if (!platform) continue;

    const existing = grouped.get(platform);
    if (existing) {
      existing.intents.push({
        key: item.key,
        intent: item.intent,
        mode: item.mode,
        sample: item.sample,
      });
      continue;
    }

    const category = classifyCategoryByPlatform(platform) ?? "RETRIEVAL";
    grouped.set(platform, {
      platform,
      category,
      execution: {
        engine: "gather_playwright",
        driver: "playwright",
      },
      tags: [getRegionTag(platform)],
      authRequirement: requiresAuthForPlatform(platform)
        ? {
            required: true,
            kind: getCredentialKindForPlatform(platform),
            description: `${platform} auth credential`,
          }
        : { required: false },
      intents: [
        {
          key: item.key,
          intent: item.intent,
          mode: item.mode,
          sample: item.sample,
        },
      ],
    });
  }

  for (const capability of grouped.values()) {
    capability.intents.sort((a, b) => a.intent.localeCompare(b.intent));
  }

  return Array.from(grouped.values()).sort((a, b) =>
    a.platform.localeCompare(b.platform)
  );
}

export function buildWorkerApiCapabilities(): SourceCapability[] {
  return WORKER_API_CAPABILITIES.map((item) => ({ ...item, intents: [...item.intents] }));
}

