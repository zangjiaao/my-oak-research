import React from "react";
import Image from "next/image";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Bookmark, Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const NewsDetailCard = ({
  title,
  summary,
  markdown,
  author,
  source,
  publishedAt,
  links,
  images,
  className,
  bookmarked,
  onBookmarkToggle,
  onDeleteClick,
  deleting,
}: {
  title?: string;
  summary?: string;
  markdown: string;
  author?: string | null;
  source?: string;
  publishedAt?: string;
  links?: string[];
  images?: string[];
  className?: string;
  bookmarked?: boolean;
  onBookmarkToggle?: () => void;
  onDeleteClick?: () => void;
  deleting?: boolean;
}) => {
  return (
    <Card
      className={cn("h-full px-8 py-14 bg-gray-100 flex flex-col", className)}
    >
      <CardHeader className="flex-shrink-0">
        <CardTitle className="mb-4">
          <div className="flex items-center gap-2 justify-between">
            <p className="text-4xl font-bold">{title ? title : "News Title"}</p>
            <div className="flex items-center gap-2">
              {onDeleteClick && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 p-0 text-destructive"
                  disabled={Boolean(deleting)}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteClick();
                  }}
                >
                  <Trash2 className="size-7" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 p-0" // Button 自身保持 40px
                onClick={(event) => {
                  event.stopPropagation();
                  onBookmarkToggle?.();
                }}
              >
                <Bookmark
                  className={cn(
                    "size-8",
                    bookmarked
                      ? "fill-red-500 text-red-500"
                      : "text-muted-foreground"
                  )}
                />
              </Button>
            </div>
          </div>
        </CardTitle>
        <p className="text-sm text-muted-foreground line-clamp-3">
          {summary ? summary : "News Summary News Summary News Summary"}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {source ? <Badge variant="outline">{source}</Badge> : null}
          {author ? <Badge variant="outline">作者: {author}</Badge> : null}
          {publishedAt ? (
            <Badge variant="outline">
              时间: {new Date(publishedAt).toLocaleString()}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="px-6 overflow-y-auto scrollbar-hide flex-1 min-h-0">
        {images && images.length > 0 ? (
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {images.slice(0, 4).map((src, index) => (
              <div
                key={`${src}-${index}`}
                className="relative h-48 overflow-hidden rounded-lg bg-muted"
              >
                <Image
                  src={src}
                  alt={title ? `${title}-image-${index + 1}` : `image-${index + 1}`}
                  fill
                  className="object-cover"
                  unoptimized
                />
              </div>
            ))}
          </div>
        ) : null}
        {links && links.length > 0 ? (
          <div className="mb-6 flex flex-col gap-1 text-sm">
            {links.slice(0, 3).map((link, index) => (
              <a
                key={`${link}-${index}`}
                href={link}
                target="_blank"
                rel="noreferrer"
                className="truncate text-blue-600 hover:underline"
              >
                {link}
              </a>
            ))}
          </div>
        ) : null}
        <article className="prose dark:prose-invert max-w-none">
          <ReactMarkdown>{markdown}</ReactMarkdown>
        </article>
      </CardContent>
    </Card>
  );
};

export default NewsDetailCard;
