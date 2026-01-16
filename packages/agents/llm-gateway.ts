import { generateObject, generateText } from "ai";
import { openai, deepseek, google, defaultModel } from "./provider";

type JsonRequest = {
  prompt: string;
  schema?: any; // Using 'any' to avoid "Type instantiation is excessively deep" error with AI SDK
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
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

/**
 * Logic to decide which provider to use based on the model name.
 */
function getModelInstance(modelId: string) {
  const lower = modelId.toLowerCase();

  // 1. Google Gemini
  if (lower.includes("gemini")) {
    return google(modelId);
  }

  // 2. DeepSeek
  if (lower.includes("deepseek")) {
    return deepseek(modelId);
  }

  // 3. OpenAI (Default)
  return openai(modelId);
}

export const llmGateway = {
  async json<T>(task: string, request: JsonRequest): Promise<T> {
    const modelId = request.model ?? defaultModel;
    console.log(`[llm-gateway] task=${task} model=${modelId}`);

    const modelInstance = getModelInstance(modelId);
    const prompt = [`Task: ${task}`, request.prompt].filter(Boolean).join("\n\n");

    const isReasoningModel =
      modelId.startsWith("o1-") ||
      modelId === "o1" ||
      modelId.includes("gpt-5") ||
      modelId.includes("reasoner");

    const temperature = isReasoningModel ? undefined : (request.temperature ?? 0.3);

    let rawText = "";

    try {
      // 1. DeepSeek Direct Fetch
      if (modelId.toLowerCase().includes("deepseek")) {
        const apiKey = process.env.DEEPSEEK_API_KEY;
        const baseURL = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/v1\/?$/, "");

        const response = await fetch(`${baseURL}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: modelId,
            messages: [{ role: "user", content: prompt + "\n\nPlease respond in JSON format." }],
            temperature: temperature ?? 1.0,
            max_tokens: request.maxOutputTokens ?? 8192,
            response_format: { type: "json_object" },
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(`DeepSeek API Error: ${response.status} ${JSON.stringify(errorData)}`);
        }

        const data = await response.json();
        rawText = data.choices[0].message.content;
      }
      // 2. Standard AI SDK calls
      else {
        const { text } = await generateText({
          model: modelInstance,
          messages: [{ role: "user", content: prompt + (request.schema ? "\n\nCRITICAL: You MUST respond with a valid JSON object matching the requested schema." : "") }],
          temperature,
          maxOutputTokens: request.maxOutputTokens ?? 8192,
        });
        rawText = text;
      }

      // Cleanup and Parse JSON
      try {
        const cleanedText = rawText.replace(/```json\n?|\n?```/g, "").trim();
        return JSON.parse(cleanedText) as T;
      } catch (parseError) {
        // If it's not valid JSON but we expected an object, try to wrap it as a REPLY
        console.warn("[llm-gateway] LLM output is not valid JSON, attempting to wrap as REPLY action.");
        if (typeof rawText === "string" && rawText.length > 0) {
          return {
            action: "REPLY",
            reply: rawText,
            report: null,
          } as unknown as T;
        }
        throw parseError;
      }
    } catch (error: any) {
      console.error(`[llm-gateway] Error in LLM task "${task}" (Model: ${modelId}):`);
      console.error(`- Message: ${error.message}`);
      if (error.status) console.error(`- Status: ${error.status}`);
      throw error;
    }
  },
};
