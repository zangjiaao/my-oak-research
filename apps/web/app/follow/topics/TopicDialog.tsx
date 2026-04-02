"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { SettingEditDialog } from "@/components/layout";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ErrorMessage } from "@/components/business";
import { useTopicMutation } from "@/hooks/useTopicMutation";
import { TopicWithAggregations } from "@/lib/types";
import { MultiSelect } from "@/components/common/multi-select";

type TopicFormValues = {
  name: string;
  description: string;
  recallLanguages: ("zh" | "en" | "ja")[];
  coreTerms: string;
  expansionTerms: string;
  exclusionTerms: string;
};

const recallLanguageOptions = [
  { label: "中文 (zh)", value: "zh" },
  { label: "English (en)", value: "en" },
  { label: "日本語 (ja)", value: "ja" },
];

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
  triggerButton?: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TopicDialog = ({ topic, triggerButton, open, onOpenChange }: Props) => {
  const isUpdate = !!topic;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<TopicFormValues>({
    defaultValues: {
      name: topic?.name || "",
      description: topic?.description || "",
      recallLanguages: topic?.recallLanguages ?? ["zh", "en", "ja"],
      coreTerms: termsByType(topic, "CORE"),
      expansionTerms: termsByType(topic, "EXPANSION"),
      exclusionTerms: termsByType(topic, "EXCLUSION"),
    },
  });

  useEffect(() => {
    if (!open) return;
    reset({
      name: topic?.name || "",
      description: topic?.description || "",
      recallLanguages: topic?.recallLanguages ?? ["zh", "en", "ja"],
      coreTerms: termsByType(topic, "CORE"),
      expansionTerms: termsByType(topic, "EXPANSION"),
      exclusionTerms: termsByType(topic, "EXCLUSION"),
    });
  }, [open, reset, topic]);

  const mutation = useTopicMutation({
    topicId: topic?.id,
    onSuccess: () => onOpenChange(false),
  });

  const onSubmit = (values: TopicFormValues) => {
    const coreTerms = parseTerms(values.coreTerms);
    const expansionTerms = parseTerms(values.expansionTerms);
    const exclusionTerms = parseTerms(values.exclusionTerms);

    mutation.mutate({
      name: values.name,
      description: values.description || null,
      recallLanguages: values.recallLanguages,
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
          <Label>Recall Languages</Label>
          <MultiSelect
            options={recallLanguageOptions}
            value={watch("recallLanguages")}
            onValueChange={(next) =>
              setValue(
                "recallLanguages",
                next.filter(
                  (item): item is "zh" | "en" | "ja" =>
                    item === "zh" || item === "en" || item === "ja"
                )
              )
            }
            placeholder="Select recall languages"
          />
        </div>

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
