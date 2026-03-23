"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PencilIcon, TrashIcon } from "lucide-react";
import { Source, Proxy } from "@/app/generated/prisma";
import {
  DataTable,
  DataTableColumn,
  DataTableAction,
} from "@/components/common";
import SourceDialog from "./SourceDialog";
import SourceDeleteAlert from "./SourceDeleteAlert";
import { SourceWithRelations } from "@/lib/types";

interface Props {
  sources: (SourceWithRelations & {
    proxy?: Proxy | null;
  })[];
  proxies: Proxy[];
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

const SocialMediaSources = ({ sources, proxies }: Props) => {
  const [editingSource, setEditingSource] = useState<
    InteractiveSource | undefined
  >();

  const handleEdit = (source: InteractiveSource) => {
    setEditingSource(source);
  };

  const handleCloseDialog = () => {
    setEditingSource(undefined);
  };

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
        source={editingSource}
        proxies={proxies}
        open={!!editingSource}
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
