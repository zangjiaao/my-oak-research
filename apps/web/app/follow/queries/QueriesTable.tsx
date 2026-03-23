"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { PencilIcon, TrashIcon, PlayIcon } from "lucide-react";
import { Progress } from "@/components/ui";
import { Switch } from "@/components/ui/switch";
import { Keyword, Source } from "@/app/generated/prisma";
import { QueryWithAggregations } from "@/lib/types";
import {
  DataTable,
  DataTableColumn,
  DataTableAction,
} from "@/components/common";
import { toast } from "sonner";
import QueryDialog from "./QueryDialog";
import QueryDeleteAlert from "./QueryDeleteAlert";

interface Props {
  queries: QueryWithAggregations[];
  keywords: Keyword[];
  sources: Source[];
}

const QueriesTable = ({ queries, keywords, sources }: Props) => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [progressMap, setProgressMap] = useState<
    Record<string, { progress: number; status?: string }>
  >({});
  const [runningMap, setRunningMap] = useState<Record<string, boolean>>({});
  const [togglingMap, setTogglingMap] = useState<Record<string, boolean>>({});
  const [editingQuery, setEditingQuery] = useState<
    QueryWithAggregations | undefined
  >();
  const [dialogOpen, setDialogOpen] = useState(false);
  const closeTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleEdit = (query: QueryWithAggregations) => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setEditingQuery(query);
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    closeTimerRef.current = setTimeout(() => {
      setEditingQuery(undefined);
      closeTimerRef.current = null;
    }, 220);
  };

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const handleToggleEnabled = async (query: QueryWithAggregations, enabled: boolean) => {
    const previousQueries =
      queryClient.getQueryData<QueryWithAggregations[]>(["queries"]) ?? [];
    setTogglingMap((prev) => ({ ...prev, [query.id]: true }));
    queryClient.setQueryData<QueryWithAggregations[]>(["queries"], (current) =>
      (current ?? []).map((item) =>
        item.id === query.id ? { ...item, enabled } : item
      )
    );
    try {
      const response = await fetch(`/api/follow/queries/${query.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) {
        let message = "";
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          const payload = (await response.json()) as { error?: string; message?: string };
          message = payload.error || payload.message || "";
        } else {
          message = (await response.text()).trim();
        }
        throw new Error(message || "Failed to update query status");
      }
      toast.success(enabled ? "Task enabled" : "Task paused");
      queryClient.invalidateQueries({ queryKey: ["queries"] });
    } catch (error) {
      queryClient.setQueryData<QueryWithAggregations[]>(
        ["queries"],
        previousQueries
      );
      toast.error(error instanceof Error ? error.message : "Failed to update query status");
    } finally {
      setTogglingMap((prev) => ({ ...prev, [query.id]: false }));
    }
  };

  const columns: DataTableColumn<QueryWithAggregations>[] = [
    {
      key: "name",
      label: "Name",
      render: (query) => query.name,
    },
    {
      key: "progress",
      label: "Progress",
      className: "w-36 text-center",
      render: (query) => {
        const runtime = progressMap[query.id];
        const latestRun = query.latestRun;
        const percent = runtime ? runtime.progress : (latestRun?.progress ?? 0);
        return (
          <div className="mx-auto w-24">
            <Progress value={Math.min(100, Math.max(0, percent))} />
          </div>
        );
      },
    },
    {
      key: "description",
      label: "Description",
      className: "max-w-xs",
      render: (query) => (
        <div className="whitespace-normal">{query.description || "-"}</div>
      ),
    },
    {
      key: "frequency",
      label: "Frequency",
      render: (query) => query.frequency,
    },
    {
      key: "keywordsCount",
      label: "Keywords",
      render: (query) => query.keywords?.length ?? query.keywordsCount ?? 0,
    },
    {
      key: "sourcesCount",
      label: "Sources",
      render: (query) => query.sources?.length ?? query.sourcesCount ?? 0,
    },
    {
      key: "enabled",
      label: "Enabled",
      className: "w-24 text-center",
      render: (query) => {
        const checked = query.enabled;
        return (
          <div className="flex justify-center">
            <Switch
              checked={checked}
              disabled={Boolean(togglingMap[query.id])}
              onCheckedChange={(nextChecked) => {
                void handleToggleEnabled(query, nextChecked);
              }}
              aria-label={checked ? "Pause task" : "Enable task"}
            />
          </div>
        );
      },
    },
  ];

  const actions: DataTableAction<QueryWithAggregations>[] = [
    {
      type: "custom",
      render: (query) => (
        <Button
          size="sm"
          variant="default"
          disabled={
            runningMap[query.id] || query.latestRun?.status === "RUNNING"
          }
          onClick={async () => {
            try {
              const res = await fetch(`/api/follow/queries/${query.id}/run`, {
                method: "POST",
              });
              const json = await res.json();
              if (!res.ok) {
                console.error("Run failed:", json?.error || res.statusText);
                return;
              }
              const runId = json.runId as string | undefined;
              if (!runId) return;
              setRunningMap((prev) => ({ ...prev, [query.id]: true }));
              setProgressMap((prev) => ({
                ...prev,
                [query.id]: { progress: 0, status: "pending" },
              }));
              const es = new EventSource(`/api/tasks/${runId}/stream`);
              const closeStream = () => {
                es.close();
                setRunningMap((prev) => ({ ...prev, [query.id]: false }));
              };
              es.onmessage = (ev) => {
                try {
                  const data = JSON.parse(ev.data);
                  setProgressMap((prev) => ({
                    ...prev,
                    [query.id]: {
                      progress:
                        typeof data?.progress === "number"
                          ? data.progress
                          : (prev[query.id]?.progress ?? 0),
                      status: data?.type,
                    },
                  }));
                  if (data?.type === "done") {
                    closeStream();
                    router.refresh();
                  }
                  if (data?.type === "error") {
                    closeStream();
                  }
                } catch {
                  // ignore invalid payloads
                }
              };
              es.onerror = () => {
                // keep server retry
              };
            } catch (e) {
              console.error(e);
            }
          }}
        >
          <PlayIcon className="size-3" />
        </Button>
      ),
    },
    {
      type: "edit",
      render: (query) => (
        <Button size="sm" variant="outline" onClick={() => handleEdit(query)}>
          <PencilIcon className="size-3" />
        </Button>
      ),
    },
    {
      type: "delete",
      render: (query) => (
        <QueryDeleteAlert
          query={query}
          triggerButton={
            <Button size="sm" variant="outline">
              <TrashIcon className="size-3" />
            </Button>
          }
        />
      ),
    },
  ];

  return (
    <>
      <QueryDialog
        query={editingQuery}
        keywords={keywords}
        sources={sources}
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDialogOpen(false);
            handleCloseDialog();
          } else {
            if (closeTimerRef.current) {
              clearTimeout(closeTimerRef.current);
              closeTimerRef.current = null;
            }
            setDialogOpen(true);
          }
        }}
      />
      <DataTable
        data={queries}
        columns={columns}
        actions={actions}
        emptyMessage="No queries found. Add your first query to get started."
      />
    </>
  );
};

export default QueriesTable;
