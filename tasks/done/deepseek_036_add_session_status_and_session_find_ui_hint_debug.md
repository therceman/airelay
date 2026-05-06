# Task: Add `session-status` + `session-find` with Harness UI-Hint Config

## Task ID
`deepseek_036_add_session_status_and_session_find_ui_hint_debug`

## Context
Need operational visibility for controllable sessions and easier debugging of harness UI hints.

Requirements from product behavior:
- Codex working hint text: `esc to interrupt`
- Opencode working hint text: `esc interrupt`

These hint strings should not be hardcoded in command logic; they should live in harness capability/config model.

## Required report flow (mandatory)
1. Copy stub first:
`cp tasks/report_stub.md tasks/deepseek_036_add_session_status_and_session_find_ui_hint_debug_report_draft.md`
2. Complete with evidence + validation exits.
3. Rename only when complete:
`mv tasks/deepseek_036_add_session_status_and_session_find_ui_hint_debug_report_draft.md tasks/deepseek_036_add_session_status_and_session_find_ui_hint_debug_report.md`

## Scope
Add two commands:
1. `airelay session-status <session>`
2. `airelay session-find <session> <pattern>`

### Shared requirement (critical)
- Both commands must search the CURRENT TERMINAL VIEW via proxy/live stream buffer for active sessions.
- Do not rely only on static filesystem logs.
- Implement one shared utility/path for live terminal-view search and reuse it in both commands.

### `session-status` behavior
- Resolve session by key/id.
- Report transport/process health:
  - controller reachable/unreachable
  - pid alive/dead (if available)
  - optional IPC info ping latency
- Report `ui_hint` based on live terminal-view search using harness-configured hint patterns.
- Use same matcher/search utility as `session-find` to determine working-state hints.
- Output modes:
  - human readable (default)
  - `--json`

### `session-find` behavior
- UX contract (required):
  - `airelay session-find <session> "esc interrupt"`
- Must search the CURRENT TERMINAL VIEW via proxy/live stream buffer for active sessions.
- Minimal contract:
  - exits `0` when found, `1` when not found
  - prints matched line/context (bounded)
  - supports `--json` for structured output

## Harness config requirements
- Extend harness capabilities/config to include UI hint patterns for working state.
- At minimum:
  - codex: `esc to interrupt`
  - opencode: `esc interrupt`
- Commands must consume these patterns from config, not inline literals in command logic.

## Primary file ownership
- `src/cli.ts`
- `src/utils/harness.ts` (or dedicated capability file)
- shared search utility file (new)
- `src/commands/session-status.ts` (new)
- `src/commands/session-find.ts` (new)
- existing session/controller utility files as needed
- tests for both commands + cli wiring

## Implementation constraints
- Keep authoritative status based on transport/process checks.
- UI text detection is best-effort `hint`, not sole truth.
- Minimal/surgical changes; avoid broad refactors.

## Acceptance criteria
1. `airelay session-status <session>` reports health and `ui_hint` when matching configured pattern from live terminal view.
2. `airelay session-status <session> --json` returns structured status including hint detection result.
3. `airelay session-find <session> "esc interrupt"` finds from live proxy/current terminal view.
4. `session-status` and `session-find` reuse shared live-view search logic.
5. Codex and opencode hint patterns are defined in harness config/capabilities.
6. Build/lint/tests pass.

## Validation commands (mandatory)
- `npm run -s build`
- `npm run -s lint`
- `npm test -- cli-runCli session-status session-find`
- `npm test`

Record exits in report.

## Report requirements
- Final report path:
`tasks/deepseek_036_add_session_status_and_session_find_ui_hint_debug_report.md`
- Must follow exact headings/order from `tasks/task_report_template.md`.
- Must include acceptance mapping with concrete file/test evidence.

## Constraints
- No hardcoded harness-name checks for hint text in command logic.
- Hint phrases must come from harness capabilities config.
