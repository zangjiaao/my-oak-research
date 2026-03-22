"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { SourceType } from "@/app/generated/prisma";
import { SourceWithRelations } from "@/lib/types";
import { useSourceMutation } from "@/hooks/useSourceMutation";
import { cn } from "@/lib/utils";

type SourceFormValues = {
  name: string;
  description?: string | null;
  active?: boolean;
  rateLimit?: number | null;
  proxyId?: string | null;
  credentialId?: string | null;
};

type GatherCatalogItem = {
  key: string;
  platform: string;
  intent: string;
  mode: string;
  sample?: {
    intentType?: string;
    intentArgs?: Record<string, unknown>;
  };
};

type GatherCatalogResponse = {
  items: GatherCatalogItem[];
};

type SourceCategory = "STREAM" | "INTERACTIVE" | "RETRIEVAL";

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

const PLATFORM_CATEGORY_MAP: Record<string, SourceCategory> = {
  BBC: "STREAM",
  REUTERS: "STREAM",
  X: "INTERACTIVE",
  XIAOHONGSHU: "INTERACTIVE",
  REDDIT: "INTERACTIVE",
  TELEGRAM: "INTERACTIVE",
  INSTAGRAM: "INTERACTIVE",
  FACEBOOK: "INTERACTIVE",
  DOUYIN: "INTERACTIVE",
  TIKTOK: "INTERACTIVE",
  WEIBO: "INTERACTIVE",
  WHATSAPP: "INTERACTIVE",
  PARALLEL: "RETRIEVAL",
  TAVILY: "RETRIEVAL",
  GOOGLE: "RETRIEVAL",
  DARKWEBGO: "RETRIEVAL",
  DARKSEARCH: "RETRIEVAL",
};

const SEARCH_PLATFORM_MAP: Record<string, "PARALLEL" | "TAVILY" | "ANSPIRE" | "CUSTOM"> = {
  PARALLEL: "PARALLEL",
  TAVILY: "TAVILY",
  ANSPIRE: "ANSPIRE",
};

const DOMESTIC_PLATFORMS = new Set(["XIAOHONGSHU", "DOUYIN", "WEIBO"]);

function normalizePlatform(value?: string | null): string {
  return String(value ?? "").trim().toUpperCase();
}

function inferCategoryFromSourceType(type: SourceType): SourceCategory {
  if (type === "WEB") return "STREAM";
  if (type === "SOCIAL_MEDIA") return "INTERACTIVE";
  return "RETRIEVAL";
}

function inferCategoryFromPlatform(platform: string): SourceCategory {
  return PLATFORM_CATEGORY_MAP[normalizePlatform(platform)] ?? "RETRIEVAL";
}

function getPlatformRegion(platform: string): "国内" | "国外" {
  return DOMESTIC_PLATFORMS.has(normalizePlatform(platform)) ? "国内" : "国外";
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
      intentType: "search",
      scriptArgs: {},
      poolEnabled: true,
      poolIdleTimeoutMs: 120000,
      headless: false,
      stateFile: ".auth/x_auth.json",
      filterMinChars: 8,
    };
  }

  if (source.type === "SOCIAL_MEDIA" && "social" in source && source.social) {
    const config = (source.social.config as Record<string, unknown>) ?? {};
    const driver =
      config.driver && typeof config.driver === "object" && !Array.isArray(config.driver)
        ? (config.driver as Record<string, unknown>)
        : {};
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
      category: inferCategoryFromPlatform(source.social.platform ?? ""),
      platform: source.social.platform ?? "",
      intentType:
        (typeof script.type === "string" && script.type.trim()) ||
        (typeof intent.type === "string" && intent.type.trim())
          ? String(script.type ?? intent.type)
          : "search",
      scriptArgs: intentArgs,
      poolEnabled: typeof driver.poolEnabled === "boolean" ? driver.poolEnabled : true,
      poolIdleTimeoutMs: parseNumber(driver.poolIdleTimeoutMs, 120000),
      headless: typeof driver.headless === "boolean" ? driver.headless : false,
      stateFile:
        typeof driver.stateFile === "string" && driver.stateFile.trim()
          ? driver.stateFile
          : ".auth/x_auth.json",
      filterMinChars: parseNumber(filter.minChars, 8),
    };
  }

  if (source.type === "SEARCH_ENGINE" && "search" in source && source.search) {
    const options =
      source.search.options && typeof source.search.options === "object"
        ? (source.search.options as Record<string, unknown>)
        : {};
    return {
      category: inferCategoryFromPlatform(String(options.provider ?? source.search.platform ?? "")),
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

  if (source.type === "WEB" && "web" in source && source.web) {
    return {
      category: "STREAM",
      platform: "BBC",
      intentType: "crawl",
      scriptArgs: { url: source.web.url ?? [] },
      poolEnabled: true,
      poolIdleTimeoutMs: 120000,
      headless: false,
      stateFile: "",
      filterMinChars: 8,
    };
  }

  if (source.type === "DARKNET" && "darknet" in source && source.darknet) {
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
    intentType: "search",
    scriptArgs: {},
    poolEnabled: true,
    poolIdleTimeoutMs: 120000,
    headless: false,
    stateFile: ".auth/x_auth.json",
    filterMinChars: 8,
  };
}

function buildPayloadFromUnified(input: {
  effectiveType: SourceType;
  values: SourceFormValues;
  platform: string;
  intentType: string;
  scriptArgs: Record<string, unknown>;
  driverConfig: DriverConfigInput;
}) {
  const { effectiveType, values, platform, intentType, scriptArgs, driverConfig } = input;
  const intentArgs = scriptArgs;
  const driver = buildDriverConfig({ intentType, intentArgs, config: driverConfig });

  const base = {
    name: values.name.trim(),
    description: values.description?.trim() ?? "",
    type: effectiveType,
    active: values.active ?? true,
    rateLimit: values.rateLimit ?? 10,
    proxyId: values.proxyId ?? null,
    credentialId: values.credentialId ?? null,
  };

  if (effectiveType === "WEB") {
    const urls = splitToUrls(
      intentArgs.url ?? intentArgs.urls ?? intentArgs.targetUrl ?? intentArgs.site
    );
    if (urls.length === 0) {
      return { error: "Stream source requires at least one URL in intent args (url/urls/targetUrl)." };
    }
    return {
      payload: {
        ...base,
        type: "WEB" as const,
        web: {
          url: urls,
          crawlerEngine: "FETCH" as const,
          render: false,
          robotsRespect: true,
          headers: null,
          parseRules: null,
          proxyId: values.proxyId ?? null,
        },
      },
    };
  }

  if (effectiveType === "SEARCH_ENGINE") {
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
        type: "SEARCH_ENGINE" as const,
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

  if (effectiveType === "DARKNET") {
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
        type: "DARKNET" as const,
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

  return {
    payload: {
      ...base,
      type: "SOCIAL_MEDIA" as const,
      social: {
        platform: normalizedPlatform,
        config: {
          driver,
        },
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
  onOpenChange,
  open,
}: {
  triggerButton?: React.ReactNode;
  source?: SourceWithRelations;
  proxies: Proxy[];
  sourceType?: SourceType;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) => {
  const [currentSource, setCurrentSource] = useState<SourceWithRelations | undefined>(propSource);
  const [currentSourceType, setCurrentSourceType] = useState(propSourceType);

  useEffect(() => {
    if (open) {
      setCurrentSource(propSource);
      setCurrentSourceType(propSourceType);
    }
  }, [open, propSource, propSourceType]);

  const isUpdate = !!currentSource;
  const effectiveType: SourceType = currentSourceType || currentSource?.type || "SOCIAL_MEDIA";

  const initialScriptState = useMemo(() => getInitialScriptState(currentSource), [currentSource]);

  const [selectedPlatform, setSelectedPlatform] = useState(initialScriptState.platform);
  const [selectedIntentType, setSelectedIntentType] = useState(initialScriptState.intentType);
  const [scriptArgEntries, setScriptArgEntries] = useState<ScriptArgEntry[]>(
    (() => {
      const entries = toScriptArgEntries(initialScriptState.scriptArgs);
      return entries.length > 0 ? entries : [EMPTY_ARG_ENTRY];
    })()
  );
  const [poolEnabled, setPoolEnabled] = useState(initialScriptState.poolEnabled);
  const [poolIdleTimeoutMs, setPoolIdleTimeoutMs] = useState(initialScriptState.poolIdleTimeoutMs);
  const [headless, setHeadless] = useState(initialScriptState.headless);
  const [stateFile, setStateFile] = useState(initialScriptState.stateFile);
  const [filterMinChars, setFilterMinChars] = useState(initialScriptState.filterMinChars);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [credentialName, setCredentialName] = useState("");
  const [authUploadText, setAuthUploadText] = useState("");
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
      return entries.length > 0 ? entries : [EMPTY_ARG_ENTRY];
    });
    setPoolEnabled(initialScriptState.poolEnabled);
    setPoolIdleTimeoutMs(initialScriptState.poolIdleTimeoutMs);
    setHeadless(initialScriptState.headless);
    setStateFile(initialScriptState.stateFile);
    setFilterMinChars(initialScriptState.filterMinChars);
    setAdvancedOpen(false);
    setCredentialName("");
    setAuthUploadText("");
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

  const { data: catalog, isLoading: loadingCatalog } = useQuery<GatherCatalogResponse>({
    queryKey: ["gather-script-catalog"],
    queryFn: () => apiFetcher("/api/follow/gather-scripts/catalog"),
    enabled: open,
  });

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

  const mutation = useSourceMutation({
    sourceId: currentSource?.id,
    sourceType: effectiveType,
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

  const expectedCategory = inferCategoryFromSourceType(effectiveType);
  const watchedValues = form.watch();
  const watchedProxyId = form.watch("proxyId");
  const selectedProxy = useMemo(
    () => proxies.find((proxy) => proxy.id === watchedProxyId) ?? null,
    [proxies, watchedProxyId]
  );

  const platformOptions = useMemo(() => {
    const items = catalog?.items ?? [];
    const grouped = new Set<string>();
    for (const item of items) {
      const platform = normalizePlatform(item.platform);
      if (!platform) continue;
      if (inferCategoryFromPlatform(platform) !== expectedCategory) continue;
      grouped.add(platform);
    }
    return Array.from(grouped).sort((a, b) => a.localeCompare(b));
  }, [catalog?.items, expectedCategory]);

  const filteredPlatformOptions = useMemo(() => {
    const keyword = platformSearch.trim().toLowerCase();
    if (!keyword) return platformOptions;
    return platformOptions.filter((platform) =>
      platform.toLowerCase().includes(keyword)
    );
  }, [platformOptions, platformSearch]);

  const intentOptions = useMemo(() => {
    const platform = normalizePlatform(selectedPlatform);
    const intents = new Set<string>();
    for (const item of catalog?.items ?? []) {
      if (normalizePlatform(item.platform) !== platform) continue;
      if (item.intent) intents.add(item.intent);
    }
    if (intents.size === 0) intents.add("search");
    return Array.from(intents).sort((a, b) => a.localeCompare(b));
  }, [catalog?.items, selectedPlatform]);

  const selectedCatalogItem = useMemo(() => {
    const platform = normalizePlatform(selectedPlatform);
    if (!platform || !selectedIntentType) return null;
    return (
      (catalog?.items ?? []).find(
        (item) =>
          normalizePlatform(item.platform) === platform && item.intent === selectedIntentType
      ) ?? null
    );
  }, [catalog?.items, selectedPlatform, selectedIntentType]);

  useEffect(() => {
    const sampleArgs = selectedCatalogItem?.sample?.intentArgs ?? {};
    const sampleEntries = toScriptArgEntries(sampleArgs);
    if (sampleEntries.length === 0) return;
    setScriptArgEntries((prev) => {
      if (prev.length === 0) return sampleEntries;
      const existingKeys = new Set(prev.map((entry) => entry.key.trim()).filter(Boolean));
      const missing = sampleEntries.filter((entry) => !existingKeys.has(entry.key.trim()));
      if (missing.length === 0) return prev;
      return [...prev, ...missing.map((entry) => ({ ...entry, value: "" }))];
    });
  }, [selectedCatalogItem]);

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

  const handleVerifyAuth = async () => {
    if (!selectedPlatform) {
      toast.error("Please select a platform first.");
      return;
    }
    setAuthBusy(true);
    setAuthStatus(null);
    try {
      const result = await apiFetcher(
        `/api/follow/sources/auth/${encodeURIComponent(
          normalizePlatform(selectedPlatform).toLowerCase()
        )}/cookie?verify=true`
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

  const handleUploadAuth = async () => {
    if (!selectedPlatform) {
      toast.error("Please select a platform first.");
      return;
    }
    if (!authUploadText.trim()) {
      toast.error("Please paste auth JSON first.");
      return;
    }
    let authData: Record<string, unknown>;
    try {
      authData = JSON.parse(authUploadText);
    } catch {
      toast.error("Auth JSON is invalid.");
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
            ...(credentialName.trim() ? { name: credentialName.trim() } : {}),
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

  const sourceApiPreview = useMemo(() => {
    const built = buildPayloadFromUnified({
      effectiveType,
      values: watchedValues,
      platform: selectedPlatform,
      intentType: selectedIntentType,
      scriptArgs,
      driverConfig: {
        poolEnabled,
        poolIdleTimeoutMs,
        headless,
        stateFile,
        filterMinChars,
        proxy: selectedProxy,
      },
    });
    if ("error" in built) return { error: built.error } as const;
    return built.payload;
  }, [
    effectiveType,
    watchedValues,
    selectedPlatform,
    selectedIntentType,
    scriptArgs,
    poolEnabled,
    poolIdleTimeoutMs,
    headless,
    stateFile,
    filterMinChars,
    selectedProxy,
  ]);

  const sourceApiPreviewError =
    sourceApiPreview && "error" in sourceApiPreview ? sourceApiPreview.error : null;
  const sourceApiPreviewPending =
    !!sourceApiPreviewError && /\brequires?\b|\brequired\b/i.test(sourceApiPreviewError);

  const gatherRequestPreview = useMemo(() => {
    if (effectiveType !== "SOCIAL_MEDIA") return null;
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
          stateFile,
          filterMinChars,
          proxy: selectedProxy,
        },
      }),
    };
  }, [
    effectiveType,
    selectedPlatform,
    currentSource?.id,
    selectedIntentType,
    scriptArgs,
    poolEnabled,
    poolIdleTimeoutMs,
    headless,
    stateFile,
    filterMinChars,
    selectedProxy,
  ]);

  const onSubmit = (values: SourceFormValues) => {
    if (!values.name.trim()) {
      toast.error("Name is required.");
      return;
    }
    if (loadingCatalog) {
      toast.error("Scripts catalog is loading, please retry.");
      return;
    }
    if (!catalog || !Array.isArray(catalog.items) || catalog.items.length === 0) {
      toast.error("Scripts catalog unavailable. Please retry later.");
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
      effectiveType,
      values,
      platform: selectedPlatform,
      intentType: selectedIntentType,
      scriptArgs,
      driverConfig: {
        poolEnabled,
        poolIdleTimeoutMs,
        headless,
        stateFile,
        filterMinChars,
        proxy: selectedProxy,
      },
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
              <Input id="name" placeholder="Name" {...form.register("name")} />
              <ErrorMessage>{form.formState.errors.name?.message?.toString()}</ErrorMessage>
            </div>
            <div className="grid gap-3">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Description"
                rows={3}
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
                          <Badge variant="outline">{getPlatformRegion(selectedPlatform)}</Badge>
                        </>
                      ) : loadingCatalog ? (
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
                    <CommandEmpty>No platform found.</CommandEmpty>
                    <CommandGroup>
                      {filteredPlatformOptions.map((platform) => (
                        <CommandItem
                          key={platform}
                          value={platform}
                          className="max-w-full"
                          onSelect={() => {
                            setSelectedPlatform(platform);
                            const available = (catalog?.items ?? []).filter(
                              (item) =>
                                normalizePlatform(item.platform) === normalizePlatform(platform)
                            );
                            if (available.length > 0) {
                              setSelectedIntentType(available[0]?.intent || "search");
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
                          <Badge variant="outline">{getPlatformRegion(platform)}</Badge>
                        </CommandItem>
                      ))}
                    </CommandGroup>
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
            <Card className="gap-3 border bg-background/70">
              <CardHeader className="pb-0">
                <CardTitle className="text-base">Auth</CardTitle>
                <CardDescription>Upload and verify platform credential.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <ControlledSelect
                    value={form.watch("credentialId") ?? null}
                    onValueChange={(value) => form.setValue("credentialId", value)}
                    placeholder={loadingCredentials ? "Loading credentials..." : "Select credential"}
                  >
                    {credentials.map((credential) => (
                      <SelectItem key={credential.id} value={credential.id}>
                        {credential.name}
                      </SelectItem>
                    ))}
                  </ControlledSelect>
                  <Button type="button" variant="outline" onClick={handleVerifyAuth} disabled={authBusy}>
                    {authBusy ? <Loader2 className="size-4 animate-spin" /> : "Verify"}
                  </Button>
                </div>
                <Input
                  value={credentialName}
                  onChange={(event) => setCredentialName(event.target.value)}
                  placeholder="Credential name (optional)"
                />
                <Textarea
                  rows={4}
                  value={authUploadText}
                  onChange={(event) => setAuthUploadText(event.target.value)}
                  placeholder='{"cookies": [...], "origins": [...]}'
                />
                <Button type="button" variant="secondary" onClick={handleUploadAuth} disabled={authBusy}>
                  {authBusy ? <Loader2 className="size-4 animate-spin" /> : "Upload & Verify"}
                </Button>
                {authStatus ? (
                  <p className="text-xs text-muted-foreground">{authStatus}</p>
                ) : null}
              </CardContent>
            </Card>

            <Card className="gap-3 border bg-background/70">
              <CardHeader className="pb-0">
                <CardTitle className="text-base">Script</CardTitle>
                <CardDescription>Choose script and configure args by key:value.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <ControlledSelect
                  value={selectedIntentType || null}
                  onValueChange={(value) => setSelectedIntentType(value ?? "search")}
                  placeholder="Select script type"
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

            <Card className="gap-3 border bg-background/70">
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
              <Card className="gap-3 border bg-background/70">
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
