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
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

const FollowContent = () => {
  const { contents, selectedContent, selectContent, isLoading, error } =
    useFollowContent();
  const toggleFavorite = useToggleFavorite();
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);
  const detailRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // 获取所有收藏的内容 ID，用于判断是否已收藏
  const { data: favoritesData } = useFavorites({ limit: 50 });
  const favoriteIds = useMemo(
    () => new Set(favoritesData?.items.map((item) => item.id) ?? []),
    [favoritesData?.items]
  );

  const isBookmarked = (id: string) => favoriteIds.has(id);

  const sortedContents = useMemo(() => {
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
  }, [contents]);

  useEffect(() => {
    if (!selectedContent?.id) {
      return;
    }
    const target = detailRefs.current[selectedContent.id];
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveHighlightId(selectedContent.id);
      const timer = window.setTimeout(() => {
        setActiveHighlightId((current) =>
          current === selectedContent.id ? null : current
        );
      }, 1200);
      return () => window.clearTimeout(timer);
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
        <Card className="mx-auto h-full bg-gray-100 px-8 py-14">
          <CardHeader className="space-y-4">
            <CardTitle className="mb-4">
              <div className="flex items-center gap-4">
                <Skeleton className="h-10 flex-1 bg-white/70" />
                <Skeleton className="h-10 w-10 rounded-full bg-white/70" />
              </div>
            </CardTitle>
            <div className="space-y-2">
              <Skeleton className="h-4 w-full bg-white/70" />
              <Skeleton className="h-4 w-5/6 bg-white/70" />
              <Skeleton className="h-4 w-2/3 bg-white/70" />
            </div>
          </CardHeader>
          <CardContent className="px-6">
            <div className="space-y-3">
              {Array.from({ length: 12 }).map((_, idx) => (
                <Skeleton
                  key={idx}
                  className={`h-4 bg-white/70 ${
                    idx % 3 === 0 ? "w-full" : idx % 3 === 1 ? "w-5/6" : "w-2/3"
                  }`}
                />
              ))}
              <Skeleton className="h-64 w-full bg-white/70" />
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
    <div className="h-full lg:h-[calc(100vh-7rem)]">
      <ScrollArea className="h-full">
        <div className="flex flex-col gap-3 pb-6 pr-2">
          {sortedContents.map((content) => (
            <div
              key={content.id}
              ref={(node) => {
                detailRefs.current[content.id] = node;
              }}
              className={`rounded-xl transition-shadow ${
                activeHighlightId === content.id
                  ? "ring-2 ring-emerald-500 shadow-md"
                  : ""
              }`}
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
                className={
                  selectedContent?.id === content.id
                    ? "ring-1 ring-emerald-300"
                    : undefined
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
    </div>
  );
};

export default FollowContent;
