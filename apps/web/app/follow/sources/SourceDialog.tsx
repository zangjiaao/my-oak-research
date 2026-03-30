"use client";

import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ChevronDown, ChevronsUpDown, Copy, Link2, Loader2, Minus, Plus, Unlink2 } from "lucide-react";

import { SettingEditDialog } from "@/components/layout";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ControlledSelect } from "@/components/ui/controlled-select";
import { SelectItem } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ErrorMessage } from "@/components/business";
import { MultiSelect } from "@/components/common/multi-select";
import { apiFetcher } from "@/lib/fetcher";
import type { Proxy } from "@/app/generated/prisma";
import { SourceCategory } from "@/app/generated/prisma";
import { SourceWithRelations } from "@/lib/types";
import { useSourceMutation } from "@/hooks/useSourceMutation";
import { type SourceCapability } from "@/lib/source-capabilities";
import { cn } from "@/lib/utils";

type SourceFormValues = {
  name: string;
  description?: string | null;
  active?: boolean;
  rateLimit?: number | null;
  proxyId?: string | null;
  credentialId?: string | null;
};

type SourceDialogMode = "auto" | "edit" | "duplicate";

type SourceCapabilityResponse = {
  items: SourceCapability[];
};

type DriverConfigInput = {
  poolEnabled: boolean;
  poolIdleTimeoutMs: number;
  headless: boolean;
  userId: string;
  navigationTimeoutMs: number;
  stateFile: string;
  filterMinChars: number;
  filterMatchMode: "smart" | "contains" | "term_and_word_boundary";
  filterIncludeFields: string[];
  filterExcludeFields: string[];
  proxy?: Proxy | null;
};

type CredentialListResponse = {
  credentials: Array<{
    id: string;
    name: string;
    kind: string;
  }>;
};

type ScriptArgEntry = {
  key: string;
  value: string;
};

const EMPTY_ARG_ENTRY: ScriptArgEntry = { key: "", value: "" };

const SEARCH_PLATFORM_MAP: Record<string, "PARALLEL" | "TAVILY" | "ANSPIRE" | "CUSTOM"> = {
  PARALLEL: "PARALLEL",
  TAVILY: "TAVILY",
  ANSPIRE: "ANSPIRE",
};

const FILTER_MODE_DESCRIPTIONS: Record<
  "smart" | "contains" | "term_and_word_boundary",
  string
> = {
  term_and_word_boundary:
    "整词匹配（英文按单词边界），精准度最高，误匹配最少。",
  contains: "子串包含匹配，只要包含关键词就命中，召回更高但噪声更多。",
  smart: "智能模式：中文偏向包含匹配，英文偏向整词匹配，兼顾召回与精度。",
};

const FILTER_MODE_EXAMPLES: Record<
  "smart" | "contains" | "term_and_word_boundary",
  string
> = {
  term_and_word_boundary:
    "例：关键词 `ai` 仅命中 `ai model`，不命中 `airdrop`。",
  contains: "例：关键词 `ai` 会命中 `ai model` 和 `airdrop`。",
  smart: "例：关键词 `人工智能` 按包含匹配，`ai` 按整词匹配。",
};

const DEFAULT_FILTER_FIELD_OPTIONS = ["title", "snippet", "source", "time", "url"];

function normalizePlatform(value?: string | null): string {
  return String(value ?? "").trim().toUpperCase();
}

function getPlatformRegion(tags?: string[]): "国内" | "国外" | "未配置" {
  if (Array.isArray(tags)) {
    if (tags.includes("domestic")) return "国内";
    if (tags.includes("foreign")) return "国外";
  }
  return "未配置";
}

function splitToUrls(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  return raw
    .split(/[\n\r,，;；\t]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((item) => String(item ?? "").trim())
          .filter(Boolean)
      )
    );
  }
  if (typeof value === "string") {
    return Array.from(
      new Set(
        value
          .split(/[\n\r,，;；\t]+/g)
          .map((item) => item.trim())
          .filter(Boolean)
      )
    );
  }
  return [];
}

function resolveOutputFieldOptions(rawOutputField: unknown): string[] {
  if (Array.isArray(rawOutputField)) {
    return Array.from(
      new Set(
        rawOutputField
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
      )
    );
  }
  if (rawOutputField && typeof rawOutputField === "object" && !Array.isArray(rawOutputField)) {
    return Array.from(
      new Set(
        Object.keys(rawOutputField as Record<string, unknown>)
          .map((key) => key.trim())
          .filter(Boolean)
      )
    );
  }
  return [];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function isCatalogArgRule(value: unknown): value is { required?: unknown; description?: unknown } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return "required" in candidate || "description" in candidate;
}

function normalizeTemplateIntentArgs(input: Record<string, unknown>): Record<string, unknown> {
  const args: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (isCatalogArgRule(value)) {
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

  return args;
}

function parseGatherMarker(value?: string | null): { platform: string; intentType: string } | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const match = text.match(/collect\s+([a-z0-9_-]+)\s*\(([\w-]+)\)\s+via\s+gather_playwright/i);
  if (!match) return null;
  const platform = String(match[1] ?? "").trim().toUpperCase();
  const intentType = String(match[2] ?? "").trim().toLowerCase();
  if (!platform || !intentType) return null;
  return { platform, intentType };
}

function parseProxyUrl(proxyUrl: string): {
  host: string;
  port: number;
  username?: string;
  password?: string;
} | null {
  const raw = proxyUrl.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 8080,
      username: parsed.username || undefined,
      password: parsed.password || undefined,
    };
  } catch {
    return null;
  }
}

function toScriptArgEntries(value: unknown): ScriptArgEntry[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).map(([key, fieldValue]) => ({
    key,
    value:
      fieldValue == null
        ? ""
        : typeof fieldValue === "string"
          ? fieldValue
          : JSON.stringify(fieldValue),
  }));
}

function isIdLikeArgKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  if (!normalized) return false;
  return normalized === "id" || normalized.endsWith("_id") || normalized.endsWith("id");
}

function parseScriptArgValue(raw: string, key: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (isIdLikeArgKey(key)) return trimmed;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return raw;
    }
  }
  return raw;
}

function entriesToScriptArgs(entries: ScriptArgEntry[]): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const entry of entries) {
    const key = entry.key.trim();
    if (!key) continue;
    output[key] = parseScriptArgValue(entry.value, key);
  }
  return output;
}

function buildDriverConfig(input: {
  intentType: string;
  intentArgs: Record<string, unknown>;
  config: DriverConfigInput;
}) {
  const { intentType, intentArgs, config } = input;
  const proxy = config.proxy?.url ? parseProxyUrl(config.proxy.url) : null;
  return {
    poolEnabled: config.poolEnabled,
    poolIdleTimeoutMs: parseNumber(config.poolIdleTimeoutMs, 120000),
    headless: config.headless,
    ...(config.userId.trim() ? { userId: config.userId.trim() } : {}),
    navigationTimeoutMs: Math.max(
      1000,
      parseNumber(config.navigationTimeoutMs, 30000)
    ),
    stateFile: config.stateFile.trim() || undefined,
    script: {
      type: intentType || "search",
      args: intentArgs,
    },
    filter: {
      minChars: parseNumber(config.filterMinChars, 8),
      matchMode: config.filterMatchMode,
      includeFields: config.filterIncludeFields,
      excludeFields: config.filterExcludeFields,
    },
    ...(proxy
      ? {
          network: {
            proxy,
          },
        }
      : {}),
  };
}

function getInitialScriptState(source?: SourceWithRelations): {
  category: SourceCategory;
  platform: string;
  intentType: string;
  scriptArgs: Record<string, unknown>;
  recallBindingArgKeys: string[];
  poolEnabled: boolean;
  poolIdleTimeoutMs: number;
  headless: boolean;
  userId: string;
  navigationTimeoutMs: number;
  stateFile: string;
  filterMinChars: number;
  filterMatchMode: "smart" | "contains" | "term_and_word_boundary";
  filterIncludeFields: string[];
  filterExcludeFields: string[];
} {
  if (!source) {
    return {
      category: "INTERACTIVE",
      platform: "",
      intentType: "",
      scriptArgs: {},
      recallBindingArgKeys: [],
      poolEnabled: true,
      poolIdleTimeoutMs: 120000,
      headless: false,
      userId: "",
      navigationTimeoutMs: 30000,
      stateFile: "",
      filterMinChars: 8,
      filterMatchMode: "smart",
      filterIncludeFields: [],
      filterExcludeFields: ["url"],
    };
  }

  if (source.category === "INTERACTIVE" && "social" in source && source.social) {
    const config = (source.social.config as Record<string, unknown>) ?? {};
    const runtime = asRecord(config.runtime);
    const playwright = asRecord(config.playwright);
    const driver = Object.keys(runtime).length > 0 ? runtime : asRecord(config.driver);
    const script =
      driver.script && typeof driver.script === "object" && !Array.isArray(driver.script)
        ? (driver.script as Record<string, unknown>)
        : {};
    const intent =
      config.intent && typeof config.intent === "object" && !Array.isArray(config.intent)
        ? (config.intent as Record<string, unknown>)
        : {};
    const recallBinding =
      intent.recallBinding &&
      typeof intent.recallBinding === "object" &&
      !Array.isArray(intent.recallBinding)
        ? (intent.recallBinding as Record<string, unknown>)
        : {};
    const topLevelFilter = asRecord(config.filter);
    const runtimeFilter =
      driver.filter && typeof driver.filter === "object" && !Array.isArray(driver.filter)
        ? (driver.filter as Record<string, unknown>)
        : {};
    const playwrightFilter = asRecord(playwright.filter);
    const filter =
      Object.keys(topLevelFilter).length > 0
        ? topLevelFilter
        : Object.keys(runtimeFilter).length > 0
          ? runtimeFilter
          : playwrightFilter;
    const intentArgs =
      script.args && typeof script.args === "object" && !Array.isArray(script.args)
        ? (script.args as Record<string, unknown>)
        : intent.args && typeof intent.args === "object" && !Array.isArray(intent.args)
          ? (intent.args as Record<string, unknown>)
        : {};

    return {
      category: "INTERACTIVE",
      platform: source.social.platform ?? "",
      intentType:
        (typeof script.type === "string" && script.type.trim()) ||
        (typeof intent.type === "string" && intent.type.trim())
          ? String(script.type ?? intent.type)
          : "search",
      scriptArgs: intentArgs,
      recallBindingArgKeys:
        typeof recallBinding.enabled === "boolean" && recallBinding.enabled === false
          ? []
          : Array.isArray(recallBinding.argKeys) && recallBinding.argKeys.length > 0
            ? recallBinding.argKeys
                .map((item) => String(item).trim())
                .filter(Boolean)
            : [],
      poolEnabled:
        typeof driver.poolEnabled === "boolean"
          ? driver.poolEnabled
          : typeof playwright.poolEnabled === "boolean"
            ? playwright.poolEnabled
            : true,
      poolIdleTimeoutMs: parseNumber(
        driver.poolIdleTimeoutMs ?? playwright.poolIdleTimeoutMs,
        120000
      ),
      headless:
        typeof driver.headless === "boolean"
          ? driver.headless
          : typeof playwright.headless === "boolean"
            ? playwright.headless
            : false,
      userId:
        typeof driver.userId === "string" && driver.userId.trim()
          ? driver.userId
          : typeof config.userId === "string" && config.userId.trim()
            ? String(config.userId)
            : typeof playwright.userId === "string" && playwright.userId.trim()
              ? String(playwright.userId)
              : "",
      navigationTimeoutMs: parseNumber(
        driver.navigationTimeoutMs ?? playwright.navigationTimeoutMs,
        30000
      ),
      stateFile:
        typeof driver.stateFile === "string" && driver.stateFile.trim()
          ? driver.stateFile
          : typeof playwright.stateFile === "string" && playwright.stateFile.trim()
            ? String(playwright.stateFile)
          : "",
      filterMinChars: parseNumber(filter.minChars, 8),
      filterMatchMode:
        filter.matchMode === "contains" ||
        filter.matchMode === "term_and_word_boundary" ||
        filter.matchMode === "smart"
          ? filter.matchMode
          : "smart",
      filterIncludeFields:
        normalizeStringArray(filter.includeFields).length > 0
          ? normalizeStringArray(filter.includeFields)
          : normalizeStringArray(filter.scopeFields),
      filterExcludeFields:
        normalizeStringArray(filter.excludeFields).length > 0
          ? normalizeStringArray(filter.excludeFields)
          : normalizeStringArray(filter.scopeFields).length > 0
            ? []
            : Boolean(filter.includeUrl)
              ? []
              : ["url"],
    };
  }

  if (
    source.category === "RETRIEVAL" &&
    !source.isDarknet &&
    "search" in source &&
    source.search
  ) {
    const options =
      source.search.options && typeof source.search.options === "object"
        ? (source.search.options as Record<string, unknown>)
        : {};
    const optionRecallBinding = asRecord(options.recallBinding);
    const optionIntent = asRecord(options.intent);
    const optionIntentRecallBinding = asRecord(optionIntent.recallBinding);
    const optionRecallBindingArgKeys = normalizeStringArray(
      optionIntentRecallBinding.argKeys
    ).length
      ? normalizeStringArray(optionIntentRecallBinding.argKeys)
      : normalizeStringArray(optionRecallBinding.argKeys);
    const optionRecallBindingEnabled =
      typeof optionIntentRecallBinding.enabled === "boolean"
        ? optionIntentRecallBinding.enabled
        : typeof optionRecallBinding.enabled === "boolean"
          ? optionRecallBinding.enabled
          : undefined;
    return {
      category: "RETRIEVAL",
      platform: String(options.provider ?? source.search.platform ?? ""),
      intentType: "search",
      scriptArgs: { query: source.search.objective ?? "" },
      recallBindingArgKeys:
        optionRecallBindingEnabled === false ? [] : optionRecallBindingArgKeys,
      poolEnabled: true,
      poolIdleTimeoutMs: 120000,
      headless: false,
      userId: "",
      navigationTimeoutMs: 30000,
      stateFile: "",
      filterMinChars: 8,
      filterMatchMode: "smart",
      filterIncludeFields: [],
      filterExcludeFields: ["url"],
    };
  }

  if (source.category === "STREAM" && "web" in source && source.web) {
    const parseRules = asRecord(source.web.parseRules);
    const gather = asRecord(parseRules.gather);
    const gatherIntentArgs = asRecord(gather.intentArgs);
    const gatherRecallBinding = asRecord(gather.recallBinding);
    const gatherIntent = asRecord(gather.intent);
    const gatherIntentRecallBinding = asRecord(gatherIntent.recallBinding);
    const gatherRecallBindingArgKeys = normalizeStringArray(
      gatherIntentRecallBinding.argKeys
    ).length
      ? normalizeStringArray(gatherIntentRecallBinding.argKeys)
      : normalizeStringArray(gatherRecallBinding.argKeys);
    const gatherRecallBindingEnabled =
      typeof gatherIntentRecallBinding.enabled === "boolean"
        ? gatherIntentRecallBinding.enabled
        : typeof gatherRecallBinding.enabled === "boolean"
          ? gatherRecallBinding.enabled
          : undefined;
    const marker =
      parseGatherMarker(source.description) ??
      parseGatherMarker(source.name);
    return {
      category: "STREAM",
      platform:
        String(gather.platform ?? "").trim().toUpperCase() ||
        marker?.platform ||
        "BBC",
      intentType:
        String(gather.intentType ?? "").trim() ||
        marker?.intentType ||
        "crawl",
      scriptArgs:
        Object.keys(gatherIntentArgs).length > 0
          ? gatherIntentArgs
          : { url: source.web.url ?? [] },
      recallBindingArgKeys:
        gatherRecallBindingEnabled === false ? [] : gatherRecallBindingArgKeys,
      poolEnabled: true,
      poolIdleTimeoutMs: 120000,
      headless: false,
      userId: "",
      navigationTimeoutMs: 30000,
      stateFile: "",
      filterMinChars: 8,
      filterMatchMode: "smart",
      filterIncludeFields: [],
      filterExcludeFields: ["url"],
    };
  }

  if (
    source.category === "RETRIEVAL" &&
    source.isDarknet &&
    "darknet" in source &&
    source.darknet
  ) {
    return {
      category: "RETRIEVAL",
      platform: "DARKWEBGO",
      intentType: "search",
      scriptArgs: { url: source.darknet.url ?? [] },
      recallBindingArgKeys: [],
      poolEnabled: true,
      poolIdleTimeoutMs: 120000,
      headless: false,
      userId: "",
      navigationTimeoutMs: 30000,
      stateFile: "",
      filterMinChars: 8,
      filterMatchMode: "smart",
      filterIncludeFields: [],
      filterExcludeFields: ["url"],
    };
  }

  return {
    category: "INTERACTIVE",
    platform: "",
    intentType: "",
    scriptArgs: {},
    recallBindingArgKeys: [],
    poolEnabled: true,
    poolIdleTimeoutMs: 120000,
    headless: false,
    userId: "",
    navigationTimeoutMs: 30000,
    stateFile: "",
    filterMinChars: 8,
    filterMatchMode: "smart",
    filterIncludeFields: [],
    filterExcludeFields: ["url"],
  };
}

function buildPayloadFromUnified(input: {
  targetCategory: SourceCategory;
  isDarknet: boolean;
  values: SourceFormValues;
  platform: string;
  intentType: string;
  scriptArgs: Record<string, unknown>;
  recallBindingArgKeys: string[];
  driverConfig: DriverConfigInput;
  selectedCapabilityEngine?: string | null;
}) {
  const {
    targetCategory,
    isDarknet,
    values,
    platform,
    intentType,
    scriptArgs,
    recallBindingArgKeys,
    driverConfig,
    selectedCapabilityEngine,
  } =
    input;
  const intentArgs = scriptArgs;
  const normalizedRecallBindingArgKeys = Array.from(
    new Set(
      recallBindingArgKeys.map((key) => key.trim()).filter(Boolean)
    )
  );
  const recallBinding = {
    enabled: normalizedRecallBindingArgKeys.length > 0,
    argKeys:
      normalizedRecallBindingArgKeys.length > 0
        ? normalizedRecallBindingArgKeys
        : ["query"],
  };
  const driver = buildDriverConfig({ intentType, intentArgs, config: driverConfig });

  const base = {
    name: values.name.trim(),
    description:
      values.description?.trim() ||
      (selectedCapabilityEngine === "gather_playwright" && normalizePlatform(platform)
        ? `Collect ${normalizePlatform(platform)} (${intentType || "search"}) via gather_playwright.`
        : ""),
    category: targetCategory,
    isDarknet,
    active: values.active ?? true,
    rateLimit: values.rateLimit ?? 10,
    proxyId: values.proxyId ?? null,
    credentialId: values.credentialId ?? null,
  };

  if (targetCategory === "STREAM") {
    const urls = splitToUrls(
      intentArgs.url ?? intentArgs.urls ?? intentArgs.targetUrl ?? intentArgs.site
    );
    const gatherParseRules =
      selectedCapabilityEngine === "gather_playwright"
        ? {
            gather: {
              platform: normalizePlatform(platform),
              intentType: intentType || "search",
              intentArgs,
              intent: {
                type: intentType || "search",
                args: intentArgs,
                recallBinding,
              },
              recallBinding,
              driver,
            },
          }
        : null;
    return {
      payload: {
        ...base,
        category: "STREAM" as const,
        isDarknet: false,
        web: {
          url: urls,
          crawlerEngine: "FETCH" as const,
          render: false,
          robotsRespect: true,
          headers: null,
          parseRules: gatherParseRules,
          proxyId: values.proxyId ?? null,
        },
      },
    };
  }

  if (targetCategory === "RETRIEVAL" && !isDarknet) {
    const provider = normalizePlatform(platform);
    const objective = String(
      intentArgs.query ?? intentArgs.keyword ?? intentArgs.objective ?? ""
    ).trim();
    if (!objective) {
      return { error: "Retrieval source requires query/objective in intent args." };
    }

    const mappedPlatform = SEARCH_PLATFORM_MAP[provider] ?? "CUSTOM";

    return {
      payload: {
        ...base,
        category: "RETRIEVAL" as const,
        isDarknet: false,
        search: {
          platform: mappedPlatform,
          engine: "CUSTOM" as const,
          objective,
          apiEndpoint: null,
          options: {
            provider: provider || "CUSTOM",
            intentType,
            intentArgs,
            intent: {
              type: intentType || "search",
              args: intentArgs,
              recallBinding,
            },
            recallBinding,
            driver,
          },
          credentialId: values.credentialId ?? null,
          keywordStrategy: "AUTO" as const,
        },
      },
    };
  }

  if (targetCategory === "RETRIEVAL" && isDarknet) {
    const urls = splitToUrls(
      intentArgs.url ?? intentArgs.urls ?? intentArgs.targetUrl ?? intentArgs.site
    );
    if (urls.length === 0) {
      return { error: "Darknet source requires at least one URL in intent args." };
    }
    if (!values.proxyId) {
      return { error: "Darknet source requires proxy configuration." };
    }

    return {
      payload: {
        ...base,
        category: "RETRIEVAL" as const,
        isDarknet: true,
        darknet: {
          url: urls,
          headers: null,
          crawlerEngine: "FETCH" as const,
          proxyId: values.proxyId,
          render: false,
          parseRules: null,
        },
      },
    };
  }

  const normalizedPlatform = normalizePlatform(platform);
  if (!normalizedPlatform) {
    return { error: "Interactive source requires a platform." };
  }

  const socialConfig: Record<string, unknown> = {
    driver: "playwright",
    intent: {
      type: intentType || "search",
      args: intentArgs,
      recallBinding,
    },
    playwright: {
      mode: "eval-js",
      headless: driverConfig.headless,
      poolEnabled: driverConfig.poolEnabled,
      poolIdleTimeoutMs: parseNumber(driverConfig.poolIdleTimeoutMs, 120000),
      ...(driverConfig.userId.trim() ? { userId: driverConfig.userId.trim() } : {}),
      navigationTimeoutMs: Math.max(
        1000,
        parseNumber(driverConfig.navigationTimeoutMs, 30000)
      ),
      filter: {
        minChars: parseNumber(driverConfig.filterMinChars, 8),
        matchMode: driverConfig.filterMatchMode,
        includeFields: driverConfig.filterIncludeFields,
        excludeFields: driverConfig.filterExcludeFields,
      },
      args: Object.fromEntries(
        Object.entries(intentArgs).map(([key, value]) => [key, String(value ?? "")])
      ),
    },
    runtime: driver,
  };
  if (driverConfig.userId.trim()) {
    socialConfig.userId = driverConfig.userId.trim();
  }

  const query = String(intentArgs.query ?? "").trim();
  const userId = String(intentArgs.userId ?? "").trim();
  const noteId = String(intentArgs.noteId ?? "").trim();
  const videoId = String(intentArgs.videoId ?? "").trim();
  const username = String(intentArgs.username ?? "").trim();

  if (query) socialConfig.query = query;
  if (userId) socialConfig.userId = userId;
  if (noteId) socialConfig.noteId = noteId;
  if (videoId) socialConfig.videoId = videoId;
  if (username) socialConfig.username = username;

  return {
    payload: {
      ...base,
      category: "INTERACTIVE" as const,
      isDarknet: false,
      social: {
        platform: normalizedPlatform,
        config: socialConfig,
        credentialId: values.credentialId ?? null,
        proxyId: values.proxyId ?? null,
        keywordStrategy: "AUTO" as const,
      },
    },
  };
}

const SourceDialog = ({
  triggerButton,
  source: propSource,
  proxies,
  sourceType: propSourceType,
  sourceIsDarknet: propSourceIsDarknet,
  mode = "auto",
  duplicateName,
  onOpenChange,
  open,
}: {
  triggerButton?: React.ReactNode;
  source?: SourceWithRelations;
  proxies: Proxy[];
  sourceType?: SourceCategory;
  sourceIsDarknet?: boolean;
  mode?: SourceDialogMode;
  duplicateName?: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) => {
  const [currentSource, setCurrentSource] = useState<SourceWithRelations | undefined>(propSource);
  const [currentSourceType, setCurrentSourceType] = useState(propSourceType);
  const [currentIsDarknet, setCurrentIsDarknet] = useState(Boolean(propSourceIsDarknet));

  useEffect(() => {
    if (open) {
      setCurrentSource(propSource);
      setCurrentSourceType(propSourceType);
      setCurrentIsDarknet(Boolean(propSourceIsDarknet));
    }
  }, [open, propSource, propSourceType, propSourceIsDarknet]);

  const isDuplicateMode = mode === "duplicate";
  const isUpdate = !!currentSource && !isDuplicateMode;
  const sourceIdForExistingRecord = isUpdate ? currentSource?.id : undefined;
  const effectiveCategory: SourceCategory =
    currentSourceType || currentSource?.category || "INTERACTIVE";
  const effectiveIsDarknet = currentSource?.isDarknet ?? currentIsDarknet;
  const initialSourceName = useMemo(() => {
    if (isDuplicateMode) {
      const fallback = currentSource?.name ?? "";
      const resolved = duplicateName?.trim() || fallback;
      return resolved;
    }
    return currentSource?.name ?? "";
  }, [isDuplicateMode, duplicateName, currentSource?.name]);

  const initialScriptState = useMemo(() => getInitialScriptState(currentSource), [currentSource]);

  const [selectedPlatform, setSelectedPlatform] = useState(initialScriptState.platform);
  const [selectedIntentType, setSelectedIntentType] = useState(initialScriptState.intentType);
  const lastIntentTypeRef = useRef<string | null>(null);
  const [scriptArgEntries, setScriptArgEntries] = useState<ScriptArgEntry[]>(
    (() => {
      const entries = toScriptArgEntries(initialScriptState.scriptArgs);
      return entries.length > 0 ? entries : [];
    })()
  );
  const [recallBindingArgKeys, setRecallBindingArgKeys] = useState<string[]>(
    initialScriptState.recallBindingArgKeys
  );
  const [poolEnabled, setPoolEnabled] = useState(initialScriptState.poolEnabled);
  const [poolIdleTimeoutMs, setPoolIdleTimeoutMs] = useState(initialScriptState.poolIdleTimeoutMs);
  const [headless, setHeadless] = useState(initialScriptState.headless);
  const [runtimeUserId, setRuntimeUserId] = useState(initialScriptState.userId);
  const [navigationTimeoutMs, setNavigationTimeoutMs] = useState(
    initialScriptState.navigationTimeoutMs
  );
  const [stateFile, setStateFile] = useState(initialScriptState.stateFile);
  const [filterMinChars, setFilterMinChars] = useState(initialScriptState.filterMinChars);
  const [filterMatchMode, setFilterMatchMode] = useState(initialScriptState.filterMatchMode);
  const [filterIncludeFields, setFilterIncludeFields] = useState(
    initialScriptState.filterIncludeFields
  );
  const [filterExcludeFields, setFilterExcludeFields] = useState(
    initialScriptState.filterExcludeFields
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authStatus, setAuthStatus] = useState<string | null>(null);
  const [platformPopoverOpen, setPlatformPopoverOpen] = useState(false);
  const [platformSearch, setPlatformSearch] = useState("");
  const popoverContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    lastIntentTypeRef.current = null;
    setSelectedPlatform(initialScriptState.platform);
    setSelectedIntentType(initialScriptState.intentType);
    setScriptArgEntries(() => {
      const entries = toScriptArgEntries(initialScriptState.scriptArgs);
      return entries.length > 0 ? entries : [];
    });
    setRecallBindingArgKeys(initialScriptState.recallBindingArgKeys);
    setPoolEnabled(initialScriptState.poolEnabled);
    setPoolIdleTimeoutMs(initialScriptState.poolIdleTimeoutMs);
    setHeadless(initialScriptState.headless);
    setRuntimeUserId(initialScriptState.userId);
    setNavigationTimeoutMs(initialScriptState.navigationTimeoutMs);
    setStateFile(initialScriptState.stateFile);
    setFilterMinChars(initialScriptState.filterMinChars);
    setFilterMatchMode(initialScriptState.filterMatchMode);
    setFilterIncludeFields(initialScriptState.filterIncludeFields);
    setFilterExcludeFields(initialScriptState.filterExcludeFields);
    setAdvancedOpen(false);
    setAuthStatus(null);
  }, [open, initialScriptState]);

  useEffect(() => {
    if (!platformPopoverOpen) return;
    const el = popoverContainerRef.current;
    if (!el) return;
    let scrollParent: HTMLElement | null = el.parentElement;
    while (scrollParent) {
      const { overflowY } = getComputedStyle(scrollParent);
      if (overflowY === "auto" || overflowY === "scroll") break;
      scrollParent = scrollParent.parentElement;
    }
    if (!scrollParent) return;
    const close = () => setPlatformPopoverOpen(false);
    scrollParent.addEventListener("scroll", close, { passive: true });
    return () => scrollParent!.removeEventListener("scroll", close);
  }, [platformPopoverOpen]);

  const { data: capabilityData, isLoading: loadingCapabilities } =
    useQuery<SourceCapabilityResponse>({
      queryKey: ["source-capabilities"],
      queryFn: () => apiFetcher("/api/follow/source-capabilities"),
      enabled: open,
    });

  const capabilities = capabilityData?.items ?? [];
  const capabilityByPlatform = useMemo(
    () =>
      new Map(
        capabilities.map((item) => [normalizePlatform(item.platform), item] as const)
      ),
    [capabilities]
  );
  const selectedCapability = useMemo(
    () => capabilityByPlatform.get(normalizePlatform(selectedPlatform)) ?? null,
    [capabilityByPlatform, selectedPlatform]
  );

  const selectedCapabilityEngine = selectedCapability?.execution.engine ?? null;

  const form = useForm<SourceFormValues>({
    defaultValues: {
      name: initialSourceName,
      description: currentSource?.description ?? "",
      active: currentSource?.active ?? true,
      rateLimit: currentSource?.rateLimit ?? 10,
      proxyId: currentSource?.proxyId ?? null,
      credentialId: currentSource?.credentialId ?? null,
    },
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      name: initialSourceName,
      description: currentSource?.description ?? "",
      active: currentSource?.active ?? true,
      rateLimit: currentSource?.rateLimit ?? 10,
      proxyId: currentSource?.proxyId ?? null,
      credentialId: currentSource?.credentialId ?? null,
    });
  }, [open, currentSource, form, initialSourceName]);

  const expectedCategory = effectiveCategory;
  const targetCategory: SourceCategory = useMemo(() => {
    if (currentSource?.category) return currentSource.category;
    if (selectedCapabilityEngine === "worker_api") return "RETRIEVAL";
    return effectiveCategory;
  }, [
    currentSource?.category,
    selectedCapabilityEngine,
    effectiveCategory,
  ]);

  const mutation = useSourceMutation({
    sourceId: sourceIdForExistingRecord,
    sourceCategory: targetCategory,
    onSuccess: () => {
      onOpenChange(false);
      if (!isUpdate) {
        form.reset({
          name: "",
          description: "",
          active: true,
          rateLimit: 10,
          proxyId: null,
          credentialId: null,
        });
      }
    },
  });

  const watchedValues = form.watch();
  const watchedProxyId = form.watch("proxyId");
  const selectedProxy = useMemo(
    () => proxies.find((proxy) => proxy.id === watchedProxyId) ?? null,
    [proxies, watchedProxyId]
  );

  const platformOptions = useMemo(() => {
    return capabilities
      .filter((item) => item.category === expectedCategory)
      .map((item) => normalizePlatform(item.platform))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }, [capabilities, expectedCategory]);

  const filteredPlatformOptions = useMemo(() => {
    const keyword = platformSearch.trim().toLowerCase();
    if (!keyword) return platformOptions;
    return platformOptions.filter((platform) =>
      platform.toLowerCase().includes(keyword)
    );
  }, [platformOptions, platformSearch]);

  const intentOptions = useMemo(() => {
    if (!normalizePlatform(selectedPlatform)) return [];
    const intents = new Set<string>();
    for (const item of selectedCapability?.intents ?? []) {
      if (item.intent) intents.add(item.intent);
    }
    return Array.from(intents).sort((a, b) => a.localeCompare(b));
  }, [selectedCapability?.intents, selectedPlatform]);

  const selectedCatalogItem = useMemo(() => {
    if (!selectedIntentType) return null;
    return (
      (selectedCapability?.intents ?? []).find(
        (item) => item.intent === selectedIntentType
      ) ?? null
    );
  }, [selectedCapability?.intents, selectedIntentType]);

  useEffect(() => {
    if (!normalizePlatform(selectedPlatform)) {
      setSelectedIntentType("");
      setScriptArgEntries([]);
      return;
    }
    if (!selectedIntentType) {
      const firstIntent = intentOptions[0] ?? "";
      setSelectedIntentType(firstIntent);
      if (!firstIntent) {
        setScriptArgEntries([]);
      }
    }
  }, [selectedPlatform, selectedIntentType, intentOptions]);

  useEffect(() => {
    if (!selectedIntentType) {
      lastIntentTypeRef.current = null;
      setScriptArgEntries([]);
      return;
    }
    const rawSampleArgs =
      selectedCatalogItem?.sample?.intentArgs &&
      typeof selectedCatalogItem.sample.intentArgs === "object" &&
      !Array.isArray(selectedCatalogItem.sample.intentArgs)
        ? (selectedCatalogItem.sample.intentArgs as Record<string, unknown>)
        : {};
    const sampleArgs = normalizeTemplateIntentArgs(rawSampleArgs);
    const sampleEntries = toScriptArgEntries(sampleArgs);
    const fallbackEntries = sampleEntries.length > 0 ? sampleEntries : [{ ...EMPTY_ARG_ENTRY }];
    const previousIntentType = lastIntentTypeRef.current;
    const intentChanged =
      previousIntentType !== null && previousIntentType !== selectedIntentType;

    if (intentChanged) {
      setScriptArgEntries(fallbackEntries);
    } else {
      setScriptArgEntries((prev) => {
        const prevAllEmpty =
          prev.length === 0 || prev.every((entry) => !entry.key.trim() && !entry.value.trim());
        return prevAllEmpty ? fallbackEntries : prev;
      });
    }
    lastIntentTypeRef.current = selectedIntentType;
  }, [selectedCatalogItem, selectedIntentType, selectedPlatform]);

  const scriptArgs = useMemo(() => entriesToScriptArgs(scriptArgEntries), [scriptArgEntries]);
  const outputFieldOptions = useMemo(() => {
    const options = resolveOutputFieldOptions(selectedCatalogItem?.sample?.outputField);
    return options.length > 0 ? options : DEFAULT_FILTER_FIELD_OPTIONS;
  }, [selectedCatalogItem?.sample?.outputField]);
  const outputFieldMultiSelectOptions = useMemo(
    () => outputFieldOptions.map((field) => ({ label: field, value: field })),
    [outputFieldOptions]
  );
  const effectiveFilter = useMemo(() => {
    const available = outputFieldOptions;
    const include = Array.from(
      new Set(
        filterIncludeFields
          .map((field) => field.trim())
          .filter((field) => field && available.includes(field))
      )
    );
    const exclude = Array.from(
      new Set(
        filterExcludeFields
          .map((field) => field.trim())
          .filter((field) => field && available.includes(field) && !include.includes(field))
      )
    );
    const scopeFields =
      include.length > 0
        ? include
        : available.filter((field) => !exclude.includes(field));
    return {
      include,
      exclude,
      scopeFields,
    };
  }, [outputFieldOptions, filterIncludeFields, filterExcludeFields]);

  const {
    data: credentialData,
    isLoading: loadingCredentials,
    refetch: refetchCredentials,
  } = useQuery<CredentialListResponse>({
    queryKey: [
      "source-credentials",
      normalizePlatform(selectedPlatform),
      selectedCapability?.authRequirement.kind ?? "",
    ],
    queryFn: async () => {
      const authKind =
        typeof selectedCapability?.authRequirement.kind === "string"
          ? selectedCapability.authRequirement.kind.trim().toLowerCase()
          : "";
      const platform =
        selectedPlatform ? normalizePlatform(selectedPlatform).toLowerCase() : "";

      if (authKind) {
        const byKind = (await apiFetcher(
          `/api/follow/credentials?kind=${encodeURIComponent(authKind)}`
        )) as CredentialListResponse;
        if ((byKind.credentials?.length ?? 0) > 0 || !platform) {
          return byKind;
        }
        return apiFetcher(
          `/api/follow/credentials?platform=${encodeURIComponent(platform)}`
        ) as Promise<CredentialListResponse>;
      }

      if (platform) {
        return apiFetcher(
          `/api/follow/credentials?platform=${encodeURIComponent(platform)}`
        ) as Promise<CredentialListResponse>;
      }
      return apiFetcher("/api/follow/credentials") as Promise<CredentialListResponse>;
    },
    enabled: open,
  });

  const credentials = credentialData?.credentials ?? [];
  const authRequired = !!selectedCapability?.authRequirement.required;
  const hasUploadedAuth = credentials.length > 0;
  const selectedCredentialId = form.watch("credentialId");
  const effectiveCredentialId =
    selectedCredentialId && credentials.some((credential) => credential.id === selectedCredentialId)
      ? selectedCredentialId
      : credentials[0]?.id ?? null;

  useEffect(() => {
    if (!authRequired && selectedCredentialId) {
      form.setValue("credentialId", null);
      return;
    }
    if (!authRequired || !hasUploadedAuth) return;
    if (!selectedCredentialId || !credentials.some((credential) => credential.id === selectedCredentialId)) {
      form.setValue("credentialId", credentials[0]?.id ?? null);
    }
  }, [authRequired, hasUploadedAuth, selectedCredentialId, credentials, form]);

  const resolvedStateFile =
    authRequired && Boolean(effectiveCredentialId) ? stateFile : "";

  const handleVerifyAuth = async () => {
    if (!selectedPlatform) {
      toast.error("Please select a platform first.");
      return;
    }
    if (!effectiveCredentialId) {
      toast.error("Please upload or select a credential first.");
      return;
    }
    setAuthBusy(true);
    setAuthStatus(null);
    try {
      const result = await apiFetcher(
        `/api/follow/sources/auth/${encodeURIComponent(
          normalizePlatform(selectedPlatform).toLowerCase()
        )}/cookie?verify=true&credentialId=${encodeURIComponent(effectiveCredentialId)}`
      );
      const message = String(result?.message ?? "Verification completed.");
      setAuthStatus(message);
      if (result?.authenticated) {
        toast.success(message);
      } else {
        toast.error(message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Auth verification failed.";
      setAuthStatus(message);
      toast.error(message);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleUploadAuthFile = async (file: File) => {
    if (!selectedPlatform) {
      toast.error("Please select a platform first.");
      return;
    }
    if (!file) {
      toast.error("Please select a credential file first.");
      return;
    }
    let authData: Record<string, unknown>;
    try {
      const fileText = await file.text();
      authData = JSON.parse(fileText);
    } catch {
      toast.error("Credential file is not valid JSON.");
      return;
    }

    setAuthBusy(true);
    setAuthStatus(null);
    try {
      const result = await apiFetcher(
        `/api/follow/sources/auth/${encodeURIComponent(
          normalizePlatform(selectedPlatform).toLowerCase()
        )}/cookie`,
        {
          method: "POST",
          body: JSON.stringify({
            authData,
            sourceId: sourceIdForExistingRecord,
          }),
        }
      );
      if (result?.credentialId) {
        form.setValue("credentialId", String(result.credentialId));
      }
      const message = String(result?.message ?? "Auth uploaded and verified.");
      setAuthStatus(message);
      toast.success(message);
      await refetchCredentials();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Auth upload failed.";
      setAuthStatus(message);
      toast.error(message);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleRemoveCredential = async () => {
    if (!effectiveCredentialId) {
      toast.error("Please select a credential first.");
      return;
    }
    setAuthBusy(true);
    setAuthStatus(null);
    try {
      await apiFetcher(`/api/follow/credentials/${encodeURIComponent(effectiveCredentialId)}`, {
        method: "DELETE",
      });
      form.setValue("credentialId", null);
      await refetchCredentials();
      setAuthStatus("Credential removed.");
      toast.success("Credential removed.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Credential removal failed.";
      setAuthStatus(message);
      toast.error(message);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleOpenUploadDialog = () => {
    fileInputRef.current?.click();
  };

  const handleCredentialFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    await handleUploadAuthFile(file);
    input.value = "";
  };

  const sourceApiPreview = useMemo(() => {
    const built = buildPayloadFromUnified({
      targetCategory,
      isDarknet: effectiveIsDarknet,
      values: watchedValues,
      platform: selectedPlatform,
      intentType: selectedIntentType,
      scriptArgs,
      recallBindingArgKeys,
      driverConfig: {
        poolEnabled,
        poolIdleTimeoutMs,
        headless,
        userId: runtimeUserId,
        navigationTimeoutMs,
        stateFile: resolvedStateFile,
        filterMinChars,
        filterMatchMode,
        filterIncludeFields: effectiveFilter.include,
        filterExcludeFields: effectiveFilter.exclude,
        proxy: selectedProxy,
      },
      selectedCapabilityEngine,
    });
    if ("error" in built) return { error: built.error } as const;
    return built.payload;
  }, [
    targetCategory,
    effectiveIsDarknet,
    watchedValues,
    selectedPlatform,
    selectedIntentType,
    scriptArgs,
    recallBindingArgKeys,
    poolEnabled,
    poolIdleTimeoutMs,
    headless,
    runtimeUserId,
    navigationTimeoutMs,
    resolvedStateFile,
    filterMinChars,
    filterMatchMode,
    effectiveFilter,
    selectedProxy,
    selectedCapabilityEngine,
  ]);

  const sourceApiPreviewError =
    sourceApiPreview && "error" in sourceApiPreview ? sourceApiPreview.error : null;
  const sourceApiPreviewPending =
    !!sourceApiPreviewError && /\brequires?\b|\brequired\b/i.test(sourceApiPreviewError);

  const gatherRequestPreview = useMemo(() => {
    if (selectedCapabilityEngine !== "gather_playwright") return null;
    const normalizedPlatform = normalizePlatform(selectedPlatform);
    if (!normalizedPlatform) return null;
    const capabilityDriver =
      typeof selectedCapability?.execution.driver === "string" &&
      selectedCapability.execution.driver.trim()
        ? selectedCapability.execution.driver.trim()
        : "playwright";
    const rawOutputField = selectedCatalogItem?.sample?.outputField;
    const outputField =
      Array.isArray(rawOutputField)
        ? Array.from(
            new Set(
              rawOutputField
                .filter((item): item is string => typeof item === "string")
                .map((item) => item.trim())
                .filter(Boolean)
            )
          )
        : rawOutputField &&
            typeof rawOutputField === "object" &&
            !Array.isArray(rawOutputField)
          ? Object.fromEntries(
              Object.entries(rawOutputField as Record<string, unknown>)
                .map(([key, value]) => [key.trim(), String(value ?? "").trim()] as const)
                .filter(([key, value]) => key.length > 0 && value.length > 0)
            )
          : null;
    const output =
      outputField &&
      ((Array.isArray(outputField) && outputField.length > 0) ||
        (typeof outputField === "object" && Object.keys(outputField).length > 0))
        ? { field: outputField }
        : undefined;
    const boundArgKeys = Array.from(
      new Set(
        recallBindingArgKeys
          .map((key) => key.trim())
          .filter(Boolean)
      )
    );
    const previewIntentArgs: Record<string, unknown> = { ...scriptArgs };
    if (boundArgKeys.length > 0) {
      for (const argKey of boundArgKeys) {
        if (Object.prototype.hasOwnProperty.call(previewIntentArgs, argKey)) {
          previewIntentArgs[argKey] = "<由 Query Keywords 注入>";
        }
      }
    }
    const sourceIdPreview = sourceIdForExistingRecord ?? "<source_id>";
    const driverPreview = buildDriverConfig({
      intentType: selectedIntentType,
      intentArgs: previewIntentArgs,
      config: {
        poolEnabled,
        poolIdleTimeoutMs,
        headless,
        userId: runtimeUserId,
        navigationTimeoutMs,
        stateFile: resolvedStateFile,
        filterMinChars,
        filterMatchMode,
        filterIncludeFields: effectiveFilter.include,
        filterExcludeFields: effectiveFilter.exclude,
        proxy: selectedProxy,
      },
    });
    const effectiveUserId =
      typeof driverPreview.userId === "string" && driverPreview.userId.trim()
        ? driverPreview.userId.trim()
        : sourceIdForExistingRecord
          ? `source:${sourceIdForExistingRecord}`
          : "<默认: source:<source_id>>";
    return {
      sourceId: sourceIdPreview,
      platform: normalizedPlatform.toLowerCase(),
      userId: effectiveUserId,
      keywords: ["<由 Query Keywords 注入>"],
      driver: {
        name: capabilityDriver,
        ...driverPreview,
      },
      ...(output ? { output } : {}),
    };
  }, [
    selectedCapabilityEngine,
    selectedPlatform,
    selectedCapability?.execution.driver,
    selectedCatalogItem,
    sourceIdForExistingRecord,
    selectedIntentType,
    scriptArgs,
    recallBindingArgKeys,
    poolEnabled,
    poolIdleTimeoutMs,
    headless,
    runtimeUserId,
    navigationTimeoutMs,
    resolvedStateFile,
    filterMinChars,
    filterMatchMode,
    effectiveFilter,
    selectedProxy,
  ]);

  const onSubmit = (values: SourceFormValues) => {
    if (!values.name.trim()) {
      toast.error("Name is required.");
      return;
    }
    if (loadingCapabilities) {
      toast.error("Source capabilities are loading, please retry.");
      return;
    }
    if (!capabilities.length) {
      toast.error("Source capabilities unavailable. Please retry later.");
      return;
    }
    if (!selectedPlatform) {
      toast.error("Please select a platform.");
      return;
    }
    if (!selectedIntentType) {
      toast.error("Please select an intent.");
      return;
    }

    const built = buildPayloadFromUnified({
      targetCategory,
      isDarknet: effectiveIsDarknet,
      values,
      platform: selectedPlatform,
      intentType: selectedIntentType,
      scriptArgs,
      recallBindingArgKeys,
      driverConfig: {
        poolEnabled,
        poolIdleTimeoutMs,
        headless,
        userId: runtimeUserId,
        navigationTimeoutMs,
        stateFile: resolvedStateFile,
        filterMinChars,
        filterMatchMode,
        filterIncludeFields: effectiveFilter.include,
        filterExcludeFields: effectiveFilter.exclude,
        proxy: selectedProxy,
      },
      selectedCapabilityEngine,
    });

    if ("error" in built) {
      toast.error(built.error);
      return;
    }

    mutation.mutate(built.payload as any);
  };

  return (
    <SettingEditDialog
      props={{ open, onOpenChange }}
      title={isUpdate ? "Edit Source" : "Add Source"}
      description={
        isUpdate
          ? "Edit this source."
          : `Add a new ${expectedCategory.toLowerCase()} source.`
      }
      triggerButton={triggerButton}
      buttonText={
        mutation.isPending
          ? isUpdate
            ? "Updating..."
            : "Adding..."
          : isUpdate
            ? "Update"
            : "Add"
      }
      onSubmit={form.handleSubmit(onSubmit)}
    >
      <div ref={popoverContainerRef} className="grid gap-4">
        <Card className="gap-4 bg-muted/30">
          <CardHeader>
            <CardTitle>Basic Info</CardTitle>
            <CardDescription>
              Configure source display name and description.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="Name"
                className="bg-background"
                {...form.register("name")}
              />
              <ErrorMessage>{form.formState.errors.name?.message?.toString()}</ErrorMessage>
            </div>
            <div className="grid gap-3">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Description"
                rows={3}
                className="bg-background"
                {...form.register("description")}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="gap-4 bg-muted/30">
          <CardHeader>
            <CardTitle>Platform Selection</CardTitle>
            <CardDescription>
              Pick a platform from current source tab category.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Popover open={platformPopoverOpen} onOpenChange={setPlatformPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="h-10 w-full justify-between"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {selectedPlatform ? (
                        <>
                          <span className="truncate">{selectedPlatform}</span>
                          <Badge variant="outline">
                            {getPlatformRegion(selectedCapability?.tags)}
                          </Badge>
                          {selectedCapability?.tags?.includes("UNSPECIFIED") ? (
                            <Badge variant="secondary">UNSPECIFIED</Badge>
                          ) : null}
                        </>
                      ) : loadingCapabilities ? (
                        <span className="text-muted-foreground">Loading...</span>
                      ) : (
                        <span className="text-muted-foreground">Select platform</span>
                      )}
                    </span>
                    <ChevronsUpDown className="size-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  portal={false}
                  side="bottom"
                  align="start"
                  collisionPadding={8}
                  collisionBoundary={popoverContainerRef.current ?? undefined}
                  className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0"
                >
                  <Command>
                    <CommandInput
                      placeholder="Search platform..."
                      value={platformSearch}
                      onValueChange={setPlatformSearch}
                    />
                    <CommandList>
                      <CommandEmpty>No platform found.</CommandEmpty>
                      <CommandGroup>
                        {filteredPlatformOptions.map((platform) => (
                          <CommandItem
                            key={platform}
                            value={platform}
                            className="max-w-full"
                            onSelect={() => {
                              setSelectedPlatform(platform);
                              const available =
                                capabilityByPlatform.get(normalizePlatform(platform))
                                  ?.intents ?? [];
                              if (available.length > 0) {
                                setSelectedIntentType(available[0]?.intent ?? "search");
                              }
                              setPlatformPopoverOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 size-4",
                                platform === selectedPlatform ? "opacity-100" : "opacity-0"
                              )}
                            />
                            <span className="mr-2 truncate">{platform}</span>
                            {(() => {
                              const optionCapability = capabilityByPlatform.get(
                                normalizePlatform(platform)
                              );
                              return (
                                <>
                                  <Badge variant="outline">
                                    {getPlatformRegion(optionCapability?.tags)}
                                  </Badge>
                                  {optionCapability?.tags?.includes("UNSPECIFIED") ? (
                                    <Badge variant="secondary">UNSPECIFIED</Badge>
                                  ) : null}
                                </>
                              );
                            })()}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </CardContent>
        </Card>

        <Card className="gap-4 bg-muted/30">
          <CardHeader>
            <CardTitle>Platform Config</CardTitle>
            <CardDescription>
              Configure auth, script, network, and advanced runtime settings.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {authRequired ? (
              <Card className="gap-3 border bg-background">
                <CardHeader className="pb-0">
                  <CardTitle className="text-base">Auth</CardTitle>
                  <CardDescription>Upload and verify platform credential.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={handleCredentialFileChange}
                  />

                  {hasUploadedAuth ? (
                    <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                      <ControlledSelect
                        value={effectiveCredentialId}
                        onValueChange={(value) => form.setValue("credentialId", value)}
                        placeholder={loadingCredentials ? "Loading credentials..." : "Select credential"}
                      >
                        {credentials.map((credential) => (
                          <SelectItem key={credential.id} value={credential.id}>
                            {credential.name}
                          </SelectItem>
                        ))}
                      </ControlledSelect>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleVerifyAuth}
                        disabled={authBusy || !effectiveCredentialId}
                      >
                        {authBusy ? <Loader2 className="size-4 animate-spin" /> : "Verify"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleRemoveCredential}
                        disabled={authBusy || !effectiveCredentialId}
                      >
                        Remove
                      </Button>
                    </div>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                      <Button
                        type="button"
                        variant="outline"
                        className="justify-start"
                        onClick={handleOpenUploadDialog}
                        disabled={authBusy}
                      >
                        上传...
                      </Button>
                      <Button type="button" variant="outline" onClick={handleVerifyAuth}>
                        Verify
                      </Button>
                    </div>
                  )}

                  {authStatus ? (
                    <p className="text-xs text-muted-foreground">{authStatus}</p>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            <Card className="gap-3 border bg-background">
              <CardHeader className="pb-0">
                <CardTitle className="text-base">Script</CardTitle>
                <CardDescription>Choose script and configure args by key:value.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <ControlledSelect
                  value={selectedIntentType || null}
                  onValueChange={(value) => setSelectedIntentType(value ?? "")}
                  placeholder={
                    selectedPlatform ? "Select a script..." : "Select a platform first"
                  }
                >
                  {intentOptions.map((intent) => (
                    <SelectItem key={intent} value={intent}>
                      {intent}
                    </SelectItem>
                  ))}
                </ControlledSelect>
                <div className="grid gap-2">
                  {scriptArgEntries.map((entry, index) => (
                    <div
                      key={`${entry.key}-${index}`}
                      className="grid grid-cols-[1fr_1fr_auto_auto_auto] gap-2"
                    >
                      {(() => {
                        const normalizedEntryKey = entry.key.trim();
                        const isRecallBound =
                          normalizedEntryKey.length > 0 &&
                          recallBindingArgKeys.includes(normalizedEntryKey);
                        return (
                          <>
                      <Input
                        placeholder="key"
                        value={entry.key}
                        disabled={isRecallBound}
                        onChange={(event) => {
                          const nextKey = event.target.value;
                          setScriptArgEntries((prev) => {
                            const oldKey = prev[index]?.key?.trim() ?? "";
                            const normalizedNextKey = nextKey.trim();
                            const next = prev.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, key: nextKey } : item
                            );
                            if (oldKey && recallBindingArgKeys.includes(oldKey)) {
                              setRecallBindingArgKeys((current) =>
                                Array.from(
                                  new Set(
                                    current
                                      .map((key) => (key === oldKey ? normalizedNextKey : key))
                                      .map((key) => key.trim())
                                      .filter(Boolean)
                                  )
                                )
                              );
                            }
                            return next;
                          });
                        }}
                      />
                      <Input
                        placeholder="value"
                        value={entry.value}
                        disabled={isRecallBound}
                        onChange={(event) =>
                          setScriptArgEntries((prev) =>
                            prev.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, value: event.target.value } : item
                            )
                          )
                        }
                      />
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant={isRecallBound ? "default" : "outline"}
                            size="icon"
                            aria-label="Toggle recall binding"
                            disabled={!normalizedEntryKey}
                            onClick={() => {
                              const normalizedKey = normalizedEntryKey;
                              if (!normalizedKey) return;
                              setRecallBindingArgKeys((prev) =>
                                prev.includes(normalizedKey)
                                  ? prev.filter((key) => key !== normalizedKey)
                                  : Array.from(new Set([...prev, normalizedKey]))
                              );
                            }}
                          >
                            {isRecallBound ? (
                              <Link2 className="size-4" />
                            ) : (
                              <Unlink2 className="size-4" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent sideOffset={6}>
                          {isRecallBound
                            ? "该参数已关联召回词（Query 运行时会注入）"
                            : "关联召回词注入到该参数"}
                        </TooltipContent>
                      </Tooltip>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="Add arg row"
                        onClick={() =>
                          setScriptArgEntries((prev) => {
                            const next = [...prev];
                            next.splice(index + 1, 0, { ...EMPTY_ARG_ENTRY });
                            return next;
                          })
                        }
                      >
                        <Plus className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="Remove arg row"
                        disabled={scriptArgEntries.length <= 1}
                        onClick={() =>
                          setScriptArgEntries((prev) => {
                            if (prev.length <= 1) return prev;
                            const removingKey = prev[index]?.key?.trim();
                            if (removingKey) {
                              setRecallBindingArgKeys((current) =>
                                current.filter((key) => key !== removingKey)
                              );
                            }
                            return prev.filter((_, itemIndex) => itemIndex !== index);
                          })
                        }
                      >
                        <Minus className="size-4" />
                      </Button>
                          </>
                        );
                      })()}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  顺序：key | value | 召回词关联 | - | +。
                </p>
              </CardContent>
            </Card>

            <Card className="gap-3 border bg-background">
              <CardHeader className="pb-0">
                <CardTitle className="text-base">Network</CardTitle>
                <CardDescription>Select a proxy from proxy tab settings.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <ControlledSelect
                  value={form.watch("proxyId") ?? null}
                  onValueChange={(value) => form.setValue("proxyId", value)}
                  placeholder="No proxy"
                  nullValue="none"
                  nullLabel="No proxy"
                >
                  {proxies.map((proxy) => (
                    <SelectItem key={proxy.id} value={proxy.id}>
                      {proxy.name}
                    </SelectItem>
                  ))}
                </ControlledSelect>
              </CardContent>
            </Card>

            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <Card className="gap-3 border bg-background">
                <CardHeader className="pb-0">
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="ghost" className="h-auto justify-between p-0">
                      <span className="text-base font-semibold">Advanced</span>
                      <ChevronDown className={cn("size-4 transition", advancedOpen ? "rotate-180" : "")} />
                    </Button>
                  </CollapsibleTrigger>
                  <CardDescription>
                    Configure gather playwright runtime and filter fields.
                  </CardDescription>
                </CardHeader>
                <CollapsibleContent>
                  <CardContent className="grid gap-4">
                    <div className="flex items-center justify-between rounded-md border p-3">
                      <Label htmlFor="headless-switch">Headless</Label>
                      <Switch id="headless-switch" checked={headless} onCheckedChange={setHeadless} />
                    </div>

                    <div className="grid gap-3 rounded-md border p-3">
                      <p className="text-sm font-medium">Runtime</p>
                      <div className="grid gap-2">
                        <Label>User ID (optional)</Label>
                        <Input
                          placeholder="e.g. source:cmxxxx or custom-owner"
                          value={runtimeUserId}
                          onChange={(event) => setRuntimeUserId(event.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                          对齐 gather 顶层 `userId`，留空则默认使用 `source:&lt;sourceId&gt;`。
                        </p>
                      </div>
                      <div className="grid gap-2">
                        <Label>Navigation Timeout (ms)</Label>
                        <Input
                          type="number"
                          min={1000}
                          step={1000}
                          value={navigationTimeoutMs}
                          onChange={(event) =>
                            setNavigationTimeoutMs(parseNumber(event.target.value, 30000))
                          }
                        />
                      </div>
                    </div>

                    <div className="grid gap-3 rounded-md border p-3">
                      <p className="text-sm font-medium">Pool</p>
                      <div className="flex items-center justify-between">
                        <Label htmlFor="pool-switch">Pool Enable</Label>
                        <Switch id="pool-switch" checked={poolEnabled} onCheckedChange={setPoolEnabled} />
                      </div>
                      <div className="grid gap-2">
                        <Label>Idle Time (ms)</Label>
                        <Input
                          type="number"
                          min={1000}
                          step={1000}
                          value={poolIdleTimeoutMs}
                          onChange={(event) =>
                            setPoolIdleTimeoutMs(parseNumber(event.target.value, 120000))
                          }
                        />
                      </div>
                    </div>

                    <div className="grid gap-3 rounded-md border p-3">
                      <p className="text-sm font-medium">Filter</p>
                      <div className="grid gap-2">
                        <Label>Min Chars</Label>
                        <Input
                          type="number"
                          min={0}
                          value={filterMinChars}
                          onChange={(event) =>
                            setFilterMinChars(parseNumber(event.target.value, 8))
                          }
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>Match Mode</Label>
                        <ControlledSelect
                          value={filterMatchMode}
                          onValueChange={(value) =>
                            setFilterMatchMode(
                              (value as "smart" | "contains" | "term_and_word_boundary") ?? "smart"
                            )
                          }
                          placeholder="Select match mode"
                        >
                          <SelectItem value="smart">smart</SelectItem>
                          <SelectItem value="contains">contains</SelectItem>
                          <SelectItem value="term_and_word_boundary">
                            term_and_word_boundary
                          </SelectItem>
                        </ControlledSelect>
                        <p className="text-xs text-muted-foreground">
                          {FILTER_MODE_DESCRIPTIONS[filterMatchMode]}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {FILTER_MODE_EXAMPLES[filterMatchMode]}
                        </p>
                        <p className="text-xs text-amber-700 dark:text-amber-300">
                          注意：若 Query 为该 Source 配置了 Content Filter Mode，将覆盖这里的默认值。
                        </p>
                      </div>
                      <div className="grid gap-2">
                        <Label>Include Fields (optional)</Label>
                        <MultiSelect
                          options={outputFieldMultiSelectOptions.filter(
                            (option) => !filterExcludeFields.includes(option.value)
                          )}
                          value={filterIncludeFields}
                          onValueChange={(next) => {
                            setFilterIncludeFields(next);
                            setFilterExcludeFields((current) =>
                              current.filter((field) => !next.includes(field))
                            );
                          }}
                          placeholder="Empty = all fields except exclude"
                        />
                        <p className="text-xs text-muted-foreground">
                          为空时，默认选择除 Exclude Fields 外的全部字段。
                        </p>
                      </div>
                      <div className="grid gap-2">
                        <Label>Exclude Fields (optional)</Label>
                        <MultiSelect
                          options={outputFieldMultiSelectOptions.filter(
                            (option) => !filterIncludeFields.includes(option.value)
                          )}
                          value={filterExcludeFields}
                          onValueChange={(next) => {
                            setFilterExcludeFields(next);
                            setFilterIncludeFields((current) =>
                              current.filter((field) => !next.includes(field))
                            );
                          }}
                          placeholder="Default: url"
                        />
                        <p className="text-xs text-muted-foreground">
                          默认排除 `url`。Include 与 Exclude 互斥，避免冲突。
                        </p>
                      </div>
                      <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                        Effective Include: {effectiveFilter.include.join(", ") || "(empty)"} · Exclude:{" "}
                        {effectiveFilter.exclude.join(", ") || "(empty)"}
                      </div>
                    </div>

                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          </CardContent>
        </Card>

        <Card className="gap-4 bg-muted/30">
          <CardHeader>
            <CardTitle>Preview</CardTitle>
            <CardDescription>
              Review payloads before saving. Runtime-injected fields use placeholders.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <div className="flex items-center gap-1.5">
                <p className="text-xs font-medium text-muted-foreground">Source API Payload</p>
                {!sourceApiPreviewError ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    aria-label="Copy source api payload"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          JSON.stringify(sourceApiPreview ?? {}, null, 2)
                        );
                        toast.success("Copied source payload");
                      } catch {
                        toast.error("Failed to copy source payload");
                      }
                    }}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                ) : null}
              </div>
              {sourceApiPreviewError ? (
                <div
                  className={cn(
                    "rounded-md px-3 py-2 text-xs",
                    sourceApiPreviewPending
                      ? "border border-amber-300/60 bg-amber-50 text-amber-700 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-300"
                      : "border border-destructive/40 bg-destructive/5 text-destructive"
                  )}
                >
                  {sourceApiPreviewPending
                    ? `预览暂不可用：${sourceApiPreviewError}（补全后会自动显示 JSON）`
                    : sourceApiPreviewError}
                </div>
              ) : (
                <pre className="max-h-64 overflow-auto rounded-md bg-background p-3 text-xs leading-5">
                  {JSON.stringify(sourceApiPreview ?? {}, null, 2)}
                </pre>
              )}
            </div>

            {gatherRequestPreview ? (
              <div className="grid gap-2">
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Gather Request Payload</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    aria-label="Copy gather request payload"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          JSON.stringify(gatherRequestPreview, null, 2)
                        );
                        toast.success("Copied gather preview");
                      } catch {
                        toast.error("Failed to copy gather preview");
                      }
                    }}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                </div>
                <pre className="max-h-64 overflow-auto rounded-md bg-background p-3 text-xs leading-5">
                  {JSON.stringify(gatherRequestPreview, null, 2)}
                </pre>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </SettingEditDialog>
  );
};

export default SourceDialog;
