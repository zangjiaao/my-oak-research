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

const DEFAULT_TOPIC_FILTER_MIN_SCORE = Number(
  process.env.NEXT_PUBLIC_TOPIC_FILTER_MIN_SCORE ?? 0.4
);

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
  search?: string;
  topicIds?: string[];
  sort?: "time" | "relevance";
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
    search: string;
    topicIds: string[];
    sort: "time" | "relevance";
  };
  topicOptions: TopicOption[];
  topicOptionsError: string | null;
  topicOptionsLoading: boolean;
  setSearch: (val: string) => void;
  setTopicIds: (val: string[]) => void;
  setSort: (val: "time" | "relevance") => void;
};

const FollowContentContext = createContext<FollowContentContextValue | undefined>(
  undefined
);

const fetchContents = async (filters: FollowContentFilters) => {
  const params = new URLSearchParams();

  if (filters.search) {
    params.set("search", filters.search);
  }
  for (const topicId of filters.topicIds ?? []) {
    if (topicId) {
      params.append("topicId", topicId);
    }
  }
  if ((filters.topicIds?.length ?? 0) > 0) {
    params.set("minTopicScore", String(DEFAULT_TOPIC_FILTER_MIN_SCORE));
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
  const [search, setSearch] = useState("");
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const [sort, setSort] = useState<"time" | "relevance">("relevance");
  const [selectedContentId, setSelectedContentId] = useState<string | null>(
    null
  );
  const queryClient = useQueryClient();
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

  const queryFilters = useMemo(
    () => ({
      search,
      topicIds,
      sort,
    }),
    [
      search,
      topicIds,
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
    if (sort === "relevance") {
      return [...items].sort((left, right) => {
        const leftScore = Math.max(
          ...(left.topicScores ?? [])
            .filter((score) =>
              topicIds.length ? topicIds.includes(score.topicId) : true
            )
            .map((score) => score.finalScore ?? -1),
          -1
        );
        const rightScore = Math.max(
          ...(right.topicScores ?? [])
            .filter((score) =>
              topicIds.length ? topicIds.includes(score.topicId) : true
            )
            .map((score) => score.finalScore ?? -1),
          -1
        );
        if (leftScore !== rightScore) {
          return rightScore - leftScore;
        }
        const leftTime = new Date(left.detailView?.publishedAt ?? left.time).getTime();
        const rightTime = new Date(right.detailView?.publishedAt ?? right.time).getTime();
        return rightTime - leftTime;
      });
    }
    return items;
  }, [data?.items, sort, topicIds]);

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
      topicOptions: topicOptionsData ?? [],
      topicOptionsError:
        topicOptionsQueryError instanceof Error
          ? topicOptionsQueryError.message
          : null,
      topicOptionsLoading,
      filters: {
        search,
        topicIds,
        sort,
      },
      setSearch,
      setTopicIds,
      setSort,
    }),
    [
      contents,
      selectedContent,
      isLoading,
      contentQueryError,
      selectContent,
      topicOptionsData,
      topicOptionsQueryError,
      topicOptionsLoading,
      search,
      topicIds,
      sort,
    ]
  );

  return (
    <FollowContentContext.Provider value={contextValue}>
      {children}
    </FollowContentContext.Provider>
  );
};
