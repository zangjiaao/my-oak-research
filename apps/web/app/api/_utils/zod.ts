import { z } from "zod";
import {
  getDefaultDriver,
  supportsDriver,
} from "@/lib/social-driver-support";

export const LangEnum = z
  .enum(["zh", "en", "ja", "auto"])
  .optional()
  .default("auto");

export const CategoryCreateSchema = z.object({
  name: z.string().min(1, "Name is required").max(64),
  description: z
    .string()
    .max(500, "Description must be less than 500 characters")
    .optional()
    .nullable(),
});

export const CategoryUpdateSchema = z.object({
  name: z.string().min(1, "Name is required").max(64).optional(),
  description: z
    .string()
    .max(500, "Description must be less than 500 characters")
    .optional()
    .nullable(),
});

const SPLIT_RE = /[,\n\r，、;；\t]+/g;

const cuid = z.cuid();
const cuidOpt = z.cuid().optional().nullable();

function toStringArray(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.map((x) => String(x).trim()).filter(Boolean);
  }
  const raw = String(input ?? "").trim();
  if (!raw) return [];
  return raw
    .split(SPLIT_RE)
    .map((s) => s.trim())
    .filter(Boolean);
}

function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

function delimitedStringArray({
  itemMax,
  totalMax,
  itemMin = 1,
  minItems = 0,
}: {
  itemMax: number;
  totalMax: number;
  itemMin?: number;
  minItems?: number;
}) {
  return z
    .preprocess(
      (val) => toStringArray(val),
      z.array(z.string().min(itemMin).max(itemMax))
    )
    .transform(uniq)
    .refine((arr) => arr.length >= minItems, {
      message: `Must have at least ${minItems} items`,
    })
    .refine((arr) => arr.length <= totalMax, {
      message: `Must be less than ${totalMax} items`,
    })
    .default([]);
}

export const KeywordCreateSchema = z.object({
  name: z.string().min(1, "Name is required").max(64),
  description: z
    .string()
    .max(500, "Description must be less than 500 characters")
    .optional()
    .nullable(),
  lang: LangEnum,
  categoryId: cuidOpt,
  deriveSourceId: cuidOpt,
  includes: delimitedStringArray({ minItems: 1, itemMax: 40, totalMax: 200 }),
  excludes: delimitedStringArray({ minItems: 0, itemMax: 40, totalMax: 200 }),
  deriveLanguages: delimitedStringArray({
    minItems: 1,
    itemMax: 20,
    totalMax: 12,
  }).default(["zh", "en"]),
  enableAiExpand: z.boolean().optional().default(false),
  synonyms: delimitedStringArray({
    minItems: 0,
    itemMax: 40,
    totalMax: 400,
  }).optional(),
  active: z.boolean().optional().default(true),
});

export const KeywordUpdateSchema = KeywordCreateSchema.partial();

export const KeywordQuerySchema = z.object({
  q: z.string().optional(),
  categoryId: cuidOpt,
  lang: LangEnum,
  active: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
});

export type KeywordQuery = z.infer<typeof KeywordQuerySchema>;

export const SourceCategoryEnum = z.enum([
  "STREAM",
  "INTERACTIVE",
  "RETRIEVAL",
]);
export const CrawlerEngineEnum = z.enum([
  "FETCH",
  "CHEERIO",
  "PLAYWRIGHT",
  "PUPPETEER",
  "CUSTOM",
]);
export const SearchEngineKindEnum = z.enum([
  "GOOGLE",
  "BING",
  "DDG",
  "SEARXNG",
  "CUSTOM",
]);
export const SearchPlatformEnum = z.enum([
  "PARALLEL",
  "TAVILY",
  "ANSPIRE",
  "CUSTOM",
]);
export const KeywordStrategyEnum = z.enum([
  "AUTO",
  "RECALL_ONLY",
  "PRECISION_ONLY",
  "HYBRID",
]);
export const SocialPlatformEnum = z.enum(["X", "REDDIT", "XIAOHONGSHU", "DOUYIN", "TIKTOK", "WEIBO", "WHATSAPP", "INSTAGRAM", "FACEBOOK"]);
export const SocialDriverEnum = z.enum(["xhttp", "playwright"]);
const GatherResponseFormatEnum = z.enum(["text", "markdown"]);
const GatherResponseFormatsInput = z
  .array(GatherResponseFormatEnum)
  .min(1)
  .default(["text", "markdown"]);

const KeywordFilterInput = z
  .object({
    keywords: delimitedStringArray({
      itemMin: 1,
      itemMax: 128,
      totalMax: 64,
      minItems: 0,
    }).default([]),
    matchScope: z.enum(["segment", "full"]).optional(),
    splitMode: z.enum(["line", "paragraph", "auto"]).optional(),
    minSegmentChars: z.number().int().min(0).optional(),
  })
  .optional()
  .nullable();

function parseJson(val: unknown) {
  if (val === "") return undefined;
  if (typeof val === "string") {
    try {
      const parse = JSON.parse(val);
      return parse;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_unused) {
      return val;
    }
  }
  return val;
}

export const WebConfigInput = z.object({
  url: delimitedStringArray({ itemMin: 1, itemMax: 1024, totalMax: 50, minItems: 0 }),
  headers: z.preprocess((val) => parseJson(val), z.record(z.string(), z.string()).optional().nullable()),
  crawlerEngine: CrawlerEngineEnum.optional().default("FETCH"),
  crawlerConfig: z.preprocess((val) => parseJson(val), z.any().optional().nullable()),
  render: z.boolean().optional().default(false),
  parseRules: z.preprocess((val) => parseJson(val), z.record(z.string(), z.any()).optional().nullable()),
  robotsRespect: z.boolean().optional().default(true),
  proxyId: cuidOpt,
});

export const DarknetConfigInput = z.object({
  url: delimitedStringArray({ itemMin: 1, itemMax: 1024, totalMax: 50, minItems: 1 }), // .onion 也可能不是严格的 url()，放宽
  headers: z.preprocess((val) => parseJson(val), z.record(z.string(), z.string()).optional().nullable()),
  crawlerEngine: CrawlerEngineEnum.optional().default("FETCH"),
  crawlerConfig: z.preprocess((val) => parseJson(val), z.any().optional().nullable()),
  // Darknet 通常强制使用代理（TOR/SOCKS5）
  proxyId: cuid, // 改为必需
  render: z.boolean().optional().default(false),
  parseRules: z.preprocess((val) => parseJson(val), z.record(z.string(), z.any()).optional().nullable()),
});

export const SearchEngineConfigInput = z.object({
  platform: SearchPlatformEnum.default("PARALLEL"),
  engine: SearchEngineKindEnum.optional().default("CUSTOM"),
  objective: z
    .string()
    .optional()
    .transform((value) => value?.trim() ?? ""),
  apiEndpoint: z.url().optional().nullable(),
  options: z.preprocess((val) => parseJson(val), z.record(z.string(), z.any()).optional().nullable()),
  customConfig: z.preprocess((val) => parseJson(val), z.any().optional().nullable()),
  credentialId: cuidOpt,
  keywordStrategy: KeywordStrategyEnum.optional().default("AUTO"),
});

export const SearchEngineConfigUpdateInput = z.object({
  platform: SearchPlatformEnum.optional(),
  engine: SearchEngineKindEnum.optional(),
  objective: z
    .string()
    .optional()
    .transform((value) => value?.trim()),
  apiEndpoint: z.url().optional().nullable(),
  options: z.preprocess((val) => parseJson(val), z.record(z.string(), z.any()).optional().nullable()),
  customConfig: z.preprocess((val) => parseJson(val), z.any().optional().nullable()),
  credentialId: cuidOpt,
  keywordStrategy: KeywordStrategyEnum.optional(),
});

const PlaywrightConfigInput = z.object({
  mode: z.string().trim().min(1).default("eval-js"),
  headless: z.boolean().default(false),
  poolEnabled: z.boolean().default(true),
  poolIdleTimeoutMs: z.coerce.number().int().min(1000).default(120000),
  targetUrl: z.preprocess(
    (val) => (typeof val === "string" && !val.trim() ? undefined : val),
    z.string().url().optional()
  ),
  scriptPath: z.string().min(1).optional(),
  args: z.preprocess((val) => {
    const parsed = parseJson(val);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [
        key,
        value == null ? "" : String(value),
      ])
    );
  }, z.record(z.string().min(1), z.string()).default({})),
});

const GatherIntentInput = z.object({
  type: z.string().trim().min(1).default("search"),
  args: z.preprocess((val) => parseJson(val), z.record(z.string(), z.unknown()).default({})),
  recallBinding: z
    .object({
      enabled: z.boolean().optional().default(true),
      argKeys: delimitedStringArray({
        itemMin: 1,
        itemMax: 64,
        totalMax: 8,
        minItems: 1,
      }).default(["query"]),
    })
    .optional()
    .default({
      enabled: true,
      argKeys: ["query"],
    }),
});

const SocialConfigInput = z
  .object({
    driver: SocialDriverEnum.optional(),
    intent: GatherIntentInput.default({
      type: "search",
      args: {},
      recallBinding: {
        enabled: true,
        argKeys: ["query"],
      },
    }),
    responseFormats: GatherResponseFormatsInput,
    keywordFilter: KeywordFilterInput,
    playwright: PlaywrightConfigInput.optional(),
    subreddit: z.string().min(1).optional(),
    sort: z.enum(["hot", "new", "top"]).optional(),
    userId: z.string().optional(),
    noteId: z.string().optional(),
    query: z.string().optional(),
    videoId: z.string().optional(),
    username: z.string().optional(),
    hotTopics: z.boolean().optional(),
    chatId: z.string().optional(),
    maxResults: z.number().optional(),
    contactName: z.string().optional(),
    postId: z.string().optional(),
  })
  .passthrough();

export const SocialConfigByPlatform = z
  .object({
    platform: z
      .string()
      .trim()
      .min(1, "Platform is required")
      .transform((value) => value.toUpperCase()),
    config: SocialConfigInput,
    credentialId: cuidOpt,
    proxyId: cuidOpt,
    keywordStrategy: KeywordStrategyEnum.optional().default("AUTO"),
  })
  .transform((payload) => ({
    ...payload,
    config: {
      ...payload.config,
      driver: payload.config.driver ?? getDefaultDriver(payload.platform),
    },
  }))
  .superRefine((payload, ctx) => {
    const platform = payload.platform;
    const driver = payload.config.driver;
    if (!supportsDriver(platform, driver)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["config", "driver"],
        message: `${platform}: unsupported driver`,
      });
    }
    if (
      platform === "XIAOHONGSHU" &&
      !payload.config.userId &&
      !payload.config.noteId &&
      !payload.config.query
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["config", "query"],
        message: "Xiaohongshu: provide at least one of userId/noteId/query",
      });
    }
    if (platform === "DOUYIN" && !payload.config.userId && !payload.config.videoId && !payload.config.query) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["config"],
        message: "Douyin: provide at least one of userId/videoId/query",
      });
    }
    if (platform === "TIKTOK" && !payload.config.username && !payload.config.videoId && !payload.config.query) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["config"],
        message: "TikTok: provide at least one of username/videoId/query",
      });
    }
    if (platform === "WEIBO" && !payload.config.userId && !payload.config.query && !payload.config.hotTopics) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["config"],
        message: "Weibo: provide at least one of userId/query/hotTopics",
      });
    }
  });

export const SourceBaseCreate = z.object({
  name: z.string().min(1).max(64),
  description: z.string().optional().nullable(),
  category: SourceCategoryEnum,
  isDarknet: z.boolean().optional().default(false),
  active: z.boolean().optional().default(true),
  rateLimit: z.number().int().min(1).max(600).optional().nullable(),
  proxyId: cuidOpt,
  credentialId: cuidOpt,
});

export const WebSourceCreateSchema = SourceBaseCreate.extend({
  category: z.literal("STREAM"),
  web: WebConfigInput,
});

export const DarknetSourceCreateSchema = SourceBaseCreate.extend({
  category: z.literal("RETRIEVAL"),
  isDarknet: z.literal(true),
  darknet: DarknetConfigInput,
});

export const SearchEngineSourceCreateSchema = SourceBaseCreate.extend({
  category: z.literal("RETRIEVAL"),
  isDarknet: z.literal(false).optional().default(false),
  search: SearchEngineConfigInput,
});

export const SocialMediaSourceCreateSchema = SourceBaseCreate.extend({
  category: z.literal("INTERACTIVE"),
  social: SocialConfigByPlatform,
});

export const SourceCreateSchema = z.union([
  WebSourceCreateSchema,
  DarknetSourceCreateSchema,
  SearchEngineSourceCreateSchema,
  SocialMediaSourceCreateSchema,
]);

// 为社交媒体更新创建单独的 schema
export const SocialConfigUpdateInput = z.object({
  platform: z
    .string()
    .trim()
    .min(1)
    .transform((value) => value.toUpperCase())
    .optional(),
  config: z.any().optional(),
  credentialId: cuidOpt,
  proxyId: cuidOpt,
  keywordStrategy: KeywordStrategyEnum.optional(),
});

export const SourceUpdateSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  description: z.string().optional().nullable(),
  active: z.boolean().optional(),
  rateLimit: z.number().int().min(1).max(600).optional().nullable(),
  proxyId: cuidOpt,
  credentialId: cuidOpt,
  // 子配置：
  web: WebConfigInput.partial().optional(),
  darknet: DarknetConfigInput.partial().optional(),
  search: SearchEngineConfigUpdateInput.optional(),
  social: SocialConfigUpdateInput.optional(),
});

export const SourceQuerySchema = z.object({
  q: z.string().optional(),
  category: SourceCategoryEnum.optional(),
  isDarknet: z.enum(["true", "false"]).optional(),
  active: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
});

export const SourceTestSchema = SourceCreateSchema;

// Proxy schemas
export const ProxyTypeEnum = z.enum([
  "HTTP",
  "HTTPS",
  "SOCKS4",
  "SOCKS5",
  "TOR",
]);

export const ProxyCreateSchema = z.object({
  name: z.string().min(1, "Name is required").max(64),
  type: ProxyTypeEnum,
  url: z.string().min(1, "URL is required").url("Invalid URL format"),
  active: z.boolean().optional().default(true),
});

export const ProxyUpdateSchema = ProxyCreateSchema.partial();

export const ProxyQuerySchema = z.object({
  q: z.string().optional(),
  type: ProxyTypeEnum.optional(),
  active: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
});

export type ProxyQuery = z.infer<typeof ProxyQuerySchema>;

export const QueryFrequencyEnum = z.enum([
  "MANUAL",
  "HOURLY",
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "CRONTAB",
]);

export const QueryContentFilterModeEnum = z.enum([
  "TERM_AND_WORD_BOUNDARY",
  "CONTAINS",
  "SMART",
]);

const QuerySourcePolicyInput = z.object({
  sourceId: z.string().cuid(),
  contentFilterEnabled: z.boolean().optional().default(true),
  contentFilterMode: QueryContentFilterModeEnum.optional().default("TERM_AND_WORD_BOUNDARY"),
});


export const QueryCreateSchema = z.object({
  name: z.string().min(1, "Name is required").max(64),
  description: z
    .string()
    .max(500, "Description must be less than 500 characters")
    .optional()
    .nullable(),
  frequency: QueryFrequencyEnum.optional().default("MANUAL"),
  rateLimit: z.number().int().min(1).max(600).optional().nullable(),
  cronSchedule: z.string().optional().nullable(),
  enabled: z.boolean().optional().default(true),
  keywordIds: z.preprocess(
    (val) => {
      if (Array.isArray(val)) {
        return val.map((item) => (typeof item === "object" && "id" in item ? item.id : item));
      }
      return val;
    },
    z.array(z.string().cuid()).optional().default([])
  ),
  sourceIds: z.preprocess(
    (val) => {
      if (Array.isArray(val)) {
        return val.map((item) => (typeof item === "object" && "id" in item ? item.id : item));
      }
      return val;
    },
    z.array(z.string().cuid()).optional().default([])
  ),
  rules: z.preprocess((val) => parseJson(val), z.any().optional().nullable()),
  sourcePolicies: z.preprocess(
    (val) => parseJson(val),
    z.array(QuerySourcePolicyInput).optional().default([])
  ),
}).superRefine((data, ctx) => {
  if (data.frequency === "CRONTAB" && !data.cronSchedule) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["cronSchedule"],
      message: "Cron schedule is required when frequency is CRONTAB",
    });
  }
  if (data.frequency !== "CRONTAB" && data.cronSchedule) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["cronSchedule"],
      message: "Cron schedule should not be set unless frequency is CRONTAB",
    });
  }
});

export const QueryUpdateSchema = QueryCreateSchema.partial().superRefine((data, ctx) => {
  // Conditional validation for updates: if frequency is set to CRONTAB, cronSchedule must be present
  if (data.frequency === "CRONTAB" && !data.cronSchedule) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["cronSchedule"],
      message: "Cron schedule is required when frequency is CRONTAB",
    });
  }
  // If frequency is explicitly set to something other than CRONTAB, cronSchedule should be null/undefined
  if (data.frequency && data.frequency !== "CRONTAB" && data.cronSchedule) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["cronSchedule"],
      message: "Cron schedule should not be set unless frequency is CRONTAB",
    });
  }
});

export const TopicTermTypeEnum = z.enum(["CORE", "EXPANSION", "EXCLUSION"]);
export const TopicRecallLanguageEnum = z.enum(["zh", "en", "ja"]);

export const TopicTermInputSchema = z.object({
  type: TopicTermTypeEnum,
  value: z.string().min(1).max(128),
  weight: z.number().min(0).max(5).optional().default(1),
  meta: z.preprocess((val) => parseJson(val), z.any().optional().nullable()),
});

export const TopicCreateSchema = z
  .object({
    name: z.string().min(1, "Name is required").max(64),
    description: z
      .string()
      .max(500, "Description must be less than 500 characters")
      .optional()
      .nullable(),
    profile: z.preprocess((val) => parseJson(val), z.any().optional().nullable()),
    recallLanguages: z.array(TopicRecallLanguageEnum).optional(),
    terms: z.array(TopicTermInputSchema).optional().default([]),
  });

export const TopicUpdateSchema = TopicCreateSchema.partial();

export const JobTypeEnum = z.enum([
  "TOPIC_RETRIEVAL",
  "SOURCE_INGEST",
  "SOURCE_ONESHOT",
]);

export const RecallBindingOverrideSchema = z.object({
  enabled: z.boolean().optional().default(true),
  argKeys: delimitedStringArray({
    itemMin: 1,
    itemMax: 64,
    totalMax: 8,
    minItems: 0,
  }).optional().default([]),
});

export const JobSourceBindingInputSchema = z.object({
  sourceId: z.string().cuid(),
  recallBindingOverride: z
    .preprocess((val) => parseJson(val), RecallBindingOverrideSchema.optional().nullable())
    .optional(),
});

export const JobCreateSchema = z
  .object({
    name: z.string().min(1, "Name is required").max(64),
    type: JobTypeEnum,
    enabled: z.boolean().optional().default(true),
    frequency: QueryFrequencyEnum.optional().default("MANUAL"),
    cronSchedule: z.string().optional().nullable(),
    triggerMode: z.string().optional().nullable(),
    config: z.preprocess((val) => parseJson(val), z.any().optional().nullable()),
    topicIds: z.preprocess(
      (val) => {
        if (Array.isArray(val)) {
          return val.map((item) =>
            typeof item === "object" && item && "id" in item
              ? (item as { id: string }).id
              : item
          );
        }
        return val;
      },
      z.array(z.string().cuid()).optional().default([])
    ),
    sourceBindings: z.preprocess(
      (val) => parseJson(val),
      z.array(JobSourceBindingInputSchema).optional().default([])
    ),
  })
  .superRefine((data, ctx) => {
    if (data.frequency === "CRONTAB" && !data.cronSchedule) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cronSchedule"],
        message: "Cron schedule is required when frequency is CRONTAB",
      });
    }
    if (data.frequency !== "CRONTAB" && data.cronSchedule) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cronSchedule"],
        message: "Cron schedule should not be set unless frequency is CRONTAB",
      });
    }
    if (data.type === "TOPIC_RETRIEVAL") {
      if (data.topicIds.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["topicIds"],
          message: "TOPIC_RETRIEVAL job requires at least one topic",
        });
      }
      if (data.sourceBindings.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sourceBindings"],
          message: "TOPIC_RETRIEVAL job requires at least one source",
        });
      }
    }
    if (
      (data.type === "SOURCE_INGEST" || data.type === "SOURCE_ONESHOT") &&
      data.sourceBindings.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceBindings"],
        message: `${data.type} job requires at least one source`,
      });
    }
  });

export const JobUpdateSchema = JobCreateSchema.partial().superRefine((data, ctx) => {
  if (data.frequency === "CRONTAB" && !data.cronSchedule) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["cronSchedule"],
      message: "Cron schedule is required when frequency is CRONTAB",
    });
  }
  if (data.frequency && data.frequency !== "CRONTAB" && data.cronSchedule) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["cronSchedule"],
      message: "Cron schedule should not be set unless frequency is CRONTAB",
    });
  }
});
