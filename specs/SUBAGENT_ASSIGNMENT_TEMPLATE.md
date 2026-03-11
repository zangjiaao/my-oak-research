# Subagent Assignment Template

将以下模板完整发给 subagent（只替换变量，不增删字段）。

---

You are assigned task: `<TASK_ID>`

## Branch
`<BRANCH_NAME>`

## Required Spec
Read and follow exactly:
`<SPEC_PATH>`

## Scope Constraints
- Allowed paths: `<ALLOWED_PATHS>`
- Forbidden paths: `<FORBIDDEN_PATHS>`

## Non-Negotiables
1. Follow Completion Criteria from spec.
2. Keep changes minimal and scoped.
3. Add/adjust tests required by spec.
4. Do not refactor unrelated code.

## Delivery Format (must follow)
1. Summary of changes (5-10 lines)
2. File list
3. Validation commands + outputs
4. Risks / limitations
5. Rollback plan

## Stop Conditions
- Missing dependency from `Depends On`
- Required API/schema ambiguity
- Need to modify forbidden paths

If any stop condition is hit, stop and report blockers only.

---

