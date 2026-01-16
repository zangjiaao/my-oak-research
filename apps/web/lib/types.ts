import {
  Query,
  Keyword,
  Source,
  WebSourceConfig,
  DarknetSourceConfig,
  SocialMediaSourceConfig,
  SearchEngineSourceConfig,
  Proxy,
  QueryRun,
  TaskStatus,
} from "@/app/generated/prisma";

type QueryRunSummary = Pick<
  QueryRun,
  "id" | "status" | "progress" | "startedAt" | "finishedAt" | "error"
>;

export type QueryWithAggregations = Query & {
  keywords: Keyword[];
  sources: Source[];
  keywordsCount: number;
  sourcesCount: number;
  latestRun?: QueryRunSummary;
};

export type WebSource = Source & { web: WebSourceConfig; proxy?: Proxy | null };
export type DarknetSource = Source & {
  darknet: DarknetSourceConfig;
  proxy?: Proxy | null;
};
export type SocialMediaSource = Source & {
  social: SocialMediaSourceConfig;
  proxy?: Proxy | null;
};
export type SearchEngineSource = Source & {
  search: SearchEngineSourceConfig;
  proxy?: Proxy | null;
};

export type SourceWithRelations =
  | WebSource
  | DarknetSource
  | SocialMediaSource
  | SearchEngineSource;
