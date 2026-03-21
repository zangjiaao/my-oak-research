import React from "react";
import Image from "next/image";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import {
  AudioLines,
  Bookmark,
  FileText,
  Image as ImageIcon,
  Link as LinkIcon,
  Trash2,
} from "lucide-react";
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
  subjectMatch,
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
  subjectMatch?: {
    subjectId: string;
    score: number | null;
    ruleScore: number | null;
    aiScore: number | null;
    matchSource: "QUERY" | "GATHER" | "AI" | "FUSED";
    matchedIncludes: string[];
    matchedExcludes: string[];
    reason: string | null;
  };
  className?: string;
  bookmarked?: boolean;
  onBookmarkToggle?: () => void;
  onDeleteClick?: () => void;
  deleting?: boolean;
}) => {
  return (
    <Card
      className={cn(
        "h-full border-border/80 bg-card/95 shadow-sm backdrop-blur-sm flex flex-col",
        className
      )}
    >
      <CardHeader className="flex-shrink-0 space-y-2.5 px-6 pt-4 pb-3 lg:px-8 lg:pt-5 lg:pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {source ? <Badge variant="secondary">{source}</Badge> : null}
            {author ? <Badge variant="outline">作者: {author}</Badge> : null}
            {publishedAt ? (
              <Badge variant="outline">
                时间: {new Date(publishedAt).toLocaleString()}
              </Badge>
            ) : null}
            {subjectMatch ? (
              <>
                <Badge variant="secondary">
                  相关度:{" "}
                  {typeof subjectMatch.score === "number"
                    ? subjectMatch.score.toFixed(2)
                    : "N/A"}
                </Badge>
                <Badge variant="outline">{subjectMatch.matchSource}</Badge>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="cursor-help">
                      Subject {subjectMatch.subjectId.slice(0, 8)}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs space-y-1 text-xs">
                    <p>
                      includes:{" "}
                      {subjectMatch.matchedIncludes.length
                        ? subjectMatch.matchedIncludes.join(", ")
                        : "-"}
                    </p>
                    <p>
                      excludes:{" "}
                      {subjectMatch.matchedExcludes.length
                        ? subjectMatch.matchedExcludes.join(", ")
                        : "-"}
                    </p>
                    {subjectMatch.reason ? <p>reason: {subjectMatch.reason}</p> : null}
                  </TooltipContent>
                </Tooltip>
              </>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              onClick={(event) => {
                event.stopPropagation();
                onBookmarkToggle?.();
              }}
            >
              <Bookmark
                className={cn(
                  "size-5",
                  bookmarked
                    ? "fill-red-500 text-red-500"
                    : "text-muted-foreground"
                )}
              />
            </Button>
            {onDeleteClick ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full text-destructive"
                disabled={Boolean(deleting)}
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteClick();
                }}
              >
                <Trash2 className="size-5" />
              </Button>
            ) : null}
          </div>
        </div>
        {(images?.length || audios?.length || files?.length) ? (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="hidden sm:inline-flex">
              媒体 {images?.length ?? 0}/{audios?.length ?? 0}/{files?.length ?? 0}
            </Badge>
          </div>
        ) : null}
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground/90 line-clamp-2">
          {summary || title || "News Summary"}
        </p>
      </CardHeader>
      <Separator />
      <CardContent className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-6 py-4 lg:px-8">
        <Tabs defaultValue="content" className="h-full">
          <TabsList className="w-full justify-start bg-muted/70 p-1">
            <TabsTrigger value="content">正文</TabsTrigger>
            <TabsTrigger value="media">媒体</TabsTrigger>
            <TabsTrigger value="links">链接</TabsTrigger>
            <TabsTrigger value="raw">原始</TabsTrigger>
          </TabsList>
          <TabsContent value="content" className="pt-4">
            <article className="prose prose-slate max-w-3xl text-[15px] leading-7 text-foreground/90 prose-p:my-0 prose-p:leading-7 prose-p:text-foreground/90 prose-headings:mb-3 prose-headings:mt-5 prose-headings:font-semibold prose-headings:text-foreground prose-li:my-1 prose-li:text-foreground/90 prose-strong:text-foreground prose-a:text-primary prose-a:no-underline hover:prose-a:underline">
              <ReactMarkdown>{markdown}</ReactMarkdown>
            </article>
          </TabsContent>
          <TabsContent value="media" className="pt-5">
            {images && images.length > 0 ? (
              <div className="mb-6 rounded-xl border border-border/70 bg-muted/20 p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                  <ImageIcon className="size-4 text-muted-foreground" />
                  图片
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {images.slice(0, 4).map((src, index) => (
                  <div
                    key={`${src}-${index}`}
                    className="relative aspect-video overflow-hidden rounded-lg border bg-muted"
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
              </div>
            ) : null}
            {audios && audios.length > 0 ? (
              <div className="mb-6 rounded-xl border border-border/70 bg-muted/20 p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                  <AudioLines className="size-4 text-muted-foreground" />
                  音频
                </div>
                <div className="flex flex-col gap-3">
                {audios.slice(0, 4).map((audioUrl, index) => (
                  <Tooltip key={`${audioUrl}-${index}`}>
                    <TooltipTrigger asChild>
                      <audio controls src={audioUrl} className="w-full rounded-md" />
                    </TooltipTrigger>
                    <TooltipContent>{audioUrl}</TooltipContent>
                  </Tooltip>
                ))}
              </div>
              </div>
            ) : null}
            {files && files.length > 0 ? (
              <div className="mb-6 rounded-xl border border-border/70 bg-muted/20 p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                  <FileText className="size-4 text-muted-foreground" />
                  附件
                </div>
                <div className="flex flex-col gap-2 text-sm">
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
              </div>
            ) : null}
            {!images?.length && !audios?.length && !files?.length ? (
              <p className="text-sm text-muted-foreground">暂无媒体内容</p>
            ) : null}
          </TabsContent>
          <TabsContent value="links" className="pt-5">
            {links && links.length > 0 ? (
              <div className="mb-6 rounded-xl border border-border/70 bg-muted/20 p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                  <LinkIcon className="size-4 text-muted-foreground" />
                  参考链接
                </div>
                <div className="flex flex-col gap-2 text-sm">
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
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">暂无链接</p>
            )}
          </TabsContent>
          <TabsContent value="raw" className="pt-5">
            <pre className="max-h-[22rem] overflow-auto rounded-lg border border-border/70 bg-muted/20 p-4 text-xs leading-5">
              {JSON.stringify(rawContent ?? {}, null, 2)}
            </pre>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default NewsDetailCard;
