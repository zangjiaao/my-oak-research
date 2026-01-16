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

const platformOptions = [
  "Twitter",
  "Facebook",
  "Instagram",
  "LinkedIn",
  "YouTube",
  "TikTok",
  "Reddit",
  "Pinterest",
  "Snapchat",
  "Discord",
  "Telegram",
  "WhatsApp",
  "WeChat",
  "Weibo",
  "Weixin",
];

const years = ["2025", "2024", "2023", "2022", "2021"];

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
  const { filters, setPlatform, setYear, setMonth, setDay, setSearch } =
    useFollowContent();

  return (
    <div className="flex gap-2 m-1 flex-wrap lg:flex-nowrap">
      <Select value={filters.platform} onValueChange={setPlatform}>
        <SelectTrigger>
          <SelectValue placeholder="Platform" />
        </SelectTrigger>
        <SelectContent>
          {platformOptions.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filters.year} onValueChange={setYear}>
        <SelectTrigger>
          <SelectValue placeholder="Year" />
        </SelectTrigger>
        <SelectContent>
          {years.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filters.month} onValueChange={setMonth}>
        <SelectTrigger>
          <SelectValue placeholder="Month" />
        </SelectTrigger>
        <SelectContent>
          {months.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filters.day} onValueChange={setDay}>
        <SelectTrigger>
          <SelectValue placeholder="Day" />
        </SelectTrigger>
        <SelectContent>
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
