import { llmGateway } from "@oak/agents/llm-gateway";
import { json, badRequest, serverError } from "@/app/api/_utils/http";
import { logger } from "@/lib/logger";
import { z } from "zod";

const DEFAULT_DERIVE_LANGUAGES = ["zh", "en"] as const;
const DEFAULT_RECALL_BUDGET = 8;
const DEFAULT_SEARCH_ENGINE = "auto";

type SearchProvider = "anspire" | "tavily" | "parallel";
type CalibrationDoc = {
  title: string;
  snippet: string;
  url?: string;
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

function resolveSearchProviderOrder(rawPreference: string | undefined): SearchProvider[] {
  const normalized = String(rawPreference ?? DEFAULT_SEARCH_ENGINE)
    .trim()
    .toLowerCase();
  if (normalized === "anspire") return ["anspire"];
  if (normalized === "tavily") return ["tavily"];
  if (normalized === "parallel") return ["parallel"];
  return ["anspire", "tavily", "parallel"];
}

function buildSeedQueries(name: string, description?: string | null): string[] {
  const normalizedName = name.replace(/\s+/g, " ").trim();
  const normalizedDescription = (description ?? "").replace(/\s+/g, " ").trim();
  const candidates = [
    normalizedName,
    normalizedDescription
      ? `${normalizedName} ${normalizedDescription.slice(0, 28)}`
      : "",
    `${normalizedName} 别名 俗称`,
    `${normalizedName} alias nickname`,
  ];
  return Array.from(new Set(candidates.map((item) => item.trim()).filter(Boolean))).slice(0, 3);
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
): Promise<unknown> {
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
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function searchWithProvider(
  provider: SearchProvider,
  query: string
): Promise<CalibrationDoc[]> {
  if (provider === "anspire") {
    const apiKey = process.env.ANSPIRE_API_KEY;
    if (!apiKey) throw new Error("ANSPIRE_API_KEY missing");
    const params = new URLSearchParams({ query, top_k: "8" });
    const payload = await fetchJsonWithTimeout(
      `${SEARCH_PROVIDER_ENDPOINTS.anspire}?${params.toString()}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      },
      12000
    );
    return normalizeCalibrationDocs(payload);
  }

  if (provider === "tavily") {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) throw new Error("TAVILY_API_KEY missing");
    const payload = await fetchJsonWithTimeout(
      SEARCH_PROVIDER_ENDPOINTS.tavily,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          max_results: 8,
          search_depth: "basic",
          topic: "general",
          include_answer: false,
        }),
      },
      12000
    );
    return normalizeCalibrationDocs(payload);
  }

  const apiKey = process.env.PARALLEL_API_KEY;
  if (!apiKey) throw new Error("PARALLEL_API_KEY missing");
  const payload = await fetchJsonWithTimeout(
    SEARCH_PROVIDER_ENDPOINTS.parallel,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        mode: "one-shot",
        objective: query,
        search_queries: [query],
        max_results: 8,
        excerpts: {
          max_chars_per_result: 900,
          max_chars_total: 8000,
        },
      }),
    },
    12000
  );
  return normalizeCalibrationDocs(payload);
}

async function collectCalibrationDocs(
  seedQueries: string[],
  providerOrder: SearchProvider[]
): Promise<{ provider?: SearchProvider; docs: CalibrationDoc[] }> {
  for (const provider of providerOrder) {
    const docs: CalibrationDoc[] = [];
    for (const query of seedQueries) {
      try {
        const rows = await searchWithProvider(provider, query);
        docs.push(...rows);
      } catch (error) {
        logger.warn("keyword derive calibration query failed", {
          provider,
          query,
          error: logger.normalizeError(error),
        });
      }
    }
    if (docs.length > 0) {
      return { provider, docs: docs.slice(0, 24) };
    }
  }
  return { docs: [] };
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
  };
}

export async function POST(req: Request) {
  try {
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
        ? { docs: [] as CalibrationDoc[], provider: undefined as SearchProvider | undefined }
        : await collectCalibrationDocs(seedQueries, providerOrder);
    const calibrationContext = toCalibrationContext(calibrationResult.docs);

    const task = "keyword-derivation";
    const prompt = `
You are a multilingual keyword strategist.
Your goal is to generate three sets of terms for a topic:
1) Recall Terms for broader retrieval;
2) Scoring Terms for semantic evidence;
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

Calibration evidence (Chinese-first web snippets):
${calibrationContext}

Please follow these constraints:
- Respect description constraints, including "include" and "exclude" intent.
- Generate terms in preferred languages.
- Keep terms short and searchable (1-4 words).
- Do not repeat existing terms.
- Avoid overlap: do not place the same term in both include/synonyms and excludes.
- Prefer high-signal terms; avoid generic words.
- Recall Terms should be concise and cost-aware. Avoid bulk translated variants.
- If evidence reveals community aliases (example: slang / nickname), prioritize them in Recall Terms.

Requirements:
- Return ONLY a JSON object:
{
  "includes": ["..."],
  "synonyms": ["..."],
  "excludes": ["..."]
}
- includes: 6-24 terms
- synonyms: 6-24 terms
- excludes: 3-16 terms

`;

    const result = await llmGateway.json<z.infer<typeof DeriveResultSchema>>(
      task,
      {
      prompt,
      schema: DeriveResultSchema,
      temperature: 0.5,
      }
    );

    const sanitized = sanitizeDerivedResult(result);
    const includesBudgeted = sanitized.includes.slice(
      0,
      Math.min(12, Math.max(6, recallBudget))
    );

    logger.info("keyword derive completed", {
      name,
      provider: calibrationResult.provider ?? "none",
      seedQueryCount: seedQueries.length,
      calibrationDocCount: calibrationResult.docs.length,
      includes: includesBudgeted.length,
      synonyms: sanitized.synonyms.length,
      excludes: sanitized.excludes.length,
    });

    return json({
      includes: includesBudgeted,
      synonyms: sanitized.synonyms,
      excludes: sanitized.excludes,
      meta: {
        searchProvider: calibrationResult.provider ?? null,
        seedQueries,
        calibrationDocCount: calibrationResult.docs.length,
        recallBudget: Math.min(12, Math.max(6, recallBudget)),
      },
    });
  } catch (error) {
    return serverError(error);
  }
}
