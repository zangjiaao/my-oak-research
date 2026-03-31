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
  const selectedTopicId = filters.topicId || "";

  const buildExpandableKeywords = (content: (typeof contents)[number]) => {
    const keywords: Array<{
      category: "PERSON" | "ORG" | "TECH" | "LOCATION";
      label: string;
    }> = [];
    const pushUnique = (
      category: "PERSON" | "ORG" | "TECH" | "LOCATION",
      value: string
    ) => {
      const label = value.trim();
      if (!label) return;
      if (keywords.some((item) => item.category === category && item.label === label)) return;
      keywords.push({ category, label });
    };
    for (const person of content.entities?.persons ?? []) {
      pushUnique("PERSON", person);
    }
    for (const org of content.entities?.orgs ?? []) {
      pushUnique("ORG", org);
    }
    for (const location of content.entities?.locations ?? []) {
      pushUnique("LOCATION", location);
    }
    const techTerms = (content.topicScores ?? [])
      .flatMap((score) => {
        if (typeof score.reason !== "string") return [];
        return score.reason
          .split(/[,\s;:]+/)
          .map((term) => term.trim())
          .filter((term) => term.length >= 3);
      })
      .slice(0, 4);
    for (const tech of techTerms) {
      pushUnique("TECH", tech);
    }
    return keywords.slice(0, 8);
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
    category: "PERSON" | "ORG" | "TECH" | "LOCATION";
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
          weight: keyword.category === "TECH" ? 1.2 : 1,
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

  const sortedContents = useMemo(() => {
    if (filters.sort === "matchScore") {
      return [...contents].sort((a, b) => {
        const aScore =
          a.subjectMatches?.find((match) =>
            filters.subjectId ? match.subjectId === filters.subjectId : true
          )?.score ?? -1;
        const bScore =
          b.subjectMatches?.find((match) =>
            filters.subjectId ? match.subjectId === filters.subjectId : true
          )?.score ?? -1;
        if (aScore !== bScore) {
          return bScore - aScore;
        }
        const aTime = new Date(a.detailView?.publishedAt ?? a.time).getTime();
        const bTime = new Date(b.detailView?.publishedAt ?? b.time).getTime();
        return bTime - aTime;
      });
    }
    if (filters.sort === "topicScore" || filters.sort === "relevance") {
      return [...contents].sort((a, b) => {
        const aScore =
          a.topicScores?.find((score) =>
            filters.topicId ? score.topicId === filters.topicId : true
          )?.finalScore ?? -1;
        const bScore =
          b.topicScores?.find((score) =>
            filters.topicId ? score.topicId === filters.topicId : true
          )?.finalScore ?? -1;
        if (aScore !== bScore) {
          return bScore - aScore;
        }
        const aTime = new Date(a.detailView?.publishedAt ?? a.time).getTime();
        const bTime = new Date(b.detailView?.publishedAt ?? b.time).getTime();
        return bTime - aTime;
      });
    }
    return [...contents].sort((a, b) => {
      const aTime = new Date(a.detailView?.publishedAt ?? a.time).getTime();
      const bTime = new Date(b.detailView?.publishedAt ?? b.time).getTime();
      if (aTime !== bTime) {
        return bTime - aTime;
      }
      const aIndex = a.relation?.recordIndex ?? Number.MAX_SAFE_INTEGER;
      const bIndex = b.relation?.recordIndex ?? Number.MAX_SAFE_INTEGER;
      return aIndex - bIndex;
    });
  }, [contents, filters.sort, filters.subjectId, filters.topicId]);

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
          {sortedContents.map((content) => (
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
                summary={content.summaryView?.summary ?? content.summary}
                markdown={
                  content.detailView?.markdown ||
                  content.markdown ||
                  content.detailView?.content ||
                  content.summary ||
                  "No content details"
                }
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
                  content.topicScore?.topicId === selectedTopicId
                    ? content.topicScore?.finalScore ?? null
                    : content.topicScores?.find((score) =>
                        selectedTopicId ? score.topicId === selectedTopicId : true
                      )?.finalScore ?? null
                }
                expandableKeywords={buildExpandableKeywords(content)}
                feedback={content.feedback ?? null}
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
                onAddKeyword={addKeywordToTopic}
                onFeedbackVote={(vote) => {
                  void submitFeedback({
                    contentId: content.id,
                    vote,
                    note: content.feedback?.note ?? null,
                  });
                }}
                onFeedbackNote={() => {
                  setNoteContentId(content.id);
                  setNoteText(content.feedback?.note ?? "");
                  setNoteDialogOpen(true);
                }}
                className={
                  selectedContent?.id === content.id
                    ? "border-primary/35 bg-card shadow-[0_0_0_1px_hsl(var(--primary)/0.12)]"
                    : "border-border/80"
                }
              />
            </div>
          ))}
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
