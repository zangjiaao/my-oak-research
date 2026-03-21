import { llmGateway } from "@oak/agents/llm-gateway";
import { json, badRequest, serverError } from "@/app/api/_utils/http";
import { logger } from "@/lib/logger";
import {
  isWebDeriveIoLogEnabled,
  writeWebDeriveIoLog,
} from "@/app/api/follow/keywords/derive-io-log";
import { z } from "zod";
import { randomUUID } from "node:crypto";

const DEFAULT_DERIVE_LANGUAGES = ["zh", "en"] as const;
const DEFAULT_RECALL_SOFT_LIMIT = 64;
const DEFAULT_SCORING_SOFT_LIMIT = 120;
const DEFAULT_EXCLUSION_SOFT_LIMIT = 80;
const DEFAULT_QUERY_PER_LANGUAGE_LIMIT = 2;
const DEFAULT_SEARCH_ENGINE = "auto";

type SearchProvider = "anspire" | "tavily" | "parallel";
type CalibrationReason =
  | "calibration_disabled"
  | "no_search_provider_configured"
  | "provider_request_failed"
  | null;
type CalibrationDoc = {
  title: string;
  snippet: string;
  url?: string;
};
type SearchCallResult = {
  docs: CalibrationDoc[];
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  };
  responseBody: unknown;
  statusCode: number;
};
type QueryDiagnostics = {
  query: string;
  parsedCount: number;
  topicHitCount: number;
};

const SEARCH_PROVIDER_ENDPOINTS: Record<SearchProvider, string> = {
  parallel:
    process.env.PARALLEL_API_ENDPOINT || "https://api.parallel.ai/v1beta/search",
  tavily: process.env.TAVILY_API_ENDPOINT || "https://api.tavily.com/search",
  anspire:
    process.env.ANSPIRE_API_ENDPOINT ||
    "https://plugin.anspire.cn/api/ntsearch/prosearch",
};

const DeriveSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  includes: z.array(z.string()).optional(),
  excludes: z.array(z.string()).optional(),
  synonyms: z.array(z.string()).optional(),
  languages: z.array(z.string()).optional(),
  persistedLanguages: z.array(z.string()).optional(),
  recallBudget: z.number().int().positive().optional(),
  calibration: z.boolean().optional().default(true),
  lang: z.string().optional().default("auto"),
});

const TopicNounPlanSchema = z.object({
  primaryNoun: z.string().min(1),
  secondaryNouns: z.array(z.string()).min(1).max(2),
  searchQueries: z.array(z.string()).optional().default([]),
});
const AtomicTermResultSchema = z.object({
  terms: z.array(z.string()).default([]),
});
const FullLanguageBackfillSchema = z.object({
  byLanguage: z.record(z.string(), z.array(z.string())).default({}),
});
const MultilingualSeedQuerySchema = z.object({
  queries: z
    .array(
      z.object({
        language: z.string().min(1),
        query: z.string().min(1),
      })
    )
    .default([]),
});

function normalizeTerms(values: string[]): string[] {
  const seen = new Set<string>();
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.toLowerCase())
    .filter((value) => (seen.has(value) ? false : (seen.add(value), true)));
}

function countTopicHits(docs: CalibrationDoc[], topicTerms: string[]): number {
  if (topicTerms.length === 0) return 0;
  return docs.filter((doc) => {
    const content = `${doc.title} ${doc.snippet}`.toLowerCase();
    return topicTerms.some((term) => content.includes(term));
  }).length;
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function mergeLanguagePreferences(input: {
  languages?: string[];
  persistedLanguages?: string[];
  description?: string | null;
}) {
  const fromInput = normalizeTerms(input.languages ?? []);
  const fromPersisted = normalizeTerms(input.persistedLanguages ?? []);
  const defaultLanguages = [...DEFAULT_DERIVE_LANGUAGES];
  const description = input.description?.toLowerCase() ?? "";
  const inferred: string[] = [];
  if (description.includes("arabic") || description.includes("阿拉伯")) {
    inferred.push("ar");
  }
  if (description.includes("german") || description.includes("德语")) {
    inferred.push("de");
  }
  if (description.includes("japanese") || description.includes("日语")) {
    inferred.push("ja");
  }
  const merged = normalizeTerms([
    ...fromInput,
    ...fromPersisted,
    ...inferred,
    ...defaultLanguages,
  ]);
  return merged.length > 0 ? merged : defaultLanguages;
}

function extractTopicTermsFromText(...inputs: Array<string | null | undefined>): string[] {
  const set = new Set<string>();
  const pattern = /(^|\s)#([a-zA-Z0-9][\w.-]{0,63})/g;
  for (const input of inputs) {
    const text = String(input ?? "");
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const value = match[2]?.trim().toLowerCase();
      if (value) set.add(value);
    }
  }
  return Array.from(set);
}

function resolveSearchProviderOrder(rawPreference: string | undefined): SearchProvider[] {
  const normalized = String(rawPreference ?? DEFAULT_SEARCH_ENGINE)
    .trim()
    .toLowerCase();
  if (normalized === "anspire") return ["anspire"];
  if (normalized === "tavily") return ["tavily"];
  if (normalized === "parallel") return ["parallel"];
  return ["anspire", "tavily", "parallel"];
}

function resolveRecallSoftLimit(rawBudget?: number): number {
  const envRaw = process.env.WEB_DERIVE_RECALL_SOFT_LIMIT;
  const envParsed = envRaw ? Number(envRaw) : NaN;
  const envLimit = Number.isFinite(envParsed) && envParsed > 0 ? Math.floor(envParsed) : 0;
  if (typeof rawBudget === "number" && Number.isFinite(rawBudget) && rawBudget > 0) {
    return Math.floor(rawBudget);
  }
  if (envLimit > 0) return envLimit;
  return DEFAULT_RECALL_SOFT_LIMIT;
}

function resolvePositiveEnvLimit(
  envKey: string,
  fallback: number,
  rawOverride?: number
): number {
  if (
    typeof rawOverride === "number" &&
    Number.isFinite(rawOverride) &&
    rawOverride > 0
  ) {
    return Math.floor(rawOverride);
  }
  const envRaw = process.env[envKey];
  const envParsed = envRaw ? Number(envRaw) : NaN;
  if (Number.isFinite(envParsed) && envParsed > 0) {
    return Math.floor(envParsed);
  }
  return fallback;
}

function resolveScoringSoftLimit(): number {
  return resolvePositiveEnvLimit(
    "WEB_DERIVE_SCORING_SOFT_LIMIT",
    DEFAULT_SCORING_SOFT_LIMIT
  );
}

function resolveExclusionSoftLimit(): number {
  return resolvePositiveEnvLimit(
    "WEB_DERIVE_EXCLUSION_SOFT_LIMIT",
    DEFAULT_EXCLUSION_SOFT_LIMIT
  );
}

function resolveQueryPerLanguageLimit(): number {
  return resolvePositiveEnvLimit(
    "WEB_DERIVE_QUERY_PER_LANGUAGE_LIMIT",
    DEFAULT_QUERY_PER_LANGUAGE_LIMIT
  );
}

function isProviderConfigured(provider: SearchProvider): boolean {
  if (provider === "anspire") return Boolean(process.env.ANSPIRE_API_KEY);
  if (provider === "tavily") return Boolean(process.env.TAVILY_API_KEY);
  return Boolean(process.env.PARALLEL_API_KEY);
}

function splitSearchTokens(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/#/g, " ")
    .split(/[\s,.;:!?/|()[\]{}，。；：！？、]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function fallbackSeedNouns(
  name: string,
  description?: string | null,
  topicTerms: string[] = []
): { primaryNoun: string; secondaryNouns: string[] } {
  const candidates = normalizeTerms([
    ...topicTerms,
    ...splitSearchTokens(name),
    ...splitSearchTokens(description ?? ""),
  ]);
  const primaryNoun = candidates[0] ?? "topic";
  const secondaryNouns = candidates.slice(1, 3);
  return {
    primaryNoun,
    secondaryNouns: secondaryNouns.length > 0 ? secondaryNouns : [primaryNoun],
  };
}

async function extractTopicNounPlan(input: {
  name: string;
  description?: string | null;
  topicTerms: string[];
  requestId: string;
}): Promise<{
  primaryNoun: string;
  secondaryNouns: string[];
  searchQueries: string[];
}> {
  const prompt = `
Extract a search noun plan from a topic.
Topic name: ${input.name}
Description: ${input.description ?? "N/A"}
User topic tags: ${input.topicTerms.join(", ") || "none"}

Rules:
- Return exactly 1 primary noun and 1-2 secondary nouns.
- Nouns must be atomic and searchable.
- Build search queries by joining nouns with spaces.
- Search queries should favor latest topic investigation.
- Do not output phrase-like interpretation terms.

Return ONLY JSON:
{
  "primaryNoun": "...",
  "secondaryNouns": ["...", "..."],
  "searchQueries": ["primary secondary1", "primary secondary2"]
}
`;
  try {
    const response = await llmGateway.json<
      z.infer<typeof TopicNounPlanSchema>
    >("keyword-topic-noun-plan", {
      prompt,
      schema: TopicNounPlanSchema,
      temperature: 0.2,
      metadata: { requestId: input.requestId },
    });
    writeWebDeriveIoLog({
      event: "derive-llm-request-response",
      requestId: input.requestId,
      request: {
        task: "keyword-topic-noun-plan",
        prompt,
        temperature: 0.2,
      },
      response,
    });
    const primaryNoun = normalizeTerms([response.primaryNoun])[0];
    const secondaryNouns = normalizeTerms(response.secondaryNouns ?? []).slice(0, 2);
    const searchQueries = normalizeTerms(response.searchQueries ?? []);
    if (primaryNoun) {
      return {
        primaryNoun,
        secondaryNouns: secondaryNouns.length > 0 ? secondaryNouns : [primaryNoun],
        searchQueries,
      };
    }
  } catch (error) {
    logger.warn("keyword topic noun plan failed", {
      requestId: input.requestId,
      error: logger.normalizeError(error),
    });
    writeWebDeriveIoLog({
      event: "derive-llm-request-response",
      requestId: input.requestId,
      request: {
        task: "keyword-topic-noun-plan",
        prompt,
        temperature: 0.2,
      },
      error: error instanceof Error ? error.message : "unknown error",
    });
  }
  const fallback = fallbackSeedNouns(input.name, input.description, input.topicTerms);
  return {
    ...fallback,
    searchQueries: [],
  };
}

async function buildMultilingualSeedQueries(input: {
  name: string;
  description?: string | null;
  requestId: string;
  primaryNoun: string;
  secondaryNouns: string[];
  topicTerms: string[];
  languages: string[];
  queryPerLanguageLimit: number;
}): Promise<{ seedQueries: string[]; byLanguage: Record<string, string[]> }> {
  const languages = normalizeTerms(input.languages);
  if (languages.length === 0) {
    return { seedQueries: [], byLanguage: {} };
  }

  const fallbackQueries = buildSeedQueries({
    primaryNoun: input.primaryNoun,
    secondaryNouns: input.secondaryNouns,
    searchQueries: [],
    topicTerms: input.topicTerms,
  });
  const prompt = `
Generate multilingual web search queries for keyword calibration.
Topic name: ${input.name}
Description: ${input.description ?? "N/A"}
Primary noun: ${input.primaryNoun}
Secondary nouns: ${input.secondaryNouns.join(", ")}
Topic tags: ${input.topicTerms.join(", ") || "none"}
Target languages: ${languages.join(", ")}

Rules:
- Produce up to ${input.queryPerLanguageLimit} queries per language.
- Keep each query concise and searchable.
- Keep product/entity tokens unchanged when needed (e.g. qmd, mem0, bm25).
- Focus on latest investigation signals.
- Do not output explanations.

Return ONLY JSON:
{
  "queries": [
    { "language": "zh", "query": "..." },
    { "language": "en", "query": "..." }
  ]
}
`;

  try {
    const response = await llmGateway.json<
      z.infer<typeof MultilingualSeedQuerySchema>
    >("keyword-multilingual-seed-queries", {
      prompt,
      schema: MultilingualSeedQuerySchema,
      temperature: 0.2,
      metadata: { requestId: input.requestId },
    });
    writeWebDeriveIoLog({
      event: "derive-llm-request-response",
      requestId: input.requestId,
      request: {
        task: "keyword-multilingual-seed-queries",
        prompt,
        temperature: 0.2,
      },
      response,
    });

    const byLanguage: Record<string, string[]> = {};
    for (const lang of languages) {
      byLanguage[lang] = [];
    }
    for (const item of response.queries ?? []) {
      const language = String(item.language ?? "").trim().toLowerCase();
      const query = normalizeTerms([item.query ?? ""])[0];
      if (!language || !query) continue;
      if (!languages.includes(language)) continue;
      const bucket = byLanguage[language] ?? [];
      if (bucket.length >= input.queryPerLanguageLimit) continue;
      if (!bucket.includes(query)) {
        bucket.push(query);
      }
      byLanguage[language] = bucket;
    }

    const flattened = normalizeTerms(
      languages.flatMap((language) => byLanguage[language] ?? [])
    );
    return {
      seedQueries: normalizeTerms([...fallbackQueries, ...flattened]),
      byLanguage,
    };
  } catch (error) {
    logger.warn("keyword multilingual seed queries failed", {
      requestId: input.requestId,
      error: logger.normalizeError(error),
    });
    writeWebDeriveIoLog({
      event: "derive-llm-request-response",
      requestId: input.requestId,
      request: {
        task: "keyword-multilingual-seed-queries",
        prompt,
        temperature: 0.2,
      },
      error: error instanceof Error ? error.message : "unknown error",
    });
    return {
      seedQueries: fallbackQueries,
      byLanguage: {},
    };
  }
}

function enforceTopicTermsInNounPlan(
  nounPlan: { primaryNoun: string; secondaryNouns: string[]; searchQueries: string[] },
  topicTerms: string[]
): { enforced: typeof nounPlan; topicEnforced: boolean } {
  if (topicTerms.length === 0) {
    return { enforced: nounPlan, topicEnforced: false };
  }
  const normalizedTopics = normalizeTerms(topicTerms);
  const normalizedSecondary = normalizeTerms(nounPlan.secondaryNouns).filter(
    (item) => !normalizedTopics.includes(item)
  );
  const nextSecondary = normalizeTerms([
    ...normalizedTopics,
    ...normalizedSecondary,
  ]).slice(0, 2);
  const nextQueries = normalizeTerms([
    ...nounPlan.searchQueries,
    ...normalizedTopics.map((topic) => `${nounPlan.primaryNoun} ${topic}`),
  ]);
  return {
    enforced: {
      ...nounPlan,
      secondaryNouns: nextSecondary.length > 0 ? nextSecondary : normalizedTopics.slice(0, 1),
      searchQueries: nextQueries,
    },
    topicEnforced: true,
  };
}

function buildSeedQueries(input: {
  primaryNoun: string;
  secondaryNouns: string[];
  searchQueries?: string[];
  topicTerms: string[];
}): string[] {
  const fromModel = normalizeTerms(input.searchQueries ?? []);
  const topicAnchored = normalizeTerms(
    input.topicTerms
      .filter((topic) => topic !== input.primaryNoun)
      .map((topic) => `${input.primaryNoun} ${topic}`)
  );
  if (fromModel.length > 0) {
    return normalizeTerms([...topicAnchored, ...fromModel]);
  }
  const base = normalizeTerms([
    ...input.topicTerms,
    input.primaryNoun,
    ...input.secondaryNouns,
  ]).slice(0, 3);
  if (base.length === 0) return [];
  const combined: string[] = [];
  if (base.length >= 2) {
    combined.push(`${base[0]} ${base[1]}`);
  }
  if (base.length >= 3) {
    combined.push(`${base[0]} ${base[2]}`);
  }
  combined.push(...base);
  return normalizeTerms([...topicAnchored, ...combined]);
}

function toFreshnessQuery(query: string): string {
  if (/[\u4E00-\u9FFF]/u.test(query)) {
    return `${query} 最新`;
  }
  return `${query} latest`;
}

function hasExplicitExcludeIntent(description?: string | null): boolean {
  const text = String(description ?? "").toLowerCase();
  return /(排除|不要|不包含|剔除|exclude|excluding|without|not include|avoid)/i.test(
    text
  );
}

function normalizeAtomicTerms(terms: string[]): string[] {
  const dropped = new Set(["", "-", "_"]);
  return normalizeTerms(terms).filter((term) => {
    if (dropped.has(term)) return false;
    if (/\s/u.test(term)) return false;
    if (/[的]/u.test(term)) return false;
    if (/[，。；;,:!?]/u.test(term)) return false;
    if (/\b(of|for|with|without|and|vs)\b/u.test(term)) return false;
    return true;
  });
}

function buildRecallTerms(
  primaryNoun: string,
  discoveredAtomicTerms: string[],
  secondaryNouns: string[],
  topicTerms: string[],
  existingIncludes: string[]
): string[] {
  const generatedFromEntities = normalizeTerms(
    discoveredAtomicTerms.map((term) => `${primaryNoun} ${term}`)
  );
  const fallbackGenerated = normalizeTerms([
    ...topicTerms.map((topic) => `${primaryNoun} ${topic}`),
    ...secondaryNouns.map((term) => `${primaryNoun} ${term}`),
  ]);
  return normalizeTerms([
    ...existingIncludes,
    ...generatedFromEntities,
    ...fallbackGenerated,
  ]);
}

function buildScoringTerms(
  primaryNoun: string,
  secondaryNouns: string[],
  discoveredAtomicTerms: string[],
  existingSynonyms: string[]
): string[] {
  const atomicExisting = normalizeAtomicTerms(existingSynonyms);
  const atomicCore = normalizeAtomicTerms([
    primaryNoun,
    ...secondaryNouns,
    ...discoveredAtomicTerms,
  ]);
  return normalizeTerms([...atomicExisting, ...atomicCore]);
}

async function extractAtomicTermsFromDocs(input: {
  name: string;
  description?: string | null;
  docs: CalibrationDoc[];
  primaryNoun: string;
  secondaryNouns: string[];
  requestId: string;
}): Promise<string[]> {
  if (input.docs.length === 0) return [];
  const evidence = input.docs
    .slice(0, 14)
    .map((doc, index) => {
      const title = doc.title || "(untitled)";
      const snippet = doc.snippet || "(no snippet)";
      return `${index + 1}. title: ${title}\n   snippet: ${snippet}`;
    })
    .join("\n");
  const prompt = `
You extract atomic nouns from fresh web snippets.
Topic: ${input.name}
Description: ${input.description ?? "N/A"}
Primary noun: ${input.primaryNoun}
Secondary nouns: ${input.secondaryNouns.join(", ")}

Evidence:
${evidence}

Return ONLY JSON:
{
  "terms": ["...", "..."]
}

Rules:
- Keep only atomic noun terms directly related to secondary nouns.
- Prefer concrete entities: plugins, libraries, algorithms, models, tools, organizations, places.
- Exclude generic words like memory/system/context/model/update.
- Do not output "X 的 Y" or multi-word semantic phrases.
- Max 24 terms.
`;
  try {
    const result = await llmGateway.json<z.infer<typeof AtomicTermResultSchema>>(
      "keyword-atomic-term-extraction",
      {
      prompt,
      schema: AtomicTermResultSchema,
      temperature: 0.2,
      metadata: { requestId: input.requestId },
      }
    );
    writeWebDeriveIoLog({
      event: "derive-llm-request-response",
      requestId: input.requestId,
      request: {
        task: "keyword-atomic-term-extraction",
        prompt,
        temperature: 0.2,
      },
      response: result,
    });
    return normalizeAtomicTerms(result.terms ?? []).slice(0, 24);
  } catch (error) {
    logger.warn("keyword atomic term extraction failed", {
      requestId: input.requestId,
      error: logger.normalizeError(error),
    });
    writeWebDeriveIoLog({
      event: "derive-llm-request-response",
      requestId: input.requestId,
      request: {
        task: "keyword-atomic-term-extraction",
        prompt,
        temperature: 0.2,
      },
      error: error instanceof Error ? error.message : "unknown error",
    });
    return [];
  }
}

function flattenSearchRows(payload: unknown): Array<Record<string, unknown>> {
  const root = asObject(payload);
  const candidates = [
    root.results,
    root.items,
    root.data,
    root.output,
    root.news,
    root.documents,
    root.organic_results,
    root.organicResults,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate
        .map((item) => asObject(item))
        .filter((item) => Object.keys(item).length > 0);
    }
    const objectCandidate = asObject(candidate);
    if (Array.isArray(objectCandidate.results)) {
      return objectCandidate.results
        .map((item) => asObject(item))
        .filter((item) => Object.keys(item).length > 0);
    }
  }
  return [];
}

function normalizeCalibrationDocs(payload: unknown): CalibrationDoc[] {
  const rows = flattenSearchRows(payload);
  const docs = rows
    .map((row) => {
      const title = pickString(
        row.title,
        row.Title,
        row.name,
        row.Name,
        row.topic
      );
      const snippet = pickString(
        row.snippet,
        row.Snippet,
        row.summary,
        row.Summary,
        row.content,
        row.Content,
        row.description,
        row.Description,
        row.text,
        row.Text
      );
      const url = pickString(row.url, row.Url, row.link, row.Link, row.source);
      return {
        title: title ?? "",
        snippet: snippet ?? "",
        url,
      };
    })
    .filter((doc) => doc.title || doc.snippet);

  const seen = new Set<string>();
  const unique: CalibrationDoc[] = [];
  for (const doc of docs) {
    const signature = `${doc.title}|${doc.snippet}|${doc.url ?? ""}`.toLowerCase();
    if (seen.has(signature)) continue;
    seen.add(signature);
    unique.push(doc);
  }
  return unique;
}

function dedupeCalibrationDocs(docs: CalibrationDoc[]): CalibrationDoc[] {
  const seen = new Set<string>();
  const deduped: CalibrationDoc[] = [];
  for (const doc of docs) {
    const signature = `${doc.title}|${doc.snippet}|${doc.url ?? ""}`.toLowerCase();
    if (seen.has(signature)) continue;
    seen.add(signature);
    deduped.push(doc);
  }
  return deduped;
}

function buildSecondHopQueries(
  primaryNoun: string,
  atomicTerms: string[],
  topicTerms: string[]
): string[] {
  const boosted = normalizeTerms(
    atomicTerms.filter((term) => !topicTerms.includes(term)).slice(0, 4)
  );
  return normalizeTerms(boosted.map((term) => `${primaryNoun} ${term}`)).slice(0, 4);
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<{ json: unknown; statusCode: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return {
      json: await response.json(),
      statusCode: response.status,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function searchWithProvider(
  provider: SearchProvider,
  query: string,
  options?: { relaxed?: boolean }
): Promise<SearchCallResult> {
  const relaxed = options?.relaxed === true;
  const freshnessQuery = toFreshnessQuery(query);
  if (provider === "anspire") {
    const apiKey = process.env.ANSPIRE_API_KEY;
    if (!apiKey) throw new Error("ANSPIRE_API_KEY missing");
    const params = new URLSearchParams({
      query: freshnessQuery,
      top_k: "8",
      sort: "latest",
    });
    const url = `${SEARCH_PROVIDER_ENDPOINTS.anspire}?${params.toString()}`;
    const method = "GET";
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    const response = await fetchJsonWithTimeout(
      url,
      {
        method,
        headers,
      },
      relaxed ? 10000 : 12000
    );
    return {
      docs: normalizeCalibrationDocs(response.json),
      request: { url, method, headers },
      responseBody: response.json,
      statusCode: response.statusCode,
    };
  }

  if (provider === "tavily") {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) throw new Error("TAVILY_API_KEY missing");
    const url = SEARCH_PROVIDER_ENDPOINTS.tavily;
    const method = "POST";
    const headers = { "Content-Type": "application/json" };
    const body = JSON.stringify({
      api_key: apiKey,
      query: freshnessQuery,
      max_results: relaxed ? 6 : 10,
      search_depth: relaxed ? "basic" : "advanced",
      topic: "general",
      include_answer: false,
      include_raw_content: relaxed ? false : true,
      days: 30,
    });
    const response = await fetchJsonWithTimeout(
      url,
      {
        method,
        headers,
        body,
      },
      relaxed ? 10000 : 12000
    );
    return {
      docs: normalizeCalibrationDocs(response.json),
      request: { url, method, headers, body },
      responseBody: response.json,
      statusCode: response.statusCode,
    };
  }

  const apiKey = process.env.PARALLEL_API_KEY;
  if (!apiKey) throw new Error("PARALLEL_API_KEY missing");
  const url = SEARCH_PROVIDER_ENDPOINTS.parallel;
  const method = "POST";
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
  };
  const body = JSON.stringify({
    mode: "one-shot",
    objective: freshnessQuery,
    search_queries: [freshnessQuery],
    max_results: 8,
    excerpts: {
      max_chars_per_result: 900,
      max_chars_total: 8000,
    },
  });
  const response = await fetchJsonWithTimeout(
    url,
    {
      method,
      headers,
      body,
    },
    relaxed ? 10000 : 12000
  );
  return {
    docs: normalizeCalibrationDocs(response.json),
    request: { url, method, headers, body },
    responseBody: response.json,
    statusCode: response.statusCode,
  };
}

async function collectCalibrationDocs(
  seedQueries: string[],
  providerOrder: SearchProvider[],
  requestId: string,
  topicTerms: string[]
): Promise<{
  provider?: SearchProvider;
  docs: CalibrationDoc[];
  diagnostics: QueryDiagnostics[];
  topicHitCount: number;
  reason: CalibrationReason;
  triedProviders: SearchProvider[];
}> {
  const configuredProviders = providerOrder.filter((provider) =>
    isProviderConfigured(provider)
  );
  if (configuredProviders.length === 0) {
    return {
      docs: [],
      diagnostics: [],
      topicHitCount: 0,
      reason: "no_search_provider_configured",
      triedProviders: [],
    };
  }

  let hadRequestError = false;
  for (const provider of configuredProviders) {
    const docs: CalibrationDoc[] = [];
    const diagnostics: QueryDiagnostics[] = [];
    for (const query of seedQueries) {
      try {
        const result = await searchWithProvider(provider, query);
        const topicHitCount = countTopicHits(result.docs, topicTerms);
        docs.push(...result.docs);
        diagnostics.push({
          query,
          parsedCount: result.docs.length,
          topicHitCount,
        });
        writeWebDeriveIoLog({
          event: "derive-search-request-response",
          requestId,
          provider,
          query,
          url: result.request.url,
          method: result.request.method,
          statusCode: result.statusCode,
          request: {
            headers: result.request.headers,
            body: result.request.body ?? null,
          },
          response: result.responseBody,
          details: { parsedCount: result.docs.length, topicHitCount },
        });
      } catch (error) {
        const firstError =
          error instanceof Error ? error.message : "unknown error";
        let retried = false;
        if (provider === "tavily") {
          try {
            retried = true;
            const fallbackResult = await searchWithProvider(provider, query, {
              relaxed: true,
            });
            const topicHitCount = countTopicHits(fallbackResult.docs, topicTerms);
            docs.push(...fallbackResult.docs);
            diagnostics.push({
              query,
              parsedCount: fallbackResult.docs.length,
              topicHitCount,
            });
            writeWebDeriveIoLog({
              event: "derive-search-request-response",
              requestId,
              provider,
              query,
              url: fallbackResult.request.url,
              method: fallbackResult.request.method,
              statusCode: fallbackResult.statusCode,
              request: {
                headers: fallbackResult.request.headers,
                body: fallbackResult.request.body ?? null,
              },
              response: fallbackResult.responseBody,
              details: {
                parsedCount: fallbackResult.docs.length,
                topicHitCount,
                fallbackMode: "relaxed",
                previousError: firstError,
              },
            });
            continue;
          } catch (fallbackError) {
            logger.warn("keyword derive calibration query retry failed", {
              provider,
              query,
              error: logger.normalizeError(fallbackError),
            });
          }
        }
        hadRequestError = true;
        logger.warn("keyword derive calibration query failed", {
          provider,
          query,
          retried,
          error: logger.normalizeError(error),
        });
        writeWebDeriveIoLog({
          event: "derive-search-request-response",
          requestId,
          provider,
          query,
          error: firstError,
          details: {
            retried,
          },
        });
      }
    }
    if (docs.length > 0) {
      const totalTopicHitCount = diagnostics.reduce(
        (sum, item) => sum + item.topicHitCount,
        0
      );
      return {
        provider,
        docs: docs.slice(0, 24),
        diagnostics,
        topicHitCount: totalTopicHitCount,
        reason: null,
        triedProviders: configuredProviders,
      };
    }
  }
  return {
    docs: [],
    diagnostics: [],
    topicHitCount: 0,
    reason: hadRequestError ? "provider_request_failed" : null,
    triedProviders: configuredProviders,
  };
}

function detectScripts(value: string): Set<string> {
  const detected = new Set<string>();
  if (/[\u0600-\u06FF]/u.test(value)) detected.add("arabic");
  if (/[\u3040-\u30FF]/u.test(value)) detected.add("japanese");
  if (/[\u4E00-\u9FFF]/u.test(value)) detected.add("han");
  if (/[\u0400-\u04FF]/u.test(value)) detected.add("cyrillic");
  if (/[A-Za-z]/.test(value)) detected.add("latin");
  return detected;
}

function hasKana(value: string): boolean {
  return /[\u3040-\u30FF]/u.test(value);
}

function hasHan(value: string): boolean {
  return /[\u4E00-\u9FFF]/u.test(value);
}

function hasArabic(value: string): boolean {
  return /[\u0600-\u06FF]/u.test(value);
}

function hasCyrillic(value: string): boolean {
  return /[\u0400-\u04FF]/u.test(value);
}

function hasLatinWord(value: string, minLen = 4): boolean {
  return value
    .toLowerCase()
    .split(/[\s/_-]+/g)
    .some((token) => /[a-z]/.test(token) && token.length >= minLen);
}

function languageToScriptGroups(language: string): string[] {
  switch (language.toLowerCase()) {
    case "zh":
      return ["han"];
    case "ja":
      return ["japanese", "han"];
    case "ar":
      return ["arabic"];
    case "ru":
      return ["cyrillic"];
    case "en":
    case "de":
    case "fr":
    case "es":
      return ["latin"];
    default:
      return [];
  }
}

function filterTermsByLanguages(terms: string[], languages: string[]) {
  const allowedGroups = new Set(
    languages.flatMap((language) => languageToScriptGroups(language))
  );
  if (allowedGroups.size === 0) {
    return { filtered: terms, removedCount: 0 };
  }

  const filtered: string[] = [];
  let removedCount = 0;
  for (const term of terms) {
    const scripts = detectScripts(term);
    if (scripts.size === 0) {
      filtered.push(term);
      continue;
    }
    const hasUnsupported = Array.from(scripts).some(
      (group) => !allowedGroups.has(group)
    );
    const hasAllowed = Array.from(scripts).some((group) => allowedGroups.has(group));
    if (!hasUnsupported && hasAllowed) {
      filtered.push(term);
    } else {
      removedCount += 1;
    }
  }
  return { filtered, removedCount };
}

function hasLanguageCoverage(term: string, language: string): boolean {
  const normalized = language.toLowerCase();
  if (normalized === "ja") return hasKana(term);
  if (normalized === "zh") return hasHan(term) && !hasKana(term);
  if (normalized === "ar") return hasArabic(term);
  if (normalized === "ru") return hasCyrillic(term);
  if (["en", "de", "fr", "es"].includes(normalized)) {
    return hasLatinWord(term, 4);
  }
  const scripts = detectScripts(term);
  const groups = languageToScriptGroups(language);
  if (groups.length === 0 || scripts.size === 0) return false;
  return Array.from(scripts).some((script) => groups.includes(script));
}

function computeLanguageCoverage(
  terms: string[],
  languages: string[]
): Record<string, number> {
  const coverage: Record<string, number> = {};
  for (const language of languages) {
    coverage[language] = terms.filter((term) =>
      hasLanguageCoverage(term, language)
    ).length;
  }
  return coverage;
}

async function backfillTermsByLanguage(input: {
  requestId: string;
  termType: "recall" | "scoring" | "exclusion";
  terms: string[];
  languages: string[];
  atomicOnly: boolean;
}): Promise<{
  terms: string[];
  addedCount: number;
  applied: boolean;
  coverageBefore: Record<string, number>;
  coverageAfter: Record<string, number>;
  byLanguageCounts: Record<string, number>;
  mode: "full_per_language";
}> {
  const coverageBefore = computeLanguageCoverage(input.terms, input.languages);
  if (input.terms.length === 0 || input.languages.length === 0) {
    const emptyCounts = Object.fromEntries(
      input.languages.map((language) => [language, 0])
    );
    return {
      terms: input.terms,
      addedCount: 0,
      applied: false,
      coverageBefore,
      coverageAfter: coverageBefore,
      byLanguageCounts: emptyCounts,
      mode: "full_per_language",
    };
  }

  const prompt = `
You translate keyword terms for full multilingual coverage.
Term type: ${input.termType}
Existing terms: ${input.terms.join(", ")}
Target languages: ${input.languages.join(", ")}
Atomic-only: ${input.atomicOnly ? "yes" : "no"}

Rules:
- Keep original meaning and search intent.
- Keep product/entity tokens unchanged when needed (e.g. qmd, mem0, bm25).
- Return translated terms for EVERY target language.
- For each language, output a complete list covering all existing terms.
- Do not add explanations.
${input.atomicOnly ? "- Keep each term atomic (single token where possible)." : "- Keep terms searchable and concise."}
- Keep output compact and avoid noisy generic terms.

Return ONLY JSON:
{
  "byLanguage": {
    "zh": ["...", "..."],
    "en": ["...", "..."]
  }
}
`;

  try {
    const translated = await llmGateway.json<z.infer<typeof FullLanguageBackfillSchema>>(
      "keyword-language-backfill",
      {
        prompt,
        schema: FullLanguageBackfillSchema,
        temperature: 0.2,
        metadata: { requestId: input.requestId },
      }
    );
    writeWebDeriveIoLog({
      event: "derive-llm-request-response",
      requestId: input.requestId,
      request: {
        task: "keyword-language-backfill",
        prompt,
        temperature: 0.2,
      },
      response: translated,
    });

    const byLanguageCounts: Record<string, number> = {};
    const translatedTerms: string[] = [];
    for (const language of input.languages) {
      const languageTerms = translated.byLanguage?.[language];
      const normalized = normalizeTerms(
        Array.isArray(languageTerms) ? languageTerms : []
      );
      byLanguageCounts[language] = normalized.length;
      translatedTerms.push(...normalized);
    }
    const merged = normalizeTerms([...input.terms, ...translatedTerms]);
    return {
      terms: merged,
      addedCount: Math.max(0, merged.length - input.terms.length),
      applied: translatedTerms.length > 0,
      coverageBefore,
      coverageAfter: computeLanguageCoverage(merged, input.languages),
      byLanguageCounts,
      mode: "full_per_language",
    };
  } catch (error) {
    logger.warn("keyword language backfill failed", {
      requestId: input.requestId,
      error: logger.normalizeError(error),
      termType: input.termType,
    });
    writeWebDeriveIoLog({
      event: "derive-llm-request-response",
      requestId: input.requestId,
      request: {
        task: "keyword-language-backfill",
        prompt,
        temperature: 0.2,
      },
      error: error instanceof Error ? error.message : "unknown error",
    });
    return {
      terms: input.terms,
      addedCount: 0,
      applied: false,
      coverageBefore,
      coverageAfter: coverageBefore,
      byLanguageCounts: Object.fromEntries(
        input.languages.map((language) => [language, 0])
      ),
      mode: "full_per_language",
    };
  }
}

export async function POST(req: Request) {
  try {
    const requestId = randomUUID();
    if (isWebDeriveIoLogEnabled()) {
      logger.info("keyword derive io log enabled", { requestId });
    }
    const body = await req.json();
    const parsed = DeriveSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid payload", parsed.error.format());
    }

    const {
      name,
      description,
      includes = [],
      synonyms = [],
      excludes = [],
      languages,
      persistedLanguages,
      recallBudget,
      calibration,
    } = parsed.data;
    const recallSoftLimit = resolveRecallSoftLimit(recallBudget);
    const scoringSoftLimit = resolveScoringSoftLimit();
    const exclusionSoftLimit = resolveExclusionSoftLimit();
    const queryPerLanguageLimit = resolveQueryPerLanguageLimit();
    const targetLanguages = mergeLanguagePreferences({
      languages,
      persistedLanguages,
      description,
    });
    const inputTopicTerms = extractTopicTermsFromText(name, description);
    const nounPlanRaw = await extractTopicNounPlan({
      name,
      description,
      topicTerms: inputTopicTerms,
      requestId,
    });
    const { enforced: nounPlan, topicEnforced } = enforceTopicTermsInNounPlan(
      nounPlanRaw,
      inputTopicTerms
    );
    const baseSeedQueries = buildSeedQueries({
      primaryNoun: nounPlan.primaryNoun,
      secondaryNouns: nounPlan.secondaryNouns,
      searchQueries: nounPlan.searchQueries,
      topicTerms: inputTopicTerms,
    });
    const multilingualSeed = await buildMultilingualSeedQueries({
      name,
      description,
      requestId,
      primaryNoun: nounPlan.primaryNoun,
      secondaryNouns: nounPlan.secondaryNouns,
      topicTerms: inputTopicTerms,
      languages: targetLanguages,
      queryPerLanguageLimit,
    });
    const seedQueries = normalizeTerms([
      ...baseSeedQueries,
      ...multilingualSeed.seedQueries,
    ]);
    const providerOrder = resolveSearchProviderOrder(process.env.SEARCH_ENGINE);
    const calibrationResult =
      calibration === false
        ? {
            docs: [] as CalibrationDoc[],
            diagnostics: [] as QueryDiagnostics[],
            topicHitCount: 0,
            provider: undefined as SearchProvider | undefined,
            reason: "calibration_disabled" as CalibrationReason,
            triedProviders: [] as SearchProvider[],
          }
        : await collectCalibrationDocs(
            seedQueries,
            providerOrder,
            requestId,
            inputTopicTerms
          );
    const degraded =
      calibrationResult.reason === "no_search_provider_configured" ||
      calibrationResult.reason === "provider_request_failed";
    const discoveredAtomicTermsHop1 = await extractAtomicTermsFromDocs({
      name,
      description,
      docs: calibrationResult.docs,
      primaryNoun: nounPlan.primaryNoun,
      secondaryNouns: nounPlan.secondaryNouns,
      requestId,
    });
    const hop2Queries = buildSecondHopQueries(
      nounPlan.primaryNoun,
      discoveredAtomicTermsHop1,
      inputTopicTerms
    );
    const hop2Result =
      calibration !== false && hop2Queries.length > 0
        ? await collectCalibrationDocs(
            hop2Queries,
            providerOrder,
            requestId,
            inputTopicTerms
          )
        : {
            docs: [] as CalibrationDoc[],
            diagnostics: [] as QueryDiagnostics[],
            topicHitCount: 0,
            provider: calibrationResult.provider,
            reason: null as CalibrationReason,
            triedProviders: calibrationResult.triedProviders,
          };
    const mergedDocs = dedupeCalibrationDocs([
      ...calibrationResult.docs,
      ...hop2Result.docs,
    ]).slice(0, 36);
    const discoveredAtomicTermsHop2 =
      hop2Result.docs.length > 0
        ? await extractAtomicTermsFromDocs({
            name,
            description,
            docs: mergedDocs,
            primaryNoun: nounPlan.primaryNoun,
            secondaryNouns: nounPlan.secondaryNouns,
            requestId,
          })
        : [];
    const discoveredAtomicTerms = normalizeTerms([
      ...discoveredAtomicTermsHop1,
      ...discoveredAtomicTermsHop2,
    ]);
    const explicitExcludeIntent = hasExplicitExcludeIntent(description);
    const topicHintMissing = inputTopicTerms.length === 0;
    const finalExcludesRaw =
      explicitExcludeIntent || excludes.length > 0 ? normalizeTerms(excludes) : [];
    const exclusionSet = new Set(finalExcludesRaw);
    const recallTermsRaw = buildRecallTerms(
      nounPlan.primaryNoun,
      discoveredAtomicTerms,
      nounPlan.secondaryNouns,
      inputTopicTerms,
      normalizeTerms(includes)
    );
    const includesWithoutExclusion = recallTermsRaw.filter(
      (item) => !exclusionSet.has(item)
    );
    const scoringTermsRaw = buildScoringTerms(
      nounPlan.primaryNoun,
      nounPlan.secondaryNouns,
      discoveredAtomicTerms,
      normalizeTerms(synonyms)
    );
    const synonymsWithoutExclusion = scoringTermsRaw.filter(
      (item) => !exclusionSet.has(item) && !includesWithoutExclusion.includes(item)
    );
    const includesFiltered = filterTermsByLanguages(
      includesWithoutExclusion,
      targetLanguages
    );
    const synonymsFiltered = filterTermsByLanguages(
      normalizeAtomicTerms(synonymsWithoutExclusion),
      targetLanguages
    );
    const excludesFiltered = filterTermsByLanguages(
      finalExcludesRaw,
      targetLanguages
    );
    const includesBackfill = await backfillTermsByLanguage({
      requestId,
      termType: "recall",
      terms: includesFiltered.filtered,
      languages: targetLanguages,
      atomicOnly: false,
    });
    const synonymsBackfill = await backfillTermsByLanguage({
      requestId,
      termType: "scoring",
      terms: synonymsFiltered.filtered,
      languages: targetLanguages,
      atomicOnly: true,
    });
    const excludesBackfill =
      excludesFiltered.filtered.length > 0
        ? await backfillTermsByLanguage({
            requestId,
            termType: "exclusion",
            terms: excludesFiltered.filtered,
            languages: targetLanguages,
            atomicOnly: true,
          })
        : {
            terms: excludesFiltered.filtered,
            addedCount: 0,
            applied: false,
            coverageBefore: computeLanguageCoverage(
              excludesFiltered.filtered,
              targetLanguages
            ),
            coverageAfter: computeLanguageCoverage(
              excludesFiltered.filtered,
              targetLanguages
            ),
            byLanguageCounts: Object.fromEntries(
              targetLanguages.map((language) => [language, 0])
            ),
            mode: "full_per_language" as const,
          };
    const usedTopicTerms = Array.from(new Set([...inputTopicTerms]));
    const filteredByLanguageCount =
      includesFiltered.removedCount +
      synonymsFiltered.removedCount +
      excludesFiltered.removedCount;
    const queryDiagnostics = [
      ...calibrationResult.diagnostics,
      ...hop2Result.diagnostics,
    ];
    const topicHitCountInSearch =
      calibrationResult.topicHitCount + hop2Result.topicHitCount;
    const recallOverSoftLimit = includesBackfill.terms.length > recallSoftLimit;
    const scoringOverSoftLimit = synonymsBackfill.terms.length > scoringSoftLimit;
    const exclusionOverSoftLimit =
      excludesBackfill.terms.length > exclusionSoftLimit;
    const recallWarning = recallOverSoftLimit
      ? `Recall terms exceed soft limit (${includesBackfill.terms.length}/${recallSoftLimit}); downstream collection cost may increase.`
      : null;
    const scoringWarning = scoringOverSoftLimit
      ? `Scoring terms exceed soft limit (${synonymsBackfill.terms.length}/${scoringSoftLimit}); scoring stability may degrade.`
      : null;
    const exclusionWarning = exclusionOverSoftLimit
      ? `Exclusion terms exceed soft limit (${excludesBackfill.terms.length}/${exclusionSoftLimit}); review precision impact.`
      : null;
    const specificityPool = new Set(normalizeTerms(nounPlan.secondaryNouns));
    const specificTermCount = discoveredAtomicTerms.filter(
      (term) => !specificityPool.has(term)
    ).length;
    const entitySpecificityScore =
      discoveredAtomicTerms.length > 0
        ? Number((specificTermCount / discoveredAtomicTerms.length).toFixed(2))
        : 0;

    logger.info("keyword derive completed", {
      requestId,
      name,
      provider: calibrationResult.provider ?? "none",
      degraded,
      reason: calibrationResult.reason,
      seedQueryCount: seedQueries.length,
      calibrationDocCount: mergedDocs.length,
      topicEnforced,
      topicHitCountInSearch,
      hop2Enabled: hop2Queries.length > 0,
      entitySpecificityScore,
      discoveredAtomicTermCount: discoveredAtomicTerms.length,
      includes: includesBackfill.terms.length,
      synonyms: synonymsBackfill.terms.length,
      excludes: excludesBackfill.terms.length,
      topicTerms: usedTopicTerms.length,
      filteredByLanguageCount,
      topicHintMissing,
      recallSoftLimit,
      recallOverSoftLimit,
      scoringSoftLimit,
      scoringOverSoftLimit,
      exclusionSoftLimit,
      exclusionOverSoftLimit,
    });

    const responsePayload = {
      includes: includesBackfill.terms,
      synonyms: synonymsBackfill.terms,
      excludes: excludesBackfill.terms,
      meta: {
        requestId,
        searchProvider: calibrationResult.provider ?? null,
        searchedProviders: calibrationResult.triedProviders,
        degraded,
        reason: calibrationResult.reason,
        primaryNoun: nounPlan.primaryNoun,
        secondaryNouns: nounPlan.secondaryNouns,
        seedQueries,
        seedQueriesByLanguage: multilingualSeed.byLanguage,
        seedQueryCount: seedQueries.length,
        queryPerLanguageLimit,
        queryDiagnostics,
        freshnessMode: "latest-first",
        calibrationDocCount: mergedDocs.length,
        recallSoftLimit,
        recallTermCount: includesBackfill.terms.length,
        recallOverSoftLimit,
        recallWarning,
        scoringSoftLimit,
        scoringTermCount: synonymsBackfill.terms.length,
        scoringOverSoftLimit,
        scoringWarning,
        exclusionSoftLimit,
        exclusionTermCount: excludesBackfill.terms.length,
        exclusionOverSoftLimit,
        exclusionWarning,
        extractionMode:
          mergedDocs.length > 0 ? "web_calibrated" : "fallback",
        topicEnforced,
        topicHitCountInSearch,
        hop2Enabled: hop2Queries.length > 0,
        entitySpecificityScore,
        discoveredAtomicTerms,
        languageCoverageBefore: {
          includes: includesBackfill.coverageBefore,
          synonyms: synonymsBackfill.coverageBefore,
          excludes: excludesBackfill.coverageBefore,
        },
        languageCoverageAfter: {
          includes: includesBackfill.coverageAfter,
          synonyms: synonymsBackfill.coverageAfter,
          excludes: excludesBackfill.coverageAfter,
        },
        termLanguageMatrix: {
          includes: includesBackfill.byLanguageCounts,
          synonyms: synonymsBackfill.byLanguageCounts,
          excludes: excludesBackfill.byLanguageCounts,
        },
        translationBackfillMode: "full_per_language",
        translationBackfillApplied:
          includesBackfill.applied ||
          synonymsBackfill.applied ||
          excludesBackfill.applied,
        translationAddedCount:
          includesBackfill.addedCount +
          synonymsBackfill.addedCount +
          excludesBackfill.addedCount,
        inputTopicTerms,
        usedTopicTerms,
        filteredByLanguageCount,
        topicHintMissing,
      },
    };
    writeWebDeriveIoLog({
      event: "derive-final-output",
      requestId,
      details: {
        provider: calibrationResult.provider ?? null,
        degraded,
        reason: calibrationResult.reason,
      },
      response: responsePayload,
    });
    return json(responsePayload);
  } catch (error) {
    return serverError(error);
  }
}
