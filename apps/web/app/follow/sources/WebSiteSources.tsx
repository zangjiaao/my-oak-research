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
