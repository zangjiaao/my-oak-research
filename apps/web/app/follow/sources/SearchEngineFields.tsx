import {
  Control,
  UseFormRegister,
  FieldErrors,
  UseFormWatch,
  UseFormSetValue,
} from "react-hook-form";
import { z } from "zod";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorMessage } from "@/components/business";
import SelectProxy from "./SelectProxy";
import { Proxy } from "@/app/generated/prisma";
import {
  SourceCreateSchema,
  SearchEngineKindEnum,
  SearchEngineSourceCreateSchema,
} from "@/app/api/_utils/zod";
import { Controller } from "react-hook-form";
import { ControlledSelect } from "@/components/ui/controlled-select";
import { SelectItem } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

interface SearchEngineFieldsProps {
  register: UseFormRegister<z.infer<typeof SourceCreateSchema>>;
  control: Control<z.infer<typeof SourceCreateSchema>>;
  errors: FieldErrors<z.infer<typeof SourceCreateSchema>>;
  proxies: Proxy[];
  watch: UseFormWatch<z.infer<typeof SourceCreateSchema>>;
  setValue: UseFormSetValue<z.infer<typeof SourceCreateSchema>>;
}

const SEARCH_PROVIDER_PRESETS = [
  {
    id: "parallel-ai",
    label: "Parallel.ai",
    apiEndpoint: "https://api.parallel.ai/v1beta/search",
    options: {
      provider: "parallel",
      mode: "one-shot",
      max_results: 10,
    },
  },
  {
    id: "tavily",
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
  {
    id: "anspire",
    label: "Anspire",
    apiEndpoint: "https://plugin.anspire.cn/api/ntsearch/search",
    options: {
      provider: "anspire",
      top_k: "10",
    },
  },
] as const;

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
  proxies,
  watch,
  setValue,
}: SearchEngineFieldsProps) => {
  const searchEngineKind = watch("search.engine") as
    | z.infer<typeof SearchEngineKindEnum>
    | undefined;
  const rawOptions = watch("search.options");
  const currentApiEndpoint = watch("search.apiEndpoint");
  const searchErrors = errors as FieldErrors<
    z.infer<typeof SearchEngineSourceCreateSchema>
  >;

  const applyPreset = (presetId: (typeof SEARCH_PROVIDER_PRESETS)[number]["id"]) => {
    const preset = SEARCH_PROVIDER_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    const currentOptions = parseOptions(rawOptions);
    const mergedOptions = {
      ...preset.options,
      ...(currentOptions.apiKey ? { apiKey: currentOptions.apiKey } : {}),
    };
    setValue("search.engine", "CUSTOM", {
      shouldDirty: true,
      shouldValidate: true,
    });
    setValue("search.apiEndpoint", preset.apiEndpoint, {
      shouldDirty: true,
      shouldValidate: true,
    });
    setValue("search.options", JSON.stringify(mergedOptions, null, 2) as any, {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  const currentPreset = SEARCH_PROVIDER_PRESETS.find(
    (preset) =>
      typeof currentApiEndpoint === "string" &&
      currentApiEndpoint.includes(new URL(preset.apiEndpoint).host)
  );

  return (
    <>
      <div className="grid gap-3">
        <Label>AI Search Presets</Label>
        <div className="flex flex-wrap gap-2">
          {SEARCH_PROVIDER_PRESETS.map((preset) => (
            <Button
              key={preset.id}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => applyPreset(preset.id)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {currentPreset
            ? `Current preset: ${currentPreset.label}`
            : "No preset selected"}
          . API keys can come from `search.options.apiKey` or env vars
          (`PARALLEL_API_KEY`, `TAVILY_API_KEY`, `ANSPIRE_API_KEY`).
        </p>
      </div>
      <div className="grid gap-3">
        <Label htmlFor="search.engine">Engine</Label>
        <Controller
          name="search.engine"
          control={control}
          render={({ field }) => (
            <ControlledSelect
              value={field.value as string}
              onValueChange={field.onChange}
              placeholder="Select an engine"
            >
              {Object.values(SearchEngineKindEnum.enum).map((engine) => (
                <SelectItem key={engine} value={engine}>
                  {engine}
                </SelectItem>
              ))}
            </ControlledSelect>
          )}
        />
        <ErrorMessage>
          {searchErrors.search?.engine?.message?.toString()}
        </ErrorMessage>
      </div>
      {searchEngineKind === "CUSTOM" && (
        <div className="grid gap-3">
          <Label htmlFor="search.customConfig">
            Custom Engine Config (JSON)
          </Label>
          <Textarea
            id="search.customConfig"
            placeholder={'{ "key": "value" }'}
            rows={5}
            {...register("search.customConfig")}
          />
          <ErrorMessage>
            {searchErrors.search?.customConfig?.message?.toString()}
          </ErrorMessage>
        </div>
      )}
      <div className="grid gap-3">
        <Label htmlFor="search.query">Query</Label>
        <Input
          id="search.query"
          placeholder="Query"
          {...register("search.query")}
        />
        <ErrorMessage>
          {searchErrors.search?.query?.message?.toString()}
        </ErrorMessage>
      </div>
      <div className="grid gap-3">
        <Label htmlFor="search.region">Region</Label>
        <Input
          id="search.region"
          placeholder="Region"
          {...register("search.region")}
        />
        <ErrorMessage>
          {searchErrors.search?.region?.message?.toString()}
        </ErrorMessage>
      </div>
      <div className="grid gap-3">
        <Label htmlFor="search.lang">Lang</Label>
        <Input
          id="search.lang"
          placeholder="Lang"
          {...register("search.lang")}
        />
        <ErrorMessage>
          {searchErrors.search?.lang?.message?.toString()}
        </ErrorMessage>
      </div>
      <div className="grid gap-3">
        <Label htmlFor="search.apiEndpoint">API Endpoint</Label>
        <Input
          id="search.apiEndpoint"
          placeholder="API Endpoint"
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
          rows={5}
          {...register("search.options")}
        />
        <ErrorMessage>
          {searchErrors.search?.options?.message?.toString()}
        </ErrorMessage>
      </div>
      <SelectProxy
        control={control}
        proxies={proxies}
        name="search.proxyId"
        error={searchErrors.proxyId?.message?.toString()}
      />
    </>
  );
};
