import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { JobUpdateSchema } from "@/app/api/_utils/zod";
import { logger } from "@/lib/logger";
import { scheduleCollectJob, unscheduleCollectJob } from "@/lib/queue";
import { z } from "zod";

const prismaAny = prisma as any;

export async function GET(
  _req: Request,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  const params = await paramsPromise;
  const job = await prismaAny.job.findUnique({
    where: { id: params.id },
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
      runs: {
        orderBy: {
          createdAt: "desc",
        },
        take: 20,
      },
    },
  });

  if (!job) {
    return new NextResponse("Job not found", { status: 404 });
  }

  return NextResponse.json(job);
}

export async function PATCH(
  req: Request,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  const params = await paramsPromise;
  try {
    const existing = await prismaAny.job.findUnique({
      where: { id: params.id },
      include: {
        jobTopics: true,
        jobSources: true,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const payload = await req.json();
    const parsed = JobUpdateSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid job payload", details: z.flattenError(parsed.error) },
        { status: 400 }
      );
    }

    const data = parsed.data;
    const sourceIds = data.sourceBindings?.map((item) => item.sourceId) ?? [];
    const topicIds = data.topicIds ?? [];

    if (sourceIds.length > 0) {
      const existingSources = await prisma.source.count({
        where: { id: { in: sourceIds } },
      });
      if (existingSources !== sourceIds.length) {
        return NextResponse.json(
          { error: "One or more provided sourceIds do not exist." },
          { status: 400 }
        );
      }
    }

    if (topicIds.length > 0) {
      const existingTopics = await prismaAny.topic.count({
        where: { id: { in: topicIds } },
      });
      if (existingTopics !== topicIds.length) {
        return NextResponse.json(
          { error: "One or more provided topicIds do not exist." },
          { status: 400 }
        );
      }
    }

    const updated = await prismaAny.$transaction(async (tx: any) => {
      const job = await tx.job.update({
        where: { id: params.id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.type !== undefined ? { type: data.type } : {}),
          ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
          ...(data.frequency !== undefined ? { frequency: data.frequency } : {}),
          ...(data.frequency !== undefined
            ? {
                cronSchedule:
                  data.frequency === "CRONTAB" ? data.cronSchedule ?? null : null,
              }
            : {}),
          ...(data.triggerMode !== undefined ? { triggerMode: data.triggerMode } : {}),
          ...(data.config !== undefined ? { config: data.config } : {}),
        },
      });

      if (data.topicIds !== undefined) {
        await tx.jobTopic.deleteMany({ where: { jobId: params.id } });
        if (data.topicIds.length > 0) {
          await tx.jobTopic.createMany({
            data: data.topicIds.map((topicId) => ({ jobId: params.id, topicId })),
            skipDuplicates: true,
          });
        }
      }

      if (data.sourceBindings !== undefined) {
        await tx.jobSource.deleteMany({ where: { jobId: params.id } });
        if (data.sourceBindings.length > 0) {
          await tx.jobSource.createMany({
            data: data.sourceBindings.map((binding) => ({
              jobId: params.id,
              sourceId: binding.sourceId,
              recallBindingOverride: binding.recallBindingOverride ?? null,
            })),
            skipDuplicates: true,
          });
        }
      }

      return job;
    });

    await scheduleCollectJob({
      jobId: updated.id,
      enabled: updated.enabled,
      frequency: updated.frequency,
      cronSchedule: updated.cronSchedule,
    });

    return NextResponse.json(updated);
  } catch (error) {
    logger.error("failed to update job", {
      jobId: params.id,
      error: logger.normalizeError(error),
    });
    return NextResponse.json({ error: "Failed to update job" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  const params = await paramsPromise;
  try {
    await unscheduleCollectJob(params.id);
    await prismaAny.job.delete({
      where: { id: params.id },
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    logger.error("failed to delete job", {
      jobId: params.id,
      error: logger.normalizeError(error),
    });
    return NextResponse.json({ error: "Failed to delete job" }, { status: 500 });
  }
}
