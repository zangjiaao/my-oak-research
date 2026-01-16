import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { z } from "zod";

export async function GET(
  req: Request,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  const params = await paramsPromise;
  const parse = z.object({ id: z.string().min(1) }).safeParse(params);
  if (!parse.success) {
    return NextResponse.json({ error: "Invalid task id" }, { status: 400 });
  }
  const run = await prisma.queryRun.findUnique({
    where: { id: parse.data.id },
    include: { query: true },
  });

  if (!run) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  return NextResponse.json(run);
}
