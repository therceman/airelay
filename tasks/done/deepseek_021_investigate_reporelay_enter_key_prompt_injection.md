# Task

## ID
`deepseek_021_investigate_reporelay_enter_key_prompt_injection`

## Agent
`DeepSeek`

## Execution Order
`21`

## File Ownership
- `src/commands/prompt.ts`
- `src/commands/run.ts`
- `src/controller/index.ts`
- `src/controller/protocol.ts`
- `src/runtime/pty.ts`
- `src/runtime/spawn.ts`
- `test/controller-e2e.test.ts`
- `test/prompt.test.ts`
- `test/run.test.ts`

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Investigate reporelay enter-key prompt injection and align airelay behavior

## Context
Prompt injection is currently sending text plus a newline, but in practice the harness interprets this as plain new line input rather than an actual Enter key action. Example failure case:

- `airelay prompt pending_opencode2_df90 hi`

The prompt path needs to understand how `reporelay` performs remote terminal input correctly, especially the exact bytes/keypress semantics for Enter vs newline and any framing or PTY interaction that makes the prompt submit rather than insert a blank line.

## Scope
- Inspect `reporelay` implementation for how it sends remote text and how it represents Enter/key submission.
- Compare its prompt/input path against the current `airelay` prompt controller and PTY write path.
- Determine whether the correct behavior requires:
  - carriage return vs newline
  - key-event simulation
  - PTY write semantics
  - protocol framing changes
  - controller-side special handling for Enter
- Update airelay prompt behavior if needed so `airelay prompt <session> <text>` actually submits a prompt like a real user.
- Add or update tests that validate prompt submission semantics explicitly.

## Non-goals
- Do not redesign the whole controller architecture.
- Do not add remote network proxying beyond what is needed for the enter-key behavior.
- Do not change unrelated session listing output or naming.

## Acceptance criteria
- The report identifies the exact `reporelay` mechanism for Enter/prompt submission.
- `airelay` prompt behavior matches the correct terminal submission semantics.
- `airelay prompt pending_opencode2_df90 hi` submits a prompt instead of only inserting a newline.
- Tests cover the prompt submission behavior and remain green.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm test -- prompt controller run`
- `npm test`

## Reporting Contract (Mandatory)
- Start by copying the base stub:
  - `cp tasks/report_stub.md tasks/deepseek_021_investigate_reporelay_enter_key_prompt_injection_report.md`
- Fill that copied file only; do not create a custom report structure.
- Report file name MUST be exactly `tasks/deepseek_021_investigate_reporelay_enter_key_prompt_injection_report.md`.
- Report MUST follow exact headings and order from `tasks/task_report_template.md`.
- Report MUST include `## Acceptance Criteria Mapping` with pass/fail + evidence for each criterion.
- Report MUST include validation command exit codes for all listed commands.
- Report MUST include concrete references to `reporelay` files/behavior and the exact input bytes or key semantics discovered.

## Deliverables
- code changes if needed
- report at `tasks/deepseek_021_investigate_reporelay_enter_key_prompt_injection_report.md`
