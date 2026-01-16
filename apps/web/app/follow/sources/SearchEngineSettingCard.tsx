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
import { SearchEngineSource, SourceWithRelations } from "@/lib/types";

const isSearchEngineSource = (
  source: SourceWithRelations
): source is SearchEngineSource =>
  source.type === "SEARCH_ENGINE" &&
  "search" in source &&
  Boolean(source.search);

const SearchEngineSettingCard = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [isDialogOpen, setDialogOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<
    SearchEngineSource | undefined
  >(undefined);

  const { sources, proxies, sourcesQuery } = useFollow();
  const { isLoading, error } = sourcesQuery;

  const handleEdit = (source: SearchEngineSource) => {
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
        title="Manage Search Engines"
        description="Error loading search engines. Please try again."
        count={0}
        countLabel="search engines"
      />
    );
  }

  const searchEngineSources = sources?.filter(isSearchEngineSource) ?? [];

  const filteredSources = searchEngineSources.filter(
    (source) =>
      source.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      source.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      source.search?.query?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const columns: DataTableColumn<SearchEngineSource>[] = [
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
      key: "query",
      label: "Query",
      className: "max-w-xs",
      render: (source) => (
        <span className="text-sm break-all whitespace-normal">
          {source.search.query}
        </span>
      ),
    },
    {
      key: "proxy",
      label: "Proxy",
      render: (source) => source.proxy?.name || "None",
    },
  ];

  const actions: DataTableAction<SearchEngineSource>[] = [
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
          placeholder="Search search engines..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>
      <Button onClick={handleAdd}>
        <PlusIcon className="size-4" />
        Add Search Engine
      </Button>
    </div>
  );

  return (
    <SettingCard
      title="Manage Search Engines"
      description="You can manage search engines here."
      count={filteredSources.length}
      countLabel="search engines"
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
