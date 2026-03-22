"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PencilIcon, TrashIcon } from "lucide-react";
import { Source, Proxy } from "@/app/generated/prisma";
import { SourceWithRelations } from "@/lib/types";
import {
  DataTable,
  DataTableColumn,
  DataTableAction,
} from "@/components/common";
import SourceDialog from "./SourceDialog";
import SourceDeleteAlert from "./SourceDeleteAlert";

interface Props {
  sources: SourceWithRelations[];
  proxies: Proxy[];
}

type StreamSource = SourceWithRelations & Source;

const WebSites = ({ sources, proxies }: Props) => {
  const [editingSource, setEditingSource] = useState<SourceWithRelations | undefined>();

  const handleEdit = (source: SourceWithRelations) => {
    setEditingSource(source);
  };

  const handleCloseDialog = () => {
    setEditingSource(undefined);
  };

  const columns: DataTableColumn<StreamSource>[] = [
    {
      key: "name",
      label: "Name",
      render: (source) => source.name,
    },
    {
      key: "description",
      label: "Description",
      className: "max-w-[200px]",
      render: (source) => <div className="truncate">{source.description}</div>,
    },
    {
      key: "target",
      label: "Target",
      className: "max-w-[300px]",
      render: (source) => {
        const urls = "web" in source ? source.web?.url ?? [] : [];
        const platform =
          ("social" in source ? source.social?.platform : null) ??
          ("search" in source ? source.search?.platform : null) ??
          null;
        const display = urls.length > 0 ? urls.join(", ") : platform || "-";
        const tooltip = urls.length > 0 ? urls.join("\n") : undefined;
        return (
          <div className="truncate" title={tooltip}>
            {display}
          </div>
        );
      },
    },
    {
      key: "proxy",
      label: "Proxy",
      render: (source) => source.proxy?.name || "None",
    },
  ];

  const actions: DataTableAction<StreamSource>[] = [
    {
      type: "edit",
      render: (source) => (
        <Button size="sm" variant="outline" onClick={() => handleEdit(source)}>
          <PencilIcon className="size-3" />
        </Button>
      ),
    },
    {
      type: "delete",
      render: (source) => (
        <SourceDeleteAlert
          source={source}
          queryKeyType="WEB"
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
      <SourceDialog
        sourceType="WEB"
        source={editingSource}
        proxies={proxies}
        open={!!editingSource}
        onOpenChange={(open) => !open && handleCloseDialog()}
      />
      <DataTable
        data={sources as StreamSource[]}
        columns={columns}
        actions={actions}
        emptyMessage="No website sources found. Add your first website source to get started."
      />
    </>
  );
};

export default WebSites;
