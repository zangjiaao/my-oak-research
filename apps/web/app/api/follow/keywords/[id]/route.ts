import prisma from "@/lib/prisma";
import {
  json,
  badRequest,
  notFound,
  conflict,
  serverError,
} from "@/app/api/_utils/http";
import { KeywordUpdateSchema } from "@/app/api/_utils/zod";
import { Prisma } from "@/app/generated/prisma";
import { z } from "zod";

function normalizeTokens(arr: string[] | undefined) {
  if (!arr) return undefined;
  const seen = new Set<string>();
  return arr
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => s.toLowerCase())
    .filter((s) => (seen.has(s) ? false : (seen.add(s), true)));
}

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const item = await prisma.keyword.findUnique({
      where: { id: (await params).id },
      include: { category: true },
    });
    if (!item) return notFound("Keyword not found");
    return json(item);
  } catch (e) {
    return serverError(e);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const body = await req.json();
    const parsed = KeywordUpdateSchema.safeParse(body);
    if (!parsed.success)
      return badRequest(
        "Invalid keyword payload",
        z.flattenError(parsed.error)
      );

    const exists = await prisma.keyword.findUnique({
      where: { id: (await params).id },
    });
    if (!exists) return notFound("Keyword not found");

    const data = parsed.data;
    const bodyHas = (key: string) =>
      Object.prototype.hasOwnProperty.call(body, key);
    const hasIncludes = bodyHas("includes");
    const hasExcludes = bodyHas("excludes");
    const hasSynonyms = bodyHas("synonyms");

    const includes = hasIncludes ? normalizeTokens(data.includes) : undefined;
    const excludes = hasExcludes ? normalizeTokens(data.excludes) : undefined;
    const synonyms = hasSynonyms ? normalizeTokens(data.synonyms) : undefined;

    // 交叉去重（仅在提供时处理）
    let includesClean = includes;
    let synonymsClean = synonyms;
    if (excludes) {
      const exSet = new Set(excludes);
      includesClean = includes?.filter((w) => !exSet.has(w));
      synonymsClean = synonyms?.filter(
        (w) => !exSet.has(w) && !(includesClean || []).includes(w)
      );
    }

    const updated = await prisma.keyword.update({
      where: { id: (await params).id },
      data: {
        ...("name" in data ? { name: data.name } : {}),
        ...("description" in data
          ? { description: data.description ?? null }
          : {}),
        ...("lang" in data ? { lang: data.lang } : {}),
        ...("categoryId" in data
          ? { categoryId: data.categoryId ?? null }
          : {}),
        ...(hasIncludes ? { includes: includesClean ?? [] } : {}),
        ...(hasExcludes ? { excludes: excludes ?? [] } : {}),
        ...(hasSynonyms ? { synonyms: synonymsClean ?? [] } : {}),
        ...("active" in data ? { active: !!data.active } : {}),
        ...("enableAiExpand" in data
          ? { enableAiExpand: !!data.enableAiExpand }
          : {}),
      },
      include: { category: true },
    });

    // 若请求体里带 enableAiExpand=true，可在此触发异步扩展并随后 PATCH 回写
    // if (data.enableAiExpand) queue.add('keywords.aiExpand', { keywordId: updated.id })

    return json(updated);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return conflict("Keyword name already exists in this category");
    return serverError(e);
  }
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await prisma.keyword.delete({ where: { id: (await params).id } });
    return json({ ok: true });
  } catch (e) {
    return serverError(e);
  }
}
