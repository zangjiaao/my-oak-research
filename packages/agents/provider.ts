import { createOpenAI } from "@ai-sdk/openai";

export const apiKey = (
  process.env.OPENAI_API_KEY
)?.trim();

export const baseURL = process.env.OPEN_API_BASE_URL || 'https://api.openai.com/v1';

export const openai = createOpenAI({
  apiKey,
  baseURL,
});

export const defaultModel = process.env.LLM_DEFAULT_MODEL?.trim() || "gpt-4o";
