"use client";

import React, { useEffect, useMemo } from "react";
import { Controller, Resolver, SubmitHandler, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { QueryCreateSchema, QueryFrequencyEnum } from "@/app/api/_utils/zod";
import { SettingEditDialog } from "@/components/layout";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ControlledSelect } from "@/components/ui/controlled-select";
import { SelectItem } from "@/components/ui/select";
import { ErrorMessage } from "@/components/business";
import { Query, Keyword, Source } from "@/app/generated/prisma";
import { useQueryMutation } from "@/hooks/useQueryMutation";
import { MultiSelect } from "@/components/common/multi-select";
import {
  classifySourceCategory,
  detectDarknetTag,
  displayCategoryLabel,
} from "@/lib/source-taxonomy";

type QueryFormValues = z.output<typeof QueryCreateSchema>;

interface Props {
  query?: Query & {
    keywords?: Keyword[];
    sources?: Source[];
    sourcePolicies?: Array<{
      sourceId: string;
      contentFilterEnabled: boolean;
      contentFilterMode: "TERM_AND_WORD_BOUNDARY";
    }>;
  };
  keywords: Keyword[];
  sources: Source[];
  triggerButton?: React.ReactNode; // Make optional if dialog can be opened programmatically
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const QueryDialog = ({
  query,
  keywords,
  sources,
  triggerButton,
  open,
  onOpenChange,
}: Props) => {
  const isUpdate = !!query;

  const formResolver = useMemo<Resolver<QueryFormValues>>(
    () => zodResolver(QueryCreateSchema) as Resolver<QueryFormValues>,
    []
  );

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    setValue,
    formState: { errors },
  } = useForm<QueryFormValues>({
    resolver: formResolver,
    defaultValues: {
      name: query?.name || "",
      description: query?.description || "",
      frequency: query?.frequency || "MANUAL",
      cronSchedule: query?.cronSchedule || "",
      enabled: query?.enabled ?? true,
      // Make sure query.keywords and query.sources are always arrays before mapping
      keywordIds: query?.keywords?.map((k) => k.id) || [],
      sourceIds: query?.sources?.map((s) => s.id) || [],
      sourcePolicies: query?.sourcePolicies ?? [],
    },
  });

  useEffect(() => {
    if (!open) {
      // When dialog closes, reset form or clear editingQuery
      if (!isUpdate) {
        reset();
      }
    } else if (isUpdate) {
      // When dialog opens for update, set form values
      reset({
        name: query?.name || "",
        description: query?.description || "",
        frequency: query?.frequency || "MANUAL",
        cronSchedule: query?.cronSchedule || "",
        enabled: query?.enabled ?? true,
        keywordIds: query?.keywords?.map((k) => k.id) || [],
        sourceIds: query?.sources?.map((s) => s.id) || [],
        sourcePolicies: query?.sourcePolicies ?? [],
      });
    } else {
      // When dialog opens for create, reset to empty values
      reset({
        name: "",
        description: "",
        frequency: "MANUAL",
        cronSchedule: "",
        enabled: true,
        keywordIds: [],
        sourceIds: [],
        sourcePolicies: [],
      });
    }
  }, [open, isUpdate, query, reset]);

  const selectedSourceIds = watch("sourceIds");
  const sourcePolicies = watch("sourcePolicies");

  useEffect(() => {
    const selectedIds = selectedSourceIds ?? [];
    const policyMap = new Map((sourcePolicies ?? []).map((item) => [item.sourceId, item]));
    const normalizedPolicies = selectedIds.map((sourceId) => {
      const existingPolicy = policyMap.get(sourceId);
      if (existingPolicy) return existingPolicy;
      return {
        sourceId,
        contentFilterEnabled: true,
        contentFilterMode: "TERM_AND_WORD_BOUNDARY" as const,
      };
    });
    const hasDiff =
      normalizedPolicies.length !== (sourcePolicies ?? []).length ||
      normalizedPolicies.some((item, index) => {
        const current = sourcePolicies?.[index];
        return (
          !current ||
          current.sourceId !== item.sourceId ||
          current.contentFilterEnabled !== item.contentFilterEnabled ||
          current.contentFilterMode !== item.contentFilterMode
        );
      });
    if (hasDiff) {
      setValue("sourcePolicies", normalizedPolicies, {
        shouldDirty: false,
      });
    }
  }, [selectedSourceIds, setValue, sourcePolicies]);

  const mutation = useQueryMutation({
    queryId: query?.id,
    onSuccess: () => {
      onOpenChange(false);
    },
  });

  const onSubmit: SubmitHandler<QueryFormValues> = (data) => {
    mutation.mutate(data);
  };

  const availableKeywords = keywords.map((k) => ({
    label: k.name,
    value: k.id,
  }));
  const availableSources = sources.map((s) => {
    const category = classifySourceCategory({ category: s.category });
    const darknet = detectDarknetTag({
      category: s.category,
      isDarknet: s.isDarknet,
    });
    const prefix = `[${displayCategoryLabel(category)}${darknet ? "/Darknet" : ""}]`;
    return { label: `${prefix} ${s.name}`, value: s.id };
  });
  const sourceNameById = useMemo(
    () => new Map(sources.map((source) => [source.id, source.name] as const)),
    [sources]
  );

  return (
    <SettingEditDialog
      props={{ open, onOpenChange }}
      title={isUpdate ? "Edit Query" : "Add Query"}
      description={
        isUpdate ? "Edit this query." : "Add a new query to your list."
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
        <div className="grid gap-3">
          <Label htmlFor="name">Name</Label>
          <Input id="name" placeholder="Query Name" {...register("name")} />
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

        <div className="grid gap-3">
          <Label htmlFor="frequency">Frequency</Label>
          <Controller
            name="frequency"
            control={control}
            render={({ field }) => (
              <ControlledSelect
                value={field.value}
                onValueChange={field.onChange}
                placeholder="Select frequency"
              >
                {Object.values(QueryFrequencyEnum.enum).map((freq) => (
                  <SelectItem key={freq} value={freq}>
                    {freq}
                  </SelectItem>
                ))}
              </ControlledSelect>
            )}
          />
          <ErrorMessage>{errors.frequency?.message?.toString()}</ErrorMessage>
        </div>

        {watch("frequency") === "CRONTAB" && (
          <div className="grid gap-3">
            <Label htmlFor="cronSchedule">Cron Schedule</Label>
            <Input
              id="cronSchedule"
              placeholder="e.g., 0 0 * * * (daily at midnight)"
              {...register("cronSchedule")}
            />
            <ErrorMessage>
              {errors.cronSchedule?.message?.toString()}
            </ErrorMessage>
          </div>
        )}

        <div className="flex items-center justify-between">
          <Label htmlFor="enabled">Enabled</Label>
          <Controller
            name="enabled"
            control={control}
            render={({ field }) => (
              <Switch checked={field.value} onCheckedChange={field.onChange} />
            )}
          />
        </div>

        <div className="grid gap-3">
          <Label htmlFor="keywordIds">Keywords</Label>
          <Controller
            name="keywordIds"
            control={control}
            render={({ field }) => (
              <MultiSelect
                options={availableKeywords}
                value={field.value}
                onValueChange={field.onChange}
                placeholder="Select keywords..."
              />
            )}
          />
          <ErrorMessage>{errors.keywordIds?.message?.toString()}</ErrorMessage>
        </div>

        <div className="grid gap-3">
          <Label htmlFor="sourceIds">Sources</Label>
          <Controller
            name="sourceIds"
            control={control}
            render={({ field }) => (
              <MultiSelect
                options={availableSources}
                value={field.value}
                onValueChange={field.onChange}
                placeholder="Select sources..."
              />
            )}
          />
          <ErrorMessage>{errors.sourceIds?.message?.toString()}</ErrorMessage>
        </div>

        {(sourcePolicies ?? []).length > 0 && (
          <div className="grid gap-3 rounded-md border p-3">
            <Label>Source Content Filter</Label>
            <p className="text-xs text-muted-foreground">
              控制每个 Source 是否启用内容过滤。关闭后该 Source 只做采集，不做关键词内容过滤；开启后按过滤模式执行。
            </p>
            {(sourcePolicies ?? []).map((policy, index) => (
              <div
                key={policy.sourceId}
                className="grid gap-3 rounded-md border bg-background p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {sourceNameById.get(policy.sourceId) ?? policy.sourceId}
                  </span>
                  <Controller
                    name={`sourcePolicies.${index}.contentFilterEnabled`}
                    control={control}
                    render={({ field }) => (
                      <Switch
                        checked={Boolean(field.value)}
                        onCheckedChange={field.onChange}
                      />
                    )}
                  />
                </div>
                <Controller
                  name={`sourcePolicies.${index}.contentFilterMode`}
                  control={control}
                  render={({ field }) => (
                    <ControlledSelect
                      value={field.value}
                      onValueChange={field.onChange}
                      placeholder="Select filter mode"
                    >
                      <SelectItem value="TERM_AND_WORD_BOUNDARY">
                        TERM_AND_WORD_BOUNDARY
                      </SelectItem>
                    </ControlledSelect>
                  )}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </SettingEditDialog>
  );
};

export default QueryDialog;
