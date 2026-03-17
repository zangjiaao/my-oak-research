import {
  BbPreset,
  Query,
  Keyword,
  Source,
  WebSourceConfig,
  DarknetSourceConfig,
  SocialMediaSourceConfig,
  SearchEngineSourceConfig,
  SourcePresetBinding,
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

type SourcePresetBindingWithPreset = SourcePresetBinding & {
  preset: Pick<
    BbPreset,
    "id" | "key" | "version" | "name" | "platform" | "scriptRelPath" | "status" | "isActive"
  >;
};

type SourceBaseWithRelations = Source & {
  proxy?: Proxy | null;
  credential?: Credential | null;
  presetBindings?: SourcePresetBindingWithPreset[];
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
  search: SearchEngineSourceConfig;
};

export type SourceWithRelations =
  | WebSource
  | DarknetSource
  | SocialMediaSource
  | SearchEngineSource;
