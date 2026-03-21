import { llmGateway } from "@oak/agents/llm-gateway";
import { json, badRequest, serverError } from "@/app/api/_utils/http";
import { z } from "zod";

const DEFAULT_DERIVE_LANGUAGES = ["zh", "en"] as const;

const DeriveSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  includes: z.array(z.string()).optional(),
  excludes: z.array(z.string()).optional(),
  synonyms: z.array(z.string()).optional(),
  languages: z.array(z.string()).optional(),
  persistedLanguages: z.array(z.string()).optional(),
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
    } = parsed.data;
    const targetLanguages = mergeLanguagePreferences({
      languages,
      persistedLanguages,
      description,
    });

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

Please follow these constraints:
- Respect description constraints, including "include" and "exclude" intent.
- Generate terms in preferred languages.
- Keep terms short and searchable (1-4 words).
- Do not repeat existing terms.
- Avoid overlap: do not place the same term in both include/synonyms and excludes.
- Prefer high-signal terms; avoid generic words.

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

    return json(sanitizeDerivedResult(result));
  } catch (error) {
    return serverError(error);
  }
}
