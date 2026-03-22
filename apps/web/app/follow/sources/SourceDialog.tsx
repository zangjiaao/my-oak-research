"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ChevronsUpDown } from "lucide-react";

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
  proxyHost: string;
  proxyPort: string;
  proxyUsername: string;
  proxyPassword: string;
};

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

function parseArgsText(argsText: string): Record<string, unknown> {
  const raw = argsText.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
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

function stringifyIntentArgs(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "{}";
  }
  return JSON.stringify(value, null, 2);
}

function parseNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildDriverConfig(input: {
  intentType: string;
  intentArgsText: string;
  config: DriverConfigInput;
}) {
  const { intentType, intentArgsText, config } = input;
  const proxyPort = Number(config.proxyPort);
  const hasProxy =
    !!config.proxyHost.trim() ||
    Number.isFinite(proxyPort) ||
    !!config.proxyUsername.trim() ||
    !!config.proxyPassword;
  const proxy = hasProxy
    ? {
        host: config.proxyHost.trim() || "localhost",
        port: Number.isFinite(proxyPort) ? proxyPort : 8080,
        username: config.proxyUsername.trim() || undefined,
        password: config.proxyPassword || undefined,
      }
    : null;
  return {
    poolEnabled: config.poolEnabled,
    poolIdleTimeoutMs: parseNumber(config.poolIdleTimeoutMs, 120000),
    headless: config.headless,
    stateFile: config.stateFile.trim() || undefined,
    script: {
      type: intentType || "search",
      args: parseArgsText(intentArgsText),
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
  intentArgsText: string;
  poolEnabled: boolean;
  poolIdleTimeoutMs: number;
  headless: boolean;
  stateFile: string;
  filterMinChars: number;
  proxyHost: string;
  proxyPort: string;
  proxyUsername: string;
  proxyPassword: string;
} {
  if (!source) {
    return {
      category: "INTERACTIVE",
      platform: "",
      intentType: "search",
      intentArgsText: "{}",
      poolEnabled: true,
      poolIdleTimeoutMs: 120000,
      headless: false,
      stateFile: ".auth/x_auth.json",
      filterMinChars: 8,
      proxyHost: "",
      proxyPort: "",
      proxyUsername: "",
      proxyPassword: "",
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
    const network =
      driver.network && typeof driver.network === "object" && !Array.isArray(driver.network)
        ? (driver.network as Record<string, unknown>)
        : {};
    const proxy =
      network.proxy && typeof network.proxy === "object" && !Array.isArray(network.proxy)
        ? (network.proxy as Record<string, unknown>)
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
      intentArgsText: stringifyIntentArgs(intentArgs),
      poolEnabled: typeof driver.poolEnabled === "boolean" ? driver.poolEnabled : true,
      poolIdleTimeoutMs: parseNumber(driver.poolIdleTimeoutMs, 120000),
      headless: typeof driver.headless === "boolean" ? driver.headless : false,
      stateFile:
        typeof driver.stateFile === "string" && driver.stateFile.trim()
          ? driver.stateFile
          : ".auth/x_auth.json",
      filterMinChars: parseNumber(filter.minChars, 8),
      proxyHost: typeof proxy.host === "string" ? proxy.host : "",
      proxyPort:
        typeof proxy.port === "number" && Number.isFinite(proxy.port)
          ? String(proxy.port)
          : "",
      proxyUsername: typeof proxy.username === "string" ? proxy.username : "",
      proxyPassword: typeof proxy.password === "string" ? proxy.password : "",
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
      intentArgsText: stringifyIntentArgs({ query: source.search.objective ?? "" }),
      poolEnabled: true,
      poolIdleTimeoutMs: 120000,
      headless: false,
      stateFile: "",
      filterMinChars: 8,
      proxyHost: "",
      proxyPort: "",
      proxyUsername: "",
      proxyPassword: "",
    };
  }

  if (source.type === "WEB" && "web" in source && source.web) {
    return {
      category: "STREAM",
      platform: "BBC",
      intentType: "crawl",
      intentArgsText: stringifyIntentArgs({ url: source.web.url ?? [] }),
      poolEnabled: true,
      poolIdleTimeoutMs: 120000,
      headless: false,
      stateFile: "",
      filterMinChars: 8,
      proxyHost: "",
      proxyPort: "",
      proxyUsername: "",
      proxyPassword: "",
    };
  }

  if (source.type === "DARKNET" && "darknet" in source && source.darknet) {
    return {
      category: "RETRIEVAL",
      platform: "DARKWEBGO",
      intentType: "search",
      intentArgsText: stringifyIntentArgs({ url: source.darknet.url ?? [] }),
      poolEnabled: true,
      poolIdleTimeoutMs: 120000,
      headless: false,
      stateFile: "",
      filterMinChars: 8,
      proxyHost: "",
      proxyPort: "",
      proxyUsername: "",
      proxyPassword: "",
    };
  }

  return {
    category: "INTERACTIVE",
    platform: "",
    intentType: "search",
    intentArgsText: "{}",
    poolEnabled: true,
    poolIdleTimeoutMs: 120000,
    headless: false,
    stateFile: ".auth/x_auth.json",
    filterMinChars: 8,
    proxyHost: "",
    proxyPort: "",
    proxyUsername: "",
    proxyPassword: "",
  };
}

function buildPayloadFromUnified(input: {
  effectiveType: SourceType;
  values: SourceFormValues;
  platform: string;
  intentType: string;
  intentArgsText: string;
  driverConfig: DriverConfigInput;
}) {
  const { effectiveType, values, platform, intentType, intentArgsText, driverConfig } = input;
  const intentArgs = parseArgsText(intentArgsText);
  const driver = buildDriverConfig({ intentType, intentArgsText, config: driverConfig });

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
  const [intentArgsText, setIntentArgsText] = useState(initialScriptState.intentArgsText);
  const [poolEnabled, setPoolEnabled] = useState(initialScriptState.poolEnabled);
  const [poolIdleTimeoutMs, setPoolIdleTimeoutMs] = useState(initialScriptState.poolIdleTimeoutMs);
  const [headless, setHeadless] = useState(initialScriptState.headless);
  const [stateFile, setStateFile] = useState(initialScriptState.stateFile);
  const [filterMinChars, setFilterMinChars] = useState(initialScriptState.filterMinChars);
  const [proxyHost, setProxyHost] = useState(initialScriptState.proxyHost);
  const [proxyPort, setProxyPort] = useState(initialScriptState.proxyPort);
  const [proxyUsername, setProxyUsername] = useState(initialScriptState.proxyUsername);
  const [proxyPassword, setProxyPassword] = useState(initialScriptState.proxyPassword);
  const [platformPopoverOpen, setPlatformPopoverOpen] = useState(false);
  const [platformSearch, setPlatformSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    setSelectedPlatform(initialScriptState.platform);
    setSelectedIntentType(initialScriptState.intentType);
    setIntentArgsText(initialScriptState.intentArgsText);
    setPoolEnabled(initialScriptState.poolEnabled);
    setPoolIdleTimeoutMs(initialScriptState.poolIdleTimeoutMs);
    setHeadless(initialScriptState.headless);
    setStateFile(initialScriptState.stateFile);
    setFilterMinChars(initialScriptState.filterMinChars);
    setProxyHost(initialScriptState.proxyHost);
    setProxyPort(initialScriptState.proxyPort);
    setProxyUsername(initialScriptState.proxyUsername);
    setProxyPassword(initialScriptState.proxyPassword);
  }, [open, initialScriptState]);

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

  const intentArgsParseError = useMemo(() => {
    const raw = intentArgsText.trim();
    if (!raw) return null;
    try {
      JSON.parse(raw);
      return null;
    } catch {
      return "Intent args must be valid JSON to generate request preview.";
    }
  }, [intentArgsText]);

  const sourceApiPreview = useMemo(() => {
    if (intentArgsParseError) return null;
    const built = buildPayloadFromUnified({
      effectiveType,
      values: watchedValues,
      platform: selectedPlatform,
      intentType: selectedIntentType,
      intentArgsText,
      driverConfig: {
        poolEnabled,
        poolIdleTimeoutMs,
        headless,
        stateFile,
        filterMinChars,
        proxyHost,
        proxyPort,
        proxyUsername,
        proxyPassword,
      },
    });
    if ("error" in built) return { error: built.error } as const;
    return built.payload;
  }, [
    effectiveType,
    watchedValues,
    selectedPlatform,
    selectedIntentType,
    intentArgsText,
    poolEnabled,
    poolIdleTimeoutMs,
    headless,
    stateFile,
    filterMinChars,
    proxyHost,
    proxyPort,
    proxyUsername,
    proxyPassword,
    intentArgsParseError,
  ]);

  const sourceApiPreviewError =
    sourceApiPreview && "error" in sourceApiPreview ? sourceApiPreview.error : null;
  const sourceApiPreviewPending =
    !!sourceApiPreviewError && /\brequires?\b|\brequired\b/i.test(sourceApiPreviewError);

  const gatherRequestPreview = useMemo(() => {
    if (effectiveType !== "SOCIAL_MEDIA") return null;
    const normalizedPlatform = normalizePlatform(selectedPlatform);
    if (!normalizedPlatform || intentArgsParseError) return null;
    return {
      sourceId: currentSource?.id ?? "__SOURCE_ID__",
      platform: normalizedPlatform.toLowerCase(),
      keywords: [],
      driver: buildDriverConfig({
        intentType: selectedIntentType,
        intentArgsText,
        config: {
          poolEnabled,
          poolIdleTimeoutMs,
          headless,
          stateFile,
          filterMinChars,
          proxyHost,
          proxyPort,
          proxyUsername,
          proxyPassword,
        },
      }),
    };
  }, [
    effectiveType,
    selectedPlatform,
    intentArgsParseError,
    currentSource?.id,
    selectedIntentType,
    intentArgsText,
    poolEnabled,
    poolIdleTimeoutMs,
    headless,
    stateFile,
    filterMinChars,
    proxyHost,
    proxyPort,
    proxyUsername,
    proxyPassword,
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

    try {
      JSON.parse(intentArgsText || "{}");
    } catch {
      toast.error("Intent args must be valid JSON.");
      return;
    }

    const built = buildPayloadFromUnified({
      effectiveType,
      values,
      platform: selectedPlatform,
      intentType: selectedIntentType,
      intentArgsText,
      driverConfig: {
        poolEnabled,
        poolIdleTimeoutMs,
        headless,
        stateFile,
        filterMinChars,
        proxyHost,
        proxyPort,
        proxyUsername,
        proxyPassword,
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
      <div className="grid gap-4">
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
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
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
                          <span className="mr-2">{platform}</span>
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
              Configure driver runtime, script args, and proxy settings.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label>Script Type</Label>
                <ControlledSelect
                  value={selectedIntentType || null}
                  onValueChange={(value) => setSelectedIntentType(value ?? "search")}
                  placeholder="Select intent"
                >
                  {intentOptions.map((intent) => (
                    <SelectItem key={intent} value={intent}>
                      {intent}
                    </SelectItem>
                  ))}
                </ControlledSelect>
              </div>

              <div className="grid gap-2">
                <Label>Pool Enabled</Label>
                <ControlledSelect
                  value={poolEnabled ? "true" : "false"}
                  onValueChange={(value) => setPoolEnabled(value === "true")}
                >
                  <SelectItem value="true">true</SelectItem>
                  <SelectItem value="false">false</SelectItem>
                </ControlledSelect>
              </div>

              <div className="grid gap-2">
                <Label>Headless</Label>
                <ControlledSelect
                  value={headless ? "true" : "false"}
                  onValueChange={(value) => setHeadless(value === "true")}
                >
                  <SelectItem value="true">true</SelectItem>
                  <SelectItem value="false">false</SelectItem>
                </ControlledSelect>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Pool Idle Timeout (ms)</Label>
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
              <div className="grid gap-2">
                <Label>State File</Label>
                <Input
                  value={stateFile}
                  onChange={(event) => setStateFile(event.target.value)}
                  placeholder=".auth/x_auth.json"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="intent-args">Script Args (JSON)</Label>
              <Textarea
                id="intent-args"
                rows={8}
                value={intentArgsText}
                onChange={(event) => setIntentArgsText(event.target.value)}
                placeholder='{"query": "..."}'
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label>Filter Min Chars</Label>
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
                <Label>Active</Label>
                <ControlledSelect
                  value={form.watch("active") ? "true" : "false"}
                  onValueChange={(value) => form.setValue("active", value === "true")}
                >
                  <SelectItem value="true">true</SelectItem>
                  <SelectItem value="false">false</SelectItem>
                </ControlledSelect>
              </div>

              <div className="grid gap-2">
                <Label>Rate Limit</Label>
                <Input
                  type="number"
                  min={1}
                  max={600}
                  value={form.watch("rateLimit") ?? 10}
                  onChange={(event) =>
                    form.setValue("rateLimit", Number(event.target.value || 10))
                  }
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Proxy Host</Label>
                <Input
                  value={proxyHost}
                  onChange={(event) => setProxyHost(event.target.value)}
                  placeholder="proxy.example.com"
                />
              </div>
              <div className="grid gap-2">
                <Label>Proxy Port</Label>
                <Input
                  value={proxyPort}
                  onChange={(event) => setProxyPort(event.target.value)}
                  placeholder="8080"
                />
              </div>
              <div className="grid gap-2">
                <Label>Proxy Username</Label>
                <Input
                  value={proxyUsername}
                  onChange={(event) => setProxyUsername(event.target.value)}
                  placeholder="proxyuser"
                />
              </div>
              <div className="grid gap-2">
                <Label>Proxy Password</Label>
                <Input
                  type="password"
                  value={proxyPassword}
                  onChange={(event) => setProxyPassword(event.target.value)}
                  placeholder="password"
                />
              </div>
            </div>
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
              {intentArgsParseError ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  {intentArgsParseError}
                </div>
              ) : sourceApiPreviewError ? (
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
