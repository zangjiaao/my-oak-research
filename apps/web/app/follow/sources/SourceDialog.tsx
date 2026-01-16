"use client";

import { useState, useEffect, useMemo } from "react";
import { Controller, useForm } from "react-hook-form";
import type {
  Control,
  FieldErrors,
  Resolver,
  UseFormRegister,
  UseFormWatch,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  SourceCreateSchema,
  SourceUpdateSchema,
  WebSourceCreateSchema,
  DarknetSourceCreateSchema,
  SearchEngineSourceCreateSchema,
  SocialMediaSourceCreateSchema,
  CrawlerEngineEnum,
} from "@/app/api/_utils/zod";
import { SettingEditDialog } from "@/components/layout";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ControlledSelect } from "@/components/ui/controlled-select";
import { SelectItem } from "@/components/ui/select";
import { ErrorMessage } from "@/components/business";
import type { Proxy } from "@/app/generated/prisma";
import { SourceType } from "@/app/generated/prisma";
import {
  SourceWithRelations,
  WebSource,
  DarknetSource,
  SocialMediaSource,
  SearchEngineSource,
} from "@/lib/types";
import { Textarea } from "@/components/ui/textarea";
import SelectProxy from "./SelectProxy";
import { useSourceMutation } from "@/hooks/useSourceMutation";
import { SocialMediaFields } from "./SocialMediaFields";
import { DarknetFields } from "./DarknetFields";
import { SearchEngineFields } from "./SearchEngineFields";

type SourceFormValues = z.infer<typeof SourceCreateSchema>;
type WebFormValues = Extract<SourceFormValues, { type: "WEB" }>;
type DarknetFormValues = Extract<SourceFormValues, { type: "DARKNET" }>;
type SocialFormValues = Extract<SourceFormValues, { type: "SOCIAL_MEDIA" }>;
type SearchFormValues = Extract<SourceFormValues, { type: "SEARCH_ENGINE" }>;

const isWebSource = (
  source: SourceWithRelations | undefined
): source is WebSource => source?.type === "WEB";

const isDarknetSource = (
  source: SourceWithRelations | undefined
): source is DarknetSource => source?.type === "DARKNET";

const isSocialSource = (
  source: SourceWithRelations | undefined
): source is SocialMediaSource => source?.type === "SOCIAL_MEDIA";

const isSearchSource = (
  source: SourceWithRelations | undefined
): source is SearchEngineSource => source?.type === "SEARCH_ENGINE";

const SUPPORTED_LANGS = ["zh", "en", "ja", "auto"] as const;

// Helper to get schema based on type
const getValidationSchema = (type: SourceType, isUpdate: boolean) => {
  if (isUpdate) return SourceUpdateSchema;

  switch (type) {
    case "WEB":
      return WebSourceCreateSchema;
    case "DARKNET":
      return DarknetSourceCreateSchema;
    case "SEARCH_ENGINE":
      return SearchEngineSourceCreateSchema;
    case "SOCIAL_MEDIA":
      return SocialMediaSourceCreateSchema;
    default:
      return SourceCreateSchema;
  }
};

// Helper to get default values
const getDefaultValues = (
  source?: SourceWithRelations,
  sourceType?: SourceType
): SourceFormValues => {
  const effectiveType: SourceType = source?.type || sourceType || "WEB";

  const base = {
    name: source?.name ?? "",
    description: source?.description ?? "",
    type: effectiveType,
    active: source?.active ?? true,
    rateLimit: source?.rateLimit ?? 10,
    proxyId: source?.proxyId ?? null,
    credentialId: source?.credentialId ?? null,
  };

  switch (effectiveType) {
    case "WEB": {
      const webRelation = isWebSource(source) ? source.web : undefined;
      const webConfig: WebFormValues["web"] = {
        url: (Array.isArray(webRelation?.url)
          ? webRelation.url.join("\n")
          : (webRelation?.url ?? "")) as any,
        crawlerEngine: webRelation?.crawlerEngine ?? "FETCH",
        render: webRelation?.render ?? false,
        robotsRespect: webRelation?.robotsRespect ?? true,
        headers:
          (webRelation?.headers as Record<string, string> | null | undefined) ??
          undefined,
        crawlerConfig:
          (webRelation as unknown as { crawlerConfig?: unknown })
            ?.crawlerConfig ?? undefined,
        parseRules:
          (
            webRelation as unknown as {
              parseRules?: Record<string, unknown> | null;
            }
          )?.parseRules ?? undefined,
        proxyId: webRelation?.proxyId ?? null,
      };
      return {
        ...base,
        type: "WEB",
        web: webConfig,
      } as SourceFormValues;
    }
    case "DARKNET": {
      const darknetRelation = isDarknetSource(source)
        ? source.darknet
        : undefined;
      const darknetConfig: DarknetFormValues["darknet"] = {
        url: (Array.isArray(darknetRelation?.url)
          ? darknetRelation.url.join("\n")
          : (darknetRelation?.url ?? "")) as any,
        headers:
          (darknetRelation?.headers as
            | Record<string, string>
            | null
            | undefined) ?? undefined,
        crawlerEngine: darknetRelation?.crawlerEngine ?? "FETCH",
        crawlerConfig:
          (darknetRelation as unknown as { crawlerConfig?: unknown })
            ?.crawlerConfig ?? undefined,
        proxyId: darknetRelation?.proxyId ?? "",
        render:
          typeof (darknetRelation as unknown as { render?: boolean })
            ?.render === "boolean"
            ? ((darknetRelation as unknown as { render?: boolean })?.render ??
              false)
            : false,
        parseRules:
          (
            darknetRelation as unknown as {
              parseRules?: Record<string, unknown> | null;
            }
          )?.parseRules ?? undefined,
      };
      return {
        ...base,
        type: "DARKNET",
        darknet: darknetConfig,
      } as SourceFormValues;
    }
    case "SOCIAL_MEDIA": {
      if (isSocialSource(source)) {
        return {
          ...base,
          type: "SOCIAL_MEDIA",
          social: source.social as unknown as SocialFormValues["social"],
        } as SourceFormValues;
      }
      const defaultSocial: SocialFormValues["social"] = {
        platform: "X",
        config: {} as {
          user?: string;
          listId?: string;
          query?: string;
        },
        credentialId: null,
        proxyId: null,
      };
      return {
        ...base,
        type: "SOCIAL_MEDIA",
        social: defaultSocial,
      } as SourceFormValues;
    }
    case "SEARCH_ENGINE": {
      const searchRelation = isSearchSource(source) ? source.search : undefined;
      const rawLang = searchRelation?.lang ?? "auto";
      const allowedLangs = SUPPORTED_LANGS;
      const langValue = allowedLangs.includes(
        rawLang as (typeof allowedLangs)[number]
      )
        ? (rawLang as SearchFormValues["search"]["lang"])
        : "auto";
      const searchConfig: SearchFormValues["search"] = {
        engine: searchRelation?.engine ?? "GOOGLE",
        query: searchRelation?.query ?? "",
        region: searchRelation?.region ?? null,
        lang: langValue,
        apiEndpoint: searchRelation?.apiEndpoint ?? null,
        options:
          (searchRelation?.options as
            | Record<string, unknown>
            | null
            | undefined) ?? undefined,
        credentialId: searchRelation?.credentialId ?? null,
        customConfig:
          (searchRelation as unknown as { customConfig?: unknown })
            ?.customConfig ?? undefined,
      };
      return {
        ...base,
        type: "SEARCH_ENGINE",
        search: searchConfig,
      } as SourceFormValues;
    }
    default:
      return {
        ...base,
        type: "WEB",
        web: {
          url: "",
          crawlerEngine: "FETCH",
          render: false,
          robotsRespect: true,
          headers: undefined,
          crawlerConfig: undefined,
          parseRules: undefined,
          proxyId: null,
        } as any,
      } as SourceFormValues;
  }
};

interface CommonFieldsProps {
  register: UseFormRegister<SourceFormValues>;
  errors: FieldErrors<SourceFormValues>;
}

const CommonFields = ({ register, errors }: CommonFieldsProps) => (
  <>
    <div className="grid gap-3">
      <Label htmlFor="name">Name</Label>
      <Input id="name" placeholder="Name" {...register("name")} />
      <ErrorMessage>{errors.name?.message?.toString()}</ErrorMessage>
    </div>
    <div className="grid gap-3">
      <Label htmlFor="description">Description</Label>
      <Textarea
        id="description"
        placeholder="Description"
        rows={3}
        {...register("description")}
      />
      <ErrorMessage>{errors.description?.message?.toString()}</ErrorMessage>
    </div>
  </>
);

interface WebFieldsProps {
  register: UseFormRegister<SourceFormValues>;
  control: Control<SourceFormValues>;
  errors: FieldErrors<SourceFormValues>;
  proxies: Proxy[];
  watch: UseFormWatch<SourceFormValues>;
  isUpdate: boolean;
}

const WebFields = ({
  register,
  control,
  errors,
  proxies,
  watch,
  isUpdate,
}: WebFieldsProps) => {
  const crawlerEngine = watch("web.crawlerEngine") as
    | z.infer<typeof CrawlerEngineEnum>
    | undefined;
  const webErrors = errors as FieldErrors<
    z.infer<typeof WebSourceCreateSchema>
  >;
  return (
    <>
      <div className="grid gap-3">
        <Label htmlFor="web.url">URL(s)</Label>
        <Textarea
          id="web.url"
          placeholder={"https://www.example.com\nhttps://another.com"}
          rows={5}
          {...register("web.url")}
        />
        <p className="text-xs text-muted-foreground">
          Enter one or more URLs, one per line.
        </p>
        <ErrorMessage>{webErrors.web?.url?.message?.toString()}</ErrorMessage>
      </div>
      <div className="grid gap-3">
        <Label htmlFor="web.crawlerEngine">Crawler Engine</Label>
        <Controller
          name="web.crawlerEngine"
          control={control}
          render={({ field }) => (
            <ControlledSelect
              value={field.value as string}
              onValueChange={field.onChange}
              placeholder="Select a crawler engine"
            >
              {Object.values(CrawlerEngineEnum.enum).map((engine) => (
                <SelectItem key={engine} value={engine}>
                  {engine}
                </SelectItem>
              ))}
            </ControlledSelect>
          )}
        />
        <ErrorMessage>
          {webErrors.web?.crawlerEngine?.message?.toString()}
        </ErrorMessage>
      </div>
      {crawlerEngine === "CUSTOM" && (
        <div className="grid gap-3">
          <Label htmlFor="web.crawlerConfig">
            Custom Crawler Config (JSON)
          </Label>
          <Textarea
            id="web.crawlerConfig"
            placeholder={'{ "key": "value" }'}
            rows={5}
            {...register("web.crawlerConfig")}
          />
          <ErrorMessage>
            {webErrors.web?.crawlerConfig?.message?.toString()}
          </ErrorMessage>
        </div>
      )}
      <SelectProxy
        control={control}
        proxies={proxies}
        error={errors.proxyId?.message?.toString()}
      />
      {/* Add other WEB fields: headers, parseRules, crawlerEngine, etc. */}
    </>
  );
};

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
  const [currentSource, setCurrentSource] = useState<
    SourceWithRelations | undefined
  >(propSource);
  const [currentSourceType, setCurrentSourceType] = useState(propSourceType);

  useEffect(() => {
    if (open) {
      setCurrentSource(propSource);
      setCurrentSourceType(propSourceType);
    }
  }, [open, propSource, propSourceType]);

  const isUpdate = !!currentSource;
  const effectiveType: SourceType =
    currentSourceType || currentSource?.type || "WEB";

  const validationSchema = useMemo(
    () => getValidationSchema(effectiveType, isUpdate),
    [effectiveType, isUpdate]
  );

  const defaultValues = useMemo(
    () => getDefaultValues(currentSource, currentSourceType),
    [currentSource, currentSourceType]
  );

  const {
    control,
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
    reset,
  } = useForm<SourceFormValues>({
    resolver: zodResolver(validationSchema) as Resolver<SourceFormValues>,
    defaultValues,
  });

  useEffect(() => {
    if (open) {
      reset(defaultValues);
    }
  }, [open, defaultValues, reset]);

  const mutation = useSourceMutation({
    sourceId: currentSource?.id,
    sourceType: effectiveType,
    onSuccess: () => {
      onOpenChange(false);
      if (!isUpdate) {
        reset();
      }
    },
  });

  const onSubmit = (data: z.infer<typeof SourceCreateSchema>) =>
    mutation.mutate(data);

  return (
    <SettingEditDialog
      props={{ open, onOpenChange }}
      title={isUpdate ? "Edit Source" : "Add Source"}
      description={
        isUpdate
          ? "Edit this source."
          : `Add a new ${currentSourceType} source.`
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
      onSubmit={handleSubmit(onSubmit)}
    >
      <div className="grid gap-4">
        <CommonFields register={register} errors={errors} />
        {effectiveType === "WEB" && (
          <WebFields
            register={register}
            control={control}
            errors={errors}
            proxies={proxies}
            watch={watch}
            isUpdate={isUpdate}
          />
        )}
        {effectiveType === "DARKNET" && (
          <DarknetFields
            register={register}
            control={control}
            errors={errors}
            proxies={proxies}
            watch={watch}
          />
        )}
        {effectiveType === "SOCIAL_MEDIA" && (
          <SocialMediaFields
            register={register}
            control={control}
            errors={errors}
            proxies={proxies}
            watch={watch}
            setValue={setValue}
          />
        )}
        {effectiveType === "SEARCH_ENGINE" && (
          <SearchEngineFields
            register={register}
            control={control}
            errors={errors}
            proxies={proxies}
            watch={watch}
          />
        )}
        {/* Add other source type fields here */}
      </div>
    </SettingEditDialog>
  );
};

export default SourceDialog;
