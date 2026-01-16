import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

/**
 * 通用的 Keyword Mutation Hook，用于创建和更新 keyword
 * @param options.keywordId - 如果提供，则为更新操作；否则为创建操作
 * @param options.onSuccess - 成功后的回调函数
 */
interface UseKeywordMutationOptions {
  keywordId?: string;
  onSuccess?: () => void;
}

async function submitKeyword(data: {
  formData: Record<string, unknown>;
  endpoint: string;
  isUpdate: boolean;
}) {
  const { formData, endpoint, isUpdate } = data;

  const response = await fetch(endpoint, {
    method: isUpdate ? "PATCH" : "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(formData),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || "Failed to submit keyword");
  }

  return response.json();
}

export function useKeywordMutation({
  keywordId,
  onSuccess,
}: UseKeywordMutationOptions = {}) {
  const queryClient = useQueryClient();
  const isUpdate = !!keywordId;
  const endpoint = keywordId
    ? `/api/follow/keywords/${keywordId}`
    : "/api/follow/keywords";

  return useMutation({
    mutationFn: (formData: Record<string, unknown>) =>
      submitKeyword({
        formData,
        endpoint,
        isUpdate,
      }),
    onSuccess: async () => {
      // Invalidate 相关查询并等待
      await queryClient.invalidateQueries({ queryKey: ["keywords"] });
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      if (keywordId) {
        queryClient.invalidateQueries({ queryKey: ["keyword", keywordId] });
      }

      // 显示成功消息
      toast.success(
        isUpdate ? "Keyword updated successfully" : "Keyword added successfully"
      );

      // 执行用户提供的成功回调
      onSuccess?.();
    },
    onError: (error: Error) => {
      // 增强的错误处理
      console.error("Failed to submit keyword:", error);
      toast.error(
        error.message ||
        (isUpdate ? "Failed to update keyword" : "Failed to add keyword")
      );
    },
  });
}
