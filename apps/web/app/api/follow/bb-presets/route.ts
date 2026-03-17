import { z } from "zod";

import prisma from "@/lib/prisma";
import { badRequest, json, serverError } from "@/app/api/_utils/http";
import { BbPresetStatus } from "@/app/generated/prisma";

const QuerySchema = z.object({
  platform: z.string().trim().optional(),
  key: z.string().trim().optional(),
  status: z.nativeEnum(BbPresetStatus).optional(),
  includeInactive: z.enum(["true", "false"]).optional(),
  latestOnly: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const parsed = QuerySchema.safeParse(Object.fromEntries(searchParams.entries()));
    if (!parsed.success) {
      return badRequest("Invalid query parameters", z.flattenError(parsed.error));
    }

    const { platform, key, status, includeInactive, latestOnly, page, pageSize } = parsed.data;

    const where: {
      platform?: string;
      key?: { contains: string; mode: "insensitive" };
      status?: BbPresetStatus;
      isActive?: boolean;
    } = {};

    if (platform) where.platform = platform.toUpperCase();
    if (key) where.key = { contains: key, mode: "insensitive" };
    if (status) where.status = status;
    if (includeInactive !== "true") where.isActive = true;

    const rows = await prisma.bbPreset.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      include: {
        sourceBindings: {
          select: { id: true, sourceId: true, enabled: true },
        },
      },
    });

    const filtered = latestOnly === "false"
      ? rows
      : rows.filter((row, index, all) => all.findIndex((x) => x.key === row.key) === index);

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);

    return json({ total, page, pageSize, items });
  } catch (error) {
    return serverError(error);
  }
}
