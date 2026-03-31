import {
  Source,
  WebSourceConfig,
  DarknetSourceConfig,
  SocialMediaSourceConfig,
  SearchEngineSourceConfig,
  SourceIdentity,
  Proxy,
  Credential,
} from "@/app/generated/prisma";

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

export type TopicTermType = "CORE" | "EXPANSION" | "EXCLUSION";
export type FrequencyType =
  | "MANUAL"
  | "HOURLY"
  | "DAILY"
  | "WEEKLY"
  | "MONTHLY"
  | "CRONTAB";
export type JobType = "TOPIC_RETRIEVAL" | "SOURCE_INGEST" | "SOURCE_ONESHOT";

export interface TopicTerm {
  id: string;
  topicId: string;
  type: TopicTermType;
  value: string;
  weight: number;
}

export interface TopicWithAggregations {
  id: string;
  name: string;
  description?: string | null;
  terms?: TopicTerm[];
  termsCount?: number;
}

export interface JobSourceBinding {
  id: string;
  sourceId: string;
  recallBindingOverride?: {
    enabled?: boolean;
    argKeys?: string[];
  } | null;
  source?: SourceWithRelations;
}

export interface JobTopicBinding {
  id: string;
  topicId: string;
  topic?: TopicWithAggregations;
}

export interface JobRunSummary {
  id: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  progress: number;
  startedAt?: string | null;
  finishedAt?: string | null;
  error?: string | null;
}

export interface JobWithAggregations {
  id: string;
  name: string;
  type: JobType;
  enabled: boolean;
  frequency: FrequencyType;
  cronSchedule?: string | null;
  triggerMode?: string | null;
  jobTopics?: JobTopicBinding[];
  jobSources?: JobSourceBinding[];
  runs?: JobRunSummary[];
  latestRun?: JobRunSummary | null;
}
