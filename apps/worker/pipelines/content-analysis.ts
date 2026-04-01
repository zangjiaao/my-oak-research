import { load } from "cheerio";
import { z } from "zod";
import { createHash } from "crypto";

import prisma from "@/lib/prisma";
const prismaAny = prisma as any;
import {
  Prisma,
  SourceCategory,
  ContentType,
  CrawlerEngine,
  KeywordStrategy,
  ContentSubjectMatchSource,
  QueryContentFilterMode,
  JobType,
} from "@/app/generated/prisma";
import {
  SourceWithRelations,
  SocialMediaSource,
  SearchEngineSource,
  WebSource,
  DarknetSource,
} from "@/lib/types";
import { llmGateway, browserAgent } from "@oak/agents";
import { createEmbedding } from "@oak/agents/embeddings";
import { publishTaskEvent, publishContentEvent } from "@/lib/queue";
import { logger } from "@/lib/logger";
import { downloadFile } from "@/lib/storage";
import { redact, stripPromptLike } from "@/lib/security";
import { writeWorkerApiIoLog } from "./api-io-log";
import { buildNormalizedRecordContent } from "./record-content-normalizer";
import { unwrapCredentialPayload } from "@/lib/credential-secret";
import { toVectorLiteral } from "@/lib/topic-vector";

const SKIP_AI_SUMMARY = process.env.COLLECTOR_SKIP_AI_SUMMARY !== "false";
const ENABLE_SUBJECT_AI_SCORE =
  process.env.COLLECTOR_ENABLE_SUBJECT_AI_SCORE !== "false";
const RETRIEVAL_VECTOR_TOP_N = Number(process.env.RETRIEVAL_VECTOR_TOP_N ?? 15);
const RETRIEVAL_BM25_TOP_N = Number(process.env.RETRIEVAL_BM25_TOP_N ?? 30);
const RETRIEVAL_FUSION_ALPHA = Math.min(
  1,
  Math.max(0, Number(process.env.RETRIEVAL_FUSION_ALPHA ?? 0.65))
);
const RETRIEVAL_CORE_WEIGHT = Math.max(
  0,
  Number(process.env.RETRIEVAL_CORE_WEIGHT ?? 0.1)
);
const RETRIEVAL_EXPANSION_WEIGHT = Math.max(
  0,
  Number(process.env.RETRIEVAL_EXPANSION_WEIGHT ?? 0.05)
);
const RETRIEVAL_EXCLUSION_WEIGHT = Math.max(
  0,
  Number(process.env.RETRIEVAL_EXCLUSION_WEIGHT ?? 0.03)
);
const RETRIEVAL_HIGH_THRESHOLD = Number(
  process.env.RETRIEVAL_HIGH_THRESHOLD ?? 0.7
);
const RETRIEVAL_LOW_THRESHOLD = Number(
  process.env.RETRIEVAL_LOW_THRESHOLD ?? 0.5
);
const RETRIEVAL_LLM_RERANK_ENABLED =
  process.env.RETRIEVAL_LLM_RERANK_ENABLED === "true";
const RETRIEVAL_LLM_RERANK_TOP_N = Math.max(
  1,
  Math.min(20, Number(process.env.RETRIEVAL_LLM_RERANK_TOP_N ?? 8))
);
const RETRIEVAL_LLM_RERANK_WEIGHT = Math.max(
  0,
  Math.min(1, Number(process.env.RETRIEVAL_LLM_RERANK_WEIGHT ?? 0.2))
);
const RETRIEVAL_LLM_RERANK_MIN_SCORE = Math.max(
  0,
  Math.min(1, Number(process.env.RETRIEVAL_LLM_RERANK_MIN_SCORE ?? 0.55))
);
const TOPIC_RECALL_LLM_ENABLED =
  process.env.TOPIC_RECALL_LLM_ENABLED !== "false";
const TOPIC_RECALL_QUERY_LIMIT = Number(
  process.env.TOPIC_RECALL_QUERY_LIMIT ?? 4
);
const TOPIC_RECALL_TIMEOUT_MS = Number(
  process.env.TOPIC_RECALL_TIMEOUT_MS ?? 8000
);
const TOPIC_RECALL_MIN_PER_LANGUAGE = Number(
  process.env.TOPIC_RECALL_MIN_PER_LANGUAGE ?? 1
);
const TOPIC_RECALL_COVERAGE_RETRY_LIMIT = Number(
  process.env.TOPIC_RECALL_COVERAGE_RETRY_LIMIT ?? 1
);
const TOPIC_RECALL_COVERAGE_PATCH_ENABLED =
  process.env.TOPIC_RECALL_COVERAGE_PATCH_ENABLED !== "false";
const DYNAMIC_TOPIC_SCORING_ENABLED =
  process.env.DYNAMIC_TOPIC_SCORING_ENABLED !== "false";
const CONTENT_CLEAN_LLM_ENABLED =
  process.env.CONTENT_CLEAN_LLM_ENABLED !== "false";
const CONTENT_AUTO_CLEAN_ENABLED =
  process.env.CONTENT_AUTO_CLEAN_ENABLED !== "false" &&
  process.env.CONTENT_AUTO_REWRITE_ENABLED !== "false";
const CONTENT_MEANING_GATE_ENABLED =
  process.env.CONTENT_MEANING_GATE_ENABLED !== "false";
const CONTENT_MEANING_GATE_PREVIEW_CHARS = Math.max(
  80,
  Number(process.env.CONTENT_MEANING_GATE_PREVIEW_CHARS ?? 200)
);
const CONTENT_MEANING_GATE_MIN_SCORE = Math.max(
  0,
  Math.min(1, Number(process.env.CONTENT_MEANING_GATE_MIN_SCORE ?? 0.45))
);
const CONTENT_FORMATTER_MAX_INPUT_CHARS = Math.max(
  1000,
  Number(process.env.CONTENT_FORMATTER_MAX_INPUT_CHARS ?? 16000)
);
const CONTENT_CLEAN_MARKDOWN_MIN_CHARS = Math.max(
  200,
  Number(process.env.CONTENT_CLEAN_MARKDOWN_MIN_CHARS ?? 800)
);
const CONTENT_CLEAN_MARKDOWN_MAX_CHARS = Math.max(
  CONTENT_CLEAN_MARKDOWN_MIN_CHARS,
  Number(process.env.CONTENT_CLEAN_MARKDOWN_MAX_CHARS ?? 1200)
);
const PRE_LLM_FILTER_LEVEL = (
  process.env.PRE_LLM_FILTER_LEVEL ?? "standard"
).toLowerCase();
const PRE_LLM_FILTER_ERROR_KEYWORD_HITS = Math.max(
  1,
  Number(process.env.PRE_LLM_FILTER_ERROR_KEYWORD_HITS ?? 2)
);
const PRE_LLM_FILTER_GARBLED_RATIO_THRESHOLD = Math.max(
  0.05,
  Math.min(0.9, Number(process.env.PRE_LLM_FILTER_GARBLED_RATIO_THRESHOLD ?? 0.35))
);
const PRE_LLM_FILTER_REPLACEMENT_RATIO_THRESHOLD = Math.max(
  0.005,
  Math.min(
    0.5,
    Number(process.env.PRE_LLM_FILTER_REPLACEMENT_RATIO_THRESHOLD ?? 0.02)
  )
);
const PRE_LLM_FILTER_TEMPLATE_LINE_RATIO = Math.max(
  0.2,
  Math.min(0.95, Number(process.env.PRE_LLM_FILTER_TEMPLATE_LINE_RATIO ?? 0.6))
);
const PRE_LLM_FILTER_REPEAT_LINE_RATIO = Math.max(
  0.2,
  Math.min(0.95, Number(process.env.PRE_LLM_FILTER_REPEAT_LINE_RATIO ?? 0.55))
);
const SEARCH_QUERY_CONCURRENCY = Math.max(
  1,
  Math.min(8, Number(process.env.SEARCH_QUERY_CONCURRENCY ?? 2))
);
const SEARCH_QUERY_RETRY_LIMIT = Math.max(
  0,
  Math.min(3, Number(process.env.SEARCH_QUERY_RETRY_LIMIT ?? 1))
);
const SEARCH_QUERY_RETRY_BACKOFF_MS = Math.max(
  0,
  Number(process.env.SEARCH_QUERY_RETRY_BACKOFF_MS ?? 300)
);

const ContentAnalyzeSchemaWithRewrite = z.object({
  title: z.string().min(4).max(120),
  summary: z.string().min(30).max(400),
  cleanedMarkdown: z.string().min(40).max(5000),
  relevance: z.boolean(),
  subjects: z
    .array(
      z.object({
        keywordId: z.string().min(1),
        score: z.number().min(0).max(1).nullable().optional(),
        reason: z.string().max(200).nullable().optional(),
      })
    )
    .default([]),
});
const ContentMeaningSchema = z.object({
  meaningful: z.boolean(),
  score: z.number().min(0).max(1),
  reason: z.string().min(1).max(240),
});
const ContentAnalyzeSchema = z.object({
  title: z.string().min(4).max(120),
  summary: z.string().min(30).max(400),
  relevance: z.boolean(),
  subjects: z
    .array(
      z.object({
        keywordId: z.string().min(1),
        score: z.number().min(0).max(1).nullable().optional(),
        reason: z.string().max(200).nullable().optional(),
      })
    )
    .default([]),
});
const RecallLanguageSchema = z.enum(["zh", "en", "ja"]);
const TopicRecallQueriesSchema = z.object({
  queries: z
    .array(
      z.object({
        text: z.string().min(1).max(180),
        lang: RecallLanguageSchema,
      })
    )
    .min(1)
    .max(16),
});
const TopicRerankSchema = z.object({
  scores: z
    .array(
      z.object({
        topicId: z.string().min(1),
        score: z.number().min(0).max(1),
      })
    )
    .default([]),
});

type ContentAnalyzeResult = {
  title: string;
  summary: string;
  cleanedMarkdown: string | null;
  relevance: boolean;
  subjectsByKeyword: Map<string, { score: number | null; reason: string | null }>;
};

type ContentMeaningResult = {
  meaningful: boolean;
  score: number;
  reason: string;
};

type PreparedSummaryContent = {
  markdown: string;
  text: string;
  promptText: string;
  extractorUsed: "markdown" | "text" | "empty";
  qualityScore: number;
};

type CleanItem = {
  title?: string;
  text: string;
  markdown: string;
  platform: string;
  url?: string;
  time?: Date;
  sourceId: string;
  sourceType: SourceCategory;
  sourceIsDarknet?: boolean;
  normalizedText?: string;
  fingerprint?: string;
  driver?: string;
  matchedKeywords?: string[];
  keywordMatchScore?: number;
  recordId?: string;
  recordType?: string;
  recordTime?: Date;
  recordContent?: Record<string, unknown>;
  schemaVersion?: string;
  recordIndex?: number;
  intent?: string;
  sourceRequestId?: string;
  meaningScore?: number;
  meaningReason?: string;
};

type QueryKeyword = {
  id: string;
  name: string;
  description?: string | null;
  includes: string[];
  excludes: string[];
  synonyms: string[];
};

type TopicTermLite = {
  type: "CORE" | "EXPANSION" | "EXCLUSION";
  value: string;
  weight?: number | null;
};
type RecallLanguage = z.infer<typeof RecallLanguageSchema>;

type JobCollectorTopic = {
  id: string;
  name: string;
  enabled?: boolean;
  description?: string | null;
  recallLanguages: RecallLanguage[];
  terms: TopicTermLite[];
};

type TopicVectorMatch = {
  topicId: string;
  similarity: number;
};

type TopicSparseMatch = {
  topicId: string;
  score: number;
};

type GatherSocialDriver = "playwright" | "xhttp";
type GatherOutputField = string[] | Record<string, string>;
type GatherOutputPayload = {
  field: GatherOutputField;
  keywordScope?: string[];
};
type GatherIntentPayload = {
  type: string;
  args: Record<string, unknown>;
};
type SourceRuntimePolicy = {
  contentFilterEnabled: boolean;
  contentFilterMode: QueryContentFilterMode;
  recallBindingOverride?: unknown;
};

type RecallQueryOrigin = "llm_recall" | "coverage_patch" | "static_fallback";
type SourceRecallQueryBundle = {
  queries: string[];
  origin: RecallQueryOrigin;
  generatedCount: number;
};
type TopicRecallQueryItem = z.infer<typeof TopicRecallQueriesSchema>["queries"][number];
type PreLlmFilterReason =
  | "placeholder"
  | "error_page"
  | "garbled_content"
  | "template_noise"
  | "repeated_noise";

type PreLlmFilterReject = {
  item: CleanItem;
  reason: PreLlmFilterReason;
  metrics: Record<string, number>;
  sampleHash: string;
};

type PreLlmFilterResult = {
  passed: CleanItem[];
  rejected: PreLlmFilterReject[];
};
type GatherDriverPayload = {
  name: GatherSocialDriver;
  script: GatherIntentPayload;
  filter?: Record<string, unknown>;
} & Record<string, unknown>;

type GatherScriptCatalogItem = {
  platform?: string;
  intent?: string;
  sample?: {
    outputField?: unknown;
  };
};

const GATHER_OUTPUT_FIELD_RULE_TTL_MS = 5 * 60 * 1000;
const gatherOutputFieldRuleCache = new Map<string, GatherOutputField>();
const gatherPlatformIntentCache = new Map<string, string[]>();
let gatherOutputFieldRuleCacheExpireAt = 0;
const runSearchSignatureCache = new Map<string, Set<string>>();
const DEFAULT_SOURCE_FILTER_MIN_CHARS = 8;

function isWebSource(source: SourceWithRelations): source is WebSource {
  return source.category === "STREAM";
}

function isDarknetSource(source: SourceWithRelations): source is DarknetSource {
  return source.category === "RETRIEVAL" && source.isDarknet;
}

function isSocialSource(source: SourceWithRelations): source is SocialMediaSource {
  return source.category === "INTERACTIVE";
}

function isSearchSource(source: SourceWithRelations): source is SearchEngineSource {
  return source.category === "RETRIEVAL" && !source.isDarknet;
}

function stripNullBytes(value: string): string {
  return value.replace(/\u0000/g, "");
}

function sanitizeJsonForDb(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return stripNullBytes(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonForDb(item));
  }
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = sanitizeJsonForDb(item);
    }
    return output;
  }
  return String(value);
}

function extractTopicAnchorsFromDescription(value?: string | null): string[] {
  const text = String(value ?? "");
  const matches = text.match(/#([a-zA-Z0-9][\w.-]{0,63})/g) ?? [];
  return Array.from(
    new Set(
      matches.map((item) => item.slice(1).trim()).filter(Boolean)
    )
  );
}

function stripNullBytesNullable(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  return stripNullBytes(value);
}

class HttpStatusError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "HttpStatusError";
    this.statusCode = statusCode;
  }
}

function sanitizeObjectiveFallback(keywords: QueryKeyword[]): string {
  const parts = keywords
    .map((keyword) => {
      const name = stripNullBytes(keyword.name ?? "").trim();
      if (!name) return "";
      const anchors = extractTopicAnchorsFromDescription(keyword.description)
        .slice(0, 4)
        .join(" ");
      return [name, anchors]
        .join(" ")
        .replace(/[#]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    })
    .filter(Boolean);
  return Array.from(new Set(parts)).join("; ").slice(0, 120);
}

function buildSearchSuccessSignature(input: {
  sourceId: string;
  provider: string;
  recallQuery: string;
}): string {
  return [
    input.sourceId.trim().toLowerCase(),
    input.provider.trim().toLowerCase(),
    input.recallQuery.trim().toLowerCase(),
  ].join("|");
}

async function loadRunSearchSuccessSignatures(runId?: string): Promise<Set<string>> {
  if (!runId) return new Set<string>();
  const cached = runSearchSignatureCache.get(runId);
  if (cached) return cached;
  const row = await prismaAny.queryRun.findUnique({
    where: { id: runId },
    select: { meta: true },
  });
  const meta = asObject(row?.meta);
  const existing = normalizeStringArray(meta.searchSuccessSignatures);
  const set = new Set(existing);
  runSearchSignatureCache.set(runId, set);
  return set;
}

function shouldPersistSearchSuccessSignatures(context?: {
  runId?: string;
  queryId?: string;
}): boolean {
  if (!context?.runId) return false;
  if (!context.queryId) return false;
  return !context.queryId.startsWith("job:");
}

async function persistRunSearchSuccessSignatures(
  runId: string,
  signatures: Set<string>
): Promise<void> {
  const row = await prismaAny.queryRun.findUnique({
    where: { id: runId },
    select: { meta: true },
  });
  if (!row) return;
  const currentMeta = asObject(row.meta);
  const merged = Array.from(
    new Set([
      ...normalizeStringArray(currentMeta.searchSuccessSignatures),
      ...Array.from(signatures),
    ])
  );
  await prismaAny.queryRun.update({
    where: { id: runId },
    data: {
      meta: {
        ...currentMeta,
        searchSuccessSignatures: merged,
      },
    },
  });
}

export async function runFocusCollector(runId: string, queryId: string) {
  const send = async (event: unknown) => publishTaskEvent(runId, event);

  await prismaAny.queryRun.update({
    where: { id: runId },
    data: { status: "RUNNING", startedAt: new Date(), progress: 0 },
  });
  await send({ type: "start", message: "任务开始" });

  const query = await prismaAny.query.findUnique({
    where: { id: queryId },
    include: {
      keywords: true,
      sourcePolicies: true,
      sources: {
        include: {
          web: true,
          search: {
            include: {
              credential: true,
            },
          },
          social: {
            include: {
              credential: true,
              proxy: true,
            },
          },
          darknet: true,
          credential: true,
          proxy: true,
        },
      },
    },
  });

  if (!query) {
    throw new Error("Query not found");
  }

  await send({ type: "fetch", message: "拉取数据中" });
  const normalizedSources: SourceWithRelations[] = [];
  query.sources.forEach((source: any) => {
    if (source.category === "STREAM" && source.web) {
      normalizedSources.push(source as WebSource);
      return;
    }
    if (source.category === "RETRIEVAL" && source.isDarknet && source.darknet) {
      normalizedSources.push(source as DarknetSource);
      return;
    }
    if (source.category === "RETRIEVAL" && !source.isDarknet && source.search) {
      normalizedSources.push(source as SearchEngineSource);
      return;
    }
    if (source.category === "INTERACTIVE" && source.social) {
      normalizedSources.push(source as SocialMediaSource);
    }
  });
  const rawItems = await fetchBySources(
    normalizedSources,
    runId,
    queryId,
    query.keywords,
    new Map(
      query.sourcePolicies.map((item: any) => [
        item.sourceId,
        {
          contentFilterEnabled: item.contentFilterEnabled,
          contentFilterMode: item.contentFilterMode,
        } satisfies SourceRuntimePolicy,
      ])
    )
  );
  const cleaned = await cleanAndDedup(rawItems, runId);
  const sourceStats = new Map<
    string,
    {
      sourceName: string;
      sourceType: SourceCategory;
      fetched: number;
      cleaned: number;
      dedupSkipped: number;
      inserted: number;
    }
  >();
  for (const source of normalizedSources) {
    sourceStats.set(source.id, {
      sourceName: source.name,
      sourceType: source.category,
      fetched: 0,
      cleaned: 0,
      dedupSkipped: 0,
      inserted: 0,
    });
  }
  for (const item of rawItems) {
    const stats = sourceStats.get(item.sourceId);
    if (!stats) continue;
    stats.fetched += 1;
  }
  for (const item of cleaned) {
    const stats = sourceStats.get(item.sourceId);
    if (!stats) continue;
    stats.cleaned += 1;
  }

  if (!cleaned.length) {
    await send({ type: "done", message: "未抓取到内容", progress: 100 });
    await prismaAny.queryRun.update({
      where: { id: runId },
      data: { status: "SUCCEEDED", progress: 100, finishedAt: new Date() },
    });
    return;
  }

  const expandedKeywords = query.keywords.map((kw: any) => {
    const parts = [kw.name, ...kw.includes];
    if (kw.enableAiExpand && kw.synonyms.length > 0) {
      parts.push(...kw.synonyms);
    }
    return Array.from(new Set(parts)).join(", ");
  });

  const keywordsStr = expandedKeywords.join("; ") || "无关键词";
  for (let i = 0; i < cleaned.length; i++) {
    const item = cleaned[i];
    const preparedSummaryContent = await prepareContentForSummary(item);
    const existingContent = await findExistingContentBySourceRecord(item);
    if (existingContent) {
      const stats = sourceStats.get(item.sourceId);
      if (stats) {
        stats.dedupSkipped += 1;
      }
      const progress = Math.min(
        100,
        Math.floor(((i + 1) / cleaned.length) * 100)
      );
      await prismaAny.queryRun.update({
        where: { id: runId },
        data: { progress },
      });
      await send({
        type: "dedup-skip",
        message: "重复内容已跳过",
        progress,
        contentId: existingContent.id,
        sourceId: item.sourceId,
        recordId: item.recordId,
        fingerprint: item.fingerprint,
      });
      continue;
    }

    const shouldRunContentAnalyze =
      CONTENT_AUTO_CLEAN_ENABLED ||
      CONTENT_CLEAN_LLM_ENABLED ||
      !SKIP_AI_SUMMARY ||
      ENABLE_SUBJECT_AI_SCORE;
    let contentAnalyzeResult: ContentAnalyzeResult | null = null;
    if (shouldRunContentAnalyze) {
      await send({ type: "summary", message: `第 ${i + 1} 条内容AI分析` });
      contentAnalyzeResult = await analyzeContentWithRetry(
        item,
        query.keywords,
        keywordsStr,
        queryId,
        runId,
        preparedSummaryContent
      );
    }

    const fallbackSummary =
      preparedSummaryContent.text.slice(0, 180) || buildFallbackSummary(item);
    const generatedSummary = normalizeGeneratedSummary(contentAnalyzeResult?.summary);
    const generatedTitle = normalizeGeneratedTitle(contentAnalyzeResult?.title);
    const generatedMarkdown = normalizeGeneratedMarkdown(
      contentAnalyzeResult?.cleanedMarkdown
    );
    const summary: { summary: string; relevance: boolean } = SKIP_AI_SUMMARY
      ? {
          summary: generatedSummary || fallbackSummary,
          relevance: true,
        }
      : contentAnalyzeResult
        ? {
            summary: generatedSummary || fallbackSummary,
            relevance: contentAnalyzeResult.relevance,
          }
        : {
            summary: fallbackSummary,
            relevance: true,
          };
    if (!shouldRunContentAnalyze) {
      await send({
        type: "summary-skip",
        message: `第 ${i + 1} 条内容跳过 AI 摘要，直接入库`,
      });
    }

    const contentTitle =
      item.title ||
      (preparedSummaryContent.text.slice(0, 40).replace(/\s+/g, " ").trim() ||
        `来源 ${item.platform}`);
    const contentTime = item.recordTime ?? item.time ?? new Date();
    const normalizedRecordContent = buildNormalizedRecordContent({
      platform: item.platform,
      intent: item.intent,
      sourceId: item.sourceId,
      fallbackTitle: contentTitle,
      fallbackSummary: summary.summary,
      fallbackMarkdown: preparedSummaryContent.markdown || item.markdown,
      fallbackUrl: item.url,
      fallbackTimeIso: contentTime.toISOString(),
      recordId: item.recordId,
      recordType: item.recordType,
      recordIndex: item.recordIndex,
      rawRecordContent: item.recordContent,
    });

    const sanitizedTitle = stripNullBytes(contentTitle);
    const sanitizedSummary = stripNullBytes(summary.summary);
    const sanitizedMarkdown = stripNullBytes(preparedSummaryContent.markdown || item.markdown);
    const sanitizedCleanedMarkdown = generatedMarkdown
      ? stripNullBytes(generatedMarkdown)
      : "";
    const sanitizedPlatform = stripNullBytes(item.platform);
    const sanitizedUrl = item.url ? stripNullBytes(item.url) : undefined;
    const sanitizedRecordContent = sanitizeJsonForDb(
      normalizedRecordContent
    ) as Prisma.InputJsonValue;
    const contentMeta: Record<string, unknown> = {
      queryId,
      runId,
      sourceRequestId: item.sourceRequestId
        ? stripNullBytes(item.sourceRequestId)
        : null,
      sourceFingerprint: item.fingerprint
        ? stripNullBytes(item.fingerprint)
        : null,
      driver: item.driver ? stripNullBytes(item.driver) : null,
      matchedKeywords: (item.matchedKeywords ?? []).map((term) =>
        stripNullBytes(term)
      ),
      keywordMatchScore: item.keywordMatchScore ?? null,
      recordId: stripNullBytesNullable(normalizedRecordContent.relation.recordId),
      recordType: stripNullBytesNullable(normalizedRecordContent.relation.recordType),
      recordTime: stripNullBytesNullable(normalizedRecordContent.detailView.publishedAt),
      recordContent: sanitizedRecordContent,
      schemaVersion: stripNullBytesNullable(normalizedRecordContent.schemaVersion),
      recordIndex: normalizedRecordContent.relation.recordIndex,
      keywords: expandedKeywords.map((keywordValue: string) =>
        stripNullBytes(keywordValue)
      ),
      summaryRelevance: summary.relevance,
      aiSummary: generatedSummary || sanitizedSummary,
      aiSummaryUpdatedAt: contentTime.toISOString(),
      aiSummaryModel:
        contentAnalyzeResult
          ? process.env.LLM_DEFAULT_MODEL ?? "unknown"
          : "fallback",
      summaryInput: preparedSummaryContent.promptText.slice(0, 1500),
      summaryInputExtractor: preparedSummaryContent.extractorUsed,
      summaryInputQuality: preparedSummaryContent.qualityScore,
      contentCleanProvider: contentAnalyzeResult ? "llm" : "legacy",
      contentCleanedMarkdownChars: sanitizedCleanedMarkdown.length,
      contentCleanLlmEnabled: CONTENT_CLEAN_LLM_ENABLED,
      contentAutoCleanEnabled: CONTENT_AUTO_CLEAN_ENABLED,
      meaningScore:
        typeof item.meaningScore === "number" ? roundScore(item.meaningScore) : null,
      meaningReason: item.meaningReason ? stripNullBytes(item.meaningReason) : null,
      sourceId: stripNullBytes(item.sourceId),
      sourceType: item.sourceType,
      intent: item.intent ? stripNullBytes(item.intent) : null,
    };
    if (sanitizedCleanedMarkdown) {
      contentMeta.cleanedTitle = generatedTitle || null;
      contentMeta.cleanedSummary = generatedSummary || null;
      contentMeta.cleanedMarkdown = sanitizedCleanedMarkdown;
      contentMeta.cleanedMarkdownUpdatedAt = contentTime.toISOString();
      contentMeta.cleanedMarkdownModel =
        process.env.LLM_DEFAULT_MODEL ?? "unknown";
    }

    const content = await prisma.content.create({
      data: {
        title: sanitizedTitle,
        summary: sanitizedSummary,
        markdown: sanitizedMarkdown,
        platform: sanitizedPlatform,
        type: mapContentType(item.sourceType, item.sourceIsDarknet),
        time: contentTime,
        url: sanitizedUrl,
        meta: contentMeta as Prisma.InputJsonValue,
      },
    });

    if (query.keywords.length) {
      await prismaAny.contentKeyword.createMany({
        data: query.keywords.map((keyword: any) => ({
          contentId: content.id,
          keywordId: keyword.id,
        })),
        skipDuplicates: true,
      });
      const subjectMatchResult = await upsertContentSubjectMatches({
        contentId: content.id,
        contentText: `${content.title}\n${content.summary}\n${content.markdown}`,
        item,
        keywords: query.keywords,
        aiByKeyword:
          ENABLE_SUBJECT_AI_SCORE && contentAnalyzeResult
            ? contentAnalyzeResult.subjectsByKeyword
            : undefined,
      });
      const reasonSummaryRaw = subjectMatchResult.bestReason?.trim();
      if (SKIP_AI_SUMMARY && reasonSummaryRaw) {
        const reasonSummary = stripNullBytes(reasonSummaryRaw);
        const updatedRecordContent = {
          ...normalizedRecordContent,
          summaryView: {
            ...normalizedRecordContent.summaryView,
            summary: reasonSummary,
          },
        };
        const sanitizedUpdatedRecordContent = sanitizeJsonForDb(
          updatedRecordContent
        ) as Prisma.InputJsonValue;
        await prisma.content.update({
          where: { id: content.id },
          data: {
            summary: reasonSummary,
            meta: {
              ...contentMeta,
              recordContent: sanitizedUpdatedRecordContent,
            } as Prisma.InputJsonValue,
          },
        });
      }
    }
    await publishContentEvent({
      type: "content:created",
      contentId: content.id,
      queryId,
      runId,
      platform: content.platform,
      time: content.time.toISOString(),
    });

    const progress = Math.min(
      100,
      Math.floor(((i + 1) / cleaned.length) * 100)
    );
    const stats = sourceStats.get(item.sourceId);
    if (stats) {
      stats.inserted += 1;
    }
    await prismaAny.queryRun.update({
      where: { id: runId },
      data: { progress },
    });
    await send({ type: "progress", message: "入库完成", progress });
  }

  await prismaAny.queryRun.update({
    where: { id: runId },
    data: {
      status: "SUCCEEDED",
      finishedAt: new Date(),
      progress: 100,
      meta: { summaryCount: cleaned.length },
    },
  });

  await send({
    type: "done",
    message: "任务完成",
    progress: 100,
    summaryCount: cleaned.length,
  });
  for (const [sourceId, stats] of sourceStats.entries()) {
    logger.info("collector source summary", {
      runId,
      queryId,
      sourceId,
      sourceName: stats.sourceName,
      sourceType: stats.sourceType,
      fetched: stats.fetched,
      cleaned: stats.cleaned,
      dedupSkipped: stats.dedupSkipped,
      inserted: stats.inserted,
    });
    if (stats.fetched > 0 && stats.inserted === 0) {
      logger.warn("collector source inserted 0 items", {
        runId,
        queryId,
        sourceId,
        sourceName: stats.sourceName,
        fetched: stats.fetched,
        cleaned: stats.cleaned,
        dedupSkipped: stats.dedupSkipped,
      });
    }
  }
}

export async function runJobCollector(params: {
  runId: string;
  jobId: string;
  jobType: JobType;
  topics: JobCollectorTopic[];
  sources: SourceWithRelations[];
  sourcePolicyBySourceId: Map<string, SourceRuntimePolicy>;
}) {
  const { runId, jobId, jobType, topics, sources, sourcePolicyBySourceId } = params;
  const send = async (event: unknown) => publishTaskEvent(runId, event);
  const pseudoQueryId = `job:${jobId}`;
  const keywords = buildTopicKeywords(topics);
  const enabledTopicsForScoring = (await prisma.topic.findMany({
    where: { enabled: true },
    include: { terms: true },
  })) as unknown as JobCollectorTopic[];
  const topicById = new Map(enabledTopicsForScoring.map((topic) => [topic.id, topic]));

  await prisma.jobRun.update({
    where: { id: runId },
    data: { status: "RUNNING", startedAt: new Date(), progress: 0 },
  });
  await send({ type: "start", message: "任务开始" });

  const sourceRecallQueryBundles =
    jobType === JobType.TOPIC_RETRIEVAL
      ? await buildTopicRecallQueryBundles({
          runId,
          jobId,
          topics,
          sources,
          fallbackKeywords: keywords,
        })
      : new Map<string, SourceRecallQueryBundle>();
  const recallSummary = Array.from(sourceRecallQueryBundles.entries()).map(
    ([sourceId, bundle]) => ({
      sourceId,
      origin: bundle.origin,
      generatedCount: bundle.generatedCount,
    })
  );

  await send({ type: "fetch", message: "拉取数据中" });
  const rawItems = await fetchBySources(
    sources,
    runId,
    pseudoQueryId,
    keywords,
    sourcePolicyBySourceId,
    sourceRecallQueryBundles
  );
  const cleaned = await cleanAndDedup(rawItems, runId);

  const sourceStats = new Map<
    string,
    {
      sourceName: string;
      sourceType: SourceCategory;
      fetched: number;
      cleaned: number;
      dedupSkipped: number;
      inserted: number;
    }
  >();
  for (const source of sources) {
    sourceStats.set(source.id, {
      sourceName: source.name,
      sourceType: source.category,
      fetched: 0,
      cleaned: 0,
      dedupSkipped: 0,
      inserted: 0,
    });
  }
  for (const item of rawItems) {
    const stats = sourceStats.get(item.sourceId);
    if (stats) stats.fetched += 1;
  }
  for (const item of cleaned) {
    const stats = sourceStats.get(item.sourceId);
    if (stats) stats.cleaned += 1;
  }

  if (!cleaned.length) {
    await send({ type: "done", message: "未抓取到内容", progress: 100 });
    await prisma.jobRun.update({
      where: { id: runId },
      data: {
        status: "SUCCEEDED",
        progress: 100,
        finishedAt: new Date(),
        meta: {
          summaryCount: 0,
          topics: topics.length,
          sources: sources.length,
          recallSummary,
        },
      },
    });
    return;
  }

  const expandedKeywords = keywords.map((kw) => {
    const parts = [kw.name, ...kw.includes];
    return Array.from(new Set(parts)).join(", ");
  });

  for (let i = 0; i < cleaned.length; i++) {
    const item = cleaned[i];
    const preparedSummaryContent = await prepareContentForSummary(item);
    const existingContent = await findExistingContentBySourceRecord(item);
    if (existingContent) {
      const stats = sourceStats.get(item.sourceId);
      if (stats) stats.dedupSkipped += 1;
      const progress = Math.min(100, Math.floor(((i + 1) / cleaned.length) * 100));
      await prisma.jobRun.update({
        where: { id: runId },
        data: { progress },
      });
      await send({
        type: "dedup-skip",
        message: "重复内容已跳过",
        progress,
        contentId: existingContent.id,
        sourceId: item.sourceId,
        recordId: item.recordId,
        fingerprint: item.fingerprint,
      });
      continue;
    }

    const fallbackSummary = buildFallbackSummary(item);
    let contentVector: number[] | null = null;
    let vectorMatches: TopicVectorMatch[] = [];
    let sparseMatches: TopicSparseMatch[] = [];
    let topicMatches: TopicHybridMatch[] = [];
    let maxFusionScore = 0;
    try {
      contentVector = await createEmbedding(
        buildContentVectorInput(item, fallbackSummary)
      );
      vectorMatches = await queryTopTopicVectorMatches(
        contentVector,
        RETRIEVAL_VECTOR_TOP_N
      );
    } catch (error) {
      logger.warn("content vector match failed", {
        runId,
        jobId,
        sourceId: item.sourceId,
        error: logger.normalizeError(error),
      });
      await send({
        type: "vector-match-error",
        message: "向量匹配失败，降级为关键词评分",
        sourceId: item.sourceId,
      });
    }
    try {
      sparseMatches = await queryTopTopicSparseMatches({
        title: item.title ?? "",
        summary: fallbackSummary,
        markdown: item.markdown ?? item.text,
        topics: enabledTopicsForScoring,
        limit: RETRIEVAL_BM25_TOP_N,
      });
    } catch (error) {
      logger.warn("content sparse match failed", {
        runId,
        jobId,
        sourceId: item.sourceId,
        error: logger.normalizeError(error),
      });
    }
    topicMatches = mergeTopicMatches({
      vectorMatches,
      sparseMatches,
    }).slice(0, Math.max(RETRIEVAL_VECTOR_TOP_N, RETRIEVAL_BM25_TOP_N));
    maxFusionScore = topicMatches[0]?.fusionScore ?? 0;

    const llmGate = resolveLlmGateDecision(maxFusionScore);
    const llmTopics = buildTopicKeywords(
      topicMatches
        .map((match) => topicById.get(match.topicId))
        .filter(Boolean)
        .slice(0, 8) as JobCollectorTopic[]
    );
    const llmKeywords = llmTopics.length > 0 ? llmTopics : keywords;
    const llmKeywordsSummary =
      llmKeywords.map((kw) => [kw.name, ...kw.includes].join(", ")).join("; ") || "无关键词";
    const shouldRunContentAnalyze =
      CONTENT_AUTO_CLEAN_ENABLED ||
      CONTENT_CLEAN_LLM_ENABLED ||
      ((!SKIP_AI_SUMMARY || ENABLE_SUBJECT_AI_SCORE) && llmGate === "high");
    let contentAnalyzeResult: ContentAnalyzeResult | null = null;
    if (shouldRunContentAnalyze) {
      await send({ type: "summary", message: `第 ${i + 1} 条内容AI分析` });
      contentAnalyzeResult = await analyzeContentWithRetry(
        item,
        llmKeywords,
        llmKeywordsSummary,
        pseudoQueryId,
        runId,
        preparedSummaryContent
      );
    } else {
      await send({
        type: "summary-skip",
        message:
          llmGate === "low"
            ? "低相关内容，已跳过AI深度分析"
            : "中相关内容，已跳过AI深度分析",
        sourceId: item.sourceId,
        maxSimilarity: roundScore(maxFusionScore),
      });
    }

    const summary = SKIP_AI_SUMMARY
      ? {
          summary:
            normalizeGeneratedSummary(contentAnalyzeResult?.summary) || fallbackSummary,
          relevance: true,
        }
      : contentAnalyzeResult
        ? {
            summary:
              normalizeGeneratedSummary(contentAnalyzeResult.summary) || fallbackSummary,
            relevance: contentAnalyzeResult.relevance,
          }
        : {
            summary: fallbackSummary,
            relevance: llmGate !== "low",
          };
    const generatedSummary = normalizeGeneratedSummary(contentAnalyzeResult?.summary);
    const generatedTitle = normalizeGeneratedTitle(contentAnalyzeResult?.title);
    const generatedMarkdown = normalizeGeneratedMarkdown(
      contentAnalyzeResult?.cleanedMarkdown
    );

    const contentTitle =
      item.title ||
      (preparedSummaryContent.text.slice(0, 40).replace(/\s+/g, " ").trim() ||
        `来源 ${item.platform}`);
    const contentTime = item.recordTime ?? item.time ?? new Date();
    const normalizedRecordContent = buildNormalizedRecordContent({
      platform: item.platform,
      intent: item.intent,
      sourceId: item.sourceId,
      fallbackTitle: contentTitle,
      fallbackSummary: summary.summary,
      fallbackMarkdown: preparedSummaryContent.markdown || item.markdown,
      fallbackUrl: item.url,
      fallbackTimeIso: contentTime.toISOString(),
      recordId: item.recordId,
      recordType: item.recordType,
      recordIndex: item.recordIndex,
      rawRecordContent: item.recordContent,
    });
    const sanitizedTitle = stripNullBytes(contentTitle);
    const sanitizedSummary = stripNullBytes(summary.summary);
    const sanitizedMarkdown = stripNullBytes(preparedSummaryContent.markdown || item.markdown);
    const sanitizedCleanedMarkdown = generatedMarkdown
      ? stripNullBytes(generatedMarkdown)
      : "";
    const sanitizedPlatform = stripNullBytes(item.platform);
    const sanitizedUrl = item.url ? stripNullBytes(item.url) : undefined;
    const sanitizedRecordContent = sanitizeJsonForDb(
      normalizedRecordContent
    ) as Prisma.InputJsonValue;
    const contentMeta: Record<string, unknown> = {
      jobId,
      runId,
      sourceRequestId: item.sourceRequestId
        ? stripNullBytes(item.sourceRequestId)
        : null,
      sourceFingerprint: item.fingerprint
        ? stripNullBytes(item.fingerprint)
        : null,
      driver: item.driver ? stripNullBytes(item.driver) : null,
      matchedKeywords: (item.matchedKeywords ?? []).map((term) =>
        stripNullBytes(term)
      ),
      keywordMatchScore: item.keywordMatchScore ?? null,
      recordId: stripNullBytesNullable(normalizedRecordContent.relation.recordId),
      recordType: stripNullBytesNullable(normalizedRecordContent.relation.recordType),
      recordTime: stripNullBytesNullable(normalizedRecordContent.detailView.publishedAt),
      recordContent: sanitizedRecordContent,
      schemaVersion: stripNullBytesNullable(normalizedRecordContent.schemaVersion),
      recordIndex: normalizedRecordContent.relation.recordIndex,
      keywords: expandedKeywords.map((keywordValue) => stripNullBytes(keywordValue)),
      summaryRelevance: summary.relevance,
      aiSummary: generatedSummary || sanitizedSummary,
      aiSummaryUpdatedAt: contentTime.toISOString(),
      aiSummaryModel:
        contentAnalyzeResult
          ? process.env.LLM_DEFAULT_MODEL ?? "unknown"
          : "fallback",
      summaryInput: preparedSummaryContent.promptText.slice(0, 1500),
      summaryInputExtractor: preparedSummaryContent.extractorUsed,
      summaryInputQuality: preparedSummaryContent.qualityScore,
      contentCleanProvider: contentAnalyzeResult ? "llm" : "legacy",
      contentCleanedMarkdownChars: sanitizedCleanedMarkdown.length,
      contentCleanLlmEnabled: CONTENT_CLEAN_LLM_ENABLED,
      contentAutoCleanEnabled: CONTENT_AUTO_CLEAN_ENABLED,
      meaningScore:
        typeof item.meaningScore === "number" ? roundScore(item.meaningScore) : null,
      meaningReason: item.meaningReason ? stripNullBytes(item.meaningReason) : null,
      sourceId: stripNullBytes(item.sourceId),
      sourceType: item.sourceType,
      intent: item.intent ? stripNullBytes(item.intent) : null,
      topicIds: topics.map((topic) => topic.id),
      vectorMatch: {
        topK: Math.max(RETRIEVAL_VECTOR_TOP_N, RETRIEVAL_BM25_TOP_N),
        maxSimilarity: roundScore(maxFusionScore),
        gate: llmGate,
        matchedTopicIds: topicMatches.map((match) => match.topicId),
        vectorTopN: RETRIEVAL_VECTOR_TOP_N,
        bm25TopN: RETRIEVAL_BM25_TOP_N,
      },
    };
    if (sanitizedCleanedMarkdown) {
      contentMeta.cleanedTitle = generatedTitle || null;
      contentMeta.cleanedSummary = generatedSummary || null;
      contentMeta.cleanedMarkdown = sanitizedCleanedMarkdown;
      contentMeta.cleanedMarkdownUpdatedAt = contentTime.toISOString();
      contentMeta.cleanedMarkdownModel =
        process.env.LLM_DEFAULT_MODEL ?? "unknown";
    }

    const content = await prisma.content.create({
      data: {
        title: sanitizedTitle,
        summary: sanitizedSummary,
        markdown: sanitizedMarkdown,
        platform: sanitizedPlatform,
        type: mapContentType(item.sourceType, item.sourceIsDarknet),
        time: contentTime,
        url: sanitizedUrl,
        meta: contentMeta as Prisma.InputJsonValue,
      },
    });
    if (contentVector) {
      await saveContentVector(content.id, contentVector);
    }

    if (!DYNAMIC_TOPIC_SCORING_ENABLED && topicMatches.length > 0) {
      await upsertContentTopicScores({
        contentId: content.id,
        contentText: `${content.title}\n${content.summary}\n${content.markdown}`,
        topicsById: topicById,
        topicMatches,
      });
    }

    await publishContentEvent({
      type: "content:created",
      contentId: content.id,
      jobId,
      runId,
      platform: content.platform,
      time: content.time.toISOString(),
    });

    const progress = Math.min(100, Math.floor(((i + 1) / cleaned.length) * 100));
    const stats = sourceStats.get(item.sourceId);
    if (stats) stats.inserted += 1;
    await prisma.jobRun.update({
      where: { id: runId },
      data: { progress },
    });
    await send({ type: "progress", message: "入库完成", progress });
  }

  const sourceSummaries = Array.from(sourceStats.entries()).map(([sourceId, stats]) => ({
    sourceId,
    sourceName: stats.sourceName,
    sourceType: stats.sourceType,
    fetched: stats.fetched,
    cleaned: stats.cleaned,
    dedupSkipped: stats.dedupSkipped,
    inserted: stats.inserted,
  }));
  await prisma.jobRun.update({
    where: { id: runId },
    data: {
      status: "SUCCEEDED",
      finishedAt: new Date(),
      progress: 100,
      meta: {
        summaryCount: cleaned.length,
        topics: topics.length,
        sources: sources.length,
        sourceSummaries,
        recallSummary,
      },
    },
  });

  await send({
    type: "done",
    message: "任务完成",
    progress: 100,
    summaryCount: cleaned.length,
  });
}

function mapContentType(sourceType: SourceCategory, isDarknet?: boolean): ContentType {
  if (sourceType === "RETRIEVAL" && isDarknet) {
    return ContentType.Darknet;
  }
  return ContentType.Web;
}

function buildTopicKeywords(topics: JobCollectorTopic[]): QueryKeyword[] {
  return topics.map((topic) => {
    const coreTerms = topic.terms
      .filter((term) => term.type === "CORE")
      .map((term) => term.value);
    const expansionTerms = topic.terms
      .filter((term) => term.type === "EXPANSION")
      .map((term) => term.value);
    const exclusionTerms = topic.terms
      .filter((term) => term.type === "EXCLUSION")
      .map((term) => term.value);
    return {
      id: topic.id,
      name: topic.name,
      description: topic.description ?? null,
      includes: Array.from(new Set([...coreTerms, ...expansionTerms])),
      excludes: Array.from(new Set(exclusionTerms)),
      synonyms: [],
    };
  });
}

function countTermMatches(contentText: string, terms: TopicTermLite[]): number {
  let score = 0;
  for (const term of terms) {
    const normalized = term.value.trim().toLowerCase();
    if (!normalized) continue;
    if (contentText.includes(normalized)) {
      score += term.weight ?? 1;
    }
  }
  return score;
}

function buildContentVectorInput(item: CleanItem, fallbackSummary: string): string {
  const markdownExcerpt = (item.markdown || item.text || "").slice(0, 4000);
  return [item.title ?? "", fallbackSummary, markdownExcerpt]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n");
}

async function saveContentVector(contentId: string, vector: number[]) {
  await prisma.$executeRawUnsafe(
    `UPDATE "Content" SET "vector" = $1::vector WHERE "id" = $2`,
    toVectorLiteral(vector),
    contentId
  );
}

async function queryTopTopicVectorMatches(
  contentVector: number[],
  limit: number
): Promise<TopicVectorMatch[]> {
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const rows = await prisma.$queryRawUnsafe<Array<{ topicId: string; similarity: number | null }>>(
    `SELECT t.id AS "topicId", (1 - (t."vector" <=> $1::vector))::float8 AS "similarity"
     FROM "Topic" t
     WHERE t."enabled" = TRUE
       AND t."vector" IS NOT NULL
     ORDER BY t."vector" <=> $1::vector
     LIMIT $2`,
    toVectorLiteral(contentVector),
    safeLimit
  );

  return rows
    .map((row) => ({
      topicId: row.topicId,
      similarity: typeof row.similarity === "number" ? row.similarity : 0,
    }))
    .filter((row) => row.topicId);
}

function buildTopicSparseQuery(topic: JobCollectorTopic): string {
  const terms = topic.terms
    .filter((term) => term.type !== "EXCLUSION")
    .map((term) => term.value.trim().toLowerCase())
    .filter(Boolean);
  const values = Array.from(new Set([topic.name.trim().toLowerCase(), ...terms])).filter(Boolean);
  return values.join(" ");
}

async function queryTopTopicSparseMatches(params: {
  title: string;
  summary: string;
  markdown: string;
  topics: JobCollectorTopic[];
  limit: number;
}): Promise<TopicSparseMatch[]> {
  const topicQueries = params.topics
    .map((topic) => ({ topicId: topic.id, queryText: buildTopicSparseQuery(topic) }))
    .filter((item) => item.queryText.length > 0);
  if (topicQueries.length === 0) {
    return [];
  }

  const valuesPlaceholders: string[] = [];
  const queryValues: unknown[] = [];
  let valueIndex = 1;
  for (const item of topicQueries) {
    valuesPlaceholders.push(`($${valueIndex}, $${valueIndex + 1})`);
    queryValues.push(item.topicId, item.queryText);
    valueIndex += 2;
  }

  const titleParam = `$${valueIndex}`;
  queryValues.push(params.title);
  valueIndex += 1;
  const summaryParam = `$${valueIndex}`;
  queryValues.push(params.summary);
  valueIndex += 1;
  const markdownParam = `$${valueIndex}`;
  queryValues.push(params.markdown);
  valueIndex += 1;
  const limitParam = `$${valueIndex}`;
  queryValues.push(Math.max(1, Math.min(params.limit, 100)));

  const rows = await prisma.$queryRawUnsafe<
    Array<{ topicId: string; score: number | null }>
  >(
    `WITH topic_queries(topic_id, query_text) AS (
       VALUES ${valuesPlaceholders.join(", ")}
     )
     SELECT
       tq.topic_id AS "topicId",
       ts_rank_cd(
         setweight(to_tsvector('simple', coalesce(${titleParam}, '')), 'A') ||
         setweight(to_tsvector('simple', coalesce(${summaryParam}, '')), 'B') ||
         setweight(to_tsvector('simple', coalesce(${markdownParam}, '')), 'C'),
         websearch_to_tsquery('simple', tq.query_text)
       )::float8 AS "score"
     FROM topic_queries tq
     WHERE (
       setweight(to_tsvector('simple', coalesce(${titleParam}, '')), 'A') ||
       setweight(to_tsvector('simple', coalesce(${summaryParam}, '')), 'B') ||
       setweight(to_tsvector('simple', coalesce(${markdownParam}, '')), 'C')
     ) @@ websearch_to_tsquery('simple', tq.query_text)
     ORDER BY "score" DESC
     LIMIT ${limitParam}`,
    ...queryValues
  );

  return rows
    .map((row) => ({
      topicId: row.topicId,
      score: typeof row.score === "number" ? row.score : 0,
    }))
    .filter((row) => row.topicId);
}

function resolveLlmGateDecision(finalScore: number): "high" | "mid" | "low" {
  if (finalScore >= RETRIEVAL_HIGH_THRESHOLD) {
    return "high";
  }
  if (finalScore < RETRIEVAL_LOW_THRESHOLD) {
    return "low";
  }
  return "mid";
}

function normalizeSparseScore(rawScore: number): number {
  if (!Number.isFinite(rawScore) || rawScore <= 0) {
    return 0;
  }
  return roundScore(Math.min(1, rawScore / 0.6));
}

type TopicHybridMatch = {
  topicId: string;
  vectorScore: number;
  bm25Score: number;
  fusionScore: number;
};

function mergeTopicMatches(params: {
  vectorMatches: TopicVectorMatch[];
  sparseMatches: TopicSparseMatch[];
}): TopicHybridMatch[] {
  const merged = new Map<string, TopicHybridMatch>();
  for (const match of params.vectorMatches) {
    const prev = merged.get(match.topicId) ?? {
      topicId: match.topicId,
      vectorScore: 0,
      bm25Score: 0,
      fusionScore: 0,
    };
    prev.vectorScore = roundScore(Math.max(prev.vectorScore, Math.max(0, Math.min(1, match.similarity))));
    merged.set(match.topicId, prev);
  }
  for (const match of params.sparseMatches) {
    const prev = merged.get(match.topicId) ?? {
      topicId: match.topicId,
      vectorScore: 0,
      bm25Score: 0,
      fusionScore: 0,
    };
    prev.bm25Score = roundScore(Math.max(prev.bm25Score, normalizeSparseScore(match.score)));
    merged.set(match.topicId, prev);
  }

  for (const value of merged.values()) {
    value.fusionScore = roundScore(
      value.vectorScore * RETRIEVAL_FUSION_ALPHA +
        value.bm25Score * (1 - RETRIEVAL_FUSION_ALPHA)
    );
  }

  return Array.from(merged.values()).sort(
    (left, right) => right.fusionScore - left.fusionScore
  );
}

async function upsertContentTopicScores(params: {
  contentId: string;
  contentText: string;
  topicsById: Map<string, JobCollectorTopic>;
  topicMatches: TopicHybridMatch[];
}) {
  const normalizedText = params.contentText.toLowerCase();
  const scoreDrafts: Array<{
    topicId: string;
    vectorScore: number;
    keywordScore: number;
    exclusionPenalty: number;
    coreScore: number;
    expansionScore: number;
    bm25Score: number;
    fusionScore: number;
    finalScore: number;
  }> = [];

  for (const match of params.topicMatches) {
    const topic = params.topicsById.get(match.topicId);
    if (!topic) {
      continue;
    }
    const coreTerms = topic.terms.filter((term) => term.type === "CORE");
    const expansionTerms = topic.terms.filter((term) => term.type === "EXPANSION");
    const exclusionTerms = topic.terms.filter((term) => term.type === "EXCLUSION");

    const coreScore = countTermMatches(normalizedText, coreTerms);
    const expansionScore = countTermMatches(normalizedText, expansionTerms);
    const exclusionPenalty = countTermMatches(normalizedText, exclusionTerms);
    const keywordScore = roundScore(match.bm25Score * 10 + coreScore + expansionScore);
    const vectorScore = roundScore(Math.max(0, Math.min(1, match.vectorScore)));
    const coreBoost = Math.max(
      0,
      Math.min(1, normalizeTermScore(coreScore) * RETRIEVAL_CORE_WEIGHT)
    );
    const expansionBoost = Math.max(
      0,
      Math.min(1, normalizeTermScore(expansionScore) * RETRIEVAL_EXPANSION_WEIGHT)
    );
    const exclusionCost = exclusionPenalty * RETRIEVAL_EXCLUSION_WEIGHT;
    const finalScore = roundScore(
      Math.max(0, Math.min(1, match.fusionScore + coreBoost + expansionBoost - exclusionCost))
    );

    if (finalScore < RETRIEVAL_LOW_THRESHOLD && exclusionPenalty > 0) {
      continue;
    }

    scoreDrafts.push({
      topicId: topic.id,
      vectorScore,
      keywordScore,
      exclusionPenalty,
      coreScore,
      expansionScore,
      bm25Score: match.bm25Score,
      fusionScore: match.fusionScore,
      finalScore,
    });
  }

  const llmRerankScores = await rerankTopicScoresWithLlm({
    contentId: params.contentId,
    contentText: params.contentText,
    topicsById: params.topicsById,
    scoreDrafts,
  });

  for (const draft of scoreDrafts) {
    const llmScore = llmRerankScores.get(draft.topicId);
    const finalScore =
      typeof llmScore === "number"
        ? roundScore(
            Math.max(
              0,
              Math.min(
                1,
                draft.finalScore * (1 - RETRIEVAL_LLM_RERANK_WEIGHT) +
                  llmScore * RETRIEVAL_LLM_RERANK_WEIGHT
              )
            )
          )
        : draft.finalScore;
    const reasonCore = `vector:${draft.vectorScore.toFixed(3)} core:${draft.coreScore.toFixed(2)} expansion:${draft.expansionScore.toFixed(2)} exclusion:${draft.exclusionPenalty.toFixed(2)}`;
    const reason = typeof llmScore === "number" ? `${reasonCore} llm:${llmScore.toFixed(3)}` : reasonCore;

    await prisma.contentTopicScore.upsert({
      where: {
        contentId_topicId: {
          contentId: params.contentId,
          topicId: draft.topicId,
        },
      },
      create: {
        contentId: params.contentId,
        topicId: draft.topicId,
        vectorScore: draft.vectorScore,
        keywordScore: draft.keywordScore,
        exclusionPenalty: draft.exclusionPenalty,
        finalScore,
        reason,
        explain: {
          bm25Score: draft.bm25Score,
          fusionScore: draft.fusionScore,
          vectorScore: draft.vectorScore,
          coreScore: draft.coreScore,
          expansionScore: draft.expansionScore,
          exclusionPenalty: draft.exclusionPenalty,
          keywordScore: draft.keywordScore,
          baseFinalScore: draft.finalScore,
          llmRerankScore: llmScore ?? null,
          llmRerankWeight:
            typeof llmScore === "number" ? RETRIEVAL_LLM_RERANK_WEIGHT : 0,
        } as Prisma.InputJsonValue,
      },
      update: {
        vectorScore: draft.vectorScore,
        keywordScore: draft.keywordScore,
        exclusionPenalty: draft.exclusionPenalty,
        finalScore,
        reason,
        explain: {
          bm25Score: draft.bm25Score,
          fusionScore: draft.fusionScore,
          vectorScore: draft.vectorScore,
          coreScore: draft.coreScore,
          expansionScore: draft.expansionScore,
          exclusionPenalty: draft.exclusionPenalty,
          keywordScore: draft.keywordScore,
          baseFinalScore: draft.finalScore,
          llmRerankScore: llmScore ?? null,
          llmRerankWeight:
            typeof llmScore === "number" ? RETRIEVAL_LLM_RERANK_WEIGHT : 0,
        } as Prisma.InputJsonValue,
      },
    });
  }
}

function normalizeTermScore(score: number): number {
  if (!Number.isFinite(score) || score <= 0) {
    return 0;
  }
  return roundScore(Math.min(1, score / 3));
}

async function rerankTopicScoresWithLlm(params: {
  contentId: string;
  contentText: string;
  topicsById: Map<string, JobCollectorTopic>;
  scoreDrafts: Array<{
    topicId: string;
    finalScore: number;
  }>;
}) {
  const result = new Map<string, number>();
  if (!RETRIEVAL_LLM_RERANK_ENABLED || RETRIEVAL_LLM_RERANK_WEIGHT <= 0) {
    return result;
  }
  const candidates = [...params.scoreDrafts]
    .filter((item) => item.finalScore >= RETRIEVAL_LLM_RERANK_MIN_SCORE)
    .sort((left, right) => right.finalScore - left.finalScore)
    .slice(0, RETRIEVAL_LLM_RERANK_TOP_N);
  if (!candidates.length) {
    return result;
  }

  const topics = candidates
    .map((item) => params.topicsById.get(item.topicId))
    .filter(Boolean) as JobCollectorTopic[];
  const topicText = topics
    .map((topic) => {
      const coreTerms = topic.terms
        .filter((term) => term.type === "CORE")
        .map((term) => term.value.trim())
        .filter(Boolean)
        .slice(0, 8)
        .join(", ");
      const expansionTerms = topic.terms
        .filter((term) => term.type === "EXPANSION")
        .map((term) => term.value.trim())
        .filter(Boolean)
        .slice(0, 10)
        .join(", ");
      return `topicId=${topic.id}\nname=${topic.name}\ncore=${coreTerms}\nexpansion=${expansionTerms}`;
    })
    .join("\n\n");

  try {
    const payload = await llmGateway.json("topic-rerank", {
      model: process.env.LLM_DEFAULT_MODEL ?? "gpt-5-mini",
      temperature: 0,
      metadata: {
        contentId: params.contentId,
        topN: candidates.length,
      },
      prompt: [
        "你是内容与主题匹配度评估助手。",
        "请根据内容与主题定义，为每个 topic 输出 0~1 的匹配度评分。",
        "评分标准：0=无关，0.5=部分相关，1=高度相关。",
        "仅输出 JSON，格式：{\"scores\":[{\"topicId\":\"...\",\"score\":0.0}]}。",
        "",
        "候选主题：",
        topicText,
        "",
        "内容：",
        params.contentText.slice(0, 4000),
      ].join("\n"),
    });
    const checked = TopicRerankSchema.safeParse(payload);
    if (!checked.success) {
      logger.warn("topic rerank invalid payload", {
        contentId: params.contentId,
        details: checked.error.flatten(),
      });
      return result;
    }
    for (const item of checked.data.scores) {
      if (!candidates.some((candidate) => candidate.topicId === item.topicId)) {
        continue;
      }
      result.set(item.topicId, roundScore(item.score));
    }
  } catch (error) {
    logger.warn("topic rerank failed", {
      contentId: params.contentId,
      error: logger.normalizeError(error),
    });
  }
  return result;
}

function buildKeywordFilterTerms(
  keywords: QueryKeyword[]
): string[] {
  const terms: string[] = [];
  for (const keyword of keywords) {
    if (keyword.includes.length > 0) {
      terms.push(...keyword.includes);
    } else if (keyword.name.trim()) {
      terms.push(keyword.name.trim());
    }
  }
  return Array.from(new Set(terms.map((term) => term.trim().toLowerCase()).filter(Boolean)));
}

function resolveKeywordStrategy(source: SourceWithRelations): KeywordStrategy {
  if (source.category === "RETRIEVAL" && !source.isDarknet) {
    const configured =
      (source as SearchEngineSource).search?.keywordStrategy ?? KeywordStrategy.AUTO;
    return configured === KeywordStrategy.AUTO ? KeywordStrategy.HYBRID : configured;
  }
  if (source.category === "INTERACTIVE") {
    const socialSource = source as SocialMediaSource;
    const configured = socialSource.social?.keywordStrategy ?? KeywordStrategy.AUTO;
    if (configured !== KeywordStrategy.AUTO) {
      return configured;
    }
    const intent = resolveGatherIntent(asObject(socialSource.social?.config)).type
      .trim()
      .toLowerCase();
    return intent === "search"
      ? KeywordStrategy.HYBRID
      : KeywordStrategy.PRECISION_ONLY;
  }
  return KeywordStrategy.PRECISION_ONLY;
}

function buildRecallQueries(keywords: QueryKeyword[]): string[] {
  const queries: string[] = [];
  for (const keyword of keywords) {
    const includeTerms = normalizeStringArray(keyword.includes);
    if (includeTerms.length > 0) {
      queries.push(...includeTerms);
      continue;
    }
    const fallbackName = keyword.name.trim();
    if (!fallbackName) continue;
    queries.push(fallbackName);
  }
  return Array.from(new Set(queries.map((query) => query.trim()).filter(Boolean)));
}

const RECALL_LANGUAGE_ORDER: RecallLanguage[] = ["zh", "en", "ja"];

function normalizeRecallLanguages(input: unknown): RecallLanguage[] {
  const raw = Array.isArray(input) ? input : [];
  const normalized = Array.from(
    new Set(
      raw
        .map((item) => String(item).trim().toLowerCase())
        .filter(
          (item): item is RecallLanguage =>
            item === "zh" || item === "en" || item === "ja"
        )
    )
  );
  return normalized.length > 0 ? normalized : [...RECALL_LANGUAGE_ORDER];
}

function resolveRecallLanguages(topics: JobCollectorTopic[]): RecallLanguage[] {
  const merged = normalizeRecallLanguages(topics.flatMap((topic) => topic.recallLanguages));
  return RECALL_LANGUAGE_ORDER.filter((lang) => merged.includes(lang));
}

function resolveTopicRecallLimit(): number {
  if (!Number.isFinite(TOPIC_RECALL_QUERY_LIMIT) || TOPIC_RECALL_QUERY_LIMIT < 1) {
    return 8;
  }
  return Math.max(1, Math.min(Math.floor(TOPIC_RECALL_QUERY_LIMIT), 16));
}

function resolveTopicRecallTimeoutMs(): number {
  if (!Number.isFinite(TOPIC_RECALL_TIMEOUT_MS) || TOPIC_RECALL_TIMEOUT_MS < 500) {
    return 8000;
  }
  return Math.max(500, Math.min(Math.floor(TOPIC_RECALL_TIMEOUT_MS), 30_000));
}

function resolveTopicRecallMinPerLanguage(): number {
  if (!Number.isFinite(TOPIC_RECALL_MIN_PER_LANGUAGE)) {
    return 1;
  }
  return Math.max(1, Math.min(Math.floor(TOPIC_RECALL_MIN_PER_LANGUAGE), 3));
}

function resolveTopicRecallCoverageRetryLimit(): number {
  if (!Number.isFinite(TOPIC_RECALL_COVERAGE_RETRY_LIMIT)) {
    return 1;
  }
  return Math.max(0, Math.min(Math.floor(TOPIC_RECALL_COVERAGE_RETRY_LIMIT), 3));
}

function normalizeRecallQueries(queries: string[], limit: number): string[] {
  return Array.from(new Set(queries.map((query) => query.trim()).filter(Boolean))).slice(
    0,
    Math.max(1, Math.min(limit, 64))
  );
}

function normalizeRecallQueryItems(params: {
  queries: TopicRecallQueryItem[];
  limit: number;
  allowedLanguages: RecallLanguage[];
}): string[] {
  const normalizedLanguages = normalizeRecallLanguages(params.allowedLanguages);
  const allowed = new Set(normalizedLanguages);
  const byLang = new Map<RecallLanguage, string[]>(
    RECALL_LANGUAGE_ORDER.map((lang) => [lang, []])
  );
  const dedup = new Set<string>();

  for (const item of params.queries) {
    if (!allowed.has(item.lang)) {
      continue;
    }
    const text = item.text.trim();
    if (!text) continue;
    const dedupKey = `${item.lang}:${text.toLowerCase()}`;
    if (dedup.has(dedupKey)) {
      continue;
    }
    dedup.add(dedupKey);
    byLang.get(item.lang)?.push(text);
  }

  const flattened: string[] = [];
  for (const lang of RECALL_LANGUAGE_ORDER) {
    if (!allowed.has(lang)) continue;
    const items = byLang.get(lang) ?? [];
    for (const item of items) {
      flattened.push(item);
      if (flattened.length >= Math.max(1, Math.min(params.limit, 64))) {
        return flattened;
      }
    }
  }

  return flattened;
}

function buildRecallCoverage(params: {
  queries: TopicRecallQueryItem[];
  allowedLanguages: RecallLanguage[];
}): Record<RecallLanguage, number> {
  const allowed = new Set(normalizeRecallLanguages(params.allowedLanguages));
  const coverage: Record<RecallLanguage, number> = { zh: 0, en: 0, ja: 0 };
  for (const item of params.queries) {
    if (!allowed.has(item.lang)) continue;
    const text = item.text.trim();
    if (!text) continue;
    coverage[item.lang] += 1;
  }
  return coverage;
}

function findRecallCoverageMissingLanguages(params: {
  queries: TopicRecallQueryItem[];
  allowedLanguages: RecallLanguage[];
  minPerLanguage: number;
}): RecallLanguage[] {
  const coverage = buildRecallCoverage({
    queries: params.queries,
    allowedLanguages: params.allowedLanguages,
  });
  return normalizeRecallLanguages(params.allowedLanguages).filter(
    (lang) => coverage[lang] < params.minPerLanguage
  );
}

function dedupeRecallQueryItems(
  queries: TopicRecallQueryItem[]
): TopicRecallQueryItem[] {
  const dedup = new Set<string>();
  const output: TopicRecallQueryItem[] = [];
  for (const item of queries) {
    const text = item.text.trim();
    if (!text) continue;
    const dedupKey = `${item.lang}:${text.toLowerCase()}`;
    if (dedup.has(dedupKey)) continue;
    dedup.add(dedupKey);
    output.push({
      text,
      lang: item.lang,
    });
  }
  return output;
}

function isTopicRecallSource(source: SourceWithRelations): boolean {
  if (source.category === "RETRIEVAL" && !source.isDarknet) {
    return true;
  }
  if (source.category === "INTERACTIVE") {
    const socialSource = source as SocialMediaSource;
    const intent = resolveGatherIntent(asObject(socialSource.social?.config)).type
      .trim()
      .toLowerCase();
    return intent === "search";
  }
  return false;
}

function buildSourceRecallContext(source: SourceWithRelations): string {
  if (source.category === "RETRIEVAL" && !source.isDarknet) {
    const searchSource = source as SearchEngineSource;
    const platform = (searchSource.search?.platform ?? "custom").toString();
    const engine = (searchSource.search?.engine ?? "custom").toString();
    const objective = (
      (searchSource.search as unknown as { objective?: string })?.objective ?? ""
    )
      .trim()
      .slice(0, 300);
    return `sourceType:search\nplatform:${platform}\nengine:${engine}\nobjective:${objective || "none"}`;
  }
  if (source.category === "INTERACTIVE") {
    const socialSource = source as SocialMediaSource;
    const intent = resolveGatherIntent(asObject(socialSource.social?.config)).type
      .trim()
      .toLowerCase();
    const platform = (socialSource.social?.platform ?? "unknown").toString();
    return `sourceType:social\nplatform:${platform}\nintent:${intent || "unknown"}`;
  }
  return `sourceType:${source.category.toLowerCase()}`;
}

function buildTopicRecallPrompt(params: {
  topics: JobCollectorTopic[];
  source: SourceWithRelations;
  limit: number;
  recallLanguages: RecallLanguage[];
}): string {
  const topicPayload = params.topics.map((topic) => {
    const coreTerms = topic.terms
      .filter((term) => term.type === "CORE")
      .map((term) => term.value.trim())
      .filter(Boolean);
    const expansionTerms = topic.terms
      .filter((term) => term.type === "EXPANSION")
      .map((term) => term.value.trim())
      .filter(Boolean);
    const exclusionTerms = topic.terms
      .filter((term) => term.type === "EXCLUSION")
      .map((term) => term.value.trim())
      .filter(Boolean);
    return {
      topicId: topic.id,
      name: topic.name,
      description: topic.description ?? "",
      coreTerms,
      expansionTerms,
      exclusionTerms,
    };
  });
  return stripPromptLike(
    `你是检索 query 生成器。请输出 JSON：{"queries":[{"text":"...","lang":"zh|en|ja"}]}。
要求：
1) 仅输出搜索 query 对象数组，数量 3-${params.limit}；
2) 每个 query 的 lang 必须属于：${params.recallLanguages.join(", ")}；
3) query 需要覆盖主题核心词与扩展词，避免重复；
4) 保持短句可检索；如存在排除词，请在 query 中尽量体现负向约束（如 -term）；
5) 不要输出解释、不要输出 markdown。

Source:
name: ${params.source.name}
${buildSourceRecallContext(params.source)}

Topics(JSON):
${JSON.stringify(topicPayload)}`
  );
}

function buildTopicRecallCoveragePatchPrompt(params: {
  topics: JobCollectorTopic[];
  source: SourceWithRelations;
  missingLanguages: RecallLanguage[];
  limit: number;
  seedQueries: TopicRecallQueryItem[];
}): string {
  const topicPayload = params.topics.map((topic) => ({
    topicId: topic.id,
    name: topic.name,
    description: topic.description ?? "",
    coreTerms: topic.terms
      .filter((term) => term.type === "CORE")
      .map((term) => term.value.trim())
      .filter(Boolean),
    expansionTerms: topic.terms
      .filter((term) => term.type === "EXPANSION")
      .map((term) => term.value.trim())
      .filter(Boolean),
    exclusionTerms: topic.terms
      .filter((term) => term.type === "EXCLUSION")
      .map((term) => term.value.trim())
      .filter(Boolean),
  }));
  return stripPromptLike(
    `你是检索 query 语言补齐器。请只为缺失语言补齐搜索 query。
输出 JSON：{"queries":[{"text":"...","lang":"zh|en|ja"}]}
要求：
1) 只输出语言：${params.missingLanguages.join(", ")}；
2) 每个缺失语言至少补 1 条，最多补 ${params.limit} 条；
3) 不要解释，不要 markdown，不要输出非 JSON。

Source:
name: ${params.source.name}
${buildSourceRecallContext(params.source)}

Topics(JSON):
${JSON.stringify(topicPayload)}

已有查询(JSON):
${JSON.stringify(params.seedQueries)}`
  );
}

async function generateTopicRecallCoveragePatch(params: {
  runId: string;
  jobId: string;
  source: SourceWithRelations;
  topics: JobCollectorTopic[];
  missingLanguages: RecallLanguage[];
  limit: number;
  timeoutMs: number;
  seedQueries: TopicRecallQueryItem[];
}): Promise<TopicRecallQueryItem[]> {
  if (!TOPIC_RECALL_LLM_ENABLED || params.missingLanguages.length === 0) {
    return [];
  }
  try {
    const prompt = buildTopicRecallCoveragePatchPrompt({
      topics: params.topics,
      source: params.source,
      missingLanguages: params.missingLanguages,
      limit: params.limit,
      seedQueries: params.seedQueries,
    });
    const response = await withTimeout(
      llmGateway.json<z.infer<typeof TopicRecallQueriesSchema>>(
        "topic-recall-query",
        {
          prompt: redact(prompt),
          schema: TopicRecallQueriesSchema,
          temperature: 0.2,
          maxOutputTokens: 320,
          metadata: {
            runId: params.runId,
            jobId: params.jobId,
            sourceId: params.source.id,
            sourceName: params.source.name,
            patch: true,
          },
        }
      ),
      params.timeoutMs,
      `topic recall coverage patch timeout after ${params.timeoutMs}ms`
    );
    return dedupeRecallQueryItems(
      (response.queries ?? []).filter((item) =>
        params.missingLanguages.includes(item.lang)
      )
    );
  } catch (error) {
    logger.warn("topic recall coverage patch failed", {
      runId: params.runId,
      jobId: params.jobId,
      sourceId: params.source.id,
      sourceName: params.source.name,
      missingLanguages: params.missingLanguages,
      error: logger.normalizeError(error),
    });
    return [];
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function buildTopicRecallQueryBundles(params: {
  runId: string;
  jobId: string;
  topics: JobCollectorTopic[];
  sources: SourceWithRelations[];
  fallbackKeywords: QueryKeyword[];
}): Promise<Map<string, SourceRecallQueryBundle>> {
  const bundles = new Map<string, SourceRecallQueryBundle>();
  if (params.topics.length === 0) {
    return bundles;
  }
  const recallSources = params.sources.filter((source) => isTopicRecallSource(source));
  if (recallSources.length === 0) {
    return bundles;
  }

  const fallbackQueries = normalizeRecallQueries(
    buildRecallQueries(params.fallbackKeywords),
    resolveTopicRecallLimit()
  );
  const recallLimit = resolveTopicRecallLimit();
  const timeoutMs = resolveTopicRecallTimeoutMs();
  const recallLanguages = resolveRecallLanguages(params.topics);
  const minPerLanguage = resolveTopicRecallMinPerLanguage();
  const coverageRetryLimit = resolveTopicRecallCoverageRetryLimit();
  const coverageFeasible = recallLimit >= recallLanguages.length * minPerLanguage;

  for (const source of recallSources) {
    await publishTaskEvent(params.runId, {
      type: "recall-generate-start",
      sourceId: source.id,
      message: `为 ${source.name} 生成动态召回词`,
    });
    if (!TOPIC_RECALL_LLM_ENABLED) {
      const fallbackCoverage = buildRecallCoverage({
        queries: [],
        allowedLanguages: recallLanguages,
      });
      bundles.set(source.id, {
        queries: fallbackQueries,
        origin: "static_fallback",
        generatedCount: fallbackQueries.length,
      });
      await publishTaskEvent(params.runId, {
        type: "recall-generate-fallback",
        sourceId: source.id,
        message: "动态召回词已关闭，使用静态词项",
        requestedLanguages: recallLanguages,
        coverageByLanguage: fallbackCoverage,
        coverageComplete: false,
        generatedCount: fallbackQueries.length,
      });
      continue;
    }

    try {
      const prompt = buildTopicRecallPrompt({
        topics: params.topics,
        source,
        limit: recallLimit,
        recallLanguages,
      });
      const response = await withTimeout(
        llmGateway.json<z.infer<typeof TopicRecallQueriesSchema>>(
          "topic-recall-query",
          {
            prompt: redact(prompt),
            schema: TopicRecallQueriesSchema,
            temperature: 0.2,
            maxOutputTokens: 512,
            metadata: {
              runId: params.runId,
              jobId: params.jobId,
              sourceId: source.id,
              sourceName: source.name,
            },
          }
        ),
        timeoutMs,
        `topic recall generation timeout after ${timeoutMs}ms`
      );
      let generatedItems = dedupeRecallQueryItems(response.queries ?? []);
      let missingLanguages = coverageFeasible
        ? findRecallCoverageMissingLanguages({
            queries: generatedItems,
            allowedLanguages: recallLanguages,
            minPerLanguage,
          })
        : [];

      if (
        TOPIC_RECALL_COVERAGE_PATCH_ENABLED &&
        coverageFeasible &&
        missingLanguages.length > 0
      ) {
        for (let retry = 0; retry < coverageRetryLimit; retry += 1) {
          const patchedItems = await generateTopicRecallCoveragePatch({
            runId: params.runId,
            jobId: params.jobId,
            source,
            topics: params.topics,
            missingLanguages,
            limit: recallLimit,
            timeoutMs,
            seedQueries: generatedItems,
          });
          if (patchedItems.length > 0) {
            generatedItems = dedupeRecallQueryItems([
              ...generatedItems,
              ...patchedItems,
            ]);
          }
          missingLanguages = findRecallCoverageMissingLanguages({
            queries: generatedItems,
            allowedLanguages: recallLanguages,
            minPerLanguage,
          });
          if (missingLanguages.length === 0) {
            break;
          }
        }
      }

      const queries = normalizeRecallQueryItems({
        queries: generatedItems,
        limit: recallLimit,
        allowedLanguages: recallLanguages,
      });
      const effectiveQueries = queries.length > 0 ? queries : fallbackQueries;
      const coverageByLanguage = buildRecallCoverage({
        queries: generatedItems,
        allowedLanguages: recallLanguages,
      });
      const coverageComplete = coverageFeasible
        ? recallLanguages.every(
            (lang) => (coverageByLanguage[lang] ?? 0) >= minPerLanguage
          )
        : false;
      const origin: RecallQueryOrigin =
        queries.length > 0
          ? coverageComplete
            ? "llm_recall"
            : "coverage_patch"
          : "static_fallback";
      bundles.set(source.id, {
        queries: effectiveQueries,
        origin,
        generatedCount: effectiveQueries.length,
      });
      await publishTaskEvent(params.runId, {
        type: "recall-generate-success",
        sourceId: source.id,
        message:
          origin === "llm_recall"
            ? `动态召回词生成成功（${effectiveQueries.length}条）`
            : origin === "coverage_patch"
              ? `动态召回词补齐后生成（${effectiveQueries.length}条）`
            : `动态召回词为空，降级静态词项（${effectiveQueries.length}条）`,
        requestedLanguages: recallLanguages,
        coverageByLanguage,
        coverageComplete,
        minPerLanguage,
        coverageFeasible,
        origin,
        generatedCount: effectiveQueries.length,
      });
    } catch (error) {
      logger.warn("topic recall generation failed", {
        runId: params.runId,
        jobId: params.jobId,
        sourceId: source.id,
        sourceName: source.name,
        error: logger.normalizeError(error),
      });
      bundles.set(source.id, {
        queries: fallbackQueries,
        origin: "static_fallback",
        generatedCount: fallbackQueries.length,
      });
      await publishTaskEvent(params.runId, {
        type: "recall-generate-error",
        sourceId: source.id,
        message: "动态召回词生成失败，已降级静态词项",
        requestedLanguages: recallLanguages,
        coverageByLanguage: { zh: 0, en: 0, ja: 0 },
        coverageComplete: false,
        minPerLanguage,
        coverageFeasible,
        generatedCount: fallbackQueries.length,
      });
    }
  }

  return bundles;
}

function deduplicateItemsByUrlAndFingerprint(items: CleanItem[]): CleanItem[] {
  const seen = new Set<string>();
  const deduped: CleanItem[] = [];
  for (const item of items) {
    const signature = item.url?.trim()
      ? `url:${item.url.trim()}`
      : `fp:${hashString(`${item.platform}:${item.text.slice(0, 300)}`)}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    deduped.push(item);
  }
  return deduped;
}

async function cleanAndDedup(
  items: CleanItem[],
  runId: string
): Promise<CleanItem[]> {
  const seen = new Set<string>();
  const cleaned: CleanItem[] = [];
  for (const item of items) {
    const normalized = normalizeCleanItem(item);
    if (!normalized.fingerprint) continue;
    if (seen.has(normalized.fingerprint)) continue;
    seen.add(normalized.fingerprint);
    cleaned.push(normalized);
    await publishTaskEvent(runId, {
      type: "clean",
      message: `清洗 ${normalized.platform}`,
      fingerprint: normalized.fingerprint,
    });
  }
  await publishTaskEvent(runId, {
    type: "clean-done",
    message: `清洗后剩余 ${cleaned.length} 条`,
  });
  return cleaned;
}

async function fetchBySources(
  sources: SourceWithRelations[],
  runId: string,
  queryId: string,
  keywords: QueryKeyword[],
  sourcePolicyBySourceId: Map<string, SourceRuntimePolicy>,
  sourceRecallQueryBundles?: Map<string, SourceRecallQueryBundle>
): Promise<CleanItem[]> {
  const sourceConcurrency = resolveSourceFetchConcurrency();
  const recallQueryLimit = resolveRecallQueryLimit();
  const batches = await mapWithConcurrency(
    sources,
    sourceConcurrency,
    async (source): Promise<CleanItem[]> => {
      console.log(
        `[collector] fetchBySources start ${source.name} (${source.category})`
      );
      const driver = resolveFetchDriver(source);
      await publishTaskEvent(runId, {
        type: "fetch-driver",
        message: `开始抓取 ${source.name}`,
        sourceId: source.id,
        driver,
      });
      try {
        const sourcePolicy = sourcePolicyBySourceId.get(source.id) ?? {
          contentFilterEnabled: true,
          contentFilterMode: QueryContentFilterMode.TERM_AND_WORD_BOUNDARY,
        };
        const strategy = resolveKeywordStrategy(source);
        const sourceRecallBundle = sourceRecallQueryBundles?.get(source.id);
        const keywordFilterTerms =
          sourcePolicy.contentFilterEnabled &&
          (strategy === "PRECISION_ONLY" || strategy === "HYBRID")
            ? buildKeywordFilterTerms(keywords)
            : [];
        const rawRecallQueries =
          strategy === "RECALL_ONLY" || strategy === "HYBRID"
            ? sourceRecallBundle?.queries ?? buildRecallQueries(keywords)
            : [];
        const recallQueries = rawRecallQueries.slice(0, recallQueryLimit);
        if (rawRecallQueries.length > recallQueries.length) {
          logger.warn("recall queries truncated by limit", {
            runId,
            queryId,
            sourceId: source.id,
            sourceName: source.name,
            strategy,
            originalCount: rawRecallQueries.length,
            limitedCount: recallQueries.length,
            limit: recallQueryLimit,
          });
          await publishTaskEvent(runId, {
            type: "fetch-recall-limit",
            message: `召回检索词触发系统限制：${rawRecallQueries.length} -> ${recallQueries.length}（limit=${recallQueryLimit}）`,
            sourceId: source.id,
          });
        }
        const objectiveFallback = sanitizeObjectiveFallback(keywords);
        const fetched = await executeFetchDriver(
          source,
          driver,
          runId,
          queryId,
          keywordFilterTerms,
          recallQueries,
          objectiveFallback,
          sourcePolicy,
          sourceRecallBundle?.origin
        );
        console.log(
          `[collector] fetched ${fetched.length} items from ${source.name}`
        );
        const filtered = applySourceMinCharsFilter(fetched, source);
        if (filtered.length !== fetched.length) {
          await publishTaskEvent(runId, {
            type: "fetch-filtered",
            message: `来源 ${source.name} 过滤掉 ${fetched.length - filtered.length} 条低质量内容`,
            sourceId: source.id,
            driver,
            filteredCount: fetched.length - filtered.length,
            minChars: resolveSourceFilterMinChars(source),
          });
        }
        const preLlmFilterResult = applyPreLlmQualityGate(filtered);
        if (preLlmFilterResult.rejected.length > 0) {
          const reasonCount = preLlmFilterResult.rejected.reduce<
            Record<string, number>
          >((acc, entry) => {
            acc[entry.reason] = (acc[entry.reason] ?? 0) + 1;
            return acc;
          }, {});
          await publishTaskEvent(runId, {
            type: "pre-llm-filtered",
            message: `来源 ${source.name} 在LLM前过滤 ${preLlmFilterResult.rejected.length} 条噪音内容`,
            sourceId: source.id,
            driver,
            filteredCount: preLlmFilterResult.rejected.length,
            filterLevel: resolvePreLlmFilterLevel(),
            reasonCount,
          });
          for (const rejected of preLlmFilterResult.rejected) {
            logger.info("pre-llm quality gate dropped content", {
              runId,
              queryId,
              sourceId: source.id,
              sourceName: source.name,
              driver,
              reason: rejected.reason,
              url: rejected.item.url ?? null,
              sampleHash: rejected.sampleHash,
              metrics: rejected.metrics,
            });
          }
        }
        let passedItems = preLlmFilterResult.passed;
        if (CONTENT_MEANING_GATE_ENABLED && passedItems.length > 0) {
          const meaningPassed: CleanItem[] = [];
          const meaningSkipped: Array<{
            item: CleanItem;
            score: number;
            reason: string;
          }> = [];
          for (const candidate of passedItems) {
            const meaning = await analyzeContentMeaningWithRetry(
              candidate,
              runId,
              queryId
            );
            if (meaning.meaningful) {
              candidate.meaningScore = meaning.score;
              candidate.meaningReason = meaning.reason;
              meaningPassed.push(candidate);
              await publishTaskEvent(runId, {
                type: "meaning-gate-passed",
                sourceId: source.id,
                score: meaning.score,
                reason: meaning.reason,
              });
            } else {
              meaningSkipped.push({
                item: candidate,
                score: meaning.score,
                reason: meaning.reason,
              });
            }
          }
          if (meaningSkipped.length > 0) {
            await publishTaskEvent(runId, {
              type: "meaning-gate-skipped",
              message: `来源 ${source.name} 跳过 ${meaningSkipped.length} 条无意义内容`,
              sourceId: source.id,
              driver,
              skippedCount: meaningSkipped.length,
              minScore: CONTENT_MEANING_GATE_MIN_SCORE,
            });
            for (const skipped of meaningSkipped) {
              logger.info("content meaning gate skipped item", {
                runId,
                queryId,
                sourceId: source.id,
                sourceName: source.name,
                driver,
                url: skipped.item.url ?? null,
                score: skipped.score,
                reason: skipped.reason,
              });
            }
          }
          passedItems = meaningPassed;
        }

        passedItems.forEach((item) => {
          item.driver = driver;
        });
        await publishTaskEvent(runId, {
          type: "fetch-success",
          message: `抓取 ${source.name} 完成`,
          count: passedItems.length,
          sourceId: source.id,
          driver,
        });
        return passedItems;
      } catch (error) {
        await publishTaskEvent(runId, {
          type: "error",
          message: `抓取来源 ${source.name} 失败：${(error as Error).message}`,
          sourceId: source.id,
          driver,
        });
        return [];
      }
    }
  );
  return batches.flat();
}

function resolveSourceFetchConcurrency(): number {
  const raw = process.env.COLLECT_SOURCE_CONCURRENCY;
  if (!raw) return 3;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 3;
  }
  return Math.floor(parsed);
}

function resolveRecallQueryLimit(): number {
  const raw = process.env.COLLECT_RECALL_QUERY_LIMIT;
  if (!raw) return 16;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 16;
  }
  return Math.floor(parsed);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const normalizedConcurrency = Math.max(1, Math.floor(concurrency));
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const run = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await worker(items[index] as T, index);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(normalizedConcurrency, items.length) },
      () => run()
    )
  );
  return results;
}

function resolveFetchDriver(
  source: SourceWithRelations
): "fetch" | "playwright" | "ai" {
  let engine: CrawlerEngine | undefined;
  if (isWebSource(source)) {
    engine = source.web?.crawlerEngine;
  } else if (isDarknetSource(source)) {
    engine = source.darknet?.crawlerEngine;
  }
  if (
    engine === CrawlerEngine.PLAYWRIGHT ||
    engine === CrawlerEngine.PUPPETEER
  ) {
    return "playwright";
  }
  if (engine === CrawlerEngine.CUSTOM) {
    return "ai";
  }
  return "fetch";
}

async function executeFetchDriver(
  source: SourceWithRelations,
  driver: "fetch" | "playwright" | "ai",
  runId: string,
  queryId: string,
  keywordFilterTerms: string[],
  recallQueries: string[],
  objectiveFallback?: string,
  sourcePolicy?: SourceRuntimePolicy,
  recallQueryOrigin?: RecallQueryOrigin
): Promise<CleanItem[]> {
  const gatherDispatchSource = resolveGatherDispatchSource(source);
  if (gatherDispatchSource) {
    return fetchSocialSource(
      gatherDispatchSource,
      keywordFilterTerms,
      recallQueries,
      sourcePolicy,
      recallQueryOrigin
    );
  }

  switch (driver) {
    case "playwright":
      if (isWebSource(source)) {
        return fetchPlaywrightSource(source);
      }
      if (isDarknetSource(source)) {
        return fetchPlaywrightSource(source);
      }
      return [];
    case "ai":
      return fetchAICrawlerSource(
        source,
        runId,
        queryId,
        keywordFilterTerms,
        recallQueries,
        sourcePolicy,
        recallQueryOrigin
      );
    default:
      return fetchWithDefaultSource(
        source,
        runId,
        queryId,
        keywordFilterTerms,
        recallQueries,
        objectiveFallback,
        sourcePolicy,
        recallQueryOrigin
      );
  }
}

async function fetchWithDefaultSource(
  source: SourceWithRelations,
  runId: string,
  queryId: string,
  keywordFilterTerms: string[],
  recallQueries: string[],
  objectiveFallback?: string,
  sourcePolicy?: SourceRuntimePolicy,
  recallQueryOrigin?: RecallQueryOrigin
): Promise<CleanItem[]> {
  console.log(
    `[collector] fetchWithDefaultSource ${source.name} (${source.category})`
  );
  if (source.category === "STREAM") {
    return fetchHtmlSource(source as WebSource);
  }
  if (source.category === "RETRIEVAL" && source.isDarknet) {
    return fetchHtmlSource(source as DarknetSource);
  }
  if (source.category === "RETRIEVAL" && !source.isDarknet) {
    return fetchSearchSource(source as SearchEngineSource, {
      runId,
      queryId,
      recallQueries,
      objectiveFallback,
      recallQueryOrigin,
    });
  }
  if (source.category === "INTERACTIVE") {
    return fetchSocialSource(
      source as SocialMediaSource,
      keywordFilterTerms,
      recallQueries,
      sourcePolicy,
      recallQueryOrigin
    );
  }
  return [];
}

function resolveGatherDispatchSource(
  source: SourceWithRelations
): SocialMediaSource | null {
  if (source.category === "INTERACTIVE") {
    return source as SocialMediaSource;
  }

  const parsedByMarker =
    parseGatherExecutionMarker(source.description) ??
    parseGatherExecutionMarker(source.name);
  const parsedByConfig = parseGatherExecutionConfig(source);
  const platform = parsedByConfig?.platform ?? parsedByMarker?.platform ?? "";
  const intent = parsedByConfig?.intent ?? parsedByMarker?.intent ?? "";
  const args = (parsedByConfig?.args ?? {}) as Prisma.JsonObject;

  if (!platform || !intent) {
    return null;
  }

  return {
    ...(source as unknown as SocialMediaSource),
    category: "INTERACTIVE",
    social: {
      sourceId: source.id,
      platform,
      config: {
        driver: "playwright",
        intent: {
          type: intent,
          args,
        },
      },
      credentialId: source.credentialId,
      credential: source.credential ?? null,
      proxyId: source.proxyId,
      proxy: source.proxy ?? null,
      keywordStrategy: KeywordStrategy.AUTO,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}

function parseGatherExecutionConfig(
  source: SourceWithRelations
): { platform: string; intent: string; args: Record<string, unknown> } | null {
  if (!isWebSource(source)) return null;
  const parseRules = asObject(source.web?.parseRules);
  const gather = asObject(parseRules.gather);
  if (Object.keys(gather).length === 0) return null;

  const platform = String(gather.platform ?? "").trim().toUpperCase();
  const intent = String(gather.intentType ?? "").trim().toLowerCase();
  const args = asObject(gather.intentArgs);
  if (!platform || !intent) return null;

  return { platform, intent, args };
}

function parseGatherExecutionMarker(
  text: string | null | undefined
): { platform: string; intent: string } | null {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const match = raw.match(
    /collect\s+([a-z0-9_-]+)\s*\(([\w-]+)\)\s+via\s+gather_playwright/i
  );
  if (!match) return null;
  const platform = (match[1] ?? "").trim().toUpperCase();
  const intent = (match[2] ?? "").trim().toLowerCase();
  if (!platform || !intent) return null;
  return { platform, intent };
}

async function fetchPlaywrightSource(
  source: WebSource | DarknetSource
): Promise<CleanItem[]> {
  console.log(
    `[collector] fetchPlaywrightSource ${source.name}`
  );
  return fetchBrowserSource(source);
}

async function fetchBrowserSource(
  source: WebSource | DarknetSource
): Promise<CleanItem[]> {
  console.log(`[collector] fetchBrowserSource ${source.name}`);

  const urls = resolveValidSourceUrls(source);
  if (urls.length === 0) {
    logger.warn("skip browser fetch: no valid source urls", {
      sourceId: source.id,
      sourceName: source.name,
      sourceCategory: source.category,
    });
    return [];
  }

  const allItems: CleanItem[] = [];
  for (const url of urls) {
    try {
      const { title, content, markdown } = await browserAgent.fetchPageContent(url);
      console.log(`[collector] fetchBrowserSource success: ${url}`, { title });
      allItems.push({
        title,
        text: content,
        markdown,
        platform: source.name,
        url,
        time: new Date(),
        sourceId: source.id,
        sourceType: source.category,
        sourceIsDarknet: source.isDarknet,
      });
    } catch (error) {
      console.error(`[collector] fetchBrowserSource error: ${url}`, error);
    }
  }

  return allItems;
}

async function fetchAICrawlerSource(
  source: SourceWithRelations,
  runId: string,
  queryId: string,
  keywordFilterTerms: string[],
  recallQueries: string[],
  sourcePolicy?: SourceRuntimePolicy,
  recallQueryOrigin?: RecallQueryOrigin
): Promise<CleanItem[]> {
  if (isWebSource(source) || isDarknetSource(source)) {
    console.log(
      `[collector] fetchAICrawlerSource -> fetchBrowserSource ${source.name}`
    );
    return fetchBrowserSource(source);
  }
  if (source.category === "RETRIEVAL" && !source.isDarknet) {
    console.log(
      `[collector] fetchAICrawlerSource -> fetchSearchSource ${source.name}`
    );
    return fetchSearchSource(source as SearchEngineSource, {
      runId,
      queryId,
      recallQueries,
      recallQueryOrigin,
    });
  }
  console.log(
    `[collector] fetchAICrawlerSource -> fetchSocialSource ${source.name}`
  );
  return fetchSocialSource(
    source as SocialMediaSource,
    keywordFilterTerms,
    recallQueries,
    sourcePolicy,
    recallQueryOrigin
  );
}

function resolveSourceFilterMinChars(source: SourceWithRelations): number {
  if (isSocialSource(source) && source.social?.config) {
    const socialConfig = asObject(source.social.config);
    const filter = resolveGatherDriverFilter(socialConfig);
    const minChars = Number(filter.minChars);
    if (Number.isFinite(minChars) && minChars >= 0) {
      return Math.floor(minChars);
    }
  }
  if (isSearchSource(source) && source.search) {
    const options = asObject(source.search.options);
    const candidates = [
      asObject(options.filter).minChars,
      asObject(asObject(options.driver).filter).minChars,
      asObject(asObject(options.playwright).filter).minChars,
    ];
    for (const candidate of candidates) {
      const value = Number(candidate);
      if (Number.isFinite(value) && value >= 0) {
        return Math.floor(value);
      }
    }
  }
  return DEFAULT_SOURCE_FILTER_MIN_CHARS;
}

function isPlaceholderContent(item: CleanItem): boolean {
  const combined = [
    item.title ?? "",
    item.text ?? "",
    item.markdown ?? "",
  ]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!combined) return true;
  if (combined === "空数据") return true;
  if (combined.includes("返回空数据")) return true;
  if (/^(null|undefined|n\/a|no data|empty)$/i.test(combined)) return true;
  if (/暂无(内容|数据|正文)/.test(combined)) return true;
  if (/内容获取失败|抓取失败|加载失败/.test(combined)) return true;
  return false;
}

function resolvePreLlmFilterLevel(): "strict" | "standard" | "loose" {
  if (PRE_LLM_FILTER_LEVEL === "strict") return "strict";
  if (PRE_LLM_FILTER_LEVEL === "loose") return "loose";
  return "standard";
}

function resolvePreLlmThreshold(base: number): number {
  const level = resolvePreLlmFilterLevel();
  if (level === "strict") {
    return base * 0.8;
  }
  if (level === "loose") {
    return Math.min(0.98, base * 1.25);
  }
  return base;
}

function buildContentInspectionText(item: CleanItem): {
  text: string;
  plainText: string;
  lines: string[];
} {
  const merged = [item.title ?? "", item.markdown ?? "", item.text ?? ""]
    .join("\n")
    .replace(/\u0000/g, " ")
    .trim();
  const plainText = markdownToText(merged).replace(/\s+/g, " ").trim();
  const lines = merged
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return { text: merged, plainText, lines };
}

function computeRepeatLineRatio(lines: string[]): number {
  if (lines.length === 0) return 0;
  const normalized = lines.map((line) => line.toLowerCase());
  const uniqueCount = new Set(normalized).size;
  return 1 - uniqueCount / normalized.length;
}

function computeTemplateLineRatio(lines: string[]): number {
  if (lines.length === 0) return 0;
  const templatePattern =
    /(home|login|sign in|sign up|subscribe|newsletter|menu|copyright|all rights reserved|about us|privacy|terms|cookie|share|上一篇|下一篇|返回首页|登录|注册|订阅|版权|免责声明|相关阅读|热门推荐)/i;
  const templateLineCount = lines.reduce((count, line) => {
    if (line.length <= 60 && templatePattern.test(line)) {
      return count + 1;
    }
    return count;
  }, 0);
  return templateLineCount / lines.length;
}

function computeErrorKeywordHits(text: string): number {
  if (!text) return 0;
  const lower = text.toLowerCase();
  const keywords = [
    "access denied",
    "permission denied",
    "forbidden",
    "captcha",
    "robot check",
    "http error",
    "error 403",
    "error 404",
    "error 500",
    "request blocked",
    "stack trace",
    "service unavailable",
    "bad gateway",
    "gateway timeout",
  ];
  return keywords.reduce((count, keyword) => {
    return lower.includes(keyword) ? count + 1 : count;
  }, 0);
}

function computeGarbledRatio(text: string): {
  garbledRatio: number;
  replacementRatio: number;
  hasLongNoiseRun: boolean;
} {
  if (!text) {
    return { garbledRatio: 0, replacementRatio: 0, hasLongNoiseRun: false };
  }
  const totalChars = text.length;
  const replacementCount = (text.match(/�/g) ?? []).length;
  const controlCount = (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) ?? [])
    .length;
  const mojibakeCount = (text.match(/[ÃÂÐÑØåæœ]/g) ?? []).length;
  const weirdSymbolCount = (
    text.match(/[^\u4e00-\u9fffA-Za-z0-9\s.,!?;:()'"“”‘’\-_/[\]{}<>@#$%^&*+=|\\]/g) ?? []
  ).length;
  const garbledCount = replacementCount + controlCount + mojibakeCount + weirdSymbolCount;
  const longNoiseRunPattern =
    /[^\u4e00-\u9fffA-Za-z0-9\s.,!?;:()'"“”‘’\-_/[\]{}<>@#$%^&*+=|\\]{20,}/;
  return {
    garbledRatio: totalChars > 0 ? garbledCount / totalChars : 0,
    replacementRatio: totalChars > 0 ? replacementCount / totalChars : 0,
    hasLongNoiseRun: longNoiseRunPattern.test(text),
  };
}

function evaluatePreLlmQuality(item: CleanItem): {
  pass: boolean;
  reason?: PreLlmFilterReason;
  metrics: Record<string, number>;
} {
  if (isPlaceholderContent(item)) {
    return { pass: false, reason: "placeholder", metrics: { placeholder: 1 } };
  }
  const { text, plainText, lines } = buildContentInspectionText(item);
  if (!plainText) {
    return { pass: false, reason: "placeholder", metrics: { placeholder: 1 } };
  }

  const errorKeywordHits = computeErrorKeywordHits(text);
  const templateLineRatio = computeTemplateLineRatio(lines);
  const repeatLineRatio = computeRepeatLineRatio(lines);
  const { garbledRatio, replacementRatio, hasLongNoiseRun } =
    computeGarbledRatio(text);
  const sentenceCount = (plainText.match(/[。！？.!?]/g) ?? []).length;

  const metrics = {
    errorKeywordHits,
    templateLineRatio: roundScore(templateLineRatio),
    repeatLineRatio: roundScore(repeatLineRatio),
    garbledRatio: roundScore(garbledRatio),
    replacementRatio: roundScore(replacementRatio),
    sentenceCount,
    plainTextLength: plainText.length,
  };

  const errorHitsThreshold = Math.max(
    1,
    Math.floor(resolvePreLlmThreshold(PRE_LLM_FILTER_ERROR_KEYWORD_HITS))
  );
  if (errorKeywordHits >= errorHitsThreshold && sentenceCount <= 3) {
    return { pass: false, reason: "error_page", metrics };
  }

  const garbledRatioThreshold = resolvePreLlmThreshold(
    PRE_LLM_FILTER_GARBLED_RATIO_THRESHOLD
  );
  const replacementRatioThreshold = resolvePreLlmThreshold(
    PRE_LLM_FILTER_REPLACEMENT_RATIO_THRESHOLD
  );
  if (
    garbledRatio >= garbledRatioThreshold ||
    replacementRatio >= replacementRatioThreshold ||
    hasLongNoiseRun
  ) {
    return { pass: false, reason: "garbled_content", metrics };
  }

  const templateRatioThreshold = resolvePreLlmThreshold(
    PRE_LLM_FILTER_TEMPLATE_LINE_RATIO
  );
  if (templateLineRatio >= templateRatioThreshold && sentenceCount <= 4) {
    return { pass: false, reason: "template_noise", metrics };
  }

  const repeatRatioThreshold = resolvePreLlmThreshold(
    PRE_LLM_FILTER_REPEAT_LINE_RATIO
  );
  if (repeatLineRatio >= repeatRatioThreshold) {
    return { pass: false, reason: "repeated_noise", metrics };
  }

  return { pass: true, metrics };
}

function applyPreLlmQualityGate(items: CleanItem[]): PreLlmFilterResult {
  const passed: CleanItem[] = [];
  const rejected: PreLlmFilterReject[] = [];

  for (const item of items) {
    const evaluated = evaluatePreLlmQuality(item);
    if (evaluated.pass) {
      passed.push(item);
      continue;
    }
    rejected.push({
      item,
      reason: evaluated.reason ?? "placeholder",
      metrics: evaluated.metrics,
      sampleHash: hashString(
        `${item.sourceId}:${(item.url ?? "").trim()}:${(item.text ?? "").slice(0, 120)}`
      ),
    });
  }
  return { passed, rejected };
}

function applySourceMinCharsFilter(
  items: CleanItem[],
  source: SourceWithRelations
): CleanItem[] {
  const minChars = resolveSourceFilterMinChars(source);
  return items.filter((item) => {
    if (isPlaceholderContent(item)) {
      return false;
    }
    const baseText = (item.markdown || item.text || "").trim();
    if (!baseText) return false;
    if (minChars <= 0) return true;
    const plainText = markdownToText(baseText);
    return plainText.length >= minChars;
  });
}

function normalizeCleanItem(item: CleanItem): CleanItem {
  const normalizedText = item.text.replace(/\s+/g, " ").trim();
  const fingerprint = hashString(
    `${item.platform}-${normalizedText.slice(0, 200)}`
  );
  return { ...item, normalizedText, fingerprint };
}

function hashString(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function fetchHtmlSource(
  source: WebSource | DarknetSource
): Promise<CleanItem[]> {
  console.log(`[collector] fetchHtmlSource ${source.name}`);

  const urls = resolveValidSourceUrls(source);
  if (urls.length === 0) {
    logger.warn("skip html fetch: no valid source urls", {
      sourceId: source.id,
      sourceName: source.name,
      sourceCategory: source.category,
    });
    return [];
  }

  const allItems: CleanItem[] = [];
  for (const url of urls) {
    try {
      const html = await fetchWithTimeout(url);
      const { title, text, markdown } = toMarkdown(html);
      console.log(`[collector] fetchHtmlSource success: ${url}`, { title, text });
      allItems.push({
        title,
        text,
        markdown,
        platform: source.name,
        url,
        time: new Date(),
        sourceId: source.id,
        sourceType: source.category,
        sourceIsDarknet: source.isDarknet,
      });
    } catch (error) {
      console.error(`[collector] fetchHtmlSource error: ${url}`, error);
      // Continue to next URL
    }
  }

  return allItems;
}

function resolveValidSourceUrls(source: WebSource | DarknetSource): string[] {
  const rawUrls = isWebSource(source)
    ? (Array.isArray(source.web?.url) ? source.web?.url : source.web?.url ? [source.web.url] : [])
    : isDarknetSource(source)
      ? (Array.isArray(source.darknet?.url)
          ? source.darknet?.url
          : source.darknet?.url
            ? [source.darknet.url]
            : [])
      : [];
  return rawUrls
    .map((url) => String(url).trim())
    .filter(Boolean)
    .filter((url) => {
      try {
        const parsed = new URL(url);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        return false;
      }
    });
}

function isRetryableSearchError(error: unknown): boolean {
  if (error instanceof HttpStatusError) {
    return error.statusCode >= 500;
  }
  if (error instanceof Error) {
    return error.name === "AbortError";
  }
  return false;
}

async function waitForSearchRetry(attempt: number): Promise<void> {
  if (SEARCH_QUERY_RETRY_BACKOFF_MS <= 0) return;
  const delayMs = SEARCH_QUERY_RETRY_BACKOFF_MS * Math.max(1, attempt);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function fetchSearchSource(
  source: SearchEngineSource,
  context?: {
    runId?: string;
    queryId?: string;
    recallQueries?: string[];
    objectiveFallback?: string;
    recallQueryOrigin?: RecallQueryOrigin;
  }
): Promise<CleanItem[]> {
  console.log(`[collector] fetchSearchSource ${source.name}`);
  const configuredObjective = (
    (source.search as unknown as { objective?: string })?.objective ?? ""
  ).trim();
  const objective = configuredObjective || (context?.objectiveFallback ?? "").trim();

  const provider = detectSearchProvider(
    (source.search as unknown as { platform?: string | null })?.platform,
    source.search?.apiEndpoint,
    source.search?.options
  );
  const searchQueries = Array.from(
    new Set(
      (
        context?.recallQueries && context.recallQueries.length > 0
          ? context.recallQueries
          : [objective]
      )
        .map((query) => query.trim())
        .filter(Boolean)
    )
  );
  if (!searchQueries.some((query) => query.trim().length > 0)) {
    logger.warn("search source skipped due empty query and objective", {
      sourceId: source.id,
      sourceName: source.name,
      runId: context?.runId,
      queryId: context?.queryId,
      configuredObjective,
      fallbackObjective: context?.objectiveFallback ?? "",
      recallQueryCount: context?.recallQueries?.length ?? 0,
    });
    return [];
  }
  const allItems: CleanItem[] = [];
  const enableSearchSuccessDedup = shouldPersistSearchSuccessSignatures({
    runId: context?.runId,
    queryId: context?.queryId,
  });
  const searchSuccessSignatures = enableSearchSuccessDedup
    ? await loadRunSearchSuccessSignatures(context?.runId)
    : new Set<string>();
  const recallOrigin = context?.recallQueryOrigin ?? "static_fallback";
  let successCount = 0;
  let failedCount = 0;
  const sourceStartedAt = Date.now();
  logger.info("search source fetch start", {
    sourceId: source.id,
    sourceName: source.name,
    runId: context?.runId,
    queryId: context?.queryId,
    provider,
    recallQueryCount: searchQueries.length,
    dedupByQueryRun: enableSearchSuccessDedup,
  });
  const queryTasks = searchQueries
    .map((recallQuery, index) => ({
      recallQuery: recallQuery.trim(),
      queryIndex: index + 1,
      totalQueries: searchQueries.length,
    }))
    .filter((task) => task.recallQuery.length > 0);
  const queryTaskResults = await mapWithConcurrency(
    queryTasks,
    SEARCH_QUERY_CONCURRENCY,
    async (task) => {
      const signature = buildSearchSuccessSignature({
        sourceId: source.id,
        provider,
        recallQuery: task.recallQuery,
      });
      if (searchSuccessSignatures.has(signature)) {
        if (context?.runId) {
          await publishTaskEvent(context.runId, {
            type: "fetch-search-skip-retry-dup",
            sourceId: source.id,
            message: `跳过重复检索：${task.recallQuery}`,
          });
        }
        writeWorkerApiIoLog({
          event: "search-request-response",
          runId: context?.runId,
          queryId: context?.queryId,
          sourceId: source.id,
          sourceName: source.name,
          platform:
            (
              (source.search as unknown as { platform?: string | null })?.platform ??
              "unknown"
            ).toString(),
          provider,
          recallQuery: task.recallQuery,
          recallQueryCount: searchQueries.length,
          queryOrigin:
            context?.recallQueries && context.recallQueries.length > 0
              ? recallOrigin
              : "objective_fallback",
          rawRecallQueryCount: context?.recallQueries?.length ?? 0,
          effectiveRecallQueryCount: searchQueries.length,
          skippedByRetryDedup: true,
          url: source.search?.apiEndpoint ?? "",
          method: "SKIP",
          statusCode: 0,
          request: {
            headers: {},
            body: null,
          },
          response: {
            body: "",
          },
          parsedCount: 0,
        });
        return { success: false, failed: false, items: [] as CleanItem[] };
      }

      const request = buildSearchRequest(source, provider, task.recallQuery);
      if (!request.url) {
        logger.error("search source missing api endpoint", {
          sourceId: source.id,
          sourceName: source.name,
          runId: context?.runId,
          queryId: context?.queryId,
          provider,
          recallQuery: task.recallQuery,
          queryIndex: task.queryIndex,
          totalQueries: task.totalQueries,
        });
        return { success: false, failed: true, items: [] as CleanItem[] };
      }

      for (let attempt = 1; attempt <= SEARCH_QUERY_RETRY_LIMIT + 1; attempt++) {
        const queryStartedAt = Date.now();
        logger.info("search request start", {
          sourceId: source.id,
          sourceName: source.name,
          runId: context?.runId,
          queryId: context?.queryId,
          provider,
          recallQuery: task.recallQuery,
          queryIndex: task.queryIndex,
          totalQueries: task.totalQueries,
          attempt,
          maxAttempts: SEARCH_QUERY_RETRY_LIMIT + 1,
          timeoutMs: request.timeoutMs ?? 12_000,
          url: request.url,
          method: request.method,
        });
        if (context?.runId) {
          await publishTaskEvent(context.runId, {
            type: "fetch-search-query-start",
            sourceId: source.id,
            message: `检索中 (${task.queryIndex}/${task.totalQueries})：${task.recallQuery}`,
            provider,
            queryIndex: task.queryIndex,
            totalQueries: task.totalQueries,
            timeoutMs: request.timeoutMs ?? 12_000,
          });
        }

        try {
          const response = await fetchWithTimeoutDetailed(
            request.url,
            {
              method: request.method,
              headers: request.headers,
              body: request.body,
            },
            request.timeoutMs
          );
          const parsedResult = parseSearchResult(response.text);
          writeWorkerApiIoLog({
            event: "search-request-response",
            runId: context?.runId,
            queryId: context?.queryId,
            sourceId: source.id,
            sourceName: source.name,
            platform:
              (
                (source.search as unknown as { platform?: string | null })?.platform ??
                "unknown"
              ).toString(),
            provider,
            recallQuery: task.recallQuery,
            recallQueryCount: searchQueries.length,
            queryOrigin:
              context?.recallQueries && context.recallQueries.length > 0
                ? recallOrigin
                : "objective_fallback",
            rawRecallQueryCount: context?.recallQueries?.length ?? 0,
            effectiveRecallQueryCount: searchQueries.length,
            skippedByRetryDedup: false,
            timeoutMs: request.timeoutMs ?? 12_000,
            url: request.url,
            method: request.method,
            statusCode: response.statusCode,
            request: {
              headers: request.headers,
              body: request.body ?? null,
            },
            response: {
              body: response.text,
            },
            parsedCount: parsedResult.items.length,
            requestId: parsedResult.requestId,
          });
          if (response.statusCode === 200 && parsedResult.items.length === 0) {
            logger.warn("search response parsed empty", {
              sourceId: source.id,
              sourceName: source.name,
              runId: context?.runId,
              queryId: context?.queryId,
              provider,
              recallQuery: task.recallQuery,
              queryIndex: task.queryIndex,
              totalQueries: task.totalQueries,
              rootKeys: parsedResult.rootKeys,
            });
          }
          searchSuccessSignatures.add(signature);
          if (enableSearchSuccessDedup && context?.runId) {
            await persistRunSearchSuccessSignatures(
              context.runId,
              searchSuccessSignatures
            );
          }
          const elapsedMs = Date.now() - queryStartedAt;
          logger.info("search request done", {
            sourceId: source.id,
            sourceName: source.name,
            runId: context?.runId,
            queryId: context?.queryId,
            provider,
            recallQuery: task.recallQuery,
            queryIndex: task.queryIndex,
            totalQueries: task.totalQueries,
            statusCode: response.statusCode,
            parsedCount: parsedResult.items.length,
            elapsedMs,
            attempt,
          });
          if (context?.runId) {
            await publishTaskEvent(context.runId, {
              type: "fetch-search-query-done",
              sourceId: source.id,
              message: `检索完成 (${task.queryIndex}/${task.totalQueries})：${task.recallQuery}`,
              provider,
              queryIndex: task.queryIndex,
              totalQueries: task.totalQueries,
              parsedCount: parsedResult.items.length,
              elapsedMs,
            });
          }
          return {
            success: true,
            failed: false,
            items: parsedResult.items.map((item) => ({
              title: item.title,
              text: item.text,
              markdown: item.markdown,
              platform: source.name,
              url: item.url,
              time: item.time ? new Date(item.time) : new Date(),
              sourceId: source.id,
              sourceType: source.category,
              sourceIsDarknet: source.isDarknet,
              sourceRequestId: parsedResult.requestId,
            })),
          };
        } catch (error) {
          const elapsedMs = Date.now() - queryStartedAt;
          const retryable = isRetryableSearchError(error);
          const canRetry = retryable && attempt <= SEARCH_QUERY_RETRY_LIMIT;
          if (canRetry) {
            logger.warn("search request retrying", {
              sourceId: source.id,
              sourceName: source.name,
              runId: context?.runId,
              queryId: context?.queryId,
              provider,
              recallQuery: task.recallQuery,
              queryIndex: task.queryIndex,
              totalQueries: task.totalQueries,
              elapsedMs,
              attempt,
              nextAttempt: attempt + 1,
              error: logger.normalizeError(error),
            });
            await waitForSearchRetry(attempt);
            continue;
          }
          writeWorkerApiIoLog({
            event: "search-request-response",
            runId: context?.runId,
            queryId: context?.queryId,
            sourceId: source.id,
            sourceName: source.name,
            platform:
              (
                (source.search as unknown as { platform?: string | null })?.platform ??
                "unknown"
              ).toString(),
            provider,
            recallQuery: task.recallQuery,
            recallQueryCount: searchQueries.length,
            queryOrigin:
              context?.recallQueries && context.recallQueries.length > 0
                ? recallOrigin
                : "objective_fallback",
            rawRecallQueryCount: context?.recallQueries?.length ?? 0,
            effectiveRecallQueryCount: searchQueries.length,
            skippedByRetryDedup: false,
            timeoutMs: request.timeoutMs ?? 12_000,
            url: request.url,
            method: request.method,
            statusCode: -1,
            request: {
              headers: request.headers,
              body: request.body ?? null,
            },
            response: {
              body: "",
            },
            parsedCount: 0,
            error:
              error instanceof Error
                ? error.name === "AbortError"
                  ? `Request timeout after ${request.timeoutMs ?? 12_000}ms`
                  : error.message
                : "unknown search request error",
          });
          logger.error("search request failed", {
            sourceId: source.id,
            sourceName: source.name,
            runId: context?.runId,
            queryId: context?.queryId,
            provider,
            url: request.url,
            queryIndex: task.queryIndex,
            totalQueries: task.totalQueries,
            elapsedMs,
            attempt,
            error: logger.normalizeError(error),
          });
          if (context?.runId) {
            await publishTaskEvent(context.runId, {
              type: "fetch-search-query-fail",
              sourceId: source.id,
              message: `检索失败 (${task.queryIndex}/${task.totalQueries})：${task.recallQuery}`,
              provider,
              queryIndex: task.queryIndex,
              totalQueries: task.totalQueries,
              elapsedMs,
              error:
                error instanceof Error
                  ? error.name === "AbortError"
                    ? `Request timeout after ${request.timeoutMs ?? 12_000}ms`
                    : error.message
                  : "unknown search request error",
            });
          }
          return { success: false, failed: true, items: [] as CleanItem[] };
        }
      }
      return { success: false, failed: true, items: [] as CleanItem[] };
    }
  );
  for (const result of queryTaskResults) {
    if (result.success) {
      successCount += 1;
    }
    if (result.failed) {
      failedCount += 1;
    }
    allItems.push(...result.items);
  }
  logger.info("search source fetch summary", {
    sourceId: source.id,
    sourceName: source.name,
    runId: context?.runId,
    queryId: context?.queryId,
    provider,
    recallQueryCount: searchQueries.length,
    successCount,
    failedCount,
    totalItems: allItems.length,
    elapsedMs: Date.now() - sourceStartedAt,
    dedupByQueryRun: enableSearchSuccessDedup,
  });

  const dedupedItems = deduplicateItemsByUrlAndFingerprint(allItems);
  return dedupedItems;
}

async function fetchSocialSource(
  source: SocialMediaSource,
  keywordFilterTerms: string[],
  recallQueries: string[],
  sourcePolicy?: SourceRuntimePolicy,
  _recallQueryOrigin?: RecallQueryOrigin
): Promise<CleanItem[]> {
  console.log(`[collector] fetchSocialSource ${source.name} via Python Gather`);

  const gatherUrl = process.env.GATHER_SERVICE_URL || "http://localhost:8000";
  const gatherPlatform = mapGatherPlatform(source.social?.platform);
  const sourceConfig = source.social?.config || {};
  const sourceConfigObj = asObject(sourceConfig);
  const gatherDriver = resolveGatherDriver(sourceConfigObj);
  const proxyUrl =
    source.social?.proxy?.url ??
    source.proxy?.url ??
    null;
  const rawConfiguredIntent = asObject(sourceConfigObj.intent);
  const hasConfiguredIntentType =
    typeof rawConfiguredIntent.type === "string" &&
    rawConfiguredIntent.type.trim().length > 0;
  const defaultIntentType = hasConfiguredIntentType
    ? undefined
    : await resolveGatherDefaultIntent(gatherUrl, gatherPlatform);
  const intent = resolveGatherIntent(sourceConfigObj, defaultIntentType);
  const outputFieldRule = await resolveGatherOutputFieldRule(
    gatherUrl,
    gatherPlatform,
    intent.type
  );
  const output = resolveGatherOutput(sourceConfigObj, outputFieldRule);
  const ensuredCredentialStateFile = await ensureGatherStateFileFromStorage(
    source,
    gatherUrl,
    gatherPlatform
  );
  const normalizedSocialConfig = normalizeGatherSocialConfig(
    source,
    sourceConfigObj,
    gatherDriver,
    ensuredCredentialStateFile
  );
  const baseConfig = applyGatherProxyConfig(normalizedSocialConfig, proxyUrl);
  const configuredDriverFilter = resolveGatherDriverFilter(sourceConfigObj);
  const existingKeywordFilter = resolveGatherKeywordFilter(baseConfig);
  const keywordFilterOptions = {
    ...configuredDriverFilter,
    ...existingKeywordFilter,
  };
  normalizeKeywordFilterFields(keywordFilterOptions);
  delete keywordFilterOptions.keywords;
  const driverOption = normalizeGatherDriverOption(baseConfig, gatherDriver);
  const gatherUserId = resolveGatherPoolUserId(source, sourceConfigObj, driverOption);
  const normalizedIntentType = intent.type.trim().toLowerCase();
  const recallBinding = resolveRecallBinding(
    sourceConfigObj,
    sourcePolicy?.recallBindingOverride
  );
  const fallbackRecallQueries = Array.from(
    new Set(keywordFilterTerms.map((term) => term.trim()).filter(Boolean))
  );
  const effectiveRecallQueries =
    recallQueries.length > 0 ? recallQueries : fallbackRecallQueries;
  if (
    normalizedIntentType === "search" &&
    recallBinding.enabled &&
    effectiveRecallQueries.length === 0
  ) {
    logger.warn("skip social source due empty recall queries and recall binding enabled", {
      sourceId: source.id,
      sourceName: source.name,
      keywordFilterTermsCount: keywordFilterTerms.length,
      recallQueriesCount: recallQueries.length,
    });
    return [];
  }
  const batchedQueries =
    normalizedIntentType === "search" && recallBinding.enabled
      ? Array.from(
          new Set(effectiveRecallQueries.map((query) => query.trim()).filter(Boolean))
        )
      : [""];
  const normalizedBatchedQueries = batchedQueries.length > 0 ? batchedQueries : [""];
  const normalizedItems: CleanItem[] = [];
  const gatherMatchMode = mapQueryFilterModeToGatherMatchMode(
    sourcePolicy?.contentFilterMode
  );
  const gatherSetupHint =
    "cd apps/gather && uv pip install --python .venv/bin/python --index-url https://pypi.org/simple --force-reinstall playwright && uv run python -m playwright install chromium";

  try {
    for (const recallQuery of normalizedBatchedQueries) {
      const intentForRequest = recallBinding.enabled
        ? injectRecallQueryIntoIntent(intent, recallQuery, recallBinding.argKeys)
        : intent;
      const driver: GatherDriverPayload =
        Object.keys(keywordFilterOptions).length > 0
          ? {
              name: gatherDriver,
              ...driverOption,
              script: intentForRequest,
              filter: {
                ...keywordFilterOptions,
                ...(gatherMatchMode ? { matchMode: gatherMatchMode } : {}),
              },
            }
          : {
              name: gatherDriver,
              ...driverOption,
              script: intentForRequest,
              ...(gatherMatchMode ? { filter: { matchMode: gatherMatchMode } } : {}),
            };

      const response = await fetch(`${gatherUrl}/v1/fetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: gatherPlatform,
          userId: gatherUserId,
          keywords: keywordFilterTerms,
          driver,
          sourceId: source.id,
          output,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Gather service returned ${response.status}: ${errorText}`
        );
      }

      const data = await response.json();
      const items = Array.isArray(data?.items) ? data.items : [];
      normalizedItems.push(
        ...normalizeGatherItems(items, source, intentForRequest.type)
      );
    }
    return deduplicateItemsByUrlAndFingerprint(normalizedItems);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isPlaywrightMissing =
      /Playwright driver binary is missing/i.test(message) ||
      /uv run (python -m )?playwright install chromium/i.test(message) ||
      /No module named 'playwright\.__main__'/i.test(message);
    if (isPlaywrightMissing) {
      logger.error("gather playwright runtime missing", {
        sourceId: source.id,
        sourceName: source.name,
        gatherUrl,
        hint: gatherSetupHint,
        error: message,
      });
    } else {
      console.error(`[collector] fetchSocialSource error:`, error);
    }
    throw new Error(
      `Social gather failed for ${source.name}: ${message}${
        isPlaywrightMissing ? `; fix: ${gatherSetupHint}` : ""
      }`
    );
  }
}

function resolveGatherDriver(
  config: Record<string, unknown>
): GatherSocialDriver {
  const driverConfig = asObject(config.driver);
  const rawDriver =
    typeof config.driver === "string"
      ? config.driver.trim().toLowerCase()
      : typeof driverConfig.name === "string"
        ? driverConfig.name.trim().toLowerCase()
        : "";
  return rawDriver === "playwright" ? "playwright" : "playwright";
}

function mapGatherPlatform(platform?: string | null): string {
  if (!platform) return "unknown";
  return platform.toLowerCase();
}

function normalizeGatherSocialConfig(
  source: SocialMediaSource,
  config: Record<string, unknown>,
  driver: GatherSocialDriver,
  stateFileOverride?: string | null
): Record<string, unknown> {
  const sanitizedConfig = sanitizeGatherConfig(config);
  const credentialStateFile = stateFileOverride ?? resolveCredentialStateFile(source);

  if (driver !== "playwright") {
    return sanitizedConfig;
  }

  const playwright = asObject(sanitizedConfig.playwright);
  const normalizedPlaywright: Record<string, unknown> = {
    headless:
      typeof playwright.headless === "boolean" ? playwright.headless : false,
  };
  if (typeof playwright.poolEnabled === "boolean") {
    normalizedPlaywright.poolEnabled = playwright.poolEnabled;
  }
  if (
    typeof playwright.poolIdleTimeoutMs === "number" &&
    Number.isFinite(playwright.poolIdleTimeoutMs)
  ) {
    normalizedPlaywright.poolIdleTimeoutMs = Math.max(
      1000,
      Math.trunc(playwright.poolIdleTimeoutMs)
    );
  }

  if (typeof playwright.stateFile === "string" && playwright.stateFile.trim()) {
    normalizedPlaywright.stateFile = playwright.stateFile;
  } else if (credentialStateFile) {
    normalizedPlaywright.stateFile = credentialStateFile;
  }
  if (typeof playwright.targetUrl === "string" && playwright.targetUrl.trim()) {
    normalizedPlaywright.targetUrl = playwright.targetUrl.trim();
  }

  return { playwright: normalizedPlaywright };
}

async function ensureGatherStateFileFromStorage(
  source: SocialMediaSource,
  gatherUrl: string,
  gatherPlatform: string
): Promise<string | null> {
  const verifyStateFile = async (stateFilePath: string): Promise<boolean> => {
    const verifyResp = await fetch(`${gatherUrl}/v1/verify-auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: gatherPlatform,
        state_file: stateFilePath,
        headless: true,
      }),
    });
    if (!verifyResp.ok) return false;
    const verifyPayload = await verifyResp.json().catch(() => ({}));
    return !!verifyPayload?.valid;
  };

  const restoreAlias =
    source.social?.credentialId?.trim() ||
    source.credentialId?.trim() ||
    gatherPlatform;

  const credentialCandidates = [source.social?.credential?.data, source.credential?.data];
  for (const rawCandidate of credentialCandidates) {
    const decrypted = unwrapCredentialPayload(rawCandidate);
    if (!decrypted || typeof decrypted !== "object" || Array.isArray(decrypted)) {
      continue;
    }
    const payload = decrypted as Record<string, unknown>;
    const stateFile = typeof payload.stateFile === "string" ? payload.stateFile.trim() : "";
    const storageKey = typeof payload.storageKey === "string" ? payload.storageKey.trim() : "";
    if (!stateFile || !storageKey) continue;

    try {
      if (await verifyStateFile(stateFile)) {
        return stateFile;
      }
    } catch {
      // continue to restore from storage
    }

    try {
      const storageBuffer = await downloadFile(storageKey);
      const authData = JSON.parse(storageBuffer.toString("utf-8")) as Record<string, unknown>;
      const restoreResp = await fetch(`${gatherUrl}/v1/auth/state-file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: gatherPlatform,
          name: restoreAlias,
          auth_data: authData,
        }),
      });
      if (!restoreResp.ok) continue;
      const restorePayload = await restoreResp.json().catch(() => ({}));
      const restoredStateFile =
        typeof restorePayload?.stateFile === "string"
          ? restorePayload.stateFile.trim()
          : "";
      if (!restoredStateFile) {
        throw new Error("gather auth restore succeeded but stateFile is empty");
      }
      if (!(await verifyStateFile(restoredStateFile))) {
        throw new Error(`restored stateFile is still invalid: ${restoredStateFile}`);
      }
      return restoredStateFile;
    } catch (error) {
      logger.warn("failed to restore gather state file from storage", {
        sourceId: source.id,
        storageKey,
        error: logger.normalizeError(error),
      });
      throw new Error(
        `invalid auth state for source ${source.id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return null;
}

function resolveCredentialStateFile(source: SocialMediaSource): string | null {
  const candidates = [source.social?.credential?.data, source.credential?.data];
  for (const rawCandidate of candidates) {
    const candidate = unwrapCredentialPayload(rawCandidate);
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      continue;
    }
    const stateFile = (candidate as Record<string, unknown>).stateFile;
    if (typeof stateFile === "string" && stateFile.trim()) {
      return stateFile.trim();
    }
  }
  return null;
}

function sanitizeGatherConfig(
  config: Record<string, unknown>
): Record<string, unknown> {
  const sanitized = { ...config };
  delete sanitized.driver;
  delete sanitized.responseFormats;
  delete sanitized.output;
  delete sanitized.driverOptions;
  delete sanitized.intent;
  return sanitized;
}

function resolveGatherIntent(
  config: Record<string, unknown>,
  fallbackIntentType?: string
): GatherIntentPayload {
  const rawIntent = asObject(config.intent);
  const rawArgs = asObject(rawIntent.args);
  const intentType =
    typeof rawIntent.type === "string" && rawIntent.type.trim()
      ? rawIntent.type.trim()
      : typeof fallbackIntentType === "string" && fallbackIntentType.trim()
        ? fallbackIntentType.trim()
        : "search";

  if (Object.keys(rawArgs).length > 0) {
    return {
      type: intentType,
      args: rawArgs,
    };
  }

  const legacyPlaywrightArgs = asObject(asObject(config.playwright).args);
  if (Object.keys(legacyPlaywrightArgs).length > 0) {
    return {
      type: intentType,
      args: legacyPlaywrightArgs,
    };
  }

  return {
    type: intentType,
    args: {},
  };
}

function injectRecallQueryIntoIntent(
  intent: GatherIntentPayload,
  recallQuery: string,
  argKeys: string[]
): GatherIntentPayload {
  if (intent.type.trim().toLowerCase() !== "search") {
    return intent;
  }
  const normalizedQuery = recallQuery.trim();
  if (!normalizedQuery) {
    return intent;
  }
  return {
    ...intent,
    args: {
      ...intent.args,
      [resolveRecallTargetArgKey(intent.args, argKeys)]: normalizedQuery,
    },
  };
}

function resolveRecallTargetArgKey(
  args: Record<string, unknown>,
  argKeys: string[]
): string {
  const normalizedArgKeys = normalizeStringArray(argKeys);
  if (normalizedArgKeys.length === 0) return "query";
  for (const key of normalizedArgKeys) {
    if (Object.prototype.hasOwnProperty.call(args, key)) {
      return key;
    }
  }
  return normalizedArgKeys[0] ?? "query";
}

function resolveRecallBinding(
  config: Record<string, unknown>,
  overrides?: unknown
): { enabled: boolean; argKeys: string[] } {
  const topLevelBinding = asObject(config.recallBinding);
  const intent = asObject(config.intent);
  const recallBinding = {
    ...topLevelBinding,
    ...asObject(intent.recallBinding),
    ...asObject(overrides),
  };
  const argKeys = normalizeStringArray(recallBinding.argKeys);
  return {
    enabled:
      typeof recallBinding.enabled === "boolean" ? recallBinding.enabled : true,
    argKeys: argKeys.length > 0 ? argKeys : ["query"],
  };
}

function mapQueryFilterModeToGatherMatchMode(
  mode?: QueryContentFilterMode
): "term_and_word_boundary" | "contains" | "smart" | undefined {
  if (mode === QueryContentFilterMode.TERM_AND_WORD_BOUNDARY) {
    return "term_and_word_boundary";
  }
  if (mode === QueryContentFilterMode.CONTAINS) {
    return "contains";
  }
  if (mode === QueryContentFilterMode.SMART) {
    return "smart";
  }
  return undefined;
}

function resolveGatherOutput(
  config: Record<string, unknown>,
  ruleField?: GatherOutputField
): GatherOutputPayload {
  const configuredOutput = asObject(config.output);
  const outputKeywordScope = normalizeStringArray(
    configuredOutput.keywordScope ?? configuredOutput.scopeFields
  );
  const rawFields = configuredOutput.fields ?? configuredOutput.field;
  const mappedOutput = asObject(rawFields);
  if (Object.keys(mappedOutput).length > 0) {
    const mappedEntries: Array<[string, string]> = [];
    for (const [key, value] of Object.entries(mappedOutput)) {
      if (typeof key !== "string" || !key.trim()) {
        continue;
      }
      if (typeof value !== "string" || !value.trim()) {
        continue;
      }
      mappedEntries.push([key.trim(), value.trim()]);
    }
    const mappedField = Object.fromEntries(mappedEntries);
    if (Object.keys(mappedField).length > 0) {
      return {
        field: mappedField,
        ...(outputKeywordScope.length > 0 ? { keywordScope: outputKeywordScope } : {}),
      };
    }
  }
  if (Array.isArray(rawFields)) {
    const normalized = Array.from(
      new Set(
        rawFields
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter(Boolean)
      )
    );
    if (normalized.length > 0) {
      return {
        field: normalized,
        ...(outputKeywordScope.length > 0 ? { keywordScope: outputKeywordScope } : {}),
      };
    }
  }

  if (ruleField) {
    return {
      field: ruleField,
      ...(outputKeywordScope.length > 0 ? { keywordScope: outputKeywordScope } : {}),
    };
  }

  return {
    field: ["text", "markdown", "url"],
    ...(outputKeywordScope.length > 0 ? { keywordScope: outputKeywordScope } : {}),
  };
}

function normalizeGatherOutputField(value: unknown): GatherOutputField | null {
  if (Array.isArray(value)) {
    const normalized = Array.from(
      new Set(
        value
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
      )
    );
    return normalized.length > 0 ? normalized : null;
  }
  if (value && typeof value === "object") {
    const mappedEntries = Object.entries(value as Record<string, unknown>)
      .map(([key, mapped]) => [key.trim(), String(mapped ?? "").trim()] as const)
      .filter(([key, mapped]) => key.length > 0 && mapped.length > 0);
    if (mappedEntries.length > 0) {
      return Object.fromEntries(mappedEntries);
    }
  }
  return null;
}

async function resolveGatherOutputFieldRule(
  gatherUrl: string,
  platform: string,
  intentType: string
): Promise<GatherOutputField | undefined> {
  await refreshGatherScriptCatalogCache(gatherUrl);
  const cacheKey = `${platform.trim().toLowerCase()}:${intentType.trim().toLowerCase()}`;
  return gatherOutputFieldRuleCache.get(cacheKey);
}

async function resolveGatherDefaultIntent(
  gatherUrl: string,
  platform: string
): Promise<string | undefined> {
  await refreshGatherScriptCatalogCache(gatherUrl);
  const intents = gatherPlatformIntentCache.get(platform.trim().toLowerCase()) ?? [];
  if (intents.includes("search")) {
    return "search";
  }
  return intents[0];
}

async function refreshGatherScriptCatalogCache(gatherUrl: string): Promise<void> {
  const now = Date.now();
  if (now < gatherOutputFieldRuleCacheExpireAt) return;

  try {
    const response = await fetch(`${gatherUrl}/v1/scripts/catalog`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return;
    const data = await response.json();
    const items = Array.isArray(data?.items)
      ? (data.items as GatherScriptCatalogItem[])
      : [];
    gatherOutputFieldRuleCache.clear();
    gatherPlatformIntentCache.clear();
    for (const item of items) {
      const itemPlatform =
        typeof item.platform === "string" ? item.platform.trim().toLowerCase() : "";
      const itemIntent =
        typeof item.intent === "string" ? item.intent.trim().toLowerCase() : "";
      if (!itemPlatform || !itemIntent) continue;
      const intents = gatherPlatformIntentCache.get(itemPlatform) ?? [];
      if (!intents.includes(itemIntent)) {
        intents.push(itemIntent);
      }
      gatherPlatformIntentCache.set(itemPlatform, intents);

      const normalizedField = normalizeGatherOutputField(item.sample?.outputField);
      if (!normalizedField) continue;
      gatherOutputFieldRuleCache.set(
        `${itemPlatform}:${itemIntent}`,
        normalizedField
      );
    }
  } catch {
    // Best effort: keep existing cache/fallback behavior.
  } finally {
    gatherOutputFieldRuleCacheExpireAt = now + GATHER_OUTPUT_FIELD_RULE_TTL_MS;
  }
}

function resolveGatherPoolUserId(
  source: SocialMediaSource,
  config: Record<string, unknown>,
  driverOptions: Record<string, unknown>
): string {
  const playwrightConfig = asObject(config.playwright);
  const candidates = [
    driverOptions.userId,
    driverOptions.user_id,
    config.userId,
    config.user_id,
    playwrightConfig.userId,
    playwrightConfig.user_id,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return `source:${source.id}`;
}

function resolveGatherKeywordFilter(
  driverOptions: Record<string, unknown>
): Record<string, unknown> {
  const topLevelKeywordFilter = asObject(driverOptions.keywordFilter);
  if (Object.keys(topLevelKeywordFilter).length > 0) {
    return topLevelKeywordFilter;
  }
  const topLevelFilters = asObject(driverOptions.filters);
  const topLevelFiltersKeyword = asObject(topLevelFilters.keyword);
  if (Object.keys(topLevelFiltersKeyword).length > 0) {
    return topLevelFiltersKeyword;
  }
  const playwright = asObject(driverOptions.playwright);
  const playwrightKeywordFilter = asObject(playwright.keywordFilter);
  if (Object.keys(playwrightKeywordFilter).length > 0) {
    return playwrightKeywordFilter;
  }
  const playwrightFilters = asObject(playwright.filters);
  return asObject(playwrightFilters.keyword);
}

function resolveGatherDriverFilter(
  config: Record<string, unknown>
): Record<string, unknown> {
  const topLevelFilter = asObject(config.filter);
  if (Object.keys(topLevelFilter).length > 0) {
    return topLevelFilter;
  }
  const driverConfig = asObject(config.driver);
  const legacyDriverFilter = asObject(driverConfig.filter);
  if (Object.keys(legacyDriverFilter).length > 0) {
    return legacyDriverFilter;
  }
  const playwrightConfig = asObject(config.playwright);
  return asObject(playwrightConfig.filter);
}

function normalizeGatherDriverOption(
  config: Record<string, unknown>,
  driver: GatherSocialDriver
): Record<string, unknown> {
  if (driver !== "playwright") {
    return config;
  }
  const playwright = { ...asObject(config.playwright) };
  delete playwright.mode;
  delete playwright.args;
  const rest = { ...config };
  delete rest.playwright;
  delete (rest as Record<string, unknown>).mode;
  delete (rest as Record<string, unknown>).args;
  return {
    ...playwright,
    ...rest,
  };
}

function normalizeKeywordFilterFields(
  filter: Record<string, unknown>
): void {
  const includeFields = normalizeStringArray(filter.includeFields);
  const excludeFields = normalizeStringArray(filter.excludeFields);
  const legacyScopeFields = normalizeStringArray(filter.scopeFields);
  const legacyIncludeUrl = typeof filter.includeUrl === "boolean" ? filter.includeUrl : null;

  if (includeFields.length > 0) {
    filter.includeFields = includeFields;
  } else if (legacyScopeFields.length > 0) {
    filter.includeFields = legacyScopeFields;
  } else {
    delete filter.includeFields;
  }

  if (excludeFields.length > 0) {
    filter.excludeFields = excludeFields;
  } else if (legacyIncludeUrl === false) {
    filter.excludeFields = ["url"];
  } else {
    delete filter.excludeFields;
  }

  delete filter.scopeFields;
  delete filter.includeUrl;
}

function applyGatherProxyConfig(
  config: Record<string, unknown>,
  proxyUrl: string | null
): Record<string, unknown> {
  if (!proxyUrl) {
    return config;
  }
  return {
    ...config,
    network: {
      ...asObject(config.network),
      proxy: {
        url: proxyUrl,
      },
    },
  };
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter(Boolean)
      )
    );
  }
  if (typeof value === "string") {
    return Array.from(
      new Set(
        value
          .split(/[,\n\r，、;；\t]+/g)
          .map((item) => item.trim())
          .filter(Boolean)
      )
    );
  }
  return [];
}

function escapeRegexTerm(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchTermInContent(contentLower: string, term: string): boolean {
  const normalizedTerm = term.trim().toLowerCase();
  if (!normalizedTerm) return false;
  const isAsciiWord = /^[a-z0-9_]+$/i.test(normalizedTerm);
  if (isAsciiWord && normalizedTerm.length <= 3) {
    const boundaryPattern = new RegExp(`\\b${escapeRegexTerm(normalizedTerm)}\\b`, "i");
    return boundaryPattern.test(contentLower);
  }
  return contentLower.includes(normalizedTerm);
}

function pickFallbackText(recordContent: Record<string, unknown>): string {
  const directKeys = ["content", "summary", "description", "text", "title", "author"];
  for (const key of directKeys) {
    const value = recordContent[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  for (const value of Object.values(recordContent)) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function normalizeGatherItems(
  payload: unknown,
  source: SocialMediaSource,
  intent?: string
): CleanItem[] {
  if (!Array.isArray(payload)) {
    return [];
  }
  const normalized: CleanItem[] = [];
  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const recordContent = asObject(row.recordContent);
    const resolvedTitle =
      typeof row.title === "string" && row.title.trim()
        ? row.title.trim()
        : typeof recordContent.title === "string" && recordContent.title.trim()
          ? recordContent.title.trim()
          : undefined;
    const text =
      typeof recordContent.text === "string"
        ? recordContent.text
        : typeof row.text === "string"
          ? row.text
          : typeof row.markdown === "string"
            ? row.markdown
            : pickFallbackText(recordContent);
    if (!text) continue;

    const normalizedText = text.trim();
    const shouldComposeTitleMarkdown =
      Boolean(resolvedTitle) &&
      !normalizedText.toLowerCase().startsWith((resolvedTitle ?? "").toLowerCase());
    const composedMarkdown = shouldComposeTitleMarkdown
      ? `# ${resolvedTitle}\n\n${normalizedText}`
      : normalizedText;
    const markdown =
      typeof recordContent.markdown === "string" && recordContent.markdown.trim()
        ? recordContent.markdown
        : typeof row.markdown === "string" && row.markdown.trim()
          ? row.markdown
          : composedMarkdown;
    const recordTimeRaw = row.recordTime ?? row.time;
    const parsedTime =
      typeof recordTimeRaw === "string" || recordTimeRaw instanceof Date
        ? new Date(recordTimeRaw)
        : null;
    const recordId =
      typeof row.recordId === "string" && row.recordId.trim()
        ? row.recordId.trim()
        : undefined;
    const recordType =
      typeof row.recordType === "string" && row.recordType.trim()
        ? row.recordType.trim()
        : typeof intent === "string" && intent.trim()
          ? intent.trim()
          : undefined;

    normalized.push({
      title: resolvedTitle,
      text: normalizedText,
      markdown,
      platform:
        typeof row.platform === "string" && row.platform.trim()
          ? row.platform
          : source.name,
      url: typeof row.url === "string" ? row.url : undefined,
      time:
        parsedTime && !Number.isNaN(parsedTime.getTime())
          ? parsedTime
          : new Date(),
      sourceId: source.id,
      sourceType: source.category,
      sourceIsDarknet: source.isDarknet,
      driver: typeof row.driver === "string" ? row.driver : "python-gather",
      matchedKeywords: Array.isArray(row.matchedKeywords)
        ? row.matchedKeywords.filter((entry): entry is string => typeof entry === "string")
        : [],
      keywordMatchScore:
        typeof row.keywordMatchScore === "number"
          ? row.keywordMatchScore
          : undefined,
      recordId,
      recordType,
      recordTime:
        parsedTime && !Number.isNaN(parsedTime.getTime()) ? parsedTime : new Date(),
      recordContent: {
        ...recordContent,
        text,
        markdown,
      },
      schemaVersion: typeof row.schemaVersion === "string" ? row.schemaVersion : undefined,
      recordIndex: typeof row.recordIndex === "number" ? row.recordIndex : undefined,
      intent: typeof intent === "string" && intent.trim() ? intent.trim() : undefined,
    });
  }
  return normalized;
}

async function upsertContentSubjectMatches(input: {
  contentId: string;
  contentText: string;
  item: CleanItem;
  keywords: QueryKeyword[];
  aiByKeyword?: Map<string, { score: number | null; reason: string | null }>;
}): Promise<{ bestReason: string | null; bestScore: number | null }> {
  const { contentId, contentText, item, keywords, aiByKeyword } = input;
  const normalizedContentText = contentText.toLowerCase();
  let bestReason: string | null = null;
  let bestScore: number | null = null;
  for (const keyword of keywords) {
    const recallTerms = normalizeStringArray(
      keyword.includes.length > 0 ? keyword.includes : [keyword.name]
    );
    const scoringTerms = normalizeStringArray(
      keyword.synonyms.length > 0
        ? keyword.synonyms
        : keyword.includes.length > 0
          ? keyword.includes
          : [keyword.name]
    );
    const excludes = normalizeStringArray(keyword.excludes);
    const matchedRecallTerms = recallTerms.filter((term) =>
      matchTermInContent(normalizedContentText, term)
    );
    const matchedScoringTerms = scoringTerms.filter((term) =>
      matchTermInContent(normalizedContentText, term)
    );
    const matchedExcludes = excludes.filter((term) =>
      matchTermInContent(normalizedContentText, term)
    );
    const ruleScore = calculateRuleScore({
      recallTerms,
      scoringTerms,
      excludes,
      matchedRecallTerms,
      matchedScoringTerms,
      matchedExcludes,
      gatherScore: item.keywordMatchScore,
      gatherMatchedKeywords: item.matchedKeywords ?? [],
      contentText,
    });
    const aiResult = aiByKeyword?.get(keyword.id) ?? null;
    const aiScore =
      typeof aiResult?.score === "number"
        ? roundScore(Math.min(1, Math.max(0, aiResult.score)))
        : null;
    const finalScore =
      aiScore == null
        ? ruleScore
        : roundScore(0.25 * ruleScore + 0.75 * aiScore);
    const reasonText = aiResult?.reason?.trim() ?? "";
    if (reasonText) {
      if (bestScore == null || finalScore > bestScore) {
        bestScore = finalScore;
        bestReason = reasonText;
      }
    }
    const matchSource =
      aiScore == null
        ? item.keywordMatchScore == null
          ? ContentSubjectMatchSource.QUERY
          : ContentSubjectMatchSource.GATHER
        : ContentSubjectMatchSource.FUSED;

    await prismaAny.contentSubjectMatch.upsert({
      where: {
        contentId_keywordId: {
          contentId,
          keywordId: keyword.id,
        },
      },
      create: {
        contentId,
        keywordId: keyword.id,
        ruleScore,
        aiScore,
        matchScore: finalScore,
        matchedIncludes: matchedScoringTerms,
        matchedExcludes,
        matchSource,
        reason: reasonText || null,
      },
      update: {
        ruleScore,
        aiScore,
        matchScore: finalScore,
        matchedIncludes: matchedScoringTerms,
        matchedExcludes,
        matchSource,
        reason: reasonText || null,
      },
    });
  }
  return {
    bestReason,
    bestScore,
  };
}

function calculateRuleScore(input: {
  recallTerms: string[];
  scoringTerms: string[];
  excludes: string[];
  matchedRecallTerms: string[];
  matchedScoringTerms: string[];
  matchedExcludes: string[];
  gatherScore?: number;
  gatherMatchedKeywords: string[];
  contentText: string;
}): number {
  const {
    recallTerms,
    scoringTerms,
    excludes,
    matchedRecallTerms,
    matchedScoringTerms,
    matchedExcludes,
    gatherScore,
    gatherMatchedKeywords,
    contentText,
  } = input;

  const recallRatio =
    recallTerms.length > 0 ? matchedRecallTerms.length / recallTerms.length : 0;
  const scoringRatio =
    scoringTerms.length > 0
      ? matchedScoringTerms.length / scoringTerms.length
      : 0;
  const excludeRatio =
    excludes.length > 0 ? matchedExcludes.length / excludes.length : 0;
  const gatherBoost =
    typeof gatherScore === "number" ? Math.min(1, Math.max(0, gatherScore)) : 0;
  const normalizedContentText = contentText.toLowerCase();
  const validatedGatherMatches = gatherMatchedKeywords.filter((term) =>
    matchTermInContent(normalizedContentText, term)
  );
  const gatherMatched = validatedGatherMatches.length > 0 ? 1 : 0;
  const titleText = contentText.split("\n")[0]?.toLowerCase() ?? "";
  const titleAnchorMatch =
    recallTerms.length > 0 &&
    recallTerms.some((term) => matchTermInContent(titleText, term))
      ? 1
      : 0;
  const evidenceMatch = matchedScoringTerms.length > 0 ? 1 : 0;

  const score =
    0.05 +
    scoringRatio * 0.45 +
    recallRatio * 0.1 +
    evidenceMatch * 0.1 +
    titleAnchorMatch * 0.05 +
    gatherBoost * 0.15 +
    gatherMatched * 0.05 -
    excludeRatio * 0.35;
  return roundScore(Math.min(1, Math.max(0.05, score)));
}

function roundScore(score: number): number {
  return Math.round(score * 10000) / 10000;
}

async function analyzeContentWithRetry(
  item: CleanItem,
  keywords: QueryKeyword[],
  keywordsSummary: string,
  queryId: string,
  runId: string,
  summaryInput: PreparedSummaryContent
): Promise<ContentAnalyzeResult> {
  const subjectInput = keywords.map((keyword) => ({
    keywordId: keyword.id,
    name: keyword.name,
    description: keyword.description ?? "",
    recallTerms: keyword.includes ?? [],
    scoringTerms: keyword.synonyms ?? [],
    excludes: keyword.excludes ?? [],
  }));
  const prompt = stripPromptLike(
    `你是内容分析器。请只输出 JSON，结构为：
{
  "title": "简洁、准确的中文标题（4-120字）",
  "summary": "2-3句中文摘要（30-400字）",
  ${
    CONTENT_AUTO_CLEAN_ENABLED
      ? '"cleanedMarkdown": "清洗后的 Markdown 正文（800-1200字，保留关键信息，禁止新增事实）",'
      : ""
  }
  "relevance": true/false,
  "subjects": [
    {
      "keywordId": "关键词ID",
      "score": 0-1,
      "reason": "不超过200字的中文原因"
    }
  ]
}

要求：
1) title 必须忠于原文，不夸张、不加结论；
2) summary 基于内容核心信息，不要编造；
3) relevance 表示内容是否与查询主题整体相关；
4) subjects 必须覆盖每个 keywordId；
5) score 以主题语义为主，不能因为单词子串命中就高分；
6) 只出现词形但语义无关时，给低分（接近 0）;
${
  CONTENT_AUTO_CLEAN_ENABLED
    ? "7) cleanedMarkdown 仅可忠实转述原文，不得引入新事实、外部背景或推断。"
    : ""
}

查询关键词概览: ${keywordsSummary}
主题明细(JSON): ${JSON.stringify(subjectInput)}
内容:
${summaryInput.promptText}`
  );
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const schema = CONTENT_AUTO_CLEAN_ENABLED
        ? ContentAnalyzeSchemaWithRewrite
        : ContentAnalyzeSchema;
      const result = await llmGateway.json<
        z.infer<typeof ContentAnalyzeSchema> | z.infer<typeof ContentAnalyzeSchemaWithRewrite>
      >(
        "content-analyze",
        {
        prompt: redact(prompt),
        schema,
        temperature: 0.3,
        metadata: {
          queryId,
          source: item.platform,
          extractorUsed: summaryInput.extractorUsed,
          qualityScore: summaryInput.qualityScore,
        },
        }
      );
      const subjectsByKeyword = new Map<
        string,
        { score: number | null; reason: string | null }
      >();
      for (const keyword of keywords) {
        const matched = result.subjects.find(
          (subject) => subject.keywordId === keyword.id
        );
        subjectsByKeyword.set(keyword.id, {
          score:
            typeof matched?.score === "number"
              ? roundScore(Math.min(1, Math.max(0, matched.score)))
              : null,
          reason: matched?.reason?.trim().slice(0, 200) || null,
        });
      }
      await publishTaskEvent(runId, {
        type: "content-analyze-success",
        message: `内容分析成功 ${item.platform}`,
        attempt,
      });
      console.log(
        `[collector] content-analyze-success attempt=${attempt} source=${item.platform} summary=${result.summary}`
      );
      return {
        title: result.title,
        summary: result.summary,
        cleanedMarkdown:
          "cleanedMarkdown" in result ? result.cleanedMarkdown : null,
        relevance: result.relevance,
        subjectsByKeyword,
      };
    } catch (error) {
      await publishTaskEvent(runId, {
        type: "content-analyze-error",
        message: `第 ${attempt} 次内容分析失败：${(error as Error).message}`,
        attempt,
        source: item.platform,
      });
      console.log(
        `[collector] content-analyze-error attempt=${attempt} source=${item.platform
        } error=${(error as Error).message}`
      );
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw new Error("内容分析失败");
}

async function analyzeContentMeaningWithRetry(
  item: CleanItem,
  runId: string,
  queryId: string
): Promise<ContentMeaningResult> {
  const preview = markdownToText(`${item.title ?? ""}\n${item.markdown ?? item.text}`)
    .slice(0, CONTENT_MEANING_GATE_PREVIEW_CHARS)
    .trim();
  if (!preview) {
    return { meaningful: false, score: 0, reason: "empty_preview" };
  }
  const prompt = stripPromptLike(
    `你是内容质量闸门。请只输出 JSON，结构为：
{
  "meaningful": true/false,
  "score": 0-1,
  "reason": "不超过240字的中文原因"
}

判断标准：
1) meaningful=true 仅当内容包含可阅读、可理解且有信息价值的主体信息；
2) meaningful=false 适用于错误页、跳转页、模板噪音、碎片句、广告残片、无语义乱码；
3) 只判断“是否有意义”，不做扩写；
4) 严格基于输入内容，不要编造。

平台: ${item.platform}
链接: ${item.url ?? "N/A"}
内容前${CONTENT_MEANING_GATE_PREVIEW_CHARS}字:
${preview}`
  );

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await llmGateway.json<z.infer<typeof ContentMeaningSchema>>(
        "content-meaning-gate",
        {
          prompt: redact(prompt),
          schema: ContentMeaningSchema,
          temperature: 0.1,
          metadata: {
            runId,
            queryId,
            source: item.platform,
            sourceId: item.sourceId,
          },
        }
      );
      return {
        meaningful: result.meaningful && result.score >= CONTENT_MEANING_GATE_MIN_SCORE,
        score: roundScore(result.score),
        reason: result.reason.trim().slice(0, 240),
      };
    } catch (error) {
      if (attempt === 2) {
        logger.warn("content meaning gate failed, fallback pass", {
          runId,
          queryId,
          source: item.platform,
          sourceId: item.sourceId,
          error: logger.normalizeError(error),
        });
        return {
          meaningful: true,
          score: 0.5,
          reason: "meaning_gate_failed_fallback_pass",
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }
  return { meaningful: true, score: 0.5, reason: "meaning_gate_fallback_pass" };
}

async function findExistingContentBySourceRecord(
  item: CleanItem
): Promise<{ id: string } | null> {
  if (item.recordId) {
    const recordWhere =
      typeof item.recordIndex === "number" && Number.isFinite(item.recordIndex)
        ? {
            AND: [
              {
                meta: {
                  path: ["sourceId"],
                  equals: item.sourceId,
                },
              },
              {
                meta: {
                  path: ["recordId"],
                  equals: item.recordId,
                },
              },
              {
                meta: {
                  path: ["recordIndex"],
                  equals: item.recordIndex,
                },
              },
            ],
          }
        : {
            AND: [
              {
                meta: {
                  path: ["sourceId"],
                  equals: item.sourceId,
                },
              },
              {
                meta: {
                  path: ["recordId"],
                  equals: item.recordId,
                },
              },
            ],
          };
    const existingByRecordId = await prisma.content.findFirst({
      where: recordWhere,
      select: { id: true },
    });
    if (existingByRecordId) return existingByRecordId;
  }

  if (item.fingerprint) {
    return prisma.content.findFirst({
      where: {
        AND: [
          {
            meta: {
              path: ["sourceId"],
              equals: item.sourceId,
            },
          },
          {
            meta: {
              path: ["sourceFingerprint"],
              equals: item.fingerprint,
            },
          },
        ],
      },
      select: { id: true },
    });
  }

  return null;
}

function buildFallbackSummary(item: CleanItem): string {
  const source = item.text?.trim() || item.markdown?.trim() || "";
  if (!source) return "采集成功，暂无可用正文。";
  const normalized = source.replace(/\s+/g, " ");
  return normalized.slice(0, 180);
}

function toCleanLines(source: string): string[] {
  const seen = new Set<string>();
  return source
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => {
      const lower = line.toLowerCase();
      if (
        /^(home|login|sign in|sign up|register|subscribe|newsletter|share|menu|copyright|all rights reserved)$/.test(
          lower
        )
      ) {
        return false;
      }
      if (
        /^(首页|登录|注册|订阅|分享|菜单|版权所有|免责声明|上一篇|下一篇)$/.test(
          line
        )
      ) {
        return false;
      }
      if (line.length < 2) return false;
      if (seen.has(lower)) return false;
      seen.add(lower);
      return true;
    });
}

function markdownToText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function calculateSummaryQuality(cleanLines: string[], cleanText: string): number {
  const punctuationCount = (cleanText.match(/[。！？.!?]/g) ?? []).length;
  const baseQuality =
    Math.min(0.6, cleanText.length / 3000) +
    Math.min(0.2, cleanLines.length / 24) +
    Math.min(0.2, punctuationCount / 16);
  return roundScore(Math.max(0, Math.min(1, baseQuality)));
}

function buildPreparedSummaryContent(input: {
  itemTitle?: string;
  extractorUsed: PreparedSummaryContent["extractorUsed"];
  source: string;
}): PreparedSummaryContent {
  const cleanLines = toCleanLines(input.source);
  const cleanMarkdown = cleanLines.join("\n\n").slice(0, CONTENT_FORMATTER_MAX_INPUT_CHARS);
  const cleanText = markdownToText(cleanMarkdown).slice(0, 12000);
  const qualityScore = calculateSummaryQuality(cleanLines, cleanText);
  const promptText = [
    input.itemTitle ? `标题: ${input.itemTitle}` : "",
    "正文(Markdown):",
    cleanMarkdown.slice(0, 7000),
    "",
    "正文(PlainText):",
    cleanText.slice(0, 2500),
  ]
    .filter(Boolean)
    .join("\n");

  return {
    markdown: cleanMarkdown || input.source,
    text: cleanText || input.source.replace(/\s+/g, " ").trim(),
    promptText: promptText.slice(0, 9500),
    extractorUsed: input.extractorUsed,
    qualityScore,
  };
}

function normalizeGeneratedMarkdown(markdown: string | null | undefined): string {
  const raw = String(markdown ?? "")
    .replace(/```markdown\n?/gi, "")
    .replace(/```/g, "")
    .trim();
  if (!raw) return "";
  const cleanLines = toCleanLines(raw);
  const merged = cleanLines.join("\n\n").trim();
  if (merged.length < CONTENT_CLEAN_MARKDOWN_MIN_CHARS) {
    return "";
  }
  return merged.slice(0, CONTENT_CLEAN_MARKDOWN_MAX_CHARS);
}

function normalizeGeneratedSummary(summary: string | null | undefined): string {
  return String(summary ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}

function normalizeGeneratedTitle(title: string | null | undefined): string {
  return String(title ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

async function prepareContentForSummary(
  item: CleanItem
): Promise<PreparedSummaryContent> {
  const markdownSource = (item.markdown ?? "").trim();
  const textSource = (item.text ?? "").trim();
  const extractorUsed: PreparedSummaryContent["extractorUsed"] = markdownSource
    ? "markdown"
    : textSource
      ? "text"
      : "empty";
  const fallbackSource = (markdownSource || textSource).slice(
    0,
    CONTENT_FORMATTER_MAX_INPUT_CHARS
  );
  if (!fallbackSource) {
    return {
      markdown: "",
      text: "",
      promptText: "",
      extractorUsed,
      qualityScore: 0,
    };
  }

  return buildPreparedSummaryContent({
    itemTitle: item.title,
    extractorUsed,
    source: fallbackSource,
  });
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {}
): Promise<string> {
  const detailed = await fetchWithTimeoutDetailed(url, options);
  return detailed.text;
}

async function fetchWithTimeoutDetailed(
  url: string,
  options: RequestInit = {},
  timeoutMs = 12_000
): Promise<{ text: string; statusCode: number }> {
  console.log(`[collector] fetchWithTimeout ${url}`, {
    method: options.method ?? "GET",
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      throw new HttpStatusError(`请求 ${url} 失败 (${response.status})`, response.status);
    }
    const text = await response.text();
    return {
      text,
      statusCode: response.status,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function toMarkdown(html: string) {
  const $ = load(html);
  $("script, style, noscript").remove();
  const title = $("title").first().text().trim();
  const paragraphs = $("p")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter((text) => text);
  const markdown = paragraphs.join("\n\n");
  const text = markdown.replace(/\s+/g, " ").trim();
  return {
    title: title || "网页内容",
    text: text || markdown,
    markdown: markdown || text,
  };
}

type SearchResultItem = {
  title?: string;
  name?: string;
  headline?: string;
  snippet?: string;
  summary?: string;
  description?: string;
  body?: string;
  text?: string;
  content?: string;
  content_text?: string;
  markdown?: string;
  link?: string;
  url?: string;
  href?: string;
  source_url?: string;
  sourceUrl?: string;
  excerpts?: string[] | Array<{ text?: string; content?: string }>;
  publish_date?: string;
  date?: string;
  publishedAt?: string;
  timestamp?: string;
  created_at?: string;
  createdAt?: string;
};

type SearchProvider = "parallel" | "tavily" | "anspire" | "generic";

type SearchRequestConfig = {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  timeoutMs?: number;
};

const SEARCH_PROVIDER_DEFAULT_ENDPOINTS = {
  parallel: "https://api.parallel.ai/v1beta/search",
  tavily: "https://api.tavily.com/search",
  anspire: "https://plugin.anspire.cn/api/ntsearch/prosearch",
} as const;

function detectSearchProvider(
  platform?: string | null,
  apiEndpoint?: string | null,
  rawOptions?: unknown
): SearchProvider {
  const normalizedPlatform = String(platform ?? "")
    .trim()
    .toLowerCase();
  if (normalizedPlatform === "parallel") return "parallel";
  if (normalizedPlatform === "tavily") return "tavily";
  if (normalizedPlatform === "anspire") return "anspire";

  const options = asObject(rawOptions);
  const explicitProvider = String(options.provider ?? options.platform ?? "")
    .trim()
    .toLowerCase();
  if (explicitProvider.includes("parallel")) return "parallel";
  if (explicitProvider.includes("tavily")) return "tavily";
  if (explicitProvider.includes("anspire")) return "anspire";

  const endpoint = String(apiEndpoint ?? "").toLowerCase();
  if (endpoint.includes("parallel.ai")) return "parallel";
  if (endpoint.includes("tavily.com")) return "tavily";
  if (endpoint.includes("anspire.cn")) return "anspire";
  return "generic";
}

function buildSearchRequest(
  source: SearchEngineSource,
  provider: SearchProvider,
  objectiveOverride?: string
): SearchRequestConfig {
  const search = source.search;
  const options = asObject(search?.options);
  const objective =
    objectiveOverride ??
    (search as unknown as { objective?: string })?.objective ??
    "";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (provider === "parallel") {
    const apiKey = resolveApiKey(options, resolveSearchCredentialApiKey(source));
    if (apiKey) {
      headers["x-api-key"] = apiKey;
    }

    const excerpts = asObject(options.excerpts);
    const sourcePolicy = asObjectOrUndefined(
      options.source_policy,
      options.sourcePolicy
    );
    const sourcePolicyObject = asObject(sourcePolicy);
    const fetchPolicy = asObjectOrUndefined(
      options.fetch_policy,
      options.fetchPolicy
    );
    const fetchPolicyObject = asObject(fetchPolicy);

    const requestTimeoutMs =
      toNumberOption(options.request_timeout_ms, options.requestTimeoutMs) ??
      toNumberOption(options.timeout_ms, options.timeoutMs) ??
      toNumberOption(process.env.WORKER_PARALLEL_REQUEST_TIMEOUT_MS) ??
      15_000;
    const payload: Record<string, unknown> = {
      mode: pickString(options.mode) ?? "one-shot",
      objective,
      search_queries:
        toStringArrayOption(options.search_queries, options.searchQueries) ?? [],
      max_results: toNumberOption(options.max_results, options.maxResults) ?? 20,
      excerpts: {
        max_chars_per_result:
          toNumberOption(excerpts.max_chars_per_result) ?? 20000,
        max_chars_total: toNumberOption(excerpts.max_chars_total) ?? 200000,
      },
      source_policy: {
        include_domains:
          toStringArrayOption(sourcePolicyObject.include_domains) ?? [],
        exclude_domains:
          toStringArrayOption(sourcePolicyObject.exclude_domains) ?? [],
        ...(pickString(sourcePolicyObject.after_date)
          ? { after_date: pickString(sourcePolicyObject.after_date) }
          : {}),
      },
      fetch_policy: {
        disable_cache_fallback:
          toBooleanOption(fetchPolicyObject.disable_cache_fallback) ?? true,
        max_age_seconds:
          toNumberOption(fetchPolicyObject.max_age_seconds) ?? 172800,
        timeout_seconds:
          toNumberOption(fetchPolicyObject.timeout_seconds) ?? 120,
      },
    };
    return {
      url:
        pickString(search?.apiEndpoint) ??
        SEARCH_PROVIDER_DEFAULT_ENDPOINTS.parallel,
      method: "POST",
      headers,
      body: JSON.stringify(stripUndefined(payload)),
      timeoutMs: Math.max(5_000, Math.floor(requestTimeoutMs)),
    };
  }

  if (provider === "tavily") {
    const apiKey = resolveApiKey(options, resolveSearchCredentialApiKey(source));
    const payload: Record<string, unknown> = {
      api_key: apiKey,
      query: objective,
      topic: pickString(options.topic) ?? "general",
      search_depth: pickString(options.search_depth, options.searchDepth) ?? "basic",
      max_results: toNumberOption(options.max_results, options.maxResults) ?? 10,
      include_answer:
        toBooleanOption(options.include_answer, options.includeAnswer) ?? false,
      include_raw_content:
        toBooleanOrStringOption(
          options.include_raw_content,
          options.includeRawContent
        ) ?? false,
      include_images:
        toBooleanOption(options.include_images, options.includeImages) ?? false,
      include_image_descriptions:
        toBooleanOption(
          options.include_image_descriptions,
          options.includeImageDescriptions
        ) ?? false,
      include_favicon:
        toBooleanOption(options.include_favicon, options.includeFavicon) ?? false,
      include_usage:
        toBooleanOption(options.include_usage, options.includeUsage) ?? false,
      chunks_per_source:
        toNumberOption(options.chunks_per_source, options.chunksPerSource) ?? 4,
      include_domains:
        toStringArrayOption(options.include_domains, options.includeDomains) ?? [],
      exclude_domains:
        toStringArrayOption(options.exclude_domains, options.excludeDomains) ?? [],
      time_range: pickString(options.time_range, options.timeRange),
      days: toNumberOption(options.days),
      start_date: pickString(options.start_date, options.startDate),
      end_date: pickString(options.end_date, options.endDate),
    };
    return {
      url:
        pickString(search?.apiEndpoint) ??
        SEARCH_PROVIDER_DEFAULT_ENDPOINTS.tavily,
      method: "POST",
      headers,
      body: JSON.stringify(stripUndefined(payload)),
    };
  }

  if (provider === "anspire") {
    const apiKey = resolveApiKey(options, resolveSearchCredentialApiKey(source));
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    const queryParams = new URLSearchParams({
      query: objective,
      ...(pickString(options.top_k, options.topK)
        ? { top_k: pickString(options.top_k, options.topK)! }
        : {}),
      ...(pickString(options.insite, options.Insite)
        ? { Insite: pickString(options.insite, options.Insite)! }
        : {}),
      ...(pickString(options.from_time, options.FromTime)
        ? { FromTime: pickString(options.from_time, options.FromTime)! }
        : {}),
      ...(pickString(options.to_time, options.ToTime)
        ? { ToTime: pickString(options.to_time, options.ToTime)! }
        : {}),
    });
    return {
      url: `${pickString(search?.apiEndpoint) ?? SEARCH_PROVIDER_DEFAULT_ENDPOINTS.anspire}?${queryParams.toString()}`,
      method: "GET",
      headers,
    };
  }

  return {
    url: search?.apiEndpoint || "",
    method: "POST",
    headers,
    body: JSON.stringify({
      query: objective,
      options: search?.options,
    }),
  };
}

function parseSearchResult(payload: string): {
  items: Array<{
    title?: string;
    text: string;
    markdown: string;
    url?: string;
    time?: string;
  }>;
  requestId?: string;
  rootKeys?: string[];
} {
  try {
    const json = JSON.parse(payload);
    const root = asObject(json);
    const requestId = pickString(root.Uuid, root.uuid, root.requestId);
    const rows = resolveSearchResultRows(root);
    if (Array.isArray(rows)) {
      const items = (rows as SearchResultItem[])
        .map((item) => normalizeSearchResultItem(item))
        .filter((item) => Boolean(item.text));
      return { items, requestId, rootKeys: Object.keys(root).slice(0, 30) };
    }
    return { items: [], requestId, rootKeys: Object.keys(root).slice(0, 30) };
  } catch {
    // ignore
  }
  return { items: [] };
}

function resolveSearchResultRows(root: Record<string, unknown>): unknown[] | null {
  const candidates: unknown[] = [
    root.items,
    root.results,
    root.data,
    root.output,
    root.sources,
    pickNestedArray(root, ["data", "items"]),
    pickNestedArray(root, ["data", "results"]),
    pickNestedArray(root, ["data", "output"]),
    pickNestedArray(root, ["data", "sources"]),
    pickNestedArray(root, ["result", "items"]),
    pickNestedArray(root, ["result", "results"]),
    pickNestedArray(root, ["result", "sources"]),
    pickNestedArray(root, ["response", "items"]),
    pickNestedArray(root, ["response", "results"]),
    pickNestedArray(root, ["response", "sources"]),
    pickNestedArray(root, ["output", "items"]),
    pickNestedArray(root, ["output", "results"]),
  ];
  const rows = candidates.find((candidate) => Array.isArray(candidate));
  return Array.isArray(rows) ? rows : null;
}

function pickNestedArray(
  root: Record<string, unknown>,
  path: string[]
): unknown[] | null {
  let current: unknown = root;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return Array.isArray(current) ? current : null;
}

function normalizeSearchResultItem(item: SearchResultItem) {
  const title = pickString(item.title, item.name, item.headline);
  const excerpts = normalizeExcerpts(item.excerpts);
  const text = pickString(
    item.snippet,
    item.summary,
    item.description,
    item.body,
    item.text,
    item.content,
    item.content_text,
    item.markdown,
    excerpts
  ) ?? "";

  return {
    title,
    text,
    markdown: pickString(item.markdown) ?? text,
    url: pickString(item.link, item.url, item.href, item.source_url, item.sourceUrl),
    time: pickString(
      item.publishedAt,
      item.publish_date,
      item.date,
      item.timestamp,
      item.createdAt,
      item.created_at
    ),
  };
}

function normalizeExcerpts(value: unknown): string {
  if (Array.isArray(value)) {
    const normalized = value
      .map((entry) => {
        if (typeof entry === "string") {
          return entry.trim();
        }
        if (entry && typeof entry === "object") {
          const row = entry as Record<string, unknown>;
          if (typeof row.text === "string") {
            return row.text.trim();
          }
          if (typeof row.content === "string") {
            return row.content.trim();
          }
        }
        return "";
      })
      .filter(Boolean);
    return normalized.join("\n\n");
  }
  return "";
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function toNumberOption(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const num = Number(value);
      if (Number.isFinite(num)) {
        return num;
      }
    }
  }
  return undefined;
}

function toBooleanOption(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
    }
  }
  return undefined;
}

function toBooleanOrStringOption(
  ...values: unknown[]
): boolean | string | undefined {
  for (const value of values) {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
      if (value.trim()) return value.trim();
    }
  }
  return undefined;
}

function toStringArrayOption(...values: unknown[]): string[] | undefined {
  for (const value of values) {
    if (Array.isArray(value)) {
      const normalized = value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean);
      if (normalized.length > 0) {
        return normalized;
      }
    }
    if (typeof value === "string" && value.trim()) {
      const parts = value
        .split(/[,\n\r，、;；\t]+/g)
        .map((item) => item.trim())
        .filter(Boolean);
      if (parts.length > 0) {
        return parts;
      }
    }
  }
  return undefined;
}

function asObjectOrUndefined(...values: unknown[]): Record<string, unknown> | undefined {
  for (const value of values) {
    const obj = asObject(value);
    if (Object.keys(obj).length > 0) {
      return obj;
    }
  }
  return undefined;
}

function resolveApiKey(options: Record<string, unknown>, fallback?: string): string | undefined {
  return pickString(
    options.apiKey,
    options.api_key,
    options.key,
    options.token,
    fallback
  );
}

function resolveSearchCredentialApiKey(source: SearchEngineSource): string | undefined {
  const payload = source.search?.credential?.data;
  if (!payload) return undefined;
  const decrypted = unwrapCredentialPayload(payload);
  if (!decrypted || typeof decrypted !== "object" || Array.isArray(decrypted)) {
    return undefined;
  }
  const auth = decrypted as Record<string, unknown>;
  return pickString(auth.secret, auth.apiKey, auth.api_key, auth.token, auth.key);
}

function stripUndefined<T extends Record<string, unknown>>(payload: T): T {
  const entries = Object.entries(payload).filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries) as T;
}
