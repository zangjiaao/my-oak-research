import React, { useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import {
  Bookmark,
  Building2,
  Cpu,
  FileText,
  Link as LinkIcon,
  MapPin,
  MessageSquarePlus,
  Plus,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";

const NewsDetailCard = ({
  title,
  summary,
  cleanMarkdown,
  rawText,
  url,
  metaData,
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
  onRewrite,
  rewriting,
  onSaveMaterial,
  savingMaterial,
  onRefresh,
  refreshing,
}: {
  title?: string;
  summary?: string;
  cleanMarkdown?: string;
  rawText?: string;
  url?: string | null;
  metaData?: Record<string, unknown>;
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
    source?: "AI" | "RULE";
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
  onRewrite?: () => void;
  rewriting?: boolean;
  onSaveMaterial?: (content: string) => Promise<void> | void;
  savingMaterial?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
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
  const aiKeywordCount = (expandableKeywords ?? []).filter(
    (keyword) => keyword.source === "AI"
  ).length;
  const rewrittenMarkdown = (cleanMarkdown ?? "").trim();
  const originalText = (rawText ?? "").trim();
  const contentText = rewrittenMarkdown || originalText;
  const [activeTab, setActiveTab] = useState("content");
  const [editingContent, setEditingContent] = useState(false);
  const [draftContent, setDraftContent] = useState(contentText);
  useEffect(() => {
    if (!editingContent) {
      setDraftContent(contentText);
    }
  }, [contentText, editingContent]);
  const sourceData = useMemo(
    () =>
      JSON.stringify(
        {
          url: url ?? null,
          links: links ?? [],
          meta: metaData ?? null,
          raw: rawContent ?? null,
        },
        null,
        2
      ),
    [url, links, metaData, rawContent]
  );
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
            <h3 className="line-clamp-2 text-base font-semibold leading-6 text-foreground">
              {title?.trim() || "未命名内容"}
            </h3>
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
                  匹配度:{" "}
                  {typeof subjectMatch.score === "number"
                    ? subjectMatch.score.toFixed(2)
                    : "N/A"}
                </Badge>
                <Badge variant="outline">{subjectMatch.matchSource}</Badge>
              </div>
            ) : null}
            {typeof relevanceScore === "number" ? (
              <Badge variant="secondary">
                匹配度: {Math.max(0, Math.min(100, Math.round(relevanceScore * 100)))}%
              </Badge>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1 self-start">
            {onRefresh ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full"
                disabled={Boolean(refreshing)}
                onClick={(event) => {
                  event.stopPropagation();
                  onRefresh();
                }}
                aria-label={refreshing ? "刷新中" : "刷新"}
                title={refreshing ? "刷新中..." : "刷新摘要与拓展词"}
              >
                <RefreshCw className={cn("size-4", refreshing ? "animate-spin" : "")} />
              </Button>
            ) : null}
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
        {summary ? (
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground/90">
            {summary}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            暂无摘要
          </p>
        )}
        {expandableKeywords?.length ? (
          <div className="space-y-2 pt-1">
            <div className="flex items-center gap-2">
              <p className="text-xs font-medium text-muted-foreground">可拓展关键词</p>
              {aiKeywordCount > 0 ? (
                <Badge
                  variant="secondary"
                  className="h-5 border-violet-200 bg-violet-100 text-[10px] text-violet-800 dark:border-violet-500/40 dark:bg-violet-500/20 dark:text-violet-200"
                >
                  AI精选 {aiKeywordCount}
                </Badge>
              ) : null}
            </div>
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
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="h-full gap-2"
        >
          <div className="mx-auto flex h-full w-full max-w-4xl flex-col">
            <TabsList className="w-full justify-start bg-muted/70 p-1">
              <TabsTrigger value="content">内容</TabsTrigger>
              <TabsTrigger value="raw">原文</TabsTrigger>
              <TabsTrigger value="source">源数据</TabsTrigger>
            </TabsList>
            <TabsContent value="content" className="mt-3 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {onRewrite ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRewrite();
                    }}
                    disabled={Boolean(rewriting) || Boolean(savingMaterial)}
                  >
                    {rewriting ? "获取中..." : "Jina丰富化"}
                  </Button>
                ) : null}
                {editingContent ? (
                  <>
                    <Button
                      size="sm"
                      onClick={async (event) => {
                        event.stopPropagation();
                        if (!onSaveMaterial) return;
                        try {
                          await onSaveMaterial(draftContent);
                          setEditingContent(false);
                        } catch {
                          // errors are handled by caller
                        }
                      }}
                      disabled={Boolean(savingMaterial)}
                    >
                      {savingMaterial ? "保存中..." : "保存"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(event) => {
                        event.stopPropagation();
                        setEditingContent(false);
                        setDraftContent(contentText);
                      }}
                      disabled={Boolean(savingMaterial)}
                    >
                      取消
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(event) => {
                      event.stopPropagation();
                      setEditingContent(true);
                    }}
                    disabled={Boolean(savingMaterial)}
                  >
                    编辑
                  </Button>
                )}
              </div>
              {editingContent ? (
                <Textarea
                  value={draftContent}
                  onChange={(event) => setDraftContent(event.target.value)}
                  rows={16}
                  className="min-h-[22rem] text-sm leading-6"
                  placeholder="可编辑内容为空，可点击 Jina丰富化 或手动粘贴内容后保存"
                />
              ) : (
                <pre className="max-h-[22rem] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/70 bg-muted/20 p-4 text-sm leading-6">
                  {contentText || "暂无内容，可点击 Jina丰富化 或切换到原文查看"}
                </pre>
              )}
            </TabsContent>
            <TabsContent value="raw" className="mt-3">
              <pre className="max-h-[22rem] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/70 bg-muted/20 p-4 text-xs leading-5">
                {originalText || "暂无原文"}
              </pre>
            </TabsContent>
            <TabsContent value="source" className="mt-3 space-y-3">
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-blue-600 hover:underline"
                >
                  <LinkIcon className="size-4" />
                  {url}
                </a>
              ) : (
                <p className="text-sm text-muted-foreground">暂无链接</p>
              )}
              <pre className="max-h-[22rem] overflow-auto rounded-lg border border-border/70 bg-muted/20 p-4 text-xs leading-5">
                {sourceData}
              </pre>
            </TabsContent>
          </div>
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default NewsDetailCard;
