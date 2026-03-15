import { load } from "cheerio";
import { z } from "zod";
import { createHash } from "crypto";

import prisma from "@/lib/prisma";
import { SourceType, ContentType, CrawlerEngine } from "@/app/generated/prisma";
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
  recordIndex?: number;
};

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

    const content = await prisma.content.create({
      data: {
        title:
          item.title ??
          (summary.summary.slice(0, 40).replace(/\s+/g, " ").trim() ||
            `来源 ${item.platform}`),
        summary: summary.summary,
        markdown: item.markdown,
        platform: item.platform,
        type: mapContentType(item.sourceType),
        time: item.time ?? new Date(),
        url: item.url,
        meta: {
          queryId,
          runId,
          sourceFingerprint: item.fingerprint,
          driver: item.driver,
          matchedKeywords: item.matchedKeywords ?? [],
          keywordMatchScore: item.keywordMatchScore ?? null,
          recordId: item.recordId ?? null,
          recordType: item.recordType ?? null,
          recordIndex: item.recordIndex ?? null,
          keywords: expandedKeywords,
          summaryRelevance: summary.relevance,
          sourceId: item.sourceId,
          sourceType: item.sourceType,
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
    name: string;
    includes: string[];
    synonyms: string[];
    enableAiExpand: boolean;
  }>
): string[] {
  const terms: string[] = [];
  for (const keyword of keywords) {
    terms.push(keyword.name);
    terms.push(...keyword.includes);
    if (keyword.enableAiExpand) {
      terms.push(...keyword.synonyms);
    }
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
  const authData = resolveGatherAuthData(source);
  const proxyUrl =
    source.social?.proxy?.url ??
    source.proxy?.url ??
    null;
  const normalizedSocialConfig = normalizeGatherSocialConfig(
    source,
    sourceConfigObj
  );
  const baseConfig = applyGatherProxyConfig(normalizedSocialConfig, proxyUrl);
  const config =
    keywordFilterTerms.length > 0
      ? {
          ...baseConfig,
          keywordFilter: {
            ...asObject((baseConfig as Record<string, unknown>).keywordFilter),
            keywords: keywordFilterTerms,
          },
        }
      : baseConfig;

  try {
    const response = await fetch(`${gatherUrl}/v2/fetch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: gatherPlatform,
        config: config,
        sourceId: source.id,
        authData,
        responseFormats: ["text", "markdown"],
        driver: "playwright",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gather service returned ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    return normalizeGatherItems(data, source);
  } catch (error) {
    console.error(`[collector] fetchSocialSource error:`, error);
    // Fallback to basic info if gather service is down
    return [
      {
        title: `${source.social?.platform || "Social"} ${source.name} (Fallback)`,
        text: `社交平台 ${source.name} (采集服务异常: ${(error as Error).message})`,
        markdown: `采集服务异常，请检查 GATHER_SERVICE_URL`,
        platform: source.name,
        time: new Date(),
        sourceId: source.id,
        sourceType: source.type,
      },
    ];
  }
}

function mapGatherPlatform(platform?: string | null): string {
  if (!platform) return "unknown";
  return platform.toLowerCase();
}

function normalizeGatherSocialConfig(
  source: SocialMediaSource,
  config: Record<string, unknown>
): Record<string, unknown> {
  const platform = source.social?.platform;
  if ((platform || "").toUpperCase() !== "X") {
    return config;
  }

  const playwright = asObject(config.playwright);
  const args = asObject(playwright.args);
  const screenName =
    typeof args.screen_name === "string" && args.screen_name.trim()
      ? args.screen_name.trim()
      : "";
  const authKey =
    resolveSourceCredentialId(source, playwright) ||
    "anonymous-auth";
  const platformKey = (platform || "unknown").toLowerCase();
  const driverKey = "playwright";
  const normalizedPlaywright: Record<string, unknown> = {
    mode:
      typeof playwright.mode === "string" && playwright.mode.trim()
        ? playwright.mode
        : "eval-js",
    headless:
      typeof playwright.headless === "boolean" ? playwright.headless : false,
    targetUrl:
      typeof playwright.targetUrl === "string" && playwright.targetUrl.trim()
        ? playwright.targetUrl
        : "https://x.com",
    scriptPath:
      typeof playwright.scriptPath === "string" ? playwright.scriptPath : "",
    args: Object.fromEntries(
      Object.entries(args).map(([key, value]) => [key, value == null ? "" : String(value)])
    ),
    userId:
      typeof playwright.userId === "string" && playwright.userId.trim()
        ? playwright.userId
        : screenName,
    sessionId:
      typeof playwright.sessionId === "string" && playwright.sessionId.trim()
        ? playwright.sessionId
        : `${authKey}:${platformKey}:${driverKey}`,
    poolDriver:
      typeof playwright.poolDriver === "string" && playwright.poolDriver.trim()
        ? playwright.poolDriver
        : driverKey,
  };

  if (typeof playwright.stateFile === "string" && playwright.stateFile.trim()) {
    normalizedPlaywright.stateFile = playwright.stateFile;
  }

  return { playwright: normalizedPlaywright };
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

function resolveSourceCredentialId(
  source: SocialMediaSource,
  playwrightConfig: Record<string, unknown>
): string | null {
  const ids = [
    source.social?.credentialId,
    source.credentialId,
    playwrightConfig.credentialId,
    playwrightConfig.credential_id,
  ];
  for (const id of ids) {
    if (typeof id === "string" && id.trim()) {
      return id.trim();
    }
  }
  return null;
}

function resolveGatherAuthData(source: SocialMediaSource): Record<string, unknown> | null {
  const socialCredential = source.social?.credential?.data;
  if (socialCredential && typeof socialCredential === "object" && !Array.isArray(socialCredential)) {
    return socialCredential as Record<string, unknown>;
  }
  const sourceCredential = source.credential?.data;
  if (sourceCredential && typeof sourceCredential === "object" && !Array.isArray(sourceCredential)) {
    return sourceCredential as Record<string, unknown>;
  }
  return null;
}

function normalizeGatherItems(payload: unknown, source: SocialMediaSource): CleanItem[] {
  if (!Array.isArray(payload)) {
    return [];
  }
  const normalized: CleanItem[] = [];
  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const text =
      typeof row.text === "string"
        ? row.text
        : typeof row.markdown === "string"
          ? row.markdown
          : "";
    if (!text) continue;

    const markdown =
      typeof row.markdown === "string" && row.markdown.trim()
        ? row.markdown
        : text;
    const parsedTime =
      typeof row.time === "string" || row.time instanceof Date
        ? new Date(row.time)
        : null;

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
      recordId: typeof row.recordId === "string" ? row.recordId : undefined,
      recordType: typeof row.recordType === "string" ? row.recordType : undefined,
      recordIndex: typeof row.recordIndex === "number" ? row.recordIndex : undefined,
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
