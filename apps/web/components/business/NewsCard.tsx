"use client";

import React from "react";
import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Globe, Bookmark, MoreHorizontal, Link as LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface NewsCardProps {
  title: string;
  summary: string;
  image?: string;
  platform?: string;
  time?: string;
  mediaLabel?: string;
  mediaCount?: number;
  url?: string;
  mark?: boolean;
  selected?: boolean;
  onBookmarkToggle?: () => void;
}

const NewsCard = ({
  title,
  summary,
  image,
  platform,
  time,
  mediaLabel,
  mediaCount,
  url,
  mark,
  selected,
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
    <Card
      className={cn(
        "border-border/80 bg-card/95 shadow-sm backdrop-blur-sm transition-all duration-200",
        selected
          ? "border-primary/35 shadow-[0_0_0_1px_hsl(var(--primary)/0.12)]"
          : "hover:border-border"
      )}
    >
      <CardContent className="px-5 py-4">
        <div className="flex items-stretch gap-4">
          {image && (
            <div className="relative w-32 flex-shrink-0 overflow-hidden rounded-lg border bg-muted/40">
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

          <div className="flex min-h-32 w-full flex-col justify-between gap-3 overflow-hidden">
            <div className="flex flex-col gap-2">
              <h1 className="line-clamp-2 text-lg font-semibold leading-snug tracking-tight">
                {title}
              </h1>
              <p className="line-clamp-3 break-words text-sm leading-6 text-muted-foreground">
                {summary}
              </p>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary" className="gap-1.5">
                  <Globe className="size-3.5" />
                  {platform}
                </Badge>
                <Badge variant="outline" className="gap-1.5">
                  <Calendar className="size-3.5" />
                  {time}
                </Badge>
                {mediaLabel ? (
                  <Badge variant="outline" className="capitalize">
                    {mediaLabel}
                    {mediaCount && mediaCount > 0 ? ` x${mediaCount}` : ""}
                  </Badge>
                ) : null}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-full"
                    aria-label="More actions"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={(event) => {
                      event.stopPropagation();
                      onBookmarkToggle?.();
                    }}
                  >
                    <Bookmark
                      size={16}
                      className={
                        mark ? "fill-red-500 text-red-500" : "text-muted-foreground"
                      }
                    />
                    {mark ? "取消收藏" : "收藏"}
                  </DropdownMenuItem>
                  {url ? (
                    <DropdownMenuItem
                      onClick={(event) => {
                        event.stopPropagation();
                        window.open(url, "_blank", "noopener,noreferrer");
                      }}
                    >
                      <LinkIcon className="size-4" />
                      打开原文
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default NewsCard;
