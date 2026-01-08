import { NextResponse } from "next/server";
import { openai, deepseek } from "@oak/agents/provider";

export const dynamic = "force-dynamic";

export async function GET() {
  const models: Array<{ id: string; provider: string; name: string }> = [];

  try {
    // 1. Fetch OpenAI Models
    if (process.env.OPENAI_API_KEY) {
      try {
        const res = await fetch(`${process.env.OPEN_API_BASE_URL || "https://api.openai.com/v1"}/models`, {
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
        });
        if (res.ok) {
          const data = await res.json();
          const filtered = data.data
            .filter((m: any) => m.id.startsWith("gpt-") || m.id.startsWith("o1-") || m.id === "o1")
            .map((m: any) => ({
              id: m.id,
              provider: "openai",
              name: m.id
            }));
          models.push(...filtered);
        }
      } catch (e) {
        console.error("[api/llm/models] OpenAI fetch failed", e);
      }
    }

    // 2. Fetch DeepSeek Models
    if (process.env.DEEPSEEK_API_KEY) {
      try {
        const res = await fetch(`${(process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/v1\/?$/, "")}/v1/models`, {
          headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` }
        });
        if (res.ok) {
          const data = await res.json();
          const filtered = data.data.map((m: any) => ({
            id: m.id,
            provider: "deepseek",
            name: `${m.id} (DeepSeek)`
          }));
          models.push(...filtered);
        }
      } catch (e) {
        console.error("[api/llm/models] DeepSeek fetch failed", e);
      }
    }

    // 3. Google Gemini Models
    if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      try {
        const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        if (res.ok) {
          const data = await res.json();
          // 过滤支持 generateContent 的模型
          const filtered = data.models
            .filter((m: any) => m.supportedGenerationMethods.includes("generateContent"))
            .map((m: any) => ({
              id: m.name.replace("models/", ""), // 将 "models/gemini-1.5-flash" 转换为 "gemini-1.5-flash"
              provider: "google",
              name: m.displayName || m.name.replace("models/", "")
            }));
          models.push(...filtered);
        }
      } catch (e) {
        console.error("[api/llm/models] Google Gemini fetch failed", e);
      }
    }

    // Deduplicate and fallback
    if (models.length === 0) {
      models.push({ id: "gpt-4o", provider: "openai", name: "gpt-4o (Default)" });
    }

    return NextResponse.json({ models });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
