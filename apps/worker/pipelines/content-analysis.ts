import { load } from "cheerio";
import { z } from "zod";
import { createHash } from "crypto";

import prisma from "@/lib/prisma";
import { Prisma, SourceType, ContentType, CrawlerEngine } from "@/app/generated/prisma";
import {
  SourceWithRelations,
  SocialMediaSource,
  SearchEngineSource,
  WebSource,
  DarknetSource,
} from "@/lib/types";
import { llmGateway, browserAgent } from "@oak/agents";
import { publishTaskEvent, publishContentEvent } from "@/lib/queue";
import { redact, stripPromptLike } from "@/lib/security";
import { buildNormalizedRecordContent } from "./record-content-normalizer";

const SummarySchema = z.object({
  summary: z.string().min(30).max(400),
  relevance: z.boolean(),
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
  sourceType: SourceType;
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

const SOCIAL_PLATFORM_DRIVER_SUPPORT: Record<string, readonly GatherSocialDriver[]> = {
  X: ["playwright", "xhttp", "agent-browser"],
  REDDIT: ["playwright", "xhttp", "agent-browser"],
  XIAOHONGSHU: ["playwright", "xhttp", "agent-browser"],
  DOUYIN: ["playwright", "xhttp", "agent-browser"],
  TIKTOK: ["playwright", "xhttp", "agent-browser"],
  WEIBO: ["playwright", "xhttp", "agent-browser"],
  TELEGRAM: ["playwright", "xhttp", "agent-browser"],
  WHATSAPP: ["playwright", "xhttp", "agent-browser"],
  INSTAGRAM: ["playwright", "xhttp", "agent-browser"],
  FACEBOOK: ["playwright", "xhttp", "agent-browser"],
};

const GATHER_OUTPUT_FIELD_RULE_TTL_MS = 5 * 60 * 1000;
const gatherOutputFieldRuleCache = new Map<string, GatherOutputField>();
let gatherOutputFieldRuleCacheExpireAt = 0;

function isWebSource(source: SourceWithRelations): source is WebSource {
  return source.type === SourceType.WEB;
}

function isDarknetSource(source: SourceWithRelations): source is DarknetSource {
  return source.type === SourceType.DARKNET;
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
    switch (source.type) {
      case SourceType.WEB:
        if (source.web) normalizedSources.push(source as WebSource);
        break;
      case SourceType.DARKNET:
        if (source.darknet) normalizedSources.push(source as DarknetSource);
        break;
      case SourceType.SEARCH_ENGINE:
        if (source.search) normalizedSources.push(source as SearchEngineSource);
        break;
      case SourceType.SOCIAL_MEDIA:
        if (source.social) normalizedSources.push(source as SocialMediaSource);
        break;
    }
  });
  const keywordFilterTerms = buildKeywordFilterTerms(query.keywords);
  const rawItems = await fetchBySources(normalizedSources, runId, keywordFilterTerms);
  const cleaned = await cleanAndDedup(rawItems, runId);

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

    const content = await prisma.content.create({
      data: {
        title: contentTitle,
        summary: summary.summary,
        markdown: item.markdown,
        platform: item.platform,
        type: mapContentType(item.sourceType),
        time: contentTime,
        url: item.url,
        meta: {
          queryId,
          runId,
          sourceFingerprint: item.fingerprint,
          driver: item.driver,
          matchedKeywords: item.matchedKeywords ?? [],
          keywordMatchScore: item.keywordMatchScore ?? null,
          recordId: normalizedRecordContent.relation.recordId,
          recordType: normalizedRecordContent.relation.recordType,
          recordTime: normalizedRecordContent.detailView.publishedAt,
          recordContent: normalizedRecordContent as Prisma.InputJsonValue,
          schemaVersion: normalizedRecordContent.schemaVersion,
          recordIndex: normalizedRecordContent.relation.recordIndex,
          keywords: expandedKeywords,
          summaryRelevance: summary.relevance,
          sourceId: item.sourceId,
          sourceType: item.sourceType,
          intent: item.intent ?? null,
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
}

function mapContentType(sourceType: SourceType): ContentType {
  switch (sourceType) {
    case SourceType.DARKNET:
      return ContentType.Darknet;
    default:
      return ContentType.Web;
  }
}

function buildKeywordFilterTerms(
  keywords: Array<{
    includes: string[];
  }>
): string[] {
  const terms: string[] = [];
  for (const keyword of keywords) {
    terms.push(...keyword.includes);
  }
  return Array.from(new Set(terms.map((term) => term.trim().toLowerCase()).filter(Boolean)));
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
  keywordFilterTerms: string[]
): Promise<CleanItem[]> {
  const results: CleanItem[] = [];
  for (const source of sources) {
    console.log(
      `[collector] fetchBySources start ${source.name} (${source.type})`
    );
    const driver = resolveFetchDriver(source);
    await publishTaskEvent(runId, {
      type: "fetch-driver",
      message: `开始抓取 ${source.name}`,
      sourceId: source.id,
      driver,
    });
    try {
      const fetched = await executeFetchDriver(source, driver, keywordFilterTerms);
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
      results.push(...fetched);
    } catch (error) {
      await publishTaskEvent(runId, {
        type: "error",
        message: `抓取来源 ${source.name} 失败：${(error as Error).message}`,
        sourceId: source.id,
        driver,
      });
    }
  }
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
  keywordFilterTerms: string[]
): Promise<CleanItem[]> {
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
      return fetchAICrawlerSource(source, keywordFilterTerms);
    default:
      return fetchWithDefaultSource(source, keywordFilterTerms);
  }
}

async function fetchWithDefaultSource(
  source: SourceWithRelations,
  keywordFilterTerms: string[]
): Promise<CleanItem[]> {
  console.log(
    `[collector] fetchWithDefaultSource ${source.name} (${source.type})`
  );
  switch (source.type) {
    case SourceType.WEB:
      return fetchHtmlSource(source as WebSource);
    case SourceType.DARKNET:
      return fetchHtmlSource(source as DarknetSource);
    case SourceType.SEARCH_ENGINE:
      return fetchSearchSource(source as SearchEngineSource);
    case SourceType.SOCIAL_MEDIA:
      return fetchSocialSource(source as SocialMediaSource, keywordFilterTerms);
    default:
      return [];
  }
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

  let urls: string[] = [];
  if (isWebSource(source) && source.web?.url) {
    urls = Array.isArray(source.web.url) ? source.web.url : [source.web.url];
  } else if (isDarknetSource(source) && source.darknet?.url) {
    urls = Array.isArray(source.darknet.url) ? source.darknet.url : [source.darknet.url];
  }

  if (urls.length === 0) {
    const fallbackUrl = source.description || `https://example.com/${source.id}`;
    urls = [fallbackUrl];
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
        sourceType: source.type,
      });
    } catch (error) {
      console.error(`[collector] fetchBrowserSource error: ${url}`, error);
    }
  }

  return allItems;
}

async function fetchAICrawlerSource(
  source: SourceWithRelations,
  keywordFilterTerms: string[]
): Promise<CleanItem[]> {
  if (isWebSource(source) || isDarknetSource(source)) {
    console.log(
      `[collector] fetchAICrawlerSource -> fetchBrowserSource ${source.name}`
    );
    return fetchBrowserSource(source);
  }
  if (source.type === SourceType.SEARCH_ENGINE) {
    console.log(
      `[collector] fetchAICrawlerSource -> fetchSearchSource ${source.name}`
    );
    return fetchSearchSource(source as SearchEngineSource);
  }
  console.log(
    `[collector] fetchAICrawlerSource -> fetchSocialSource ${source.name}`
  );
  return fetchSocialSource(source as SocialMediaSource, keywordFilterTerms);
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

  let urls: string[] = [];
  if (isWebSource(source) && source.web?.url) {
    urls = Array.isArray(source.web.url) ? source.web.url : [source.web.url];
  } else if (isDarknetSource(source) && source.darknet?.url) {
    urls = Array.isArray(source.darknet.url) ? source.darknet.url : [source.darknet.url];
  }

  if (urls.length === 0) {
    const fallbackUrl = source.description || `https://example.com/${source.id}`;
    urls = [fallbackUrl];
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
        sourceType: source.type,
      });
    } catch (error) {
      console.error(`[collector] fetchHtmlSource error: ${url}`, error);
      // Continue to next URL
    }
  }

  return allItems;
}

async function fetchSearchSource(
  source: SearchEngineSource
): Promise<CleanItem[]> {
  console.log(`[collector] fetchSearchSource ${source.name}`);
  const apiUrl = source.search?.apiEndpoint;
  if (!apiUrl) {
    return [
      {
        text: `搜索引擎 ${source.name} 未配置 API，使用默认查询 ${source.search?.query || "unknown"
          }`,
        markdown: `搜索引擎 ${source.name} 结果占位`,
        platform: source.name,
        time: new Date(),
        sourceId: source.id,
        sourceType: source.type,
      },
    ];
  }
  const payload = {
    query: source.search.query,
    options: source.search.options,
  };
  const response = await fetchWithTimeout(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = parseSearchResult(response);
  if (!data.length) {
    return [
      {
        text: `搜索引擎 ${source.name} 返回空数据`,
        markdown: `空数据`,
        platform: source.name,
        time: new Date(),
        sourceId: source.id,
        sourceType: source.type,
      },
    ];
  }
  return data.map((item) => ({
    title: item.title,
    text: item.text,
    markdown: item.markdown,
    platform: source.name,
    url: item.url,
    time: item.time ? new Date(item.time) : new Date(),
    sourceId: source.id,
    sourceType: source.type,
  }));
}

async function fetchSocialSource(
  source: SocialMediaSource,
  keywordFilterTerms: string[]
): Promise<CleanItem[]> {
  console.log(`[collector] fetchSocialSource ${source.name} via Python Gather`);

  const gatherUrl = process.env.GATHER_SERVICE_URL || "http://localhost:8000";
  const gatherPlatform = mapGatherPlatform(source.social?.platform);
  const sourceConfig = source.social?.config || {};
  const sourceConfigObj = asObject(sourceConfig);
  const gatherDriver = resolveGatherDriver(
    sourceConfigObj,
    source.social?.platform
  );
  const proxyUrl =
    source.social?.proxy?.url ??
    source.proxy?.url ??
    null;
  const intent = resolveGatherIntent(sourceConfigObj);
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
  const driver: GatherDriverPayload =
    Object.keys(keywordFilterOptions).length > 0
      ? {
          name: gatherDriver,
          ...driverOption,
          script: intent,
          filter: keywordFilterOptions,
        }
      : {
          name: gatherDriver,
          ...driverOption,
          script: intent,
        };

  try {
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
      throw new Error(`Gather service returned ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const items = Array.isArray(data?.items) ? data.items : [];
    return normalizeGatherItems(items, source, intent.type);
  } catch (error) {
    console.error(`[collector] fetchSocialSource error:`, error);
    throw new Error(
      `Social gather failed for ${source.name}: ${(error as Error).message}`
    );
  }
}

function resolveGatherDriver(
  config: Record<string, unknown>,
  platform?: string | null
): GatherSocialDriver {
  const normalizedPlatform = (platform || "").toUpperCase();
  const supportedDrivers =
    SOCIAL_PLATFORM_DRIVER_SUPPORT[normalizedPlatform] ??
    (["playwright"] as const);
  const driverConfig = asObject(config.driver);
  const rawDriver =
    typeof config.driver === "string"
      ? config.driver.trim().toLowerCase()
      : typeof driverConfig.name === "string"
        ? driverConfig.name.trim().toLowerCase()
        : "";
  if (
    (rawDriver === "xhttp" || rawDriver === "agent-browser" || rawDriver === "playwright") &&
    supportedDrivers.includes(rawDriver)
  ) {
    return rawDriver;
  }
  return supportedDrivers[0] ?? "playwright";
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
  config: Record<string, unknown>
): GatherIntentPayload {
  const rawIntent = asObject(config.intent);
  const rawArgs = asObject(rawIntent.args);
  const intentType =
    typeof rawIntent.type === "string" && rawIntent.type.trim()
      ? rawIntent.type.trim()
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
  const now = Date.now();
  if (now >= gatherOutputFieldRuleCacheExpireAt) {
    try {
      const response = await fetch(`${gatherUrl}/v3/scripts/catalog`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (response.ok) {
        const data = await response.json();
        const items = Array.isArray(data?.items)
          ? (data.items as GatherScriptCatalogItem[])
          : [];
        gatherOutputFieldRuleCache.clear();
        for (const item of items) {
          const itemPlatform =
            typeof item.platform === "string" ? item.platform.trim().toLowerCase() : "";
          const itemIntent =
            typeof item.intent === "string" ? item.intent.trim().toLowerCase() : "";
          if (!itemPlatform || !itemIntent) continue;
          const normalizedField = normalizeGatherOutputField(item.sample?.outputField);
          if (!normalizedField) continue;
          gatherOutputFieldRuleCache.set(
            `${itemPlatform}:${itemIntent}`,
            normalizedField
          );
        }
      }
    } catch {
      // Best effort: keep existing cache/fallback behavior.
    } finally {
      gatherOutputFieldRuleCacheExpireAt = now + GATHER_OUTPUT_FIELD_RULE_TTL_MS;
    }
  }

  const cacheKey = `${platform.trim().toLowerCase()}:${intentType.trim().toLowerCase()}`;
  return gatherOutputFieldRuleCache.get(cacheKey);
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

function pickFallbackText(recordContent: Record<string, unknown>): string {
  const directKeys = ["title", "content", "summary", "description", "author"];
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
    const text =
      typeof recordContent.text === "string"
        ? recordContent.text
        : typeof row.text === "string"
          ? row.text
          : typeof row.markdown === "string"
            ? row.markdown
            : pickFallbackText(recordContent);
    if (!text) continue;

    const markdown =
      typeof recordContent.markdown === "string" && recordContent.markdown.trim()
        ? recordContent.markdown
        : typeof row.markdown === "string" && row.markdown.trim()
          ? row.markdown
        : text;
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
      title: typeof row.title === "string" ? row.title : undefined,
      text,
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
      sourceType: source.type,
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
    const existingByRecordId = await prisma.content.findFirst({
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
              path: ["recordId"],
              equals: item.recordId,
            },
          },
        ],
      },
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
  console.log(`[collector] fetchWithTimeout ${url}`, options);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  const response = await fetch(url, { ...options, signal: controller.signal });
  clearTimeout(timeout);
  if (!response.ok) {
    throw new Error(`请求 ${url} 失败 (${response.status})`);
  }
  return response.text();
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
  link?: string;
  publishedAt?: string;
};

function parseSearchResult(payload: string) {
  try {
    const json = JSON.parse(payload);
    if (Array.isArray(json.items)) {
      return (json.items as SearchResultItem[]).map((item) => ({
        title: item.title,
        text: item.snippet || item.summary || "",
        markdown: item.snippet || item.summary || "",
        url: item.link,
        time: item.publishedAt,
      }));
    }
  } catch {
    // ignore
  }
  return [];
}
