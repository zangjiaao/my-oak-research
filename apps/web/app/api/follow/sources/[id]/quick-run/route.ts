import prisma from "@/lib/prisma";
import { collectQueue, defaultJobOpts } from "@/lib/queue";
import { badRequest, conflict, json, notFound, serverError } from "@/app/api/_utils/http";
import { sourceHasLockedRecallArgs } from "@/lib/source-recall-binding";
import { Prisma } from "@/app/generated/prisma";
import { z } from "zod";

function isQuickQueryForSource(rules: unknown, sourceId: string): boolean {
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) return false;
  const quickRun = (rules as Record<string, unknown>).quickRun;
  if (!quickRun || typeof quickRun !== "object" || Array.isArray(quickRun)) {
    return false;
  }
  const quickRunSourceId = (quickRun as Record<string, unknown>).sourceId;
  return typeof quickRunSourceId === "string" && quickRunSourceId === sourceId;
}

function buildQuickQueryName(sourceName: string, sourceId: string) {
  const normalizedName = sourceName.trim().slice(0, 42) || "source";
  return `Quick • ${normalizedName} • ${sourceId.slice(-6)}`;
}

async function createQuickQueryForSource(input: {
  sourceId: string;
  sourceName: string;
}) {
  const quickRunRules = {
    quickRun: {
      sourceId: input.sourceId,
      mode: "source",
      noKeywords: true,
    },
  } as Prisma.InputJsonObject;

  const createData = {
    name: buildQuickQueryName(input.sourceName, input.sourceId),
    description: `Quick run for source ${input.sourceName}`,
    enabled: true,
    frequency: "MANUAL" as const,
    rateLimit: null,
    cronSchedule: null,
    rules: quickRunRules,
    keywords: {
      connect: [],
    },
    sources: {
      connect: [{ id: input.sourceId }],
    },
    sourcePolicies: {
      create: [
        {
          sourceId: input.sourceId,
          contentFilterEnabled: true,
          contentFilterMode: "TERM_AND_WORD_BOUNDARY" as const,
        },
      ],
    },
  };

  try {
    return await prisma.query.create({ data: createData });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return prisma.query.create({
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

    const existingCandidates = await prisma.query.findMany({
      where: {
        sources: {
          some: { id: sourceId },
        },
      },
      select: {
        id: true,
        enabled: true,
        rules: true,
      },
      orderBy: { createdAt: "desc" },
    });
    const existingQuickQuery = existingCandidates.find((query) =>
      isQuickQueryForSource(query.rules, sourceId)
    );

    let queryId = existingQuickQuery?.id ?? "";
    const created = !existingQuickQuery;

    if (existingQuickQuery) {
      if (!existingQuickQuery.enabled) {
        return conflict("Quick query is disabled");
      }
    } else {
      const quickQuery = await createQuickQueryForSource({
        sourceId,
        sourceName: source.name,
      });
      queryId = quickQuery.id;
    }

    const run = await prisma.queryRun.create({
      data: {
        queryId,
        status: "PENDING",
        progress: 0,
      },
      select: { id: true },
    });

    await collectQueue.add(
      "collect-manual",
      { runId: run.id, queryId, trigger: "manual" },
      defaultJobOpts
    );

    return json(
      {
        queryId,
        runId: run.id,
        created,
      },
      created ? 201 : 200
    );
  } catch (error) {
    return serverError(error);
  }
}
