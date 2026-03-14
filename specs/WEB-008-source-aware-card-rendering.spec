spec: task
name: "WEB-008-source-aware-card-rendering"
tags: [web, ui, social, p1]
---

## 意图

将当前统一 Markdown 卡片升级为按来源类型差异化渲染，提升社媒内容的可读性与筛选效率。

## 已定决策

- 保留统一列表流，但按 `sourceType` 渲染不同卡片模板（news/web/social）。
- 社媒卡片优先展示作者、发布时间、互动指标、线程摘要。
- 卡片展示“命中关键词”与“命中原因”以增强可解释性。

## 边界

### 允许修改
- `apps/web/**`
- `apps/web/lib/types.ts`（仅必要字段扩展）

### 禁止做
- 不改 gather 抓取实现。
- 不改 worker 任务编排。
- 不引入全新设计系统或大规模视觉重构。

## 完成条件

场景: 社媒卡片按专用结构展示
  测试:
    包: apps/web
    过滤: test_social_card_renders_author_metrics_thread
  假设 内容来源为社媒并带互动数据
  当 用户查看内容流
  那么 卡片展示作者、互动指标与线程摘要

场景: 新闻与普通网页卡片不回归
  测试:
    包: apps/web
    过滤: test_news_web_card_backward_compatible
  假设 内容来源为新闻站或普通网页
  当 用户查看内容流
  那么 现有展示能力保持可用且字段完整

场景: 命中原因可解释
  测试:
    包: apps/web
    过滤: test_card_shows_keyword_match_reason
  假设 内容包含 `matchedKeywords`
  当 用户展开卡片详情
  那么 可看到命中词与对应证据片段

## 排除范围

- 不做移动端完全重设计。
- 不做报告编辑页交互改造。
