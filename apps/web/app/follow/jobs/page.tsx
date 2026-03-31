"use client";

import { useState } from "react";
import { SettingCard } from "@/components/common";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PlusIcon, Search } from "lucide-react";
import { useFollow } from "@/hooks/useFollow";
import JobDialog from "./JobDialog";
import JobsTable from "./JobsTable";

const JobsPage = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [isDialogOpen, setDialogOpen] = useState(false);

  const { jobs, topics, sources, jobsQuery } = useFollow();
  const { isLoading, error } = jobsQuery;

  if (error) {
    return (
      <SettingCard
        title="Manage Jobs"
        description="Error loading jobs. Please try again."
        count={0}
        countLabel="jobs"
      />
    );
  }

  const filteredJobs = jobs.filter(
    (job) =>
      job.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.type.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filterComponent = (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-[220px] flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search jobs..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>
      <JobDialog
        topics={topics}
        sources={sources}
        open={isDialogOpen}
        onOpenChange={setDialogOpen}
        triggerButton={
          <Button className="w-full sm:w-auto" onClick={() => setDialogOpen(true)}>
            <PlusIcon className="size-4" />
            Add Job
          </Button>
        }
      />
    </div>
  );

  return (
    <SettingCard
      title="Manage Jobs"
      description="Orchestrate topic retrieval and source ingestion jobs."
      count={filteredJobs.length}
      countLabel="jobs"
      filterComponent={filterComponent}
    >
      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (
        <JobsTable jobs={filteredJobs} topics={topics} sources={sources} />
      )}
    </SettingCard>
  );
};

export default JobsPage;
