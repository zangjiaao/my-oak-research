spec: task
name: "RPT-011-report-citation-traceability"
tags: [report, rag, traceability, p1]
---

## 意图

为报告生成链路补齐引用追踪，确保 AI 输出可核验、可回溯，降低幻觉风险。

## 已定决策

- 报告生成时保留段落级引用（`contentId/sourceUrl/fetchedAt`）。
- 支持输出“带引用 Markdown”和“纯正文 Markdown”两种版本。
- 引用缺失时明确标注，不静默忽略。

## 边界

### 允许修改
- `apps/web/**`
- `apps/worker/**`（如报告任务在 worker 执行）
- `packages/agents/**`（报告拼装与引用注入）

### 禁止做
- 不更换现有 RAG 基础架构。
- 不改文件上传与知识库入口能力。

## 完成条件

场景: 报告段落附带来源引用
  测试:
    包: packages/agents
    过滤: test_report_paragraph_has_citations
  假设 报告素材包含抓取内容与知识库片段
  当 生成带引用版本报告
  那么 每个结论段落包含至少一个可追踪引用

场景: 可导出纯正文版本
  测试:
    包: apps/web
    过滤: test_report_export_plain_markdown
  假设 用户选择纯正文导出
  当 执行导出
  那么 输出不含引用块但保留正文结构

场景: 引用缺失可观测
  测试:
    包: packages/agents
    过滤: test_report_missing_citation_flagged
  假设 某段内容无法匹配来源
  当 生成带引用版本
  那么 输出明确缺失标记并记录结构化告警

## 排除范围

- 不做自动事实核查引擎。
- 不做多格式（PDF/Docx）排版优化。
