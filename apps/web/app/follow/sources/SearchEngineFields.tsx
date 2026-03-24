import { useMemo, useState } from "react";
import {
  Control,
  Controller,
  FieldErrors,
  UseFormRegister,
  UseFormSetValue,
  UseFormWatch,
} from "react-hook-form";
import { z } from "zod";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ErrorMessage } from "@/components/business";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  SearchPlatformEnum,
  SearchEngineSourceCreateSchema,
  SourceCreateSchema,
} from "@/app/api/_utils/zod";

interface SearchEngineFieldsProps {
  register: UseFormRegister<z.infer<typeof SourceCreateSchema>>;
  control: Control<z.infer<typeof SourceCreateSchema>>;
  errors: FieldErrors<z.infer<typeof SourceCreateSchema>>;
  watch: UseFormWatch<z.infer<typeof SourceCreateSchema>>;
  setValue: UseFormSetValue<z.infer<typeof SourceCreateSchema>>;
}

type SearchPlatform = z.infer<typeof SearchPlatformEnum>;

type PlatformPreset = {
  label: string;
  apiEndpoint: string;
  options: Record<string, unknown>;
};

const PLATFORM_PRESETS: Record<SearchPlatform, PlatformPreset> = {
  PARALLEL: {
    label: "Parallel.ai",
    apiEndpoint: "https://api.parallel.ai/v1beta/search",
    options: {
      provider: "parallel",
      mode: "one-shot",
      max_results: 20,
      search_queries: [],
      excerpts: {
        max_chars_per_result: 20000,
        max_chars_total: 200000,
      },
      source_policy: {
        include_domains: [],
        exclude_domains: [],
      },
      fetch_policy: {
        disable_cache_fallback: true,
        max_age_seconds: 172800,
        timeout_seconds: 120,
      },
    },
  },
  TAVILY: {
    label: "Tavily",
    apiEndpoint: "https://api.tavily.com/search",
    options: {
      provider: "tavily",
      topic: "general",
      search_depth: "basic",
      max_results: 10,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      include_image_descriptions: false,
      include_favicon: false,
      include_usage: false,
      include_domains: [],
      exclude_domains: [],
    },
  },
  ANSPIRE: {
    label: "Anspire",
    apiEndpoint: "https://plugin.anspire.cn/api/ntsearch/prosearch",
    options: {
      provider: "anspire",
      top_k: "10",
      Insite: "",
      FromTime: "",
      ToTime: "",
    },
  },
  CUSTOM: {
    label: "Custom",
    apiEndpoint: "",
    options: {
      provider: "custom",
    },
  },
};

function parseOptions(value: unknown): Record<string, unknown> {
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function toStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw
      .split(/[,\n\r，、;；\t]+/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function toNumberOr(
  value: unknown,
  fallback: number,
  min?: number
): number {
  const num =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  if (!Number.isFinite(num)) return fallback;
  if (typeof min === "number" && num < min) return fallback;
  return num;
}

function toBoolOr(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
}

export const SearchEngineFields = ({
  register,
  control,
  errors,
  watch,
  setValue,
}: SearchEngineFieldsProps) => {
  const [platformOpen, setPlatformOpen] = useState(false);
  const rawOptions = watch("search.options");
  const objectiveValue = watch("search.objective");
  const currentPlatform =
    (watch("search.platform") as SearchPlatform | undefined) ?? "PARALLEL";
  const optionsObject = useMemo(() => parseOptions(rawOptions), [rawOptions]);
  const parallelSearchQueries = useMemo(
    () => {
      const raw = optionsObject.search_queries ?? optionsObject.searchQueries;
      if (typeof raw === "string") {
        return raw;
      }
      return toStringArray(raw).join("\n");
    },
    [optionsObject]
  );
  const parallelMode = String(optionsObject.mode ?? "one-shot");
  const parallelMaxResults = String(
    toNumberOr(optionsObject.max_results, 20, 1)
  );
  const excerpts = asObject(optionsObject.excerpts);
  const parallelMaxCharsPerResult = String(
    toNumberOr(excerpts.max_chars_per_result, 20000, 1)
  );
  const parallelMaxCharsTotal = String(
    toNumberOr(excerpts.max_chars_total, 200000, 1)
  );
  const sourcePolicy = asObject(optionsObject.source_policy);
  const parallelAfterDate = String(sourcePolicy.after_date ?? "");
  const parallelIncludeDomains = (() => {
    const raw = sourcePolicy.include_domains;
    return typeof raw === "string" ? raw : toStringArray(raw).join("\n");
  })();
  const parallelExcludeDomains = (() => {
    const raw = sourcePolicy.exclude_domains;
    return typeof raw === "string" ? raw : toStringArray(raw).join("\n");
  })();
  const fetchPolicy = asObject(optionsObject.fetch_policy);
  const parallelDisableCacheFallback = toBoolOr(
    fetchPolicy.disable_cache_fallback,
    true
  );
  const parallelMaxAgeSeconds = String(
    toNumberOr(fetchPolicy.max_age_seconds, 172800, 1)
  );
  const parallelTimeoutSeconds = String(
    toNumberOr(fetchPolicy.timeout_seconds, 120, 1)
  );
  const tavilyTopic = String(optionsObject.topic ?? "general");
  const tavilySearchDepth = String(
    optionsObject.search_depth ?? optionsObject.searchDepth ?? "basic"
  );
  const tavilyMaxResults = String(
    toNumberOr(optionsObject.max_results ?? optionsObject.maxResults, 10, 1)
  );
  const tavilyTimeRange = String(
    optionsObject.time_range ?? optionsObject.timeRange ?? ""
  );
  const tavilyStartDate = String(
    optionsObject.start_date ?? optionsObject.startDate ?? ""
  );
  const tavilyEndDate = String(
    optionsObject.end_date ?? optionsObject.endDate ?? ""
  );
  const tavilyIncludeImages = toBoolOr(
    optionsObject.include_images ?? optionsObject.includeImages,
    false
  );
  const tavilyIncludeImageDescriptions = toBoolOr(
    optionsObject.include_image_descriptions ??
      optionsObject.includeImageDescriptions,
    false
  );
  const tavilyIncludeFavicon = toBoolOr(
    optionsObject.include_favicon ?? optionsObject.includeFavicon,
    false
  );
  const tavilyIncludeUsage = toBoolOr(
    optionsObject.include_usage ?? optionsObject.includeUsage,
    false
  );
  const tavilyIncludeRawContent = String(
    optionsObject.include_raw_content ?? optionsObject.includeRawContent ?? "false"
  );
  const tavilyChunksPerSource = String(
    toNumberOr(
      optionsObject.chunks_per_source ?? optionsObject.chunksPerSource,
      4,
      1
    )
  );
  const tavilyIncludeDomains = (() => {
    const raw = optionsObject.include_domains ?? optionsObject.includeDomains;
    return typeof raw === "string" ? raw : toStringArray(raw).join("\n");
  })();
  const tavilyExcludeDomains = (() => {
    const raw = optionsObject.exclude_domains ?? optionsObject.excludeDomains;
    return typeof raw === "string" ? raw : toStringArray(raw).join("\n");
  })();
  const anspireTopK = String(optionsObject.top_k ?? optionsObject.topK ?? "10");
  const anspireInsite = String(optionsObject.Insite ?? optionsObject.insite ?? "");
  const anspireFromTime = String(
    optionsObject.FromTime ?? optionsObject.from_time ?? ""
  );
  const anspireToTime = String(
    optionsObject.ToTime ?? optionsObject.to_time ?? ""
  );

  const searchErrors = errors as FieldErrors<
    z.infer<typeof SearchEngineSourceCreateSchema>
  >;

  const platformOptions = useMemo(
    () => SearchPlatformEnum.options,
    []
  );

  const applyPlatformPreset = (platform: SearchPlatform) => {
    const preset = PLATFORM_PRESETS[platform];
    if (!preset) return;

    const currentOptions = parseOptions(rawOptions);
    const nextOptions = {
      ...preset.options,
      ...(currentOptions.apiKey ? { apiKey: currentOptions.apiKey } : {}),
    };

    setValue("search.platform", platform, {
      shouldDirty: true,
      shouldValidate: true,
    });
    setValue("search.engine", "CUSTOM", {
      shouldDirty: true,
      shouldValidate: true,
    });
    setValue(
      "search.apiEndpoint",
      platform === "CUSTOM" ? null : preset.apiEndpoint,
      {
        shouldDirty: true,
        shouldValidate: true,
      }
    );
    setValue("search.options", JSON.stringify(nextOptions, null, 2) as any, {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  const updateOptions = (
    updater: (prev: Record<string, unknown>) => Record<string, unknown>
  ) => {
    const nextOptions = updater(optionsObject);
    setValue("search.options", JSON.stringify(nextOptions, null, 2) as any, {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  const parallelRequestPreview = useMemo(() => {
    if (currentPlatform !== "PARALLEL") return null;
    const payload: Record<string, unknown> = {
      mode: parallelMode || "one-shot",
      objective: objectiveValue || "",
      search_queries: toStringArray(parallelSearchQueries),
      max_results: toNumberOr(parallelMaxResults, 20, 1),
      excerpts: {
        max_chars_per_result: toNumberOr(parallelMaxCharsPerResult, 20000, 1),
        max_chars_total: toNumberOr(parallelMaxCharsTotal, 200000, 1),
      },
      source_policy: {
        ...(parallelAfterDate ? { after_date: parallelAfterDate } : {}),
        include_domains: toStringArray(parallelIncludeDomains),
        exclude_domains: toStringArray(parallelExcludeDomains),
      },
      fetch_policy: {
        disable_cache_fallback: parallelDisableCacheFallback,
        max_age_seconds: toNumberOr(parallelMaxAgeSeconds, 172800, 1),
        timeout_seconds: toNumberOr(parallelTimeoutSeconds, 120, 1),
      },
    };
    return payload;
  }, [
    currentPlatform,
    parallelAfterDate,
    parallelDisableCacheFallback,
    parallelExcludeDomains,
    parallelIncludeDomains,
    parallelMaxAgeSeconds,
    parallelMaxCharsPerResult,
    parallelMaxCharsTotal,
    parallelMaxResults,
    parallelMode,
    parallelSearchQueries,
    parallelTimeoutSeconds,
    objectiveValue,
  ]);
  const tavilyRequestPreview = useMemo(() => {
    if (currentPlatform !== "TAVILY") return null;
    const includeRawContent = tavilyIncludeRawContent.trim().toLowerCase();
    const normalizedIncludeRawContent =
      includeRawContent === "true"
        ? true
        : includeRawContent === "false" || !includeRawContent
          ? false
          : tavilyIncludeRawContent.trim();
    return {
      query: objectiveValue || "",
      topic: tavilyTopic || "general",
      search_depth: tavilySearchDepth || "basic",
      max_results: toNumberOr(tavilyMaxResults, 10, 1),
      ...(tavilyTimeRange ? { time_range: tavilyTimeRange } : {}),
      ...(tavilyStartDate ? { start_date: tavilyStartDate } : {}),
      ...(tavilyEndDate ? { end_date: tavilyEndDate } : {}),
      include_images: tavilyIncludeImages,
      include_image_descriptions: tavilyIncludeImageDescriptions,
      include_favicon: tavilyIncludeFavicon,
      include_usage: tavilyIncludeUsage,
      include_raw_content: normalizedIncludeRawContent,
      chunks_per_source: toNumberOr(tavilyChunksPerSource, 4, 1),
      include_domains: toStringArray(tavilyIncludeDomains),
      exclude_domains: toStringArray(tavilyExcludeDomains),
    };
  }, [
    currentPlatform,
    objectiveValue,
    tavilyChunksPerSource,
    tavilyEndDate,
    tavilyExcludeDomains,
    tavilyIncludeDomains,
    tavilyIncludeFavicon,
    tavilyIncludeImageDescriptions,
    tavilyIncludeImages,
    tavilyIncludeRawContent,
    tavilyIncludeUsage,
    tavilyMaxResults,
    tavilySearchDepth,
    tavilyStartDate,
    tavilyTimeRange,
    tavilyTopic,
  ]);
  const anspireRequestPreview = useMemo(() => {
    if (currentPlatform !== "ANSPIRE") return null;
    return {
      query: objectiveValue || "",
      top_k: anspireTopK || "10",
      ...(anspireInsite ? { Insite: anspireInsite } : {}),
      ...(anspireFromTime ? { FromTime: anspireFromTime } : {}),
      ...(anspireToTime ? { ToTime: anspireToTime } : {}),
    };
  }, [
    anspireFromTime,
    anspireInsite,
    anspireToTime,
    anspireTopK,
    currentPlatform,
    objectiveValue,
  ]);

  return (
    <>
      <Card className="gap-4 bg-muted/30">
        <CardHeader>
          <CardTitle>Platform</CardTitle>
          <CardDescription>
            选择 AI Search 平台，配置会按平台模板初始化。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3">
            <Controller
              name="search.platform"
              control={control}
              render={({ field }) => (
                <Popover open={platformOpen} onOpenChange={setPlatformOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={platformOpen}
                      className="w-full justify-between"
                    >
                      <span>
                        {PLATFORM_PRESETS[
                          (field.value as SearchPlatform | undefined) ??
                            "PARALLEL"
                        ]?.label ?? "Select search platform"}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                    <Command>
                      <CommandInput placeholder="Search platform..." />
                      <CommandEmpty>No platform found.</CommandEmpty>
                      <CommandList className="max-h-64 overflow-y-auto">
                        <CommandGroup>
                          {platformOptions.map((platform) => (
                            <CommandItem
                              key={platform}
                              value={platform}
                              onSelect={() => {
                                field.onChange(platform);
                                applyPlatformPreset(platform as SearchPlatform);
                                setPlatformOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  field.value === platform
                                    ? "opacity-100"
                                    : "opacity-0"
                                )}
                              />
                              <span>{PLATFORM_PRESETS[platform].label}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              )}
            />
            <ErrorMessage>
              {searchErrors.search?.platform?.message?.toString()}
            </ErrorMessage>
            <p className="text-xs text-muted-foreground">
              API key 建议通过 Credential 绑定或 `search.options.apiKey` 提供。
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="gap-4 bg-muted/30">
        <CardHeader>
          <CardTitle>Config</CardTitle>
          <CardDescription>
            填写平台配置，Worker 会按 platform 路由请求。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {currentPlatform === "PARALLEL" && (
            <div className="grid gap-4">
              <div className="grid gap-3">
                <Label htmlFor="search.objective">Objective</Label>
                <Textarea
                  id="search.objective"
                  placeholder="Find latest information about ..."
                  rows={3}
                  {...register("search.objective")}
                />
                <ErrorMessage>
                  {searchErrors.search?.objective?.message?.toString()}
                </ErrorMessage>
              </div>

              <div className="grid gap-3">
                <Label htmlFor="search.parallel.searchQueries">
                  Search Queries
                </Label>
                <Textarea
                  id="search.parallel.searchQueries"
                  rows={4}
                  placeholder={"Parallel Web Systems products\nParallel Web Systems announcements"}
                  value={parallelSearchQueries}
                  onChange={(event) => {
                    updateOptions((prev) => ({
                      ...prev,
                      search_queries: event.target.value,
                    }));
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  One query per line, maps to `search_queries`.
                </p>
              </div>

              <div className="grid gap-3">
                <Label htmlFor="search.parallel.mode">Mode</Label>
                <Input
                  id="search.parallel.mode"
                  placeholder="one-shot"
                  value={parallelMode}
                  onChange={(event) => {
                    const mode = event.target.value.trim() || "one-shot";
                    updateOptions((prev) => ({ ...prev, mode }));
                  }}
                />
              </div>

              <div className="grid gap-3">
                <Label htmlFor="search.parallel.maxResults">Max Results</Label>
                <Input
                  id="search.parallel.maxResults"
                  type="number"
                  min={1}
                  value={parallelMaxResults}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    updateOptions((prev) => ({
                      ...prev,
                      max_results: Number.isFinite(next) && next > 0 ? next : 20,
                    }));
                  }}
                />
              </div>

              <div className="grid gap-3">
                <Label htmlFor="search.parallel.maxCharsPerResult">
                  Max Chars Per Result
                </Label>
                <Input
                  id="search.parallel.maxCharsPerResult"
                  type="number"
                  min={1}
                  value={parallelMaxCharsPerResult}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    updateOptions((prev) => ({
                      ...prev,
                      excerpts: {
                        ...asObject(prev.excerpts),
                        max_chars_per_result:
                          Number.isFinite(next) && next > 0 ? next : 10000,
                      },
                    }));
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Maps to `excerpts.max_chars_per_result`.
                </p>
              </div>

              <div className="grid gap-3">
                <Label htmlFor="search.parallel.maxCharsTotal">
                  Max Chars Total
                </Label>
                <Input
                  id="search.parallel.maxCharsTotal"
                  type="number"
                  min={1}
                  value={parallelMaxCharsTotal}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    updateOptions((prev) => ({
                      ...prev,
                      excerpts: {
                        ...asObject(prev.excerpts),
                        max_chars_total:
                          Number.isFinite(next) && next > 0 ? next : 200000,
                      },
                    }));
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Maps to `excerpts.max_chars_total`.
                </p>
              </div>

              <div className="grid gap-3 rounded-md border p-3">
                <p className="text-sm font-medium">Source Policy</p>
                <div className="grid gap-3">
                  <Label htmlFor="search.parallel.afterDate">Published After</Label>
                  <Input
                    id="search.parallel.afterDate"
                    type="date"
                    value={parallelAfterDate}
                    onChange={(event) => {
                      const afterDate = event.target.value.trim();
                      updateOptions((prev) => ({
                        ...prev,
                        source_policy: afterDate
                          ? {
                              ...asObject(prev.source_policy),
                              after_date: afterDate,
                            }
                          : Object.fromEntries(
                              Object.entries(asObject(prev.source_policy)).filter(
                                ([key]) => key !== "after_date"
                              )
                            ),
                      }));
                    }}
                  />
                </div>
                <div className="grid gap-3">
                  <Label htmlFor="search.parallel.includeDomains">
                    Include Domains
                  </Label>
                  <Textarea
                    id="search.parallel.includeDomains"
                    rows={3}
                    placeholder={"google.com\nexample.com"}
                    value={parallelIncludeDomains}
                    onChange={(event) => {
                      updateOptions((prev) => ({
                        ...prev,
                        source_policy: {
                          ...asObject(prev.source_policy),
                          include_domains: event.target.value,
                        },
                      }));
                    }}
                  />
                </div>
                <div className="grid gap-3">
                  <Label htmlFor="search.parallel.excludeDomains">
                    Exclude Domains
                  </Label>
                  <Textarea
                    id="search.parallel.excludeDomains"
                    rows={3}
                    placeholder={"baidu.com"}
                    value={parallelExcludeDomains}
                    onChange={(event) => {
                      updateOptions((prev) => ({
                        ...prev,
                        source_policy: {
                          ...asObject(prev.source_policy),
                          exclude_domains: event.target.value,
                        },
                      }));
                    }}
                  />
                </div>
              </div>

              <div className="grid gap-3 rounded-md border p-3">
                <p className="text-sm font-medium">Fetch Policy</p>
                <div className="grid gap-3">
                  <Label htmlFor="search.parallel.disableCacheFallback">
                    Disable Cache Fallback
                  </Label>
                  <Switch
                    id="search.parallel.disableCacheFallback"
                    checked={parallelDisableCacheFallback}
                    onCheckedChange={(checked) => {
                      updateOptions((prev) => ({
                        ...prev,
                        fetch_policy: {
                          ...asObject(prev.fetch_policy),
                          disable_cache_fallback: checked,
                        },
                      }));
                    }}
                  />
                </div>
                <div className="grid gap-3">
                  <Label htmlFor="search.parallel.maxAgeSeconds">
                    Max Age Seconds
                  </Label>
                  <Input
                    id="search.parallel.maxAgeSeconds"
                    type="number"
                    min={1}
                    value={parallelMaxAgeSeconds}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      updateOptions((prev) => ({
                        ...prev,
                        fetch_policy: {
                          ...asObject(prev.fetch_policy),
                          max_age_seconds:
                            Number.isFinite(next) && next > 0 ? next : 172800,
                        },
                      }));
                    }}
                  />
                </div>
                <div className="grid gap-3">
                  <Label htmlFor="search.parallel.timeoutSeconds">
                    Timeout Seconds
                  </Label>
                  <Input
                    id="search.parallel.timeoutSeconds"
                    type="number"
                    min={1}
                    value={parallelTimeoutSeconds}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      updateOptions((prev) => ({
                        ...prev,
                        fetch_policy: {
                          ...asObject(prev.fetch_policy),
                          timeout_seconds:
                            Number.isFinite(next) && next > 0 ? next : 120,
                        },
                      }));
                    }}
                  />
                </div>
              </div>

              {parallelRequestPreview && (
                <div className="grid gap-3 rounded-lg border border-dashed bg-muted/20 p-4">
                  <p className="text-sm font-medium">Request Preview</p>
                  <pre className="max-h-72 overflow-auto rounded-md bg-background p-3 text-xs">
                    {JSON.stringify(parallelRequestPreview, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}

          {currentPlatform === "TAVILY" && (
            <div className="grid gap-4">
              <div className="grid gap-3">
                <Label htmlFor="search.objective">Query</Label>
                <Textarea
                  id="search.objective"
                  placeholder="openclaw"
                  rows={3}
                  {...register("search.objective")}
                />
                <ErrorMessage>
                  {searchErrors.search?.objective?.message?.toString()}
                </ErrorMessage>
              </div>

              <div className="grid gap-3">
                <Label htmlFor="search.tavily.topic">Topic</Label>
                <Input
                  id="search.tavily.topic"
                  placeholder="general"
                  value={tavilyTopic}
                  onChange={(event) => {
                    const topic = event.target.value.trim() || "general";
                    updateOptions((prev) => ({ ...prev, topic }));
                  }}
                />
              </div>

              <div className="grid gap-3">
                <Label htmlFor="search.tavily.searchDepth">Search Depth</Label>
                <Input
                  id="search.tavily.searchDepth"
                  placeholder="basic | advanced"
                  value={tavilySearchDepth}
                  onChange={(event) => {
                    const searchDepth = event.target.value.trim() || "basic";
                    updateOptions((prev) => ({
                      ...prev,
                      search_depth: searchDepth,
                    }));
                  }}
                />
              </div>

              <div className="grid gap-3">
                <Label htmlFor="search.tavily.maxResults">Max Results</Label>
                <Input
                  id="search.tavily.maxResults"
                  type="number"
                  min={1}
                  value={tavilyMaxResults}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    updateOptions((prev) => ({
                      ...prev,
                      max_results: Number.isFinite(next) && next > 0 ? next : 10,
                    }));
                  }}
                />
              </div>

              <div className="grid gap-3">
                <Label htmlFor="search.tavily.timeRange">Time Range</Label>
                <Input
                  id="search.tavily.timeRange"
                  placeholder="day | week | month | year"
                  value={tavilyTimeRange}
                  onChange={(event) => {
                    updateOptions((prev) => ({
                      ...prev,
                      time_range: event.target.value.trim(),
                    }));
                  }}
                />
              </div>

              <div className="grid gap-3">
                <Label htmlFor="search.tavily.startDate">Start Date</Label>
                <Input
                  id="search.tavily.startDate"
                  type="date"
                  value={tavilyStartDate}
                  onChange={(event) => {
                    updateOptions((prev) => ({
                      ...prev,
                      start_date: event.target.value.trim(),
                    }));
                  }}
                />
              </div>

              <div className="grid gap-3">
                <Label htmlFor="search.tavily.endDate">End Date</Label>
                <Input
                  id="search.tavily.endDate"
                  type="date"
                  value={tavilyEndDate}
                  onChange={(event) => {
                    updateOptions((prev) => ({
                      ...prev,
                      end_date: event.target.value.trim(),
                    }));
                  }}
                />
              </div>

              <div className="grid gap-3 rounded-md border p-3">
                <p className="text-sm font-medium">Include Options</p>
                <div className="grid gap-3">
                  <Label htmlFor="search.tavily.includeImages">
                    Include Images
                  </Label>
                  <Switch
                    id="search.tavily.includeImages"
                    checked={tavilyIncludeImages}
                    onCheckedChange={(checked) => {
                      updateOptions((prev) => ({
                        ...prev,
                        include_images: checked,
                      }));
                    }}
                  />
                </div>
                <div className="grid gap-3">
                  <Label htmlFor="search.tavily.includeImageDescriptions">
                    Include Image Descriptions
                  </Label>
                  <Switch
                    id="search.tavily.includeImageDescriptions"
                    checked={tavilyIncludeImageDescriptions}
                    onCheckedChange={(checked) => {
                      updateOptions((prev) => ({
                        ...prev,
                        include_image_descriptions: checked,
                      }));
                    }}
                  />
                </div>
                <div className="grid gap-3">
                  <Label htmlFor="search.tavily.includeFavicon">
                    Include Favicon
                  </Label>
                  <Switch
                    id="search.tavily.includeFavicon"
                    checked={tavilyIncludeFavicon}
                    onCheckedChange={(checked) => {
                      updateOptions((prev) => ({
                        ...prev,
                        include_favicon: checked,
                      }));
                    }}
                  />
                </div>
                <div className="grid gap-3">
                  <Label htmlFor="search.tavily.includeUsage">
                    Include Usage
                  </Label>
                  <Switch
                    id="search.tavily.includeUsage"
                    checked={tavilyIncludeUsage}
                    onCheckedChange={(checked) => {
                      updateOptions((prev) => ({
                        ...prev,
                        include_usage: checked,
                      }));
                    }}
                  />
                </div>
                <div className="grid gap-3">
                  <Label htmlFor="search.tavily.includeRawContent">
                    Include Raw Content
                  </Label>
                  <Input
                    id="search.tavily.includeRawContent"
                    placeholder='false | true | "text"'
                    value={tavilyIncludeRawContent}
                    onChange={(event) => {
                      updateOptions((prev) => ({
                        ...prev,
                        include_raw_content: event.target.value.trim(),
                      }));
                    }}
                  />
                </div>
                <div className="grid gap-3">
                  <Label htmlFor="search.tavily.chunksPerSource">
                    Chunks Per Source
                  </Label>
                  <Input
                    id="search.tavily.chunksPerSource"
                    type="number"
                    min={1}
                    value={tavilyChunksPerSource}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      updateOptions((prev) => ({
                        ...prev,
                        chunks_per_source:
                          Number.isFinite(next) && next > 0 ? next : 4,
                      }));
                    }}
                  />
                </div>
              </div>

              <div className="grid gap-3">
                <Label htmlFor="search.tavily.includeDomains">
                  Include Domains
                </Label>
                <Textarea
                  id="search.tavily.includeDomains"
                  rows={3}
                  placeholder={"baidu.com"}
                  value={tavilyIncludeDomains}
                  onChange={(event) => {
                    updateOptions((prev) => ({
                      ...prev,
                      include_domains: event.target.value,
                    }));
                  }}
                />
              </div>

              <div className="grid gap-3">
                <Label htmlFor="search.tavily.excludeDomains">
                  Exclude Domains
                </Label>
                <Textarea
                  id="search.tavily.excludeDomains"
                  rows={3}
                  placeholder={"google.com"}
                  value={tavilyExcludeDomains}
                  onChange={(event) => {
                    updateOptions((prev) => ({
                      ...prev,
                      exclude_domains: event.target.value,
                    }));
                  }}
                />
              </div>

              {tavilyRequestPreview && (
                <div className="grid gap-3 rounded-lg border border-dashed bg-muted/20 p-4">
                  <p className="text-sm font-medium">Request Preview</p>
                  <pre className="max-h-72 overflow-auto rounded-md bg-background p-3 text-xs">
                    {JSON.stringify(tavilyRequestPreview, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}

          {currentPlatform === "ANSPIRE" && (
            <div className="grid gap-4">
              <div className="grid gap-3">
                <Label htmlFor="search.objective">Query</Label>
                <Textarea
                  id="search.objective"
                  placeholder="你好"
                  rows={3}
                  {...register("search.objective")}
                />
                <ErrorMessage>
                  {searchErrors.search?.objective?.message?.toString()}
                </ErrorMessage>
              </div>

              <div className="grid gap-3">
                <Label htmlFor="search.anspire.topK">Top K</Label>
                <Input
                  id="search.anspire.topK"
                  placeholder="10"
                  value={anspireTopK}
                  onChange={(event) => {
                    const topK = event.target.value.trim() || "10";
                    updateOptions((prev) => ({
                      ...prev,
                      top_k: topK,
                    }));
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Eg: 10 / 20 / 30 / 40 / 50.
                </p>
              </div>

              <div className="grid gap-3">
                <Label htmlFor="search.anspire.insite">Insite</Label>
                <Textarea
                  id="search.anspire.insite"
                  rows={3}
                  placeholder="example.com,news.example.com"
                  value={anspireInsite}
                  onChange={(event) => {
                    updateOptions((prev) => ({
                      ...prev,
                      Insite: event.target.value.trim(),
                    }));
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Comma-separated domains, up to 20 sites.
                </p>
              </div>

              <div className="grid gap-3">
                <Label htmlFor="search.anspire.fromTime">From Time</Label>
                <Input
                  id="search.anspire.fromTime"
                  placeholder="2025-01-01 00:00:00"
                  value={anspireFromTime}
                  onChange={(event) => {
                    updateOptions((prev) => ({
                      ...prev,
                      FromTime: event.target.value.trim(),
                    }));
                  }}
                />
              </div>

              <div className="grid gap-3">
                <Label htmlFor="search.anspire.toTime">To Time</Label>
                <Input
                  id="search.anspire.toTime"
                  placeholder="2025-01-31 23:59:59"
                  value={anspireToTime}
                  onChange={(event) => {
                    updateOptions((prev) => ({
                      ...prev,
                      ToTime: event.target.value.trim(),
                    }));
                  }}
                />
              </div>

              {anspireRequestPreview && (
                <div className="grid gap-3 rounded-lg border border-dashed bg-muted/20 p-4">
                  <p className="text-sm font-medium">Request Preview</p>
                  <pre className="max-h-72 overflow-auto rounded-md bg-background p-3 text-xs">
                    {JSON.stringify(anspireRequestPreview, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}

          {currentPlatform !== "PARALLEL" &&
            currentPlatform !== "TAVILY" &&
            currentPlatform !== "ANSPIRE" && (
            <>
              <div className="grid gap-3">
                <Label htmlFor="search.objective">Objective</Label>
                <Textarea
                  id="search.objective"
                  placeholder="Find latest information about ..."
                  rows={3}
                  {...register("search.objective")}
                />
                <ErrorMessage>
                  {searchErrors.search?.objective?.message?.toString()}
                </ErrorMessage>
              </div>
              <p className="text-xs text-muted-foreground">
                Endpoint 与高级 options 使用平台默认配置（或服务端环境变量）。
              </p>
            </>
          )}

          {currentPlatform === "CUSTOM" && (
            <div className="grid gap-3">
              <Label htmlFor="search.customConfig">Custom Config (JSON)</Label>
              <Textarea
                id="search.customConfig"
                placeholder='{ "key": "value" }'
                rows={5}
                {...register("search.customConfig")}
              />
              <ErrorMessage>
                {searchErrors.search?.customConfig?.message?.toString()}
              </ErrorMessage>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
};
