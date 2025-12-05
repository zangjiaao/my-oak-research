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

type QueryFormValues = z.output<typeof QueryCreateSchema>;

interface Props {
  query?: Query & {
    keywords?: Keyword[];
    sources?: Source[];
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
    setError,
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
      rules: query?.rules ? JSON.stringify(query.rules, null, 2) : undefined,
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
        rules: query?.rules ? JSON.stringify(query.rules, null, 2) : undefined,
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
        rules: undefined,
      });
    }
  }, [open, isUpdate, query, reset]);

  const mutation = useQueryMutation({
    queryId: query?.id,
    onSuccess: () => {
      onOpenChange(false);
    },
  });

  const onSubmit: SubmitHandler<QueryFormValues> = (data) => {
    let parsedRules: QueryFormValues["rules"] = undefined;
    if (data.rules) {
      if (typeof data.rules === "string") {
        try {
          parsedRules = JSON.parse(data.rules);
        } catch (err) {
          setError("rules", {
            type: "manual",
            message: "Rules must be valid JSON.",
          });
          return;
        }
      } else {
        parsedRules = data.rules;
      }
    }
    const submittedData = {
      ...data,
      rules: parsedRules,
      // keywords and sources should be connect operations, not just IDs
      // Backend API expects keywordIds and sourceIds for connect, so no change needed here.
    };
    mutation.mutate(submittedData);
  };

  const availableKeywords = keywords.map((k) => ({
    label: k.name,
    value: k.id,
  }));
  const availableSources = sources.map((s) => ({ label: s.name, value: s.id }));

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

        <div className="grid gap-3">
          <Label htmlFor="rules">Rules (JSON)</Label>
          <Textarea
            id="rules"
            placeholder={'{"key":"value"}'}
            rows={5}
            {...register("rules")}
          />
          <ErrorMessage>{errors.rules?.message?.toString()}</ErrorMessage>
        </div>
      </div>
    </SettingEditDialog>
  );
};

export default QueryDialog;
