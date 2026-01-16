"use client";

import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface MarkdownRendererProps {
  content: string;
  className?: string;
  clampLines?: number;
  collapsible?: boolean;
}

export function MarkdownRenderer({
  content,
  className,
  clampLines,
  collapsible = false,
}: MarkdownRendererProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const shouldClamp = clampLines && clampLines > 0 && collapsible;
  const isClamped = shouldClamp && !isExpanded;

  return (
    <div className={cn("space-y-2", className)}>
      <div
        className={cn(
          "prose prose-sm max-w-none dark:prose-invert",
          "prose-headings:font-semibold prose-headings:text-foreground",
          "prose-p:text-muted-foreground prose-p:leading-relaxed",
          "prose-a:text-primary prose-a:no-underline hover:prose-a:underline",
          "prose-strong:text-foreground prose-strong:font-semibold",
          "prose-code:text-foreground prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-sm",
          "prose-pre:bg-muted prose-pre:border prose-pre:border-border",
          "prose-blockquote:border-l-4 prose-blockquote:border-primary prose-blockquote:bg-muted/50 prose-blockquote:pl-4 prose-blockquote:italic",
          "prose-ul:list-disc prose-ol:list-decimal",
          "prose-table:border-collapse prose-table:w-full",
          "prose-th:border prose-th:border-border prose-th:bg-muted prose-th:p-2 prose-th:text-left prose-th:font-semibold",
          "prose-td:border prose-td:border-border prose-td:p-2",
          isClamped && "overflow-hidden"
        )}
        style={
          isClamped
            ? {
                display: "-webkit-box",
                WebkitLineClamp: clampLines,
                WebkitBoxOrient: "vertical",
              }
            : undefined
        }
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ node, href, children, ...props }) => {
              // 安全检查：过滤危险协议
              const isSafe =
                href &&
                !href.startsWith("javascript:") &&
                !href.startsWith("data:") &&
                !href.startsWith("vbscript:");

              if (!isSafe) {
                return <span {...props}>{children}</span>;
              }

              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  {...props}
                >
                  {children}
                </a>
              );
            },
            // 禁用危险标签
            script: () => null,
            iframe: () => null,
            style: () => null,
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
      {shouldClamp && (
        <Button
          variant="link"
          size="sm"
          onClick={() => setIsExpanded(!isExpanded)}
          className="h-auto p-0 text-xs"
        >
          {isExpanded ? "收起" : "展开"}
        </Button>
      )}
    </div>
  );
}

