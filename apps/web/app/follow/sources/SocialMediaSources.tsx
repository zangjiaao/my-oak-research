"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy, PencilIcon, TrashIcon } from "lucide-react";
import { Source, Proxy } from "@/app/generated/prisma";
import {
  DataTable,
  DataTableColumn,
  DataTableAction,
} from "@/components/common";
import SourceDialog from "./SourceDialog";
import SourceDeleteAlert from "./SourceDeleteAlert";
import { SourceWithRelations } from "@/lib/types";
import { reserveCopySourceName } from "./source-copy-name";

interface Props {
  sources: (SourceWithRelations & {
    proxy?: Proxy | null;
  })[];
  proxies: Proxy[];
  allSourceNames: string[];
}

type InteractiveSource = SourceWithRelations & Source & {
  proxy?: Proxy | null;
};

function getSourcePlatformLabel(source: InteractiveSource): string {
  const search =
    "search" in source
      ? (source.search as unknown as { platform?: string; options?: unknown })
      : null;
  const provider =
    search?.options && typeof search.options === "object"
      ? (search.options as Record<string, unknown>).provider
      : null;
  const providerLabel =
    typeof provider === "string" && provider.trim() ? provider.trim().toUpperCase() : null;
  const platform = ("social" in source ? source.social?.platform : null) ?? search?.platform;

  if (platform === "CUSTOM" && providerLabel) return providerLabel;
  return platform ?? "-";
}

const SocialMediaSources = ({ sources, proxies, allSourceNames }: Props) => {
  const [editingSource, setEditingSource] = useState<
    InteractiveSource | undefined
  >();
  const [duplicatingSource, setDuplicatingSource] = useState<
    InteractiveSource | undefined
  >();

  const handleEdit = (source: InteractiveSource) => {
    setDuplicatingSource(undefined);
    setEditingSource(source);
  };

  const handleDuplicate = (source: InteractiveSource) => {
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

  const columns: DataTableColumn<InteractiveSource>[] = [
    {
      key: "name",
      label: "Name",
      render: (source) => source.name,
    },
    {
      key: "platform",
      label: "Platform",
      className: "max-w-xs",
      render: (source) => (
        <span className="text-sm break-all whitespace-normal">
          {getSourcePlatformLabel(source)}
        </span>
      ),
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
      key: "proxy",
      label: "Proxy",
      render: (source) => source.proxy?.name || "None",
    },
  ];

  const actions: DataTableAction<InteractiveSource>[] = [
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
          queryKeyType="INTERACTIVE"
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
        sourceType="INTERACTIVE"
        source={activeSource}
        mode={duplicatingSource ? "duplicate" : "auto"}
        duplicateName={duplicateName}
        proxies={proxies}
        open={!!activeSource}
        onOpenChange={(open) => !open && handleCloseDialog()}
      />
      <DataTable
        data={sources as InteractiveSource[]}
        columns={columns}
        actions={actions}
        emptyMessage="No social media sources found. Add your first social media source to get started."
      />
    </>
  );
};

export default SocialMediaSources;
