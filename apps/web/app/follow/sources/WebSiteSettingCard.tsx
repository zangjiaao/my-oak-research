"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlusIcon, Search } from "lucide-react";
import { WebSource } from "@/lib/types";
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
        title="Manage Web Sites"
        description="Error loading web sites. Please try again."
        count={0}
        countLabel="websites"
      />
    );
  }

  const webSources =
    sources?.filter((s): s is WebSource => s.type === "WEB" && "web" in s) ||
    [];

  const filteredSources = webSources.filter(
    (source) =>
      source.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      source.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      source.web?.url?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filterComponent = (
    <div className="flex items-center gap-4">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search web sites..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>
      <SourceDialog
        sourceType="WEB"
        proxies={proxies}
        open={isDialogOpen}
        onOpenChange={setDialogOpen}
        triggerButton={
          <Button onClick={() => setDialogOpen(true)}>
            <PlusIcon className="size-4" />
            Add Web Site
          </Button>
        }
      />
    </div>
  );

  return (
    <SettingCard
      title="Manage Web Sites"
      description="You can manage information sources from the web site here."
      count={filteredSources.length}
      countLabel="websites"
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
