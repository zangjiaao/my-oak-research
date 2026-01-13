import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export type KnowledgeItem = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  fileCount: number;
  chunkCount: number;
};

type KnowledgeResponse = {
  items: KnowledgeItem[];
  nextCursor: string | null;
};

type KnowledgeQuery = {
  search?: string;
  cursor?: string;
  limit?: number;
};

const fetchKnowledge = async (
  query: KnowledgeQuery = {}
): Promise<KnowledgeResponse> => {
  const params = new URLSearchParams();

  if (query.search) {
    params.set("search", query.search);
  }
  if (query.cursor) {
    params.set("cursor", query.cursor);
  }
  if (query.limit) {
    params.set("limit", String(query.limit));
  }

  const url = `/api/library/knowledge${params.toString() ? `?${params.toString()}` : ""
    }`;

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "x-user-id": "default-user-id",
    }
  });
  if (!response.ok) {
    throw new Error("Failed to fetch knowledge");
  }
  return response.json();
};

export function useKnowledge(query: KnowledgeQuery = {}) {
  return useQuery({
    queryKey: ["knowledge", query],
    queryFn: () => fetchKnowledge(query),
    placeholderData: (prev) => prev,
    staleTime: 1000 * 60 * 5, // 5分钟内认为数据 is fresh
  });
}

type CreateKnowledgeInput = {
  name: string;
  description?: string;
};

type UpdateKnowledgeInput = {
  name?: string;
  description?: string | null;
};

export function useCreateKnowledge() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateKnowledgeInput) => {
      const response = await fetch("/api/library/knowledge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": "default-user-id",
        },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to create knowledge");
      }

      return response.json();
    },
    onSuccess: () => {
      toast.success("知识库创建成功");
      queryClient.invalidateQueries({ queryKey: ["knowledge"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "创建失败");
    },
  });
}

export function useUpdateKnowledge() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateKnowledgeInput;
    }) => {
      const response = await fetch(`/api/library/knowledge/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": "default-user-id",
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to update knowledge");
      }

      return response.json();
    },
    onSuccess: () => {
      toast.success("知识库更新成功");
      queryClient.invalidateQueries({ queryKey: ["knowledge"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "更新失败");
    },
  });
}

export function useDeleteKnowledge() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/library/knowledge/${id}`, {
        method: "DELETE",
        headers: {
          "x-user-id": "default-user-id",
        },
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to delete knowledge");
      }

      return response.json();
    },
    onSuccess: () => {
      toast.success("知识库删除成功");
      queryClient.invalidateQueries({ queryKey: ["knowledge"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "删除失败");
    },
  });
}

type UploadFileInput = {
  knowledgeId: string;
  file: File;
  vectorModel?: string;
  chunkSize?: number;
};

export function useUploadFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UploadFileInput) => {
      const formData = new FormData();
      formData.append("file", input.file);
      if (input.vectorModel) {
        formData.append("vectorModel", input.vectorModel);
      }
      if (input.chunkSize) {
        formData.append("chunkSize", String(input.chunkSize));
      }

      const response = await fetch(
        `/api/library/knowledge/${input.knowledgeId}/upload`,
        {
          method: "POST",
          headers: {
            "x-user-id": "default-user-id",
          },
          body: formData,
        }
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to upload file");
      }

      return response.json();
    },
    onSuccess: () => {
      toast.success("文件上传成功，正在处理中...");
      queryClient.invalidateQueries({ queryKey: ["knowledge"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "上传失败");
    },
  });
}
