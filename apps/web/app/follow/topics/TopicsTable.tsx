"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PencilIcon, TrashIcon } from "lucide-react";
import { DataTable, DataTableAction, DataTableColumn } from "@/components/common";
import TopicDialog from "./TopicDialog";
import TopicDeleteAlert from "./TopicDeleteAlert";
import { TopicWithAggregations } from "@/lib/types";

interface Props {
  topics: TopicWithAggregations[];
}

const TopicsTable = ({ topics }: Props) => {
  const [editingTopic, setEditingTopic] = useState<TopicWithAggregations | undefined>();
  const [dialogOpen, setDialogOpen] = useState(false);

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
          aria-label="Edit topic"
          onClick={() => handleEdit(topic)}
        >
          <PencilIcon className="size-3" />
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
              variant="outline"
              aria-label="Delete topic"
            >
              <TrashIcon className="size-3" />
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
