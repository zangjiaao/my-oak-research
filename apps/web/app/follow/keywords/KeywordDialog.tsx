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

import { Button } from "@/components/ui/button";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type KeywordWithCategory = Prisma.KeywordGetPayload<{
  include: { category: true };
}>;

const TERM_SPLIT_RE = /[,\n\r，、;；\t]+/;

function parseTerms(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(input ?? "")
    .split(TERM_SPLIT_RE)
    .map((item) => item.trim())
    .filter(Boolean);
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
          lang: values.lang,
        }),
      });

      if (!response.ok) throw new Error("Failed to derive keywords");

      const data = await response.json();
      const currentSynonyms = (
        Array.isArray(values.synonyms) ? values.synonyms : parseTerms(values.synonyms)
      ).map((s) => String(s).trim());

      const derivedKeywords = (data.keywords || []).map((s: string) =>
        String(s).trim()
      );

      const combined = Array.from(
        new Set([...currentSynonyms, ...derivedKeywords])
      );
      setValue("synonyms", combined.join("\n"));
      if (!enableAiExpand) {
        setValue("enableAiExpand", true);
      }
      toast.success(`Derived ${data.keywords.length} keywords`);
    } catch (error) {
      console.error(error);
      toast.error("Failed to derive keywords");
    } finally {
      setIsDeriving(false);
    }
  };

  const applyPreset = (preset: "recall" | "balanced" | "precision") => {
    if (preset === "recall") {
      setValue("includes", "openclaw\nmemory\nmem");
      setValue("synonyms", "记忆模块\n长期记忆\nmemory architecture");
      setValue("excludes", "");
      return;
    }
    if (preset === "balanced") {
      setValue("includes", "openclaw\nopenclaw memory");
      setValue("synonyms", "记忆模块\n记忆策略\nmemory architecture");
      setValue("excludes", "music\nsong");
      return;
    }
    setValue("includes", "openclaw");
    setValue("synonyms", "记忆模块\n长期记忆\ncontext memory\nmemory architecture");
    setValue("excludes", "song\nlyrics");
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
      <Card className="border-border/70 bg-muted/20">
        <CardContent className="space-y-3 px-4 py-3">
          <p className="text-sm font-medium">主题词配置建议</p>
          <p className="text-xs text-muted-foreground">
            先用召回词尽量找全内容，再用评分词判断内容是否真正贴近主题。
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => applyPreset("recall")}
            >
              偏召回
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => applyPreset("balanced")}
            >
              平衡
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => applyPreset("precision")}
            >
              偏精准
            </Button>
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-3">
        <Label htmlFor="keyword">Name</Label>
        <Input id="keyword" placeholder="Keyword Name" {...register("name")} />
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
          placeholder="Description"
          rows={3}
          {...register("description")}
        />
        <ErrorMessage>{errors.description?.message}</ErrorMessage>
      </div>
      <div className="grid gap-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="includes">Recall Terms（召回词）</Label>
          <Badge variant="outline">{recallTermsCount} terms</Badge>
        </div>
        <Textarea
          id="includes"
          placeholder="按行输入，例如: openclaw"
          rows={3}
          {...register("includes")}
        />
        <p className="text-xs text-muted-foreground">
          用于尽量多找内容（召回）。不会直接决定最终相关度高低。
        </p>
        <ErrorMessage>{errors.includes?.message}</ErrorMessage>
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
        <div className="grid gap-3">
          <Textarea
            id="synonyms"
            {...register("synonyms")}
            placeholder="按行输入评分词，例如: memory architecture"
            rows={5}
          />
          <p className="text-xs text-muted-foreground">
            可点击闪电按钮由 AI 衍生评分词。词越具体，评分越稳定。
            {!enableAiExpand ? "（当前不会自动扩展）" : ""}
          </p>
          <ErrorMessage>{errors.synonyms?.message}</ErrorMessage>
        </div>
      </div>
      <div className="grid gap-3">
        <Label htmlFor="excludes">Excludes(Optional)</Label>
        <Textarea
          id="excludes"
          placeholder="Excludes"
          rows={3}
          {...register("excludes")}
        />
        <ErrorMessage>{errors.excludes?.message}</ErrorMessage>
      </div>
    </SettingEditDialog>
  );
};

export default EditKeywordDialog;
