# GTH-005: Worker Auth Plumbing to Gather

## Intent
修复/补全 worker 调用 gather 时认证数据透传链路，避免 gather 因缺失 auth_data 失败。

## Scope
- `apps/worker/**`
- 必要时 `apps/web/lib/types.ts`（仅类型扩展）

## Out of Scope
- 不改 gather 驱动内部实现
- 不改前端页面

## Required Design
1. worker 在 `fetchSocialSource` 路径可拿到 credential 数据
2. 调用 gather 时透传 `auth_data` 或 `credential_ref`
3. 缺失认证时返回明确可观测错误（非静默）

## Completion Criteria
- [ ] `fetchSocialSource` 请求体包含认证字段
- [ ] 失败时日志包含平台、sourceId、错误码（不泄露敏感信息）
- [ ] 增加最小测试或类型校验，防止回归
- [ ] 不影响非社交源采集

## Validation
- `npm --workspace worker run check-types`
- 如有测试：`npm --workspace worker run test`

## Deliverables
- 代码变更
- 验证输出
- 回滚说明

