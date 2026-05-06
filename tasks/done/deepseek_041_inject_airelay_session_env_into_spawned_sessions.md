# Task: Inject `AIRELAY_SESSION_*` Env Vars into Spawned Sessions

## Task ID
`deepseek_041_inject_airelay_session_env_into_spawned_sessions`

## Context
Need spawned worker sessions to self-identify when sending notifications (e.g. `make notify_master msg="..."`) without manually passing sender key.

## Required behavior
When launching via `airelay start` / run path, inject session metadata env vars into child process:
- `AIRELAY_SESSION_KEY=<session_key>`
- `AIRELAY_PROFILE=<profile_name>`
- `AIRELAY_SESSION_ID=<session_id>` (if available at launch time; if not, use session key until true id exists)
- `AIRELAY_CWD=<launch_cwd>`

## Required report flow (mandatory)
1. Copy stub first:
`cp tasks/report_stub.md tasks/deepseek_041_inject_airelay_session_env_into_spawned_sessions_report_draft.md`
2. Complete with evidence + validation exits.
3. Rename only when complete:
`mv tasks/deepseek_041_inject_airelay_session_env_into_spawned_sessions_report_draft.md tasks/deepseek_041_inject_airelay_session_env_into_spawned_sessions_report.md`

## Scope
- Inject env vars in the run/start spawn path only.
- Preserve existing profile env behavior and precedence rules.
- Add tests proving env vars are present in spawn options.

## Primary file ownership
- `src/commands/run.ts`
- `src/runtime/env.ts` or spawn assembly path
- tests: `test/run.test.ts`, `test/env.test.ts` (as needed)

## Implementation requirements
1. Populate session env vars before spawn call.
2. Do not override explicitly set profile env values for same keys unless policy is documented and tested.
3. Keep values stable per session.

## Acceptance criteria
1. Spawned process receives `AIRELAY_SESSION_KEY`, `AIRELAY_PROFILE`, `AIRELAY_CWD`.
2. `AIRELAY_SESSION_ID` present with deterministic value.
3. Existing functionality unchanged.
4. Build/lint/tests pass.

## Validation commands (mandatory)
- `npm run -s build`
- `npm run -s lint`
- `npm test -- run env`
- `npm test`

Record exits in report.

## Report requirements
- Final report path:
`tasks/deepseek_041_inject_airelay_session_env_into_spawned_sessions_report.md`
- Must follow exact headings/order from `tasks/task_report_template.md`.
- Must include acceptance mapping with concrete file/test evidence.

## Constraints
- Minimal/surgical changes.
- Do not break prompt/session control flow.
