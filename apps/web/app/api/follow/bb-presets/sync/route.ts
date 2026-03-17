import { z } from "zod";

import prisma from "@/lib/prisma";
import { bbPresetSyncQueue, bbPresetSyncQueueEvents } from "@/lib/queue";
import { json, badRequest, serverError } from "@/app/api/_utils/http";

const BodySchema = z.object({
  rootPath: z.string().trim().optional(),
  waitForCompletion: z.boolean().optional().default(false),
});

export async function GET() {
  try {
    const logs = await prisma.bbPresetSyncLog.findMany({
      orderBy: { startedAt: "desc" },
      take: 20,
    });
    return json({ items: logs });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = BodySchema.safeParse(body ?? {});
    if (!parsed.success) {
      return badRequest("Invalid sync payload", z.flattenError(parsed.error));
    }

    const { rootPath, waitForCompletion } = parsed.data;

    const job = await bbPresetSyncQueue.add(
      "sync-bb-presets",
      {
        trigger: "manual",
        rootPath,
      },
      {
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 20 },
      }
    );

    if (!waitForCompletion) {
      return json({ queued: true, jobId: job.id }, 202);
    }

    const completed = await job.waitUntilFinished(bbPresetSyncQueueEvents);
    return json({ queued: true, jobId: job.id, result: completed });
  } catch (error) {
    return serverError(error);
  }
}
