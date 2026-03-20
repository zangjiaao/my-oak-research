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
      search_depth: "basic",
      max_results: 10,
      include_answer: false,
      include_raw_content: false,
    },
  },
  ANSPIRE: {
    label: "Anspire",
    apiEndpoint: "https://plugin.anspire.cn/api/ntsearch/search",
    options: {
      provider: "anspire",
      top_k: "10",
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
              API key 可通过 `search.options.apiKey` 或环境变量提供
              (`PARALLEL_API_KEY` / `TAVILY_API_KEY` / `ANSPIRE_API_KEY`)。
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="gap-4 bg-muted/30">
        <CardHeader>
          <CardTitle>Config</CardTitle>
          <CardDescription>
            填写检索词和平台参数，Worker 会按 platform 路由请求。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
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
            <Label htmlFor="search.apiEndpoint">API Endpoint</Label>
            <Input
              id="search.apiEndpoint"
              placeholder="https://..."
              {...register("search.apiEndpoint")}
            />
            <ErrorMessage>
              {searchErrors.search?.apiEndpoint?.message?.toString()}
            </ErrorMessage>
          </div>

          <div className="grid gap-3">
            <Label htmlFor="search.options">Options (JSON)</Label>
            <Textarea
              id="search.options"
              placeholder="{}"
              rows={6}
              {...register("search.options")}
            />
            <ErrorMessage>{searchErrors.search?.options?.message?.toString()}</ErrorMessage>
          </div>

          {currentPlatform === "PARALLEL" && (
            <div className="grid gap-4 rounded-lg border bg-background p-4">
              <p className="text-sm font-medium">Parallel Request Mapping</p>
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
            </div>
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
