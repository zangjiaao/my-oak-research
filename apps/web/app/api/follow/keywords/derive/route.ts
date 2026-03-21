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
type ExtractedObject = {
  name: string;
  aliases: string[];
  category: "product" | "module" | "organization" | "location" | "country" | "person" | "concept" | "other";
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

const DeriveResultSchema = z.object({
  includes: z.array(z.string()).default([]),
  synonyms: z.array(z.string()).default([]),
  excludes: z.array(z.string()).default([]),
  topicTerms: z.array(z.string()).optional().default([]),
});
const ObjectExtractionResultSchema = z.object({
  objects: z
    .array(
      z.object({
        name: z.string().min(1),
        aliases: z.array(z.string()).optional().default([]),
        category: z
          .enum([
            "product",
            "module",
            "organization",
            "location",
            "country",
            "person",
            "concept",
            "other",
          ])
          .optional()
          .default("other"),
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

function buildSeedQueries(name: string, description?: string | null): string[] {
  const topicTerms = extractTopicTermsFromText(name, description);
  if (topicTerms.length > 0) {
    return topicTerms.slice(0, 3);
  }
  const normalizedName = name.replace(/#/g, " ").replace(/\s+/g, " ").trim();
  return normalizedName ? [normalizedName] : [];
}

function hasExplicitExcludeIntent(description?: string | null): boolean {
  const text = String(description ?? "").toLowerCase();
  return /(排除|不要|不包含|剔除|exclude|excluding|without|not include|avoid)/i.test(
    text
  );
}

function normalizeObjectList(rawObjects: z.infer<typeof ObjectExtractionResultSchema>["objects"]): ExtractedObject[] {
  const seen = new Set<string>();
  const normalized: ExtractedObject[] = [];
  for (const rawObject of rawObjects) {
    const name = rawObject.name.trim().toLowerCase();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const aliases = normalizeTerms(rawObject.aliases ?? []).filter(
      (alias) => alias !== name
    );
    normalized.push({
      name,
      aliases,
      category: rawObject.category ?? "other",
    });
  }
  return normalized;
}

function buildObjectTermHints(
  topicAnchors: string[],
  objects: ExtractedObject[]
): { recallHints: string[]; scoringHints: string[] } {
  const objectTerms = normalizeTerms(
    objects.flatMap((item) => [item.name, ...item.aliases])
  );
  const recallHints = normalizeTerms(
    topicAnchors.flatMap((topic) =>
      objectTerms
        .filter((term) => term !== topic)
        .map((term) => `${topic} ${term}`)
    )
  );
  return {
    recallHints,
    scoringHints: objectTerms,
  };
}

async function extractObjectsFromDocs(input: {
  name: string;
  description?: string | null;
  docs: CalibrationDoc[];
  requestId: string;
}): Promise<ExtractedObject[]> {
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
You extract concrete investigation objects from web snippets.
Topic: ${input.name}
Description: ${input.description ?? "N/A"}

Evidence:
${evidence}

Return ONLY JSON:
{
  "objects": [
    { "name": "...", "aliases": ["..."], "category": "product|module|organization|location|country|person|concept|other" }
  ]
}

Rules:
- Keep only concrete entities explicitly supported by evidence.
- Favor tools/modules/products/organizations/locations/countries involved in the topic.
- Include short aliases when clearly present (example: nickname or acronym).
- Avoid generic words with no retrieval value.
- Max 20 objects.
`;
  try {
    const result = await llmGateway.json<
      z.infer<typeof ObjectExtractionResultSchema>
    >("keyword-object-extraction", {
      prompt,
      schema: ObjectExtractionResultSchema,
      temperature: 0.2,
      metadata: { requestId: input.requestId },
    });
    writeWebDeriveIoLog({
      event: "derive-llm-request-response",
      requestId: input.requestId,
      request: {
        task: "keyword-object-extraction",
        prompt,
        temperature: 0.2,
      },
      response: result,
    });
    return normalizeObjectList(result.objects).slice(0, 20);
  } catch (error) {
    logger.warn("keyword object extraction failed", {
      requestId: input.requestId,
      error: logger.normalizeError(error),
    });
    writeWebDeriveIoLog({
      event: "derive-llm-request-response",
      requestId: input.requestId,
      request: {
        task: "keyword-object-extraction",
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
  if (provider === "anspire") {
    const apiKey = process.env.ANSPIRE_API_KEY;
    if (!apiKey) throw new Error("ANSPIRE_API_KEY missing");
    const params = new URLSearchParams({ query, top_k: "8" });
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
      query,
      max_results: 8,
      search_depth: "basic",
      topic: "general",
      include_answer: false,
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
    objective: query,
    search_queries: [query],
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

function toCalibrationContext(docs: CalibrationDoc[]): string {
  if (docs.length === 0) return "No calibration docs";
  return docs
    .slice(0, 18)
    .map((doc, index) => {
      const title = doc.title || "(untitled)";
      const snippet = doc.snippet || "(no snippet)";
      return `${index + 1}. title: ${title}\n   snippet: ${snippet}\n   url: ${doc.url ?? "-"}`;
    })
    .join("\n");
}

function sanitizeDerivedResult(input: z.infer<typeof DeriveResultSchema>) {
  const includes = normalizeTerms(input.includes);
  const synonyms = normalizeTerms(input.synonyms);
  const excludes = normalizeTerms(input.excludes);
  const excludeSet = new Set(excludes);
  const cleanedIncludes = includes.filter((item) => !excludeSet.has(item));
  const cleanedSynonyms = synonyms.filter(
    (item) => !excludeSet.has(item) && !cleanedIncludes.includes(item)
  );
  return {
    includes: cleanedIncludes,
    synonyms: cleanedSynonyms,
    excludes,
    topicTerms: normalizeTerms(input.topicTerms ?? []),
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
      lang,
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
    const seedQueries = buildSeedQueries(name, description);
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
    const calibrationContext = toCalibrationContext(calibrationResult.docs);
    const degraded =
      calibrationResult.reason === "no_search_provider_configured" ||
      calibrationResult.reason === "provider_request_failed";
    const inputTopicTerms = extractTopicTermsFromText(name, description);
    const topicAnchors = seedQueries.length > 0 ? seedQueries : inputTopicTerms;
    const extractedObjects = await extractObjectsFromDocs({
      name,
      description,
      docs: calibrationResult.docs,
      requestId,
    });
    const objectHints = buildObjectTermHints(topicAnchors, extractedObjects);
    const explicitExcludeIntent = hasExplicitExcludeIntent(description);
    const topicHintMissing = inputTopicTerms.length === 0;

    const task = "keyword-derivation";
    const prompt = `
You are a multilingual keyword strategist.
Your goal is to generate three sets of terms for a topic:
1) Recall Terms for broader retrieval (search execution terms);
2) Scoring Terms for relevance evidence terms;
3) Exclusion Terms for noisy or ambiguous matches.

Topic Name: ${name}
Description: ${description || "N/A"}
Existing Recall Terms: ${includes.join(", ")}
Existing Scoring Terms: ${synonyms.join(", ")}
Existing Exclusion Terms: ${excludes.join(", ")}
Target Language Sensitivity: ${lang}
Preferred Languages: ${targetLanguages.join(", ")}
Recall Terms budget: ${Math.min(12, Math.max(6, recallBudget))}
Search calibration provider: ${calibrationResult.provider ?? "none"}
Seed queries: ${seedQueries.join(" | ")}
User provided topic terms: ${inputTopicTerms.join(", ") || "none"}
Topic anchors in use: ${topicAnchors.join(", ") || "none"}
Explicit exclude intent in description: ${explicitExcludeIntent ? "yes" : "no"}

Calibration evidence (Chinese-first web snippets):
${calibrationContext}

Extracted investigation objects from evidence:
${extractedObjects
  .map((item) => `- ${item.name} (${item.category}) aliases: ${item.aliases.join(", ") || "-"}`)
  .join("\n") || "- none"}

Object-driven Recall candidates:
${objectHints.recallHints.join(" | ") || "none"}

Object-driven Scoring candidates:
${objectHints.scoringHints.join(" | ") || "none"}

Please follow these constraints:
- First map evidence => objects => terms. Avoid template-like suffix expansion.
- Respect description constraints, including "include" and "exclude" intent.
- Generate terms in preferred languages.
- Keep terms short and searchable (1-4 words).
- Do not repeat existing terms.
- Avoid overlap: do not place the same term in both include/synonyms and excludes.
- Prefer high-signal terms; avoid generic words.
- Recall Terms should be concise and cost-aware. Prefer object-centric phrases useful for direct search.
- If evidence reveals community aliases (example: slang / nickname), prioritize them in Recall Terms.
- Keep topic terms focused. You can add at most 2 high-confidence topic terms in "topicTerms".
- Exclusion Terms should default to empty unless user description or existing exclusions clearly require them.

Requirements:
- Return ONLY a JSON object:
{
  "includes": ["..."],
  "synonyms": ["..."],
  "excludes": ["..."],
  "topicTerms": ["..."]
}
- includes: 6-24 terms
- synonyms: 6-24 terms
- excludes: 3-16 terms
- topicTerms: 0-2 terms

`;

    const result = await llmGateway.json<z.infer<typeof DeriveResultSchema>>(
      task,
      {
        prompt,
        schema: DeriveResultSchema,
        temperature: 0.5,
        metadata: { requestId },
      }
    );
    writeWebDeriveIoLog({
      event: "derive-llm-request-response",
      requestId,
      request: {
        task,
        prompt,
        temperature: 0.5,
      },
      response: result,
      details: {
        model: process.env.LLM_DEFAULT_MODEL ?? "unknown",
      },
    });

    const sanitized = sanitizeDerivedResult(result);
    const recallBudgetNormalized = Math.min(12, Math.max(6, recallBudget));
    const includesBudgeted = normalizeTerms([
      ...objectHints.recallHints,
      ...sanitized.includes,
    ]).slice(0, recallBudgetNormalized);
    const synonymsEnriched = normalizeTerms([
      ...objectHints.scoringHints,
      ...sanitized.synonyms,
    ]);
    const finalExcludesRaw =
      explicitExcludeIntent || excludes.length > 0 ? sanitized.excludes : [];
    const exclusionSet = new Set(finalExcludesRaw);
    const includesWithoutExclusion = includesBudgeted.filter(
      (item) => !exclusionSet.has(item)
    );
    const synonymsWithoutExclusion = synonymsEnriched.filter(
      (item) => !exclusionSet.has(item) && !includesWithoutExclusion.includes(item)
    );
    const includesFiltered = filterTermsByLanguages(
      includesWithoutExclusion,
      targetLanguages
    );
    const synonymsFiltered = filterTermsByLanguages(
      synonymsWithoutExclusion,
      targetLanguages
    );
    const excludesFiltered = filterTermsByLanguages(
      finalExcludesRaw,
      targetLanguages
    );
    const addedTopicTerms = sanitized.topicTerms
      .filter((term) => !inputTopicTerms.includes(term))
      .slice(0, 2);
    const usedTopicTerms = Array.from(
      new Set([...inputTopicTerms, ...addedTopicTerms])
    );
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
      extractedObjectCount: extractedObjects.length,
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
        seedQueries,
        topicAnchorsUsed: topicAnchors,
        calibrationDocCount: calibrationResult.docs.length,
        recallBudget: recallBudgetNormalized,
        extractionMode: calibrationResult.docs.length > 0 ? "web_calibrated" : "fallback",
        objectCount: extractedObjects.length,
        extractedObjects,
        inputTopicTerms,
        addedTopicTerms,
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
