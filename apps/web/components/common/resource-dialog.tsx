"use client";

import { useState } from "react";
import { useForm, FieldValues, UseFormProps, Path } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SettingEditDialog } from "@/components/layout";

export interface ResourceDialogField<T extends FieldValues> {
  name: Path<T>;
  label: string;
  type?: "input" | "textarea" | "select" | "switch" | "custom";
  placeholder?: string;
  required?: boolean;
  rows?: number;
  render?: (field: any, errors: any) => React.ReactNode;
  options?: Array<{ value: string; label: string; disabled?: boolean }>;
  description?: string;
}

export interface ResourceDialogProps<T extends FieldValues, R = any> {
  // 基础配置
  title: string;
  description: string;
  triggerButton: React.ReactNode;

  // 表单配置
  schema: z.ZodSchema<T>;
  fields: ResourceDialogField<T>[];
  defaultValues?: UseFormProps<T>["defaultValues"];

  // API 配置
  createEndpoint?: string;
  updateEndpoint?: (id: string) => string;

  // 数据配置
  resource?: R & { id: string };

  // 缓存配置
  queryKeys?: string[][];

  // 自定义处理
  onSubmit?: (data: T, isUpdate: boolean) => Promise<any>;
  onSuccess?: (result: any, isUpdate: boolean) => void;
  onError?: (error: Error, isUpdate: boolean) => void;

  // UI 配置
  submitButtonText?: {
    create?: string;
    update?: string;
    pending?: {
      create?: string;
      update?: string;
    };
  };
}

// 默认提交函数
async function defaultSubmitFn<T>(data: {
  formData: T;
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
    throw new Error(
      error || `Failed to ${isUpdate ? "update" : "create"} resource`
    );
  }

  return response.json();
}

export function ResourceDialog<T extends FieldValues, R = any>({
  title,
  description,
  triggerButton,
  schema,
  fields,
  defaultValues,
  createEndpoint = "/api/resource",
  updateEndpoint = (id: string) => `/api/resource/${id}`,
  resource,
  queryKeys = [],
  onSubmit,
  onSuccess,
  onError,
  submitButtonText = {},
}: ResourceDialogProps<T, R>) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const isUpdate = !!resource;
  const endpoint = isUpdate ? updateEndpoint(resource.id) : createEndpoint;

  // Setup form
  const form = useForm({
    resolver: zodResolver(schema as any),
    defaultValues: defaultValues,
  });

  // Setup mutation
  const mutation = useMutation({
    mutationFn: onSubmit
      ? (data: T) => onSubmit(data, isUpdate)
      : (data: any) => defaultSubmitFn({ formData: data, endpoint, isUpdate }),
    onSuccess: (result) => {
      // 显示成功消息
      toast.success(
        isUpdate
          ? "Resource updated successfully"
          : "Resource created successfully"
      );

      // 关闭对话框
      setOpen(false);

      // 重置表单（仅新建时）
      if (!isUpdate) {
        form.reset();
      }

      // 刷新缓存
      queryKeys.forEach((queryKey) => {
        queryClient.invalidateQueries({ queryKey });
      });

      // 自定义成功处理
      onSuccess?.(result, isUpdate);
    },
    onError: (error: Error) => {
      console.error(
        `Failed to ${isUpdate ? "update" : "create"} resource:`,
        error
      );
      toast.error(
        error.message ||
          (isUpdate ? "Failed to update resource" : "Failed to create resource")
      );

      // 自定义错误处理
      onError?.(error, isUpdate);
    },
  });

  const handleSubmit = async (data: any) => {
    mutation.mutate(data);
  };

  // 渲染表单字段
  const renderFields = () => {
    return fields.map((field) => {
      if (field.render) {
        return (
          <div key={field.name} className="grid gap-3">
            {field.render(
              form.register(field.name),
              form.formState.errors[field.name]
            )}
          </div>
        );
      }

      // 这里可以根据 field.type 渲染不同类型的输入组件
      // 为了简化，暂时返回占位符
      return (
        <div key={field.name} className="grid gap-3">
          <label htmlFor={field.name}>{field.label}</label>
          {/* 根据 field.type 渲染相应的输入组件 */}
        </div>
      );
    });
  };

  return (
    <SettingEditDialog
      props={{ open, onOpenChange: setOpen }}
      title={title}
      description={description}
      triggerButton={triggerButton}
      buttonText={
        mutation.isPending
          ? isUpdate
            ? submitButtonText.pending?.update || "Updating..."
            : submitButtonText.pending?.create || "Creating..."
          : isUpdate
          ? submitButtonText.update || "Update"
          : submitButtonText.create || "Create"
      }
      onSubmit={form.handleSubmit(handleSubmit)}
    >
      {renderFields()}
    </SettingEditDialog>
  );
}
