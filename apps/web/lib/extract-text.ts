import { extractRawText } from "mammoth";
const PDFParse = require("pdf-parse");

export async function extractTextFromFile(
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<string> {
  // 1. PDF
  if (
    mimeType === "application/pdf" ||
    fileName.toLowerCase().endsWith(".pdf")
  ) {
    try {
      const data = await PDFParse(new Uint8Array(buffer));
      return (data.text || "").trim().replace(/\0/g, "");
    } catch (error: any) {
      console.error("[extract-text] PDF parsing failed:", error);
      throw new Error(`PDF 解析失败: ${error.message || "未知错误"}`);
    }
  }

  // 2. Word (.docx)
  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    fileName.toLowerCase().endsWith(".docx")
  ) {
    try {
      const result = await extractRawText({ buffer });
      return result.value.trim().replace(/\0/g, "");
    } catch (error: any) {
      console.error("[extract-text] DOCX parsing failed:", error);
      throw new Error(`Word (.docx) 解析失败: ${error.message || "未知错误"}`);
    }
  }

  // 3. Text based (txt, md)
  const isText =
    mimeType.startsWith("text/") ||
    fileName.toLowerCase().endsWith(".md") ||
    fileName.toLowerCase().endsWith(".txt") ||
    fileName.toLowerCase().endsWith(".csv") ||
    fileName.toLowerCase().endsWith(".json");

  if (isText) {
    return buffer.toString("utf-8").trim().replace(/\0/g, "");
  }

  // Fallback for other file types as text
  return buffer.toString("utf-8").trim().replace(/\0/g, "");
}
