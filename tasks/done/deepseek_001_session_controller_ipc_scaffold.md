# Task

## ID
`deepseek_001_session_controller_ipc_scaffold`

## Agent
`DeepSeek`

## Execution Order
`1`

## File Ownership
- `src/controller/*`
- `src/types/controller.ts` (new)
- `src/utils/ipc-path.ts` (new)
- `test/controller*.test.ts`

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Build local session controller and IPC scaffold for remote prompt injection

## Scope
- Add a local controller process abstraction that can own runtime stdin write access.
- Define IPC protocol for local commands:
  - `ping`
  - `session.info`
  - `session.input` (`text`, optional `enter=true`)
- Implement cross-platform endpoint resolution:
  - unix socket on macOS/Linux under `~/.airelay/sockets/`
  - named-pipe path strategy for Windows
- Add typed request/response models and structured errors.
- Add unit tests for protocol and endpoint path generation.

## Non-goals
- Do not wire CLI commands yet.
- Do not modify run/start/resume flow in this task.
- Do not add API/proxy remote network integration.

## Acceptance criteria
- New controller IPC module compiles and has tests.
- IPC request parsing rejects malformed payloads with explicit errors.
- Endpoint path helper guarantees deterministic path from session key.
- Build and lint pass.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm test -- controller`

## Deliverables
- code changes
- report at `tasks/deepseek_001_session_controller_ipc_scaffold_report.md`
