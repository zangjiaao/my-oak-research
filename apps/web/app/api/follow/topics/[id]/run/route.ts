import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { collectFlowQueue, defaultJobOpts } from "@/lib/queue";
import { logger } from "@/lib/logger";

const prismaAny = prisma as any;

export async function POST(
  _req: Request,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  const params = await paramsPromise;

  try {
    const topic = await prismaAny.topic.findUnique({
      where: { id: params.id },
      select: { id: true, name: true },
    });

    if (!topic) {
      return NextResponse.json({ error: "Topic not found" }, { status: 404 });
    }

    const jobs = await prismaAny.job.findMany({
      where: {
        type: "TOPIC_RETRIEVAL",
        enabled: true,
        jobTopics: {
          some: {
            topicId: params.id,
          },
        },
      },
      select: { id: true },
    });

    if (jobs.length === 0) {
      return NextResponse.json(
        { error: "No enabled TOPIC_RETRIEVAL jobs bound to this topic" },
        { status: 400 }
      );
    }

    const runIds: string[] = [];
    for (const job of jobs) {
      const run = await prismaAny.jobRun.create({
        data: {
          jobId: job.id,
          status: "PENDING",
          trigger: "manual",
          meta: {
            initiatedBy: "topic-run-api",
            topicId: params.id,
          },
        },
        select: { id: true },
      });
      runIds.push(run.id);

      await collectFlowQueue.add(
        "collect-job-topic-manual",
        {
          jobId: job.id,
          runId: run.id,
          trigger: "manual",
        },
        {
          ...defaultJobOpts,
        }
      );
    }

    return NextResponse.json({
      enqueued: true,
      count: runIds.length,
      runIds,
    });
  } catch (error) {
    logger.error("failed to run topic jobs", {
      topicId: params.id,
      error: logger.normalizeError(error),
    });
    return NextResponse.json({ error: "Failed to run topic jobs" }, { status: 500 });
  }
}
