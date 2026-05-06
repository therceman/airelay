# Task: Add Controller Version Handshake + Actionable Compatibility Errors

## Task ID
`deepseek_044_add_controller_version_handshake_and_actionable_compat_errors`

## Context
`session-find` currently prints vague errors like `Unexpected response` when targeting sessions started by older airelay/controller builds.

Need explicit compatibility diagnostics so users immediately know whether session was launched with old/new build.

## Required report flow (mandatory)
1. Copy stub first:
`cp tasks/report_stub.md tasks/deepseek_044_add_controller_version_handshake_and_actionable_compat_errors_report_draft.md`
2. Complete draft with evidence + validation exits.
3. Rename only when complete:
`mv tasks/deepseek_044_add_controller_version_handshake_and_actionable_compat_errors_report_draft.md tasks/deepseek_044_add_controller_version_handshake_and_actionable_compat_errors_report.md`

## Scope
### A) Version/protocol metadata
Track and expose:
- `airelayVersion`
- `controllerProtocolVersion`
- `startedAt`

Implement in two places:
1. Persist in session record at launch.
2. Expose over controller IPC (`session.info` or new `session.meta`).

### B) Actionable compatibility errors
Update `session-find` and `session-status` output handling:
- If controller does not support required method(s) (`session.output` etc.), detect method-not-found/legacy response and print actionable message:
  - e.g. `Session controller protocol is older than this CLI. Restart the session with current airelay.`
- Include versions (stored/runtime when available) in message and JSON output.

### C) Runtime env visibility (optional but recommended)
Inject env vars into spawned session:
- `AIRELAY_VERSION`
- `AIRELAY_CONTROLLER_PROTOCOL_VERSION`

## Primary file ownership
- `src/controller/index.ts`
- `src/controller/protocol.ts`
- `src/types/controller.ts`
- `src/commands/session-output.ts`
- `src/commands/session-find.ts`
- `src/commands/session-status.ts`
- `src/commands/sessions.ts` (record metadata)
- `src/commands/run.ts`
- tests for compatibility/error paths

## Acceptance criteria
1. Session records include controller/version metadata for newly started sessions.
2. Controller IPC exposes protocol/version metadata.
3. `session-find` and `session-status` replace generic `Unexpected response` with actionable compatibility message.
4. JSON output includes structured compatibility fields.
5. Build/lint/tests pass.

## Validation commands (mandatory)
- `npm run -s build`
- `npm run -s lint`
- `npm test -- session-find session-status controller sessions`
- `npm test`

Record exits in report.

## Report requirements
- Final report path:
`tasks/deepseek_044_add_controller_version_handshake_and_actionable_compat_errors_report.md`
- Must follow exact headings/order from `tasks/task_report_template.md`.
- Must include acceptance mapping with concrete file/test evidence.

## Constraints
- Backward-compatible with existing sessions where possible.
- Minimal/surgical changes; no unrelated refactors.
