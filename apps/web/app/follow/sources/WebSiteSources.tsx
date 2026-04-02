"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy, PencilIcon, TrashIcon, ZapIcon } from "lucide-react";
import { Source, Proxy } from "@/app/generated/prisma";
import { SourceWithRelations } from "@/lib/types";
import {
  DataTable,
  DataTableColumn,
  DataTableAction,
} from "@/components/common";
import SourceDialog from "./SourceDialog";
import SourceDeleteAlert from "./SourceDeleteAlert";
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
  sources: SourceWithRelations[];
  proxies: Proxy[];
  allSourceNames: string[];
}

type StreamSource = SourceWithRelations & Source;

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function parseGatherMarker(value?: string | null): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const match = text.match(/collect\s+([a-z0-9_-]+)\s*\(([\w-]+)\)\s+via\s+gather_playwright/i);
  const platform = String(match?.[1] ?? "").trim();
  return platform ? platform.toUpperCase() : null;
}

function getSourcePlatformLabel(source: StreamSource): string {
  const identityPlatform =
    typeof source.identity?.platform === "string" ? source.identity.platform.trim() : "";
  if (identityPlatform) {
    return identityPlatform.toUpperCase();
  }
  const webConfig = "web" in source ? source.web : null;
  const parseRules = asRecord(webConfig?.parseRules);
  const gather = asRecord(parseRules.gather);
  const gatherPlatform = String(gather.platform ?? "").trim();
  if (gatherPlatform) {
    return gatherPlatform.toUpperCase();
  }
  const markerPlatform =
    parseGatherMarker(source.description) ?? parseGatherMarker(source.name);
  if (markerPlatform) {
    return markerPlatform;
  }

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
  const platform = search?.platform ?? ("social" in source ? source.social?.platform : null);

  if (platform === "CUSTOM" && providerLabel) return providerLabel;
  return platform ?? "-";
}

const WebSites = ({ sources, proxies, allSourceNames }: Props) => {
  const queryClient = useQueryClient();
  const [editingSource, setEditingSource] = useState<SourceWithRelations | undefined>();
  const [duplicatingSource, setDuplicatingSource] = useState<SourceWithRelations | undefined>();
  const [quickRunningMap, setQuickRunningMap] = useState<Record<string, boolean>>({});

  const handleEdit = (source: SourceWithRelations) => {
    setDuplicatingSource(undefined);
    setEditingSource(source);
  };

  const handleDuplicate = (source: SourceWithRelations) => {
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

  const columns: DataTableColumn<StreamSource>[] = [
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

  const actions: DataTableAction<StreamSource>[] = [
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
                    ? `已创建并执行快速 Job（${source.name}）`
                    : `已执行快速 Job（${source.name}）`
                );
                await queryClient.invalidateQueries({ queryKey: ["jobs"] });
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
          queryKeyType="STREAM"
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
        sourceType="STREAM"
        source={activeSource}
        mode={duplicatingSource ? "duplicate" : "auto"}
        duplicateName={duplicateName}
        proxies={proxies}
        open={!!activeSource}
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
