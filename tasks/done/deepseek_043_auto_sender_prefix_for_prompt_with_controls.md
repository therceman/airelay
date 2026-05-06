# Task: Auto Sender Prefix for `prompt` with Controls

## Task ID
`deepseek_043_auto_sender_prefix_for_prompt_with_controls`

## Context
When one worker session sends prompts to another, sender identity should be included automatically using session env metadata.

Desired behavior:
- If `AIRELAY_SESSION_KEY` exists in caller env:
  - `airelay prompt <target> "ping"` sends `@<sender_key>: ping`

Need user controls:
- `--no-sender` disables auto-prefix
- `--sender <id>` overrides sender identifier

## Required report flow (mandatory)
1. Copy stub first:
`cp tasks/report_stub.md tasks/deepseek_043_auto_sender_prefix_for_prompt_with_controls_report_draft.md`
2. Complete with evidence + validation exits.
3. Rename only when complete:
`mv tasks/deepseek_043_auto_sender_prefix_for_prompt_with_controls_report_draft.md tasks/deepseek_043_auto_sender_prefix_for_prompt_with_controls_report.md`

## Scope
Implement sender prefixing in prompt send path.

### Behavior contract
1. Default behavior
- If `AIRELAY_SESSION_KEY` present and text is non-empty, prefix text with:
  - `@<sender>: <text>`

2. Controls
- `--no-sender`: do not prefix, even if env exists.
- `--sender <id>`: use explicit sender id instead of env.
- If both `--no-sender` and `--sender` are provided, return actionable error.

3. Compatibility
- Works with normal prompt text flow.
- Must not break `--only-enter` / `--only-sequence` modes.
- Prefixing should apply only when actual text payload is being sent.

## Primary file ownership
- `src/cli.ts`
- `src/commands/prompt.ts`
- tests: `test/prompt.test.ts`, `test/cli-runCli.test.ts`

## Acceptance criteria
1. Env-driven sender prefix works by default.
2. `--no-sender` disables prefix.
3. `--sender` override works.
4. Conflict (`--no-sender` + `--sender`) errors clearly.
5. No regressions for prompt-only-sequence/only-enter paths.
6. Build/lint/tests pass.

## Validation commands (mandatory)
- `npm run -s build`
- `npm run -s lint`
- `npm test -- cli-runCli prompt`
- `npm test`

Record exits in report.

## Report requirements
- Final report path:
`tasks/deepseek_043_auto_sender_prefix_for_prompt_with_controls_report.md`
- Must follow exact headings/order from `tasks/task_report_template.md`.
- Must include acceptance mapping with concrete evidence.

## Constraints
- Minimal/surgical change.
- No unrelated runtime behavior changes.
