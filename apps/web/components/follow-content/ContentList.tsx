"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { NewsCard } from "@/components/business";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Sparkles } from "lucide-react";
import { useFollowContent } from "./context";
import { useToggleFavorite, useFavorites } from "@/hooks/useFavorites";

export const ContentList = () => {
  const {
    contents,
    selectedContent,
    selectContent,
    isLoading,
    hasMore,
    isFetchingMore,
    loadMore,
    error,
  } = useFollowContent();
  const toggleFavorite = useToggleFavorite();
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  // 获取所有收藏的内容 ID，用于判断是否已收藏
  const { data: favoritesData } = useFavorites({ limit: 50 });
  const favoriteIds = useMemo(
    () => new Set(favoritesData?.items.map((item) => item.id) ?? []),
    [favoritesData?.items]
  );

  const isBookmarked = (id: string) => favoriteIds.has(id);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMore) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry?.isIntersecting) {
          loadMore();
        }
      },
      { root: null, rootMargin: "160px 0px 240px 0px", threshold: 0.01 }
    );
    observer.observe(target);
    return () => {
      observer.disconnect();
    };
  }, [hasMore, loadMore]);

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-4 overflow-visible pl-1 pr-4 pt-1">
        {isLoading && (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, idx) => (
              <Card
                key={`content-skeleton-${idx}`}
                className="rounded-xl border-border/80 bg-card/95 shadow-sm"
              >
                <CardContent className="px-5 py-4">
                  <div className="flex min-h-32 w-full flex-col justify-between gap-3 overflow-hidden">
                    <div className="space-y-2.5">
                      <Skeleton className="h-6 w-full bg-muted/60" />
                      <Skeleton className="h-6 w-9/12 bg-muted/60" />
                    </div>
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-4 w-4/12 bg-muted/60" />
                        <Skeleton className="h-4 w-7/12 bg-muted/60" />
                      </div>
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-4 w-6/12 bg-muted/60" />
                        <Skeleton className="h-4 w-4/12 bg-muted/60" />
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <div className="flex gap-2">
                        <Skeleton className="h-5 w-20 rounded-full bg-muted/60" />
                        <Skeleton className="h-5 w-20 rounded-full bg-muted/60" />
                      </div>
                      <Skeleton className="h-5 w-5 rounded-full bg-muted/60" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        {error && (
          <div className="text-sm text-destructive px-2">
            {error.message ?? "Cannot load content"}
          </div>
        )}
        {!isLoading && !error && !contents.length && (
          <div className="text-sm text-muted-foreground px-2">
            No content found. Try adjusting your filters.
          </div>
        )}
        {contents.map((content) => {
          const isActive = selectedContent?.id === content.id;
          const bookmarked = isBookmarked(content.id);
          const topMatch = content.subjectMatches?.[0];
          const topScore =
            typeof topMatch?.score === "number"
              ? topMatch.score.toFixed(2)
              : null;
          return (
            <div
              key={content.id}
              onClick={() => selectContent(content.id)}
              className="cursor-pointer rounded-2xl"
            >
              <NewsCard
                title={content.summaryView?.title ?? content.title}
                summary={content.summaryView?.summary ?? content.summary}
                image={
                  content.summaryView?.hasImage
                    ? (content.image ?? undefined)
                    : undefined
                }
                platform={content.summaryView?.source ?? content.platform}
                time={new Date(content.summaryView?.ingestedAt ?? content.time).toLocaleDateString()}
                mediaLabel={content.summaryView?.previewMediaType}
                mediaCount={content.summaryView?.mediaCount}
                url={content.detailView?.sourceUrl ?? content.url ?? undefined}
                mark={bookmarked}
                selected={isActive}
                onBookmarkToggle={() => {
                  toggleFavorite.mutate({
                    contentId: content.id,
                    isFavorite: !bookmarked,
                  });
                }}
              />
              {topMatch ? (
                <div className="mt-2 flex items-center gap-2 px-2">
                  <Badge variant="secondary" className="gap-1.5">
                    <Sparkles className="size-3.5" />
                    相关度 {topScore ?? "N/A"}
                  </Badge>
                  <Badge variant="outline">{topMatch.matchSource}</Badge>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="outline" className="cursor-help">
                        Subject {topMatch.subjectId.slice(0, 8)}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs text-xs">
                      <p>
                        includes:
                        {" "}
                        {topMatch.matchedIncludes.length
                          ? topMatch.matchedIncludes.join(", ")
                          : "-"}
                      </p>
                      <p>
                        excludes:
                        {" "}
                        {topMatch.matchedExcludes.length
                          ? topMatch.matchedExcludes.join(", ")
                          : "-"}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              ) : null}
            </div>
          );
        })}
        {!isLoading && !error ? (
          <div ref={loadMoreRef} className="px-2 py-3 text-xs text-muted-foreground">
            {isFetchingMore
              ? "加载更多中..."
              : hasMore
                ? "下滑加载更多"
                : contents.length
                  ? "已加载全部内容"
                  : ""}
          </div>
        ) : null}
      </div>
    </ScrollArea>
  );
};
