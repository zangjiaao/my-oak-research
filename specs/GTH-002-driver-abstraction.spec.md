# GTH-002: Driver Abstraction & Registry

## Intent
把 gather 从“平台 if/elif + client 直连”改为“driver 接口 + registry 分发”，为多引擎并行打基础。

## Scope
- `apps/gather/**`

## Out of Scope
- 不接入 web/worker
- 不实现完整平台迁移（只要求最小可运行路径）

## Required Design
1. 定义 `BaseDriver`：
   - `verify_auth(...)`
   - `fetch(...)`
2. `DriverRegistry` 根据 `driver` 字段解析驱动
3. 默认驱动仍指向现有 Playwright 逻辑
4. 保证 `/fetch` 不感知底层 driver 细节

## Completion Criteria
- [ ] 新增 driver 抽象文件并有类型约束
- [ ] `/v2/fetch` 可选择 `driver`
- [ ] 至少保留一个平台在默认驱动可跑通
- [ ] 为 registry 添加单元测试（driver not found / default fallback）

## Validation
- `cd apps/gather && uv run python -m py_compile main.py`
- `cd apps/gather && uv run -m pytest -q`

## Deliverables
- driver 抽象层代码
- registry 测试
- 架构说明（短文档）

