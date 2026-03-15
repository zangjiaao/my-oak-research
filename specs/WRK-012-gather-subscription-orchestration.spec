spec: task
name: "WRK-012-gather-subscription-orchestration"
tags: [worker, gather, orchestration, schedule, p0]
---

## 意图

在 `apps/worker` 落地订阅式采集编排，按用户设定频率触发 gather API 执行短任务抓取，支持“关注对象 + 定时检查 + 增量入库”闭环。

## 已定决策

- 编排层放在 `apps/worker`（BullMQ repeatable jobs），`apps/gather` 只负责单次执行。
- 采用“定时拉取短任务”，不使用常驻浏览器进程持续刷新页面。
- 通过 `lastCursor`/`externalId` 实现增量识别，避免重复处理。
- 采集结果仍遵循 gather 关键词硬过滤策略，命中才入主库。

## 边界

### 允许修改
- `apps/worker/**`
- `apps/web/**`（仅订阅配置与任务触发 API）
- `apps/gather/**`（仅必要请求字段兼容，不改 driver 内核）
- Prisma schema 与迁移文件（订阅与游标字段）

### 禁止做
- 不重构 gather driver 架构。
- 不实现主题评估与训练闭环。
- 不做前端大规模 UI 改版。

## 完成条件

场景: 创建订阅后自动注册周期任务
  测试:
    包: apps/worker
    过滤: test_subscription_registers_repeatable_job
  假设 用户创建“30分钟检查一次”订阅
  当 订阅保存成功
  那么 worker 注册对应 repeat job 且频率与订阅一致

场景: 周期任务按编排调用 gather
  测试:
    包: apps/worker
    过滤: test_subscription_job_calls_gather_with_script_scenario
  假设 订阅平台为社媒并配置 `agent-browser` 场景
  当 周期任务触发
  那么 worker 调用 gather API 并携带 `driver/scriptScenario/authRef/target`

场景: 增量游标防止重复入库
  测试:
    包: apps/worker
    过滤: test_subscription_cursor_prevents_duplicate_ingestion
  假设 上次任务已记录 `lastCursor`
  当 本轮抓取返回历史与新内容混合结果
  那么 仅新内容进入后续流程并更新 `lastCursor`

场景: 任务失败具备重试与可观测错误
  测试:
    包: apps/worker
    过滤: test_subscription_job_retry_and_error_observability
  假设 gather 超时或返回可重试错误
  当 worker 执行任务失败
  那么 按退避策略重试并记录结构化错误日志

场景: 编排不引入常驻浏览器
  测试:
    包: apps/worker
    过滤: test_subscription_job_is_short_lived_no_persistent_browser
  假设 多个订阅并发运行
  当 执行调度周期
  那么 每次仅触发短生命周期抓取任务且任务结束即释放资源

## 排除范围

- 不做跨平台统一脚本 DSL。
- 不做历史订阅数据自动迁移工具。
