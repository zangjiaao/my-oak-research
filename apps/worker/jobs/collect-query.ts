import prisma from "@/lib/prisma";
import { createCollectWorker } from "@/lib/queue";
import { runFocusCollector } from "../pipelines/content-analysis";
import { publishTaskEvent } from "@/lib/queue";
import { logger } from "@/lib/logger";

// In-process worker; in production consider running as a separate process
export const collectWorker = createCollectWorker(async (job) => {
  const { runId: inputRunId, queryId, trigger } = job.data;
  let runId = inputRunId;
  if (!runId) {
    const run = await prisma.queryRun.create({
      data: {
        queryId,
        status: "PENDING",
        progress: 0,
      },
      select: { id: true },
    });
    runId = run.id;
  }
  if (!runId) {
    throw new Error("Failed to initialize query run id");
  }

  logger.info("collect-query job started", { runId, queryId, trigger });
  try {
    await publishTaskEvent(runId, { type: "enqueue", message: "已入队" });
    await runFocusCollector(runId, queryId);
    return { ok: true };
  } catch (error) {
    const err = error instanceof Error ? error : new Error("unknown");
    logger.error("collect-query job failed", {
      runId,
      queryId,
      error: logger.normalizeError(err),
    });
    await prisma.queryRun.update({
      where: { id: runId },
      data: {
        status: "FAILED",
        error: err.message ?? "unknown",
        finishedAt: new Date(),
      },
    });
    await publishTaskEvent(runId, {
      type: "error",
      message: err.message ?? "unknown",
    });
    throw err;
  }
});
