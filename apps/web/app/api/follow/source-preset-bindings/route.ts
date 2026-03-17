import { z } from "zod";

import prisma from "@/lib/prisma";
import { badRequest, json, serverError } from "@/app/api/_utils/http";
import { Prisma } from "@/app/generated/prisma";

const QuerySchema = z.object({
  sourceId: z.string().cuid().optional(),
  presetId: z.string().cuid().optional(),
  enabled: z.enum(["true", "false"]).optional(),
});

const UpsertSchema = z.object({
  sourceId: z.string().cuid(),
  presetId: z.string().cuid(),
  args: z.record(z.string(), z.unknown()).optional().default({}),
  enabled: z.boolean().optional().default(true),
});

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const parsed = QuerySchema.safeParse(Object.fromEntries(searchParams.entries()));
    if (!parsed.success) {
      return badRequest("Invalid query parameters", z.flattenError(parsed.error));
    }

    const where: {
      sourceId?: string;
      presetId?: string;
      enabled?: boolean;
    } = {};

    if (parsed.data.sourceId) where.sourceId = parsed.data.sourceId;
    if (parsed.data.presetId) where.presetId = parsed.data.presetId;
    if (parsed.data.enabled) where.enabled = parsed.data.enabled === "true";

    const items = await prisma.sourcePresetBinding.findMany({
      where,
      include: {
        source: { select: { id: true, name: true, type: true } },
        preset: {
          select: {
            id: true,
            key: true,
            version: true,
            platform: true,
            name: true,
            status: true,
            isActive: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    return json({ items });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = UpsertSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid binding payload", z.flattenError(parsed.error));
    }

    const { sourceId, presetId, args, enabled } = parsed.data;

    const binding = await prisma.sourcePresetBinding.upsert({
      where: {
        sourceId_presetId: {
          sourceId,
          presetId,
        },
      },
      create: {
        sourceId,
        presetId,
        args: args as Prisma.InputJsonValue,
        enabled,
      },
      update: {
        args: args as Prisma.InputJsonValue,
        enabled,
      },
      include: {
        source: { select: { id: true, name: true, type: true } },
        preset: {
          select: {
            id: true,
            key: true,
            version: true,
            platform: true,
            name: true,
            status: true,
            isActive: true,
          },
        },
      },
    });

    return json(binding, 201);
  } catch (error) {
    return serverError(error);
  }
}
