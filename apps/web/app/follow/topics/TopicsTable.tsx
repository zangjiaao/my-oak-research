"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { PencilIcon, PlayIcon, TrashIcon } from "lucide-react";
import { DataTable, DataTableAction, DataTableColumn } from "@/components/common";
import TopicDialog from "./TopicDialog";
import TopicDeleteAlert from "./TopicDeleteAlert";
import { SourceWithRelations, TopicWithAggregations } from "@/lib/types";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

interface Props {
  topics: TopicWithAggregations[];
  sources: SourceWithRelations[];
}

const TopicsTable = ({ topics, sources }: Props) => {
  const queryClient = useQueryClient();
  const [editingTopic, setEditingTopic] = useState<TopicWithAggregations | undefined>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [togglingMap, setTogglingMap] = useState<Record<string, boolean>>({});
  const [runningMap, setRunningMap] = useState<Record<string, boolean>>({});

  const handleEdit = (topic: TopicWithAggregations) => {
    setEditingTopic(topic);
    setDialogOpen(true);
  };

  const handleToggleEnabled = async (topic: TopicWithAggregations, enabled: boolean) => {
    setTogglingMap((prev) => ({ ...prev, [topic.id]: true }));
    try {
      const response = await fetch(`/api/follow/topics/${topic.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ enabled }),
      });

      if (!response.ok) {
        throw new Error("Failed to update topic status");
      }

      toast.success(enabled ? "Topic enabled" : "Topic paused");
      queryClient.invalidateQueries({ queryKey: ["topics"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update topic status");
    } finally {
      setTogglingMap((prev) => ({ ...prev, [topic.id]: false }));
    }
  };

  const columns: DataTableColumn<TopicWithAggregations>[] = [
    {
      key: "name",
      label: "Name",
      className: "min-w-[220px]",
      render: (topic) => topic.name,
    },
    {
      key: "description",
      label: "Description",
      hideBelow: "md",
      className: "max-w-xs min-w-[240px]",
      render: (topic) => <div className="whitespace-normal">{topic.description || "-"}</div>,
    },
    {
      key: "frequency",
      label: "Frequency",
      className: "min-w-[110px]",
      render: (topic) => topic.frequency,
    },
    {
      key: "terms",
      label: "Terms",
      hideBelow: "md",
      className: "min-w-[160px]",
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
    {
      key: "sources",
      label: "Sources",
      hideBelow: "lg",
      className: "min-w-[220px]",
      render: (topic) => (
        <div className="flex flex-wrap gap-1">
          {(topic.sources ?? []).length > 0 ? (
            topic.sources?.map((binding) => (
              <Badge key={binding.id} variant="outline">
                {binding.source?.name || binding.sourceId}
              </Badge>
            ))
          ) : (
            <span className="text-muted-foreground">-</span>
          )}
        </div>
      ),
    },
    {
      key: "enabled",
      label: "Enabled",
      className: "min-w-[90px] text-center",
      render: (topic) => (
        <div className="flex justify-center">
          <Switch
            checked={topic.enabled}
            disabled={Boolean(togglingMap[topic.id])}
            onCheckedChange={(nextChecked) => {
              void handleToggleEnabled(topic, nextChecked);
            }}
          />
        </div>
      ),
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
        sources={sources}
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
