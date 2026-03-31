import { useQuery } from "@tanstack/react-query";
import { Proxy } from "@/app/generated/prisma";
import {
  JobWithAggregations,
  SourceWithRelations,
  TopicWithAggregations,
} from "@/lib/types";

const fetcher = async <T>(url: string): Promise<T[]> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch from ${url}`);
  }
  const data = await response.json();
  if (Array.isArray(data)) {
    return data;
  }
  if (data && Array.isArray(data.items)) {
    return data.items;
  }
  return [];
};

export const useFollow = () => {
  const { data: sources = [], ...sourcesQuery } = useQuery<
    SourceWithRelations[]
  >({
    queryKey: ["sources"],
    queryFn: () =>
      fetcher<SourceWithRelations>("/api/follow/sources?includeRelations=true"),
  });

  const { data: proxies = [], ...proxiesQuery } = useQuery<Proxy[]>({
    queryKey: ["proxies"],
    queryFn: () => fetcher("/api/follow/proxy"),
  });

  const { data: topics = [], ...topicsQuery } = useQuery<
    TopicWithAggregations[]
  >({
    queryKey: ["topics"],
    queryFn: () =>
      fetcher<TopicWithAggregations>("/api/follow/topics?includeRelations=true"),
  });

  const { data: jobs = [], ...jobsQuery } = useQuery<JobWithAggregations[]>({
    queryKey: ["jobs"],
    queryFn: () => fetcher<JobWithAggregations>("/api/follow/jobs"),
  });

  return {
    sources,
    sourcesQuery,
    proxies,
    proxiesQuery,
    topics,
    topicsQuery,
    jobs,
    jobsQuery,
  };
};
