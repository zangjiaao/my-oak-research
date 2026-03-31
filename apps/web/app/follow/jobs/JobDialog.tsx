"use client";

import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { SettingEditDialog } from "@/components/layout";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ControlledSelect } from "@/components/ui/controlled-select";
import { SelectItem } from "@/components/ui/select";
import { MultiSelect } from "@/components/common/multi-select";
import { ErrorMessage } from "@/components/business";
import { useJobMutation } from "@/hooks/useJobMutation";
import { JobWithAggregations, SourceWithRelations, TopicWithAggregations } from "@/lib/types";

type JobFormValues = {
  name: string;
  type: "TOPIC_RETRIEVAL" | "SOURCE_INGEST" | "SOURCE_ONESHOT";
  enabled: boolean;
  frequency: "MANUAL" | "HOURLY" | "DAILY" | "WEEKLY" | "MONTHLY" | "CRONTAB";
  cronSchedule: string;
  topicIds: string[];
  sourceIds: string[];
};

interface Props {
  job?: JobWithAggregations;
  topics: TopicWithAggregations[];
  sources: SourceWithRelations[];
  triggerButton?: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const JobDialog = ({ job, topics, sources, triggerButton, open, onOpenChange }: Props) => {
  const isUpdate = !!job;

  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<JobFormValues>({
    defaultValues: {
      name: job?.name || "",
      type: job?.type || "TOPIC_RETRIEVAL",
      enabled: job?.enabled ?? true,
      frequency: job?.frequency || "MANUAL",
      cronSchedule: job?.cronSchedule || "",
      topicIds: (job?.jobTopics ?? []).map((item) => item.topicId),
      sourceIds: (job?.jobSources ?? []).map((item) => item.sourceId),
    },
  });

  useEffect(() => {
    if (!open) return;
    reset({
      name: job?.name || "",
      type: job?.type || "TOPIC_RETRIEVAL",
      enabled: job?.enabled ?? true,
      frequency: job?.frequency || "MANUAL",
      cronSchedule: job?.cronSchedule || "",
      topicIds: (job?.jobTopics ?? []).map((item) => item.topicId),
      sourceIds: (job?.jobSources ?? []).map((item) => item.sourceId),
    });
  }, [open, reset, job]);

  const mutation = useJobMutation({
    jobId: job?.id,
    onSuccess: () => onOpenChange(false),
  });

  const type = watch("type");
  const frequency = watch("frequency");

  const topicOptions = topics.map((topic) => ({ label: topic.name, value: topic.id }));
  const sourceOptions = sources.map((source) => ({ label: source.name, value: source.id }));

  const onSubmit = (values: JobFormValues) => {
    clearErrors();

    if (values.type === "TOPIC_RETRIEVAL" && values.topicIds.length === 0) {
      setError("topicIds", { type: "manual", message: "At least one topic is required." });
      return;
    }
    if (values.sourceIds.length === 0) {
      setError("sourceIds", { type: "manual", message: "At least one source is required." });
      return;
    }

    mutation.mutate({
      name: values.name,
      type: values.type,
      enabled: values.enabled,
      frequency: values.frequency,
      cronSchedule: values.frequency === "CRONTAB" ? values.cronSchedule || null : null,
      topicIds: values.type === "TOPIC_RETRIEVAL" ? values.topicIds : [],
      sourceBindings: values.sourceIds.map((sourceId) => ({ sourceId })),
    });
  };

  return (
    <SettingEditDialog
      props={{ open, onOpenChange }}
      title={isUpdate ? "Edit Job" : "Add Job"}
      description={isUpdate ? "Edit this job." : "Create a job to orchestrate topic/source runs."}
      triggerButton={triggerButton}
      buttonText={mutation.isPending ? (isUpdate ? "Updating..." : "Adding...") : isUpdate ? "Update" : "Add"}
      onSubmit={handleSubmit(onSubmit)}
    >
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" placeholder="Job name" {...register("name", { required: "Name is required" })} />
          <ErrorMessage>{errors.name?.message}</ErrorMessage>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="type">Type</Label>
            <Controller
              name="type"
              control={control}
              render={({ field }) => (
                <ControlledSelect
                  value={field.value}
                  onValueChange={(value) => field.onChange(value ?? "TOPIC_RETRIEVAL")}
                  placeholder="Select job type"
                >
                  <SelectItem value="TOPIC_RETRIEVAL">TOPIC_RETRIEVAL</SelectItem>
                  <SelectItem value="SOURCE_INGEST">SOURCE_INGEST</SelectItem>
                  <SelectItem value="SOURCE_ONESHOT">SOURCE_ONESHOT</SelectItem>
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
          {frequency === "CRONTAB" ? (
            <div className="grid gap-2">
              <Label htmlFor="cronSchedule">Cron Schedule</Label>
              <Input id="cronSchedule" placeholder="0 */2 * * *" {...register("cronSchedule")} />
            </div>
          ) : null}
        </div>

        {type === "TOPIC_RETRIEVAL" ? (
          <div className="grid gap-2">
            <Label htmlFor="topicIds">Topics</Label>
            <Controller
              name="topicIds"
              control={control}
              render={({ field }) => (
                <MultiSelect
                  options={topicOptions}
                  value={field.value || []}
                  onValueChange={field.onChange}
                  placeholder="Select topics"
                />
              )}
            />
            <ErrorMessage>{errors.topicIds?.message}</ErrorMessage>
          </div>
        ) : null}

        <div className="grid gap-2">
          <Label htmlFor="sourceIds">Sources</Label>
          <Controller
            name="sourceIds"
            control={control}
            render={({ field }) => (
              <MultiSelect
                options={sourceOptions}
                value={field.value || []}
                onValueChange={field.onChange}
                placeholder="Select sources"
              />
            )}
          />
          <ErrorMessage>{errors.sourceIds?.message}</ErrorMessage>
        </div>
      </div>
    </SettingEditDialog>
  );
};

export default JobDialog;
