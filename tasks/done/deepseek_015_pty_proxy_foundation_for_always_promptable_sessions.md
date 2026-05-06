# Task

## ID
`deepseek_015_pty_proxy_foundation_for_always_promptable_sessions`

## Agent
`DeepSeek`

## Execution Order
`15`

## File Ownership
- `src/runtime/pty.ts` (new)
- `src/runtime/spawn.ts`
- `src/commands/run.ts`
- `src/controller/index.ts`
- `src/commands/prompt.ts`
- `test/runtime*.test.ts` (new/updated)
- `test/run*.test.ts`
- `test/prompt*.test.ts`

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Build PTY proxy foundation so sessions are always promptable and always terminal-compatible

## Context
Current pipe-vs-inherit stdin split causes incompatibility with harness-native resume args while also breaking always-promptable requirement.

## Scope
- Introduce PTY-backed runtime execution path where harness process always sees a terminal.
- Route both user terminal input and `airelay prompt` input into PTY stdin.
- Keep output streaming to user terminal as before.
- Preserve existing session/controller metadata behavior.
- Ensure harness args passthrough (`resume`, `-s`, etc.) works under PTY path.

## Non-goals
- Do not add remote/proxy network API.
- Do not redesign command surface in this task.

## Acceptance criteria
- Harness process launched via `start` sees terminal-compatible stdin/tty semantics.
- `airelay prompt <session> ...` injects input into the same PTY-backed session.
- Resume-style harness args under `start` no longer hang due to stdin mode mismatch.
- Existing tests pass; add PTY-path coverage.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm test -- run prompt spawn runtime`
- `npm test`

## Reporting Contract (Mandatory)
- Start by copying the base stub:
  - `cp tasks/report_stub.md tasks/deepseek_015_pty_proxy_foundation_for_always_promptable_sessions_report.md`
- Fill that copied file only; do not create a custom report structure.
- Report file name MUST be exactly `tasks/deepseek_015_pty_proxy_foundation_for_always_promptable_sessions_report.md`.
- Report MUST follow exact headings and order from `tasks/task_report_template.md`.
- Report MUST include `## Acceptance Criteria Mapping` with pass/fail + evidence for each criterion.
- Report MUST include validation command exit codes for all listed commands.

## Deliverables
- code changes
- report at `tasks/deepseek_015_pty_proxy_foundation_for_always_promptable_sessions_report.md`
