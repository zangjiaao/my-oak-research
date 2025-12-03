import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Trash2, Edit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { KnowledgeItem } from "@/hooks/useKnowledge";

export interface KnowledgeCardProps {
  knowledge: KnowledgeItem;
  onEdit?: (knowledge: KnowledgeItem) => void;
  onDelete?: (knowledge: KnowledgeItem) => void;
  onClick?: (knowledge: KnowledgeItem) => void;
  className?: string;
}

export const KnowledgeCard: React.FC<KnowledgeCardProps> = ({
  knowledge,
  onEdit,
  onDelete,
  onClick,
  className,
}) => {
  return (
    <Card
      className={cn(
        "rounded-2xl shadow-md hover:shadow-lg transition-shadow duration-200 cursor-pointer h-full flex flex-col",
        className
      )}
      onClick={() => onClick?.(knowledge)}
    >
      <CardHeader className="flex-shrink-0">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-lg font-semibold line-clamp-2 flex-1">
            {knowledge.name}
          </CardTitle>
          <div className="flex gap-1 flex-shrink-0">
            {onEdit && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(knowledge);
                }}
                aria-label="编辑知识库"
              >
                <Edit className="h-4 w-4" />
              </Button>
            )}
            {onDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(knowledge);
                }}
                aria-label="删除知识库"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-3">
        {knowledge.description && (
          <p className="text-sm text-muted-foreground line-clamp-3 flex-shrink-0">
            {knowledge.description}
          </p>
        )}
        <div className="flex items-center gap-4 text-xs text-muted-foreground mt-auto">
          <div className="flex items-center gap-1">
            <FileText className="h-3 w-3" />
            <span>{knowledge.fileCount} 个文件</span>
          </div>
          <Badge variant="secondary" className="text-xs">
            {knowledge.chunkCount} 个切片
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground">
          更新于 {new Date(knowledge.updatedAt).toLocaleDateString("zh-CN")}
        </div>
      </CardContent>
    </Card>
  );
};
