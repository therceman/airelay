# Task: Fix `start --key` Parsing + True Stale Prune + PID Visibility

## Task ID
`deepseek_039_fix_start_key_parsing_and_true_stale_prune_with_pid_visibility`

## Context
Current regressions after tasks 037/038:
1. `airelay start <profile> --key ...` does not parse correctly in normal usage order.
2. Stale prune uses socket path existence, not actual controller reachability.
3. Session list does not expose PID, making stale diagnosis opaque.
4. Stale entry example still present (`pending_opencode2_60lc`).

## Required report flow (mandatory)
1. Copy stub first:
`cp tasks/report_stub.md tasks/deepseek_039_fix_start_key_parsing_and_true_stale_prune_with_pid_visibility_report_draft.md`
2. Complete draft with evidence + validation exits.
3. Rename only when complete:
`mv tasks/deepseek_039_fix_start_key_parsing_and_true_stale_prune_with_pid_visibility_report_draft.md tasks/deepseek_039_fix_start_key_parsing_and_true_stale_prune_with_pid_visibility_report.md`

## Scope
Fix both tasks comprehensively.

### A) `start --key` parser correctness
- Support expected syntax:
  - `airelay start opencode2 --key worker_1 -- -s ses_xxx`
- `--key` must be parsed as start flag even when placed after profile, before `--`.
- Add/adjust tests that assert this exact invocation works.

### B) True controller liveness in stale pruning
- Replace `fs.existsSync(controllerEndpoint)` as liveness proof.
- Use actual controller reachability probe (socket connect / IPC ping) in prune logic.
- Prune stale entry when:
  - PID known and dead
  - AND controller probe unreachable/unresponsive
- Keep conservative behavior for entries without PID (do not auto-delete by default unless policy says so).

### C) PID visibility in session list
- Show PID in human session list output when present:
  - `pid: <n>` line under profile
- Include `pid` in `--json` output.

### D) Verify stale example removal
- Ensure stale entry like `pending_opencode2_60lc` is removed when dead by new prune logic.
- Include concrete verification evidence in report.

## Primary file ownership
- `src/cli.ts`
- `src/commands/sessions.ts`
- `src/commands/sessions-list.ts`
- controller/IPC reachability helper files as needed
- tests: `test/cli-runCli.test.ts`, `test/sessions.test.ts`, `test/sessions-list.test.ts`

## Acceptance criteria
1. `airelay start <profile> --key <k> -- ...` correctly sets custom key.
2. Stale prune uses real controller reachability, not mere endpoint file existence.
3. Dead stale sessions are auto-removed from `sessions.json` on listing.
4. Session list shows PID when available (human + json).
5. Build/lint/tests pass.

## Validation commands (mandatory)
- `npm run -s build`
- `npm run -s lint`
- `npm test -- cli-runCli sessions sessions-list run`
- `npm test`

Record exits in report.

## Report requirements
- Final report path:
`tasks/deepseek_039_fix_start_key_parsing_and_true_stale_prune_with_pid_visibility_report.md`
- Must follow exact headings/order from `tasks/task_report_template.md`.
- Must include acceptance mapping with concrete file/test evidence.

## Constraints
- Minimal/surgical change.
- Keep existing live session control behavior stable.
