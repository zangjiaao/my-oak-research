"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy, PencilIcon, TrashIcon, ZapIcon } from "lucide-react";
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
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  isSourceQuickRunUnsupported,
  QUICK_RUN_LOCKED_ARG_MESSAGE,
  quickRunSource,
} from "./quick-run";

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
  const queryClient = useQueryClient();
  const [editingSource, setEditingSource] = useState<
    InteractiveSource | undefined
  >();
  const [duplicatingSource, setDuplicatingSource] = useState<
    InteractiveSource | undefined
  >();
  const [quickRunningMap, setQuickRunningMap] = useState<Record<string, boolean>>({});

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
      hideBelow: "md",
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
      hideBelow: "md",
      className: "max-w-xs",
      render: (source) => (
        <div className="whitespace-normal">{source.description}</div>
      ),
    },
    {
      key: "proxy",
      label: "Proxy",
      hideBelow: "lg",
      render: (source) => source.proxy?.name || "None",
    },
  ];

  const actions: DataTableAction<InteractiveSource>[] = [
    {
      type: "custom",
      render: (source) => {
        const isUnsupported = isSourceQuickRunUnsupported(source);
        const isRunning = Boolean(quickRunningMap[source.id]);
        const button = (
          <Button
            size="sm"
            variant="outline"
            disabled={isUnsupported || isRunning}
            onClick={async () => {
              setQuickRunningMap((prev) => ({ ...prev, [source.id]: true }));
              try {
                const result = await quickRunSource(source.id);
                toast.success(
                  result.created
                    ? `已创建并执行快速 Query（${source.name}）`
                    : `已执行快速 Query（${source.name}）`
                );
                await queryClient.invalidateQueries({ queryKey: ["queries"] });
              } catch (error) {
                toast.error(
                  error instanceof Error ? error.message : "Failed to quick run source"
                );
              } finally {
                setQuickRunningMap((prev) => ({ ...prev, [source.id]: false }));
              }
            }}
            aria-label="Quick run source"
          >
            <ZapIcon className="size-3" />
          </Button>
        );

        if (!isUnsupported) return button;
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <span>{button}</span>
            </TooltipTrigger>
            <TooltipContent sideOffset={6}>{QUICK_RUN_LOCKED_ARG_MESSAGE}</TooltipContent>
          </Tooltip>
        );
      },
    },
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
