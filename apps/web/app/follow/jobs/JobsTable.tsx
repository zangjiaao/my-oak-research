"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui";
import { Switch } from "@/components/ui/switch";
import { PencilIcon, PlayIcon, TrashIcon } from "lucide-react";
import { DataTable, DataTableAction, DataTableColumn } from "@/components/common";
import { JobWithAggregations, SourceWithRelations, TopicWithAggregations } from "@/lib/types";
import JobDialog from "./JobDialog";
import JobDeleteAlert from "./JobDeleteAlert";

interface Props {
  jobs: JobWithAggregations[];
  topics: TopicWithAggregations[];
  sources: SourceWithRelations[];
}

const JobsTable = ({ jobs, topics, sources }: Props) => {
  const queryClient = useQueryClient();
  const [editingJob, setEditingJob] = useState<JobWithAggregations | undefined>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [runningMap, setRunningMap] = useState<Record<string, boolean>>({});
  const [togglingMap, setTogglingMap] = useState<Record<string, boolean>>({});

  const handleEdit = (job: JobWithAggregations) => {
    setEditingJob(job);
    setDialogOpen(true);
  };

  const handleToggleEnabled = async (job: JobWithAggregations, enabled: boolean) => {
    setTogglingMap((prev) => ({ ...prev, [job.id]: true }));
    try {
      const response = await fetch(`/api/follow/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) {
        throw new Error("Failed to update job status");
      }
      toast.success(enabled ? "Job enabled" : "Job paused");
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update job status");
    } finally {
      setTogglingMap((prev) => ({ ...prev, [job.id]: false }));
    }
  };

  const handleRun = async (job: JobWithAggregations) => {
    setRunningMap((prev) => ({ ...prev, [job.id]: true }));
    try {
      const response = await fetch(`/api/follow/jobs/${job.id}/run`, {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to run job");
      }
      toast.success("Job run queued");
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to run job");
    } finally {
      setRunningMap((prev) => ({ ...prev, [job.id]: false }));
    }
  };

  const columns: DataTableColumn<JobWithAggregations>[] = [
    {
      key: "name",
      label: "Name",
      className: "max-w-[220px]",
      render: (job) => <div className="truncate">{job.name}</div>,
    },
    {
      key: "type",
      label: "Type",
      hideBelow: "md",
      className: "max-w-[120px]",
      render: (job) => <Badge variant="outline">{job.type}</Badge>,
    },
    {
      key: "progress",
      label: "Progress",
      hideBelow: "md",
      className: "text-center",
      render: (job) => (
        <div className="mx-auto w-24">
          <Progress value={Math.min(100, Math.max(0, job.latestRun?.progress ?? 0))} />
        </div>
      ),
    },
    {
      key: "frequency",
      label: "Frequency",
      hideBelow: "lg",
      render: (job) => job.frequency,
    },
    {
      key: "topics",
      label: "Topics",
      hideBelow: "lg",
      className: "max-w-[220px]",
      render: (job) => {
        const rows = job.jobTopics ?? [];
        return rows.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {rows.map((row) => (
              <Badge key={row.id} variant="secondary">
                {row.topic?.name || row.topicId}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground">-</span>
        );
      },
    },
    {
      key: "sources",
      label: "Sources",
      hideBelow: "lg",
      className: "max-w-[220px]",
      render: (job) => {
        const rows = job.jobSources ?? [];
        return rows.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {rows.map((row) => (
              <Badge key={row.id} variant="outline">
                {row.source?.name || row.sourceId}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground">-</span>
        );
      },
    },
    {
      key: "enabled",
      label: "Enabled",
      className: "text-center",
      render: (job) => (
        <div className="flex justify-center">
          <Switch
            checked={job.enabled}
            disabled={Boolean(togglingMap[job.id])}
            onCheckedChange={(nextChecked) => {
              void handleToggleEnabled(job, nextChecked);
            }}
          />
        </div>
      ),
    },
  ];

  const actions: DataTableAction<JobWithAggregations>[] = [
    {
      type: "custom",
      render: (job) => (
        <Button
          size="sm"
          variant="default"
          className="h-8 w-8 p-0 sm:h-9 sm:w-auto sm:px-3"
          disabled={Boolean(runningMap[job.id])}
          onClick={() => void handleRun(job)}
        >
          <PlayIcon className="size-3" />
          <span className="hidden sm:inline">Run</span>
        </Button>
      ),
    },
    {
      type: "custom",
      render: (job) => (
        <Button
          size="sm"
          variant="outline"
          className="h-8 w-8 p-0 sm:h-9 sm:w-auto sm:px-3"
          onClick={() => handleEdit(job)}
        >
          <PencilIcon className="size-3" />
          <span className="hidden sm:inline">Edit</span>
        </Button>
      ),
    },
    {
      type: "custom",
      render: (job) => (
        <JobDeleteAlert
          job={job}
          triggerButton={
            <Button
              size="sm"
              variant="destructive"
              className="h-8 w-8 p-0 sm:h-9 sm:w-auto sm:px-3"
            >
              <TrashIcon className="size-3" />
              <span className="hidden sm:inline">Delete</span>
            </Button>
          }
        />
      ),
    },
  ];

  return (
    <>
      <DataTable data={jobs} columns={columns} actions={actions} emptyMessage="No jobs found." />
      <JobDialog
        job={editingJob}
        topics={topics}
        sources={sources}
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingJob(undefined);
        }}
      />
    </>
  );
};

export default JobsTable;
