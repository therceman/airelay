# Task

## ID
`deepseek_011_fix_tty_regression_for_interactive_resume`

## Agent
`DeepSeek`

## Execution Order
`11`

## File Ownership
- `src/runtime/spawn.ts`
- `src/commands/run.ts`
- `src/commands/start.ts`
- `src/commands/resume.ts`
- `test/run*.test.ts`
- `test/resume*.test.ts`
- `test/spawn*.test.ts`

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Fix TTY regression: interactive profile-arg passthrough (e.g. resume/-s) must keep terminal stdin while preserving prompt control

## Context
Current behavior can route child stdin through a pipe in interactive flows, causing tools like `codex` to fail with `Error: stdin is not a terminal` when users pass harness-native args via airelay (e.g. `airelay codex2 resume <id>` or `airelay opencode2 -s <id>`).

## Scope
- Ensure interactive profile execution with passthrough args keeps a real TTY stdin for child process (including harness-native resume flags/commands).
- Preserve prompt-control feature behavior where technically possible without breaking TTY requirements.
- If prompt injection requires fallback mode for strict-TTY apps, implement explicit safe behavior and user-facing message.
- Add tests for TTY-sensitive spawn mode decisions.

## Non-goals
- Do not add proxy/network integration.
- Do not redesign CLI UX outside minimal compatibility messaging.

## Acceptance criteria
- `airelay <profile> resume <id>` and `airelay <profile> -s <id>` passthrough paths no longer force non-terminal stdin for interactive runtimes.
- TTY-sensitive harnesses (e.g., codex) can launch without `stdin is not a terminal` failure caused by airelay.
- Existing non-interactive/test flows remain green.
- Prompt-control behavior is either preserved or explicitly degraded with clear messaging in TTY-only mode.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm test -- run resume spawn prompt`
- add at least one test asserting interactive mode uses tty-compatible stdio

## Reporting Contract (Mandatory)
- Start by copying the base stub:
  - `cp tasks/report_stub.md tasks/deepseek_011_fix_tty_regression_for_interactive_resume_report.md`
- Fill that copied file only; do not create a custom report structure.
- Report file name MUST be exactly `tasks/deepseek_011_fix_tty_regression_for_interactive_resume_report.md`.
- Report MUST follow exact headings and order from `tasks/task_report_template.md`.
- Report MUST include `## Acceptance Criteria Mapping` with pass/fail + evidence for each criterion.
- Report MUST include validation command exit codes for all listed commands.

## Deliverables
- code changes
- report at `tasks/deepseek_011_fix_tty_regression_for_interactive_resume_report.md`
