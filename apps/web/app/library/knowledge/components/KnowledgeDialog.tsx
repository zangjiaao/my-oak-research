"use client";

import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useCreateKnowledge,
  useUpdateKnowledge,
  useUploadFile,
  type KnowledgeItem,
} from "@/hooks/useKnowledge";
import { useState } from "react";
import { Upload } from "lucide-react";

const KnowledgeSchema = z.object({
  name: z
    .string()
    .min(2, "名称至少需要2个字符")
    .max(100, "名称不能超过100个字符"),
  description: z.string().max(500, "描述不能超过500个字符").optional(),
  file: z.instanceof(File).optional(),
  vectorModel: z.string().optional().default("Doubao-embedding-240715"),
  chunkSize: z.coerce.number().int().min(200).max(2000).default(500).optional(),
});

type KnowledgeFormValues = z.infer<typeof KnowledgeSchema>;

interface KnowledgeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  knowledge?: KnowledgeItem | null;
}

const VECTOR_MODELS = [
  { value: "Doubao-embedding-240715", label: "Doubao Embedding" },
  { value: "text-embedding-ada-002", label: "OpenAI Ada-002" },
];

export const KnowledgeDialog: React.FC<KnowledgeDialogProps> = ({
  open,
  onOpenChange,
  knowledge,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const createMutation = useCreateKnowledge();
  const updateMutation = useUpdateKnowledge();
  const uploadMutation = useUploadFile();

  const form = useForm({
    resolver: zodResolver(KnowledgeSchema),
    defaultValues: {
      name: knowledge?.name || "",
      description: knowledge?.description || "",
      vectorModel: "Doubao-embedding-240715",
      chunkSize: 500,
    },
  });

  React.useEffect(() => {
    if (knowledge) {
      form.reset({
        name: knowledge.name,
        description: knowledge.description || "",
        vectorModel: "Doubao-embedding-240715",
        chunkSize: 500,
      });
    } else {
      form.reset({
        name: "",
        description: "",
        vectorModel: "Doubao-embedding-240715",
        chunkSize: 500,
      });
    }
    setFile(null);
  }, [knowledge, form, open]);

  const onSubmit = async (values: KnowledgeFormValues) => {
    try {
      if (knowledge) {
        // 更新知识库
        await updateMutation.mutateAsync({
          id: knowledge.id,
          data: {
            name: values.name,
            description: values.description || null,
          },
        });

        // 如果有文件，上传文件
        if (file) {
          await uploadMutation.mutateAsync({
            knowledgeId: knowledge.id,
            file,
            vectorModel: values.vectorModel,
            chunkSize: values.chunkSize,
          });
        }
      } else {
        // 创建知识库
        const result = await createMutation.mutateAsync({
          name: values.name,
          description: values.description,
        });

        // 如果有文件，上传文件
        if (file && result.data) {
          await uploadMutation.mutateAsync({
            knowledgeId: result.data.id,
            file,
            vectorModel: values.vectorModel,
            chunkSize: values.chunkSize,
          });
        }
      }

      onOpenChange(false);
      form.reset();
      setFile(null);
    } catch {
      // 错误已在 mutation 中处理
    }
  };

  const isLoading =
    createMutation.isPending ||
    updateMutation.isPending ||
    uploadMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{knowledge ? "编辑知识库" : "创建知识库"}</DialogTitle>
          <DialogDescription>
            {knowledge
              ? "更新知识库信息或上传新文件"
              : "创建一个新的知识库并上传文档进行向量化"}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    知识库名称 <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input placeholder="请输入知识库名称" {...field} />
                  </FormControl>
                  <FormDescription>2-100个字符</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>描述</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="请输入知识库描述（可选）"
                      className="min-h-20"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>最多500个字符</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-4 border-t pt-4">
              <h3 className="text-sm font-medium">文件上传（可选）</h3>

              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">
                    选择文件
                  </label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="file"
                      accept=".pdf,.doc,.docx,.txt,.md"
                      onChange={(e) => {
                        const selectedFile = e.target.files?.[0];
                        if (selectedFile) {
                          setFile(selectedFile);
                          form.setValue("file", selectedFile);
                        }
                      }}
                      className="cursor-pointer"
                    />
                    {file && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Upload className="h-4 w-4" />
                        <span className="truncate max-w-xs">{file.name}</span>
                        <span className="text-xs">
                          ({(file.size / 1024 / 1024).toFixed(2)} MB)
                        </span>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    支持 PDF、Word、TXT、Markdown 文件，最大 50MB
                  </p>
                </div>

                <FormField
                  control={form.control}
                  name="vectorModel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>向量模型</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="选择向量模型" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {VECTOR_MODELS.map((model) => (
                            <SelectItem key={model.value} value={model.value}>
                              {model.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>用于文档向量化的模型</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="chunkSize"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>切片长度（tokens）</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={200}
                          max={2000}
                          value={String(field.value ?? 500)}
                          onChange={(e) => {
                            field.onChange(parseInt(e.target.value) || 500);
                          }}
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                        />
                      </FormControl>
                      <FormDescription>
                        文档切片的大小，范围：200-2000 tokens
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isLoading}
              >
                取消
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? "处理中..." : knowledge ? "更新" : "创建"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
