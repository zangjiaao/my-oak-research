"use client";

import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ChevronDown, ChevronsUpDown, Loader2, Minus, Plus } from "lucide-react";

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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ErrorMessage } from "@/components/business";
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

type SourceCapabilityResponse = {
  items: SourceCapability[];
};

type DriverConfigInput = {
  poolEnabled: boolean;
  poolIdleTimeoutMs: number;
  headless: boolean;
  stateFile: string;
  filterMinChars: number;
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

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
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

function parseScriptArgValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return "";
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
    output[key] = parseScriptArgValue(entry.value);
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
    stateFile: config.stateFile.trim() || undefined,
    script: {
      type: intentType || "search",
      args: intentArgs,
    },
    filter: {
      minChars: parseNumber(config.filterMinChars, 8),
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
  poolEnabled: boolean;
  poolIdleTimeoutMs: number;
  headless: boolean;
  stateFile: string;
  filterMinChars: number;
} {
  if (!source) {
    return {
      category: "INTERACTIVE",
      platform: "",
      intentType: "",
      scriptArgs: {},
      poolEnabled: true,
      poolIdleTimeoutMs: 120000,
      headless: false,
      stateFile: "",
      filterMinChars: 8,
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
    const filter =
      driver.filter && typeof driver.filter === "object" && !Array.isArray(driver.filter)
        ? (driver.filter as Record<string, unknown>)
        : {};
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
      stateFile:
        typeof driver.stateFile === "string" && driver.stateFile.trim()
          ? driver.stateFile
          : typeof playwright.stateFile === "string" && playwright.stateFile.trim()
            ? String(playwright.stateFile)
          : "",
      filterMinChars: parseNumber(filter.minChars, 8),
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
    return {
      category: "RETRIEVAL",
      platform: String(options.provider ?? source.search.platform ?? ""),
      intentType: "search",
      scriptArgs: { query: source.search.objective ?? "" },
      poolEnabled: true,
      poolIdleTimeoutMs: 120000,
      headless: false,
      stateFile: "",
      filterMinChars: 8,
    };
  }

  if (source.category === "STREAM" && "web" in source && source.web) {
    const parseRules = asRecord(source.web.parseRules);
    const gather = asRecord(parseRules.gather);
    const gatherIntentArgs = asRecord(gather.intentArgs);
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
      poolEnabled: true,
      poolIdleTimeoutMs: 120000,
      headless: false,
      stateFile: "",
      filterMinChars: 8,
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
      poolEnabled: true,
      poolIdleTimeoutMs: 120000,
      headless: false,
      stateFile: "",
      filterMinChars: 8,
    };
  }

  return {
    category: "INTERACTIVE",
    platform: "",
    intentType: "",
    scriptArgs: {},
    poolEnabled: true,
    poolIdleTimeoutMs: 120000,
    headless: false,
    stateFile: "",
    filterMinChars: 8,
  };
}

function buildPayloadFromUnified(input: {
  targetCategory: SourceCategory;
  isDarknet: boolean;
  values: SourceFormValues;
  platform: string;
  intentType: string;
  scriptArgs: Record<string, unknown>;
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
    driverConfig,
    selectedCapabilityEngine,
  } =
    input;
  const intentArgs = scriptArgs;
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
    },
    playwright: {
      mode: "eval-js",
      headless: driverConfig.headless,
      poolEnabled: driverConfig.poolEnabled,
      poolIdleTimeoutMs: parseNumber(driverConfig.poolIdleTimeoutMs, 120000),
      args: Object.fromEntries(
        Object.entries(intentArgs).map(([key, value]) => [key, String(value ?? "")])
      ),
    },
    runtime: driver,
  };

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
  onOpenChange,
  open,
}: {
  triggerButton?: React.ReactNode;
  source?: SourceWithRelations;
  proxies: Proxy[];
  sourceType?: SourceCategory;
  sourceIsDarknet?: boolean;
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

  const isUpdate = !!currentSource;
  const effectiveCategory: SourceCategory =
    currentSourceType || currentSource?.category || "INTERACTIVE";
  const effectiveIsDarknet = currentSource?.isDarknet ?? currentIsDarknet;

  const initialScriptState = useMemo(() => getInitialScriptState(currentSource), [currentSource]);

  const [selectedPlatform, setSelectedPlatform] = useState(initialScriptState.platform);
  const [selectedIntentType, setSelectedIntentType] = useState(initialScriptState.intentType);
  const [scriptArgEntries, setScriptArgEntries] = useState<ScriptArgEntry[]>(
    (() => {
      const entries = toScriptArgEntries(initialScriptState.scriptArgs);
      return entries.length > 0 ? entries : [];
    })()
  );
  const [poolEnabled, setPoolEnabled] = useState(initialScriptState.poolEnabled);
  const [poolIdleTimeoutMs, setPoolIdleTimeoutMs] = useState(initialScriptState.poolIdleTimeoutMs);
  const [headless, setHeadless] = useState(initialScriptState.headless);
  const [stateFile, setStateFile] = useState(initialScriptState.stateFile);
  const [filterMinChars, setFilterMinChars] = useState(initialScriptState.filterMinChars);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authStatus, setAuthStatus] = useState<string | null>(null);
  const [platformPopoverOpen, setPlatformPopoverOpen] = useState(false);
  const [platformSearch, setPlatformSearch] = useState("");
  const popoverContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedPlatform(initialScriptState.platform);
    setSelectedIntentType(initialScriptState.intentType);
    setScriptArgEntries(() => {
      const entries = toScriptArgEntries(initialScriptState.scriptArgs);
      return entries.length > 0 ? entries : [];
    });
    setPoolEnabled(initialScriptState.poolEnabled);
    setPoolIdleTimeoutMs(initialScriptState.poolIdleTimeoutMs);
    setHeadless(initialScriptState.headless);
    setStateFile(initialScriptState.stateFile);
    setFilterMinChars(initialScriptState.filterMinChars);
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
      name: currentSource?.name ?? "",
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
      name: currentSource?.name ?? "",
      description: currentSource?.description ?? "",
      active: currentSource?.active ?? true,
      rateLimit: currentSource?.rateLimit ?? 10,
      proxyId: currentSource?.proxyId ?? null,
      credentialId: currentSource?.credentialId ?? null,
    });
  }, [open, currentSource, form]);

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
    sourceId: currentSource?.id,
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
      setScriptArgEntries([]);
      return;
    }
    const sampleArgs = selectedCatalogItem?.sample?.intentArgs ?? {};
    const sampleEntries = toScriptArgEntries(sampleArgs);
    if (sampleEntries.length === 0) {
      setScriptArgEntries((prev) => (prev.length > 0 ? prev : [EMPTY_ARG_ENTRY]));
      return;
    }
    setScriptArgEntries((prev) => {
      const prevAllEmpty = prev.length === 0 || prev.every(
        (entry) => !entry.key.trim() && !entry.value.trim()
      );
      if (prevAllEmpty) return sampleEntries;
      const existingKeys = new Set(prev.map((entry) => entry.key.trim()).filter(Boolean));
      const missing = sampleEntries.filter((entry) => !existingKeys.has(entry.key.trim()));
      if (missing.length === 0) return prev;
      return [...prev, ...missing.map((entry) => ({ ...entry, value: "" }))];
    });
  }, [selectedCatalogItem, selectedIntentType, selectedPlatform]);

  const scriptArgs = useMemo(() => entriesToScriptArgs(scriptArgEntries), [scriptArgEntries]);

  const {
    data: credentialData,
    isLoading: loadingCredentials,
    refetch: refetchCredentials,
  } = useQuery<CredentialListResponse>({
    queryKey: ["source-credentials", normalizePlatform(selectedPlatform)],
    queryFn: () =>
      apiFetcher(
        selectedPlatform
          ? `/api/follow/credentials?platform=${encodeURIComponent(
              normalizePlatform(selectedPlatform).toLowerCase()
            )}`
          : "/api/follow/credentials"
      ),
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
            sourceId: currentSource?.id,
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
      driverConfig: {
        poolEnabled,
        poolIdleTimeoutMs,
        headless,
        stateFile: resolvedStateFile,
        filterMinChars,
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
    poolEnabled,
    poolIdleTimeoutMs,
    headless,
    resolvedStateFile,
    filterMinChars,
    selectedProxy,
  ]);

  const sourceApiPreviewError =
    sourceApiPreview && "error" in sourceApiPreview ? sourceApiPreview.error : null;
  const sourceApiPreviewPending =
    !!sourceApiPreviewError && /\brequires?\b|\brequired\b/i.test(sourceApiPreviewError);

  const gatherRequestPreview = useMemo(() => {
    if (selectedCapabilityEngine !== "gather_playwright") return null;
    const normalizedPlatform = normalizePlatform(selectedPlatform);
    if (!normalizedPlatform) return null;
    return {
      sourceId: currentSource?.id ?? "__SOURCE_ID__",
      platform: normalizedPlatform.toLowerCase(),
      keywords: [],
      driver: buildDriverConfig({
        intentType: selectedIntentType,
        intentArgs: scriptArgs,
        config: {
          poolEnabled,
          poolIdleTimeoutMs,
          headless,
          stateFile: resolvedStateFile,
          filterMinChars,
          proxy: selectedProxy,
        },
      }),
    };
  }, [
    selectedCapabilityEngine,
    selectedPlatform,
    currentSource?.id,
    selectedIntentType,
    scriptArgs,
    poolEnabled,
    poolIdleTimeoutMs,
    headless,
    resolvedStateFile,
    filterMinChars,
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
      driverConfig: {
        poolEnabled,
        poolIdleTimeoutMs,
        headless,
        stateFile: resolvedStateFile,
        filterMinChars,
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
                      className="grid grid-cols-[1fr_1fr_auto_auto] gap-2"
                    >
                      <Input
                        placeholder="key"
                        value={entry.key}
                        onChange={(event) =>
                          setScriptArgEntries((prev) =>
                            prev.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, key: event.target.value } : item
                            )
                          )
                        }
                      />
                      <Input
                        placeholder="value"
                        value={entry.value}
                        onChange={(event) =>
                          setScriptArgEntries((prev) =>
                            prev.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, value: event.target.value } : item
                            )
                          )
                        }
                      />
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
                            return prev.filter((_, itemIndex) => itemIndex !== index);
                          })
                        }
                      >
                        <Minus className="size-4" />
                      </Button>
                    </div>
                  ))}
                </div>
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
                  <CardDescription>Headless, pool, and filter settings.</CardDescription>
                </CardHeader>
                <CollapsibleContent>
                  <CardContent className="grid gap-4">
                    <div className="flex items-center justify-between rounded-md border p-3">
                      <Label htmlFor="headless-switch">Headless</Label>
                      <Switch id="headless-switch" checked={headless} onCheckedChange={setHeadless} />
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
              Review request payloads before saving.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <p className="text-xs font-medium text-muted-foreground">Source API Payload</p>
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
                <p className="text-xs font-medium text-muted-foreground">Gather Request Payload</p>
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
