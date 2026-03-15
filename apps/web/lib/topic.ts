import { Prisma } from "@/app/generated/prisma";
import prisma from "@/lib/prisma";

type TopicKeyword = {
  id: string;
  name: string;
  includes: string[];
  synonyms: string[];
  enableAiExpand: boolean;
};

type TopicRules = Record<string, unknown>;

type TopicAssociation = {
  contentIds: string[];
  updatedAt: string;
  latestRunId?: string;
  latestLinkedIds?: string[];
};

export function buildTopicTerms(keywords: TopicKeyword[]): string[] {
  const terms: string[] = [];
  for (const keyword of keywords) {
    terms.push(keyword.name);
    terms.push(...keyword.includes);
    if (keyword.enableAiExpand) {
      terms.push(...keyword.synonyms);
    }
  }
  return Array.from(
    new Set(terms.map((term) => term.trim()).filter(Boolean))
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function readTopicAssociation(
  rules: Prisma.JsonValue | null | undefined
): TopicAssociation | null {
  const root = asRecord(rules);
  const topicAssociation = asRecord(root.topicAssociation);
  const contentIds = asStringArray(topicAssociation.contentIds);
  if (!contentIds.length) return null;
  return {
    contentIds,
    updatedAt:
      typeof topicAssociation.updatedAt === "string"
        ? topicAssociation.updatedAt
        : new Date(0).toISOString(),
    latestRunId:
      typeof topicAssociation.latestRunId === "string"
        ? topicAssociation.latestRunId
        : undefined,
    latestLinkedIds: asStringArray(topicAssociation.latestLinkedIds),
  };
}

export function mergeTopicAssociation(
  rules: Prisma.JsonValue | null | undefined,
  contentIds: string[],
  options?: { latestRunId?: string; replace?: boolean }
): TopicRules {
  const root = asRecord(rules);
  const existing = readTopicAssociation(rules)?.contentIds ?? [];
  const merged = options?.replace
    ? Array.from(new Set(contentIds))
    : Array.from(new Set([...contentIds, ...existing]));
  const trimmed = merged.slice(0, 2000);

  return {
    ...root,
    topicAssociation: {
      contentIds: trimmed,
      latestLinkedIds: contentIds.slice(0, 200),
      latestRunId: options?.latestRunId,
      updatedAt: new Date().toISOString(),
    },
  };
}

export async function saveTopicAssociation(
  queryId: string,
  contentIds: string[],
  options?: { latestRunId?: string; replace?: boolean }
) {
  const query = await prisma.query.findUnique({
    where: { id: queryId },
    select: { rules: true },
  });
  const rules = mergeTopicAssociation(query?.rules, contentIds, options);
  await prisma.query.update({
    where: { id: queryId },
    data: { rules: rules as Prisma.InputJsonValue },
  });
}

export async function findTopicRelatedContentIds(
  queryId: string,
  options?: { limit?: number; from?: Date; to?: Date }
) {
  const limit = options?.limit ?? 200;
  const query = await prisma.query.findUnique({
    where: { id: queryId },
    include: { keywords: true },
  });
  if (!query) {
    throw new Error("Query not found");
  }

  const keywordIds = query.keywords.map((keyword) => keyword.id);
  const terms = buildTopicTerms(query.keywords).slice(0, 8);
  const timeWhere = options?.from || options?.to
    ? {
        time: {
          ...(options.from ? { gte: options.from } : {}),
          ...(options.to ? { lte: options.to } : {}),
        },
      }
    : {};

  const byKeyword = keywordIds.length
    ? await prisma.content.findMany({
        where: {
          ...timeWhere,
          keywords: {
            some: {
              keywordId: { in: keywordIds },
            },
          },
        },
        orderBy: { time: "desc" },
        take: limit,
        select: { id: true },
      })
    : [];

  const byText = terms.length
    ? await prisma.content.findMany({
        where: {
          ...timeWhere,
          OR: terms.map((term) => ({
            OR: [
              { title: { contains: term, mode: "insensitive" } },
              { summary: { contains: term, mode: "insensitive" } },
            ],
          })),
        },
        orderBy: { time: "desc" },
        take: limit,
        select: { id: true },
      })
    : [];

  const idSet = new Set<string>();
  byKeyword.forEach((item) => idSet.add(item.id));
  byText.forEach((item) => idSet.add(item.id));

  return {
    query,
    contentIds: Array.from(idSet).slice(0, limit),
  };
}
