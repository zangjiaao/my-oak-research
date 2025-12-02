"use client";

import React, { useState } from "react";
import { NewsCard, NewsDetailCard } from "@/components/business";
import type { NewsCardProps } from "@/components/business/NewsCard";
import { Input } from "@/components/ui/input";
import { Search, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";

const favoritesList: NewsCardProps[] = [
  {
    title: "Favorites 1",
    summary: "Favorites 1 summary Favorites 1 summary Favorites 1 summary",
    image: "https://placehold.co/150",
    platform: "Twitter",
    time: "2025-01-01",
    mark: false,
  },
  {
    title: "Favorites 2",
    summary: "Favorites 2 summary",
    platform: "Twitter",
    time: "2025-01-02",
    mark: true,
  },
  {
    title: "Favorites 3",
    summary: "Favorites 3 summary",
    image: "https://placehold.co/150",
    platform: "Twitter",
    time: "2025-01-03",
    mark: true,
  },
  {
    title: "Favorites 4",
    summary: "Favorites 4 summary",
    platform: "Twitter",
    time: "2025-01-04",
    mark: false,
  },
  {
    title: "Favorites 5",
    summary: "Knowledge 5 summary",
    image: "https://placehold.co/150",
    platform: "Twitter",
    time: "2025-01-05",
    mark: true,
  },
];

const FavoritesPage = () => {
  const [showDetail, setShowDetail] = useState(false);
  const [selectedNews, setSelectedNews] = useState<NewsCardProps | null>(null);

  const handleToggleDetail = () => {
    setShowDetail(!showDetail);
    if (!showDetail && !selectedNews && favoritesList.length > 0) {
      // 如果没有选中的新闻，默认选择第一个
      setSelectedNews(favoritesList[0]);
    }
  };

  const handleNewsClick = (news: NewsCardProps) => {
    setSelectedNews(news);
    setShowDetail(true);
  };

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
          >
            {showDetail ? <EyeOff /> : <Eye />}
            {showDetail ? "Hide Detail" : "View Detail"}
          </Button>
          <Input placeholder="Search" icon={<Search size={16} />} />
        </div>

        {/* 卡片网格 */}
        <div
          className={`grid gap-4 px-1 pb-1 max-h-[calc(100vh-160px)] overflow-y-auto ${
            showDetail
              ? "grid-cols-1"
              : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
          }`}
        >
          {favoritesList.map((favorites) => (
            <div
              key={favorites.title}
              onClick={() => handleNewsClick(favorites)}
              className={`transition-all duration-200 ${
                selectedNews?.title === favorites.title && showDetail
                  ? "ring-1 ring-gray-200 rounded-xl shadow-md"
                  : ""
              }`}
            >
              <NewsCard {...favorites} />
            </div>
          ))}
        </div>
      </div>

      {/* 详情区域 */}
      {showDetail && (
        <div className="col-span-1 lg:col-span-3 transition-all duration-300">
          <NewsDetailCard
            title={selectedNews?.title}
            summary={selectedNews?.summary}
            markdown={
              selectedNews
                ? `News title: ${selectedNews.title}\n\nNews summary: ${selectedNews.summary}`
                : "Please select a news to view details"
            }
          />
        </div>
      )}
    </div>
  );
};

export default FavoritesPage;
