spec: task
name: "AGT-010-feedback-to-ranking"
tags: [worker, feedback, ranking, p2]
---

## 意图

将用户收藏行为转化为可持续优化信号，提升关键词命中质量与主题排序准确性。

## 已定决策

- 收藏/取消收藏事件进入异步反馈队列，不在请求链路同步计算。
- 第一阶段采用规则法权重更新，不引入模型训练平台。
- 所有反馈更新记录可追溯，支持回放与审计。

## 边界

### 允许修改
- `apps/web/**`（收藏事件投递）
- `apps/worker/**`（反馈消费与权重更新）
- `packages/agents/**`（排序策略实现）
- Prisma schema 与迁移文件

### 禁止做
- 不做实时在线学习推理。
- 不改动用户收藏交互基础行为。

## 完成条件

场景: 收藏事件触发权重上调
  测试:
    包: apps/worker
    过滤: test_feedback_favorite_increases_keyword_weight
  假设 用户收藏带关键词命中的内容
  当 worker 消费反馈事件
  那么 对应关键词权重按规则上调

场景: 取消收藏触发权重回退
  测试:
    包: apps/worker
    过滤: test_feedback_unfavorite_decreases_keyword_weight
  假设 用户取消已收藏内容
  当 worker 消费反馈事件
  那么 对应权重按规则回退并保留最小阈值

场景: 反馈可改善排序结果
  测试:
    包: apps/web
    过滤: test_feed_ranking_changes_after_feedback
  假设 同一用户已累积反馈样本
  当 用户再次查看内容流
  那么 高价值内容排序相对提升

## 排除范围

- 不做跨用户协同过滤。
- 不做黑盒自动关键词扩展。
