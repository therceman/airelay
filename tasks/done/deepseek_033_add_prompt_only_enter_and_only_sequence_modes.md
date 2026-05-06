# Task: Add `--only-enter` and `--only-sequence` Modes to `airelay prompt`

## Task ID
`deepseek_033_add_prompt_only_enter_and_only_sequence_modes`

## Context
Current `airelay prompt` requires text payload and cannot send submit-only keypresses or raw sequence-only payloads. For interactive harness debugging (Codex especially), we need direct key submission modes.

## Required report flow (mandatory)
1. Copy report stub first:
`cp tasks/report_stub.md tasks/deepseek_033_add_prompt_only_enter_and_only_sequence_modes_report_draft.md`
2. Complete draft with evidence + validation exits.
3. Rename only when complete:
`mv tasks/deepseek_033_add_prompt_only_enter_and_only_sequence_modes_report_draft.md tasks/deepseek_033_add_prompt_only_enter_and_only_sequence_modes_report.md`

## Scope
Implement two new prompt modes:
1. `--only-enter`
- Sends submit action only (no text).
- Uses current submit semantics for target session/harness (including any delay behavior).

2. `--only-sequence <seq>`
- Sends provided bytes/sequence directly as submit payload (no text).
- Must work with escaped inputs like `$'\x1b[106;5u'`.

## Primary file ownership
- `src/cli.ts`
- `src/commands/prompt.ts`
- `src/types/controller.ts` (if needed)
- `test/prompt.test.ts`
- `test/cli-runCli.test.ts`

## Implementation requirements
1. CLI parsing
- Add `--only-enter` flag.
- Add `--only-sequence <seq>` flag.
- Validate mutual exclusivity and error messages:
  - `--only-enter` cannot be combined with text.
  - `--only-sequence` cannot be combined with text.
  - `--only-enter` and `--only-sequence` cannot be combined together.

2. Prompt command behavior
- Allow prompt invocation without text when one of the above flags is provided.
- For `--only-enter`: send empty text + submit enabled.
- For `--only-sequence`: send empty text + explicit sequence as submit value.

3. Help text/docs
- Update `airelay help` prompt options and examples.

4. Tests
- Add/adjust tests for success and invalid combinations.
- Keep existing prompt behavior unchanged for normal text usage.

## Acceptance criteria
1. `airelay prompt <session> --only-enter` works and does not require text.
2. `airelay prompt <session> --only-sequence $'...'` sends provided sequence directly and does not require text.
3. Invalid combos produce actionable errors.
4. Existing text prompt behavior remains intact.
5. Build/lint/tests pass.

## Validation commands (mandatory)
- `npm run -s build`
- `npm run -s lint`
- `npm test -- cli-runCli prompt`
- `npm test`

Record exit codes in report.

## Report requirements
- Final report path:
`tasks/deepseek_033_add_prompt_only_enter_and_only_sequence_modes_report.md`
- Must follow exact headings/order from `tasks/task_report_template.md`.
- Must include `## Acceptance Criteria Mapping` with concrete evidence.

## Constraints
- Keep implementation minimal and backward-compatible.
- Do not alter unrelated runtime/session control logic.
