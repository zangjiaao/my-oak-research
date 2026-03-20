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
      max_results: 10,
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
            <Label htmlFor="search.query">Query</Label>
            <Input id="search.query" placeholder="Query" {...register("search.query")} />
            <ErrorMessage>{searchErrors.search?.query?.message?.toString()}</ErrorMessage>
          </div>

          <div className="grid gap-3">
            <Label htmlFor="search.region">Region</Label>
            <Input
              id="search.region"
              placeholder="Region (optional)"
              {...register("search.region")}
            />
            <ErrorMessage>{searchErrors.search?.region?.message?.toString()}</ErrorMessage>
          </div>

          <div className="grid gap-3">
            <Label htmlFor="search.lang">Lang</Label>
            <Input id="search.lang" placeholder="auto" {...register("search.lang")} />
            <ErrorMessage>{searchErrors.search?.lang?.message?.toString()}</ErrorMessage>
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
