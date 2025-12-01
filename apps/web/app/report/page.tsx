"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

const highlights = [
  {
    title: "交互式编辑",
    description:
      "设定提示、添加素材、选择模板，LLM 在右侧生成初稿并可继续对话调整。",
    detail: "进入写作区后，左侧配置栏可收缩，聊天与草稿可同时并排查看。",
    href: "/report/editor",
    action: "开始写作",
  },
  {
    title: "模板库",
    description: "管理公司标准模板、共享案例，供写作时快速引用。",
    detail: "创建、编辑或克隆模板以确保输出风格稳定。",
    href: "/report/template",
    action: "维护模板",
  },
  {
    title: "报告管理",
    description: "查看所有草稿、审核流程与历史版本，支持搜索与收藏。",
    detail: "点击进入即可跟踪发布状态、重新生成或继续编辑。",
    href: "/report/manage",
    action: "查看报告",
  },
];

const Report = () => {
  return (
    <div className="space-y-6 pb-6">
      <div className="grid gap-4 lg:grid-cols-3">
        {highlights.map((item) => (
          <div
            key={item.title}
            className="flex flex-col justify-between rounded-2xl border bg-card p-6 shadow-sm transition hover:shadow"
          >
            <div className="space-y-2">
              <p className="text-lg font-semibold">{item.title}</p>
              <p className="text-sm text-muted-foreground">
                {item.description}
              </p>
            </div>
            <div className="mt-4 space-y-1 text-xs text-muted-foreground">
              <p>{item.detail}</p>
              <div className="flex items-center justify-between">
                <span className="text-[13px] uppercase tracking-[0.3em]">
                  {item.action}
                </span>
                <Button asChild variant="ghost" size="sm">
                  <Link href={item.href}>
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Report;
