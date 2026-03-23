import { load } from "cheerio";
import { z } from "zod";
import { createHash } from "crypto";

import prisma from "@/lib/prisma";
import {
  Prisma,
  SourceCategory,
  ContentType,
  CrawlerEngine,
  KeywordStrategy,
  ContentSubjectMatchSource,
} from "@/app/generated/prisma";
import {
  SourceWithRelations,
  SocialMediaSource,
  SearchEngineSource,
  WebSource,
  DarknetSource,
} from "@/lib/types";
import { llmGateway, browserAgent } from "@oak/agents";
import { publishTaskEvent, publishContentEvent } from "@/lib/queue";
import { logger } from "@/lib/logger";
import { redact, stripPromptLike } from "@/lib/security";
import { writeWorkerApiIoLog } from "./api-io-log";
import { buildNormalizedRecordContent } from "./record-content-normalizer";

const SummarySchema = z.object({
  summary: z.string().min(30).max(400),
  relevance: z.boolean(),
});

const SubjectScoreSchema = z.object({
  score: z.number().min(0).max(1),
  reason: z.string().min(1).max(200),
});

const SKIP_AI_SUMMARY = process.env.COLLECTOR_SKIP_AI_SUMMARY !== "false";

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
};

type QueryKeyword = {
  id: string;
  name: string;
  description?: string | null;
  includes: string[];
  excludes: string[];
  synonyms: string[];
};

type GatherSocialDriver = "playwright" | "xhttp" | "agent-browser";
type GatherOutputField = string[] | Record<string, string>;
type GatherOutputPayload = {
  field: GatherOutputField;
  keywordScope?: string[];
};
type GatherIntentPayload = {
  type: string;
  args: Record<string, unknown>;
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

function isWebSource(source: SourceWithRelations): source is WebSource {
  return source.category === "STREAM";
}

function isDarknetSource(source: SourceWithRelations): source is DarknetSource {
  return source.category === "RETRIEVAL" && source.isDarknet;
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
  const row = await prisma.queryRun.findUnique({
    where: { id: runId },
    select: { meta: true },
  });
  const meta = asObject(row?.meta);
  const existing = normalizeStringArray(meta.searchSuccessSignatures);
  const set = new Set(existing);
  runSearchSignatureCache.set(runId, set);
  return set;
}

async function persistRunSearchSuccessSignatures(
  runId: string,
  signatures: Set<string>
): Promise<void> {
  const row = await prisma.queryRun.findUnique({
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
  await prisma.queryRun.update({
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

  await prisma.queryRun.update({
    where: { id: runId },
    data: { status: "RUNNING", startedAt: new Date(), progress: 0 },
  });
  await send({ type: "start", message: "任务开始" });

  const query = await prisma.query.findUnique({
    where: { id: queryId },
    include: {
      keywords: true,
      sources: {
        include: {
          web: true,
          search: true,
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
  query.sources.forEach((source) => {
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
    query.keywords
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
    await prisma.queryRun.update({
      where: { id: runId },
      data: { status: "SUCCEEDED", progress: 100, finishedAt: new Date() },
    });
    return;
  }

  const expandedKeywords = query.keywords.map((kw) => {
    const parts = [kw.name, ...kw.includes];
    if (kw.enableAiExpand && kw.synonyms.length > 0) {
      parts.push(...kw.synonyms);
    }
    return Array.from(new Set(parts)).join(", ");
  });

  const keywordsStr = expandedKeywords.join("; ") || "无关键词";
  for (let i = 0; i < cleaned.length; i++) {
    const item = cleaned[i];
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
      await prisma.queryRun.update({
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

    let summary: { summary: string; relevance: boolean };
    if (SKIP_AI_SUMMARY) {
      await send({
        type: "summary-skip",
        message: `第 ${i + 1} 条内容跳过 AI 摘要，直接入库`,
      });
      summary = {
        summary: buildFallbackSummary(item),
        relevance: true,
      };
    } else {
      await send({ type: "summary", message: `第 ${i + 1} 条内容生成摘要` });
      summary = await summarizeWithRetry(
        item,
        keywordsStr,
        queryId,
        runId
      );
    }

    const contentTitle =
      item.title ??
      (summary.summary.slice(0, 40).replace(/\s+/g, " ").trim() ||
        `来源 ${item.platform}`);
    const contentTime = item.recordTime ?? item.time ?? new Date();
    const normalizedRecordContent = buildNormalizedRecordContent({
      platform: item.platform,
      intent: item.intent,
      sourceId: item.sourceId,
      fallbackTitle: contentTitle,
      fallbackSummary: summary.summary,
      fallbackMarkdown: item.markdown,
      fallbackUrl: item.url,
      fallbackTimeIso: contentTime.toISOString(),
      recordId: item.recordId,
      recordType: item.recordType,
      recordIndex: item.recordIndex,
      rawRecordContent: item.recordContent,
    });

    const sanitizedTitle = stripNullBytes(contentTitle);
    const sanitizedSummary = stripNullBytes(summary.summary);
    const sanitizedMarkdown = stripNullBytes(item.markdown);
    const sanitizedPlatform = stripNullBytes(item.platform);
    const sanitizedUrl = item.url ? stripNullBytes(item.url) : undefined;
    const sanitizedRecordContent = sanitizeJsonForDb(
      normalizedRecordContent
    ) as Prisma.InputJsonValue;
    const content = await prisma.content.create({
      data: {
        title: sanitizedTitle,
        summary: sanitizedSummary,
        markdown: sanitizedMarkdown,
        platform: sanitizedPlatform,
        type: mapContentType(item.sourceType, item.sourceIsDarknet),
        time: contentTime,
        url: sanitizedUrl,
        meta: {
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
          keywords: expandedKeywords.map((keywordValue) =>
            stripNullBytes(keywordValue)
          ),
          summaryRelevance: summary.relevance,
          sourceId: stripNullBytes(item.sourceId),
          sourceType: item.sourceType,
          intent: item.intent ? stripNullBytes(item.intent) : null,
        },
      },
    });

    if (query.keywords.length) {
      await prisma.contentKeyword.createMany({
        data: query.keywords.map((keyword) => ({
          contentId: content.id,
          keywordId: keyword.id,
        })),
        skipDuplicates: true,
      });
      await upsertContentSubjectMatches({
        contentId: content.id,
        contentText: `${content.title}\n${content.summary}\n${content.markdown}`,
        item,
        keywords: query.keywords,
      });
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
    await prisma.queryRun.update({
      where: { id: runId },
      data: { progress },
    });
    await send({ type: "progress", message: "入库完成", progress });
  }

  await prisma.queryRun.update({
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

function mapContentType(sourceType: SourceCategory, isDarknet?: boolean): ContentType {
  if (sourceType === "RETRIEVAL" && isDarknet) {
    return ContentType.Darknet;
  }
  return ContentType.Web;
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
  keywords: QueryKeyword[]
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
        const strategy = resolveKeywordStrategy(source);
        const keywordFilterTerms =
          strategy === "PRECISION_ONLY" || strategy === "HYBRID"
            ? buildKeywordFilterTerms(keywords)
            : [];
        const rawRecallQueries =
          strategy === "RECALL_ONLY" || strategy === "HYBRID"
            ? buildRecallQueries(keywords)
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
          objectiveFallback
        );
        console.log(
          `[collector] fetched ${fetched.length} items from ${source.name}`
        );
        fetched.forEach((item) => {
          item.driver = driver;
        });
        await publishTaskEvent(runId, {
          type: "fetch-success",
          message: `抓取 ${source.name} 完成`,
          count: fetched.length,
          sourceId: source.id,
          driver,
        });
        return fetched;
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
  if (!raw) return 64;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 64;
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
  objectiveFallback?: string
): Promise<CleanItem[]> {
  const gatherDispatchSource = resolveGatherDispatchSource(source);
  if (gatherDispatchSource) {
    return fetchSocialSource(
      gatherDispatchSource,
      keywordFilterTerms,
      recallQueries
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
        recallQueries
      );
    default:
      return fetchWithDefaultSource(
        source,
        runId,
        queryId,
        keywordFilterTerms,
        recallQueries,
        objectiveFallback
      );
  }
}

async function fetchWithDefaultSource(
  source: SourceWithRelations,
  runId: string,
  queryId: string,
  keywordFilterTerms: string[],
  recallQueries: string[],
  objectiveFallback?: string
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
    });
  }
  if (source.category === "INTERACTIVE") {
    return fetchSocialSource(
      source as SocialMediaSource,
      keywordFilterTerms,
      recallQueries
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
  recallQueries: string[]
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
    });
  }
  console.log(
    `[collector] fetchAICrawlerSource -> fetchSocialSource ${source.name}`
  );
  return fetchSocialSource(
    source as SocialMediaSource,
    keywordFilterTerms,
    recallQueries
  );
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

async function fetchSearchSource(
  source: SearchEngineSource,
  context?: {
    runId?: string;
    queryId?: string;
    recallQueries?: string[];
    objectiveFallback?: string;
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
  const searchSuccessSignatures = await loadRunSearchSuccessSignatures(context?.runId);
  for (const recallQuery of searchQueries) {
    const normalizedRecallQuery = recallQuery.trim();
    if (!normalizedRecallQuery) continue;
    const signature = buildSearchSuccessSignature({
      sourceId: source.id,
      provider,
      recallQuery: normalizedRecallQuery,
    });
    if (searchSuccessSignatures.has(signature)) {
      if (context?.runId) {
        await publishTaskEvent(context.runId, {
          type: "fetch-search-skip-retry-dup",
          sourceId: source.id,
          message: `跳过重复检索：${normalizedRecallQuery}`,
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
        recallQuery: normalizedRecallQuery,
        recallQueryCount: searchQueries.length,
        queryOrigin:
          context?.recallQueries && context.recallQueries.length > 0
            ? "recall"
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
      continue;
    }
    const request = buildSearchRequest(source, provider, normalizedRecallQuery);
    if (!request.url) {
      return [
        {
          text: `搜索引擎 ${source.name} 未配置 API Endpoint，当前 objective: ${objective}`,
          markdown: `搜索引擎 ${source.name} 结果占位`,
          platform: source.name,
          time: new Date(),
          sourceId: source.id,
          sourceType: source.category,
          sourceIsDarknet: source.isDarknet,
        },
      ];
    }

    try {
      const response = await fetchWithTimeoutDetailed(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      }, request.timeoutMs);
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
        recallQuery: normalizedRecallQuery,
        recallQueryCount: searchQueries.length,
        queryOrigin:
          context?.recallQueries && context.recallQueries.length > 0
            ? "recall"
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
      searchSuccessSignatures.add(signature);
      if (context?.runId) {
        await persistRunSearchSuccessSignatures(context.runId, searchSuccessSignatures);
      }

      allItems.push(
        ...parsedResult.items.map((item) => ({
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
        }))
      );
    } catch (error) {
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
        recallQuery: normalizedRecallQuery,
        recallQueryCount: searchQueries.length,
        queryOrigin:
          context?.recallQueries && context.recallQueries.length > 0
            ? "recall"
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
        error: logger.normalizeError(error),
      });
    }
  }

  const dedupedItems = deduplicateItemsByUrlAndFingerprint(allItems);
  if (!dedupedItems.length) {
    return [
      {
        text: `搜索引擎 ${source.name} 返回空数据`,
        markdown: `空数据`,
        platform: source.name,
        time: new Date(),
        sourceId: source.id,
        sourceType: source.category,
        sourceIsDarknet: source.isDarknet,
      },
    ];
  }
  return dedupedItems;
}

async function fetchSocialSource(
  source: SocialMediaSource,
  keywordFilterTerms: string[],
  recallQueries: string[]
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
  const normalizedSocialConfig = normalizeGatherSocialConfig(
    source,
    sourceConfigObj,
    gatherDriver
  );
  const baseConfig = applyGatherProxyConfig(normalizedSocialConfig, proxyUrl);
  const existingKeywordFilter = resolveGatherKeywordFilter(baseConfig, gatherDriver);
  const keywordFilterOptions = { ...existingKeywordFilter };
  delete keywordFilterOptions.keywords;
  const driverOption = normalizeGatherDriverOption(baseConfig, gatherDriver);
  const gatherUserId = resolveGatherPoolUserId(source, sourceConfigObj, driverOption);
  const normalizedIntentType = intent.type.trim().toLowerCase();
  const batchedQueries =
    normalizedIntentType === "search" && recallQueries.length > 0
      ? Array.from(new Set(recallQueries.map((query) => query.trim()).filter(Boolean)))
      : [""];
  const normalizedBatchedQueries = batchedQueries.length > 0 ? batchedQueries : [""];
  const normalizedItems: CleanItem[] = [];

  try {
    for (const recallQuery of normalizedBatchedQueries) {
      const intentForRequest = injectRecallQueryIntoIntent(intent, recallQuery);
      const driver: GatherDriverPayload =
        Object.keys(keywordFilterOptions).length > 0
          ? {
              name: gatherDriver,
              ...driverOption,
              script: intentForRequest,
              filter: keywordFilterOptions,
            }
          : {
              name: gatherDriver,
              ...driverOption,
              script: intentForRequest,
            };

      const response = await fetch(`${gatherUrl}/v3/fetch`, {
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
    console.error(`[collector] fetchSocialSource error:`, error);
    throw new Error(
      `Social gather failed for ${source.name}: ${(error as Error).message}`
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
  driver: GatherSocialDriver
): Record<string, unknown> {
  const sanitizedConfig = sanitizeGatherConfig(config);
  const credentialStateFile = resolveCredentialStateFile(source);
  if (driver === "agent-browser") {
    return normalizeAgentBrowserGatherConfig(
      source,
      sanitizedConfig,
      credentialStateFile
    );
  }

  if (driver !== "playwright") {
    return sanitizedConfig;
  }

  const playwright = asObject(sanitizedConfig.playwright);
  const normalizedPlaywright: Record<string, unknown> = {
    headless:
      typeof playwright.headless === "boolean" ? playwright.headless : false,
  };

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

function normalizeAgentBrowserGatherConfig(
  source: SocialMediaSource,
  config: Record<string, unknown>,
  credentialStateFile: string | null
): Record<string, unknown> {
  const topLevelKeywordFilter = asObject(config.keywordFilter);
  const topLevelFilters = asObject(config.filters);
  const topLevelFiltersKeyword = asObject(topLevelFilters.keyword);
  const rawDriverOptions = asObject(config.driverOptions);
  const rawAgentBrowser = asObject(config.agentBrowser);

  let agentBrowserOptions = rawAgentBrowser;
  let wrappedKeywordFilter: Record<string, unknown> = {};

  const wrappedConfig = asObject(rawDriverOptions.config);
  if (Object.keys(rawDriverOptions).length > 0) {
    agentBrowserOptions = rawDriverOptions;
    const nestedFilters = asObject(rawDriverOptions.filters);
    const nestedKeywordFilter = asObject(nestedFilters.keyword);
    if (Object.keys(nestedKeywordFilter).length > 0) {
      wrappedKeywordFilter = nestedKeywordFilter;
    }
  } else if (Object.keys(wrappedConfig).length > 0) {
    const nestedAgentBrowser = asObject(wrappedConfig.agentBrowser);
    if (Object.keys(nestedAgentBrowser).length > 0) {
      agentBrowserOptions = nestedAgentBrowser;
    }
    const nestedKeywordFilter = asObject(wrappedConfig.keywordFilter);
    if (Object.keys(nestedKeywordFilter).length > 0) {
      wrappedKeywordFilter = nestedKeywordFilter;
    }
  } else {
    const wrappedConfig = asObject(rawAgentBrowser.config);
    if (Object.keys(wrappedConfig).length > 0) {
      const nestedAgentBrowser = asObject(wrappedConfig.agentBrowser);
      if (Object.keys(nestedAgentBrowser).length > 0) {
        agentBrowserOptions = nestedAgentBrowser;
      }
      const nestedKeywordFilter = asObject(wrappedConfig.keywordFilter);
      if (Object.keys(nestedKeywordFilter).length > 0) {
        wrappedKeywordFilter = nestedKeywordFilter;
      }
    } else {
      const nestedAgentBrowser = asObject(rawAgentBrowser.agentBrowser);
      if (Object.keys(nestedAgentBrowser).length > 0) {
        agentBrowserOptions = nestedAgentBrowser;
      }
      const directKeywordFilter = asObject(rawAgentBrowser.keywordFilter);
      if (Object.keys(directKeywordFilter).length > 0) {
        wrappedKeywordFilter = directKeywordFilter;
      }
    }
  }

  const keywordFilter =
    Object.keys(topLevelKeywordFilter).length > 0
      ? topLevelKeywordFilter
      : Object.keys(topLevelFiltersKeyword).length > 0
        ? topLevelFiltersKeyword
        : wrappedKeywordFilter;

  const ownerId = resolveAgentBrowserOwnerId(source, agentBrowserOptions);
  const normalizedAgentBrowser: Record<string, unknown> = {
    ...agentBrowserOptions,
    ownerId,
    closeOnComplete: false,
  };
  if (
    typeof normalizedAgentBrowser.sessionKey === "string" &&
    normalizedAgentBrowser.sessionKey.trim() === source.id
  ) {
    delete normalizedAgentBrowser.sessionKey;
  }
  if (
    typeof normalizedAgentBrowser.session_key === "string" &&
    normalizedAgentBrowser.session_key.trim() === source.id
  ) {
    delete normalizedAgentBrowser.session_key;
  }
  const captureFilter = asObject(normalizedAgentBrowser.captureFilter);
  const captureKeys = normalizeStringArray(captureFilter.keys);
  if (captureKeys.length > 0) {
    normalizedAgentBrowser.captureFilter = {
      ...captureFilter,
      keys: captureKeys,
    };
  }
  if (
    typeof normalizedAgentBrowser.stateFile !== "string" ||
    !normalizedAgentBrowser.stateFile.trim()
  ) {
    if (credentialStateFile) {
      normalizedAgentBrowser.stateFile = credentialStateFile;
    }
  }
  const auth: Record<string, unknown> = {};
  if (
    typeof normalizedAgentBrowser.stateFile === "string" &&
    normalizedAgentBrowser.stateFile.trim()
  ) {
    auth.stateFile = normalizedAgentBrowser.stateFile.trim();
  }

  const filters: Record<string, unknown> = {};
  if (Object.keys(captureFilter).length > 0) {
    const normalizedCapture = { ...captureFilter };
    if (typeof normalizedCapture.minSegmentChars === "number" && normalizedCapture.minChars == null) {
      normalizedCapture.minChars = normalizedCapture.minSegmentChars;
      delete normalizedCapture.minSegmentChars;
    }
    filters.capture = normalizedCapture;
  }
  if (Object.keys(keywordFilter).length > 0) {
    const normalizedKeywordFilter = { ...keywordFilter };
    if (
      typeof normalizedKeywordFilter.minSegmentChars === "number" &&
      normalizedKeywordFilter.minChars == null
    ) {
      normalizedKeywordFilter.minChars = normalizedKeywordFilter.minSegmentChars;
      delete normalizedKeywordFilter.minSegmentChars;
    }
    filters.keyword = normalizedKeywordFilter;
  }

  delete normalizedAgentBrowser.captureFilter;
  delete normalizedAgentBrowser.keywordFilter;

  return {
    ...normalizedAgentBrowser,
    ...(Object.keys(auth).length > 0 ? { auth } : {}),
    ...(Object.keys(filters).length > 0 ? { filters } : {}),
  };
}

function resolveCredentialStateFile(source: SocialMediaSource): string | null {
  const candidates = [source.social?.credential?.data, source.credential?.data];
  for (const candidate of candidates) {
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
  recallQuery: string
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
      query: normalizedQuery,
    },
  };
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
    const response = await fetch(`${gatherUrl}/v3/scripts/catalog`, {
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

function resolveAgentBrowserOwnerId(
  source: SocialMediaSource,
  options: Record<string, unknown>
): string {
  const candidates = [
    options.ownerId,
    options.owner_id,
    source.social?.credentialId,
    source.credentialId,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return `source:${source.id}`;
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
  driverOptions: Record<string, unknown>,
  driver: GatherSocialDriver
): Record<string, unknown> {
  if (driver !== "agent-browser") {
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
  const filters = asObject(driverOptions.filters);
  return asObject(filters.keyword);
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
}): Promise<void> {
  const { contentId, contentText, item, keywords } = input;
  const normalizedContentText = contentText.toLowerCase();
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
    const aiResult = await scoreSubjectWithAI({
      keyword,
      contentText,
    }).catch((error) => {
      logger.warn("subject ai score failed", {
        contentId,
        keywordId: keyword.id,
        error: logger.normalizeError(error),
      });
      return null;
    });
    const aiScore = aiResult?.score ?? null;
    const finalScore =
      aiScore == null
        ? ruleScore
        : roundScore(0.25 * ruleScore + 0.75 * aiScore);
    const matchSource =
      aiScore == null
        ? item.keywordMatchScore == null
          ? ContentSubjectMatchSource.QUERY
          : ContentSubjectMatchSource.GATHER
        : ContentSubjectMatchSource.FUSED;

    await prisma.contentSubjectMatch.upsert({
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
        reason: aiResult?.reason ?? null,
      },
      update: {
        ruleScore,
        aiScore,
        matchScore: finalScore,
        matchedIncludes: matchedScoringTerms,
        matchedExcludes,
        matchSource,
        reason: aiResult?.reason ?? null,
      },
    });
  }
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

async function scoreSubjectWithAI(input: {
  keyword: QueryKeyword;
  contentText: string;
}): Promise<{ score: number; reason: string } | null> {
  const disabled = process.env.COLLECTOR_ENABLE_SUBJECT_AI_SCORE === "false";
  if (disabled) {
    return null;
  }
  const prompt = stripPromptLike(
    `你是主题相关度打分器。请判断内容与主题是否相关，并输出 JSON: {"score":0-1,"reason":"简短原因"}。
评分原则：
1) 主题名称和主题描述是核心判断依据；
2) 召回词仅用于检索，不应主导最终评分；
3) 评分词是辅助证据，命中可加分，但不能替代主题语义；
4) 若只出现个别词但语义无关，应给低分。
主题名称: ${input.keyword.name}
主题描述: ${input.keyword.description ?? ""}
召回词: ${(input.keyword.includes ?? []).join(", ")}
评分词: ${(input.keyword.synonyms ?? []).join(", ")}
排除词: ${(input.keyword.excludes ?? []).join(", ")}
内容:
${input.contentText.slice(0, 8000)}`
  );
  const result = await llmGateway.json<{ score: number; reason: string }>(
    "subject-score",
    {
      prompt: redact(prompt),
      schema: SubjectScoreSchema,
      temperature: 0.1,
      metadata: { keywordId: input.keyword.id },
    }
  );
  return {
    score: roundScore(Math.min(1, Math.max(0, result.score))),
    reason: result.reason.trim().slice(0, 200),
  };
}

function roundScore(score: number): number {
  return Math.round(score * 10000) / 10000;
}

async function summarizeWithRetry(
  item: CleanItem,
  keywords: string,
  queryId: string,
  runId: string
): Promise<{ summary: string; relevance: boolean }> {
  const prompt = stripPromptLike(
    `请基于关键词：${keywords}，用 2-3 句中文解释下面内容的要点和价值，输出结构化 JSON：{ "summary": "...", "relevance": true/false }；\n${item.text}`
  );
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const summary = await llmGateway.json<{
        summary: string;
        relevance: boolean;
      }>("content-summary", {
        prompt: redact(prompt),
        schema: SummarySchema,
        temperature: 0.3,
        metadata: { queryId, source: item.platform },
      });
      await publishTaskEvent(runId, {
        type: "summary-success",
        message: `摘要成功 ${item.platform}`,
        attempt,
      });
      console.log(
        `[collector] summary-success attempt=${attempt} source=${item.platform} summary=${summary.summary}`
      );
      return summary;
    } catch (error) {
      await publishTaskEvent(runId, {
        type: "summary-error",
        message: `第 ${attempt} 次摘要失败：${(error as Error).message}`,
        attempt,
        source: item.platform,
      });
      console.log(
        `[collector] summary-error attempt=${attempt} source=${item.platform
        } error=${(error as Error).message}`
      );
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw new Error("摘要失败");
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
      throw new Error(`请求 ${url} 失败 (${response.status})`);
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
  snippet?: string;
  summary?: string;
  content?: string;
  link?: string;
  url?: string;
  excerpts?: string[] | Array<{ text?: string; content?: string }>;
  publish_date?: string;
  date?: string;
  publishedAt?: string;
};

type SearchProvider = "parallel" | "tavily" | "anspire" | "generic";

type SearchRequestConfig = {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  timeoutMs?: number;
};

const SEARCH_PROVIDER_ENDPOINTS = {
  parallel:
    process.env.PARALLEL_API_ENDPOINT || "https://api.parallel.ai/v1beta/search",
  tavily:
    process.env.TAVILY_API_ENDPOINT || "https://api.tavily.com/search",
  anspire:
    process.env.ANSPIRE_API_ENDPOINT ||
    "https://plugin.anspire.cn/api/ntsearch/prosearch",
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
    const apiKey = resolveApiKey(options, process.env.PARALLEL_API_KEY);
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
      90_000;
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
      url: SEARCH_PROVIDER_ENDPOINTS.parallel,
      method: "POST",
      headers,
      body: JSON.stringify(stripUndefined(payload)),
      timeoutMs: Math.max(5_000, Math.floor(requestTimeoutMs)),
    };
  }

  if (provider === "tavily") {
    const apiKey = resolveApiKey(options, process.env.TAVILY_API_KEY);
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
      url: SEARCH_PROVIDER_ENDPOINTS.tavily,
      method: "POST",
      headers,
      body: JSON.stringify(stripUndefined(payload)),
    };
  }

  if (provider === "anspire") {
    const apiKey = resolveApiKey(options, process.env.ANSPIRE_API_KEY);
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
      url:
        `${SEARCH_PROVIDER_ENDPOINTS.anspire}?${queryParams.toString()}`,
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
} {
  try {
    const json = JSON.parse(payload);
    const root = asObject(json);
    const requestId = pickString(root.Uuid, root.uuid, root.requestId);
    const candidates = [
      root.items,
      root.results,
      root.data,
      root.output,
    ];
    const rows = candidates.find((candidate) => Array.isArray(candidate));
    if (Array.isArray(rows)) {
      const items = (rows as SearchResultItem[])
        .map((item) => normalizeSearchResultItem(item))
        .filter((item) => Boolean(item.text));
      return { items, requestId };
    }
  } catch {
    // ignore
  }
  return { items: [] };
}

function normalizeSearchResultItem(item: SearchResultItem) {
  const excerpts = normalizeExcerpts(item.excerpts);
  const text =
    item.snippet ||
    item.summary ||
    item.content ||
    excerpts ||
    "";

  return {
    title: item.title,
    text,
    markdown: text,
    url: item.link || item.url,
    time: item.publishedAt || item.publish_date || item.date,
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

function stripUndefined<T extends Record<string, unknown>>(payload: T): T {
  const entries = Object.entries(payload).filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries) as T;
}
