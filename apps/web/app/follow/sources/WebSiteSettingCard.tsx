"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlusIcon, Search } from "lucide-react";
import { SourceWithRelations } from "@/lib/types";
import { classifySourceCategory } from "@/lib/source-taxonomy";
import { SettingCard } from "@/components/common";
import SourceDialog from "./SourceDialog";
import WebSites from "./WebSiteSources";
import { useFollow } from "@/hooks/useFollow";
import { Skeleton } from "@/components/ui/skeleton";

const WebSiteSettingCard = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [isDialogOpen, setDialogOpen] = useState(false);

  const { sources, proxies, sourcesQuery } = useFollow();
  const { isLoading, error } = sourcesQuery;

  if (error) {
    return (
      <SettingCard
        title="Stream Sources"
        description="Error loading stream sources. Please try again."
        count={0}
        countLabel="sources"
      />
    );
  }

  const webSources =
    sources?.filter((source) =>
      classifySourceCategory({
        category: source.category,
        isDarknet: source.isDarknet,
        social: "social" in source ? source.social : null,
        search: "search" in source ? source.search : null,
        searchPlatform: "search" in source ? source.search?.platform : null,
      }) === "STREAM"
    ) ?? [];

  const filteredSources = webSources.filter(
    (source) => {
      const normalizedQuery = searchQuery.toLowerCase();
      const urlMatched =
        ("web" in source ? source.web?.url ?? [] : []).some((url) =>
          url.toLowerCase().includes(normalizedQuery)
        );
      const platformMatched =
        ("social" in source ? source.social?.platform ?? "" : "")
          .toLowerCase()
          .includes(normalizedQuery) ||
        ("search" in source ? source.search?.platform ?? "" : "")
          .toLowerCase()
          .includes(normalizedQuery);
      return (
        source.name.toLowerCase().includes(normalizedQuery) ||
        source.description?.toLowerCase().includes(normalizedQuery) ||
        urlMatched ||
        platformMatched
      );
    }
  );

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
      <SourceDialog
        sourceType="STREAM"
        proxies={proxies}
        open={isDialogOpen}
        onOpenChange={setDialogOpen}
        triggerButton={
          <Button onClick={() => setDialogOpen(true)} aria-label="Add source">
            <PlusIcon className="size-4" />
          </Button>
        }
      />
    </div>
  );

  return (
    <SettingCard
      title="Stream Sources"
      description="Configure stream category sources."
      count={filteredSources.length}
      countLabel="sources"
      filterComponent={filterComponent}
    >
      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (
        <WebSites sources={filteredSources} proxies={proxies} />
      )}
    </SettingCard>
  );
};

export default WebSiteSettingCard;
