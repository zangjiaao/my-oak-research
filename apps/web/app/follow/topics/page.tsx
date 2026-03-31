"use client";

import { useState } from "react";
import { SettingCard } from "@/components/common";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PlusIcon, Search } from "lucide-react";
import { useFollow } from "@/hooks/useFollow";
import TopicDialog from "./TopicDialog";
import TopicsTable from "./TopicsTable";

const TopicsPage = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [isDialogOpen, setDialogOpen] = useState(false);

  const { topics, topicsQuery } = useFollow();
  const { isLoading, error } = topicsQuery;

  if (error) {
    return (
      <SettingCard
        title="Manage Topics"
        description="Error loading topics. Please try again."
        count={0}
        countLabel="topics"
      />
    );
  }

  const filteredTopics = topics.filter(
    (topic) =>
      topic.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      topic.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filterComponent = (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-[220px] flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search topics..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>
      <TopicDialog
        open={isDialogOpen}
        onOpenChange={setDialogOpen}
        triggerButton={
          <Button className="w-full sm:w-auto" onClick={() => setDialogOpen(true)}>
            <PlusIcon className="size-4" />
            Add Topic
          </Button>
        }
      />
    </div>
  );

  return (
    <SettingCard
      title="Manage Topics"
      description="Define topic scope with core, expansion, and exclusion terms."
      count={filteredTopics.length}
      countLabel="topics"
      filterComponent={filterComponent}
    >
      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (
        <TopicsTable topics={filteredTopics} />
      )}
    </SettingCard>
  );
};

export default TopicsPage;
