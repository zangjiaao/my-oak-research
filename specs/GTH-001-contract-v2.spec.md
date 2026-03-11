# GTH-001: Gather v2 Contract & Error Model

## Intent
为 `apps/gather` 建立稳定的 v2 API 契约，保障后续并行开发不返工。

## Scope
- `apps/gather/main.py`
- `apps/gather/README.md`
- `apps/gather/tests/**` (如无 tests 目录可新增)

## Out of Scope
- 不实现 agent-browser 驱动
- 不改 `apps/web/**`、`apps/worker/**`

## Required Decisions
1. 保留 `/fetch`（兼容）
2. 新增 `/v2/fetch`
3. 统一错误结构：
```json
{ "error": { "code": "...", "message": "...", "retryable": false } }
```
4. `CleanItem` 字段在 v1/v2 输出保持一致（可新增 `driver`）

## Completion Criteria
- [ ] `/v2/fetch` 请求 schema 可校验（Pydantic）
- [ ] `/v2/fetch` 返回 `List[CleanItem]`
- [ ] 错误响应结构统一并在 README 说明
- [ ] 至少 3 条 contract tests：成功、参数错误、内部错误
- [ ] 不破坏 `/fetch` 现有行为

## Validation
- `cd apps/gather && uv run -m pytest -q`（若无 pytest，给出替代验证脚本）
- `cd apps/gather && uv run python -m py_compile main.py`

## Deliverables
- 代码与测试
- README 的 v2 API 文档片段
- 迁移说明（v1 -> v2）

