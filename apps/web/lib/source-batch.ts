import { createHash } from "node:crypto";

import { Prisma, SourceCategory } from "@/app/generated/prisma";
import type { SourceNetworkPolicy } from "@/lib/source-taxonomy";
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
  category: SourceCategory;
  isDarknet: boolean;
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
  category: SourceCategory;
  isDarknet: boolean;
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

const DEFAULT_RECALL_BINDING_ARG_KEYS = ["query"];
const NON_IDENTITY_INTENT_ARG_KEYS = new Set([
  "limit",
  "count",
  "page",
  "offset",
  "cursor",
  "sort",
  "time",
  "since",
  "until",
  "max_results",
  "scroll_times",
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

function inferTemplateCategory(capability: SourceCapability): SourceCategory {
  return capability.category;
}

function inferRequiredIntentFields(args: Record<string, unknown>): string[] {
  const fields = Object.keys(args)
    .filter((key) => REQUIRED_INTENT_ARGS.has(key.trim().toLowerCase()))
    .map((key) => `intent.args.${key}`);
  return fields;
}

function isCatalogArgRule(value: unknown): value is { required?: unknown; description?: unknown } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return "required" in candidate || "description" in candidate;
}

function normalizeTemplateIntentArgs(input: Record<string, unknown>): {
  args: Record<string, unknown>;
  requiredKeys: string[];
} {
  const args: Record<string, unknown> = {};
  const requiredKeys: string[] = [];

  for (const [key, value] of Object.entries(input)) {
    if (isCatalogArgRule(value)) {
      if (Boolean(value.required)) {
        requiredKeys.push(key);
      }
      args[key] = "";
      continue;
    }

    if (value === undefined || value === null) {
      args[key] = "";
      continue;
    }
    if (typeof value === "string") {
      args[key] = value;
      continue;
    }
    args[key] = String(value);
  }

  return { args, requiredKeys };
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
  const rawArgs =
    intent.sample?.intentArgs &&
    typeof intent.sample.intentArgs === "object" &&
    !Array.isArray(intent.sample.intentArgs)
      ? (intent.sample.intentArgs as Record<string, unknown>)
      : {};
  const { args, requiredKeys } = normalizeTemplateIntentArgs(rawArgs);
  const templateCategory = inferTemplateCategory(capability);
  const intentType = intent.sample?.intentType ?? intent.intent;
  const title = intent.title?.trim()
    ? intent.title.trim()
    : `${capability.platform} ${intent.intent}`;
  const description = intent.description?.trim()
    ? intent.description.trim()
    : `Collect ${capability.platform} (${intent.intent}) via ${capability.execution.engine}.`;
  const requiredFields =
    requiredKeys.length > 0
      ? requiredKeys.map((key) => `intent.args.${key}`)
      : inferRequiredIntentFields(args);
  const inferredNetworkPolicy = inferNetworkPolicy(capability.tags);
  const isDarknet = inferredNetworkPolicy === "TOR_SOCKS5H";

  if (templateCategory === "RETRIEVAL") {
    return {
      key: intent.key,
      category: "RETRIEVAL",
      isDarknet,
      platform: capability.platform,
      driver: capability.execution.driver,
      networkPolicy: inferredNetworkPolicy,
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
        networkPolicy: inferredNetworkPolicy,
        options: { provider: capability.platform.toLowerCase() },
      },
      requiredFields:
        requiredFields.length > 0 ? requiredFields : ["intent.args.query"],
      credentialRequirements: buildCredentialRequirements(capability),
    };
  }

  if (templateCategory === "STREAM") {
    const defaultUrl =
      typeof args.url === "string" && args.url.trim() ? [args.url.trim()] : [];
    const gatherParseRules =
      capability.execution.engine === "gather_playwright"
        ? {
            gather: {
              platform: capability.platform,
              intentType,
              intentArgs: args,
            },
          }
        : null;
    return {
      key: intent.key,
      category: "STREAM",
      isDarknet: false,
      platform: capability.platform,
      driver: capability.execution.driver,
      networkPolicy: inferredNetworkPolicy,
      tags: capability.tags,
      intent: {
        type: intentType,
        args,
      },
      title,
      description,
      defaultConfig: {
        url: defaultUrl,
        headers: null,
        crawlerEngine: "FETCH",
        render: false,
        parseRules: gatherParseRules,
        robotsRespect: true,
        proxyId: null,
        intent: {
          type: intentType,
          args,
        },
        networkPolicy: inferredNetworkPolicy,
      },
      requiredFields: [],
      credentialRequirements: buildCredentialRequirements(capability),
    };
  }

  return {
    key: intent.key,
    category: templateCategory,
    isDarknet: false,
    platform: capability.platform,
    driver: capability.execution.driver,
    networkPolicy: inferredNetworkPolicy,
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
        recallBinding: {
          enabled: true,
          argKeys: DEFAULT_RECALL_BINDING_ARG_KEYS,
        },
      },
      networkPolicy: inferredNetworkPolicy,
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
    const response = await fetch(`${gatherUrl}/v1/scripts/catalog`, {
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
    if (field.startsWith("intent.args.")) {
      const argKey = field.slice("intent.args.".length).trim();
      if (argKey) {
        const intent = asRecord(merged.intent);
        const recallBinding = asRecord(intent.recallBinding);
        if (recallBinding.enabled !== false) {
          const boundKeys = toStringArray(recallBinding.argKeys);
          if (boundKeys.includes(argKey)) {
            return false;
          }
        }
      }
    }
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
    category: template.category,
    isDarknet: template.isDarknet,
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

function buildRecallBindingFromIntent(intent: Record<string, unknown>) {
  const recallBinding = asRecord(intent.recallBinding);
  const recallBindingArgKeys = toStringArray(recallBinding.argKeys);
  if (typeof recallBinding.enabled === "boolean" && recallBinding.enabled === false) {
    return {
      enabled: false,
      argKeys: [],
    };
  }
  if (recallBindingArgKeys.length > 0) {
    return {
      enabled: true,
      argKeys: recallBindingArgKeys,
    };
  }
  return null;
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

function toDisplayArgValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function resolveIntentArgContext(config: Record<string, unknown>): string | null {
  const intent = asRecord(config.intent);
  const args = asRecord(intent.args);
  const allEntries = Object.entries(args)
    .map(([key, rawValue]) => ({
      key: key.trim(),
      value: toDisplayArgValue(rawValue),
    }))
    .filter((item): item is { key: string; value: string } => Boolean(item.key && item.value));

  if (allEntries.length === 0) return null;

  const identityEntries = allEntries.filter(
    (item) => !NON_IDENTITY_INTENT_ARG_KEYS.has(item.key.toLowerCase())
  );
  const picked = (identityEntries.length > 0 ? identityEntries : allEntries).slice(0, 2);

  return picked.map((item) => `${item.key}: ${item.value}`).join(", ");
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
  const intentArgContext = resolveIntentArgContext(config);
  const resolvedName = intentArgContext
    ? `${template.title} (${intentArgContext})`
    : `${template.title} (${identity.intentArgsHash.slice(0, 6)})`;
  const resolvedDescription = intentArgContext
    ? `${template.description}（${intentArgContext}）`
    : template.description;

  const resolvedProxyId =
    typeof config.proxyId === "string" && config.proxyId.trim()
      ? config.proxyId.trim()
      : null;
  const resolvedCredentialId = resolveCredentialId(template, config, credentialRefs);

  const base = {
    name: resolvedName,
    description: resolvedDescription,
    category: template.category,
    isDarknet: template.isDarknet,
    active: defaults?.active ?? true,
    rateLimit: null,
    proxyId: resolvedProxyId,
    credentialId: resolvedCredentialId,
  };

  if (template.category === "STREAM") {
    const intent = asRecord(config.intent);
    const intentType =
      typeof intent.type === "string" && intent.type.trim()
        ? intent.type.trim()
        : template.intent.type;
    const intentArgs = asRecord(intent.args);
    const recallBinding = buildRecallBindingFromIntent(intent);
    const configParseRules = config.parseRules;
    const parseRules =
      configParseRules !== undefined
        ? configParseRules
        : {
            gather: {
              platform: template.platform,
              intentType,
              intentArgs,
              ...(recallBinding ? { recallBinding } : {}),
              ...(recallBinding
                ? {
                    intent: {
                      type: intentType,
                      args: intentArgs,
                      recallBinding,
                    },
                  }
                : {}),
            },
          };
    return {
      ...base,
      web: {
        url: toStringArray(config.url),
        headers: withJsonNull(config.headers ?? null),
        crawlerEngine:
          typeof config.crawlerEngine === "string" ? config.crawlerEngine : "FETCH",
        render: Boolean(config.render),
        parseRules: withJsonNull(parseRules),
        robotsRespect:
          typeof config.robotsRespect === "boolean" ? config.robotsRespect : true,
        proxyId: resolvedProxyId,
      },
    };
  }

  if (template.category === "RETRIEVAL" && template.isDarknet) {
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

  if (template.category === "RETRIEVAL" && !template.isDarknet) {
    const rawIntent = asRecord(config.intent);
    const intentArgs = asRecord(rawIntent.args);
    const recallBinding = buildRecallBindingFromIntent(rawIntent);
    const intentType =
      typeof rawIntent.type === "string" && rawIntent.type.trim()
        ? rawIntent.type.trim()
        : template.intent.type;
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
      intentType,
      intentArgs,
      ...(recallBinding ? { recallBinding } : {}),
      ...(recallBinding
        ? {
            intent: {
              type: intentType,
              args: intentArgs,
              recallBinding,
            },
          }
        : {}),
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
  const recallBinding = asRecord(rawIntent.recallBinding);
  const recallBindingArgKeys = toStringArray(recallBinding.argKeys);
  const intent: Record<string, unknown> = {
    type:
      typeof rawIntent.type === "string" && rawIntent.type.trim()
        ? rawIntent.type.trim()
        : template.intent.type,
    args: asRecord(rawIntent.args),
  };
  if (typeof recallBinding.enabled === "boolean" && recallBinding.enabled === false) {
    intent.recallBinding = {
      enabled: false,
      argKeys: [],
    };
  } else if (recallBindingArgKeys.length > 0) {
    intent.recallBinding = {
      enabled: true,
      argKeys: recallBindingArgKeys,
    };
  } else {
    intent.recallBinding = {
      enabled: true,
      argKeys: DEFAULT_RECALL_BINDING_ARG_KEYS,
    };
  }
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
  category: SourceCategory;
  isDarknet: boolean;
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
  if (source.category === "INTERACTIVE" && source.social) {
    const config = asRecord(source.social.config);
    const intent = asRecord(config.intent);
    return {
      category: "INTERACTIVE",
      isDarknet: false,
      platform: source.social.platform,
      driver: "playwright",
      intentType:
        typeof intent.type === "string" && intent.type.trim()
          ? intent.type
          : "search",
      intentArgsHash: computeIntentArgsHash(intent.args),
    };
  }

  if (source.category === "RETRIEVAL" && !source.isDarknet && source.search) {
    const searchOptions = asRecord((source.search as { options?: unknown }).options);
    const provider = String(searchOptions.provider ?? "").trim().toLowerCase();
    const driver =
      provider === "parallel" || provider === "tavily" || provider === "anspire"
        ? "http"
        : "playwright";
    return {
      category: "RETRIEVAL",
      isDarknet: false,
      platform: source.search.platform,
      driver,
      intentType: "search",
      intentArgsHash: computeIntentArgsHash({
        query:
          typeof source.search.objective === "string" ? source.search.objective : "",
      }),
    };
  }

  if (source.category === "STREAM") {
    return {
      category: "STREAM",
      isDarknet: false,
      platform: "WEB",
      driver: "playwright",
      intentType: "crawl",
      intentArgsHash: computeIntentArgsHash({}),
    };
  }

  if (source.category === "RETRIEVAL" && source.isDarknet) {
    return {
      category: "RETRIEVAL",
      isDarknet: true,
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
    identity.category,
    String(identity.isDarknet),
    identity.platform,
    identity.driver,
    identity.intentType,
    identity.intentArgsHash,
  ].join("|");
}
