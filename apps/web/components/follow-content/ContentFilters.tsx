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
import { Search } from "lucide-react";
import { useFollowContent } from "./context";

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
    setPlatform,
    setYear,
    setMonth,
    setDay,
    setSearch,
    setSubjectId,
    setMinMatchScore,
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
    <div className="flex gap-2 m-1 flex-wrap lg:flex-nowrap">
      <Select
        value={filters.platform || "__all__"}
        onValueChange={(value) => setPlatform(value === "__all__" ? "" : value)}
      >
        <SelectTrigger>
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
        <SelectTrigger>
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
        <SelectTrigger>
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
        <SelectTrigger>
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

      <Input
        placeholder="Search content"
        className="rounded-full"
        icon={<Search size={16} />}
        iconPosition="right"
        value={filters.search}
        onChange={(event) => setSearch(event.target.value)}
      />

      <Select
        value={filters.subjectId || "__all__"}
        onValueChange={(value) => setSubjectId(value === "__all__" ? "" : value)}
      >
        <SelectTrigger>
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

      <Input
        type="number"
        min={0}
        max={1}
        step={0.05}
        placeholder="Min score (0-1)"
        value={filters.minMatchScore}
        onChange={(event) => setMinMatchScore(event.target.value)}
      />

      <Select
        value={filters.matchSource || "__all__"}
        onValueChange={(value) => setMatchSource(value === "__all__" ? "" : value)}
      >
        <SelectTrigger>
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

      <Select value={filters.sort} onValueChange={(value) => setSort(value as "time" | "matchScore")}>
        <SelectTrigger>
          <SelectValue placeholder="Sort" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="time">Sort by Time</SelectItem>
          <SelectItem value="matchScore">Sort by Match Score</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
};
