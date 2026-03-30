import prisma from "@/lib/prisma";
import { createCollectJobWorker } from "@/lib/queue";
import { logger } from "@/lib/logger";

const prismaAny = prisma as any;

export const collectJobWorker = createCollectJobWorker(async (job) => {
  const { runId: inputRunId, jobId, trigger } = job.data;
  let runId = inputRunId;

  if (!runId) {
    const run = await prismaAny.jobRun.create({
      data: {
        jobId,
        status: "PENDING",
        progress: 0,
        trigger: trigger ?? "scheduled",
      },
      select: { id: true },
    });
    runId = run.id;
  }

  if (!runId) {
    throw new Error("Failed to initialize job run id");
  }

  logger.info("collect-job started", { runId, jobId, trigger });

  try {
    await prismaAny.jobRun.update({
      where: { id: runId },
      data: {
        status: "RUNNING",
        progress: 15,
        startedAt: new Date(),
      },
    });

    const jobConfig = await prismaAny.job.findUnique({
      where: { id: jobId },
      include: {
        jobTopics: {
          include: {
            topic: true,
          },
        },
        jobSources: {
          include: {
            source: true,
          },
        },
      },
    });

    if (!jobConfig) {
      throw new Error("Job config not found");
    }

    await prismaAny.jobRun.update({
      where: { id: runId },
      data: {
        status: "SUCCEEDED",
        progress: 100,
        finishedAt: new Date(),
        meta: {
          type: jobConfig.type,
          topics: jobConfig.jobTopics.length,
          sources: jobConfig.jobSources.length,
          note: "Job scaffold executed; connect to retrieval/ingest pipelines next.",
        },
      },
    });

    return { ok: true };
  } catch (error) {
    const err = error instanceof Error ? error : new Error("unknown");
    logger.error("collect-job failed", {
      runId,
      jobId,
      error: logger.normalizeError(err),
    });

    await prismaAny.jobRun.update({
      where: { id: runId },
      data: {
        status: "FAILED",
        error: err.message,
        finishedAt: new Date(),
      },
    });

    throw err;
  }
});
