# Task

## ID
`deepseek_012_refactor_spawn_run_and_ipc_framing`

## Agent
`DeepSeek`

## Execution Order
`12`

## File Ownership
- `src/runtime/spawn.ts`
- `src/commands/run.ts`
- `src/controller/protocol.ts`
- `src/controller/index.ts`
- `src/commands/prompt.ts`
- `test/spawn*.test.ts`
- `test/run*.test.ts`
- `test/controller*.test.ts`
- `test/prompt*.test.ts`

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Refactor duplicated spawn infrastructure, runCommand responsibilities, and IPC line framing

## Context
Post-hardening review identified maintainability/performance-risk items (P2/P3/P4): spawn duplication, broad stdin listener cleanup, oversized runCommand, and duplicated JSON-line framing.

## Scope
- Refactor `src/runtime/spawn.ts` to remove duplicated infrastructure between `spawnProcess` and `spawnAndWait`.
  - Keep behavior backward-compatible.
  - Preserve PID tracking and error semantics.
- Refactor `src/commands/run.ts` to reduce mixed responsibilities by extracting clear helpers (controller lifecycle, stdin forwarding, cleanup).
- Replace `process.stdin.removeAllListeners('data')` with targeted listener removal.
- Extract shared JSON-line framing/parsing utility and use it in both:
  - `src/controller/index.ts` (server side)
  - `src/commands/prompt.ts` (client side)
- Keep current user-visible behavior unchanged except for internal robustness improvements.

## Non-goals
- Do not implement proxy/network integration.
- Do not redesign CLI command surface.
- Do not add session-cache architecture for `loadSessions` in this task unless required by refactor side-effects.

## Acceptance criteria
- Spawn duplication is materially reduced with a shared implementation path.
- `runCommand` is split into smaller helpers with clearer lifecycle boundaries.
- Stdin listener cleanup is targeted (no `removeAllListeners('data')`).
- JSON-line framing logic is shared between prompt client and controller server.
- Existing tests remain green and new/updated tests cover refactored behavior.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm test -- spawn run controller prompt`
- `npm test`

## Reporting Contract (Mandatory)
- Start by copying the base stub:
  - `cp tasks/report_stub.md tasks/deepseek_012_refactor_spawn_run_and_ipc_framing_report.md`
- Fill that copied file only; do not create a custom report structure.
- Report file name MUST be exactly `tasks/deepseek_012_refactor_spawn_run_and_ipc_framing_report.md`.
- Report MUST follow exact headings and order from `tasks/task_report_template.md`.
- Report MUST include `## Acceptance Criteria Mapping` with pass/fail + evidence for each criterion.
- Report MUST include validation command exit codes for all listed commands.

## Deliverables
- code changes
- report at `tasks/deepseek_012_refactor_spawn_run_and_ipc_framing_report.md`
