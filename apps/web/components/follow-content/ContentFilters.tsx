"use client";

import React from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MultiSelect } from "@/components/common/multi-select";
import { useFollowContent } from "./context";

export const ContentFilters = () => {
  const {
    filters,
    topicOptions,
    topicOptionsError,
    topicOptionsLoading,
    setSearch,
    setTopicIds,
    setSort,
  } = useFollowContent();

  return (
    <div className="m-1 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[220px] flex-1">
          <MultiSelect
            options={topicOptions.map((topic) => ({
              label: topic.name,
              value: topic.id,
            }))}
            value={filters.topicIds}
            onValueChange={setTopicIds}
            placeholder={
              topicOptionsLoading ? "Loading topics..." : "筛选 Topic（可多选）"
            }
          />
        </div>

        <Select
          value={filters.sort}
          onValueChange={(value) => setSort(value as "time" | "relevance")}
        >
          <SelectTrigger className="w-[150px] shrink-0">
            <SelectValue placeholder="排序方式" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="relevance">按评分排序</SelectItem>
            <SelectItem value="time">按日期排序</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <div className="min-w-[220px] flex-1">
          <Input
            placeholder="搜索内容"
            className="min-w-0 rounded-full"
            icon={<Search size={16} />}
            iconPosition="right"
            value={filters.search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      {topicOptionsError ? (
        <div className="px-1 text-xs text-destructive">
          Topics 加载失败，请刷新页面重试
        </div>
      ) : null}
    </div>
  );
};
