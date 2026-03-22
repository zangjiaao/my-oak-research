import { z } from "zod";

import { badRequest, json, serverError } from "@/app/api/_utils/http";
import {
  type SourceCapability,
  buildGatherCapabilities,
  buildWorkerApiCapabilities,
} from "@/lib/source-capabilities";

const QuerySchema = z.object({
  platform: z.string().trim().optional(),
  category: z.enum(["STREAM", "INTERACTIVE", "RETRIEVAL"]).optional(),
  executionEngine: z.enum(["gather_playwright", "worker_api"]).optional(),
});

type GatherCatalogItem = {
  key: string;
  platform: string;
  intent: string;
  mode: string;
  sample?: {
    intentType?: string;
    intentArgs?: Record<string, unknown>;
    outputField?: unknown;
  };
};

function mergeCapabilities(input: {
  gather: SourceCapability[];
  worker: SourceCapability[];
}): SourceCapability[] {
  const gatherPlatformSet = new Set(
    input.gather.map((item) => item.platform.toUpperCase())
  );
  const workerFiltered = input.worker.filter(
    (item) => !gatherPlatformSet.has(item.platform.toUpperCase())
  );
  return [...input.gather, ...workerFiltered].sort((a, b) =>
    a.platform.localeCompare(b.platform)
  );
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const parsed = QuerySchema.safeParse(Object.fromEntries(searchParams.entries()));
    if (!parsed.success) {
      return badRequest("Invalid query parameters", z.flattenError(parsed.error));
    }

    const gatherUrl = process.env.GATHER_SERVICE_URL || "http://localhost:8000";
    let gatherItems: GatherCatalogItem[] = [];
    try {
      const response = await fetch(`${gatherUrl}/v3/scripts/catalog`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (response.ok) {
        const payload = await response.json();
        gatherItems = Array.isArray(payload?.items)
          ? (payload.items as GatherCatalogItem[])
          : [];
      }
    } catch {
      gatherItems = [];
    }

    const all = mergeCapabilities({
      gather: buildGatherCapabilities(gatherItems),
      worker: buildWorkerApiCapabilities(),
    });
    const platform = parsed.data.platform?.toUpperCase();

    const items = all.filter((item) => {
      if (platform && item.platform.toUpperCase() !== platform) return false;
      if (parsed.data.category && item.category !== parsed.data.category) return false;
      if (
        parsed.data.executionEngine &&
        item.execution.engine !== parsed.data.executionEngine
      ) {
        return false;
      }
      return true;
    });

    return json({
      total: items.length,
      items,
    });
  } catch (error) {
    return serverError(error);
  }
}

