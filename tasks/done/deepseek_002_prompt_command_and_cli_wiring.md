# Task

## ID
`deepseek_002_prompt_command_and_cli_wiring`

## Agent
`DeepSeek`

## Execution Order
`2`

## File Ownership
- `src/commands/prompt.ts` (new)
- `src/cli.ts`
- `test/cli*.test.ts`
- `test/prompt*.test.ts` (new)

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Add `airelay prompt <session> <text>` command and IPC dispatch

## Scope
- Add a new command:
  - `airelay prompt <session> <text>`
  - `airelay prompt <session> --text "..."`
  - `airelay prompt <session> --no-enter` (default enter=true)
- Resolve `<session>` using existing session key/id logic (`findSessionByKey`) with clear errors.
- Dispatch to controller IPC `session.input` endpoint.
- Surface actionable error messages:
  - session not found
  - controller offline
  - IPC timeout
  - invalid payload
- Update CLI help text and examples.

## Non-goals
- Do not alter how `run` spawns runtime yet.
- Do not implement proxy/network calls.

## Acceptance criteria
- Command is parseable from CLI and routed correctly.
- `prompt` sends text to IPC and returns success/failure status code.
- Help output documents new command and flags.
- Unit tests cover parse and error paths.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm test -- cli prompt`

## Deliverables
- code changes
- report at `tasks/deepseek_002_prompt_command_and_cli_wiring_report.md`
