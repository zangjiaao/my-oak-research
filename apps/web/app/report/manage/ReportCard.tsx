import * as React from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const statusLabels: Record<ReportCardProps["status"], string> = {
  DRAFT: "草稿",
  REVIEW: "审核中",
  PUBLISHED: "已发布",
};

const statusVariants: Record<ReportCardProps["status"], "default" | "secondary" | "outline"> =
  {
    DRAFT: "secondary",
    REVIEW: "default",
    PUBLISHED: "outline",
  };

interface ReportCardProps {
  id: string;
  title: string;
  summary?: string | null;
  status: "DRAFT" | "REVIEW" | "PUBLISHED";
  updatedAt: string;
  templateName?: string | null;
  materialsCount?: number;
  version?: number;
}

const formatDate = (value: string) => {
  try {
    const date = new Date(value);
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return value;
  }
};

const ReportCard = ({
  id,
  title,
  summary,
  status,
  updatedAt,
  templateName,
  materialsCount = 0,
  version,
}: ReportCardProps) => {
  return (
    <Card className="flex h-full flex-col">
      <CardContent className="flex flex-1 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-lg font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground">
            {templateName ?? "未选模板"} · {formatDate(updatedAt)} · v
            {version ?? 1}
          </p>
        </div>
        <div className="text-sm text-muted-foreground line-clamp-3">
          {summary ?? "暂无摘要，尝试再次生成草稿即可补全。"}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={statusVariants[status]}>{statusLabels[status]}</Badge>
          <Badge variant="outline">{materialsCount} 个素材</Badge>
        </div>
        <div className="mt-auto flex items-center justify-between pt-2">
          <span className="text-xs text-muted-foreground">
            更新时间 · {formatDate(updatedAt)}
          </span>
          <Button asChild variant="outline" size="sm">
            <Link href={`/report/editor?reportId=${id}`}>继续编辑</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default ReportCard;
