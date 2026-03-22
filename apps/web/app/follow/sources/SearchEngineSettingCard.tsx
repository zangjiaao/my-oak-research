"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PencilIcon, TrashIcon, PlusIcon, Search } from "lucide-react";
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

const SEARCH_PLATFORM_LABELS: Record<string, string> = {
  PARALLEL: "Parallel.ai",
  TAVILY: "Tavily",
  ANSPIRE: "Anspire",
  CUSTOM: "Custom",
};

type RetrievalSource = SourceWithRelations;

const SearchEngineSettingCard = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [isDialogOpen, setDialogOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<
    RetrievalSource | undefined
  >(undefined);

  const { sources, proxies, sourcesQuery } = useFollow();
  const { isLoading, error } = sourcesQuery;

  const handleEdit = (source: RetrievalSource) => {
    setEditingSource(source);
    setDialogOpen(true);
  };

  const handleAdd = () => {
    setEditingSource(undefined);
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
        type: source.type,
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
        ("social" in source ? source.social?.platform : null) ??
        ("search" in source ? source.search?.platform : null) ??
        ""
      )
        .toLowerCase()
        .includes(searchQuery.toLowerCase())
  );

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
      render: (source) => {
        const platform =
          ("search" in source
            ? (source.search as unknown as { platform?: string })?.platform
            : null) ??
          ("social" in source ? source.social?.platform : null);
        return (
          <span className="text-sm break-all whitespace-normal">
            {platform ? SEARCH_PLATFORM_LABELS[platform] ?? platform : "-"}
          </span>
        );
      },
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
          queryKeyType="SEARCH_ENGINE"
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
        sourceType="SEARCH_ENGINE"
        source={editingSource}
        proxies={proxies}
        open={isDialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditingSource(undefined);
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
