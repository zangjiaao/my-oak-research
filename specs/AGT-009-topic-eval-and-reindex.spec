spec: task
name: "AGT-009-topic-eval-and-reindex"
tags: [worker, topic, eval, p1]
---

## 意图

在关键词过滤之后新增主题评估与回溯能力，让用户可基于临时主题对历史素材进行再筛选与排序。

## 已定决策

- 引入双标签：`matchedKeywords`（发现层）与 `topicRelevanceScore`（主题层）。
- 主题支持 `lookbackDays` 回溯窗口（默认 30 天）。
- 主题评估由 worker 异步执行，避免阻塞抓取链路。

## 边界

### 允许修改
- `apps/worker/**`
- `apps/web/**`（主题配置与触发入口）
- `packages/agents/**`（主题评估逻辑）
- Prisma schema 与迁移文件

### 禁止做
- 不改变 gather 的抓取驱动实现。
- 不做复杂在线训练。

## 完成条件

场景: 新命中内容可获得主题分
  测试:
    包: apps/worker
    过滤: test_topic_eval_on_new_content
  假设 用户存在激活主题且内容已命中关键词
  当 worker 执行主题评估任务
  那么 写入 `topicRelevanceScore` 与评估理由

场景: 回溯任务按窗口重评历史内容
  测试:
    包: apps/worker
    过滤: test_topic_reindex_lookback_window
  假设 用户触发主题回溯且 `lookbackDays=90`
  当 worker 执行 `topic-reindex` 任务
  那么 仅处理最近 90 天内容并写入评估结果

场景: 前端可按主题分排序筛选
  测试:
    包: apps/web
    过滤: test_feed_filter_by_topic_score
  假设 内容已存在主题分
  当 用户选择主题筛选
  那么 列表按主题相关度返回并可分页浏览

## 排除范围

- 不实现自动主题生成。
- 不做多租户主题隔离重构。
