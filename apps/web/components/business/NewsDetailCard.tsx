import React from "react";
import Image from "next/image";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import {
  AudioLines,
  Bookmark,
  Building2,
  Cpu,
  FileText,
  Image as ImageIcon,
  Link as LinkIcon,
  MapPin,
  MessageSquarePlus,
  Plus,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  User,
  Sparkles,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  relevanceScore,
  expandableKeywords,
  feedback,
  className,
  bookmarked,
  onBookmarkToggle,
  onDeleteClick,
  deleting,
  onAddKeyword,
  onFeedbackVote,
  onFeedbackNote,
  onGenerateSummary,
  summaryGenerating,
  summaryUpdatedAt,
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
  relevanceScore?: number | null;
  expandableKeywords?: Array<{
    category: "PERSON" | "ORG" | "TECH" | "LOCATION" | "PRODUCT" | "EVENT" | "CONCEPT";
    label: string;
  }>;
  feedback?: {
    vote: "UP" | "DOWN" | "NONE";
    note?: string | null;
  } | null;
  className?: string;
  bookmarked?: boolean;
  onBookmarkToggle?: () => void;
  onDeleteClick?: () => void;
  deleting?: boolean;
  onAddKeyword?: (keyword: {
    category: "PERSON" | "ORG" | "TECH" | "LOCATION" | "PRODUCT" | "EVENT" | "CONCEPT";
    label: string;
  }) => void;
  onFeedbackVote?: (vote: "UP" | "DOWN") => void;
  onFeedbackNote?: () => void;
  onGenerateSummary?: () => void;
  summaryGenerating?: boolean;
  summaryUpdatedAt?: string | null;
}) => {
  const keywordTagMeta: Record<
    "PERSON" | "ORG" | "TECH" | "LOCATION" | "PRODUCT" | "EVENT" | "CONCEPT",
    { icon: React.ComponentType<{ className?: string }>; label: string }
  > = {
    PERSON: { icon: User, label: "人物" },
    ORG: { icon: Building2, label: "机构" },
    TECH: { icon: Cpu, label: "技术" },
    LOCATION: { icon: MapPin, label: "地点" },
    PRODUCT: { icon: Cpu, label: "产品" },
    EVENT: { icon: MessageSquarePlus, label: "事件" },
    CONCEPT: { icon: FileText, label: "概念" },
  };
  const showFeedbackActions = Boolean(onFeedbackVote || onFeedbackNote);
  return (
    <Card
      className={cn(
        "h-full border-border/80 bg-card/95 shadow-sm backdrop-blur-sm flex flex-col gap-0 py-0",
        className
      )}
    >
      <CardHeader className="flex-shrink-0 space-y-2 px-6 pt-4 pb-1 lg:px-8 lg:pt-5 lg:pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {source ? <Badge variant="secondary">{source}</Badge> : null}
              {author ? <Badge variant="outline">作者: {author}</Badge> : null}
              {publishedAt ? (
                <Badge variant="outline">
                  时间: {new Date(publishedAt).toLocaleString()}
                </Badge>
              ) : null}
            </div>
            {subjectMatch ? (
              <div className="flex flex-wrap items-center gap-2">
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
                <Badge variant="secondary">
                  相关度:{" "}
                  {typeof subjectMatch.score === "number"
                    ? subjectMatch.score.toFixed(2)
                    : "N/A"}
                </Badge>
                <Badge variant="outline">{subjectMatch.matchSource}</Badge>
              </div>
            ) : null}
            {typeof relevanceScore === "number" ? (
              <div className="flex items-center gap-2">
                <Badge variant="secondary">
                  🎓 相关度: {Math.max(0, Math.min(100, Math.round(relevanceScore * 100)))}%
                </Badge>
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1 self-start">
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
        {onGenerateSummary ? (
          <div className="space-y-2 pt-1">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={Boolean(summaryGenerating)}
                onClick={(event) => {
                  event.stopPropagation();
                  onGenerateSummary();
                }}
              >
                <Sparkles className="size-3.5" />
                {summary ? "重新总结" : "AI总结"}
              </Button>
              {summaryUpdatedAt ? (
                <span className="text-xs text-muted-foreground">
                  更新时间: {new Date(summaryUpdatedAt).toLocaleString()}
                </span>
              ) : null}
            </div>
            {summary ? (
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground/90">
                {summary}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                暂无摘要，点击 AI总结 生成长文摘要
              </p>
            )}
          </div>
        ) : (
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground/90 line-clamp-2">
            {summary || title || "News Summary"}
          </p>
        )}
        {expandableKeywords?.length ? (
          <div className="space-y-2 pt-1">
            <p className="text-xs font-medium text-muted-foreground">🔍 可拓展关键词</p>
            <div className="flex flex-wrap gap-2">
              {expandableKeywords.slice(0, 8).map((keyword, index) => {
                const meta = keywordTagMeta[keyword.category];
                const Icon = meta.icon;
                return (
                  <Badge
                    key={`${keyword.category}-${keyword.label}-${index}`}
                    variant="outline"
                    className="flex items-center gap-1.5"
                  >
                    <Icon className="size-3" />
                    <span>{keyword.label}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-4 w-4 p-0"
                      onClick={(event) => {
                        event.stopPropagation();
                        onAddKeyword?.(keyword);
                      }}
                    >
                      <Plus className="size-3" />
                    </Button>
                  </Badge>
                );
              })}
            </div>
          </div>
        ) : null}
        {showFeedbackActions ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              size="sm"
              variant={feedback?.vote === "UP" ? "default" : "outline"}
              onClick={(event) => {
                event.stopPropagation();
                onFeedbackVote?.("UP");
              }}
            >
              <ThumbsUp className="size-3.5" />
              相关
            </Button>
            <Button
              size="sm"
              variant={feedback?.vote === "DOWN" ? "destructive" : "outline"}
              onClick={(event) => {
                event.stopPropagation();
                onFeedbackVote?.("DOWN");
              }}
            >
              <ThumbsDown className="size-3.5" />
              无关
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={(event) => {
                event.stopPropagation();
                onFeedbackNote?.();
              }}
            >
              <MessageSquarePlus className="size-3.5" />
              备注
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-6 pb-4 pt-2 lg:px-8">
        <Tabs defaultValue="content" className="h-full gap-2">
          <div className="mx-auto flex h-full w-full max-w-4xl flex-col">
            <TabsList className="w-full justify-start bg-muted/70 p-1">
              <TabsTrigger value="content">正文</TabsTrigger>
              <TabsTrigger value="media">媒体</TabsTrigger>
              <TabsTrigger value="links">链接</TabsTrigger>
              <TabsTrigger value="raw">原始</TabsTrigger>
            </TabsList>
            <TabsContent value="content" className="mt-3">
              <article className="prose prose-slate max-w-none text-[15px] leading-7 text-foreground/90 prose-p:my-0 prose-p:leading-7 prose-p:text-foreground/90 prose-headings:mb-3 prose-headings:mt-5 prose-headings:font-semibold prose-headings:text-foreground prose-li:my-1 prose-li:text-foreground/90 prose-strong:text-foreground prose-a:text-primary prose-a:no-underline hover:prose-a:underline">
                <ReactMarkdown>{markdown}</ReactMarkdown>
              </article>
            </TabsContent>
            <TabsContent value="media" className="mt-3">
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
            <TabsContent value="links" className="mt-3">
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
            <TabsContent value="raw" className="mt-3">
              <pre className="max-h-[22rem] overflow-auto rounded-lg border border-border/70 bg-muted/20 p-4 text-xs leading-5">
                {JSON.stringify(rawContent ?? {}, null, 2)}
              </pre>
            </TabsContent>
          </div>
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default NewsDetailCard;
