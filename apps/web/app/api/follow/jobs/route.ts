import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { JobCreateSchema } from "@/app/api/_utils/zod";
import { logger } from "@/lib/logger";
import { scheduleCollectJob } from "@/lib/queue";
import { z } from "zod";

const prismaAny = prisma as any;

export async function GET() {
  try {
    const jobs = await prismaAny.job.findMany({
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
          take: 1,
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    return NextResponse.json(
      jobs.map((job: any) => ({
        ...job,
        latestRun: job.runs?.[0] ?? null,
      }))
    );
  } catch (error) {
    logger.error("failed to list jobs", {
      error: logger.normalizeError(error),
    });
    return NextResponse.json({ error: "Failed to list jobs" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const payload = await req.json();
    const parsed = JobCreateSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid job payload", details: z.flattenError(parsed.error) },
        { status: 400 }
      );
    }

    const data = parsed.data;
    const sourceIds = data.sourceBindings.map((item) => item.sourceId);

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

    if (data.topicIds.length > 0) {
      const existingTopics = await prismaAny.topic.count({
        where: { id: { in: data.topicIds } },
      });
      if (existingTopics !== data.topicIds.length) {
        return NextResponse.json(
          { error: "One or more provided topicIds do not exist." },
          { status: 400 }
        );
      }
    }

    const created = await prismaAny.$transaction(async (tx: any) => {
      const job = await tx.job.create({
        data: {
          name: data.name,
          type: data.type,
          enabled: data.enabled,
          frequency: data.frequency,
          cronSchedule: data.frequency === "CRONTAB" ? data.cronSchedule ?? null : null,
          triggerMode: data.triggerMode ?? "scheduled",
          config: data.config ?? null,
        },
      });

      if (data.topicIds.length > 0) {
        await tx.jobTopic.createMany({
          data: data.topicIds.map((topicId) => ({ jobId: job.id, topicId })),
          skipDuplicates: true,
        });
      }

      if (data.sourceBindings.length > 0) {
        await tx.jobSource.createMany({
          data: data.sourceBindings.map((binding) => ({
            jobId: job.id,
            sourceId: binding.sourceId,
            recallBindingOverride: binding.recallBindingOverride ?? null,
          })),
          skipDuplicates: true,
        });
      }

      return tx.job.findUnique({
        where: { id: job.id },
        include: {
          jobTopics: true,
          jobSources: true,
        },
      });
    });

    await scheduleCollectJob({
      jobId: created.id,
      enabled: created.enabled,
      frequency: created.frequency,
      cronSchedule: created.cronSchedule,
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    logger.error("failed to create job", {
      error: logger.normalizeError(error),
    });
    return NextResponse.json({ error: "Failed to create job" }, { status: 500 });
  }
}
