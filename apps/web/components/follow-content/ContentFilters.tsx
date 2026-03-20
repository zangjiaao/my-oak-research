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
  const { contents, filters, setPlatform, setYear, setMonth, setDay, setSearch } =
    useFollowContent();
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
    </div>
  );
};
