/**
 * MinIO/S3 对象存储客户端
 * MinIO 完全兼容 AWS S3 API，可以使用 @aws-sdk/client-s3
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// MinIO/S3 配置
const s3Config = {
  endpoint:
    process.env.MINIO_ENDPOINT ||
    process.env.S3_ENDPOINT ||
    "http://localhost:9000",
  region: process.env.MINIO_REGION || process.env.S3_REGION || "us-east-1",
  credentials: {
    accessKeyId:
      process.env.MINIO_ACCESS_KEY || process.env.S3_ACCESS_KEY || "minioadmin",
    secretAccessKey:
      process.env.MINIO_SECRET_KEY || process.env.S3_SECRET_KEY || "minioadmin",
  },
  forcePathStyle: true, // MinIO 需要这个选项
};

const BUCKET_NAME =
  process.env.MINIO_BUCKET || process.env.S3_BUCKET || "oak-research";

// 创建 S3 客户端（兼容 MinIO）
export const s3Client = new S3Client(s3Config);

/**
 * 初始化存储桶（如果不存在则创建）
 * 建议在应用启动时调用一次
 */
export async function ensureBucketExists(): Promise<void> {
  try {
    // 检查 bucket 是否存在
    try {
      await s3Client.send(
        new HeadBucketCommand({
          Bucket: BUCKET_NAME,
        })
      );
      console.log(`Bucket "${BUCKET_NAME}" already exists`);
      return;
    } catch (error) {
      // 如果 bucket 不存在，创建它
      const s3Error = error as {
        name?: string;
        $metadata?: { httpStatusCode?: number };
      };
      if (
        s3Error.name === "NotFound" ||
        s3Error.$metadata?.httpStatusCode === 404
      ) {
        await s3Client.send(
          new CreateBucketCommand({
            Bucket: BUCKET_NAME,
          })
        );
        console.log(`Bucket "${BUCKET_NAME}" created successfully`);
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.error("Failed to ensure bucket exists:", error);
    // 不抛出错误，允许应用继续运行（bucket 可能已存在或需要手动创建）
  }
}

/**
 * 编码元数据值，确保符合 HTTP header 规范
 * S3/MinIO 的元数据值必须是有效的 HTTP header 值
 */
function encodeMetadataValue(value: string): string {
  // 使用 encodeURIComponent 编码，但保留一些安全字符
  // 然后替换为 URL 安全的 Base64 编码，避免 header 中的特殊字符问题
  return Buffer.from(value, "utf-8").toString("base64url");
}

/**
 * 解码元数据值
 */
function decodeMetadataValue(encoded: string): string {
  try {
    return Buffer.from(encoded, "base64url").toString("utf-8");
  } catch {
    // 如果解码失败，返回原值（可能是旧格式）
    return encoded;
  }
}

/**
 * 编码元数据对象的所有值
 */
function encodeMetadata(
  metadata?: Record<string, string>
): Record<string, string> | undefined {
  if (!metadata) return undefined;

  const encoded: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    // 确保键名也是安全的（只包含字母、数字、连字符、下划线）
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_");
    encoded[safeKey] = encodeMetadataValue(value);
  }
  return encoded;
}

/**
 * 上传文件到 MinIO/S3
 */
export async function uploadFile(
  key: string,
  buffer: Buffer,
  contentType: string,
  metadata?: Record<string, string>
): Promise<string> {
  try {
    // 编码元数据值，确保符合 HTTP header 规范
    const encodedMetadata = encodeMetadata(metadata);

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      Metadata: encodedMetadata,
    });

    await s3Client.send(command);
    return key;
  } catch (error) {
    console.error("Failed to upload file to MinIO:", error);
    throw new Error(
      `File upload failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * 从 S3 对象获取并解码元数据
 */
export function decodeMetadata(
  metadata?: Record<string, string>
): Record<string, string> | undefined {
  if (!metadata) return undefined;

  const decoded: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    decoded[key] = decodeMetadataValue(value);
  }
  return decoded;
}

/**
 * 获取文件的预签名 URL（用于下载）
 * @param key 文件键
 * @param expiresIn 过期时间（秒），默认 1 小时
 */
export async function getFileUrl(
  key: string,
  expiresIn: number = 3600
): Promise<string> {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    return await getSignedUrl(s3Client, command, { expiresIn });
  } catch (error) {
    console.error("Failed to generate file URL:", error);
    throw new Error(
      `Failed to generate file URL: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * 删除文件
 */
export async function deleteFile(key: string): Promise<void> {
  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    await s3Client.send(command);
  } catch (error) {
    console.error("Failed to delete file from MinIO:", error);
    throw new Error(
      `File deletion failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * 生成文件存储键
 * @param knowledgeId 知识库 ID
 * @param fileId 文件 ID
 * @param fileName 原始文件名
 */
export function generateStorageKey(
  knowledgeId: string,
  fileId: string,
  fileName: string
): string {
  // 清理文件名，移除特殊字符
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
  return `knowledge/${knowledgeId}/${fileId}/${sanitizedFileName}`;
}
