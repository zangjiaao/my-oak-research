spec: task
name: "GTH-006-gather-keyword-hard-filter"
tags: [gather, keyword, filter, p0]
---

## 意图

在 `apps/gather` 侧落地关键词硬过滤，确保未命中内容不进入主内容库，控制抓取规模与后续解析成本。

## 已定决策

- 关键词过滤发生在 gather 抓取与清洗之后、入库之前。
- 只对命中内容入主库；未命中内容只写轻量审计日志。
- 命中结果写入结构化字段：`matchedKeywords`、`keywordMatchScore`。

## 边界

### 允许修改
- `apps/gather/**`
- `apps/web/lib/types.ts`（仅必要类型扩展）
- `apps/worker/**`（仅必要入队/消费字段兼容）

### 禁止做
- 不改报告生成链路。
- 不实现主题打分逻辑。
- 不引入高成本模型作为第一层过滤依赖。

## 完成条件

场景: 命中关键词的内容可入库
  测试:
    包: apps/gather
    过滤: test_keyword_hit_content_persisted
  假设 抓取内容命中至少一个用户关键词
  当 执行 gather 流程
  那么 内容成功入库并带有 `matchedKeywords/keywordMatchScore`

场景: 未命中内容不入主库
  测试:
    包: apps/gather
    过滤: test_keyword_miss_content_not_persisted
  假设 抓取内容未命中任何关键词
  当 执行 gather 流程
  那么 内容不入主库且生成轻量审计记录

场景: 只对命中内容入主库；未命中内容只写轻量审计日志
  测试:
    包: apps/gather
    过滤: test_keyword_hit_only_persisted_miss_audit_only
    Level: integration
    Targets: verify decision "hit -> main store, miss -> audit only"
  假设 同一批次同时包含命中与未命中内容
  当 执行 gather 流程
  那么 只对命中内容入主库；未命中内容只写轻量审计日志

场景: 过滤过程具备可观测性
  测试:
    包: apps/gather
    过滤: test_keyword_filter_metrics_emitted
  假设 一次抓取批次包含命中与未命中内容
  当 执行 gather 流程
  那么 输出 `fetched/hit/miss/persisted` 指标

场景: 关键词配置非法时流程失败并阻止入库
  测试:
    包: apps/gather
    过滤: test_keyword_filter_invalid_config_fails_closed
    Level: integration
    Test Double: malformed keyword config fixture
    Targets: fail closed; no main-store write; error log emitted
  假设 关键词配置为空或包含非法值导致过滤器不可用
  当 执行 gather 流程
  那么 返回可观测错误且本批次不写入主库

## 排除范围

- 不做关键词扩展与学习闭环。
- 不做前端筛选 UI 改造。
