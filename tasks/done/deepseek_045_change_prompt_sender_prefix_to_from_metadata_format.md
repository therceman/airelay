# Task: Change Prompt Sender Prefix to Metadata Format (`[from=...]`)

## Task ID
`deepseek_045_change_prompt_sender_prefix_to_from_metadata_format`

## Context
Current auto sender prefix format is mention-like (`@sender: msg`) and can be misinterpreted as message addressing.

Need neutral sender metadata format.

## Required behavior
- Replace auto-prefix format:
  - from: `@<sender>: <text>`
  - to: `[from=<sender>] <text>`

Controls remain:
- `--no-sender`
- `--sender <id>`

## Required report flow (mandatory)
1. Copy stub first:
`cp tasks/report_stub.md tasks/deepseek_045_change_prompt_sender_prefix_to_from_metadata_format_report_draft.md`
2. Complete with evidence + validation exits.
3. Rename only when complete:
`mv tasks/deepseek_045_change_prompt_sender_prefix_to_from_metadata_format_report_draft.md tasks/deepseek_045_change_prompt_sender_prefix_to_from_metadata_format_report.md`

## Scope
1. Update prompt prefixing logic to metadata format.
2. Keep existing sender controls and conflict validations.
3. Update tests and help examples/messages that reference old `@sender:` style.

## Primary file ownership
- `src/commands/prompt.ts`
- `src/cli.ts` (help examples/messages if needed)
- `test/prompt.test.ts`
- `test/cli-runCli.test.ts` (if assertions depend on text format)

## Acceptance criteria
1. Default env-based sender prefix is `[from=<AIRELAY_SESSION_KEY>] <msg>`.
2. `--sender` uses `[from=<sender>] <msg>`.
3. `--no-sender` keeps raw text.
4. No regressions in only-enter/only-sequence flows.
5. Build/lint/tests pass.

## Validation commands (mandatory)
- `npm run -s build`
- `npm run -s lint`
- `npm test -- cli-runCli prompt`
- `npm test`

Record exits in report.

## Report requirements
- Final report path:
`tasks/deepseek_045_change_prompt_sender_prefix_to_from_metadata_format_report.md`
- Must follow exact headings/order from `tasks/task_report_template.md`.
- Must include acceptance mapping with concrete evidence.

## Constraints
- Minimal/surgical change.
- No unrelated runtime logic changes.
