"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { NewsDetailCard } from "@/components/business";
import { useFollowContent } from "@/components/follow-content/context";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToggleFavorite, useFavorites } from "@/hooks/useFavorites";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

const FollowContent = () => {
  const { contents, selectedContent, selectContent, isLoading, error, filters } =
    useFollowContent();
  const toggleFavorite = useToggleFavorite();
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [noteContentId, setNoteContentId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [savingFeedback, setSavingFeedback] = useState(false);
  const detailRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // 获取所有收藏的内容 ID，用于判断是否已收藏
  const { data: favoritesData } = useFavorites({ limit: 50 });
  const favoriteIds = useMemo(
    () => new Set(favoritesData?.items.map((item) => item.id) ?? []),
    [favoritesData?.items]
  );

  const isBookmarked = (id: string) => favoriteIds.has(id);
  const selectedTopicId = filters.topicIds[0] ?? "";
  const selectedTopicIds = filters.topicIds;
  const hasTopicSelection = selectedTopicIds.length > 0;

  const buildExpandableKeywords = (content: (typeof contents)[number]) => {
    const keywords: Array<{
      category: "PERSON" | "ORG" | "TECH" | "LOCATION" | "PRODUCT" | "EVENT" | "CONCEPT";
      label: string;
      source?: "AI" | "RULE";
    }> = [];
    const classifyKeywordCategory = (
      label: string
    ): "PERSON" | "ORG" | "TECH" | "LOCATION" | "PRODUCT" | "EVENT" | "CONCEPT" => {
      if (/(大学|学院|学校|公司|集团|研究院|委员会|University|College|Inc|Ltd|Corp)/i.test(label)) {
        return "ORG";
      }
      if (/(教授|博士|先生|女士|主任|院长|老师|CEO|CTO)/i.test(label)) {
        return "PERSON";
      }
      if (/(省|市|区|县|州|国|省份|地区|城区|园区|China|USA|Europe|Asia)/i.test(label)) {
        return "LOCATION";
      }
      if (/(发布|大会|峰会|论坛|活动|赛事|会议|展会|发布会|summit|forum|conference|event)/i.test(label)) {
        return "EVENT";
      }
      if (/(OpenClaw|产品|工具|客户端|服务|App|SDK|API|plugin|extension)/i.test(label)) {
        return "PRODUCT";
      }
      if (/(AI|LLM|模型|系统|算法|框架|自动化|数据|向量|检索|embedding|rerank|RAG|workflow)/i.test(label)) {
        return "TECH";
      }
      return "CONCEPT";
    };
    const isEntityLikeTerm = (value: string) => {
      const normalized = value.trim();
      if (!normalized) return false;
      if (normalized.length > 40) return false;
      if (/^\d+(\.\d+)?$/.test(normalized)) return false;
      if (!/[\p{L}\p{Script=Han}]/u.test(normalized)) return false;
      if (/[:：]/.test(normalized)) return false;
      const lower = normalized.toLowerCase();
      if (["vector", "core", "expansion", "exclusion", "score"].includes(lower)) {
        return false;
      }
      return true;
    };
    const pushUnique = (
      category:
        | "PERSON"
        | "ORG"
        | "TECH"
        | "LOCATION"
        | "PRODUCT"
        | "EVENT"
        | "CONCEPT",
      value: string,
      source: "AI" | "RULE"
    ) => {
      const label = value.trim();
      if (!label) return;
      if (!isEntityLikeTerm(label)) return;
      if (keywords.some((item) => item.category === category && item.label === label)) return;
      keywords.push({ category, label, source });
    };
    const selectedScore = getSelectedTopicScore(content);
    for (const aiKeyword of selectedScore?.llmRerankKeywords ?? []) {
      pushUnique(aiKeyword.category, aiKeyword.label, "AI");
    }
    for (const person of content.entities?.persons ?? []) {
      pushUnique("PERSON", person, "RULE");
    }
    for (const org of content.entities?.orgs ?? []) {
      pushUnique("ORG", org, "RULE");
    }
    for (const location of content.entities?.locations ?? []) {
      pushUnique("LOCATION", location, "RULE");
    }
    if (keywords.filter((item) => item.source === "AI").length === 0 && keywords.length < 4) {
      const fallbackText = [content.detailView?.title, content.title, content.summary]
        .filter(Boolean)
        .join(" ");
      const fallbackTerms = Array.from(
        new Set(
          fallbackText
            .split(/[，。！？、；：,.!?;:/()（）\[\]\s\n\r\t"“”'‘’]+/)
            .map((term) => term.trim())
            .filter((term) => term.length >= 2 && term.length <= 24)
        )
      ).slice(0, 24);
      for (const term of fallbackTerms) {
        pushUnique(classifyKeywordCategory(term), term, "RULE");
      }
    }
    return keywords.slice(0, 8);
  };

  const getSelectedTopicScore = (content: (typeof contents)[number]) => {
    if (selectedTopicId) {
      const matched = (content.topicScores ?? []).find(
        (score) => score.topicId === selectedTopicId
      );
      return matched ?? null;
    }
    const candidates = content.topicScores ?? [];
    if (!candidates.length) {
      return null;
    }
    return candidates.reduce((best, current) => {
      const bestScore = best.finalScore ?? -1;
      const currentScore = current.finalScore ?? -1;
      return currentScore > bestScore ? current : best;
    });
  };

  const getRelevanceScore = (content: (typeof contents)[number]) => {
    const selectedScore = getSelectedTopicScore(content);
    if (selectedScore) {
      return selectedScore.finalScore ?? null;
    }
    const candidateScores = (content.topicScores ?? [])
      .filter((score) =>
        selectedTopicIds.length ? selectedTopicIds.includes(score.topicId) : true
      )
      .map((score) => score.finalScore ?? -1);
    const maxScore = Math.max(...candidateScores, -1);
    return maxScore >= 0 ? maxScore : null;
  };

  const submitFeedback = async (input: {
    contentId: string;
    vote?: "UP" | "DOWN" | "NONE";
    note?: string | null;
  }) => {
    if (!selectedTopicId) {
      toast.error("请先选择一个 Topic 再反馈");
      return;
    }
    setSavingFeedback(true);
    try {
      const response = await fetch("/api/follow/content-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentId: input.contentId,
          topicId: selectedTopicId,
          vote: input.vote ?? "NONE",
          note: input.note ?? null,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "反馈提交失败");
      }
      toast.success("反馈已保存");
      await queryClient.invalidateQueries({ queryKey: ["follow-content"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "反馈提交失败");
    } finally {
      setSavingFeedback(false);
    }
  };

  const addKeywordToTopic = async (keyword: {
    category: "PERSON" | "ORG" | "TECH" | "LOCATION" | "PRODUCT" | "EVENT" | "CONCEPT";
    label: string;
  }) => {
    if (!selectedTopicId) {
      toast.error("请先选择 Topic 再添加词");
      return;
    }
    try {
      const response = await fetch(`/api/follow/topics/${selectedTopicId}/terms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          value: keyword.label,
          type: "EXPANSION",
          weight: ["TECH", "PRODUCT"].includes(keyword.category) ? 1.2 : 1,
          meta: { source: "content-card", category: keyword.category },
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "添加关键词失败");
      }
      toast.success(`已添加关键词：${keyword.label}`);
      await queryClient.invalidateQueries({ queryKey: ["topics"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "添加关键词失败");
    }
  };

  const sortedContents = contents;

  useEffect(() => {
    if (!selectedContent?.id) {
      return;
    }
    const target = detailRefs.current[selectedContent.id];
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    return;
  }, [selectedContent?.id]);

  const handleDelete = async () => {
    if (!deleteTargetId || deleting) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/focus-bulletin/content/${deleteTargetId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Failed to delete content");
      }
      toast.success("内容已删除");
      setDeleteOpen(false);
      setDeleteTargetId(null);
      await queryClient.invalidateQueries({ queryKey: ["follow-content"] });
      await queryClient.invalidateQueries({ queryKey: ["favorites"] });
    } catch (e) {
      const message = e instanceof Error ? e.message : "删除失败";
      toast.error(message);
    } finally {
      setDeleting(false);
    }
  };

  if (error) {
    return (
      <div className="h-[calc(100vh-7rem)] flex items-center justify-center text-sm text-destructive">
        {error.message ?? "Cannot load content details"}
      </div>
    );
  }

  if (isLoading && !sortedContents.length) {
    return (
      <div className="h-[calc(100vh-7rem)] px-4 lg:px-0">
        <Card className="mx-auto h-full border-border/80 bg-card/95 shadow-sm">
          <CardHeader className="space-y-4 px-6 pt-6 pb-5 lg:px-8 lg:pt-7">
            <CardTitle className="mb-4">
              <div className="flex items-center gap-4">
                <Skeleton className="h-10 flex-1 bg-muted/60" />
                <Skeleton className="h-10 w-10 rounded-full bg-muted/60" />
              </div>
            </CardTitle>
            <div className="space-y-2">
              <Skeleton className="h-4 w-full bg-muted/60" />
              <Skeleton className="h-4 w-5/6 bg-muted/60" />
              <Skeleton className="h-4 w-2/3 bg-muted/60" />
            </div>
          </CardHeader>
          <CardContent className="px-6 py-5 lg:px-8">
            <div className="space-y-3">
              {Array.from({ length: 12 }).map((_, idx) => (
                <Skeleton
                  key={idx}
                  className={`h-4 bg-muted/60 ${
                    idx % 3 === 0 ? "w-full" : idx % 3 === 1 ? "w-5/6" : "w-2/3"
                  }`}
                />
              ))}
              <Skeleton className="h-64 w-full bg-muted/60" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!sortedContents.length) {
    return (
      <div className="h-[calc(100vh-7rem)] flex items-center justify-center text-sm text-muted-foreground">
        暂无可展示内容
      </div>
    );
  }

  return (
    <div className="h-full">
      <ScrollArea className="h-full">
        <div className="flex flex-col gap-3 overflow-visible pb-6 pr-2 pl-1">
          {sortedContents.map((content) => {
            return (
            <div
              key={content.id}
              ref={(node) => {
                detailRefs.current[content.id] = node;
              }}
              className="rounded-2xl bg-transparent p-1.5 transition-all"
              onClick={() => selectContent(content.id)}
            >
              <NewsDetailCard
                title={content.detailView?.title ?? content.title}
                summary={content.aiSummary ?? undefined}
                cleanMarkdown={content.detailView?.markdown || content.markdown}
                rawText={
                  content.detailView?.content ||
                  content.summary ||
                  content.markdown ||
                  ""
                }
                metaData={content.rawRecordContent}
                author={content.detailView?.author}
                source={content.summaryView?.source ?? content.platform}
                publishedAt={content.detailView?.publishedAt ?? content.time}
                links={content.detailView?.links ?? (content.url ? [content.url] : [])}
                images={content.detailView?.images ?? (content.image ? [content.image] : [])}
                audios={content.detailView?.audios ?? []}
                files={content.detailView?.files ?? []}
                rawContent={content.rawRecordContent}
                subjectMatch={content.subjectMatches?.[0]}
                relevanceScore={
                  hasTopicSelection ? getRelevanceScore(content) : null
                }
                expandableKeywords={
                  hasTopicSelection ? buildExpandableKeywords(content) : []
                }
                feedback={hasTopicSelection ? content.feedback ?? null : null}
                bookmarked={isBookmarked(content.id)}
                onBookmarkToggle={() => {
                  const currentlyBookmarked = isBookmarked(content.id);
                  toggleFavorite.mutate({
                    contentId: content.id,
                    isFavorite: !currentlyBookmarked,
                  });
                }}
                onDeleteClick={() => {
                  setDeleteTargetId(content.id);
                  setDeleteOpen(true);
                }}
                deleting={deleting && deleteTargetId === content.id}
                onAddKeyword={hasTopicSelection ? addKeywordToTopic : undefined}
                onFeedbackVote={
                  hasTopicSelection
                    ? (vote) => {
                        void submitFeedback({
                          contentId: content.id,
                          vote,
                          note: content.feedback?.note ?? null,
                        });
                      }
                    : undefined
                }
                onFeedbackNote={
                  hasTopicSelection
                    ? () => {
                        setNoteContentId(content.id);
                        setNoteText(content.feedback?.note ?? "");
                        setNoteDialogOpen(true);
                      }
                    : undefined
                }
                className={
                  selectedContent?.id === content.id
                    ? "border-primary/35 bg-card shadow-[0_0_0_1px_hsl(var(--primary)/0.12)]"
                    : "border-border/80"
                }
              />
            </div>
            );
          })}
        </div>
      </ScrollArea>
      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open && !deleting) {
            setDeleteTargetId(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除内容？</AlertDialogTitle>
            <AlertDialogDescription>
              删除后无法恢复，关联的收藏也会一并移除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "删除中..." : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog
        open={noteDialogOpen}
        onOpenChange={(open) => {
          if (!savingFeedback) {
            setNoteDialogOpen(open);
            if (!open) {
              setNoteContentId(null);
              setNoteText("");
            }
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>反馈备注</DialogTitle>
            <DialogDescription>记录为什么相关或无关，系统会用于后续权重建议。</DialogDescription>
          </DialogHeader>
          <Textarea
            value={noteText}
            onChange={(event) => setNoteText(event.target.value)}
            placeholder="例如：该内容和主题无关，主要在讲政策新闻"
            rows={4}
          />
          <DialogFooter>
            <Button
              variant="outline"
              disabled={savingFeedback}
              onClick={() => {
                setNoteDialogOpen(false);
                setNoteContentId(null);
                setNoteText("");
              }}
            >
              取消
            </Button>
            <Button
              disabled={savingFeedback || !noteContentId}
              onClick={() => {
                if (!noteContentId) return;
                void submitFeedback({
                  contentId: noteContentId,
                  note: noteText || null,
                }).then(() => {
                  setNoteDialogOpen(false);
                  setNoteContentId(null);
                  setNoteText("");
                });
              }}
            >
              {savingFeedback ? "保存中..." : "保存备注"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FollowContent;
