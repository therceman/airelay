# Task: Add Tag Targeting for Session Resolution (`prompt <tag|session>`)

## Task ID
`deepseek_040_add_tag_targeting_for_prompt_and_session_resolution`

## Context
Need ability to target a session by tag in commands that currently accept `<session>` key/id, starting with:
- `airelay prompt <tag|session> <msg>`

This should enable group-friendly worker routing while keeping deterministic behavior.

## Required report flow (mandatory)
1. Copy stub first:
`cp tasks/report_stub.md tasks/deepseek_040_add_tag_targeting_for_prompt_and_session_resolution_report_draft.md`
2. Complete draft with evidence + validation exits.
3. Rename only when complete:
`mv tasks/deepseek_040_add_tag_targeting_for_prompt_and_session_resolution_report_draft.md tasks/deepseek_040_add_tag_targeting_for_prompt_and_session_resolution_report.md`

## Scope
### A) Session tagging metadata
- Add optional `tags: string[]` to session records.
- Add start-time tagging support:
  - `airelay start <profile> [--key <k>] [--tag <t> ...] -- <harness_args...>`
- Keep tags normalized (trim/lowercase), deduped.

### B) Resolution behavior for `<tag|session>`
- For `prompt` target argument:
  1. First resolve exact session key/id match (highest priority).
  2. If no key/id match, resolve as tag.
- Tag resolution rules:
  - If exactly 1 active matching session: target it.
  - If multiple matches: choose most-recent `lastUsed` OR return actionable ambiguity error (define and test one policy).
  - If none: actionable not-found error.

### C) List visibility
- `airelay sessions` should display tags when present.
- `--json` output should include tags.

## Primary file ownership
- `src/cli.ts`
- `src/commands/start.ts`
- `src/commands/prompt.ts`
- `src/commands/sessions.ts`
- `src/commands/sessions-list.ts`
- tests: `test/cli-runCli.test.ts`, `test/prompt.test.ts`, `test/sessions*.test.ts`

## Acceptance criteria
1. `airelay start ... --tag deepseek` stores tag on session.
2. `airelay prompt deepseek "msg"` resolves tag to a session using defined policy.
3. Key/id still takes precedence over tag when both could match.
4. Session list shows tags (human + json).
5. Build/lint/tests pass.

## Validation commands (mandatory)
- `npm run -s build`
- `npm run -s lint`
- `npm test -- cli-runCli prompt sessions sessions-list`
- `npm test`

Record exits in report.

## Report requirements
- Final report path:
`tasks/deepseek_040_add_tag_targeting_for_prompt_and_session_resolution_report.md`
- Must follow exact headings/order from `tasks/task_report_template.md`.
- Must include acceptance mapping with concrete file/test evidence.

## Constraints
- Minimal/surgical change.
- Do not break existing key/id resolution behavior.
