spec: task
name: "GTH-002-driver-abstraction"
tags: [gather, driver, p0]
---

## 意图

将 gather 从平台分支直连实现改造为 driver 抽象 + registry 分发，降低后续引擎切换成本。

## 已定决策

- 新增 `BaseDriver` 抽象，最小方法为 `verify_auth` 与 `fetch`。
- 新增 `DriverRegistry`，支持默认 driver 和显式 driver 选择。
- 默认 driver 暂时仍使用现有 Playwright 路径。

## 边界

### 允许修改
- `apps/gather/**`

### 禁止做
- 不改 `apps/web/**`、`apps/worker/**`。
- 不做全平台 client 重写。

## 完成条件

场景: registry 默认回退
  测试:
    包: apps/gather
    过滤: test_driver_registry_default_fallback
  假设 未传 driver 参数
  当 执行 fetch 分发
  那么 使用默认 driver 且可正常执行

场景: 指定不存在 driver
  测试:
    包: apps/gather
    过滤: test_driver_registry_not_found
  假设 传入未知 driver 名称
  当 执行 fetch 分发
  那么 返回可识别错误码

场景: v2 支持显式 driver
  测试:
    包: apps/gather
    过滤: test_fetch_v2_driver_selected
  假设 `/v2/fetch` 传入 driver
  当 请求执行
  那么 按 registry 选择对应 driver

## 排除范围

- 不验证 response body / profile 稳定性 PoC。
- 不改前端或 worker 的调用链路。
