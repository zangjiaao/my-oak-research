# Gather Refactor Task Board (Spec-Driven)

## Objective
将 `apps/gather` 升级为可独立开发和迭代的采集模块，先稳定契约与采集内核，再对接 `apps/web` / `apps/worker`。

## Rules
- 所有任务按 `Spec Path` 执行，不接受口头补充范围。
- 只允许修改卡片里声明的目录。
- 合并顺序必须遵守 `Depends On`。
- 验收只按 `Completion Criteria`（DoD）。

## Merge Gates
1. Gate A: `GTH-001` merged
2. Gate B: `GTH-002` merged
3. Gate C: `GTH-003` + `GTH-004` PoC reports merged
4. Gate D: `GTH-005` merged

## Tasks

| Task ID | Title | Priority | Depends On | Branch | Spec Path | Owner |
|---|---|---|---|---|---|---|
| GTH-001 | Gather v2 Contract & Error Model | P0 | - | `feat/gather-contract-v2` | `specs/GTH-001-contract-v2.spec.md` | subagent-A |
| GTH-002 | Driver Abstraction & Registry | P0 | GTH-001 | `feat/gather-driver-abstraction` | `specs/GTH-002-driver-abstraction.spec.md` | subagent-B |
| GTH-003 | Agent Browser CDP PoC (HTTP Response Body) | P0 | GTH-001,GTH-002 | `feat/gather-agent-browser-poc` | `specs/GTH-003-agent-browser-responsebody-poc.spec.md` | subagent-C |
| GTH-004 | Profile Session Stability PoC | P0 | GTH-002 | `feat/gather-profile-stability-poc` | `specs/GTH-004-profile-stability-poc.spec.md` | subagent-D |
| GTH-005 | Worker Auth Plumbing to Gather | P0 | GTH-001 | `feat/worker-gather-auth-plumbing` | `specs/GTH-005-worker-auth-plumbing.spec.md` | subagent-E |

## Coordinator Checklist
- [ ] 每个 subagent 从独立 worktree + branch 开工
- [ ] 每个 PR 附上 "Spec Compliance" 小节
- [ ] 每个 PR 附上测试命令和结果
- [ ] 任何越界修改直接退回
- [ ] Gate C 前禁止迁移线上默认 driver

