import { createHash } from "node:crypto";

import { Prisma, SourceType } from "@/app/generated/prisma";
import {
  getSupportedDrivers,
  type KnownSocialPlatform,
  type SocialDriver,
} from "@/lib/social-driver-support";

type JsonObject = Record<string, unknown>;

export type BatchCredentialRequirement = {
  kind: string;
  required: boolean;
  description: string;
};

export type BatchTemplate = {
  key: string;
  type: SourceType;
  platform: string;
  driver: string;
  intent: {
    type: string;
    args: Record<string, unknown>;
  };
  title: string;
  description: string;
  defaultConfig: Record<string, unknown>;
  requiredFields: string[];
  credentialRequirements: BatchCredentialRequirement[];
};

export type BatchIdentity = {
  type: SourceType;
  platform: string;
  driver: string;
  intentType: string;
  intentArgsHash: string;
};

const SOCIAL_PLATFORMS: KnownSocialPlatform[] = [
  "X",
  "REDDIT",
  "XIAOHONGSHU",
  "DOUYIN",
  "TIKTOK",
  "WEIBO",
  "TELEGRAM",
  "WHATSAPP",
  "INSTAGRAM",
  "FACEBOOK",
];

const REQUIRED_SOCIAL_ARGS: Record<KnownSocialPlatform, string[]> = {
  X: ["query"],
  REDDIT: ["subreddit"],
  XIAOHONGSHU: ["query"],
  DOUYIN: ["query"],
  TIKTOK: ["query"],
  WEIBO: ["query"],
  TELEGRAM: ["chatId"],
  WHATSAPP: ["contactName"],
  INSTAGRAM: ["query"],
  FACEBOOK: ["query"],
};

const CREDENTIAL_REQUIRED_SOCIAL = new Set<KnownSocialPlatform>([
  "X",
  "XIAOHONGSHU",
  "DOUYIN",
  "TIKTOK",
  "WEIBO",
  "WHATSAPP",
  "INSTAGRAM",
  "FACEBOOK",
]);

const SEARCH_PLATFORMS = ["PARALLEL", "TAVILY", "ANSPIRE", "CUSTOM"] as const;

function credentialKindForPlatform(platform: string): string {
  const normalized = platform.trim().toLowerCase();
  if (!normalized) return "unknown-cookie";
  if (normalized === "x" || normalized === "twitter") return "x-cookie";
  if (normalized === "whatsapp") return "whatsapp-profile";
  return `${normalized}-cookie`;
}

function buildSocialTemplates(): BatchTemplate[] {
  const templates: BatchTemplate[] = [];

  for (const platform of SOCIAL_PLATFORMS) {
    const drivers = getSupportedDrivers(platform) as readonly SocialDriver[];
    for (const driver of drivers) {
      const requiredArgs = REQUIRED_SOCIAL_ARGS[platform] ?? [];
      const baseArgs = Object.fromEntries(requiredArgs.map((field) => [field, ""]));
      templates.push({
        key: `social:${platform}:${driver}:search`,
        type: "SOCIAL_MEDIA",
        platform,
        driver,
        intent: { type: "search", args: baseArgs },
        title: `${platform} / ${driver}`,
        description: `Collect ${platform} data with ${driver}.`,
        defaultConfig: {
          intent: { type: "search", args: baseArgs },
          driver,
          keywordStrategy: "AUTO",
        },
        requiredFields: requiredArgs.map((field) => `intent.args.${field}`),
        credentialRequirements: CREDENTIAL_REQUIRED_SOCIAL.has(platform)
          ? [
              {
                kind: credentialKindForPlatform(platform),
                required: true,
                description: `${platform} auth credential`,
              },
            ]
          : [],
      });
    }
  }

  return templates;
}

function buildSearchTemplates(): BatchTemplate[] {
  return SEARCH_PLATFORMS.map((platform) => ({
    key: `search:${platform}:builtin:search`,
    type: "SEARCH_ENGINE",
    platform,
    driver: "builtin",
    intent: { type: "search", args: {} },
    title: `${platform} Search`,
    description: `Query via ${platform}.`,
    defaultConfig: {
      platform,
      engine: "CUSTOM",
      objective: "",
      apiEndpoint: null,
      options: {},
      keywordStrategy: "AUTO",
    },
    requiredFields: ["objective"],
    credentialRequirements:
      platform === "CUSTOM"
        ? []
        : [
            {
              kind: `${platform.toLowerCase()}-api-key`,
              required: true,
              description: `${platform} API credential`,
            },
          ],
  }));
}

export const SOURCE_BATCH_TEMPLATES: BatchTemplate[] = [
  {
    key: "web:WEB:builtin:crawl",
    type: "WEB",
    platform: "WEB",
    driver: "builtin",
    intent: { type: "crawl", args: {} },
    title: "Web Site Crawl",
    description: "Crawl public websites.",
    defaultConfig: {
      url: "",
      crawlerEngine: "FETCH",
      render: false,
      robotsRespect: true,
      headers: null,
      parseRules: null,
    },
    requiredFields: ["url"],
    credentialRequirements: [],
  },
  {
    key: "darknet:DARKNET:builtin:crawl",
    type: "DARKNET",
    platform: "DARKNET",
    driver: "builtin",
    intent: { type: "crawl", args: {} },
    title: "Darknet Crawl",
    description: "Crawl darknet endpoints via proxy.",
    defaultConfig: {
      url: "",
      crawlerEngine: "FETCH",
      render: false,
      headers: null,
      parseRules: null,
      proxyId: "",
    },
    requiredFields: ["url", "proxyId"],
    credentialRequirements: [],
  },
  ...buildSearchTemplates(),
  ...buildSocialTemplates(),
];

export const SOURCE_BATCH_TEMPLATE_MAP = new Map(
  SOURCE_BATCH_TEMPLATES.map((item) => [item.key, item])
);

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entryValue]) => `"${key}":${stableStringify(entryValue)}`);
  return `{${entries.join(",")}}`;
}

function getByPath(input: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((acc, segment) => {
      if (acc == null) return undefined;
      if (Array.isArray(acc)) {
        const index = Number(segment);
        return Number.isInteger(index) ? acc[index] : undefined;
      }
      if (typeof acc === "object") {
        return (acc as Record<string, unknown>)[segment];
      }
      return undefined;
    }, input);
}

export function listMissingRequiredFields(
  template: BatchTemplate,
  config: Record<string, unknown>
): string[] {
  const merged = {
    ...template.defaultConfig,
    ...config,
  };
  return template.requiredFields.filter((field) => {
    const value = getByPath(merged, field);
    return isEmptyValue(value);
  });
}

function normalizeIntentArgs(args: unknown): Record<string, unknown> {
  const raw = asRecord(args);
  const entries = Object.entries(raw).filter(([, value]) => {
    if (value === undefined || value === null) return false;
    if (typeof value === "string" && !value.trim()) return false;
    return true;
  });
  return Object.fromEntries(entries);
}

export function computeIntentArgsHash(args: unknown): string {
  const normalized = normalizeIntentArgs(args);
  const raw = stableStringify(normalized);
  return createHash("sha256").update(raw).digest("hex");
}

export function buildIdentity(
  template: BatchTemplate,
  config: Record<string, unknown>
): BatchIdentity {
  const intent = asRecord(config.intent);
  const intentType =
    typeof intent.type === "string" && intent.type.trim()
      ? intent.type.trim()
      : template.intent.type;
  const intentArgs = asRecord(intent.args);

  return {
    type: template.type,
    platform: template.platform,
    driver: template.driver,
    intentType,
    intentArgsHash: computeIntentArgsHash(intentArgs),
  };
}

function splitDelimited(value: string): string[] {
  return value
    .split(/[\n\r,，;；\t]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return splitDelimited(value);
  }
  return [];
}

function withJsonNull(value: unknown): unknown {
  return value === null ? Prisma.JsonNull : value;
}

function toPrismaJsonValue(value: unknown): Prisma.InputJsonValue {
  if (value === null) return null as unknown as Prisma.InputJsonValue;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => toPrismaJsonValue(item));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).flatMap(([key, item]) =>
      item === undefined ? [] : [[key, toPrismaJsonValue(item)]]
    );
    return Object.fromEntries(entries) as Prisma.InputJsonObject;
  }
  return String(value);
}

function toPrismaJsonObject(value: unknown): Prisma.InputJsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return toPrismaJsonValue(value) as Prisma.InputJsonObject;
}

export function resolveCredentialId(
  template: BatchTemplate,
  config: Record<string, unknown>,
  credentialRefs?: Record<string, string | null | undefined>
): string | null {
  const explicitCredentialId = config.credentialId;
  if (typeof explicitCredentialId === "string" && explicitCredentialId.trim()) {
    return explicitCredentialId;
  }
  for (const requirement of template.credentialRequirements) {
    const refId = credentialRefs?.[requirement.kind];
    if (typeof refId === "string" && refId.trim()) {
      return refId;
    }
  }
  return null;
}

export function listMissingRequirements(
  template: BatchTemplate,
  config: Record<string, unknown>,
  credentialRefs: Record<string, string | null | undefined> | undefined,
  credentialCounts: Record<string, number>
): string[] {
  const missing = listMissingRequiredFields(template, config);
  for (const requirement of template.credentialRequirements) {
    if (!requirement.required) continue;
    const resolvedId = resolveCredentialId(template, config, credentialRefs);
    if (resolvedId) continue;
    if ((credentialCounts[requirement.kind] ?? 0) <= 0) {
      missing.push(`credential:${requirement.kind}`);
    }
  }
  return Array.from(new Set(missing));
}

export function buildSourceCreateData(input: {
  template: BatchTemplate;
  config: Record<string, unknown>;
  defaults?: {
    active?: boolean;
    rateLimit?: number;
    proxyId?: string | null;
  };
  credentialRefs?: Record<string, string | null | undefined>;
  identity: BatchIdentity;
}) {
  const { template, config, defaults, credentialRefs, identity } = input;

  const resolvedProxyId =
    typeof config.proxyId === "string"
      ? config.proxyId || null
      : defaults?.proxyId ?? null;

  const resolvedCredentialId = resolveCredentialId(template, config, credentialRefs);

  const displayName =
    typeof config.name === "string" && config.name.trim()
      ? config.name.trim()
      : `${template.title} (${identity.intentArgsHash.slice(0, 6)})`;

  const description =
    typeof config.description === "string" && config.description.trim()
      ? config.description.trim()
      : template.description;

  const base = {
    name: displayName,
    description,
    type: template.type,
    active: defaults?.active ?? true,
    rateLimit: defaults?.rateLimit ?? 10,
    proxyId: resolvedProxyId,
    credentialId: resolvedCredentialId,
  };

  if (template.type === "WEB") {
    return {
      ...base,
      web: {
        url: toStringArray(config.url),
        headers: withJsonNull(config.headers ?? null),
        crawlerEngine:
          typeof config.crawlerEngine === "string" ? config.crawlerEngine : "FETCH",
        render: Boolean(config.render),
        parseRules: withJsonNull(config.parseRules ?? null),
        robotsRespect:
          typeof config.robotsRespect === "boolean" ? config.robotsRespect : true,
        proxyId: resolvedProxyId,
      },
    };
  }

  if (template.type === "DARKNET") {
    return {
      ...base,
      darknet: {
        url: toStringArray(config.url),
        headers: withJsonNull(config.headers ?? null),
        crawlerEngine:
          typeof config.crawlerEngine === "string" ? config.crawlerEngine : "FETCH",
        proxyId: typeof resolvedProxyId === "string" ? resolvedProxyId : "",
        render: Boolean(config.render),
        parseRules: withJsonNull(config.parseRules ?? null),
      },
    };
  }

  if (template.type === "SEARCH_ENGINE") {
    return {
      ...base,
      search: {
        platform: template.platform,
        engine: typeof config.engine === "string" ? config.engine : "CUSTOM",
        objective: typeof config.objective === "string" ? config.objective.trim() : "",
        apiEndpoint:
          typeof config.apiEndpoint === "string" && config.apiEndpoint.trim()
            ? config.apiEndpoint.trim()
            : null,
        options: withJsonNull(config.options ?? null),
        credentialId: resolvedCredentialId,
        keywordStrategy:
          typeof config.keywordStrategy === "string"
            ? config.keywordStrategy
            : "AUTO",
      },
    };
  }

  const rawIntent = asRecord(config.intent);
  const intent = {
    type:
      typeof rawIntent.type === "string" && rawIntent.type.trim()
        ? rawIntent.type.trim()
        : template.intent.type,
    args: asRecord(rawIntent.args),
  };

  const socialConfig = {
    ...config,
    driver: template.driver,
    intent,
  };

  delete (socialConfig as JsonObject).name;
  delete (socialConfig as JsonObject).description;
  delete (socialConfig as JsonObject).credentialId;
  delete (socialConfig as JsonObject).proxyId;

  return {
    ...base,
    social: {
      platform: template.platform,
      config: toPrismaJsonObject(socialConfig),
      credentialId: resolvedCredentialId,
      proxyId: resolvedProxyId,
      keywordStrategy:
        typeof config.keywordStrategy === "string"
          ? config.keywordStrategy
          : "AUTO",
    },
  };
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

export function sourceIdentityFromSource(source: {
  type: SourceType;
  web?: { sourceId: string } | null;
  darknet?: { sourceId: string } | null;
  search?: {
    platform: string;
    sourceId: string;
  } | null;
  social?: {
    platform: string;
    config: unknown;
    sourceId: string;
  } | null;
}): BatchIdentity | null {
  if (source.type === "SOCIAL_MEDIA" && source.social) {
    const config = asRecord(source.social.config);
    const intent = asRecord(config.intent);
    return {
      type: "SOCIAL_MEDIA",
      platform: source.social.platform,
      driver:
        typeof config.driver === "string" && config.driver.trim()
          ? config.driver
          : "playwright",
      intentType:
        typeof intent.type === "string" && intent.type.trim()
          ? intent.type
          : "search",
      intentArgsHash: computeIntentArgsHash(intent.args),
    };
  }

  if (source.type === "SEARCH_ENGINE" && source.search) {
    return {
      type: "SEARCH_ENGINE",
      platform: source.search.platform,
      driver: "builtin",
      intentType: "search",
      intentArgsHash: computeIntentArgsHash({}),
    };
  }

  if (source.type === "WEB") {
    return {
      type: "WEB",
      platform: "WEB",
      driver: "builtin",
      intentType: "crawl",
      intentArgsHash: computeIntentArgsHash({}),
    };
  }

  if (source.type === "DARKNET") {
    return {
      type: "DARKNET",
      platform: "DARKNET",
      driver: "builtin",
      intentType: "crawl",
      intentArgsHash: computeIntentArgsHash({}),
    };
  }

  return null;
}

export function identityKey(identity: BatchIdentity): string {
  return [
    identity.type,
    identity.platform,
    identity.driver,
    identity.intentType,
    identity.intentArgsHash,
  ].join("|");
}
