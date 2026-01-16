import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET(
  req: Request,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  const params = await paramsPromise;
  const query = await prisma.query.findUnique({
    where: { id: params.id },
    include: {
      keywords: true,
      sources: true,
      _count: {
        select: {
          keywords: true,
          sources: true,
        },
      },
    },
  });

  if (!query) {
    return new NextResponse("Query not found", { status: 404 });
  }

  const queryWithCounts = {
    ...query,
    keywordsCount: query._count?.keywords || 0,
    sourcesCount: query._count?.sources || 0,
    _count: undefined,
  };

  return NextResponse.json(queryWithCounts);
}

export async function PATCH(
  req: Request,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  const params = await paramsPromise;
  const data = await req.json();
  const {
    name,
    description,
    frequency,
    cronSchedule,
    enabled,
    keywordIds,
    sourceIds,
    rules,
  } = data;

  // Validate keywordIds
  if (keywordIds && keywordIds.length > 0) {
    const existingKeywords = await prisma.keyword.count({
      where: { id: { in: keywordIds } },
    });
    if (existingKeywords !== keywordIds.length) {
      return NextResponse.json(
        { error: "One or more provided keywordIds do not exist." },
        { status: 400 }
      );
    }
  }

  // Validate sourceIds
  if (sourceIds && sourceIds.length > 0) {
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

  const query = await prisma.query.update({
    where: { id: params.id },
    data: {
      name,
      description,
      frequency,
      cronSchedule: frequency === "CRONTAB" ? cronSchedule : null,
      enabled,
      rules,
      keywords: {
        set: keywordIds?.map((id: string) => ({ id })) || [],
      },
      sources: {
        set: sourceIds?.map((id: string) => ({ id })) || [],
      },
    },
  });

  return NextResponse.json(query);
}

export async function DELETE(
  req: Request,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  const params = await paramsPromise;
  await prisma.query.delete({
    where: { id: params.id },
  });
  return NextResponse.json({ success: true });
}
