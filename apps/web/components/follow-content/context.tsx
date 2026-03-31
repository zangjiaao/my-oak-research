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
  topicScores?: Array<{
    topicId: string;
    vectorScore: number | null;
    keywordScore: number | null;
    exclusionPenalty: number | null;
    finalScore: number | null;
    reason: string | null;
  }>;
  topicScore?: {
    topicId: string;
    finalScore: number | null;
  } | null;
  entities?: {
    persons: string[];
    orgs: string[];
    locations: string[];
  } | null;
  feedback?: {
    topicId: string;
    vote: "UP" | "DOWN" | "NONE";
    note?: string | null;
  } | null;
};

type FollowContentFilters = {
  platform?: string;
  search?: string;
  from?: string;
  to?: string;
  subjectId?: string;
  minMatchScore?: string;
  topicId?: string;
  minTopicScore?: string;
  matchSource?: "QUERY" | "GATHER" | "AI" | "FUSED";
  sort?: "time" | "relevance" | "matchScore" | "topicScore";
};

type SubjectOption = {
  id: string;
  name: string;
};

type TopicOption = {
  id: string;
  name: string;
};

type FollowContentResponse = {
  items: ContentItem[];
  nextCursor: string | null;
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
    subjectId: string;
    minMatchScore: string;
    topicId: string;
    minTopicScore: string;
    matchSource: string;
    sort: "time" | "relevance" | "matchScore" | "topicScore";
  };
  subjectOptions: SubjectOption[];
  topicOptions: TopicOption[];
  subjectOptionsError: string | null;
  subjectOptionsLoading: boolean;
  topicOptionsError: string | null;
  topicOptionsLoading: boolean;
  setPlatform: (val: string) => void;
  setYear: (val: string) => void;
  setMonth: (val: string) => void;
  setDay: (val: string) => void;
  setSearch: (val: string) => void;
  setSubjectId: (val: string) => void;
  setMinMatchScore: (val: string) => void;
  setTopicId: (val: string) => void;
  setMinTopicScore: (val: string) => void;
  setMatchSource: (val: string) => void;
  setSort: (val: "time" | "relevance" | "matchScore" | "topicScore") => void;
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
  if (filters.subjectId) {
    params.set("subjectId", filters.subjectId);
  }
  if (filters.minMatchScore) {
    params.set("minMatchScore", filters.minMatchScore);
  }
  if (filters.topicId) {
    params.set("topicId", filters.topicId);
  }
  if (filters.minTopicScore) {
    params.set("minTopicScore", filters.minTopicScore);
  }
  if (filters.matchSource) {
    params.set("matchSource", filters.matchSource);
  }
  if (filters.sort) {
    params.set("sort", filters.sort);
  }

  params.set("includeSubjectMatches", "true");
  params.set("includeTopicScores", "true");
  params.set("includeEntities", "true");
  params.set("includeFeedback", "true");
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
  const [subjectId, setSubjectId] = useState("");
  const [minMatchScore, setMinMatchScore] = useState("");
  const [topicId, setTopicId] = useState("");
  const [minTopicScore, setMinTopicScore] = useState("");
  const [matchSource, setMatchSource] = useState("");
  const [sort, setSort] = useState<"time" | "relevance" | "matchScore" | "topicScore">("relevance");
  const [selectedContentId, setSelectedContentId] = useState<string | null>(
    null
  );
  const queryClient = useQueryClient();
  const {
    data: subjectOptionsData,
    error: subjectOptionsQueryError,
    isLoading: subjectOptionsLoading,
  } = useQuery({
    queryKey: ["keywords", "subject-options"],
    queryFn: async (): Promise<SubjectOption[]> => {
      const response = await fetch("/api/follow/keywords?pageSize=100", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("Can not fetch subjects");
      }
      const data = await response.json();
      const items = Array.isArray(data?.items) ? data.items : [];
      return items
        .map((item: { id?: string; name?: string }) => ({
          id: String(item.id ?? ""),
          name: String(item.name ?? ""),
        }))
        .filter((item: SubjectOption) => Boolean(item.id && item.name));
    },
  });
  const {
    data: topicOptionsData,
    error: topicOptionsQueryError,
    isLoading: topicOptionsLoading,
  } = useQuery({
    queryKey: ["topics", "topic-options"],
    queryFn: async (): Promise<TopicOption[]> => {
      const response = await fetch("/api/follow/topics", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("Can not fetch topics");
      }
      const data = await response.json();
      const items = Array.isArray(data) ? data : [];
      return items
        .map((item: { id?: string; name?: string }) => ({
          id: String(item.id ?? ""),
          name: String(item.name ?? ""),
        }))
        .filter((item: TopicOption) => Boolean(item.id && item.name));
    },
  });

  const { from, to } = useMemo(
    () => buildDateRange(year, month, day),
    [year, month, day]
  );

  const queryFilters = useMemo(
    () => ({
      platform,
      search,
      from,
      to,
      subjectId,
      minMatchScore,
      topicId,
      minTopicScore,
      matchSource:
        matchSource && matchSource !== "__all__"
          ? (matchSource as "QUERY" | "GATHER" | "AI" | "FUSED")
          : undefined,
      sort,
    }),
    [
      platform,
      search,
      from,
      to,
      subjectId,
      minMatchScore,
      topicId,
      minTopicScore,
      matchSource,
      sort,
    ]
  );

  const {
    data,
    isLoading,
    error: contentQueryError,
  } = useQuery<FollowContentResponse>({
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

  const contents: ContentItem[] = useMemo(() => {
    const items: ContentItem[] = data?.items ?? [];
    if (sort === "topicScore" || sort === "relevance") {
      return [...items].sort((left, right) => {
        const leftScore =
          left.topicScores?.find((score) =>
            topicId ? score.topicId === topicId : true
          )?.finalScore ?? -1;
        const rightScore =
          right.topicScores?.find((score) =>
            topicId ? score.topicId === topicId : true
          )?.finalScore ?? -1;
        if (leftScore !== rightScore) {
          return rightScore - leftScore;
        }
        const leftTime = new Date(left.detailView?.publishedAt ?? left.time).getTime();
        const rightTime = new Date(right.detailView?.publishedAt ?? right.time).getTime();
        return rightTime - leftTime;
      });
    }
    if (sort !== "matchScore") {
      return items;
    }
    return [...items].sort((left, right) => {
      const leftScore =
        left.subjectMatches?.find((match) =>
          subjectId ? match.subjectId === subjectId : true
        )?.score ?? -1;
      const rightScore =
        right.subjectMatches?.find((match) =>
          subjectId ? match.subjectId === subjectId : true
        )?.score ?? -1;
      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }
      const leftTime = new Date(left.detailView?.publishedAt ?? left.time).getTime();
      const rightTime = new Date(right.detailView?.publishedAt ?? right.time).getTime();
      return rightTime - leftTime;
    });
  }, [data?.items, sort, subjectId, topicId]);

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
      error: contentQueryError ?? null,
      selectContent,
      subjectOptions: subjectOptionsData ?? [],
      topicOptions: topicOptionsData ?? [],
      subjectOptionsError:
        subjectOptionsQueryError instanceof Error
          ? subjectOptionsQueryError.message
          : null,
      subjectOptionsLoading,
      topicOptionsError:
        topicOptionsQueryError instanceof Error
          ? topicOptionsQueryError.message
          : null,
      topicOptionsLoading,
      filters: {
        platform,
        year,
        month,
        day,
        search,
        subjectId,
        minMatchScore,
        topicId,
        minTopicScore,
        matchSource,
        sort,
      },
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
    }),
    [
      contents,
      selectedContent,
      isLoading,
      contentQueryError,
      selectContent,
      subjectOptionsData,
      topicOptionsData,
      subjectOptionsQueryError,
      subjectOptionsLoading,
      topicOptionsQueryError,
      topicOptionsLoading,
      platform,
      year,
      month,
      day,
      search,
      subjectId,
      minMatchScore,
      topicId,
      minTopicScore,
      matchSource,
      sort,
    ]
  );

  return (
    <FollowContentContext.Provider value={contextValue}>
      {children}
    </FollowContentContext.Provider>
  );
};
