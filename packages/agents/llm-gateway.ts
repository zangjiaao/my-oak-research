import { ZodType } from "zod";
import OpenAI from "openai";

type JsonRequest = {
  prompt: string;
  schema?: ZodType;
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
    const gatewayUrl =
      process.env.LLM_GATEWAY_URL ??
      process.env.LLM_GATEWAY_BASE_URL ??
      "https://api.llmgateway.io/v1";
    const apiKey = process.env.LLM_GATEWAY_API_KEY;
    let output: unknown;

    type ChatCompletionMessages = Parameters<
      OpenAI["chat"]["completions"]["create"]
    >[0]["messages"];

    if (gatewayUrl && apiKey) {
      const client = new OpenAI({ apiKey, baseURL: gatewayUrl });

      const composedMessage: ChatCompletionMessages = [
        {
          role: "user",
          content: [`Task: ${task}`, request.prompt]
            .filter(Boolean)
            .join("\n\n"),
        },
      ];

      const completion = await client.chat.completions.create({
        model: request.model ?? "gpt-5",
        messages: composedMessage as ChatCompletionMessages,
        temperature: request.temperature ?? 0.3,
      });

      const text =
        completion.choices?.[0]?.message?.content?.trim() ??
        completion.choices?.[0]?.message?.content ??
        "";

      if (text) {
        try {
          output = JSON.parse(text);
        } catch {
          output = text;
        }
      } else {
        output = text;
      }
    } else {
      output = {
        summary: DEFAULT_LLMSUMMARY(request.prompt),
        relevance: true,
      };
    }

    if (request.schema) {
      return request.schema.parse(output) as T;
    }
    return output as T;
  },
};
