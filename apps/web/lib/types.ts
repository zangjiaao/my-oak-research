import {
  Query,
  Keyword,
  Source,
  WebSourceConfig,
  DarknetSourceConfig,
  SocialMediaSourceConfig,
  SearchEngineSourceConfig,
  SourceIdentity,
  Proxy,
  Credential,
  QueryRun,
  QuerySourcePolicy,
} from "@/app/generated/prisma";

type QueryRunSummary = Pick<
  QueryRun,
  "id" | "status" | "progress" | "startedAt" | "finishedAt" | "error"
>;

export type QueryWithAggregations = Query & {
  keywords: Keyword[];
  sources: Source[];
  sourcePolicies: QuerySourcePolicy[];
  keywordsCount: number;
  sourcesCount: number;
  latestRun?: QueryRunSummary;
};

type SourceBaseWithRelations = Source & {
  proxy?: Proxy | null;
  credential?: Credential | null;
  identity?: SourceIdentity | null;
};

export type WebSource = SourceBaseWithRelations & {
  web: WebSourceConfig;
};
export type DarknetSource = SourceBaseWithRelations & {
  darknet: DarknetSourceConfig;
};
export type SocialMediaSource = SourceBaseWithRelations & {
  social: SocialMediaSourceConfig & {
    proxy?: Proxy | null;
    credential?: Credential | null;
  };
};
export type SearchEngineSource = SourceBaseWithRelations & {
  search: SearchEngineSourceConfig & {
    credential?: Credential | null;
  };
};

export type SourceWithRelations =
  | WebSource
  | DarknetSource
  | SocialMediaSource
  | SearchEngineSource;
