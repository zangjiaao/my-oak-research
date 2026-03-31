"use client";

import React from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, SlidersHorizontal } from "lucide-react";
import { useFollowContent } from "./context";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

const months = Array.from({ length: 12 }, (_, index) => ({
  value: String(index + 1),
  label: new Date(0, index).toLocaleString("en", {
    month: "long",
  }),
}));

const days = Array.from({ length: 31 }, (_, index) => ({
  value: String(index + 1),
  label: String(index + 1),
}));

export const ContentFilters = () => {
  const {
    contents,
    filters,
    subjectOptions,
    topicOptions,
    subjectOptionsError,
    subjectOptionsLoading,
    topicOptionsError,
    topicOptionsLoading,
    setPlatform,
    setYear,
    setMonth,
    setDay,
    setSearch,
    setSubjectId,
    setMinMatchScore,
    setTopicId,
    setMinTopicScore,
    setMatchSource,
    setSort,
  } = useFollowContent();
  const platformOptions = Array.from(
    new Set(contents.map((item) => item.summaryView?.source ?? item.platform))
  )
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  const currentYear = new Date().getUTCFullYear();
  const years = Array.from(
    new Set([
      String(currentYear),
      ...contents.map((item) =>
        String(new Date(item.detailView?.publishedAt ?? item.time).getUTCFullYear())
      ),
    ])
  ).sort((a, b) => Number(b) - Number(a));

  return (
    <Collapsible className="m-1 space-y-2">
      <div className="flex items-center gap-2">
        <div className="min-w-[220px] flex-1">
          <Input
            placeholder="Search content"
            className="min-w-0 rounded-full"
            icon={<Search size={16} />}
            iconPosition="right"
            value={filters.search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <CollapsibleTrigger asChild>
          <Button variant="outline" className="shrink-0 gap-1.5">
            <SlidersHorizontal className="size-4" />
            高级筛选
          </Button>
        </CollapsibleTrigger>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={filters.platform || "__all__"}
          onValueChange={(value) => setPlatform(value === "__all__" ? "" : value)}
        >
          <SelectTrigger className="min-w-[150px]">
            <SelectValue placeholder="Platform" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Platforms</SelectItem>
            {platformOptions.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.year || "__all__"}
          onValueChange={(value) => {
            if (value === "__all__") {
              setYear("");
              setMonth("");
              setDay("");
              return;
            }
            setYear(value);
          }}
        >
          <SelectTrigger className="min-w-[120px]">
            <SelectValue placeholder="Year" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Years</SelectItem>
            {years.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.month || "__all__"}
          onValueChange={(value) => {
            if (value === "__all__") {
              setMonth("");
              setDay("");
              return;
            }
            setMonth(value);
          }}
        >
          <SelectTrigger className="min-w-[130px]">
            <SelectValue placeholder="Month" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Months</SelectItem>
            {months.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.day || "__all__"}
          onValueChange={(value) => setDay(value === "__all__" ? "" : value)}
        >
          <SelectTrigger className="min-w-[110px]">
            <SelectValue placeholder="Day" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Days</SelectItem>
            {days.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <CollapsibleContent className="rounded-lg border border-border/70 bg-muted/20 p-2">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={filters.subjectId || "__all__"}
            onValueChange={(value) =>
              setSubjectId(value === "__all__" ? "" : value)
            }
          >
            <SelectTrigger className="min-w-[180px]">
              <SelectValue placeholder="Subject" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Subjects</SelectItem>
              {subjectOptions.map((subject) => (
                <SelectItem key={subject.id} value={subject.id}>
                  {subject.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {subjectOptionsLoading ? (
            <span className="text-xs text-muted-foreground">Loading subjects...</span>
          ) : null}
          {subjectOptionsError ? (
            <span className="text-xs text-destructive">
              Subjects 加载失败，请刷新页面重试
            </span>
          ) : null}

          <Select
            value={filters.topicId || "__all__"}
            onValueChange={(value) => setTopicId(value === "__all__" ? "" : value)}
          >
            <SelectTrigger className="min-w-[180px]">
              <SelectValue placeholder="Topic" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Topics</SelectItem>
              {topicOptions.map((topic) => (
                <SelectItem key={topic.id} value={topic.id}>
                  {topic.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {topicOptionsLoading ? (
            <span className="text-xs text-muted-foreground">Loading topics...</span>
          ) : null}
          {topicOptionsError ? (
            <span className="text-xs text-destructive">
              Topics 加载失败，请刷新页面重试
            </span>
          ) : null}

          <Input
            type="number"
            min={0}
            max={1}
            step={0.05}
            placeholder="Min score (0-1)"
            className="min-w-[150px]"
            value={filters.minMatchScore}
            onChange={(event) => setMinMatchScore(event.target.value)}
          />
          <Input
            type="number"
            min={0}
            step={0.1}
            placeholder="Min topic score"
            className="min-w-[150px]"
            value={filters.minTopicScore}
            onChange={(event) => setMinTopicScore(event.target.value)}
          />

          <Select
            value={filters.matchSource || "__all__"}
            onValueChange={(value) =>
              setMatchSource(value === "__all__" ? "" : value)
            }
          >
            <SelectTrigger className="min-w-[160px]">
              <SelectValue placeholder="Match Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Sources</SelectItem>
              <SelectItem value="FUSED">FUSED</SelectItem>
              <SelectItem value="AI">AI</SelectItem>
              <SelectItem value="GATHER">GATHER</SelectItem>
              <SelectItem value="QUERY">QUERY</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={filters.sort}
            onValueChange={(value) =>
              setSort(value as "time" | "matchScore" | "topicScore")
            }
          >
            <SelectTrigger className="min-w-[150px]">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="time">Time Desc</SelectItem>
              <SelectItem value="matchScore">Score Desc</SelectItem>
              <SelectItem value="topicScore">Topic Score Desc</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="ghost"
            onClick={() => {
              setSubjectId("");
              setMinMatchScore("");
              setTopicId("");
              setMinTopicScore("");
              setMatchSource("");
              setSort("time");
            }}
          >
            清空高级筛选
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
