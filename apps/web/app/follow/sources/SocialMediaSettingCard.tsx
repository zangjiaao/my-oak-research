"use client";

import React, { useState } from "react";
import { PlusIcon, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingCard } from "@/components/common";
import SourceDialog from "./SourceDialog";
import SocialMediaSources from "./SocialMediaSources";
import { useFollow } from "@/hooks/useFollow";
import { Skeleton } from "@/components/ui/skeleton";
import { SocialMediaSource, SourceWithRelations } from "@/lib/types";
import type { Proxy } from "@/app/generated/prisma";

const isSocialMediaSource = (
  source: SourceWithRelations
): source is SocialMediaSource =>
  source.type === "SOCIAL_MEDIA" &&
  "social" in source &&
  Boolean(source.social);

const SocialMediaSettingCard = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [isDialogOpen, setDialogOpen] = useState(false);

  const { sources, proxies, sourcesQuery } = useFollow();
  const { isLoading, error } = sourcesQuery;

  if (error) {
    return (
      <SettingCard
        title="Manage Social Media"
        description="Error loading social media sources. Please try again."
        count={0}
        countLabel="social media"
      />
    );
  }

  const socialMediaSources = (sources?.filter(isSocialMediaSource) ??
    []) as SocialMediaSource[];

  const filteredSources = socialMediaSources.filter(
    (source) =>
      source.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      source.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      source.social?.platform?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const dataForTable: Array<SocialMediaSource & { proxy: Proxy | null }> =
    filteredSources.map((source) => ({
      ...source,
      proxy: source.proxy ?? null,
    }));

  const filterComponent = (
    <div className="flex items-center gap-4">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search social media..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>
      <SourceDialog
        sourceType="SOCIAL_MEDIA"
        proxies={proxies}
        open={isDialogOpen}
        onOpenChange={setDialogOpen}
        triggerButton={
          <Button onClick={() => setDialogOpen(true)}>
            <PlusIcon className="size-4" />
            Add Social Media
          </Button>
        }
      />
    </div>
  );

  return (
    <SettingCard
      title="Manage Social Media"
      description="You can manage information sources from the social media here."
      count={filteredSources.length}
      countLabel="social media"
      filterComponent={filterComponent}
    >
      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (
        <SocialMediaSources sources={dataForTable} proxies={proxies} />
      )}
    </SettingCard>
  );
};

export default SocialMediaSettingCard;
