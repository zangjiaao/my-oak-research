"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PencilIcon, TrashIcon } from "lucide-react";
import { Source, WebSourceConfig, Proxy } from "@/app/generated/prisma";
import { WebSource } from "@/lib/types";
import {
  DataTable,
  DataTableColumn,
  DataTableAction,
} from "@/components/common";
import SourceDialog from "./SourceDialog";
import SourceDeleteAlert from "./SourceDeleteAlert";

interface Props {
  sources: WebSource[];
  proxies: Proxy[];
}

type WebSiteSource = Source & { web: WebSourceConfig } & { proxy: Proxy };

const WebSites = ({ sources, proxies }: Props) => {
  const [editingSource, setEditingSource] = useState<WebSource | undefined>();

  const handleEdit = (source: WebSource) => {
    setEditingSource(source);
  };

  const handleCloseDialog = () => {
    setEditingSource(undefined);
  };

  const columns: DataTableColumn<WebSiteSource>[] = [
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
      key: "url",
      label: "URL",
      className: "max-w-[300px]",
      render: (source) => (
        <div className="truncate" title={source.web?.url}>
          {source.web?.url || "-"}
        </div>
      ),
    },
    {
      key: "proxy",
      label: "Proxy",
      render: (source) => source.proxy?.name || "None",
    },
  ];

  const actions: DataTableAction<WebSiteSource>[] = [
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
        data={sources as WebSiteSource[]}
        columns={columns}
        actions={actions}
        emptyMessage="No website sources found. Add your first website source to get started."
      />
    </>
  );
};

export default WebSites;
