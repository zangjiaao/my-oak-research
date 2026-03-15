import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import {
  findTopicRelatedContentIds,
  saveTopicAssociation,
} from "@/lib/topic";

const AssociateSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  replace: z.boolean().optional().default(false),
});

export async function POST(
  req: Request,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  const params = await paramsPromise;
  const body = await req.json().catch(() => ({}));
  const parsed = AssociateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const query = await prisma.query.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!query) {
    return NextResponse.json({ error: "Query not found" }, { status: 404 });
  }

  const { contentIds } = await findTopicRelatedContentIds(params.id, {
    limit: parsed.data.limit,
    from: parsed.data.from ? new Date(parsed.data.from) : undefined,
    to: parsed.data.to ? new Date(parsed.data.to) : undefined,
  });

  await saveTopicAssociation(params.id, contentIds, {
    replace: parsed.data.replace,
  });

  return NextResponse.json({
    queryId: params.id,
    linkedCount: contentIds.length,
    contentIds,
  });
}
