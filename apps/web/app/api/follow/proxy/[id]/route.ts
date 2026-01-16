import prisma from "@/lib/prisma";
import { json, badRequest, serverError, notFound } from "@/app/api/_utils/http";
import { ProxyUpdateSchema } from "@/app/api/_utils/zod";
import { z } from "zod";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const proxy = await prisma.proxy.findUnique({
      where: { id: (await params).id },
      include: {
        _count: {
          select: {
            sources: true,
            darknetOverrides: true,
            webOverrides: true,
            socialOverrides: true,
          },
        },
        sources: {
          select: {
            id: true,
            name: true,
            type: true,
            active: true,
          },
        },
      },
    });

    if (!proxy) {
      return notFound("Proxy not found");
    }

    return json(proxy);
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const body = await req.json();
    const parsed = ProxyUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid proxy payload", {
        message: "Validation failed",
        details: z.flattenError(parsed.error),
      });
    }

    const data = parsed.data;

    // 检查代理是否存在
    const existingProxy = await prisma.proxy.findUnique({
      where: { id: (await params).id },
    });
    if (!existingProxy) {
      return notFound("Proxy not found");
    }

    // 如果更新名称，检查新名称是否唯一
    if (data.name && data.name !== existingProxy.name) {
      const nameConflict = await prisma.proxy.findFirst({
        where: {
          name: data.name,
          id: { not: (await params).id },
        },
      });
      if (nameConflict) {
        return badRequest("Proxy name already exists");
      }
    }

    // 如果更新 URL，检查新 URL 是否唯一
    if (data.url && data.url !== existingProxy.url) {
      const urlConflict = await prisma.proxy.findFirst({
        where: {
          url: data.url,
          id: { not: (await params).id },
        },
      });
      if (urlConflict) {
        return badRequest("Proxy URL already exists");
      }
    }

    const updated = await prisma.proxy.update({
      where: { id: (await params).id },
      data,
      include: {
        _count: {
          select: {
            sources: true,
            darknetOverrides: true,
            webOverrides: true,
            socialOverrides: true,
          },
        },
      },
    });

    return json(updated);
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 检查代理是否存在
    const existingProxy = await prisma.proxy.findUnique({
      where: { id: (await params).id },
      include: {
        _count: {
          select: {
            sources: true,
            darknetOverrides: true,
            webOverrides: true,
            socialOverrides: true,
          },
        },
      },
    });

    if (!existingProxy) {
      return notFound("Proxy not found");
    }

    // 检查是否有关联的资源在使用
    const totalUsage =
      existingProxy._count.sources +
      existingProxy._count.darknetOverrides +
      existingProxy._count.webOverrides +
      existingProxy._count.socialOverrides;

    if (totalUsage > 0) {
      return badRequest("Cannot delete proxy: it is being used by sources", {
        message: "Proxy is in use",
        details: {
          sources: existingProxy._count.sources,
          darknetOverrides: existingProxy._count.darknetOverrides,
          webOverrides: existingProxy._count.webOverrides,
          socialOverrides: existingProxy._count.socialOverrides,
        },
      });
    }

    await prisma.proxy.delete({
      where: { id: (await params).id },
    });

    return json({ message: "Proxy deleted successfully" });
  } catch (error) {
    return serverError(error);
  }
}
