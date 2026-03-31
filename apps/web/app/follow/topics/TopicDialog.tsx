"use client";

import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { SettingEditDialog } from "@/components/layout";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ControlledSelect } from "@/components/ui/controlled-select";
import { SelectItem } from "@/components/ui/select";
import { MultiSelect } from "@/components/common/multi-select";
import { ErrorMessage } from "@/components/business";
import { useTopicMutation } from "@/hooks/useTopicMutation";
import { SourceWithRelations, TopicWithAggregations } from "@/lib/types";

type TopicFormValues = {
  name: string;
  description: string;
  enabled: boolean;
  frequency: "MANUAL" | "HOURLY" | "DAILY" | "WEEKLY" | "MONTHLY" | "CRONTAB";
  cronSchedule: string;
  coreTerms: string;
  expansionTerms: string;
  exclusionTerms: string;
  sourceIds: string[];
};

const TERM_SPLIT_RE = /[,\n\r，、;；\t]+/g;

function parseTerms(input: string): string[] {
  return Array.from(
    new Set(
      String(input || "")
        .split(TERM_SPLIT_RE)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

function termsByType(topic: TopicWithAggregations | undefined, type: "CORE" | "EXPANSION" | "EXCLUSION"): string {
  if (!topic?.terms?.length) return "";
  return topic.terms
    .filter((term) => term.type === type)
    .map((term) => term.value)
    .join("\n");
}

interface Props {
  topic?: TopicWithAggregations;
  sources: SourceWithRelations[];
  triggerButton?: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TopicDialog = ({ topic, sources, triggerButton, open, onOpenChange }: Props) => {
  const isUpdate = !!topic;

  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    formState: { errors },
  } = useForm<TopicFormValues>({
    defaultValues: {
      name: topic?.name || "",
      description: topic?.description || "",
      enabled: topic?.enabled ?? true,
      frequency: topic?.frequency || "MANUAL",
      cronSchedule: topic?.cronSchedule || "",
      coreTerms: termsByType(topic, "CORE"),
      expansionTerms: termsByType(topic, "EXPANSION"),
      exclusionTerms: termsByType(topic, "EXCLUSION"),
      sourceIds: (topic?.sources ?? []).map((item) => item.sourceId),
    },
  });

  useEffect(() => {
    if (!open) return;
    reset({
      name: topic?.name || "",
      description: topic?.description || "",
      enabled: topic?.enabled ?? true,
      frequency: topic?.frequency || "MANUAL",
      cronSchedule: topic?.cronSchedule || "",
      coreTerms: termsByType(topic, "CORE"),
      expansionTerms: termsByType(topic, "EXPANSION"),
      exclusionTerms: termsByType(topic, "EXCLUSION"),
      sourceIds: (topic?.sources ?? []).map((item) => item.sourceId),
    });
  }, [open, reset, topic]);

  const mutation = useTopicMutation({
    topicId: topic?.id,
    onSuccess: () => onOpenChange(false),
  });

  const frequency = watch("frequency");

  const retrievalSources = sources.filter(
    (source) => source.category === "RETRIEVAL" && !source.isDarknet
  );
  const sourceOptions = retrievalSources.map((source) => ({
    label: source.name,
    value: source.id,
  }));

  const onSubmit = (values: TopicFormValues) => {
    const coreTerms = parseTerms(values.coreTerms);
    const expansionTerms = parseTerms(values.expansionTerms);
    const exclusionTerms = parseTerms(values.exclusionTerms);

    mutation.mutate({
      name: values.name,
      description: values.description || null,
      enabled: values.enabled,
      frequency: values.frequency,
      cronSchedule: values.frequency === "CRONTAB" ? values.cronSchedule || null : null,
      sourceIds: values.sourceIds,
      terms: [
        ...coreTerms.map((value) => ({ type: "CORE", value, weight: 1 })),
        ...expansionTerms.map((value) => ({ type: "EXPANSION", value, weight: 1 })),
        ...exclusionTerms.map((value) => ({ type: "EXCLUSION", value, weight: 1 })),
      ],
    });
  };

  return (
    <SettingEditDialog
      props={{ open, onOpenChange }}
      title={isUpdate ? "Edit Topic" : "Add Topic"}
      description={isUpdate ? "Edit this topic." : "Create a topic with core/expansion/exclusion terms."}
      triggerButton={triggerButton}
      buttonText={mutation.isPending ? (isUpdate ? "Updating..." : "Adding...") : isUpdate ? "Update" : "Add"}
      onSubmit={handleSubmit(onSubmit)}
    >
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" placeholder="Topic name" {...register("name", { required: "Name is required" })} />
          <ErrorMessage>{errors.name?.message}</ErrorMessage>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="description">Description</Label>
          <Textarea id="description" rows={3} placeholder="Topic description" {...register("description")} />
          <ErrorMessage>{errors.description?.message}</ErrorMessage>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="sourceIds">Retrieval Sources</Label>
          <Controller
            name="sourceIds"
            control={control}
            render={({ field }) => (
              <MultiSelect
                options={sourceOptions}
                value={field.value || []}
                onValueChange={field.onChange}
                placeholder="Select retrieval sources"
              />
            )}
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="frequency">Frequency</Label>
            <Controller
              name="frequency"
              control={control}
              render={({ field }) => (
                <ControlledSelect
                  value={field.value}
                  onValueChange={(value) => field.onChange(value ?? "MANUAL")}
                  placeholder="Select frequency"
                >
                  <SelectItem value="MANUAL">MANUAL</SelectItem>
                  <SelectItem value="HOURLY">HOURLY</SelectItem>
                  <SelectItem value="DAILY">DAILY</SelectItem>
                  <SelectItem value="WEEKLY">WEEKLY</SelectItem>
                  <SelectItem value="MONTHLY">MONTHLY</SelectItem>
                  <SelectItem value="CRONTAB">CRONTAB</SelectItem>
                </ControlledSelect>
              )}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="enabled">Enabled</Label>
            <Controller
              name="enabled"
              control={control}
              render={({ field }) => (
                <div className="flex h-9 items-center rounded-md border px-3">
                  <Switch checked={field.value} onCheckedChange={field.onChange} id="enabled" />
                </div>
              )}
            />
          </div>
        </div>

        {frequency === "CRONTAB" ? (
          <div className="grid gap-2">
            <Label htmlFor="cronSchedule">Cron Schedule</Label>
            <Input id="cronSchedule" placeholder="0 */2 * * *" {...register("cronSchedule")} />
          </div>
        ) : null}

        <div className="grid gap-2">
          <Label htmlFor="coreTerms">Core Terms</Label>
          <Textarea id="coreTerms" rows={3} placeholder="One term per line" {...register("coreTerms")} />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="expansionTerms">Expansion Terms</Label>
          <Textarea id="expansionTerms" rows={4} placeholder="One term per line" {...register("expansionTerms")} />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="exclusionTerms">Exclusion Terms</Label>
          <Textarea id="exclusionTerms" rows={3} placeholder="One term per line" {...register("exclusionTerms")} />
        </div>
      </div>
    </SettingEditDialog>
  );
};

export default TopicDialog;
