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
    const job = await prismaAny.job.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        enabled: true,
      },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const run = await prismaAny.jobRun.create({
      data: {
        jobId: params.id,
        status: "PENDING",
        trigger: "manual",
      },
      select: { id: true },
    });

    await collectFlowQueue.add(
      "collect-job-manual",
      {
        jobId: params.id,
        runId: run.id,
        trigger: "manual",
      },
      {
        ...defaultJobOpts,
      }
    );

    return NextResponse.json({ enqueued: true, runId: run.id });
  } catch (error) {
    logger.error("failed to run collect job", {
      jobId: params.id,
      error: logger.normalizeError(error),
    });
    return NextResponse.json({ error: "Failed to run collect job" }, { status: 500 });
  }
}
