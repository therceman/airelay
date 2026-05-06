# Task

## ID
`deepseek_018_pty_resize_signal_forwarding`

## Agent
`DeepSeek`

## Execution Order
`18`

## File Ownership
- `src/runtime/pty.ts`
- `src/runtime/spawn.ts`
- `src/commands/run.ts` (only if lifecycle hook plumbing is needed)
- `test/runtime*.test.ts`
- `test/spawn*.test.ts`

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Add PTY resize forwarding via SIGWINCH for terminal UI correctness

## Context
Task 15 introduced PTY sessions but does not yet forward terminal resize events, which may cause rendering issues in full-screen TUIs.

## Scope
- Implement SIGWINCH handling for PTY-backed sessions.
- On terminal resize, read current terminal columns/rows and call PTY resize.
- Ensure listeners are cleaned up on process exit/session end.
- Keep behavior no-op safe on non-TTY environments.

## Non-goals
- Do not add remote/proxy integration.
- Do not modify command surface.

## Acceptance criteria
- PTY session receives resize updates when terminal dimensions change.
- No listener leaks after child/session exit.
- Existing tests remain green; add coverage for resize hook lifecycle.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm test -- spawn runtime run`
- `npm test`

## Reporting Contract (Mandatory)
- Start by copying the base stub:
  - `cp tasks/report_stub.md tasks/deepseek_018_pty_resize_signal_forwarding_report.md`
- Fill that copied file only; do not create a custom report structure.
- Report file name MUST be exactly `tasks/deepseek_018_pty_resize_signal_forwarding_report.md`.
- Report MUST follow exact headings and order from `tasks/task_report_template.md`.
- Report MUST include `## Acceptance Criteria Mapping` with pass/fail + evidence for each criterion.
- Report MUST include validation command exit codes for all listed commands.

## Deliverables
- code changes
- report at `tasks/deepseek_018_pty_resize_signal_forwarding_report.md`
