import React from "react";
import Image from "next/image";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Bookmark, Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const NewsDetailCard = ({
  title,
  summary,
  markdown,
  author,
  source,
  publishedAt,
  links,
  images,
  audios,
  files,
  rawContent,
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
  audios?: string[];
  files?: string[];
  rawContent?: Record<string, unknown>;
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
      <Separator />
      <CardContent className="px-6 overflow-y-auto scrollbar-hide flex-1 min-h-0">
        <Tabs defaultValue="content" className="h-full">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="content">正文</TabsTrigger>
            <TabsTrigger value="media">媒体</TabsTrigger>
            <TabsTrigger value="links">链接</TabsTrigger>
            <TabsTrigger value="raw">原始</TabsTrigger>
          </TabsList>
          <TabsContent value="content" className="pt-4">
            <article className="prose dark:prose-invert max-w-none">
              <ReactMarkdown>{markdown}</ReactMarkdown>
            </article>
          </TabsContent>
          <TabsContent value="media" className="pt-4">
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
            <Separator className="my-4" />
            {audios && audios.length > 0 ? (
              <div className="mb-6 flex flex-col gap-2">
                {audios.slice(0, 4).map((audioUrl, index) => (
                  <Tooltip key={`${audioUrl}-${index}`}>
                    <TooltipTrigger asChild>
                      <audio controls src={audioUrl} className="w-full" />
                    </TooltipTrigger>
                    <TooltipContent>{audioUrl}</TooltipContent>
                  </Tooltip>
                ))}
              </div>
            ) : null}
            {files && files.length > 0 ? (
              <div className="mb-6 flex flex-col gap-1 text-sm">
                {files.slice(0, 6).map((fileUrl, index) => (
                  <Tooltip key={`${fileUrl}-${index}`}>
                    <TooltipTrigger asChild>
                      <a
                        href={fileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate text-blue-600 hover:underline"
                      >
                        {fileUrl}
                      </a>
                    </TooltipTrigger>
                    <TooltipContent>{fileUrl}</TooltipContent>
                  </Tooltip>
                ))}
              </div>
            ) : null}
            {!images?.length && !audios?.length && !files?.length ? (
              <p className="text-sm text-muted-foreground">暂无媒体内容</p>
            ) : null}
          </TabsContent>
          <TabsContent value="links" className="pt-4">
            {links && links.length > 0 ? (
              <div className="mb-6 flex flex-col gap-1 text-sm">
                {links.map((link, index) => (
                  <Tooltip key={`${link}-${index}`}>
                    <TooltipTrigger asChild>
                      <a
                        href={link}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate text-blue-600 hover:underline"
                      >
                        {link}
                      </a>
                    </TooltipTrigger>
                    <TooltipContent>{link}</TooltipContent>
                  </Tooltip>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">暂无链接</p>
            )}
          </TabsContent>
          <TabsContent value="raw" className="pt-4">
            <pre className="max-h-[22rem] overflow-auto rounded-md border bg-muted p-3 text-xs">
              {JSON.stringify(rawContent ?? {}, null, 2)}
            </pre>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default NewsDetailCard;
