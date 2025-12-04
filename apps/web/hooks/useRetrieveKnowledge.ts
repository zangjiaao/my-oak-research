import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

/**
 * 知识库检索片段元数据
 * 包含知识库信息和文档元信息
 */
export type RetrieveChunkMetadata = {
  /** 知识库 ID */
  knowledgeId: string;
  /** 知识库名称 */
  knowledgeName: string;
  /** 知识库描述 */
  knowledgeDescription: string | null;
  /** 文档元信息（文件名、页码等） */
  [key: string]: string | number | boolean | null | undefined;
};

export type RetrieveChunk = {
  id: string;
  content: string;
  similarity: number;
  metadata: RetrieveChunkMetadata;
};

type RetrieveResponse = {
  success: boolean;
  data: {
    query: string;
    results: RetrieveChunk[];
    count: number;
  };
};

type RetrieveInput = {
  query: string;
  knowledgeIds?: string[];
  topK?: number;
  minSimilarity?: number;
};

const retrieveKnowledge = async (
  input: RetrieveInput
): Promise<RetrieveResponse> => {
  const response = await fetch("/api/library/retrieve", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "检索失败");
  }

  return response.json();
};

/**
 * RAG 知识库检索 Hook
 * 用于从知识库中检索相关片段，供报告生成使用
 */
export function useRetrieveKnowledge() {
  return useMutation({
    mutationFn: retrieveKnowledge,
    onError: (error: Error) => {
      toast.error(error.message || "检索失败");
    },
  });
}
