"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlusIcon, Search } from "lucide-react";
import { SettingCard } from "@/components/common";
import { useFollow } from "@/hooks/useFollow";
import { Skeleton } from "@/components/ui/skeleton";
import QueriesTable from "./QueriesTable";
import QueryDialog from "./QueryDialog";

const QueriesPage = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [isDialogOpen, setDialogOpen] = useState(false);

  const { queries, keywords, sources, queriesQuery } = useFollow();
  const { isLoading, error } = queriesQuery;

  if (error) {
    return (
      <SettingCard
        title="Manage Queries"
        description="Error loading queries. Please try again."
        count={0}
        countLabel="queries"
      />
    );
  }

  const filteredQueries = queries.filter(
    (query) =>
      query.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      query.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filterComponent = (
    <div className="flex items-center gap-4">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search queries..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>
      <QueryDialog
        keywords={keywords}
        sources={sources}
        open={isDialogOpen}
        onOpenChange={setDialogOpen}
        triggerButton={
          <Button onClick={() => setDialogOpen(true)}>
            <PlusIcon className="size-4" />
            Add Query
          </Button>
        }
      />
    </div>
  );

  return (
    <SettingCard
      title="Manage Queries"
      description="Combine keywords and sources to create queries."
      count={filteredQueries.length}
      countLabel="queries"
      filterComponent={filterComponent}
    >
      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (
        <QueriesTable
          queries={filteredQueries}
          keywords={keywords}
          sources={sources}
        />
      )}
    </SettingCard>
  );
};

export default QueriesPage;
