export type SourceCategory = "STREAM" | "INTERACTIVE" | "RETRIEVAL";

export type SourceExecutionEngine = "gather_playwright" | "worker_api";

type PlatformMeta = {
  category: SourceCategory;
  region?: "domestic" | "foreign";
  auth?: {
    required: boolean;
    kind?: string;
    description?: string;
  };
};

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
  meta?: {
    category?: string;
    auth?: {
      required?: boolean;
      kind?: string;
      description?: string;
    };
    tags?: string[];
  };
};

type WorkerApiPlatformConfig = {
  platform: string;
  driver?: string;
  tags?: string[];
  auth?: {
    required: boolean;
    kind?: string;
    description?: string;
  };
  intents?: Array<{
    intent: string;
    mode?: string;
    sampleArgs?: Record<string, unknown>;
  }>;
};

const PLATFORM_META: Record<string, PlatformMeta> = {
  BBC: { category: "STREAM", region: "foreign", auth: { required: false } },
  REUTERS: {
    category: "STREAM",
    region: "foreign",
    auth: { required: true, kind: "reuters-cookie", description: "Reuters auth credential" },
  },

  X: {
    category: "INTERACTIVE",
    region: "foreign",
    auth: { required: true, kind: "x-cookie", description: "X auth credential" },
  },
  TWITTER: {
    category: "INTERACTIVE",
    region: "foreign",
    auth: { required: true, kind: "x-cookie", description: "X auth credential" },
  },
  XIAOHONGSHU: {
    category: "INTERACTIVE",
    region: "domestic",
    auth: {
      required: true,
      kind: "xhs-cookie",
      description: "Xiaohongshu auth credential",
    },
  },
  XHS: {
    category: "INTERACTIVE",
    region: "domestic",
    auth: {
      required: true,
      kind: "xhs-cookie",
      description: "Xiaohongshu auth credential",
    },
  },
  REDDIT: {
    category: "INTERACTIVE",
    region: "foreign",
    auth: { required: true, kind: "reddit-cookie", description: "Reddit auth credential" },
  },
  WEIBO: {
    category: "INTERACTIVE",
    region: "domestic",
    auth: { required: true, kind: "weibo-cookie", description: "Weibo auth credential" },
  },
  DOUYIN: {
    category: "INTERACTIVE",
    region: "domestic",
    auth: { required: true, kind: "douyin-cookie", description: "Douyin auth credential" },
  },
  TIKTOK: {
    category: "INTERACTIVE",
    region: "foreign",
    auth: { required: true, kind: "tiktok-cookie", description: "TikTok auth credential" },
  },
  YOUTUBE: {
    category: "INTERACTIVE",
    region: "foreign",
    auth: { required: true, kind: "youtube-cookie", description: "YouTube auth credential" },
  },
  TELEGRAM: {
    category: "INTERACTIVE",
    region: "foreign",
    auth: {
      required: true,
      kind: "telegram-cookie",
      description: "Telegram auth credential (cookie + localStorage)",
    },
  },
  INSTAGRAM: {
    category: "INTERACTIVE",
    region: "foreign",
    auth: {
      required: true,
      kind: "instagram-cookie",
      description: "Instagram auth credential",
    },
  },
  FACEBOOK: {
    category: "INTERACTIVE",
    region: "foreign",
    auth: {
      required: true,
      kind: "facebook-cookie",
      description: "Facebook auth credential",
    },
  },
  WHATSAPP: {
    category: "INTERACTIVE",
    region: "foreign",
    auth: {
      required: true,
      kind: "whatsapp-profile",
      description: "WhatsApp auth credential",
    },
  },
  LINKEDIN: {
    category: "INTERACTIVE",
    region: "foreign",
    auth: { required: true, kind: "linkedin-cookie", description: "LinkedIn auth credential" },
  },
  ZHIHU: {
    category: "INTERACTIVE",
    region: "domestic",
    auth: { required: true, kind: "zhihu-cookie", description: "Zhihu auth credential" },
  },
  BILIBILI: {
    category: "INTERACTIVE",
    region: "domestic",
    auth: { required: true, kind: "bilibili-cookie", description: "Bilibili auth credential" },
  },
  CNBLOGS: {
    category: "RETRIEVAL",
    region: "domestic",
    auth: { required: true, kind: "cnblogs-cookie", description: "CNBlogs auth credential" },
  },

  GOOGLE: {
    category: "RETRIEVAL",
    region: "foreign",
    auth: { required: true, kind: "google-cookie", description: "Google auth credential" },
  },
  BING: { category: "RETRIEVAL", region: "foreign", auth: { required: false } },
  BAIDU: { category: "RETRIEVAL", region: "domestic", auth: { required: false } },
  DUCKDUCKGO: { category: "RETRIEVAL", region: "foreign", auth: { required: false } },
  TAVILY: {
    category: "RETRIEVAL",
    region: "foreign",
    auth: {
      required: true,
      kind: "tavily-api-key",
      description: "Tavily API credential",
    },
  },
  PARALLEL: {
    category: "RETRIEVAL",
    region: "foreign",
    auth: {
      required: true,
      kind: "parallel-api-key",
      description: "Parallel API credential",
    },
  },
  ANSPIRE: { category: "RETRIEVAL", region: "domestic", auth: { required: false } },
  DARKWEBGO: { category: "RETRIEVAL", region: "foreign", auth: { required: false } },
  DARKSEARCH: { category: "RETRIEVAL", region: "foreign", auth: { required: false } },
};

const WORKER_API_PLATFORM_CONFIGS: WorkerApiPlatformConfig[] = [
  { platform: "PARALLEL" },
  { platform: "TAVILY" },
  { platform: "ANSPIRE" },
  { platform: "GOOGLE" },
  { platform: "DARKWEBGO", tags: ["darknet", "tor"] },
];

function normalizePlatform(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeAuthKind(platform: string): string {
  const normalized = platform.trim().toLowerCase();
  if (!normalized) return "unknown-cookie";
  if (normalized === "x" || normalized === "twitter") return "x-cookie";
  if (normalized === "whatsapp") return "whatsapp-profile";
  return `${normalized}-cookie`;
}

export function resolvePlatformMeta(platform: string | null | undefined): PlatformMeta | null {
  const normalized = normalizePlatform(platform);
  if (!normalized) return null;
  return PLATFORM_META[normalized] ?? null;
}

export function classifyCategoryByPlatform(
  platform: string | null | undefined
): SourceCategory | null {
  return resolvePlatformMeta(platform)?.category ?? null;
}

export function getCredentialKindForPlatform(platform: string): string {
  const meta = resolvePlatformMeta(platform);
  if (meta?.auth?.kind && meta.auth.kind.trim()) {
    return meta.auth.kind;
  }
  return normalizeAuthKind(platform);
}

export function requiresAuthForPlatform(platform: string): boolean {
  return resolvePlatformMeta(platform)?.auth?.required ?? false;
}

export function getRegionTag(platform: string): "domestic" | "foreign" {
  return resolvePlatformMeta(platform)?.region ?? "foreign";
}

function buildAuthRequirement(platform: string): {
  required: boolean;
  kind?: string;
  description?: string;
} {
  const meta = resolvePlatformMeta(platform);
  if (!meta?.auth || !meta.auth.required) {
    return { required: false };
  }
  return {
    required: true,
    kind: meta.auth.kind ?? getCredentialKindForPlatform(platform),
    description:
      meta.auth.description ?? `${normalizePlatform(platform)} auth credential`,
  };
}

function normalizeGatherCategory(value: unknown): SourceCategory | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === "STREAM") return "STREAM";
  if (normalized === "INTERACTIVE") return "INTERACTIVE";
  if (normalized === "RETRIEVAL") return "RETRIEVAL";
  return null;
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => String(item).trim())
        .filter(Boolean)
    )
  );
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

    const metaCategory = normalizeGatherCategory(item.meta?.category);
    const category =
      metaCategory ??
      classifyCategoryByPlatform(platform) ??
      "RETRIEVAL";
    const rawAuth = item.meta?.auth;
    const tags = normalizeTags(item.meta?.tags);
    const authMetaRequired = rawAuth?.required;
    const authRequirement =
      typeof authMetaRequired === "boolean"
        ? {
            required: authMetaRequired,
            kind:
              typeof rawAuth?.kind === "string" && rawAuth.kind.trim()
                ? rawAuth.kind.trim()
                : undefined,
            description:
              typeof rawAuth?.description === "string" && rawAuth.description.trim()
                ? rawAuth.description.trim()
                : undefined,
          }
        : buildAuthRequirement(platform);
    if (!metaCategory || typeof authMetaRequired !== "boolean") {
      tags.push("UNSPECIFIED");
    }
    grouped.set(platform, {
      platform,
      category,
      execution: {
        engine: "gather_playwright",
        driver: "playwright",
      },
      tags: Array.from(
        new Set([getRegionTag(platform), ...tags])
      ),
      authRequirement,
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
  return WORKER_API_PLATFORM_CONFIGS.map((config): SourceCapability => {
    const platform = normalizePlatform(config.platform);
    const category = classifyCategoryByPlatform(platform) ?? "RETRIEVAL";
    const tags = config.tags?.length
      ? [...config.tags]
      : [getRegionTag(platform)];
    const intents =
      config.intents && config.intents.length > 0
        ? config.intents
        : [{ intent: "search", mode: "api", sampleArgs: { query: "" } }];

    return {
      platform,
      category,
      execution: {
        engine: "worker_api",
        driver: config.driver ?? "http",
      },
      tags,
      authRequirement: config.auth ?? buildAuthRequirement(platform),
      intents: intents.map((intent) => ({
        key: `${platform.toLowerCase()}.${intent.intent}.worker_api`,
        intent: intent.intent,
        mode: intent.mode ?? "api",
        sample: {
          intentType: intent.intent,
          intentArgs: intent.sampleArgs ?? {},
        },
      })),
    };
  }).sort((a, b) => a.platform.localeCompare(b.platform));
}
