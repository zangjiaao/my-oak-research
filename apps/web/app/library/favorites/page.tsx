"use client";

import React, { useState, useEffect, useMemo } from "react";
import { NewsCard, NewsDetailCard } from "@/components/business";
import type { NewsCardProps } from "@/components/business/NewsCard";
import { Input } from "@/components/ui/input";
import { Search, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useFavorites,
  useToggleFavorite,
  type FavoriteItem,
} from "@/hooks/useFavorites";

const FavoritesPage = () => {
  const [showDetail, setShowDetail] = useState(false);
  const [selectedNews, setSelectedNews] = useState<FavoriteItem | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // 防抖实现
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);

    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading, error } = useFavorites({
    search: debouncedSearch || undefined,
    limit: 50,
  });

  const favoritesList = useMemo(() => data?.items ?? [], [data?.items]);

  const toggleFavorite = useToggleFavorite();

  const handleToggleDetail = () => {
    setShowDetail(!showDetail);
    if (!showDetail && !selectedNews && favoritesList.length > 0) {
      // 如果没有选中的新闻，默认选择第一个
      setSelectedNews(favoritesList[0]);
    }
  };

  const handleNewsClick = (news: FavoriteItem) => {
    setSelectedNews(news);
    setShowDetail(true);
  };

  const handleBookmarkToggle = (item: FavoriteItem) => {
    toggleFavorite.mutate({
      contentId: item.id,
      isFavorite: true, // 在收藏夹页面，点击就是取消收藏
    });
    // 如果取消收藏的是当前选中的新闻，关闭详情
    if (selectedNews?.id === item.id) {
      setShowDetail(false);
      setSelectedNews(null);
    }
  };

  // 将 FavoriteItem 转换为 NewsCardProps
  const convertToNewsCardProps = (item: FavoriteItem): NewsCardProps => ({
    title: item.title,
    summary: item.summary,
    image: item.image ?? undefined,
    platform: item.platform,
    time: new Date(item.time).toLocaleDateString("zh-CN"),
    mark: true, // 收藏夹中的都是已收藏状态
    onBookmarkToggle: () => handleBookmarkToggle(item),
  });

  return (
    <div
      className={`grid gap-4 h-full transition-all duration-300 ${
        showDetail ? "grid-cols-1 lg:grid-cols-5" : "grid-cols-1"
      }`}
    >
      {/* 新闻卡片区域 */}
      <div
        className={`flex flex-col gap-4 ${
          showDetail ? "col-span-1 lg:col-span-2" : "col-span-1"
        }`}
      >
        {/* 操作栏 */}
        <div className="flex gap-4 ml-1">
          <Button
            onClick={handleToggleDetail}
            variant={showDetail ? "default" : "outline"}
            disabled={favoritesList.length === 0}
          >
            {showDetail ? <EyeOff /> : <Eye />}
            {showDetail ? "Hide Detail" : "View Detail"}
          </Button>
          <Input
            placeholder="Search"
            icon={<Search size={16} />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* 卡片网格 */}
        <div
          className={`grid gap-4 px-1 pb-1 max-h-[calc(100vh-160px)] overflow-y-auto ${
            showDetail
              ? "grid-cols-1"
              : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
          }`}
        >
          {isLoading ? (
            <div className="col-span-full text-center text-muted-foreground py-8">
              加载中...
            </div>
          ) : error ? (
            <div className="col-span-full text-center text-destructive py-8">
              加载失败，请稍后重试
            </div>
          ) : favoritesList.length === 0 ? (
            <div className="col-span-full text-center text-muted-foreground py-8">
              {search ? "没有找到匹配的收藏内容" : "暂无收藏内容"}
            </div>
          ) : (
            favoritesList.map((favorite) => {
              const newsCardProps = convertToNewsCardProps(favorite);
              return (
                <div
                  key={favorite.id}
                  onClick={() => handleNewsClick(favorite)}
                  className={`transition-all duration-200 cursor-pointer ${
                    selectedNews?.id === favorite.id && showDetail
                      ? "ring-1 ring-gray-200 rounded-xl shadow-md"
                      : ""
                  }`}
                >
                  <NewsCard {...newsCardProps} />
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 详情区域 */}
      {showDetail && selectedNews && (
        <div className="col-span-1 lg:col-span-3 transition-all duration-300">
          <NewsDetailCard
            title={selectedNews.title}
            summary={selectedNews.summary}
            markdown={selectedNews.markdown}
            bookmarked={true}
            onBookmarkToggle={() => handleBookmarkToggle(selectedNews)}
          />
        </div>
      )}
    </div>
  );
};

export default FavoritesPage;
