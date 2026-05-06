# Task: Replace `start --name` with `start --key` and Simplify Session Identity Output

## Task ID
`deepseek_038_replace_start_name_with_key_and_simplify_session_identity`

## Context
We want one canonical user-controlled session identity (`sessionKey`) rather than separate `name` and `key` fields.

Desired start contract:
- `airelay start <profile> [--key <session_key>] -- <profile_args...>`

Desired session list display:
1. `<session_id> (key: <session_key>) @ <cwd>` when `session_key !== session_id`
2. `<session_id> @ <cwd>` when `session_key === session_id`

## Required report flow (mandatory)
1. Copy stub first:
`cp tasks/report_stub.md tasks/deepseek_038_replace_start_name_with_key_and_simplify_session_identity_report_draft.md`
2. Complete draft with evidence + validation exits.
3. Rename only when complete:
`mv tasks/deepseek_038_replace_start_name_with_key_and_simplify_session_identity_report_draft.md tasks/deepseek_038_replace_start_name_with_key_and_simplify_session_identity_report.md`

## Scope
1. CLI/API changes
- Replace `start --name` with `start --key`.
- Remove name-related start handling.
- Keep `--` passthrough contract for profile args.

2. Data model simplification
- Remove session `name` usage from persistence and list rendering.
- Keep `sessionKey` as the user-facing stable identifier.
- Ensure existing session resolution by key still works.

3. List rendering rules
- Implement exact formatting rules above for human output.
- Keep JSON output coherent and deterministic.

4. Validation/UX
- Validate custom key format and collisions.
- Actionable errors for invalid/duplicate key.
- Update help text/examples.

## Primary file ownership
- `src/cli.ts`
- `src/commands/start.ts`
- `src/commands/run.ts`
- `src/commands/sessions.ts`
- `src/commands/sessions-list.ts`
- tests: `test/cli-runCli.test.ts`, `test/sessions*.test.ts`, `test/run.test.ts` as needed

## Acceptance criteria
1. `airelay start <profile> --key worker_1 -- ...` sets session key to `worker_1`.
2. No `name` field is required for session identity/display.
3. Human list output follows exact key-vs-id display rules.
4. Existing key-based commands remain functional.
5. Build/lint/tests pass.

## Validation commands (mandatory)
- `npm run -s build`
- `npm run -s lint`
- `npm test -- cli-runCli sessions sessions-list run`
- `npm test`

Record exits in report.

## Report requirements
- Final report path:
`tasks/deepseek_038_replace_start_name_with_key_and_simplify_session_identity_report.md`
- Must follow exact headings/order from `tasks/task_report_template.md`.
- Must include `## Acceptance Criteria Mapping` with concrete evidence.

## Constraints
- Minimal/surgical changes.
- Do not break prompt/session control flow.
