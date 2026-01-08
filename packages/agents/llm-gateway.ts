import { generateObject, generateText } from "ai";
import { openai, deepseek, google, defaultModel } from "./provider";

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

    const prompt = [`Task: ${task}`, request.prompt]
      .filter(Boolean)
      .join("\n\n");

    const isReasoningModel =
      modelId.startsWith("o1-") ||
      modelId === "o1" ||
      modelId.includes("gpt-5") ||
      modelId.includes("reasoner");

    const temperature = isReasoningModel ? undefined : (request.temperature ?? 0.3);

    try {
      // 1. 如果是 DeepSeek 模型，绕过 AI SDK 直接使用 fetch 调用（解决协议错乱和 404 问题）
      if (modelId.toLowerCase().includes("deepseek")) {
        const apiKey = process.env.DEEPSEEK_API_KEY;
        const baseURL = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/v1\/?$/, '');

        console.log(`[llm-gateway] Direct fetch to DeepSeek: ${baseURL}/v1/chat/completions`);

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
            response_format: { type: "json_object" }
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(`DeepSeek API Error: ${response.status} ${JSON.stringify(errorData)}`);
        }

        const data = await response.json();
        const text = data.choices[0].message.content;

        try {
          const cleanedText = text.replace(/```json\n?|\n?```/g, "").trim();
          return JSON.parse(cleanedText) as T;
        } catch (e) {
          console.error("[llm-gateway] Failed to parse DeepSeek direct response:", text);
          throw new Error("DeepSeek response was not valid JSON");
        }
      }

      // 2. 如果提供了 Schema 且不是特殊模型，使用 generateObject
      else if (request.schema) {
        const result = await generateObject({
          model: modelInstance,
          schema: request.schema,
          messages: [{ role: "user", content: prompt }],
          temperature,
          output: "object",
        });
        return result.object as T;
      }

      // 3. 其他情况使用 generateText 并手动解析
      else {
        const { text } = await generateText({
          model: modelInstance,
          messages: [{ role: "user", content: prompt }],
          temperature,
        });

        try {
          const cleanedText = text.replace(/```json\n?|\n?```/g, "").trim();
          return JSON.parse(cleanedText) as T;
        } catch (e) {
          return text as unknown as T;
        }
      }
    } catch (error: any) {
      console.error(`[llm-gateway] Error in LLM task "${task}" (Model: ${modelId}):`);
      console.error(`- Message: ${error.message}`);
      console.error(`- Name: ${error.name}`);
      if (error.status) console.error(`- Status: ${error.status}`);
      if (error.data) console.error(`- Data: ${JSON.stringify(error.data)}`);
      throw error;
    }
  },
};
