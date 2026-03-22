export type SourceCategory = "STREAM" | "INTERACTIVE" | "RETRIEVAL";

export type SourceExecutionEngine = "gather_playwright" | "worker_api";

export type SourceCapabilityIntent = {
  key: string;
  intent: string;
  mode: string;
  title?: string;
  description?: string;
  sample?: {
    intentType?: string;
    intentArgs?: Record<string, unknown>;
    outputField?: unknown;
  };
};

export type SourceCapability = {
  platform: string;
  category: SourceCategory;
  execution: {
    engine: SourceExecutionEngine;
    driver: string;
  };
  tags: string[];
  authRequirement: {
    required: boolean;
    kind?: string;
    description?: string;
  };
  intents: SourceCapabilityIntent[];
};

function buildWorkerApiCapability(input: {
  platform: string;
  tags: string[];
  auth: { required: boolean; kind?: string; description?: string };
  title: string;
  description: string;
}): SourceCapability {
  const platform = input.platform.toUpperCase().trim();
  return {
    platform,
    category: "RETRIEVAL",
    execution: {
      engine: "worker_api",
      driver: "http",
    },
    tags: Array.from(new Set(input.tags)),
    authRequirement: input.auth,
    intents: [
      {
        key: `${platform.toLowerCase()}.search.worker_api`,
        intent: "search",
        mode: "api",
        title: input.title,
        description: input.description,
        sample: {
          intentType: "search",
          intentArgs: { query: "" },
        },
      },
    ],
  };
}

export function buildWorkerSourceCapabilities(): SourceCapability[] {
  return [
    buildWorkerApiCapability({
      platform: "PARALLEL",
      tags: ["foreign"],
      title: "Parallel Search",
      description: "Parallel API search",
      auth: {
        required: true,
        kind: "parallel-api-key",
        description: "Parallel API credential",
      },
    }),
    buildWorkerApiCapability({
      platform: "TAVILY",
      tags: ["foreign"],
      title: "Tavily Search",
      description: "Tavily API search",
      auth: {
        required: true,
        kind: "tavily-api-key",
        description: "Tavily API credential",
      },
    }),
    buildWorkerApiCapability({
      platform: "ANSPIRE",
      tags: ["domestic"],
      title: "Anspire Search",
      description: "Anspire API search",
      auth: {
        required: false,
      },
    }),
  ];
}
