"use client";

import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SettingDeleteAlertDialog } from "@/components/layout";

export interface DeleteAlertProps<T = any> {
  // 基础配置
  triggerButton: React.ReactNode;
  title?: string;
  description?: string | ((item: T) => string);

  // 数据配置
  item: T & { id: string };
  itemName?: string | keyof T | ((item: T) => string);

  // API 配置
  deleteEndpoint?: (id: string) => string;

  // 缓存配置
  queryKeys?: string[][];

  // 自定义处理
  onDelete?: (item: T) => Promise<any>;
  onSuccess?: (item: T) => void;
  onError?: (error: Error, item: T) => void;

  // UI 配置
  confirmText?: string;
  loadingText?: string;
}

// 默认删除函数
async function defaultDeleteFn(id: string, endpoint: string) {
  const response = await fetch(endpoint, {
    method: "DELETE",
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || "Failed to delete item");
  }

  return response.json();
}

export function DeleteAlert<T>({
  triggerButton,
  title = "Delete Item",
  description,
  item,
  itemName = "name",
  deleteEndpoint = (id: string) => `/api/resource/${id}`,
  queryKeys = [],
  onDelete,
  onSuccess,
  onError,
  confirmText = "Delete",
  loadingText = "Deleting...",
}: DeleteAlertProps<T>) {
  const queryClient = useQueryClient();

  // 获取项目名称
  const getItemName = () => {
    if (typeof itemName === "function") {
      return itemName(item);
    }
    return (item as any)[itemName] || "this item";
  };

  // 获取描述文本
  const getDescription = () => {
    if (typeof description === "function") {
      return description(item);
    }
    if (description) {
      return description;
    }
    return `Are you sure you want to delete "${getItemName()}"? This action cannot be undone.`;
  };

  // Setup mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (onDelete) {
        return await onDelete(item);
      }
      return await defaultDeleteFn(item.id, deleteEndpoint(item.id));
    },
    onSuccess: () => {
      // 显示成功消息
      toast.success(`${getItemName()} deleted successfully`);

      // 刷新缓存
      queryKeys.forEach((queryKey) => {
        queryClient.invalidateQueries({ queryKey });
      });

      // 自定义成功处理
      onSuccess?.(item);
    },
    onError: (error: Error) => {
      console.error("Failed to delete item:", error);
      toast.error(error.message || `Failed to delete ${getItemName()}`);

      // 自定义错误处理
      onError?.(error, item);
    },
  });

  const handleDelete = async () => {
    // 防止重复删除
    if (deleteMutation.isPending) {
      return;
    }
    deleteMutation.mutate();
  };

  return (
    <SettingDeleteAlertDialog
      triggerButton={triggerButton}
      title={title}
      description={getDescription()}
      onDelete={handleDelete}
    />
  );
}
