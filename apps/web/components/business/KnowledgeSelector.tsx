"use client";

import React, { useState } from "react";
import { useKnowledge } from "@/hooks/useKnowledge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface KnowledgeSelectorProps {
  value?: string[];
  onChange?: (knowledgeIds: string[]) => void;
  maxSelection?: number;
  className?: string;
  placeholder?: string;
}

/**
 * 知识库选择器组件
 * 用于报告编辑模块选择知识库
 */
export const KnowledgeSelector: React.FC<KnowledgeSelectorProps> = ({
  value = [],
  onChange,
  maxSelection,
  className,
  placeholder = "选择知识库（可选）",
}) => {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useKnowledge({ limit: 50 });

  const selectedKnowledge = React.useMemo(() => {
    if (!data?.items || !value.length) return [];
    return data.items.filter((kb) => value.includes(kb.id));
  }, [data?.items, value]);

  const availableKnowledge = React.useMemo(() => {
    if (!data?.items) return [];
    return data.items.filter((kb) => !value.includes(kb.id));
  }, [data?.items, value]);

  const handleSelect = (knowledgeId: string) => {
    if (maxSelection && value.length >= maxSelection) {
      return;
    }
    if (!value.includes(knowledgeId)) {
      onChange?.(value.concat(knowledgeId));
    }
  };

  const handleRemove = (knowledgeId: string) => {
    onChange?.(value.filter((id) => id !== knowledgeId));
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2 flex-wrap">
        {selectedKnowledge.map((kb) => (
          <Badge
            key={kb.id}
            variant="secondary"
            className="flex items-center gap-1 pr-1"
          >
            <span className="truncate max-w-[200px]">{kb.name}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-4 w-4 rounded-full hover:bg-destructive hover:text-destructive-foreground"
              onClick={() => handleRemove(kb.id)}
              aria-label={`移除 ${kb.name}`}
            >
              <X className="h-3 w-3" />
            </Button>
          </Badge>
        ))}
        {(!maxSelection || value.length < maxSelection) &&
          (isLoading || availableKnowledge.length > 0) && (
            <Select
              open={open}
              onOpenChange={setOpen}
              onValueChange={handleSelect}
              value=""
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue
                  placeholder={isLoading ? "加载中..." : placeholder}
                />
              </SelectTrigger>
              <SelectContent>
                {isLoading ? (
                  <div className="flex items-center justify-center p-4">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : availableKnowledge.length === 0 ? (
                  <div className="p-4 text-sm text-muted-foreground text-center">
                    暂无知识库
                  </div>
                ) : (
                  availableKnowledge.map((kb) => (
                    <SelectItem key={kb.id} value={kb.id}>
                      <div className="flex items-center gap-2">
                        <span>{kb.name}</span>
                        {kb.chunkCount > 0 && (
                          <Badge variant="outline" className="text-xs">
                            {kb.chunkCount} 切片
                          </Badge>
                        )}
                      </div>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          )}
      </div>
      {maxSelection && value.length >= maxSelection && (
        <p className="text-xs text-muted-foreground">
          最多可选择 {maxSelection} 个知识库
        </p>
      )}
      {selectedKnowledge.length > 0 && (
        <p className="text-xs text-muted-foreground">
          已选择 {selectedKnowledge.length} 个知识库，共{" "}
          {selectedKnowledge.reduce((sum, kb) => sum + kb.chunkCount, 0)} 个切片
        </p>
      )}
    </div>
  );
};
