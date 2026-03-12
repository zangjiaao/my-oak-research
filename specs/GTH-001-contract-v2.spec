spec: task
name: "GTH-001-contract-v2"
tags: [gather, contract, p0]
---

## 意图

为 `apps/gather` 建立稳定的 v2 API 契约，确保后续 driver 和 PoC 可以并行开发且不反复改接口。

## 已定决策

- 保留 `/fetch` 作为兼容入口。
- 新增 `/v2/fetch` 作为新契约入口。
- 统一错误结构为 `{ error: { code, message, retryable } }`。
- `CleanItem` 在 v1/v2 保持核心字段一致，可扩展 `driver` 字段。

## 边界

### 允许修改
- `apps/gather/main.py`
- `apps/gather/README.md`
- `apps/gather/tests/**`（如目录不存在可新增）

### 禁止做
- 不实现 `agent-browser` 驱动细节。
- 不改 `apps/web/**` 与 `apps/worker/**`。
- 不做无关重构。

## 完成条件

场景: v2 正常请求返回结构化数据
  测试:
    包: apps/gather
    过滤: test_fetch_v2_happy_path
  假设 请求体满足 v2 schema
  当 调用 `/v2/fetch`
  那么 返回状态码 `200`，响应为数组，且每个元素至少包含 `text/platform/sourceId/sourceType` 字段

场景: 参数错误返回统一错误结构
  测试:
    包: apps/gather
    过滤: test_fetch_v2_validation_error
  假设 请求缺失必填字段
  当 调用 `/v2/fetch`
  那么 返回统一 `error.code/error.message/error.retryable`

场景: 兼容接口行为不回归
  测试:
    包: apps/gather
    过滤: test_fetch_v1_backward_compat
  假设 旧版 `/fetch` 请求
  当 调用 `/fetch`
  那么 返回状态码 `200` 且响应仍为数组结构（每项包含 `text/platform/sourceId/sourceType`）

## 排除范围

- 不做跨平台采集策略迁移。
- 不做 worker/web 接入改造。
