"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  Paperclip,
  RefreshCw,
  Save,
  Sparkles,
} from "lucide-react";

type Template = {
  id: string;
  name: string;
  description?: string | null;
  markdown?: string | null;
  metadata?: unknown;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type SectionDraft = {
  heading: string;
  content: string;
  references?: string[];
};

type ReportDraft = {
  title: string;
  summary: string;
  markdown: string;
  sections: SectionDraft[];
};

type MaterialOption = {
  id: string;
  title: string;
  description: string;
  sourceType: "FAVORITE" | "KNOWLEDGE";
  sourceId: string;
  snippet: string;
  metadata?: Record<string, string>;
};

const curatedMaterials: MaterialOption[] = [
  {
    id: "material-report-1",
    title: "关注速报 · 北约动态",
    description: "包含北约军事部署与外交声明摘要",
    sourceType: "FAVORITE",
    sourceId: "ck0xz8svw000001q9k8u30ktr",
    snippet:
      "北约公布了下一阶段快速反应部队部署计划，并强调乌克兰安全仍为核心议题。",
    metadata: { platform: "focus-bulletin", tag: "北约" },
  },
  {
    id: "material-report-2",
    title: "知识库 · 能源安全分析",
    description: "能源与粮食相关的情报资料",
    sourceType: "KNOWLEDGE",
    sourceId: "ck0xz8sww000002q9c2iqihtb",
    snippet:
      "俄罗斯乌克兰冲突导致全球能源价格震荡，天然气转运与储备成关键变量。",
    metadata: { category: "能源", relevance: "high" },
  },
  {
    id: "material-report-3",
    title: "关注速报 · 社交媒体态势",
    description: "社交媒体抓取的热门关键词与情绪",
    sourceType: "FAVORITE",
    sourceId: "ck0xz8sww000003q9w3b2h4uc",
    snippet: "多语言社交媒体在讨论俄罗斯战略调整、乌克兰防御以及国际援助进展。",
    metadata: { platform: "social-stream", signal: "sentiment" },
  },
];

const recommendedModels = ["deepseek-v3.1", "gpt-4", "gpt-5"];

const initialPrompt =
  "请以情报分析视角，结合当前的俄乌战争动态，总结出本期需要关注的战略节点、风险与推荐行动。";

const initialMessages: ChatMessage[] = [
  {
    id: "chat-init-1",
    role: "assistant",
    content:
      "欢迎使用报告写作工作区。请先设定主题、模板与素材，随后我会为你生成初版草稿。",
  },
  {
    id: "chat-init-2",
    role: "user",
    content: "准备好了，请就“俄乌战争”提供一份情报级别的分析报告。",
  },
];

const createMessageId = () =>
  typeof crypto !== "undefined"
    ? (crypto.randomUUID?.() ?? `msg-${Math.random().toString(36).slice(2, 9)}`)
    : `msg-${Math.random().toString(36).slice(2, 9)}`;

type ReportDetail = {
  id: string;
  title: string;
  summary?: string | null;
  markdown?: string | null;
  templateId?: string | null;
  materials?: Array<{
    id: string;
    sourceType: string;
    sourceId: string;
    title?: string | null;
    snippet?: string | null;
  }>;
};

const ReportEditor = () => {
  const searchParams = useSearchParams();
  const reportIdFromUrl = searchParams.get("reportId");

  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateLoading, setTemplateLoading] = useState(true);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<string[]>([]);
  const [chatMessages, setChatMessages] =
    useState<ChatMessage[]>(initialMessages);
  const [chatInput, setChatInput] = useState("");
  const [reportDraft, setReportDraft] = useState<ReportDraft | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [temperature, setTemperature] = useState(0.45);
  const [model, setModel] = useState<string>();
  const [currentReportId, setCurrentReportId] = useState<string | null>(null);
  const [isLoadingReport, setIsLoadingReport] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // 加载模板列表
  useEffect(() => {
    let isMounted = true;
    setTemplateLoading(true);
    fetch("/api/report-writer/templates")
      .then((res) => res.json())
      .then((payload) => {
        if (!isMounted) return;
        if (payload?.success) {
          setTemplates(payload.data ?? []);
        } else {
          toast.error(payload?.error?.message ?? "无法加载报告模板");
        }
      })
      .catch(() => toast.error("无法加载报告模板"))
      .finally(() => {
        if (isMounted) {
          setTemplateLoading(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  // 从 URL 参数加载报告内容
  useEffect(() => {
    if (!reportIdFromUrl) return;

    let isMounted = true;
    setIsLoadingReport(true);

    fetch(`/api/report-writer/reports/${reportIdFromUrl}`)
      .then((res) => res.json())
      .then((payload) => {
        if (!isMounted) return;
        if (!payload?.success) {
          toast.error(payload?.error?.message ?? "无法加载报告");
          return;
        }

        const report: ReportDetail = payload.data;

        // 设置当前报告 ID
        setCurrentReportId(report.id);

        // 填充报告内容到编辑器
        if (report.markdown) {
          setReportDraft({
            title: report.title,
            summary: report.summary || "",
            markdown: report.markdown,
            sections: [], // 报告详情 API 可能不返回 sections，先设为空数组
          });
        }

        // 设置模板
        if (report.templateId) {
          setSelectedTemplateId(report.templateId);
        }

        // 设置素材（如果有）
        if (report.materials && report.materials.length > 0) {
          // 尝试匹配素材到 curatedMaterials
          const matchedMaterialIds = report.materials
            .map((material) => {
              const found = curatedMaterials.find(
                (m) =>
                  m.sourceType === material.sourceType &&
                  m.sourceId === material.sourceId
              );
              return found?.id;
            })
            .filter((id): id is string => !!id);
          setSelectedMaterialIds(matchedMaterialIds);
        }

        // 更新聊天消息，提示已加载报告
        setChatMessages([
          {
            id: createMessageId(),
            role: "assistant",
            content: `已加载报告「${report.title}」，你可以继续编辑或生成新内容。`,
          },
        ]);

        // 如果已有内容，自动收起配置栏
        if (report.markdown) {
          setCollapsed(true);
        }

        toast.success("报告已加载到编辑器");
      })
      .catch((error) => {
        console.error("加载报告失败:", error);
        toast.error("加载报告失败，请稍后重试");
      })
      .finally(() => {
        if (isMounted) {
          setIsLoadingReport(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [reportIdFromUrl]);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId),
    [selectedTemplateId, templates]
  );

  const selectedMaterials = useMemo(
    () =>
      curatedMaterials.filter((material) =>
        selectedMaterialIds.includes(material.id)
      ),
    [selectedMaterialIds]
  );

  const canGenerate = prompt.trim().length >= 20 && !isGenerating;

  const handleToggleMaterial = (id: string) => {
    setSelectedMaterialIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleReset = () => {
    setReportDraft(null);
    setChatMessages(initialMessages);
    setCollapsed(false);
    setSelectedMaterialIds([]);
    setChatInput("");
    setCurrentReportId(null);
  };

  const handleSaveReport = async () => {
    if (!reportDraft) {
      toast.error("没有可保存的内容");
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        title: reportDraft.title,
        summary: reportDraft.summary || null,
        markdown: reportDraft.markdown || null,
        templateId: selectedTemplateId || null,
        status: "DRAFT" as const,
        materials: materialPayload,
      };

      let response: Response;
      let body: {
        success: boolean;
        error?: { message: string };
        data?: { id: string };
      };

      if (currentReportId) {
        // 更新现有报告
        response = await fetch(
          `/api/report-writer/reports/${currentReportId}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          }
        );
        body = await response.json();
        if (!response.ok || !body.success) {
          throw new Error(body?.error?.message ?? "保存失败");
        }
        toast.success("报告已更新");
      } else {
        // 创建新报告
        response = await fetch("/api/report-writer/reports", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-id": "demo-user", // TODO: 从 session 获取真实用户 ID
          },
          body: JSON.stringify(payload),
        });
        body = await response.json();
        if (!response.ok || !body.success) {
          throw new Error(body?.error?.message ?? "创建失败");
        }
        // 设置新创建的报告 ID
        setCurrentReportId(body.data?.id ?? "");
        toast.success("报告已创建并保存");
      }

      setChatMessages((prev) => [
        ...prev,
        {
          id: createMessageId(),
          role: "assistant",
          content: `报告「${reportDraft.title}」已${currentReportId ? "更新" : "创建"}成功。`,
        },
      ]);
    } catch (error) {
      console.error("保存报告失败:", error);
      toast.error(
        error instanceof Error ? error.message : "保存失败，请稍后重试"
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddSection = () => {
    setReportDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        sections: [
          ...prev.sections,
          { heading: "新章节标题", content: "在此撰写内容。", references: [] },
        ],
      };
    });
  };

  const handleSectionChange = (
    index: number,
    field: "heading" | "content",
    value: string
  ) => {
    setReportDraft((prev) => {
      if (!prev) return prev;
      const updated = prev.sections.map((section, sectionIndex) =>
        sectionIndex === index ? { ...section, [field]: value } : section
      );
      return { ...prev, sections: updated };
    });
  };

  const materialPayload = useMemo(
    () =>
      selectedMaterials.map((material) => ({
        sourceType: material.sourceType,
        sourceId: material.sourceId,
        title: material.title,
        snippet: material.snippet,
        metadata: material.metadata,
      })),
    [selectedMaterials]
  );

  const generateDraft = async (followUp?: string) => {
    if (!canGenerate) return;
    setIsGenerating(true);
    const promptParts = [prompt.trim()];
    if (followUp) {
      promptParts.push(`后续指令：${followUp.trim()}`);
    }
    const payload = {
      prompt: promptParts.join("\n\n"),
      templateId: selectedTemplateId,
      materials: materialPayload,
      options: {
        model: model || undefined,
        temperature,
      },
    };

    try {
      const response = await fetch("/api/report-writer/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": "demo-user",
        },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok || !body.success) {
        throw new Error(body?.error?.message ?? "生成失败，请稍后重试");
      }

      const data = body.data as ReportDraft;
      setReportDraft({
        title: data.title,
        summary: data.summary,
        markdown: data.markdown,
        sections: data.sections ?? [],
      });
      setChatMessages((prev) => [
        ...prev,
        {
          id: createMessageId(),
          role: "assistant",
          content: `草稿「${data.title}」已生成，摘要：${data.summary.slice(
            0,
            120
          )}`,
        },
      ]);
      setCollapsed(true);
      toast.success("已生成报告草稿");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "生成失败，请稍后重试或调整提示词"
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleChatSubmit = async () => {
    const trimmed = chatInput.trim();
    if (!trimmed) return;
    setChatInput("");
    setChatMessages((prev) => [
      ...prev,
      { id: createMessageId(), role: "user", content: trimmed },
    ]);
    await generateDraft(trimmed);
  };

  return (
    <div className="space-y-6">
      <div className="flex h-[calc(100vh-7rem)] flex-col gap-4 lg:flex-row">
        <aside
          className={cn(
            "flex flex-col gap-4 rounded-2xl border bg-card p-4 transition-all duration-300 lg:flex-shrink-0",
            collapsed ? "w-16" : "w-1/4"
          )}
        >
          {collapsed ? (
            <button
              type="button"
              aria-label="展开配置面板"
              className="group flex h-full w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background/70 text-muted-foreground transition hover:border-primary"
              onClick={() => setCollapsed(false)}
            >
              <Sparkles className="size-5 text-primary" />
              <span className="text-[11px] uppercase tracking-[0.4em] text-muted-foreground">
                配置
              </span>
            </button>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-lg font-semibold">编写大纲</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setCollapsed(true)}
                  aria-label="收起配置区"
                >
                  <ChevronLeft className="size-4" />
                </Button>
              </div>

              <div className="flex flex-1 flex-col gap-4 overflow-y-auto pr-1 scrollbar-hide">
                <Card>
                  <CardHeader>
                    <CardTitle>选择模板</CardTitle>
                    <CardDescription className="max-w-[90%]">
                      选择一个模板可以让 LLM 更好地把握章节结构与语气。
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Select
                      value={selectedTemplateId}
                      onValueChange={(value) =>
                        setSelectedTemplateId(value || undefined)
                      }
                      disabled={templateLoading}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="请选择模板" />
                      </SelectTrigger>
                      <SelectContent>
                        {templateLoading && (
                          <SelectItem value="loading" disabled>
                            正在加载…
                          </SelectItem>
                        )}
                        {!templateLoading && templates.length === 0 && (
                          <SelectItem value="no-templates" disabled>
                            暂无模板
                          </SelectItem>
                        )}
                        {templates.map((template) => (
                          <SelectItem key={template.id} value={template.id}>
                            {template.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedTemplate ? (
                      <div className="space-y-1 text-sm text-muted-foreground">
                        <p>{selectedTemplate.description ?? "无描述"}</p>
                        {selectedTemplate.markdown && (
                          <p className="text-xs text-muted-foreground/80 line-clamp-2">
                            {selectedTemplate.markdown}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        暂未选择模板，LLM 会以通用结构展开。
                      </p>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedTemplateId(undefined)}
                      disabled={!selectedTemplateId}
                    >
                      清除模板
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>提示词 / 要求</CardTitle>
                    <CardDescription>
                      越具体越好，可补充结构、语气、目标受众。
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Textarea
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      rows={6}
                      className="min-h-[140px]"
                      placeholder="Describe what you expect the report to cover."
                    />
                    <p className="text-xs text-muted-foreground">
                      当前字数：{prompt.trim().length}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>报告素材</CardTitle>
                    <CardDescription>选择素材会降低写作偏差。</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-col gap-2">
                      {curatedMaterials.map((material) => {
                        const selected = selectedMaterialIds.includes(
                          material.id
                        );
                        return (
                          <button
                            type="button"
                            key={material.id}
                            onClick={() => handleToggleMaterial(material.id)}
                            className={cn(
                              "flex w-full flex-col gap-1 rounded-lg border px-3 py-2 text-left transition hover:border-primary",
                              selected
                                ? "border-primary bg-primary/10"
                                : "border-border"
                            )}
                          >
                            <div className="flex items-center justify-between">
                              <p className="text-sm font-medium">
                                {material.title}
                              </p>
                              <Badge variant="outline">
                                {selected ? "已选" : "添加"}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {material.description}
                            </p>
                            <p className="text-xs text-muted-foreground/80">
                              {material.snippet}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedMaterials.map((material) => (
                        <Badge key={material.id} variant="secondary">
                          {material.title}
                        </Badge>
                      ))}
                      {!selectedMaterials.length && (
                        <span className="text-xs text-muted-foreground">
                          暂无素材
                        </span>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedMaterialIds([])}
                      disabled={!selectedMaterials.length}
                    >
                      <Paperclip className="size-4" />
                      清除选择
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>模型与采样</CardTitle>
                    <CardDescription>
                      由 LLM Gateway 路由，默认模型为 DeepSeek。
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Select
                      value={model}
                      onValueChange={(value) => setModel(value || undefined)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="选择模型（可留空）" />
                      </SelectTrigger>
                      <SelectContent>
                        {recommendedModels.map((modelOption) => (
                          <SelectItem key={modelOption} value={modelOption}>
                            {modelOption}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span>temperature</span>
                        <span className="font-semibold">
                          {temperature.toFixed(2)}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={temperature}
                        onChange={(event) =>
                          setTemperature(Number(event.target.value))
                        }
                        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-border accent-primary"
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setModel(undefined)}
                      disabled={!model}
                    >
                      清除模型
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>操作</CardTitle>
                    <CardDescription>
                      生成草稿后可以继续沟通或手动编辑。
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Button
                      onClick={() => generateDraft()}
                      disabled={!canGenerate}
                      className="w-full"
                    >
                      {isGenerating ? "生成中..." : "开始写作"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleReset}
                      className="w-full"
                    >
                      <RefreshCw className="size-4" />
                      重置工作区
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      {selectedMaterials.length} 条素材、
                      {selectedTemplate ? "已选模板" : "未选模板"}。
                    </p>
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </aside>

        <div className="flex flex-1 flex-col gap-4 lg:w-[36%]">
          <Card className="flex flex-1 flex-col">
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle>与 LLM 协作</CardTitle>
                  <CardDescription>随时提问或调整报告方向。</CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setChatMessages(initialMessages);
                  }}
                >
                  清空对话
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3">
              <div className="flex-1 space-y-3 overflow-y-auto pr-1 scrollbar-hide">
                {chatMessages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      "flex gap-3",
                      message.role === "user" ? "justify-start" : "justify-end"
                    )}
                  >
                    {message.role === "user" && (
                      <Avatar>
                        <AvatarImage src="https://github.com/evilrabbit.png" />
                        <AvatarFallback>你</AvatarFallback>
                      </Avatar>
                    )}
                    <div
                      className={cn(
                        "rounded-2xl px-4 py-3 max-w-[70%] text-sm break-words whitespace-pre-line",
                        message.role === "user"
                          ? "bg-blue-100 text-blue-900"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      {message.content}
                    </div>
                    {message.role === "assistant" && (
                      <Avatar>
                        <AvatarImage src="https://github.com/shadcn.png" />
                        <AvatarFallback>LLM</AvatarFallback>
                      </Avatar>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex gap-3">
                <Input
                  placeholder="请输入想法，按回车可快速发送"
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      handleChatSubmit();
                    }
                  }}
                  disabled={isGenerating}
                />
                <Button
                  onClick={handleChatSubmit}
                  disabled={!chatInput.trim() || isGenerating}
                >
                  发送
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto lg:w-[36%] scrollbar-hide">
          <Card className="flex flex-col gap-3">
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle>当前草稿</CardTitle>
                  <CardDescription>
                    你可以实时编辑标题、摘要与 Markdown 内容。
                    {currentReportId && (
                      <span className="block mt-1 text-xs text-muted-foreground">
                        正在编辑报告 ID: {currentReportId.slice(0, 8)}...
                      </span>
                    )}
                  </CardDescription>
                </div>
                {reportDraft && (
                  <Button
                    onClick={handleSaveReport}
                    disabled={isSaving}
                    size="sm"
                    variant="default"
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {isSaving
                      ? "保存中..."
                      : currentReportId
                        ? "保存"
                        : "创建并保存"}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {reportDraft ? (
                <>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-muted-foreground">
                      标题
                    </label>
                    <Input
                      value={reportDraft.title}
                      onChange={(event) =>
                        setReportDraft((prev) =>
                          prev ? { ...prev, title: event.target.value } : prev
                        )
                      }
                      placeholder="报告标题"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-muted-foreground">
                      摘要
                    </label>
                    <Textarea
                      value={reportDraft.summary}
                      onChange={(event) =>
                        setReportDraft((prev) =>
                          prev ? { ...prev, summary: event.target.value } : prev
                        )
                      }
                      rows={3}
                      placeholder="摘要（150~200字）"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-muted-foreground">
                      Markdown（可编辑）
                    </label>
                    <Textarea
                      value={reportDraft.markdown}
                      onChange={(event) =>
                        setReportDraft((prev) =>
                          prev
                            ? { ...prev, markdown: event.target.value }
                            : prev
                        )
                      }
                      rows={8}
                      placeholder="Markdown 内容，可直接编辑"
                    />
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  尚未生成草稿，点击左侧“开始写作”即可快速得到初版报告。
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="flex flex-col gap-3">
            <CardHeader className="flex items-center justify-between gap-2">
              <div>
                <CardTitle>章节与引用</CardTitle>
                <CardDescription>
                  调整章节标题、内容与引用来源。
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleAddSection}
                disabled={!reportDraft}
              >
                添加章节
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {reportDraft && reportDraft.sections.length > 0 ? (
                reportDraft.sections.map((section, index) => (
                  <div
                    key={`${section.heading}-${index}`}
                    className="flex flex-col gap-2 rounded-lg border border-border/60 p-3"
                  >
                    <Input
                      value={section.heading}
                      onChange={(event) =>
                        handleSectionChange(
                          index,
                          "heading",
                          event.target.value
                        )
                      }
                      placeholder={`第 ${index + 1} 章标题`}
                      className="text-sm font-semibold"
                    />
                    <Textarea
                      value={section.content}
                      onChange={(event) =>
                        handleSectionChange(
                          index,
                          "content",
                          event.target.value
                        )
                      }
                      rows={4}
                      placeholder="章节内容"
                    />
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {(section.references ?? []).length > 0 ? (
                        section.references?.map((ref) => (
                          <Badge key={ref} variant="outline">
                            {ref}
                          </Badge>
                        ))
                      ) : (
                        <span>暂无引用</span>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  目前还没有章节内容，之后生成草稿会自动填充，也可以手动添加。
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default ReportEditor;
