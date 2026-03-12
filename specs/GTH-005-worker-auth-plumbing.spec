spec: task
name: "GTH-005-worker-auth-plumbing"
tags: [worker, gather, auth, p0]
---

## 意图

补齐 worker 调用 gather 时的认证透传链路，避免社交源抓取因缺失认证直接失败。

## 已定决策

- worker 在调用 gather 时透传 `auth_data` 或可解析的认证引用。
- 认证缺失时返回明确错误，不做静默吞错。
- 禁止日志泄露 cookies/token 等敏感信息。

## 边界

### 允许修改
- `apps/worker/**`
- `apps/web/lib/types.ts`（仅必要类型扩展）

### 禁止做
- 不改 gather driver 内核。
- 不改前端页面组件。

## 完成条件

场景: 社交源请求携带认证
  测试:
    包: apps/worker
    过滤: test_fetch_social_source_with_auth
  假设 source 可解析 credential
  当 worker 调用 gather `/fetch` 或 `/v2/fetch`
  那么 请求体包含认证字段

场景: 认证缺失返回明确错误
  测试:
    包: apps/worker
    过滤: test_fetch_social_source_missing_auth
  假设 source 无可用 credential
  当 worker 发起抓取
  那么 返回包含平台与 sourceId 的可观测错误

场景: 认证缺失时返回明确错误，不做静默吞错
  测试:
    包: apps/worker
    过滤: test_fetch_social_source_missing_auth_no_silent_fallback
    Level: integration
    Test Double: gather service error stub
    Targets: error propagation instead of silent fallback success
  假设 source 无可用 credential 且 gather 不可用
  当 worker 执行社交源抓取
  那么 返回错误码 `AUTH_MISSING`（或等价错误）并记录 `error` 级别日志，且不产生成功状态结果

场景: 日志不泄露敏感认证字段
  测试:
    包: apps/worker
    过滤: test_fetch_social_source_log_redaction
    Level: integration
    Test Double: logger capture sink
    Targets: cookies/token fields redacted in logs
  假设 请求体含 cookies/token/auth_data
  当 worker 记录错误或调试日志
  那么 日志不包含 cookie 值、token 明文和完整 auth_data payload

场景: 非社交源行为不回归
  测试:
    包: apps/worker
    过滤: test_non_social_sources_unchanged
  假设 web/search/darknet 源抓取
  当 任务执行
  那么 行为与之前一致

## 排除范围

- 不实现新的 gather API 契约。
- 不做采集平台逻辑重构。
