"use client";

import React, { useState } from "react";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlusIcon, Search } from "lucide-react";
import { Category } from "@/app/generated/prisma";
import { Prisma } from "@/app/generated/prisma";
import { SettingCard } from "@/components/common";
import EditKeywordDialog from "./KeywordDialog";
import KeywordsTable from "./Keywords";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";

type KeywordWithCategory = Prisma.KeywordGetPayload<{
  include: { category: true };
}>;

interface Props {
  initialKeywords?: KeywordWithCategory[];
  categories: Category[];
}

// Fetcher function for keywords
async function fetchKeywords() {
  const response = await fetch("/api/follow/keywords", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to fetch keywords");
  }
  const data = await response.json();
  // Ensure we always return an array, never undefined
  return Array.isArray(data?.items) ? data.items : [];
}

const KeywordSettingCard = ({ initialKeywords, categories }: Props) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>();

  // Use React Query to fetch keywords data
  const {
    data: keywords,
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: ["keywords"],
    queryFn: fetchKeywords,
    initialData: initialKeywords,
  });

  const isActuallyLoading = isLoading || (isFetching && !keywords);
  const isRefreshing = isFetching && !!keywords;

  if (error) {
    return (
      <SettingCard
        title="Manage Keywords"
        description="Error loading keywords. Please try again."
        count={0}
        countLabel="keywords"
      />
    );
  }

  // 应用筛选
  const filteredKeywords = (keywords || []).filter(
    (keyword: KeywordWithCategory) => {
      const matchesSearch =
        keyword.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        keyword.description?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory =
        !categoryFilter || keyword.categoryId === categoryFilter;
      return matchesSearch && matchesCategory;
    }
  );

  return (
    <SettingCard
      title="Manage Keywords"
      description="Configure Recall Terms, Scoring Terms, and Exclusion Terms."
      count={filteredKeywords.length}
      countLabel="keywords"
    >
      <div className="space-y-4">
        <div className="flex gap-4 justify-between items-center">
          <div className="flex gap-4 flex-1">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search keywords..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((category: Category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <EditKeywordDialog
            categories={categories}
            triggerButton={
              <Button>
                <PlusIcon className="size-4" />
                Add Keyword
              </Button>
            }
          />
        </div>
        {isActuallyLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (
          <div className={isRefreshing ? "opacity-50 transition-opacity" : ""}>
            <KeywordsTable keywords={filteredKeywords} categories={categories} />
          </div>
        )}
      </div>
    </SettingCard>
  );
};

export default KeywordSettingCard;
