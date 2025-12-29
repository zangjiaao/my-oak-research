"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { MarkdownRenderer } from "@/components/ui/markdown/MarkdownRenderer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import Link from "next/link";
import { toast } from "sonner";
import React from "react";

interface ReportDetailDialogProps {
  reportId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ReportDetail = {
  id: string;
  title: string;
  summary?: string | null;
  markdown?: string | null;
  status: "DRAFT" | "REVIEW" | "PUBLISHED";
  version?: number;
  updatedAt: string;
  template?: {
    name?: string | null;
  } | null;
  materials?: { id: string }[];
};

const statusLabels: Record<ReportDetail["status"], string> = {
  DRAFT: "草稿",
  REVIEW: "审核中",
  PUBLISHED: "已发布",
};

const statusVariants: Record<
  ReportDetail["status"],
  "default" | "secondary" | "outline"
> = {
  DRAFT: "secondary",
  REVIEW: "default",
  PUBLISHED: "outline",
};

const formatDate = (value: string) => {
  try {
    const date = new Date(value);
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return value;
  }
};

const fetchReportDetail = async (id: string): Promise<ReportDetail> => {
  const response = await fetch(`/api/report-writer/reports/${id}`);
  const payload = await response.json();
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.error?.message ?? "无法加载报告详情");
  }
  return payload.data;
};

export function ReportDetailDialog({
  reportId,
  open,
  onOpenChange,
}: ReportDetailDialogProps) {
  const queryClient = useQueryClient();
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);

  const { data: report, isLoading, error } = useQuery({
    queryKey: ["report-detail", reportId],
    queryFn: () => fetchReportDetail(reportId!),
    enabled: open && !!reportId,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/report-writer/reports/${id}`, {
        method: "DELETE",
      });
      const payload = await response.json();
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error?.message ?? "删除报告失败");
      }
      return payload.data;
    },
    onSuccess: () => {
      toast.success("报告已成功删除");
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(error.message);
    },
    onSettled: () => {
      setIsDeleting(false);
    },
  });

  const handleDelete = () => {
    if (!reportId) return;
    setIsDeleting(true);
    deleteMutation.mutate(reportId);
    setShowDeleteConfirm(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[90vh] max-h-[90vh] flex flex-col p-0 overflow-hidden">
        <div className="flex-shrink-0 px-6 pt-6 pb-4">
          <DialogHeader>
            <DialogTitle className="text-xl">
              {isLoading ? (
                <Skeleton className="h-6 w-64" />
              ) : report ? (
                report.title
              ) : (
                "报告详情"
              )}
            </DialogTitle>
            {isLoading ? (
              <div className="mt-2">
                <Skeleton className="h-4 w-48" />
              </div>
            ) : report ? (
              <DialogDescription asChild>
                <div className="text-muted-foreground text-sm mt-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={statusVariants[report.status]}>
                      {statusLabels[report.status]}
                    </Badge>
                    {report.template?.name && (
                      <span className="text-xs text-muted-foreground">
                        {report.template.name}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      v{report.version ?? 1}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(report.updatedAt)}
                    </span>
                    {report.materials && report.materials.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {report.materials.length} 个素材
                      </span>
                    )}
                  </div>
                </div>
              </DialogDescription>
            ) : null}
          </DialogHeader>
        </div>

        <Separator />

        <div className="flex-1 min-h-0 overflow-hidden">
          <ScrollArea className="h-full px-6">
            <div className="py-4">
              {isLoading ? (
                <div className="space-y-4">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                </div>
              ) : error ? (
                <div className="py-8 text-center text-sm text-destructive">
                  {error instanceof Error ? error.message : "加载失败"}
                </div>
              ) : report ? (
                <div className="space-y-6">
                  {report.summary && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold text-muted-foreground">
                        摘要
                      </h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {report.summary}
                      </p>
                    </div>
                  )}

                  {report.markdown ? (
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold text-muted-foreground">
                        正文
                      </h3>
                      <MarkdownRenderer content={report.markdown} />
                    </div>
                  ) : (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      暂无内容
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </ScrollArea>
        </div>

        <Separator />

        <div className="flex-shrink-0 flex items-center justify-between px-6 py-4">
          <div className="text-xs text-muted-foreground">
            {report && `更新时间：${formatDate(report.updatedAt)}`}
          </div>
          <div className="flex items-center gap-2">
            {report && (
              <>
                <div onClick={(e) => e.stopPropagation()}>
                  <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setShowDeleteConfirm(true)}
                      disabled={isDeleting}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      删除
                    </Button>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>确定要删除这份报告吗？</AlertDialogTitle>
                        <AlertDialogDescription>
                          此操作无法撤销，该报告的所有内容、摘要以及关联的素材引用将被永久删除。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleDelete}
                          className="bg-destructive text-white hover:bg-destructive/90"
                        >
                          确认删除
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/report/editor?reportId=${report.id}`}>
                    <FileText className="mr-2 h-4 w-4" />
                    继续编辑
                  </Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

