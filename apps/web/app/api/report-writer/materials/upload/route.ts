import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { json, badRequest, serverError } from "@/app/api/_utils/http";
import { extractTextFromFile } from "@/lib/extract-text";

// TODO: 从认证系统获取 userId，目前使用临时方案
function getUserId(req: NextRequest): string {
  const headerId = req.headers.get("x-user-id");
  if (headerId) return headerId;
  return process.env.DEFAULT_USER_ID || "default-user-id";
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_FILES = 10;

export async function POST(request: NextRequest) {
  try {
    const userId = getUserId(request);
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];

    if (!files || files.length === 0) {
      return badRequest("No files uploaded");
    }

    if (files.length > MAX_FILES) {
      return badRequest(`Maximum ${MAX_FILES} files allowed at once`);
    }

    const results = await Promise.all(
      files.map(async (file) => {
        try {
          if (file.size > MAX_FILE_SIZE) {
            return {
              fileName: file.name,
              success: false,
              error: "File size exceeds 5MB limit",
            };
          }

          const arrayBuffer = await file.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const text = await extractTextFromFile(buffer, file.type, file.name);

          // 创建内容记录
          const content = await prisma.content.create({
            data: {
              title: file.name,
              summary: text.slice(0, 300), // 增加预览长度
              markdown: text,
              platform: "UPLOAD",
              type: "Client",
              time: new Date(),
              meta: {
                fileName: file.name,
                mimeType: file.type,
                fileSize: file.size,
              },
            },
          });

          // 创建收藏记录，使其出现在素材列表中
          const favorite = await prisma.favorite.create({
            data: {
              userId,
              contentId: content.id,
            },
            include: {
              content: true,
            },
          });

          // 转换为前端需要的 MaterialOption 格式
          // 这里的格式根据 ReportEditor.tsx 中的 favoriteToMaterial 函数逻辑来保持一致
          return {
            fileName: file.name,
            success: true,
            material: {
              id: favorite.id, // 这里对应 MaterialOption.id (favoriteId)
              title: content.title,
              description: `UPLOAD · Client`,
              sourceType: "FAVORITE",
              sourceId: content.id,
              snippet: content.summary.slice(0, 200),
              metadata: {
                platform: content.platform,
                type: content.type,
                time: content.time.toISOString(),
              },
            },
          };
        } catch (error: any) {
          console.error(`Error processing file ${file.name}:`, error);
          return {
            fileName: file.name,
            success: false,
            error: error.message || "Unknown error during processing",
          };
        }
      })
    );

    const successItems = results.filter((r) => r.success);
    const failedItems = results.filter((r) => !r.success);

    return json({
      success: true,
      data: {
        items: successItems.map((r) => r.material),
        failed: failedItems,
        total: results.length,
        successCount: successItems.length,
      },
    });
  } catch (error) {
    return serverError(error);
  }
}
