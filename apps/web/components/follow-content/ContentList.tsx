"use client";

import React, { useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { NewsCard } from "@/components/business";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useFollowContent } from "./context";
import { useToggleFavorite, useFavorites } from "@/hooks/useFavorites";

export const ContentList = () => {
  const { contents, selectedContent, selectContent, isLoading, error } =
    useFollowContent();
  const toggleFavorite = useToggleFavorite();

  // 获取所有收藏的内容 ID，用于判断是否已收藏
  const { data: favoritesData } = useFavorites({ limit: 50 });
  const favoriteIds = useMemo(
    () => new Set(favoritesData?.items.map((item) => item.id) ?? []),
    [favoritesData?.items]
  );

  const isBookmarked = (id: string) => favoriteIds.has(id);

  return (
    <ScrollArea className="h-[calc(100vh-11rem)]">
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
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
};
