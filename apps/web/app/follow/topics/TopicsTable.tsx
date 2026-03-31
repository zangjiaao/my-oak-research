"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PencilIcon, PlayIcon, TrashIcon } from "lucide-react";
import { DataTable, DataTableAction, DataTableColumn } from "@/components/common";
import TopicDialog from "./TopicDialog";
import TopicDeleteAlert from "./TopicDeleteAlert";
import { TopicWithAggregations } from "@/lib/types";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

interface Props {
  topics: TopicWithAggregations[];
}

const TopicsTable = ({ topics }: Props) => {
  const queryClient = useQueryClient();
  const [editingTopic, setEditingTopic] = useState<TopicWithAggregations | undefined>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [runningMap, setRunningMap] = useState<Record<string, boolean>>({});

  const handleEdit = (topic: TopicWithAggregations) => {
    setEditingTopic(topic);
    setDialogOpen(true);
  };

  const columns: DataTableColumn<TopicWithAggregations>[] = [
    {
      key: "name",
      label: "Name",
      className: "max-w-[220px]",
      render: (topic) => <div className="truncate">{topic.name}</div>,
    },
    {
      key: "description",
      label: "Description",
      hideBelow: "md",
      className: "max-w-xs",
      render: (topic) => <div className="whitespace-normal">{topic.description || "-"}</div>,
    },
    {
      key: "terms",
      label: "Terms",
      hideBelow: "md",
      className: "max-w-[220px]",
      render: (topic) => {
        const terms = topic.terms ?? [];
        const core = terms.filter((term) => term.type === "CORE").length;
        const expansion = terms.filter((term) => term.type === "EXPANSION").length;
        const exclusion = terms.filter((term) => term.type === "EXCLUSION").length;
        return (
          <div className="flex flex-wrap gap-1">
            <Badge variant="outline">Core {core}</Badge>
            <Badge variant="secondary">Expansion {expansion}</Badge>
            <Badge variant="destructive">Exclusion {exclusion}</Badge>
          </div>
        );
      },
    },
  ];

  const actions: DataTableAction<TopicWithAggregations>[] = [
    {
      type: "custom",
      render: (topic) => (
        <Button
          size="sm"
          variant="outline"
          className="h-8 w-8 p-0 sm:h-9 sm:w-auto sm:px-3"
          onClick={() => handleEdit(topic)}
        >
          <PencilIcon className="size-3" />
          <span className="hidden sm:inline">Edit</span>
        </Button>
      ),
    },
    {
      type: "custom",
      render: (topic) => (
        <Button
          size="sm"
          variant="default"
          className="h-8 w-8 p-0 sm:h-9 sm:w-auto sm:px-3"
          disabled={Boolean(runningMap[topic.id])}
          onClick={async () => {
            setRunningMap((prev) => ({ ...prev, [topic.id]: true }));
            try {
              const response = await fetch(`/api/follow/topics/${topic.id}/run`, {
                method: "POST",
              });
              const payload = await response.json();
              if (!response.ok) {
                throw new Error(payload?.error || "Failed to run topic");
              }
              toast.success(
                payload?.count
                  ? `Queued ${payload.count} job run(s)`
                  : "Topic run queued"
              );
              queryClient.invalidateQueries({ queryKey: ["jobs"] });
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Failed to run topic");
            } finally {
              setRunningMap((prev) => ({ ...prev, [topic.id]: false }));
            }
          }}
        >
          <PlayIcon className="size-3" />
          <span className="hidden sm:inline">Run</span>
        </Button>
      ),
    },
    {
      type: "custom",
      render: (topic) => (
        <TopicDeleteAlert
          topic={topic}
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
      <DataTable data={topics} columns={columns} actions={actions} emptyMessage="No topics found." />
      <TopicDialog
        topic={editingTopic}
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingTopic(undefined);
        }}
      />
    </>
  );
};

export default TopicsTable;
