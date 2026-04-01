import prisma from "@/lib/prisma";
import { createCollectJobWorker } from "@/lib/queue";
import { logger } from "@/lib/logger";
import { runJobCollector } from "../pipelines/content-analysis";
import { QueryContentFilterMode } from "@/app/generated/prisma";
import type { SourceWithRelations } from "@/lib/types";
import { unscheduleCollectJob } from "@/lib/queue";

const prismaAny = prisma as any;
const DEFAULT_RECALL_LANGUAGES = ["zh", "en", "ja"] as const;
type RecallLanguage = (typeof DEFAULT_RECALL_LANGUAGES)[number];

function normalizeRecallLanguages(input: unknown): RecallLanguage[] {
  const raw = Array.isArray(input) ? input : [];
  const normalized = Array.from(
    new Set(
      raw
        .map((item) => String(item).trim().toLowerCase())
        .filter(
          (item): item is RecallLanguage =>
            item === "zh" || item === "en" || item === "ja"
        )
    )
  );
  return normalized.length > 0 ? normalized : [...DEFAULT_RECALL_LANGUAGES];
}

function extractRecallLanguagesFromProfile(profile: unknown): RecallLanguage[] {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return [...DEFAULT_RECALL_LANGUAGES];
  }
  return normalizeRecallLanguages(
    (profile as Record<string, unknown>).recallLanguages
  );
}

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
    const jobConfig = await prismaAny.job.findUnique({
      where: { id: jobId },
      include: {
        jobTopics: {
          include: {
            topic: {
              include: {
                terms: true,
              },
            },
          },
        },
        jobSources: {
          include: {
            source: {
              include: {
                web: true,
                search: {
                  include: {
                    credential: true,
                  },
                },
                social: {
                  include: {
                    credential: true,
                    proxy: true,
                  },
                },
                darknet: true,
                credential: true,
                proxy: true,
              },
            },
          },
        },
      },
    });

    if (!jobConfig) {
      throw new Error("Job config not found");
    }

    const topics = (jobConfig.jobTopics ?? [])
      .map((binding: any) => binding.topic)
      .filter(Boolean)
      .map((topic: any) => ({
        id: topic.id,
        name: topic.name,
        description: topic.description ?? null,
        recallLanguages: extractRecallLanguagesFromProfile(topic.profile),
        terms: (topic.terms ?? []).map((term: any) => ({
          type: term.type,
          value: term.value,
          weight: term.weight,
        })),
      }));

    const sourcePolicyBySourceId = new Map<string, {
      contentFilterEnabled: boolean;
      contentFilterMode: QueryContentFilterMode;
      recallBindingOverride?: unknown;
    }>(
      (jobConfig.jobSources ?? []).map((binding: any) => [
        binding.sourceId,
        {
          contentFilterEnabled: false,
          contentFilterMode: QueryContentFilterMode.TERM_AND_WORD_BOUNDARY,
          recallBindingOverride: binding.recallBindingOverride ?? null,
        },
      ])
    );
    const sources = (jobConfig.jobSources ?? [])
      .map((binding: any) => binding.source)
      .filter(Boolean) as SourceWithRelations[];

    await runJobCollector({
      runId,
      jobId,
      jobType: jobConfig.type,
      topics,
      sources,
      sourcePolicyBySourceId,
    });

    if (jobConfig.type === "SOURCE_ONESHOT") {
      await prismaAny.job.update({
        where: { id: jobId },
        data: { enabled: false },
      });
      await unscheduleCollectJob(jobId);
    }

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
