# Task: Auto-Prune Stale Sessions from `sessions.json` Using PID + Controller Liveness

## Task ID
`deepseek_037_auto_prune_stale_sessions_using_pid_and_controller_liveness`

## Context
`airelay sessions --cwd` can show stale/dead entries (example: old `pending_*` sessions). We need automatic cleanup.

## Required behavior
- On session listing path, stale entries must be removed from `sessions.json` automatically.
- Liveness decision must use BOTH checks:
  1. recorded PID is alive
  2. controller endpoint is reachable/responding
- If both indicate dead/unreachable, session is stale and must be pruned.

## Required report flow (mandatory)
1. Copy stub first:
`cp tasks/report_stub.md tasks/deepseek_037_auto_prune_stale_sessions_using_pid_and_controller_liveness_report_draft.md`
2. Complete draft with evidence + validation exits.
3. Rename only when complete:
`mv tasks/deepseek_037_auto_prune_stale_sessions_using_pid_and_controller_liveness_report_draft.md tasks/deepseek_037_auto_prune_stale_sessions_using_pid_and_controller_liveness_report.md`

## Scope
Implement automatic stale-session pruning for all `sessions` listing modes:
- default
- `--cwd`
- `--json`
- `--active`

## Primary file ownership
- `src/commands/sessions.ts` (schema/data helpers)
- `src/commands/sessions-list.ts`
- `src/utils/pid.ts` and/or liveness utilities
- `src/controller` client helper if needed
- tests for stale-prune behavior

## Implementation requirements
1. Session record liveness metadata
- Ensure session entries can track runtime PID (if not already).
- Populate PID when launching controllable sessions.

2. Prune pass
- Before rendering sessions list, perform prune pass:
  - evaluate each session:
    - PID alive?
    - controller responsive?
  - if stale => remove from in-memory set and persist updated `sessions.json`.

3. Safety
- Avoid false deletion during transient startup windows (use small grace handling if needed).
- Keep pruning deterministic and testable.

4. Output behavior
- Pruned sessions must not appear in output.
- No extra noisy warnings by default.

## Acceptance criteria
1. Dead sessions are automatically removed from `sessions.json` on `airelay sessions` execution.
2. `airelay sessions --cwd` no longer shows stale dead entries.
3. `--active`/`--json` remain correct after prune.
4. Tests cover stale PID + dead controller pruning path.
5. Build/lint/tests pass.

## Validation commands (mandatory)
- `npm run -s build`
- `npm run -s lint`
- `npm test -- sessions sessions-list`
- `npm test`

Record exits in report.

## Report requirements
- Final report path:
`tasks/deepseek_037_auto_prune_stale_sessions_using_pid_and_controller_liveness_report.md`
- Must follow exact headings/order from `tasks/task_report_template.md`.
- Must include `## Acceptance Criteria Mapping` with concrete file/test evidence.

## Constraints
- Minimal/surgical changes.
- Do not break current prompt/session control behavior for live sessions.
