"use client";

import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { FileText, Calendar, Hash } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { KnowledgeItem } from "@/hooks/useKnowledge";

interface KnowledgeDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  knowledge: KnowledgeItem | null;
}

/**
 * 知识库详情对话框
 * 显示知识库的文件列表、切片统计等信息
 */
export const KnowledgeDetailDialog: React.FC<KnowledgeDetailDialogProps> = ({
  open,
  onOpenChange,
  knowledge,
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{knowledge?.name || "知识库详情"}</DialogTitle>
          <DialogDescription>
            {knowledge?.description || "查看知识库的详细信息"}
          </DialogDescription>
        </DialogHeader>

        {knowledge ? (
          <div className="space-y-6">
            {/* 基本信息 */}
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold mb-2">基本信息</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm text-muted-foreground">文件数量</p>
                      <p className="text-lg font-semibold">
                        {knowledge.fileCount}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Hash className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm text-muted-foreground">切片数量</p>
                      <p className="text-lg font-semibold">
                        {knowledge.chunkCount}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {knowledge.description && (
                <div>
                  <h3 className="text-sm font-semibold mb-2">描述</h3>
                  <p className="text-sm text-muted-foreground">
                    {knowledge.description}
                  </p>
                </div>
              )}

              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  <span>
                    创建于{" "}
                    {new Date(knowledge.createdAt).toLocaleString("zh-CN")}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  <span>
                    更新于{" "}
                    {new Date(knowledge.updatedAt).toLocaleString("zh-CN")}
                  </span>
                </div>
              </div>
            </div>

            {/* 使用提示 */}
            <div className="border-t pt-4">
              <h3 className="text-sm font-semibold mb-2">使用说明</h3>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  • 此知识库包含 {knowledge.chunkCount} 个向量化切片，可用于 RAG
                  检索
                </p>
                <p>
                  • 在报告编辑器中选择此知识库后，LLM
                  会自动检索相关内容来增强报告
                </p>
                <p>
                  • 切片数量越多，检索到的相关内容越丰富，但也会增加生成时间
                </p>
              </div>
            </div>

            {/* TODO: 未来可以添加文件列表和切片预览 */}
            {knowledge.fileCount > 0 && (
              <div className="border-t pt-4">
                <h3 className="text-sm font-semibold mb-2">文件列表</h3>
                <p className="text-sm text-muted-foreground">
                  文件列表功能开发中...
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
