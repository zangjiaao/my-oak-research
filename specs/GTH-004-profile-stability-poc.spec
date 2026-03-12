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

场景: 输出稳定性指标与失败分布
  测试:
    包: apps/gather
    过滤: test_profile_stability_metrics_and_failure_distribution
  假设 稳定性脚本执行完成并产生结果
  当 读取统计输出（stdout 或 JSON 结果）
  那么 包含 `total_runs/valid_runs/invalid_runs/failure_reasons` 且 `failure_reasons` 为非空分类映射

场景: 报告落盘到固定路径
  测试:
    包: specs
    过滤: test_gth004_report_output_path
    Level: integration
    Test Double: filesystem sandbox temp dir
    Targets: report artifact path and non-empty content
  假设 稳定性任务执行完成
  当 检查产物文件
  那么 `specs/reports/GTH-004-report.md` 存在且文件大小大于 0

## 排除范围

- 不验证 response body 捕获。
- 不修改默认 driver 路由。
