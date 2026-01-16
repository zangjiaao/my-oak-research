"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlusIcon, Search } from "lucide-react";
import { SettingCard } from "@/components/common";
import DarknetSources from "./DarknetSources";
import SourceDialog from "./SourceDialog";
import { useFollow } from "@/hooks/useFollow";
import { Skeleton } from "@/components/ui/skeleton";
import { DarknetSource, SourceWithRelations } from "@/lib/types";

const isDarknetSource = (
  source: SourceWithRelations
): source is DarknetSource =>
  source.type === "DARKNET" && "darknet" in source && Boolean(source.darknet);

const DarknetSettingCard = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [isDialogOpen, setDialogOpen] = useState(false);

  const { sources, proxies, sourcesQuery } = useFollow();
  const { isLoading, error } = sourcesQuery;

  if (error) {
    return (
      <SettingCard
        title="Manage Darknet Sources"
        description="Error loading darknet sources. Please try again."
        count={0}
        countLabel="sources"
      />
    );
  }

  const darknetSources: DarknetSource[] =
    sources?.filter(isDarknetSource) ?? [];

  const filteredSources: DarknetSource[] = darknetSources.filter(
    (source) =>
      source.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      source.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      source.darknet?.url?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filterComponent = (
    <div className="flex items-center gap-4">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search darknet sources..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>
      <SourceDialog
        sourceType="DARKNET"
        proxies={proxies}
        open={isDialogOpen}
        onOpenChange={setDialogOpen}
        triggerButton={
          <Button onClick={() => setDialogOpen(true)}>
            <PlusIcon className="size-4" />
            Add Darknet Source
          </Button>
        }
      />
    </div>
  );

  return (
    <SettingCard
      title="Manage Darknet Sources"
      description="You can manage information sources from the darknet here."
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
        <DarknetSources sources={filteredSources} proxies={proxies} />
      )}
    </SettingCard>
  );
};

export default DarknetSettingCard;
