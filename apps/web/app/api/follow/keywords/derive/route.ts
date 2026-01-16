import { llmGateway } from "@oak/agents/llm-gateway";
import { json, badRequest, serverError } from "@/app/api/_utils/http";
import { z } from "zod";

const DeriveSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  includes: z.array(z.string()).optional(),
  lang: z.string().optional().default("auto"),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = DeriveSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid payload", parsed.error.format());
    }

    const { name, description, includes = [], lang } = parsed.data;

    const task = "keyword-derivation";
    const prompt = `
You are a keyword expansion expert. Your goal is to provide a comprehensive list of synonyms, related terms, and translations for a given topic to improve search coverage.

Topic Name: ${name}
Description: ${description || "N/A"}
Existing Keywords: ${includes.join(", ")}
Target Language Sensitivity: ${lang}

Please generate:
1. Synonyms in the primary language.
2. Translations in English, Chinese (Simplified/Traditional), and Japanese if not already present.
3. Related terms that are conceptually similar but use different wording.
4. Common misspellings or variations if applicable.

Requirements:
- Return ONLY a JSON object with a "keywords" field which is an array of strings.
- Each keyword should be concise (1-3 words).
- Exclude the original topic name and existing keywords from the list.
- Aim for 10-20 high-quality variations.

Example response:
{
  "keywords": ["variation1", "translation1", "synonym1"]
}
`;

    const result = await llmGateway.json<{ keywords: string[] }>(task, {
      prompt,
      temperature: 0.5,
    });

    return json({ keywords: result?.keywords || [] });
  } catch (error) {
    return serverError(error);
  }
}
