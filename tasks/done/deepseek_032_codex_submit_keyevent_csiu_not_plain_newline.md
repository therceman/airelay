# Task: Codex Submit Must Use Key Event Semantics (CSI-u), Not Plain Newline

## Task ID
`deepseek_032_codex_submit_keyevent_csiu_not_plain_newline`

## Context
Current capability model uses plain bytes (`\r` or `\n`) for submit. For Codex TUI this can result in `text + newline` instead of real submit because Codex may expect enhanced keyboard key-event encoding (kitty/CSI-u style), not plain LF.

## Required report flow (mandatory)
1. Copy stub first:
`cp tasks/report_stub.md tasks/deepseek_032_codex_submit_keyevent_csiu_not_plain_newline_report_draft.md`
2. Fill draft fully with concrete evidence.
3. Rename only when complete:
`mv tasks/deepseek_032_codex_submit_keyevent_csiu_not_plain_newline_report_draft.md tasks/deepseek_032_codex_submit_keyevent_csiu_not_plain_newline_report.md`

## Scope
- Extend harness capabilities to support submit strategy beyond plain byte.
- Implement Codex submit using key-event semantics suitable for enhanced keyboard mode (CSI-u sequence for Ctrl+J), with safe fallback behavior.
- Preserve existing behavior for non-Codex harnesses.

## Primary file ownership
- `src/utils/harness.ts` (capabilities model)
- `src/commands/prompt.ts` (submit selection)
- `src/commands/run.ts` (controller handling of submit payload)
- `src/types/controller.ts` (protocol params typing)
- `test/prompt.test.ts`
- `test/controller-e2e.test.ts` (or equivalent byte-level tests)

## Implementation requirements
1. Replace/augment `defaultSubmitByte` with a submit strategy model, e.g.:
- `submitMode: 'byte' | 'sequence'`
- `submitValue: string`

2. For Codex capability, use key-event sequence compatible with enhanced keyboard mode (CSI-u Ctrl+J) instead of plain `\n`.
- Document exact emitted bytes and rationale in report.
- Include fallback path if target terminal/session does not accept CSI-u (explicitly documented).

3. For opencode/unknown capability, keep existing Enter behavior (`\r`) unless explicitly overridden.

4. Preserve explicit override semantics from `airelay prompt` options.

5. No hardcoded profile names.

## Acceptance criteria
1. Codex default submit no longer sends plain newline-only behavior.
2. Codex submit path emits explicit key-event compatible sequence (or equivalent mechanism) verified by byte-level tests.
3. Non-Codex behavior unchanged.
4. Build/lint/tests pass.

## Validation commands (mandatory)
- `npm run -s build`
- `npm run -s lint`
- `npm test -- prompt controller run`
- `npm test`

Record exit codes in report.

## Report requirements
- Final report path:
`tasks/deepseek_032_codex_submit_keyevent_csiu_not_plain_newline_report.md`
- Must follow `tasks/task_report_template.md` headings/order.
- Must include `## Acceptance Criteria Mapping` with concrete evidence.
- Must include `Submitted Byte/Sequence Evidence` with exact escaped string + hex bytes emitted.

## Constraints
- Keep changes minimal and local.
- Do not regress prompt transport for existing sessions.
