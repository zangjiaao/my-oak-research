"use client";

import { Category, Prisma } from "@/app/generated/prisma";
import { SelectItem } from "@/components/ui/select";
import { ControlledSelect } from "@/components/ui/controlled-select";
import { Controller } from "react-hook-form";
import { Switch } from "@/components/ui/switch";
import { KeywordUpdateSchema, KeywordCreateSchema } from "@/app/api/_utils/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ErrorMessage } from "@/components/business";
import { SettingEditDialog } from "@/components/layout";
import { useKeywordMutation } from "@/hooks/useKeywordMutation";
import { MultiSelect } from "@/components/common/multi-select";

import { Button } from "@/components/ui/button";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type KeywordWithCategory = Prisma.KeywordGetPayload<{
  include: { category: true };
}>;
type DeriveMeta = {
  searchProvider?: string | null;
  degraded?: boolean;
  reason?: string | null;
  filteredByLanguageCount?: number;
  usedTopicTerms?: string[];
  topicHintMissing?: boolean;
  recallSoftLimit?: number;
  recallTermCount?: number;
  recallOverSoftLimit?: boolean;
  recallWarning?: string | null;
  scoringSoftLimit?: number;
  scoringTermCount?: number;
  scoringOverSoftLimit?: boolean;
  scoringWarning?: string | null;
  exclusionSoftLimit?: number;
  exclusionTermCount?: number;
  exclusionOverSoftLimit?: boolean;
  exclusionWarning?: string | null;
  termLanguageMatrix?: {
    includes?: Record<string, number>;
    synonyms?: Record<string, number>;
    excludes?: Record<string, number>;
  };
  translationBackfillMode?: string;
};

const TERM_SPLIT_RE = /[,\n\r，、;；\t]+/;
const DEFAULT_DERIVE_LANGUAGES = ["zh", "en"];
const LANGUAGE_OPTIONS = [
  { label: "Chinese (zh)", value: "zh" },
  { label: "English (en)", value: "en" },
  { label: "Japanese (ja)", value: "ja" },
  { label: "Arabic (ar)", value: "ar" },
  { label: "German (de)", value: "de" },
  { label: "French (fr)", value: "fr" },
  { label: "Spanish (es)", value: "es" },
  { label: "Russian (ru)", value: "ru" },
];

function parseTerms(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(input ?? "")
    .split(TERM_SPLIT_RE)
    .map((item) => item.trim())
    .filter(Boolean);
}

function mergeUniqueTerms(...inputs: Array<unknown>): string[] {
  return Array.from(new Set(inputs.flatMap((input) => parseTerms(input))));
}

function extractHashtagTopics(...inputs: Array<unknown>): string[] {
  const set = new Set<string>();
  const pattern = /(^|\s)#([a-zA-Z0-9][\w.-]{0,63})/g;
  for (const input of inputs) {
    const text = String(input ?? "");
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const token = match[2]?.trim().toLowerCase();
      if (token) set.add(token);
    }
  }
  return Array.from(set);
}

const EditKeywordDialog = ({
  keyword,
  categories,
  triggerButton,
}: {
  keyword?: KeywordWithCategory;
  categories: Category[];
  triggerButton: React.ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  const [isDeriving, setIsDeriving] = useState(false);
  const [deriveMeta, setDeriveMeta] = useState<DeriveMeta | null>(null);

  const mutation = useKeywordMutation({
    keywordId: keyword?.id,
    onSuccess: () => {
      setOpen(false);
      if (!keyword) {
        reset();
      }
    },
  });

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    getValues,
    formState: { errors },
    reset,
  } = useForm({
    resolver: zodResolver(keyword ? KeywordUpdateSchema : KeywordCreateSchema),
    defaultValues: {
      name: keyword?.name || "",
      categoryId: keyword?.category?.id || undefined,
      description: keyword?.description || "",
      includes: Array.isArray(keyword?.includes)
        ? keyword.includes.join("\n")
        : keyword?.includes || "",
      synonyms: Array.isArray(keyword?.synonyms)
        ? keyword.synonyms.join("\n")
        : keyword?.synonyms || "",
      excludes: Array.isArray(keyword?.excludes)
        ? keyword.excludes.join("\n")
        : keyword?.excludes || "",
      deriveLanguages:
        Array.isArray(keyword?.deriveLanguages) &&
        keyword.deriveLanguages.length > 0
          ? keyword.deriveLanguages
          : DEFAULT_DERIVE_LANGUAGES,
      enableAiExpand: keyword?.enableAiExpand || false,
      lang: (keyword?.lang as "auto" | "zh" | "en" | "ja") || "auto",
      active: keyword?.active ?? true,
    },
  });

  const enableAiExpand = watch("enableAiExpand");
  const includesText = watch("includes");
  const scoringTermsText = watch("synonyms");
  const recallTermsCount = parseTerms(includesText).length;
  const scoringTermsCount = parseTerms(scoringTermsText).length;
  const includesLanguageSummary = deriveMeta?.termLanguageMatrix?.includes
    ? Object.entries(deriveMeta.termLanguageMatrix.includes)
        .map(([language, count]) => `${language}:${count}`)
        .join(", ")
    : null;

  const onSubmit = async (
    data: z.infer<typeof KeywordUpdateSchema | typeof KeywordCreateSchema>
  ) => {
    mutation.mutate(data);
  };

  const handleClickDerive = async () => {
    const values = getValues();
    if (!values.name) {
      toast.error("Please enter a keyword name first");
      return;
    }
    const topicTerms = extractHashtagTopics(values.name, values.description);
    if (topicTerms.length === 0) {
      toast("建议在 Name/Description 中添加 #topic（例如 #openclaw）以提升检索质量");
    }
    setIsDeriving(true);
    try {
      const response = await fetch("/api/follow/keywords/derive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          description: values.description,
          includes: Array.isArray(values.includes)
            ? values.includes
            : String(values.includes)
              .split(/[,\n\r，、;；\t]+/)
              .filter(Boolean),
          synonyms: Array.isArray(values.synonyms)
            ? values.synonyms
            : parseTerms(values.synonyms),
          excludes: Array.isArray(values.excludes)
            ? values.excludes
            : parseTerms(values.excludes),
          languages: Array.isArray(values.deriveLanguages)
            ? values.deriveLanguages
            : DEFAULT_DERIVE_LANGUAGES,
          persistedLanguages: keyword?.deriveLanguages ?? DEFAULT_DERIVE_LANGUAGES,
          lang: values.lang,
        }),
      });

      if (!response.ok) throw new Error("Failed to derive keywords");

      const data = await response.json();
      setDeriveMeta(data.meta ?? null);
      const nextIncludes = mergeUniqueTerms(values.includes, data.includes ?? []);
      const nextSynonyms = mergeUniqueTerms(values.synonyms, data.synonyms ?? []);
      const nextExclusions = mergeUniqueTerms(values.excludes, data.excludes ?? []);
      const exclusionSet = new Set(nextExclusions);
      const sanitizedIncludes = nextIncludes.filter((item) => !exclusionSet.has(item));
      const sanitizedSynonyms = nextSynonyms.filter(
        (item) => !exclusionSet.has(item) && !sanitizedIncludes.includes(item)
      );
      setValue("includes", sanitizedIncludes.join("\n"));
      setValue("synonyms", sanitizedSynonyms.join("\n"));
      setValue("excludes", nextExclusions.join("\n"));
      if (!enableAiExpand) {
        setValue("enableAiExpand", true);
      }
      const warnings = [
        data.meta?.recallOverSoftLimit ? data.meta?.recallWarning : null,
        data.meta?.scoringOverSoftLimit ? data.meta?.scoringWarning : null,
        data.meta?.exclusionOverSoftLimit ? data.meta?.exclusionWarning : null,
      ].filter((item): item is string => Boolean(item));
      for (const warning of warnings) {
        toast.warning(warning);
      }
      toast.success(
        `Derived +${data.includes?.length ?? 0} recall, +${data.synonyms?.length ?? 0} scoring, +${data.excludes?.length ?? 0} exclusion terms`
      );
    } catch (error) {
      console.error(error);
      toast.error("Failed to derive keywords");
    } finally {
      setIsDeriving(false);
    }
  };

  return (
    <SettingEditDialog
      props={{ open, onOpenChange: setOpen }}
      buttonText={
        mutation.isPending
          ? keyword
            ? "Updating..."
            : "Adding..."
          : keyword
            ? "Update"
            : "Add"
      }
      title={keyword ? "Edit Keyword" : "Add Keyword"}
      description={
        keyword
          ? "Edit the keyword to your list."
          : "Add a new keyword to your list."
      }
      triggerButton={triggerButton}
      onSubmit={handleSubmit(onSubmit)}
    >
      <div className="grid gap-4">
        <Card className="gap-4 bg-muted/30">
          <CardHeader>
            <CardTitle>Basic Info</CardTitle>
            <CardDescription>Name, category and description.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3">
              <Label htmlFor="keyword">Name</Label>
              <Input
                id="keyword"
                placeholder="Keyword Name"
                className="bg-background"
                {...register("name")}
              />
              <ErrorMessage>{errors.name?.message}</ErrorMessage>
            </div>
            <div className="grid gap-3">
              <Label htmlFor="categoryId">Category</Label>
              <Controller
                name="categoryId"
                control={control}
                render={({ field }) => (
                  <ControlledSelect
                    value={field.value}
                    onValueChange={field.onChange}
                    placeholder="Select a category"
                    nullValue="none"
                  >
                    {categories.map((category: Category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </ControlledSelect>
                )}
              />
              <ErrorMessage>{errors.categoryId?.message}</ErrorMessage>
            </div>
            <div className="grid gap-3">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Description (you can mark topic anchors like #openclaw #qmd)"
                rows={3}
                className="bg-background"
                {...register("description")}
              />
              <p className="text-xs text-muted-foreground">
                Tip: add `#topic` tags to lock first-round web search anchors.
              </p>
              <ErrorMessage>{errors.description?.message}</ErrorMessage>
            </div>
          </CardContent>
        </Card>

        <Card className="gap-4 bg-muted/30">
          <CardHeader>
            <CardTitle>Generation</CardTitle>
            <CardDescription>Configure languages and AI expansion behavior.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3">
              <Label htmlFor="deriveLanguages">Generation Languages</Label>
              <Controller
                name="deriveLanguages"
                control={control}
                render={({ field }) => (
                  <MultiSelect
                    options={LANGUAGE_OPTIONS}
                    value={Array.isArray(field.value) ? field.value : DEFAULT_DERIVE_LANGUAGES}
                    onValueChange={(next) =>
                      field.onChange(next.length > 0 ? next : DEFAULT_DERIVE_LANGUAGES)
                    }
                    placeholder="Choose generation languages"
                  />
                )}
              />
              <p className="text-xs text-muted-foreground">
                Defaults to Chinese and English. Add more languages for multilingual term generation.
              </p>
              <ErrorMessage>{errors.deriveLanguages?.message}</ErrorMessage>
            </div>
          </CardContent>
        </Card>

        <Card className="gap-4 bg-muted/30">
          <CardHeader>
            <CardTitle>Term Config</CardTitle>
            <CardDescription>Manage recall, scoring, and exclusion terms.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="includes">Recall Terms（召回词）</Label>
                <Badge variant="outline">{recallTermsCount} terms</Badge>
              </div>
              <Textarea
                id="includes"
                placeholder="按行输入，例如: openclaw"
                rows={3}
                className="bg-background"
                {...register("includes")}
              />
              <p className="text-xs text-muted-foreground">
                用于尽量多找内容（召回）。不会直接决定最终相关度高低。
              </p>
              {deriveMeta?.recallOverSoftLimit ? (
                <p className="text-xs text-amber-600">
                  {deriveMeta.recallWarning ??
                    `召回词较多（${deriveMeta.recallTermCount ?? "?"}/${deriveMeta.recallSoftLimit ?? "?"}），后续检索成本可能上升。`}
                </p>
              ) : null}
              {deriveMeta?.scoringOverSoftLimit ? (
                <p className="text-xs text-amber-600">
                  {deriveMeta.scoringWarning ??
                    `评分词较多（${deriveMeta.scoringTermCount ?? "?"}/${deriveMeta.scoringSoftLimit ?? "?"}），评分稳定性可能下降。`}
                </p>
              ) : null}
              {deriveMeta?.exclusionOverSoftLimit ? (
                <p className="text-xs text-amber-600">
                  {deriveMeta.exclusionWarning ??
                    `排除词较多（${deriveMeta.exclusionTermCount ?? "?"}/${deriveMeta.exclusionSoftLimit ?? "?"}），请检查是否过度过滤。`}
                </p>
              ) : null}
              <ErrorMessage>{errors.includes?.message}</ErrorMessage>
            </div>

            <Card className="gap-3 border bg-background">
              <CardHeader className="pb-0">
                <div className="flex justify-between items-center group">
                  <div className="grid gap-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="synonyms" className="flex items-center gap-2">
                        Scoring Terms（评分词）
                      </Label>
                      <Badge variant="outline">{scoringTermsCount} terms</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 transition-opacity"
                        onClick={handleClickDerive}
                        disabled={isDeriving}
                      >
                        {isDeriving ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Sparkles className="h-4 w-4 text-amber-500" />
                        )}
                      </Button>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      用于相关性打分，建议填写“主题证据词”（如功能、机制、上下文）。
                    </p>
                    {deriveMeta ? (
                      <p className="text-xs text-muted-foreground">
                        {deriveMeta.degraded
                          ? `Derived in fallback mode (${deriveMeta.reason ?? "unknown"}).`
                          : `Calibrated by ${deriveMeta.searchProvider ?? "unknown provider"}.`}
                        {deriveMeta.filteredByLanguageCount
                          ? ` Filtered ${deriveMeta.filteredByLanguageCount} terms by language.`
                          : ""}
                        {Array.isArray(deriveMeta.usedTopicTerms) &&
                        deriveMeta.usedTopicTerms.length > 0
                          ? ` Topic terms: ${deriveMeta.usedTopicTerms
                              .map((term) => `#${term}`)
                              .join(", ")}.`
                          : ""}
                        {deriveMeta.topicHintMissing
                          ? " Add #topic anchors for better calibration."
                          : ""}
                        {includesLanguageSummary
                          ? ` Includes by language: ${includesLanguageSummary}.`
                          : ""}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Label
                      htmlFor="synonyms-switch"
                      className="text-xs font-normal text-muted-foreground"
                    >
                      AI 扩展
                    </Label>
                    <Controller
                      name="enableAiExpand"
                      control={control}
                      render={({ field }) => (
                        <Switch
                          id="synonyms-switch"
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      )}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3">
                <Textarea
                  id="synonyms"
                  {...register("synonyms")}
                  placeholder="按行输入评分词，例如: memory architecture"
                  rows={5}
                  className="bg-background"
                />
                <p className="text-xs text-muted-foreground">
                  可点击闪电按钮由 AI 衍生评分词。词越具体，评分越稳定。
                  {!enableAiExpand ? "（当前不会自动扩展）" : ""}
                </p>
                <ErrorMessage>{errors.synonyms?.message}</ErrorMessage>
              </CardContent>
            </Card>

            <div className="grid gap-3">
              <Label htmlFor="excludes">Exclusion Terms (Optional)</Label>
              <Textarea
                id="excludes"
                placeholder="Exclusion terms"
                rows={3}
                className="bg-background"
                {...register("excludes")}
              />
              <ErrorMessage>{errors.excludes?.message}</ErrorMessage>
            </div>
          </CardContent>
        </Card>
      </div>
    </SettingEditDialog>
  );
};

export default EditKeywordDialog;
