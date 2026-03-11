# GTH-004: Profile Session Stability PoC

## Intent
验证 profile 登录态在重复启动与持续运行场景下的稳定性。

## Scope
- `apps/gather/**`
- `specs/reports/GTH-004-report.md`

## Out of Scope
- 不改 web/worker
- 不做 UI 开发

## Required PoC Steps
1. 固定 profile 目录运行多轮任务
2. 记录每轮认证状态（valid/invalid）
3. 记录异常登录触发情况
4. 输出时间窗口内稳定性指标

## Completion Criteria
- [ ] 提供至少 24h 或等价多轮稳定性数据
- [ ] 给出 auth 失效率与失败原因分布
- [ ] 给出 profile 使用建议（单实例/多实例）
- [ ] 产出 `specs/reports/GTH-004-report.md`

## Validation
- 提供统计脚本或日志聚合方式
- 提供脱敏结果

## Deliverables
- PoC 执行脚本/命令
- 稳定性报告
- 风险建议

