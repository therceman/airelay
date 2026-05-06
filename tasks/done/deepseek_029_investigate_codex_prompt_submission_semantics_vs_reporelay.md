# Task: Investigate Codex Prompt Submission Semantics vs Reporelay

## Task ID
`deepseek_029_investigate_codex_prompt_submission_semantics_vs_reporelay`

## Context
Current behavior in `airelay` for Codex prompt injection appears to be interpreted as plain `text + newline`, not the exact Enter/submit semantics expected by Codex in PTY mode.

You must inspect the real `reporelay` implementation in:
- `~/git/reporelay`
and identify how prompt text and Enter key submission are encoded and sent for Codex-compatible sessions.

## Required report flow (mandatory)
1. Copy draft from stub first:
`cp tasks/report_stub.md tasks/deepseek_029_investigate_codex_prompt_submission_semantics_vs_reporelay_report_draft.md`
2. Complete with evidence and validation.
3. Rename only when complete:
`mv tasks/deepseek_029_investigate_codex_prompt_submission_semantics_vs_reporelay_report_draft.md tasks/deepseek_029_investigate_codex_prompt_submission_semantics_vs_reporelay_report.md`

## Scope
- Inspect `reporelay` source for the exact prompt injection protocol/path used for Codex-like sessions.
- Compare with current `airelay` implementation.
- Implement fix in `airelay` so Codex receives prompt submission correctly.
- Add/adjust tests that fail before and pass after fix.

## Primary file ownership
- `src/commands/run.ts`
- `src/commands/prompt.ts`
- `src/controller/index.ts`
- `src/controller/protocol.ts`
- `test/controller-e2e.test.ts`
- any additional tests needed

## Required investigation evidence
Report must include concrete references (file + line) from `~/git/reporelay`, not inference.
At minimum, document:
- how plain text bytes are written
- how Enter key is represented (`\r`, `\n`, key event, etc.)
- any framing/protocol details relevant to submit behavior

## Acceptance criteria
1. `airelay prompt <session> "text"` submits correctly for Codex sessions (not just inserts a newline in input buffer).
2. behavior is consistent with validated `reporelay` semantics.
3. no regression for opencode sessions.
4. tests cover byte-level Enter behavior where possible.
5. build/lint/tests pass.

## Validation commands (mandatory)
- `npm run -s build`
- `npm run -s lint`
- `npm test -- prompt controller run`
- `npm test`

Record command exit codes in the report.

## Report requirements
- Final report path:
`tasks/deepseek_029_investigate_codex_prompt_submission_semantics_vs_reporelay_report.md`
- Must follow exact section order from `tasks/task_report_template.md`.
- Must include `## Acceptance Criteria Mapping` with explicit evidence.
- Must include a short section: `Reporelay Evidence` with exact paths/lines.

## Constraints
- Keep fix minimal and protocol-correct.
- Do not introduce harness-name hardcoding in generic prompt flow.
