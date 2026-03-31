import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

// 1. OpenAI Provider
export const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY?.trim(),
  baseURL: process.env.OPEN_API_BASE_URL || 'https://api.openai.com/v1',
});

// 2. DeepSeek Provider (OpenAI Compatible)
const deepseekApiKey = process.env.DEEPSEEK_API_KEY?.trim();
if (!deepseekApiKey) {
  console.warn("[provider] DEEPSEEK_API_KEY is missing!");
}
const deepseekBaseURL = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/v1\/?$/, '');

export const deepseek = createOpenAI({
  apiKey: deepseekApiKey,
  baseURL: `${deepseekBaseURL}/v1`,
});

// 3. DashScope (Qwen / Bailian, OpenAI Compatible)
const dashscopeApiKey = process.env.DASHSCOPE_API_KEY?.trim();
const dashscopeBaseURL =
  process.env.DASHSCOPE_BASE_URL?.trim() ||
  "https://dashscope.aliyuncs.com/compatible-mode/v1";

export const dashscope = createOpenAI({
  apiKey: dashscopeApiKey,
  baseURL: dashscopeBaseURL,
});

// 4. Google Gemini Provider
export const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim(),
});


// Default configuration
export const defaultModel = process.env.LLM_DEFAULT_MODEL?.trim() || "gpt-4o";
