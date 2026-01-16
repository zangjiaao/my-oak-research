"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PencilIcon, TrashIcon } from "lucide-react";
import { Source, DarknetSourceConfig, Proxy } from "@/app/generated/prisma";
import { DarknetSource as DarknetSourceBase } from "@/lib/types";
import {
  DataTable,
  DataTableColumn,
  DataTableAction,
} from "@/components/common";
import SourceDeleteAlert from "./SourceDeleteAlert";
import SourceDialog from "./SourceDialog";

type DarknetSource = DarknetSourceBase & {
  darknet: DarknetSourceConfig & { proxy?: Proxy | null };
};

interface Props {
  sources: DarknetSource[];
  proxies: Proxy[];
}

const DarknetSources = ({ sources, proxies }: Props) => {
  const [editingSource, setEditingSource] = useState<
    DarknetSource | undefined
  >();

  const handleEdit = (source: DarknetSource) => {
    setEditingSource(source);
  };

  const handleCloseDialog = () => {
    setEditingSource(undefined);
  };

  const columns: DataTableColumn<DarknetSource>[] = [
    {
      key: "name",
      label: "Name",
      render: (source) => source.name,
    },
    {
      key: "description",
      label: "Description",
      className: "max-w-xs",
      render: (source) => (
        <div className="whitespace-normal">{source.description}</div>
      ),
    },
    {
      key: "domain",
      label: "Domain",
      className: "max-w-xs",
      render: (source) => (
        <span className="text-sm break-all whitespace-normal">
          {source.darknet.url}
        </span>
      ),
    },
    {
      key: "proxy",
      label: "Proxy",
      render: (source) =>
        source.darknet.proxyId ? (source.darknet.proxy?.name ?? "—") : "None",
    },
  ];

  const actions: DataTableAction<DarknetSource>[] = [
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
          queryKeyType="DARKNET"
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
        sourceType="DARKNET"
        source={editingSource}
        proxies={proxies}
        open={!!editingSource}
        onOpenChange={(open) => !open && handleCloseDialog()}
      />
      <DataTable
        data={sources}
        columns={columns}
        actions={actions}
        emptyMessage="No darknet sources found. Add your first darknet source to get started."
      />
    </>
  );
};

export default DarknetSources;
