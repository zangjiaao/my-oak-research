import prisma from "@/lib/prisma";
import { createCollectWorker } from "@/lib/queue";
import { runFocusCollector } from "../pipelines/content-analysis";
import { publishTaskEvent } from "@/lib/queue";

// In-process worker; in production consider running as a separate process
export const collectWorker = createCollectWorker(async (job) => {
  const { runId, queryId } = job.data;
  console.log(
    `[worker] collect-query job started runId=${runId} queryId=${queryId}`
  );
  try {
    await publishTaskEvent(runId, { type: "enqueue", message: "已入队" });
    await runFocusCollector(runId, queryId);
    return { ok: true };
  } catch (error) {
    const err = error instanceof Error ? error : new Error("unknown");
    console.error(
      `[worker] collect-query job failed runId=${runId} queryId=${queryId}`,
      err
    );
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
