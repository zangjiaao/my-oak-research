import { createHash } from "node:crypto";

import { Prisma, SourceType } from "@/app/generated/prisma";
import type { SourceCategory, SourceNetworkPolicy } from "@/lib/source-taxonomy";
import {
  type SourceCapability,
  buildGatherCapabilities,
  buildWorkerApiCapabilities,
} from "@/lib/source-capabilities";

type JsonObject = Record<string, unknown>;

export type BatchCredentialRequirement = {
  kind: string;
  required: boolean;
  description: string;
};

export type BatchTemplate = {
  key: string;
  type: SourceType;
  category: SourceCategory;
  platform: string;
  driver: string;
  networkPolicy: SourceNetworkPolicy;
  tags: string[];
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
    title?: string;
    description?: string;
    auth?: {
      required?: boolean;
      kind?: string;
      description?: string;
    };
    tags?: string[];
  };
};

type WorkerCapabilitiesResponse = {
  items?: SourceCapability[];
};

const REQUIRED_INTENT_ARGS = new Set([
  "query",
  "keyword",
  "id",
  "url",
  "username",
  "tweet_id",
  "channel_id",
  "bvid",
  "subreddit",
  "slug",
  "uid",
]);

function hasTag(tags: string[], value: string): boolean {
  const lower = value.toLowerCase();
  return tags.some((tag) => tag.toLowerCase() === lower);
}

function inferNetworkPolicy(tags: string[]): SourceNetworkPolicy {
  if (hasTag(tags, "tor") || hasTag(tags, "socks5h") || hasTag(tags, "darknet")) {
    return "TOR_SOCKS5H";
  }
  return "DEFAULT";
}

function inferTemplateType(capability: SourceCapability): SourceType {
  if (capability.execution.engine === "worker_api") return "SEARCH_ENGINE";
  return "SOCIAL_MEDIA";
}

function inferRequiredIntentFields(args: Record<string, unknown>): string[] {
  const fields = Object.keys(args)
    .filter((key) => REQUIRED_INTENT_ARGS.has(key.trim().toLowerCase()))
    .map((key) => `intent.args.${key}`);
  return fields;
}

function buildCredentialRequirements(
  capability: SourceCapability
): BatchCredentialRequirement[] {
  const requirement = capability.authRequirement;
  if (!requirement.required && !requirement.kind) {
    return [];
  }
  return [
    {
      kind: requirement.kind ?? `${capability.platform.toLowerCase()}-credential`,
      required: requirement.required,
      description:
        requirement.description ?? `${capability.platform} auth credential`,
    },
  ];
}

function buildTemplateFromCapabilityIntent(
  capability: SourceCapability,
  intent: SourceCapability["intents"][number]
): BatchTemplate {
  const args =
    intent.sample?.intentArgs &&
    typeof intent.sample.intentArgs === "object" &&
    !Array.isArray(intent.sample.intentArgs)
      ? (intent.sample.intentArgs as Record<string, unknown>)
      : {};
  const templateType = inferTemplateType(capability);
  const intentType = intent.sample?.intentType ?? intent.intent;
  const title = intent.title?.trim()
    ? intent.title.trim()
    : `${capability.platform} ${intent.intent}`;
  const description = intent.description?.trim()
    ? intent.description.trim()
    : `Collect ${capability.platform} (${intent.intent}) via ${capability.execution.engine}.`;
  const requiredFields = inferRequiredIntentFields(args);

  if (templateType === "SEARCH_ENGINE") {
    return {
      key: intent.key,
      type: "SEARCH_ENGINE",
      category: capability.category,
      platform: capability.platform,
      driver: capability.execution.driver,
      networkPolicy: inferNetworkPolicy(capability.tags),
      tags: capability.tags,
      intent: {
        type: intentType,
        args,
      },
      title,
      description,
      defaultConfig: {
        intent: {
          type: intentType,
          args,
        },
        networkPolicy: inferNetworkPolicy(capability.tags),
        options: { provider: capability.platform.toLowerCase() },
      },
      requiredFields:
        requiredFields.length > 0 ? requiredFields : ["intent.args.query"],
      credentialRequirements: buildCredentialRequirements(capability),
    };
  }

  return {
    key: intent.key,
    type: "SOCIAL_MEDIA",
    category: capability.category,
    platform: capability.platform,
    driver: capability.execution.driver,
    networkPolicy: inferNetworkPolicy(capability.tags),
    tags: capability.tags,
    intent: {
      type: intentType,
      args,
    },
    title,
    description,
    defaultConfig: {
      intent: {
        type: intentType,
        args,
      },
      networkPolicy: inferNetworkPolicy(capability.tags),
      driver: capability.execution.driver,
      keywordStrategy: "AUTO",
    },
    requiredFields,
    credentialRequirements: buildCredentialRequirements(capability),
  };
}

function mergeCapabilities(input: {
  gather: SourceCapability[];
  worker: SourceCapability[];
}): SourceCapability[] {
  const gatherPlatformSet = new Set(
    input.gather.map((item) => item.platform.toUpperCase())
  );
  const workerFiltered = input.worker.filter(
    (item) => !gatherPlatformSet.has(item.platform.toUpperCase())
  );
  return [...input.gather, ...workerFiltered].sort((a, b) =>
    a.platform.localeCompare(b.platform)
  );
}

export async function loadBatchTemplates(): Promise<BatchTemplate[]> {
  const gatherUrl = process.env.GATHER_SERVICE_URL || "http://localhost:8000";
  let gatherItems: GatherCatalogItem[] = [];
  try {
    const response = await fetch(`${gatherUrl}/v3/scripts/catalog`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (response.ok) {
      const payload = await response.json();
      gatherItems = Array.isArray(payload?.items)
        ? (payload.items as GatherCatalogItem[])
        : [];
    }
  } catch {
    gatherItems = [];
  }

  const workerUrl = process.env.WORKER_SERVICE_URL || "http://localhost:8100";
  let workerItems: SourceCapability[] = [];
  try {
    const response = await fetch(`${workerUrl}/v1/source-capabilities`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (response.ok) {
      const payload = (await response.json()) as WorkerCapabilitiesResponse;
      workerItems = Array.isArray(payload?.items) ? payload.items : [];
    } else {
      workerItems = buildWorkerApiCapabilities();
    }
  } catch {
    workerItems = buildWorkerApiCapabilities();
  }

  const capabilities = mergeCapabilities({
    gather: buildGatherCapabilities(gatherItems),
    worker: workerItems,
  });
  return capabilities
    .flatMap((capability) =>
      capability.intents.map((intent) =>
        buildTemplateFromCapabilityIntent(capability, intent)
      )
    )
    .sort((a, b) => a.key.localeCompare(b.key));
}

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
  };
  credentialRefs?: Record<string, string | null | undefined>;
  identity: BatchIdentity;
}) {
  const { template, config, defaults, credentialRefs, identity } = input;

  const resolvedProxyId =
    typeof config.proxyId === "string" && config.proxyId.trim()
      ? config.proxyId.trim()
      : null;
  const resolvedCredentialId = resolveCredentialId(template, config, credentialRefs);

  const base = {
    name: `${template.title} (${identity.intentArgsHash.slice(0, 6)})`,
    description: template.description,
    type: template.type,
    active: defaults?.active ?? true,
    rateLimit: null,
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
        proxyId: "",
        render: Boolean(config.render),
        parseRules: withJsonNull(config.parseRules ?? null),
      },
    };
  }

  if (template.type === "SEARCH_ENGINE") {
    const rawIntent = asRecord(config.intent);
    const intentArgs = asRecord(rawIntent.args);
    const query =
      typeof intentArgs.query === "string" && intentArgs.query.trim()
        ? intentArgs.query.trim()
        : typeof intentArgs.keyword === "string" && intentArgs.keyword.trim()
          ? intentArgs.keyword.trim()
          : "";
    const effectiveNetworkPolicy =
      typeof config.networkPolicy === "string" &&
      (config.networkPolicy === "DEFAULT" || config.networkPolicy === "TOR_SOCKS5H")
        ? config.networkPolicy
        : template.networkPolicy;
    const optionObject = {
      ...(asRecord(config.options)),
      tags: template.tags,
      networkPolicy: effectiveNetworkPolicy,
      proxyId: resolvedProxyId,
      executionMode: "worker-dispatch",
    };
    return {
      ...base,
      search: {
        platform: template.platform,
        engine: typeof config.engine === "string" ? config.engine : "CUSTOM",
        objective: query,
        apiEndpoint:
          typeof config.apiEndpoint === "string" && config.apiEndpoint.trim()
            ? config.apiEndpoint.trim()
            : null,
        options: withJsonNull(optionObject),
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
  const effectiveNetworkPolicy =
    typeof config.networkPolicy === "string" &&
    (config.networkPolicy === "DEFAULT" || config.networkPolicy === "TOR_SOCKS5H")
      ? config.networkPolicy
      : template.networkPolicy;

  const socialConfig = {
    ...config,
    driver: "playwright",
    category: template.category,
    intent,
    tags: template.tags,
    networkPolicy: effectiveNetworkPolicy,
    executionMode: "worker-dispatch",
  };

  delete (socialConfig as JsonObject).credentialId;

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
    objective?: string | null;
    options?: unknown;
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
      driver: "playwright",
      intentType:
        typeof intent.type === "string" && intent.type.trim()
          ? intent.type
          : "search",
      intentArgsHash: computeIntentArgsHash(intent.args),
    };
  }

  if (source.type === "SEARCH_ENGINE" && source.search) {
    const searchOptions = asRecord((source.search as { options?: unknown }).options);
    const provider = String(searchOptions.provider ?? "").trim().toLowerCase();
    const driver =
      provider === "parallel" || provider === "tavily" || provider === "anspire"
        ? "http"
        : "playwright";
    return {
      type: "SEARCH_ENGINE",
      platform: source.search.platform,
      driver,
      intentType: "search",
      intentArgsHash: computeIntentArgsHash({
        query:
          typeof source.search.objective === "string" ? source.search.objective : "",
      }),
    };
  }

  if (source.type === "WEB") {
    return {
      type: "WEB",
      platform: "WEB",
      driver: "playwright",
      intentType: "crawl",
      intentArgsHash: computeIntentArgsHash({}),
    };
  }

  if (source.type === "DARKNET") {
    return {
      type: "DARKNET",
      platform: "DARKNET",
      driver: "playwright",
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
