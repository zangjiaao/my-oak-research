"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy, PencilIcon, TrashIcon } from "lucide-react";
import { DarknetSourceConfig, Proxy } from "@/app/generated/prisma";
import { DarknetSource as DarknetSourceBase } from "@/lib/types";
import {
  DataTable,
  DataTableColumn,
  DataTableAction,
} from "@/components/common";
import SourceDeleteAlert from "./SourceDeleteAlert";
import SourceDialog from "./SourceDialog";
import { reserveCopySourceName } from "./source-copy-name";

type DarknetSource = DarknetSourceBase & {
  darknet: DarknetSourceConfig & { proxy?: Proxy | null };
};

interface Props {
  sources: DarknetSource[];
  proxies: Proxy[];
  allSourceNames: string[];
}

const DarknetSources = ({ sources, proxies, allSourceNames }: Props) => {
  const [editingSource, setEditingSource] = useState<
    DarknetSource | undefined
  >();
  const [duplicatingSource, setDuplicatingSource] = useState<
    DarknetSource | undefined
  >();

  const handleEdit = (source: DarknetSource) => {
    setDuplicatingSource(undefined);
    setEditingSource(source);
  };

  const handleDuplicate = (source: DarknetSource) => {
    setEditingSource(undefined);
    setDuplicatingSource(source);
  };

  const handleCloseDialog = () => {
    setEditingSource(undefined);
    setDuplicatingSource(undefined);
  };

  const activeSource = duplicatingSource ?? editingSource;
  const duplicateName = useMemo(
    () =>
      duplicatingSource
        ? reserveCopySourceName(duplicatingSource.name, allSourceNames)
        : undefined,
    [duplicatingSource, allSourceNames]
  );

  const columns: DataTableColumn<DarknetSource>[] = [
    {
      key: "name",
      label: "Name",
      render: (source) => source.name,
    },
    {
      key: "description",
      label: "Description",
      hideBelow: "md",
      className: "max-w-xs",
      render: (source) => (
        <div className="whitespace-normal">{source.description}</div>
      ),
    },
    {
      key: "domain",
      label: "Domain",
      hideBelow: "md",
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
      hideBelow: "lg",
      render: (source) =>
        source.darknet.proxyId ? (source.darknet.proxy?.name ?? "—") : "None",
    },
  ];

  const actions: DataTableAction<DarknetSource>[] = [
    {
      type: "custom",
      render: (source) => (
        <Button size="sm" variant="outline" onClick={() => handleDuplicate(source)}>
          <Copy className="size-3" />
        </Button>
      ),
    },
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
          queryKeyType="RETRIEVAL"
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
        sourceType="RETRIEVAL"
        sourceIsDarknet
        source={activeSource}
        mode={duplicatingSource ? "duplicate" : "auto"}
        duplicateName={duplicateName}
        proxies={proxies}
        open={!!activeSource}
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
