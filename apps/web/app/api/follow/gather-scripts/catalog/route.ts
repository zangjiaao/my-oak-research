import { z } from "zod";

import { badRequest, json, serverError } from "@/app/api/_utils/http";

const QuerySchema = z.object({
  platform: z.string().trim().optional(),
});

type GatherCatalogItem = {
  key: string;
  platform: string;
  intent: string;
  mode: string;
  runtimePath?: string;
  sample?: {
    intentType?: string;
    intentArgs?: Record<string, unknown>;
    outputField?: unknown;
  };
};

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const parsed = QuerySchema.safeParse(Object.fromEntries(searchParams.entries()));
    if (!parsed.success) {
      return badRequest("Invalid query parameters", z.flattenError(parsed.error));
    }

    const gatherUrl = process.env.GATHER_SERVICE_URL || "http://localhost:8000";
    const response = await fetch(`${gatherUrl}/v1/scripts/catalog`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      const text = await response.text();
      return badRequest("Failed to fetch gather scripts catalog", {
        status: response.status,
        body: text,
      });
    }

    const payload = await response.json();
    const items = Array.isArray(payload?.items)
      ? (payload.items as GatherCatalogItem[])
      : [];
    const platform = parsed.data.platform?.toUpperCase();
    const filteredItems = platform
      ? items.filter((item) => item.platform?.toUpperCase() === platform)
      : items;

    const grouped = new Map<string, Set<string>>();
    for (const item of filteredItems) {
      const name = (item.platform || "").toUpperCase();
      if (!name) continue;
      const intents = grouped.get(name) ?? new Set<string>();
      if (item.intent) intents.add(item.intent);
      grouped.set(name, intents);
    }

    const platforms = Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, intents]) => ({
        platform: name,
        intents: Array.from(intents).sort((a, b) => a.localeCompare(b)),
      }));

    return json({
      total: filteredItems.length,
      items: filteredItems,
      platforms,
    });
  } catch (error) {
    return serverError(error);
  }
}
