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
import { Button } from "@/components/ui/button";
import { apiFetcher } from "@/lib/fetcher";
import { toast } from "sonner";
import { FileText, Calendar, Hash, Download, Trash2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { KnowledgeItem } from "@/hooks/useKnowledge";

type KnowledgeDetailFile = {
  id: string;
  name: string;
  mimeType: string | null;
  size: number | null;
  createdAt: string;
};

type KnowledgeDetail = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  files: KnowledgeDetailFile[];
  chunks: unknown[];
  chunkCount: number;
};

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
  const [detail, setDetail] = React.useState<KnowledgeDetail | null>(null);
  const [loadingFiles, setLoadingFiles] = React.useState(false);
  const [downloadingFile, setDownloadingFile] = React.useState<string | null>(
    null
  );
  const [deletingFile, setDeletingFile] = React.useState<string | null>(null);
  const fetchIdRef = React.useRef(0);

  const formatFileSize = (size?: number | null) => {
    if (typeof size !== "number") return "-";
    if (size < 1024) return `${size} B`;
    const units = ["B", "KB", "MB", "GB"];
    let value = size;
    let idx = 0;
    while (value >= 1024 && idx < units.length - 1) {
      value /= 1024;
      idx += 1;
    }
    return `${value.toFixed(2)} ${units[idx]}`;
  };

  const fetchDetail = React.useCallback(async () => {
    if (!knowledge?.id) return;
    const currentFetchId = ++fetchIdRef.current;
    setLoadingFiles(true);

    try {
      const payload = (await apiFetcher(
        `/api/library/knowledge/${knowledge.id}`
      )) as KnowledgeDetail;
      if (fetchIdRef.current !== currentFetchId) return;
      setDetail(payload);
    } catch (error) {
      if (fetchIdRef.current !== currentFetchId) return;
      toast.error(
        (error as { message?: string })?.message || "加载知识库详情失败"
      );
    } finally {
      if (fetchIdRef.current === currentFetchId) {
        setLoadingFiles(false);
      }
    }
  }, [knowledge?.id]);

  const handleDownloadFile = async (fileId: string) => {
    if (!knowledge?.id) return;
    setDownloadingFile(fileId);
    try {
      const result = await apiFetcher(
        `/api/library/knowledge/${knowledge.id}/files/${fileId}`
      );
      const anchor = document.createElement("a");
      anchor.href = result.url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.click();
    } catch (error) {
      toast.error(
        (error as { message?: string })?.message || "下载文件失败"
      );
    } finally {
      setDownloadingFile((prev) => (prev === fileId ? null : prev));
    }
  };

  const handleDeleteFile = async (fileId: string) => {
    if (!knowledge?.id) return;
    setDeletingFile(fileId);
    try {
      await apiFetcher(
        `/api/library/knowledge/${knowledge.id}/files/${fileId}`,
        {
          method: "DELETE",
        }
      );
      setDetail((prev) =>
        prev ? { ...prev, files: prev.files.filter((file) => file.id !== fileId) } : prev
      );
      toast.success("文件已删除");
    } catch (error) {
      toast.error(
        (error as { message?: string })?.message || "删除文件失败"
      );
    } finally {
      setDeletingFile((prev) => (prev === fileId ? null : prev));
    }
  };

  React.useEffect(() => {
    if (!open) {
      setDetail(null);
      setLoadingFiles(false);
      return;
    }
    if (knowledge?.id) {
      void fetchDetail();
    }
  }, [open, knowledge?.id, fetchDetail]);

  const formatTimestamp = (value: string) =>
    new Date(value).toLocaleString("zh-CN");

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

            <div className="border-t pt-4 space-y-4">
              <h3 className="text-sm font-semibold">文件列表</h3>
              {loadingFiles ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : detail?.files?.length ? (
                <div className="space-y-2">
                  {detail.files.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center justify-between gap-4 rounded-2xl border bg-background/40 px-3 py-2"
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-medium text-foreground">
                          {file.name}
                        </p>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                          <span>{formatFileSize(file.size)}</span>
                          <span>上传于 {formatTimestamp(file.createdAt)}</span>
                          {file.mimeType && (
                            <Badge variant="outline">{file.mimeType}</Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDownloadFile(file.id)}
                          disabled={downloadingFile === file.id}
                          aria-label="下载文件"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteFile(file.id)}
                          disabled={deletingFile === file.id}
                          className="text-destructive"
                          aria-label="删除文件"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  暂未上传文件，完成上传后可在此查看
                </p>
              )}
            </div>
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
