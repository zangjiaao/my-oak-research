import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

/**
 * 通用的 Category Mutation Hook，用于创建和更新 category
 * @param options.categoryId - 如果提供，则为更新操作；否则为创建操作
 * @param options.onSuccess - 成功后的回调函数
 */
interface UseCategoryMutationOptions {
  categoryId?: string;
  onSuccess?: () => void;
}

async function submitCategory(data: {
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
    throw new Error(error || "Failed to submit category");
  }

  return response.json();
}

export function useCategoryMutation({
  categoryId,
  onSuccess,
}: UseCategoryMutationOptions = {}) {
  const queryClient = useQueryClient();
  const isUpdate = !!categoryId;
  const endpoint = categoryId
    ? `/api/follow/categories/${categoryId}`
    : "/api/follow/categories";

  return useMutation({
    mutationFn: (formData: Record<string, unknown>) =>
      submitCategory({
        formData,
        endpoint,
        isUpdate,
      }),
    onSuccess: () => {
      // 显示成功消息
      toast.success(
        isUpdate
          ? "Category updated successfully"
          : "Category added successfully"
      );

      // 执行用户提供的成功回调
      onSuccess?.();

      // Invalidate 相关查询
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      queryClient.invalidateQueries({ queryKey: ["keywords"] });
      if (categoryId) {
        queryClient.invalidateQueries({ queryKey: ["category", categoryId] });
      }
    },
    onError: (error: Error) => {
      // 增强的错误处理
      console.error("Failed to submit category:", error);
      toast.error(
        error.message ||
          (isUpdate ? "Failed to update category" : "Failed to add category")
      );
    },
  });
}
