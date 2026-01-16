import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { collectQueue, defaultJobOpts } from "@/lib/queue";
import { z } from "zod";

export async function POST(
  req: Request,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  const params = await paramsPromise;
  const parse = z.object({ id: z.string().min(1) }).safeParse(params);
  if (!parse.success) {
    return NextResponse.json({ error: "Invalid query id" }, { status: 400 });
  }
  const queryId = parse.data.id;

  const query = await prisma.query.findUnique({ where: { id: queryId } });
  if (!query) {
    return NextResponse.json({ error: "Query not found" }, { status: 404 });
  }
  if (!query.enabled) {
    return NextResponse.json({ error: "Query is disabled" }, { status: 409 });
  }

  const run = await prisma.queryRun.create({
    data: {
      queryId,
      status: "PENDING",
      progress: 0,
    },
  });

  await collectQueue.add("collect", { runId: run.id, queryId }, defaultJobOpts);

  return NextResponse.json({ runId: run.id });
}
