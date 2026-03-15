import { z } from "zod";

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
  includes: delimitedStringArray({ minItems: 1, itemMax: 40, totalMax: 200 }),
  excludes: delimitedStringArray({ minItems: 0, itemMax: 40, totalMax: 200 }),
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

export const SourceTypeEnum = z.enum([
  "WEB",
  "DARKNET",
  "SEARCH_ENGINE",
  "SOCIAL_MEDIA",
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
export const SocialPlatformEnum = z.enum(["X", "TELEGRAM", "REDDIT", "XIAOHONGSHU", "DOUYIN", "TIKTOK", "WEIBO", "WHATSAPP", "INSTAGRAM", "FACEBOOK"]);

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
  url: delimitedStringArray({ itemMin: 1, itemMax: 1024, totalMax: 50, minItems: 1 }),
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
  engine: SearchEngineKindEnum,
  query: z.string().min(1),
  region: z.string().optional().nullable(),
  lang: LangEnum,
  apiEndpoint: z.url().optional().nullable(),
  options: z.preprocess((val) => parseJson(val), z.record(z.string(), z.any()).optional().nullable()),
  customConfig: z.preprocess((val) => parseJson(val), z.any().optional().nullable()),
  credentialId: cuidOpt,
});

export const SocialConfigByPlatform = z.discriminatedUnion("platform", [
  z.object({
    platform: z.literal("X"),
    config: z
      .object({
        playwright: z.object({
          mode: z.enum(["eval-js"]).default("eval-js"),
          headless: z.boolean().default(false),
          targetUrl: z.string().url().default("https://x.com"),
          scriptPath: z.string().min(1),
          args: z.preprocess((val) => {
            const parsed = parseJson(val);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
              return {};
            }
            return Object.fromEntries(
              Object.entries(parsed as Record<string, unknown>).map(
                ([key, value]) => [key, value == null ? "" : String(value)]
              )
            );
          }, z.record(z.string().min(1), z.string()).default({})),
        }),
      })
      .refine((v) => Boolean(v.playwright.scriptPath), {
        message: "X: playwright scriptPath is required",
      }),
    credentialId: cuidOpt,
    proxyId: cuidOpt,
  }),
  z.object({
    platform: z.literal("REDDIT"),
    config: z.object({
      subreddit: z.string().min(1),
      sort: z.enum(["hot", "new", "top"]).optional(),
    }),
    credentialId: cuidOpt,
    proxyId: cuidOpt,
  }),
  z.object({
    platform: z.literal("XIAOHONGSHU"),
    config: z
      .object({
        userId: z.string().optional(),
        noteId: z.string().optional(),
        query: z.string().optional(),
      })
      .refine((v) => v.userId || v.noteId || v.query, {
        message: "Xiaohongshu: provide at least one of userId/noteId/query",
      }),
    credentialId: cuidOpt,
    proxyId: cuidOpt,
  }),
  z.object({
    platform: z.literal("DOUYIN"),
    config: z
      .object({
        userId: z.string().optional(),
        videoId: z.string().optional(),
        query: z.string().optional(),
      })
      .refine((v) => v.userId || v.videoId || v.query, {
        message: "Douyin: provide at least one of userId/videoId/query",
      }),
    credentialId: cuidOpt,
    proxyId: cuidOpt,
  }),
  z.object({
    platform: z.literal("TIKTOK"),
    config: z
      .object({
        username: z.string().optional(),
        videoId: z.string().optional(),
        query: z.string().optional(),
      })
      .refine((v) => v.username || v.videoId || v.query, {
        message: "TikTok: provide at least one of username/videoId/query",
      }),
    credentialId: cuidOpt,
    proxyId: cuidOpt,
  }),
  z.object({
    platform: z.literal("WEIBO"),
    config: z
      .object({
        userId: z.string().optional(),
        query: z.string().optional(),
        hotTopics: z.boolean().optional(),
      })
      .refine((v) => v.userId || v.query || v.hotTopics, {
        message: "Weibo: provide at least one of userId/query/hotTopics",
      }),
    credentialId: cuidOpt,
    proxyId: cuidOpt,
  }),
  z.object({
    platform: z.literal("TELEGRAM"),
    config: z
      .object({
        chatId: z.string().optional(),
        maxResults: z.number().optional(),
      }),
    credentialId: cuidOpt,
    proxyId: cuidOpt,
  }),
  z.object({
    platform: z.literal("WHATSAPP"),
    config: z
      .object({
        contactName: z.string().optional(),
        maxResults: z.number().optional(),
      }),
    credentialId: cuidOpt,
    proxyId: cuidOpt,
  }),
  z.object({
    platform: z.literal("INSTAGRAM"),
    config: z
      .object({
        username: z.string().optional(),
        postId: z.string().optional(),
        query: z.string().optional(),
        maxResults: z.number().optional(),
      }),
    credentialId: cuidOpt,
    proxyId: cuidOpt,
  }),
  z.object({
    platform: z.literal("FACEBOOK"),
    config: z
      .object({
        username: z.string().optional(),
        postId: z.string().optional(),
        query: z.string().optional(),
        maxResults: z.number().optional(),
      }),
    credentialId: cuidOpt,
    proxyId: cuidOpt,
  }),
]);

export const SourceBaseCreate = z.object({
  name: z.string().min(1).max(64),
  description: z.string().optional().nullable(),
  type: SourceTypeEnum,
  active: z.boolean().optional().default(true),
  rateLimit: z.number().int().min(1).max(600).optional().nullable(),
  proxyId: cuidOpt,
  credentialId: cuidOpt,
});

export const WebSourceCreateSchema = SourceBaseCreate.extend({
  type: z.literal("WEB"),
  web: WebConfigInput,
});

export const DarknetSourceCreateSchema = SourceBaseCreate.extend({
  type: z.literal("DARKNET"),
  darknet: DarknetConfigInput,
});

export const SearchEngineSourceCreateSchema = SourceBaseCreate.extend({
  type: z.literal("SEARCH_ENGINE"),
  search: SearchEngineConfigInput,
});

export const SocialMediaSourceCreateSchema = SourceBaseCreate.extend({
  type: z.literal("SOCIAL_MEDIA"),
  social: SocialConfigByPlatform,
});

export const SourceCreateSchema = z.discriminatedUnion("type", [
  WebSourceCreateSchema,
  DarknetSourceCreateSchema,
  SearchEngineSourceCreateSchema,
  SocialMediaSourceCreateSchema,
]);

// 为社交媒体更新创建单独的 schema
export const SocialConfigUpdateInput = z.object({
  platform: SocialPlatformEnum.optional(),
  config: z.any().optional(),
  credentialId: cuidOpt,
  proxyId: cuidOpt,
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
  search: SearchEngineConfigInput.partial().optional(),
  social: SocialConfigUpdateInput.optional(),
});

export const SourceQuerySchema = z.object({
  q: z.string().optional(),
  type: SourceTypeEnum.optional(),
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


export const QueryCreateSchema = z.object({
  name: z.string().min(1, "Name is required").max(64),
  description: z
    .string()
    .max(500, "Description must be less than 500 characters")
    .optional()
    .nullable(),
  frequency: QueryFrequencyEnum.optional().default("MANUAL"),
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
