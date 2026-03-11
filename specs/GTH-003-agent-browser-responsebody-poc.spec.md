# GTH-003: Agent Browser CDP PoC (HTTP Response Body)

## Intent
验证 `agent-browser + CDP` 在目标平台中能否稳定捕获关键 API response body。

## Scope
- `apps/gather/**`
- `specs/reports/GTH-003-report.md`（可新增目录）

## Out of Scope
- 不做全平台接入
- 不替换默认驱动

## Required PoC Steps
1. 提供最小 PoC runner（可 CLI 或内部 service）
2. 使用 profile 模式运行采集路径
3. 对至少 2 个 URL pattern 捕获 response body
4. 将结果转结构化输出（JSON）

## Completion Criteria
- [ ] 形成可重复执行的 PoC 命令
- [ ] `response body` 捕获成功率统计（样本>=20）
- [ ] 输出失败样本分类（超时/无命中/反爬）
- [ ] 产出报告 `specs/reports/GTH-003-report.md`

## Validation
- 提供完整命令与日志片段
- 提供样本结果（脱敏）

## Deliverables
- PoC 代码
- 可执行说明
- 风险结论（Go/No-Go 建议）

