"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";

export type ContentItem = {
  id: string;
  title: string;
  summary: string;
  markdown: string;
  platform: string;
  time: string;
  url?: string | null;
  image?: string | null; // 封面图（可选）
  type: string;
  summaryView?: {
    title: string;
    summary: string;
    source: string;
    ingestedAt: string;
    previewMediaType?: "image" | "audio" | "video" | "file" | "text";
    mediaCount?: number;
    hasImage: boolean;
    layout: "image" | "text";
  };
  detailView?: {
    title: string;
    author: string | null;
    content: string;
    markdown: string;
    images: string[];
    audios?: string[];
    files?: string[];
    links: string[];
    sourceUrl: string | null;
    publishedAt: string;
    recordId: string | null;
    recordType: string | null;
  };
  media?: Array<{
    type: "image" | "audio" | "video" | "file";
    url: string;
    mimeType: string | null;
    name: string | null;
    size: number | null;
    duration: number | null;
    thumbnailUrl: string | null;
  }>;
  relation?: {
    recordId: string | null;
    recordIndex: number | null;
    relatedKey: string;
  };
  rawRecordContent?: Record<string, unknown>;
  subjectMatches?: Array<{
    subjectId: string;
    ruleScore: number | null;
    aiScore: number | null;
    score: number | null;
    matchedIncludes: string[];
    matchedExcludes: string[];
    matchSource: "QUERY" | "GATHER" | "AI" | "FUSED";
    reason: string | null;
  }>;
};

type FollowContentFilters = {
  platform?: string;
  search?: string;
  from?: string;
  to?: string;
};

type FollowContentContextValue = {
  contents: ContentItem[];
  selectedContent: ContentItem | null;
  isLoading: boolean;
  error: Error | null;
  selectContent: (id: string) => void;
  filters: {
    platform: string;
    year: string;
    month: string;
    day: string;
    search: string;
  };
  setPlatform: (val: string) => void;
  setYear: (val: string) => void;
  setMonth: (val: string) => void;
  setDay: (val: string) => void;
  setSearch: (val: string) => void;
};

const FollowContentContext = createContext<
  FollowContentContextValue | undefined
>(undefined);

const buildDateRange = (year?: string, month?: string, day?: string) => {
  if (!year) {
    return { from: undefined, to: undefined };
  }

  const parsedYear = Number(year);
  if (Number.isNaN(parsedYear)) {
    return { from: undefined, to: undefined };
  }

  const parsedMonth = month ? Number(month) - 1 : 0;
  const parsedDay = day ? Number(day) : 1;
  const start = new Date(Date.UTC(parsedYear, parsedMonth, parsedDay));

  let end: Date;
  if (day) {
    end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 1);
  } else if (month) {
    end = new Date(Date.UTC(parsedYear, parsedMonth + 1, 1));
  } else {
    end = new Date(Date.UTC(parsedYear + 1, 0, 1));
  }

  return { from: start.toISOString(), to: end.toISOString() };
};

const fetchContents = async (filters: FollowContentFilters) => {
  const params = new URLSearchParams();

  if (filters.platform) {
    params.set("platform", filters.platform);
  }
  if (filters.search) {
    params.set("search", filters.search);
  }
  if (filters.from) {
    params.set("from", filters.from);
  }
  if (filters.to) {
    params.set("to", filters.to);
  }

  params.set("includeSubjectMatches", "true");
  params.set("limit", "30");
  const url = `/api/focus-bulletin/content${
    params.toString() ? `?${params.toString()}` : ""
  }`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Can not fetch contents");
  }
  return response.json();
};

export const useFollowContent = () => {
  const context = useContext(FollowContentContext);
  if (!context) {
    throw new Error(
      "useFollowContent must be used within a FollowContentProvider"
    );
  }
  return context;
};

export const FollowContentProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [platform, setPlatform] = useState("");
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [search, setSearch] = useState("");
  const [selectedContentId, setSelectedContentId] = useState<string | null>(
    null
  );
  const queryClient = useQueryClient();

  const { from, to } = useMemo(
    () => buildDateRange(year, month, day),
    [year, month, day]
  );

  const queryFilters = useMemo(
    () => ({ platform, search, from, to }),
    [platform, search, from, to]
  );

  const { data, isLoading, error } = useQuery({
    queryKey: ["follow-content", queryFilters],
    queryFn: () => fetchContents(queryFilters),
    placeholderData: (prev) => prev,
  });

  useEffect(() => {
    const es = new EventSource("/api/focus-bulletin/content/stream");
    const refresh = () => {
      queryClient.invalidateQueries({
        queryKey: ["follow-content"],
      });
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data?.type === "content:created" || data?.type === "content:deleted") {
          refresh();
        }
      } catch {
        // ignore invalid payload
      }
    };

    es.onerror = () => {
      // browser auto-reconnects
    };

    return () => {
      es.close();
    };
  }, [queryClient]);

  const contents: ContentItem[] = useMemo(
    () => data?.items ?? [],
    [data?.items]
  );

  useEffect(() => {
    if (isLoading) {
      return;
    }
    if (!contents.length) {
      setSelectedContentId(null);
      return;
    }

    const alreadySelected = contents.some(
      (item) => item.id === selectedContentId
    );
    if (!alreadySelected) {
      setSelectedContentId(contents[0].id);
    }
  }, [contents, isLoading, selectedContentId]);

  const selectedContent = useMemo(
    () => contents.find((item) => item.id === selectedContentId) ?? null,
    [contents, selectedContentId]
  );

  const selectContent = useCallback((id: string) => {
    setSelectedContentId(id);
  }, []);

  const contextValue = useMemo(
    () => ({
      contents,
      selectedContent,
      isLoading,
      error: error ?? null,
      selectContent,
      filters: { platform, year, month, day, search },
      setPlatform,
      setYear,
      setMonth,
      setDay,
      setSearch,
    }),
    [
      contents,
      selectedContent,
      isLoading,
      error,
      selectContent,
      platform,
      year,
      month,
      day,
      search,
    ]
  );

  return (
    <FollowContentContext.Provider value={contextValue}>
      {children}
    </FollowContentContext.Provider>
  );
};
