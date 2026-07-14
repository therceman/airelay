# Task 067: Persist and List airelay Command History

## ID
`task_067_persist_and_list_airelay_command_history`

## Agent
`DeepSeek`

## Execution Order
`1`

## File Ownership
- `src/commands/run.ts`
- `src/commands/start.ts`
- `src/commands/history.ts`
- `src/cli.ts`
- `src/utils/` (only if a small command rendering/store helper is needed)
- `test/*.test.ts`

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Persist and list exact airelay launch commands

## Scope
- Add a persistent launch-history store in the global airelay state/config area. It must survive the launched harness exiting and must not be treated as the active-controller session store.
- Respect the repository's test isolation conventions. Add an environment override for the history store if required so tests never touch the real `~/.airelay`.
- For every `airelay start <profile> ...` launch, record at minimum:
  - profile name;
  - user session key, when supplied/generated;
  - the absolute directory from which `airelay` was invoked, before profile `cwd` resolution;
  - launch timestamp;
  - exact argument vector needed to reconstruct the invocation, including `--key`, all profile/harness arguments after `--`, `resume` arguments, and flags such as `--dangerously-bypass-approvals-and-sandbox`;
  - a copyable rendered command such as `airelay start codex --key wowage_master -- resume <id> --dangerously-bypass-approvals-and-sandbox`.
- Keep invocation directory distinct from the effective harness working directory. A profile-level configured `cwd` must not overwrite the directory stored in history.
- Store structured argv data as the source of truth and render the command from it with safe shell quoting. Do not reconstruct commands by lossy string concatenation.
- Ensure direct CLI starts record the exact command. Do not add selector/TUI behavior in this task.
- Add a dedicated `airelay history` command that lists recorded launch commands. It must support `--cwd` to list only commands invoked from the current directory and `--json` for machine-readable output. The default output must be a readable list, with one complete copyable command per entry plus profile/key/timestamp/cwd context.
- Preserve existing `airelay sessions` and global active-session/resume behavior. This task is only for command history and listing; do not repurpose active session pruning for history.
- Add tests for:
  - exact command/argv persistence, including flags and arguments containing spaces;
  - invocation cwd remaining distinct from profile effective cwd;
  - `airelay history` current-directory filtering and command output;
  - JSON output shape;
  - isolated history storage and no writes to the real home directory.
- Follow existing no-hardcoded-harness rules. Test with generic profile names and do not add profile-specific text for any particular harness.

## Non-goals
- Do not remove or redesign the existing active `sessions.json` schema.
- Do not change prompt injection, controller IPC, PTY behavior, or resume argument semantics.
- Do not add automatic execution, resume, or selector/TUI integration.
- Do not add a new naming/tagging feature; use the existing session key.
- Do not store only a lossy human-readable command string without structured argv data.

## Acceptance criteria
- A start invocation like `airelay start codex --key wowage_master -- resume 019efe9b-294a-7362-84da-875a68bbd645 --dangerously-bypass-approvals-and-sandbox` is persisted in global launch history with its invocation cwd, profile, key, timestamp, exact argv, and a copyable command containing every argument in order.
- Invocation cwd is the directory where airelay was called, even if the profile resolves an effective `cwd` elsewhere.
- Launch history survives normal harness exit and can be loaded independently of active controller/session pruning.
- `airelay history` prints the recorded commands as a readable list, and `airelay history --cwd` shows only entries invoked from the current directory.
- `airelay history --json` emits structured entries including exact argv, rendered command, invocation cwd, profile, session key, and timestamp.
- Existing `airelay sessions`, `--active`, `--cwd`, `--json`, resume, and controller behavior remains compatible.
- Arguments with whitespace/shell-sensitive characters are rendered safely and can be copied without changing argument boundaries.
- Tests cover persistence, filtering, JSON output, quoting, and test isolation.
- `npm run verify` passes.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm run -s format:check`
- `npm test`
- `npm run verify`

## Reporting Contract (Mandatory)
- Start by copying the base stub to a draft file:
  - `cp tasks/report_stub.md tasks/task_067_persist_and_list_airelay_command_history_report_draft.md`
- Fill that draft file only; do not author reports from scratch.
- When the report is complete and validated, rename it to the final path:
  - `mv tasks/task_067_persist_and_list_airelay_command_history_report_draft.md tasks/task_067_persist_and_list_airelay_command_history_report.md`
- The final report file name MUST be exactly `tasks/task_067_persist_and_list_airelay_command_history_report.md`.
- `tasks/report_stub.md` is the single source of truth for required report sections and order.
- The report MUST use exact section headings/order from `tasks/report_stub.md`.
- Every validation command in this task MUST be listed in the report under `## Validation Commands` with exit code.
- Every acceptance criterion MUST be mapped in the report with explicit status (`pass`/`fail`) and supporting evidence (file paths, test names, command output snippets).
- After the final report is renamed, send completion ping to manager:
  - `airelay prompt gpt_master_airelay "task_067_persist_and_list_airelay_command_history_done"`
- If any required report section is missing, renamed, or empty, the task is incomplete.
- Do not mark the task complete without the report.

## Deliverables
- code changes
- report at `tasks/task_067_persist_and_list_airelay_command_history_report.md`
