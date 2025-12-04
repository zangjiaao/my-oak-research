"use client";

import React, { useMemo } from "react";
import { NewsDetailCard } from "@/components/business";
import { useFollowContent } from "@/components/follow-content/context";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToggleFavorite, useFavorites } from "@/hooks/useFavorites";

const FollowContent = () => {
  const { selectedContent, error } = useFollowContent();
  const toggleFavorite = useToggleFavorite();

  // 获取所有收藏的内容 ID，用于判断是否已收藏
  const { data: favoritesData } = useFavorites({ limit: 50 });
  const favoriteIds = useMemo(
    () => new Set(favoritesData?.items.map((item) => item.id) ?? []),
    [favoritesData?.items]
  );

  const isBookmarked = (id: string) => favoriteIds.has(id);

  if (error) {
    return (
      <div className="h-[calc(100vh-7rem)] flex items-center justify-center text-sm text-destructive">
        {error.message ?? "Cannot load content details"}
      </div>
    );
  }

  if (!selectedContent) {
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

  return (
    <div className="h-full lg:h-[calc(100vh-7rem)]">
      <NewsDetailCard
        title={selectedContent.title}
        summary={selectedContent.summary}
        markdown={
          selectedContent.markdown ||
          selectedContent.summary ||
          "No content details"
        }
        bookmarked={isBookmarked(selectedContent.id)}
        onBookmarkToggle={() => {
          toggleFavorite.mutate({
            contentId: selectedContent.id,
            isFavorite: isBookmarked(selectedContent.id),
          });
        }}
      />
    </div>
  );
};

export default FollowContent;
