spec: task
name: "GTH-003-agent-browser-responsebody-poc"
inherits: project
tags: [gather, agent-browser, cdp, poc, p0]
---

## 意图

验证 `agent-browser + CDP` 在目标平台上能否稳定获取关键 HTTP API 的 response body。

## 已定决策

- 仅做 PoC，不切默认 driver。
- PoC 输出必须包含可重复命令、样本统计和失败分类。
- 报告落盘到 `specs/reports/GTH-003-report.md`。

## 边界

### 允许修改
- `apps/gather/**`
- `specs/reports/GTH-003-report.md`

### 禁止做
- 不改 `apps/web/**`、`apps/worker/**`。
- 不做生产化全链路迁移。

## 完成条件

场景: response body 捕获命中
  测试:
    包: apps/gather
    过滤: test_agent_browser_responsebody_capture
  假设 提供可用 profile 与 URL pattern
  当 执行 PoC runner
  那么 成功获取并解析 response body

场景: 未命中或超时可观测
  测试:
    包: apps/gather
    过滤: test_agent_browser_responsebody_timeout
    Level: integration
    Test Double: none
    Targets: CDP Network.getResponseBody timeout and unmatched URL path
  假设 pattern 不匹配或请求未触发
  当 执行 PoC runner
  那么 返回明确错误原因（超时/无命中）

场景: PoC 报告可用于决策
  测试:
    包: specs
    过滤: report_manual_review
  假设 完成样本采集
  当 查看报告
  那么 包含成功率、失败分类、Go/No-Go 建议

场景: PoC 不切换默认 driver
  测试:
    包: apps/gather
    过滤: test_poc_does_not_change_default_driver
    Level: integration
    Test Double: none
    Targets: legacy /fetch path without explicit driver
  假设 未显式指定 `driver`
  当 执行原有 `/fetch` 路径
  那么 默认 driver 仍保持现有配置且不强制切换为 `agent-browser`

场景: 报告落盘到固定路径
  测试:
    包: specs
    过滤: test_gth003_report_output_path
    Level: integration
    Test Double: filesystem sandbox temp dir
    Targets: report artifact path and non-empty content
  假设 PoC runner 执行完成
  当 检查产物文件
  那么 `specs/reports/GTH-003-report.md` 存在且文件大小大于 0

## 排除范围

- 不覆盖 WebSocket frame 捕获。
- 不做并发压测。
