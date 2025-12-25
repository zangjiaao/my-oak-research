import { generateObject, generateText } from "ai";
import { openai, defaultModel, apiKey } from "./provider";

type JsonRequest = {
  prompt: string;
  schema?: any; // Using 'any' to avoid "Type instantiation is excessively deep" error with AI SDK
  model?: string;
  temperature?: number;
  metadata?: Record<string, unknown>;
};

const DEFAULT_LLMSUMMARY = (prompt: string) => {
  const snippet = prompt
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .slice(0, 3)
    .join(" ");
  return snippet.slice(0, 200);
};

export const llmGateway = {
  async json<T>(task: string, request: JsonRequest): Promise<T> {
    const modelId = request.model ?? defaultModel;
    console.log(`[llm-gateway] task=${task} model=${modelId}`);

    if (!apiKey) {
      console.warn("[llm-gateway] No API key found, returning default summary");
      return {
        summary: DEFAULT_LLMSUMMARY(request.prompt),
        relevance: true,
      } as unknown as T;
    }

    const prompt = [`Task: ${task}`, request.prompt]
      .filter(Boolean)
      .join("\n\n");

    try {
      if (request.schema) {
        const result = await generateObject({
          model: openai(modelId),
          schema: request.schema,
          prompt,
          temperature: request.temperature ?? 0.3,
          // Use 'object' output to ensure structured data
          output: "object",
        });
        return result.object as T;
      } else {
        const { text } = await generateText({
          model: openai(modelId),
          prompt,
          temperature: request.temperature ?? 0.3,
        });

        try {
          // Attempt to parse JSON if no schema was provided but it looks like JSON
          const cleanedText = text
            .replace(/```json\s*/g, "")
            .replace(/```$/g, "")
            .trim();
          return JSON.parse(cleanedText) as T;
        } catch {
          return text as unknown as T;
        }
      }
    } catch (error: any) {
      console.error(`[llm-gateway] Error in LLM task "${task}":`, error.message);
      throw error;
    }
  },
};
