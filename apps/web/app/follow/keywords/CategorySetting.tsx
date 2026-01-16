"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlusIcon, Search } from "lucide-react";
import { Category } from "@/app/generated/prisma";
import { SettingCard } from "@/components/common";
import EditCategoryDialog from "./CategoryDialog";
import CategoryTable from "./Categories";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  initialCategories?: Category[];
}

// Fetcher function for categories
async function fetchCategories() {
  const response = await fetch("/api/follow/categories");
  if (!response.ok) {
    throw new Error("Failed to fetch categories");
  }
  const data = await response.json();
  // Categories API returns array directly, not { items: [...] }
  return Array.isArray(data) ? data : [];
}

const CategorySettingCard = ({ initialCategories }: Props) => {
  const [searchQuery, setSearchQuery] = useState("");

  // Use React Query to fetch categories data
  const {
    data: categories,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["categories"],
    queryFn: fetchCategories,
    initialData: initialCategories,
  });

  if (error) {
    return (
      <SettingCard
        title="Manage Keyword Categories"
        description="Error loading categories. Please try again."
        count={0}
        countLabel="categories"
      />
    );
  }

  // 应用搜索筛选
  const filteredCategories = (categories || []).filter(
    (category: Category) =>
      category.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      category.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <SettingCard
      title="Manage Keyword Categories"
      description="You can manage your keyword categories here."
      count={filteredCategories.length}
      countLabel="categories"
    >
      <div className="space-y-4">
        <div className="flex gap-4 justify-between items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search categories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <EditCategoryDialog
            triggerButton={
              <Button>
                <PlusIcon className="size-4" />
                Add Category
              </Button>
            }
          />
        </div>
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (
          <CategoryTable categories={filteredCategories} />
        )}
      </div>
    </SettingCard>
  );
};

export default CategorySettingCard;
