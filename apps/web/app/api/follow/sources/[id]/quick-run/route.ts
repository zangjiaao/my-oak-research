import prisma from "@/lib/prisma";
import { collectFlowQueue, defaultJobOpts } from "@/lib/queue";
import { badRequest, conflict, json, notFound, serverError } from "@/app/api/_utils/http";
import { sourceHasLockedRecallArgs } from "@/lib/source-recall-binding";
import { Prisma } from "@/app/generated/prisma";
import { z } from "zod";

function buildQuickJobName(sourceName: string, sourceId: string) {
  const normalizedName = sourceName.trim().slice(0, 42) || "source";
  return `Quick • ${normalizedName} • ${sourceId.slice(-6)}`;
}

function isQuickJobForSource(config: unknown, sourceId: string): boolean {
  if (!config || typeof config !== "object" || Array.isArray(config)) return false;
  const quickRun = (config as Record<string, unknown>).quickRun;
  if (!quickRun || typeof quickRun !== "object" || Array.isArray(quickRun)) {
    return false;
  }
  const quickRunSourceId = (quickRun as Record<string, unknown>).sourceId;
  return typeof quickRunSourceId === "string" && quickRunSourceId === sourceId;
}

async function createQuickJobForSource(input: {
  sourceId: string;
  sourceName: string;
}) {
  const config = {
    quickRun: {
      sourceId: input.sourceId,
      mode: "source",
    },
  } as Prisma.InputJsonObject;

  const createData = {
    name: buildQuickJobName(input.sourceName, input.sourceId),
    type: "SOURCE_ONESHOT" as const,
    enabled: true,
    frequency: "MANUAL" as const,
    cronSchedule: null,
    triggerMode: "manual",
    config,
    jobSources: {
      create: [{ sourceId: input.sourceId }],
    },
  };

  try {
    return await prisma.job.create({ data: createData });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return prisma.job.create({
        data: {
          ...createData,
          name: `${createData.name}-${Date.now().toString().slice(-4)}`,
        },
      });
    }
    throw error;
  }
}

export async function POST(
  _req: Request,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const params = await paramsPromise;
    const parsed = z.object({ id: z.string().cuid() }).safeParse(params);
    if (!parsed.success) {
      return badRequest("Invalid source id", z.flattenError(parsed.error));
    }
    const sourceId = parsed.data.id;

    const source = await prisma.source.findUnique({
      where: { id: sourceId },
      include: {
        web: true,
        search: true,
        social: true,
      },
    });
    if (!source) {
      return notFound("Source not found");
    }
    if (!source.active) {
      return conflict("Source is disabled");
    }
    if (sourceHasLockedRecallArgs(source)) {
      return conflict("Source has locked recall args and does not support quick run");
    }

    const existingCandidates = await prisma.job.findMany({
      where: {
        type: "SOURCE_ONESHOT",
        jobSources: {
          some: { sourceId },
        },
      },
      select: {
        id: true,
        enabled: true,
        config: true,
      },
      orderBy: { createdAt: "desc" },
    });
    const existingQuickJob = existingCandidates.find((job) =>
      isQuickJobForSource(job.config, sourceId)
    );

    let jobId = existingQuickJob?.id ?? "";
    const created = !existingQuickJob;

    if (existingQuickJob) {
      if (!existingQuickJob.enabled) {
        await prisma.job.update({
          where: { id: existingQuickJob.id },
          data: { enabled: true },
        });
      }
    } else {
      const quickJob = await createQuickJobForSource({
        sourceId,
        sourceName: source.name,
      });
      jobId = quickJob.id;
    }

    const run = await prisma.jobRun.create({
      data: {
        jobId,
        status: "PENDING",
        progress: 0,
        trigger: "manual",
      },
      select: { id: true },
    });

    await collectFlowQueue.add(
      "collect-job-manual",
      { runId: run.id, jobId, trigger: "manual" },
      defaultJobOpts
    );

    return json(
      {
        jobId,
        runId: run.id,
        created,
      },
      created ? 201 : 200
    );
  } catch (error) {
    return serverError(error);
  }
}
