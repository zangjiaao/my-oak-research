"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ReportCard from "./ReportCard";
import { ReportDetailDialog } from "./ReportDetailDialog";
import { Search, Plus } from "lucide-react";

const STATUS_OPTIONS = [
  { value: "ALL", label: "全部状态" },
  { value: "DRAFT", label: "草稿" },
  { value: "REVIEW", label: "审核中" },
  { value: "PUBLISHED", label: "已发布" },
] as const;

const PAGE_SIZE = 12;

type ReportStatus = "DRAFT" | "REVIEW" | "PUBLISHED";

type ReportItem = {
  id: string;
  title: string;
  summary?: string | null;
  status: ReportStatus;
  updatedAt: string;
  template?: {
    name?: string | null;
  } | null;
  materials?: { id: string }[];
  version?: number;
};

type ReportsResponse = {
  data: ReportItem[];
  meta: { total: number; page: number; pageSize: number };
};

const fetchReports = async (statusFilter: string, page: number) => {
  const params = new URLSearchParams({
    page: page.toString(),
    pageSize: PAGE_SIZE.toString(),
  });
  if (statusFilter !== "ALL") {
    params.set("status", statusFilter);
  }
  const response = await fetch(`/api/report-writer/reports?${params}`);
  const payload = await response.json();
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.error?.message ?? "无法加载报告列表");
  }
  return payload as {
    success: true;
    data: ReportItem[];
    meta: ReportsResponse["meta"];
  };
};

const ReportManage = () => {
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ["reports", statusFilter, page],
    queryFn: () => fetchReports(statusFilter, page),
    placeholderData: keepPreviousData,
  });

  const reports = data?.data ?? [];
  const filteredReports = useMemo(() => {
    if (!searchTerm.trim()) return reports;
    const normalized = searchTerm.trim().toLowerCase();
    return reports.filter((report) => {
      return (
        report.title.toLowerCase().includes(normalized) ||
        report.summary?.toLowerCase().includes(normalized)
      );
    });
  }, [reports, searchTerm]);

  const total = data?.meta?.total ?? 0;
  const currentPageSize = data?.meta?.pageSize ?? PAGE_SIZE;
  const currentPage = data?.meta?.page ?? page;
  const canPrev = currentPage > 1;
  const canNext = currentPage * currentPageSize < total;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-col gap-3 lg:flex-row lg:items-center">
          <Input
            placeholder="按标题或摘要搜索报告"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            icon={<Search size={16} />}
          />
          <Select
            value={statusFilter}
            onValueChange={(value) => {
              setStatusFilter(value);
              setPage(1);
            }}
          >
            <SelectTrigger size="sm" className="min-w-[10rem]">
              <SelectValue placeholder="状态筛选" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="secondary">
            <Link href="/report/editor" className="flex items-center gap-2">
              <Plus className="size-4" />
              新建报告
            </Link>
          </Button>
          {isFetching && !isLoading && (
            <span className="text-xs text-muted-foreground">正在更新…</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isError && (
          <p className="text-sm text-destructive">
            {error instanceof Error ? error.message : "报告列表加载失败"}
          </p>
        )}
        {isLoading ? (
          Array.from({ length: 6 }).map((_, index) => (
            <div
              key={`skeleton-${index}`}
              className="h-48 rounded-2xl border border-dashed border-border bg-muted/40 animate-pulse"
            />
          ))
        ) : filteredReports.length > 0 ? (
          filteredReports.map((report) => (
            <ReportCard
              key={report.id}
              id={report.id}
              title={report.title}
              summary={report.summary}
              status={report.status}
              updatedAt={report.updatedAt}
              templateName={report.template?.name ?? undefined}
              materialsCount={report.materials?.length ?? 0}
              version={report.version}
              onView={(id) => {
                setSelectedReportId(id);
                setDialogOpen(true);
              }}
            />
          ))
        ) : (
          <div className="col-span-full rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {reports.length === 0
              ? "尚未创建报告，可以点击“新建报告”或在写作区快速生成。"
              : "当前搜索/筛选条件下没有匹配项。"}
          </div>
        )}
      </div>

      <ReportDetailDialog
        reportId={selectedReportId}
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setSelectedReportId(null);
          }
        }}
      />
    </div>
  );
};

export default ReportManage;
