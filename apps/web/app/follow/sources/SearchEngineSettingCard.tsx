"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, PencilIcon, TrashIcon, PlusIcon, Search, ZapIcon } from "lucide-react";
import {
  SettingCard,
  DataTable,
  DataTableColumn,
  DataTableAction,
} from "@/components/common";
import SourceDialog from "./SourceDialog";
import SourceDeleteAlert from "./SourceDeleteAlert";
import { useFollow } from "@/hooks/useFollow";
import { Skeleton } from "@/components/ui/skeleton";
import { SourceWithRelations } from "@/lib/types";
import { classifySourceCategory } from "@/lib/source-taxonomy";
import { reserveCopySourceName } from "./source-copy-name";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  isSourceQuickRunUnsupported,
  QUICK_RUN_LOCKED_ARG_MESSAGE,
  quickRunSource,
} from "./quick-run";

const SEARCH_PLATFORM_LABELS: Record<string, string> = {
  PARALLEL: "Parallel.ai",
  TAVILY: "Tavily",
  ANSPIRE: "Anspire",
  CUSTOM: "Custom",
};

type RetrievalSource = SourceWithRelations;

function getSourcePlatformLabel(source: RetrievalSource): string {
  const searchPlatform =
    "search" in source
      ? (source.search as unknown as { platform?: string; options?: unknown })?.platform
      : null;
  const searchOptions =
    "search" in source
      ? (source.search as unknown as { options?: unknown })?.options
      : null;
  const provider =
    searchOptions && typeof searchOptions === "object"
      ? (searchOptions as Record<string, unknown>).provider
      : null;
  const providerLabel =
    typeof provider === "string" && provider.trim() ? provider.trim().toUpperCase() : null;
  const socialPlatform = "social" in source ? source.social?.platform : null;
  const platform = searchPlatform ?? socialPlatform ?? null;

  if (platform === "CUSTOM" && providerLabel) {
    return providerLabel;
  }
  if (!platform) return "-";
  return SEARCH_PLATFORM_LABELS[platform] ?? platform;
}

const SearchEngineSettingCard = () => {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [isDialogOpen, setDialogOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<
    RetrievalSource | undefined
  >(undefined);
  const [duplicatingSource, setDuplicatingSource] = useState<
    RetrievalSource | undefined
  >(undefined);
  const [quickRunningMap, setQuickRunningMap] = useState<Record<string, boolean>>({});

  const { sources, proxies, sourcesQuery } = useFollow();
  const { isLoading, error } = sourcesQuery;

  const handleEdit = (source: RetrievalSource) => {
    setDuplicatingSource(undefined);
    setEditingSource(source);
    setDialogOpen(true);
  };

  const handleDuplicate = (source: RetrievalSource) => {
    setEditingSource(undefined);
    setDuplicatingSource(source);
    setDialogOpen(true);
  };

  const handleAdd = () => {
    setEditingSource(undefined);
    setDuplicatingSource(undefined);
    setDialogOpen(true);
  };

  if (error) {
    return (
      <SettingCard
        title="Retrieval Sources"
        description="Error loading retrieval sources. Please try again."
        count={0}
        countLabel="sources"
      />
    );
  }

  const searchEngineSources =
    sources?.filter((source) =>
      classifySourceCategory({
        category: source.category,
        isDarknet: source.isDarknet,
        social: "social" in source ? source.social : null,
        search: "search" in source ? source.search : null,
        searchPlatform: "search" in source ? source.search?.platform : null,
      }) === "RETRIEVAL"
    ) ?? [];

  const filteredSources = searchEngineSources.filter(
    (source) =>
      source.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      source.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (
        ("search" in source
          ? (source.search as unknown as { objective?: string })?.objective
          : "") ?? ""
      )
        .toLowerCase()
        .includes(searchQuery.toLowerCase()) ||
      (
        getSourcePlatformLabel(source) ?? ""
      )
        .toLowerCase()
        .includes(searchQuery.toLowerCase())
  );
  const duplicateName = duplicatingSource
    ? reserveCopySourceName(
        duplicatingSource.name,
        searchEngineSources.map((source) => source.name)
      )
    : undefined;

  const columns: DataTableColumn<RetrievalSource>[] = [
    {
      key: "name",
      label: "Name",
      render: (source) => source.name,
    },
    {
      key: "objective",
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

  const actions: DataTableAction<RetrievalSource>[] = [
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

  const filterComponent = (
    <div className="flex items-center gap-4">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search items..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>
      <Button onClick={handleAdd} aria-label="Add source">
        <PlusIcon className="size-4" />
        Add Retrieval Source
      </Button>
    </div>
  );

  return (
    <SettingCard
      title="Retrieval Sources"
      description="Configure retrieval category sources."
      count={filteredSources.length}
      countLabel="sources"
      filterComponent={filterComponent}
    >
      <SourceDialog
        sourceType="RETRIEVAL"
        sourceIsDarknet={false}
        source={duplicatingSource ?? editingSource}
        mode={duplicatingSource ? "duplicate" : "auto"}
        duplicateName={duplicateName}
        proxies={proxies}
        open={isDialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditingSource(undefined);
            setDuplicatingSource(undefined);
          }
        }}
      />
      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (
        <DataTable
          data={filteredSources}
          columns={columns}
          actions={actions}
          emptyMessage="No search engines found. Add your first search engine to get started."
        />
      )}
    </SettingCard>
  );
};

export default SearchEngineSettingCard;
