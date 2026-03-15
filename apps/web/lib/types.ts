import {
  Query,
  Keyword,
  Source,
  WebSourceConfig,
  DarknetSourceConfig,
  SocialMediaSourceConfig,
  SearchEngineSourceConfig,
  Proxy,
  Credential,
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

export type WebSource = Source & {
  web: WebSourceConfig;
  proxy?: Proxy | null;
  credential?: Credential | null;
};
export type DarknetSource = Source & {
  darknet: DarknetSourceConfig;
  proxy?: Proxy | null;
  credential?: Credential | null;
};
export type SocialMediaSource = Source & {
  social: SocialMediaSourceConfig & {
    proxy?: Proxy | null;
    credential?: Credential | null;
  };
  proxy?: Proxy | null;
  credential?: Credential | null;
};
export type SearchEngineSource = Source & {
  search: SearchEngineSourceConfig;
  proxy?: Proxy | null;
  credential?: Credential | null;
};

export type SourceWithRelations =
  | WebSource
  | DarknetSource
  | SocialMediaSource
  | SearchEngineSource;
