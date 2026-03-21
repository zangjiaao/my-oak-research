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
const DEFAULT_RECALL_BUDGET = 8;
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
  recallBudget: z.number().int().min(6).max(12).optional(),
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

function normalizeTerms(values: string[]): string[] {
  const seen = new Set<string>();
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.toLowerCase())
    .filter((value) => (seen.has(value) ? false : (seen.add(value), true)));
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
    const searchQueries = normalizeTerms(response.searchQueries ?? []).slice(0, 4);
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

function buildSeedQueries(input: {
  primaryNoun: string;
  secondaryNouns: string[];
  searchQueries?: string[];
  topicTerms: string[];
}): string[] {
  const fromModel = normalizeTerms(input.searchQueries ?? []);
  if (fromModel.length > 0) {
    return fromModel.slice(0, 5);
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
  return normalizeTerms(combined).slice(0, 5);
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
  existingIncludes: string[],
  recallBudget: number
): string[] {
  const generated = normalizeTerms(
    discoveredAtomicTerms.map((term) => `${primaryNoun} ${term}`)
  );
  return normalizeTerms([...existingIncludes, ...generated]).slice(0, recallBudget);
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
- Keep only atomic noun terms related to the secondary nouns.
- Keep terms concrete and searchable.
- Exclude abstract interpretation phrases.
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
  query: string
): Promise<SearchCallResult> {
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
      12000
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
      max_results: 8,
      search_depth: "basic",
      topic: "general",
      include_answer: false,
      days: 30,
    });
    const response = await fetchJsonWithTimeout(
      url,
      {
        method,
        headers,
        body,
      },
      12000
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
    12000
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
  requestId: string
): Promise<{
  provider?: SearchProvider;
  docs: CalibrationDoc[];
  reason: CalibrationReason;
  triedProviders: SearchProvider[];
}> {
  const configuredProviders = providerOrder.filter((provider) =>
    isProviderConfigured(provider)
  );
  if (configuredProviders.length === 0) {
    return {
      docs: [],
      reason: "no_search_provider_configured",
      triedProviders: [],
    };
  }

  let hadRequestError = false;
  for (const provider of configuredProviders) {
    const docs: CalibrationDoc[] = [];
    for (const query of seedQueries) {
      try {
        const result = await searchWithProvider(provider, query);
        docs.push(...result.docs);
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
          details: { parsedCount: result.docs.length },
        });
      } catch (error) {
        hadRequestError = true;
        logger.warn("keyword derive calibration query failed", {
          provider,
          query,
          error: logger.normalizeError(error),
        });
        writeWebDeriveIoLog({
          event: "derive-search-request-response",
          requestId,
          provider,
          query,
          error: error instanceof Error ? error.message : "unknown error",
        });
      }
    }
    if (docs.length > 0) {
      return {
        provider,
        docs: docs.slice(0, 24),
        reason: null,
        triedProviders: configuredProviders,
      };
    }
  }
  return {
    docs: [],
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
      recallBudget = DEFAULT_RECALL_BUDGET,
      calibration,
    } = parsed.data;
    const targetLanguages = mergeLanguagePreferences({
      languages,
      persistedLanguages,
      description,
    });
    const inputTopicTerms = extractTopicTermsFromText(name, description);
    const nounPlan = await extractTopicNounPlan({
      name,
      description,
      topicTerms: inputTopicTerms,
      requestId,
    });
    const seedQueries = buildSeedQueries({
      primaryNoun: nounPlan.primaryNoun,
      secondaryNouns: nounPlan.secondaryNouns,
      searchQueries: nounPlan.searchQueries,
      topicTerms: inputTopicTerms,
    });
    const providerOrder = resolveSearchProviderOrder(process.env.SEARCH_ENGINE);
    const calibrationResult =
      calibration === false
        ? {
            docs: [] as CalibrationDoc[],
            provider: undefined as SearchProvider | undefined,
            reason: "calibration_disabled" as CalibrationReason,
            triedProviders: [] as SearchProvider[],
          }
        : await collectCalibrationDocs(seedQueries, providerOrder, requestId);
    const degraded =
      calibrationResult.reason === "no_search_provider_configured" ||
      calibrationResult.reason === "provider_request_failed";
    const discoveredAtomicTerms = await extractAtomicTermsFromDocs({
      name,
      description,
      docs: calibrationResult.docs,
      primaryNoun: nounPlan.primaryNoun,
      secondaryNouns: nounPlan.secondaryNouns,
      requestId,
    });
    const explicitExcludeIntent = hasExplicitExcludeIntent(description);
    const topicHintMissing = inputTopicTerms.length === 0;
    const recallBudgetNormalized = Math.min(12, Math.max(6, recallBudget));
    const finalExcludesRaw =
      explicitExcludeIntent || excludes.length > 0 ? normalizeTerms(excludes) : [];
    const exclusionSet = new Set(finalExcludesRaw);
    const recallTermsRaw = buildRecallTerms(
      nounPlan.primaryNoun,
      discoveredAtomicTerms,
      normalizeTerms(includes),
      recallBudgetNormalized
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
    const usedTopicTerms = Array.from(new Set([...inputTopicTerms]));
    const filteredByLanguageCount =
      includesFiltered.removedCount +
      synonymsFiltered.removedCount +
      excludesFiltered.removedCount;

    logger.info("keyword derive completed", {
      requestId,
      name,
      provider: calibrationResult.provider ?? "none",
      degraded,
      reason: calibrationResult.reason,
      seedQueryCount: seedQueries.length,
      calibrationDocCount: calibrationResult.docs.length,
      discoveredAtomicTermCount: discoveredAtomicTerms.length,
      includes: includesFiltered.filtered.length,
      synonyms: synonymsFiltered.filtered.length,
      excludes: excludesFiltered.filtered.length,
      topicTerms: usedTopicTerms.length,
      filteredByLanguageCount,
      topicHintMissing,
    });

    const responsePayload = {
      includes: includesFiltered.filtered,
      synonyms: synonymsFiltered.filtered,
      excludes: excludesFiltered.filtered,
      meta: {
        requestId,
        searchProvider: calibrationResult.provider ?? null,
        searchedProviders: calibrationResult.triedProviders,
        degraded,
        reason: calibrationResult.reason,
        primaryNoun: nounPlan.primaryNoun,
        secondaryNouns: nounPlan.secondaryNouns,
        seedQueries,
        freshnessMode: "latest-first",
        calibrationDocCount: calibrationResult.docs.length,
        recallBudget: recallBudgetNormalized,
        extractionMode:
          calibrationResult.docs.length > 0 ? "web_calibrated" : "fallback",
        discoveredAtomicTerms,
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
