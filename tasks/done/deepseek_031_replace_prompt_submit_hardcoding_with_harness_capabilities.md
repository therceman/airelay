# Task: Replace Prompt Submit Hardcoding with Harness Capabilities Model

## Task ID
`deepseek_031_replace_prompt_submit_hardcoding_with_harness_capabilities`

## Context
Task 30 solved behavior but introduced brittle branching based on harness name (`codex` vs others). We need a robust, extensible model where interactive input behavior is declared as harness capabilities, not scattered conditionals.

## Required report flow (mandatory)
1. Copy stub first:
`cp tasks/report_stub.md tasks/deepseek_031_replace_prompt_submit_hardcoding_with_harness_capabilities_report_draft.md`
2. Fill draft fully with evidence and validation exits.
3. Rename only when complete:
`mv tasks/deepseek_031_replace_prompt_submit_hardcoding_with_harness_capabilities_report_draft.md tasks/deepseek_031_replace_prompt_submit_hardcoding_with_harness_capabilities_report.md`

## Scope
- Introduce central harness capabilities config for terminal input behavior.
- Use capabilities in prompt submit decision instead of hardcoded harness string checks.
- Keep current functional behavior:
  - codex-like profiles default to Ctrl+J semantics
  - opencode-like/default profiles keep Enter semantics
- Preserve override behavior.

## Primary file ownership
- `src/utils/harness.ts` and/or new `src/utils/harness-capabilities.ts`
- `src/commands/prompt.ts`
- `src/types/controller.ts` (only if needed)
- related tests (`test/prompt.test.ts`, possibly controller tests)

## Implementation requirements
1. Add a typed capability model, e.g.:
- `defaultSubmitByte` (`'\r' | '\n' | ''`)
- optionally `usesAlternateBuffer?: boolean` (if useful for future behavior)

2. Add a single resolver API (example):
- `getHarnessCapabilities(executableOrHarness)`

3. Refactor prompt submit logic to use capability resolver, not direct `if (harness === 'codex')`.

4. Keep protocol compatibility and existing tests passing; update/add tests proving capability-driven behavior.

## Acceptance criteria
1. No direct hardcoded harness-name branching for submit byte in `prompt.ts`.
2. Submit decision is capability-driven from one source of truth.
3. Existing behavior remains intact for codex/opencode.
4. Build/lint/tests pass.

## Validation commands (mandatory)
- `npm run -s build`
- `npm run -s lint`
- `npm test -- prompt controller run`
- `npm test`

Record exit codes in report.

## Report requirements
- Final report path:
`tasks/deepseek_031_replace_prompt_submit_hardcoding_with_harness_capabilities_report.md`
- Must follow exact headings/order from `tasks/task_report_template.md`.
- Must include `## Acceptance Criteria Mapping` with concrete evidence.

## Constraints
- Minimal, surgical refactor.
- Do not alter unrelated runtime/session behavior.
