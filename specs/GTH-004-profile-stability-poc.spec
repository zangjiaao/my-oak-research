spec: task
name: "GTH-004-profile-stability-poc"
inherits: project
tags: [gather, profile, poc, p0]
---

## 意图

验证 profile 登录态在重复启动和持续运行中的稳定性，为后续规模化采集提供依据。

## 已定决策

- 采用固定 profile 进行多轮验证。
- 输出稳定性指标与失败分布。
- 报告落盘到 `specs/reports/GTH-004-report.md`。

## 边界

### 允许修改
- `apps/gather/**`
- `specs/reports/GTH-004-report.md`

### 禁止做
- 不改 web/worker。
- 不做 UI/管理台功能。

## 完成条件

场景: 多轮认证稳定性统计
  测试:
    包: apps/gather
    过滤: test_profile_stability_repeated_runs
  假设 相同 profile 多轮运行
  当 执行稳定性脚本
  那么 输出 valid/invalid 比例与时间窗口数据

场景: 异常登录可识别
  测试:
    包: apps/gather
    过滤: test_profile_stability_anomaly_signal
  假设 平台触发异常登录或 session 失效
  当 执行稳定性脚本
  那么 记录可追踪错误分类

场景: 报告可给出部署建议
  测试:
    包: specs
    过滤: report_manual_review
  假设 稳定性采样完成
  当 查看报告
  那么 给出单实例/多实例建议与风险

## 排除范围

- 不验证 response body 捕获。
- 不修改默认 driver 路由。
