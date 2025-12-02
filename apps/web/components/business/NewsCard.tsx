"use client";

import React from "react";
import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Globe, Bookmark } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface NewsCardProps {
  title: string;
  summary: string;
  image?: string;
  platform?: string;
  time?: string;
  mark?: boolean;
  onBookmarkToggle?: () => void;
}

const NewsCard = ({
  title,
  summary,
  image,
  platform,
  time,
  mark,
  onBookmarkToggle,
}: NewsCardProps) => {
  // 检测是否为 SVG：检查扩展名或可能返回 SVG 的域名
  // 对于 placehold.co 等占位图服务，它们可能返回 SVG 格式
  const isSvg = React.useMemo(() => {
    if (!image) return false;
    const lowerImage = image.toLowerCase();

    // 检查文件扩展名
    if (lowerImage.endsWith(".svg") || lowerImage.includes(".svg?")) {
      return true;
    }

    // 检查可能返回 SVG 的域名（直接检查字符串，避免 URL 解析问题）
    if (
      lowerImage.includes("placehold.co") ||
      lowerImage.includes("via.placeholder.com")
    ) {
      return true;
    }

    return false;
  }, [image]);

  return (
    <Card>
      <CardContent>
        <div className="flex gap-4 items-stretch">
          {image && (
            <div className="bg-gray-200 flex-shrink-0 rounded-md w-36 overflow-hidden relative">
              {isSvg ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={image}
                  alt={title}
                  className="object-cover w-full h-full"
                />
              ) : (
                <Image
                  src={image}
                  alt={title}
                  fill
                  className="object-cover"
                  sizes="144px"
                  unoptimized
                />
              )}
            </div>
          )}

          <div className="flex flex-col gap-2 justify-between overflow-hidden min-h-36 w-full">
            <div className="flex flex-col gap-2">
              <h1 className="text-lg font-bold">{title}</h1>
              <p className="text-sm text-muted-foreground break-words line-clamp-3">
                {summary}
              </p>
            </div>

            <div className="flex gap-2 justify-between items-center">
              <div className="flex gap-2">
                <Badge variant="outline">
                  <Globe />
                  {platform}
                </Badge>
                <Badge variant="outline">
                  <Calendar />
                  {time}
                </Badge>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={mark ? "Remove from bookmarks" : "Add to bookmarks"}
                onClick={(event) => {
                  event.stopPropagation();
                  onBookmarkToggle?.();
                }}
              >
                <Bookmark
                  size={32}
                  className={
                    mark ? "fill-red-500 text-red-500" : "text-muted-foreground"
                  }
                />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default NewsCard;
