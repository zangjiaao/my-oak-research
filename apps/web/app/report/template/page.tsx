"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import ReportTemplateCard from "./ReportTemplateCard";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { TEMPLATE_VARIABLES } from "@/lib/template";

type TemplatePayload = {
  id: string;
  name: string;
  description?: string | null;
  markdown?: string | null;
  metadata?: Record<string, unknown> | null;
};

const fallbackTemplates: TemplatePayload[] = [
  {
    id: "template-executive",
    name: "Executive Summary",
    description: "通用的执行摘要结构，适合上层汇报。",
    markdown: `# {{title}}

## 摘要

{{summary}}

## 内容

{{markdown}}`,
  },
  {
    id: "template-tactical",
    name: "战术节点周报",
    description: "强调时间轴与战术节点，适合指控层使用。",
    markdown: `# {{title}}

## 摘要

{{summary}}

## 时间轴与节点

{{markdown}}`,
  },
  {
    id: "template-risks",
    name: "风险研判简报",
    description: "聚焦风险与推荐动作，带有表格格式。",
    markdown: `# {{title}}

## 摘要

{{summary}}

## 主要风险

{{markdown}}`,
  },
];

const initialForm = { name: "", description: "", markdown: "" };

const ReportTemplate = () => {
  const [templates, setTemplates] = useState<TemplatePayload[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] =
    useState<TemplatePayload | null>(null);
  const [formData, setFormData] = useState(initialForm);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const markdownTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    fetch("/api/report-writer/templates")
      .then((res) => res.json())
      .then((payload) => {
        if (!active) return;
        if (payload?.success && Array.isArray(payload.data)) {
          setTemplates(payload.data);
        }
      })
      .catch(() => {
        toast.error("无法加载模板库");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const displayedTemplates = templates.length ? templates : fallbackTemplates;

  const filteredTemplates = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    if (!keyword) return displayedTemplates;
    return displayedTemplates.filter((template) =>
      template.name.toLowerCase().includes(keyword)
    );
  }, [displayedTemplates, searchTerm]);

  const openEditor = (template?: TemplatePayload | null) => {
    setEditingTemplate(template ?? null);
    setFormData({
      name: template?.name ?? "",
      description: template?.description ?? "",
      markdown: template?.markdown ?? "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error("模板名称不能为空");
      return;
    }
    setIsSaving(true);
    const payload = {
      name: formData.name.trim(),
      description: formData.description.trim() || null,
      markdown: formData.markdown.trim() || null,
    };
    const url = editingTemplate
      ? `/api/report-writer/templates/${editingTemplate.id}`
      : "/api/report-writer/templates";
    const method = editingTemplate ? "PATCH" : "POST";
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body?.error?.message ?? "保存失败");
      }
      const savedTemplate: TemplatePayload = body.data;
      setTemplates((prev) =>
        editingTemplate
          ? prev.map((item) =>
              item.id === savedTemplate.id ? savedTemplate : item
            )
          : [savedTemplate, ...prev]
      );
      toast.success(editingTemplate ? "模板已更新" : "模板已创建");
      setDialogOpen(false);
      setEditingTemplate(null);
      setFormData(initialForm);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败，请重试");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDialogOpenChange = (open: boolean) => {
    if (!open) {
      setEditingTemplate(null);
      setFormData(initialForm);
    }
    setDialogOpen(open);
  };

  const handleDelete = async () => {
    if (!editingTemplate) return;
    setIsDeleting(true);
    try {
      const res = await fetch(
        `/api/report-writer/templates/${editingTemplate.id}`,
        { method: "DELETE" }
      );
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body?.error?.message ?? "删除失败");
      }
      setTemplates((prev) =>
        prev.filter((item) => item.id !== editingTemplate.id)
      );
      toast.success("模板已删除");
      setDialogOpen(false);
      setEditingTemplate(null);
      setFormData(initialForm);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败，请重试");
    } finally {
      setIsDeleting(false);
    }
  };

  const insertVariable = (variable: string) => {
    const textarea = markdownTextareaRef.current;
    if (!textarea) return;

    const variableText = `{{${variable}}}`;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentValue = formData.markdown || "";
    const newValue =
      currentValue.slice(0, start) + variableText + currentValue.slice(end);

    setFormData((prev) => ({
      ...prev,
      markdown: newValue,
    }));

    // 设置光标位置到插入文本之后
    setTimeout(() => {
      textarea.focus();
      const newCursorPos = start + variableText.length;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <Input
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="搜索模板"
          icon={<Search size={16} />}
          className="flex-1 min-w-[220px]"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            className="min-w-[160px]"
            onClick={() => openEditor()}
            variant="default"
          >
            <Plus />
            新建模板
          </Button>
          <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editingTemplate ? "编辑模板" : "新建模板"}
                </DialogTitle>
                <DialogDescription>
                  填写模板名称、描述与 Markdown 内容，保存后可以直接在
                  报告写作区复用。
                </DialogDescription>
              </DialogHeader>
              <Separator />
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-muted-foreground">
                    模板名称
                  </label>
                  <Input
                    value={formData.name}
                    onChange={(event) =>
                      setFormData((prev) => ({
                        ...prev,
                        name: event.target.value,
                      }))
                    }
                    placeholder="例如：北约态势分析"
                    autoFocus
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-muted-foreground">
                    模板说明
                  </label>
                  <Textarea
                    value={formData.description}
                    onChange={(event) =>
                      setFormData((prev) => ({
                        ...prev,
                        description: event.target.value,
                      }))
                    }
                    rows={2}
                    placeholder="简要说明这个模板适用的场景"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-muted-foreground">
                    Markdown 内容
                  </label>
                  <Textarea
                    ref={markdownTextareaRef}
                    value={formData.markdown}
                    onChange={(event) =>
                      setFormData((prev) => ({
                        ...prev,
                        markdown: event.target.value,
                      }))
                    }
                    rows={6}
                    placeholder="写作结构或片段（可选）"
                  />
                  <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/30 p-2.5">
                    <p className="text-[11px] font-semibold text-muted-foreground">
                      支持的变量（生成报告时自动替换）：
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(TEMPLATE_VARIABLES).map(
                        ([key, label]) => (
                          <Button
                            key={key}
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => insertVariable(key)}
                            className="h-auto cursor-pointer rounded-md border px-2 py-1 text-[10px] font-mono hover:bg-accent"
                          >
                            <span className="font-semibold">{`{{${key}}}`}</span>
                            <span className="ml-1.5 text-muted-foreground">
                              {label}
                            </span>
                          </Button>
                        )
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      示例：
                      <code className="rounded bg-background px-1 py-0.5 text-[10px]">
                        {"# {{title}}"}
                      </code>{" "}
                      会在生成报告时替换为实际标题
                    </p>
                  </div>
                </div>
              </div>
              <DialogFooter>
                {editingTemplate && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDelete}
                    disabled={isDeleting}
                  >
                    {isDeleting ? "删除中..." : "删除模板"}
                  </Button>
                )}
                <Button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="min-w-[140px]"
                >
                  {isSaving
                    ? "保存中..."
                    : editingTemplate
                      ? "保存更改"
                      : "创建模板"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="max-h-[calc(100vh-170px)] overflow-y-auto">
        {isLoading && (
          <p className="text-sm text-muted-foreground">正在加载模板...</p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {filteredTemplates.map((template) => (
            <ReportTemplateCard
              key={template.id}
              name={template.name}
              description={template.description}
              markdown={template.markdown}
              actions={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openEditor(template)}
                >
                  编辑
                </Button>
              }
            />
          ))}
        </div>
        {!isLoading && filteredTemplates.length === 0 && (
          <p className="text-sm text-muted-foreground">
            暂无符合条件的模板，点击“新建模板”创建。
          </p>
        )}
      </div>
    </div>
  );
};

export default ReportTemplate;
