# Task 048: Rework session-find to true viewport-only (not rolling recent lines)

## Objective
Fix task 047 gap: `session-find` must search the **actual current visible terminal viewport** from proxy/PTY state, not a rolling "last N output lines" approximation.

## Why Rework Is Required
Task 047 introduced `viewportBuf` as last 30 fed lines. This is still history-derived output and can include lines not currently visible (and can miss/incorrectly represent wrapped/rewritten screen state). User requirement is strict: search only what is visible now.

## Required Behavior
1. `airelay session-find <session> <pattern>` searches the current live viewport snapshot.
2. Matches must reflect current visible screen state only.
3. Scrolled-off historical lines must not match.
4. Alternate-buffer/full-screen harnesses must still work (search visible screen content).

## Implementation Requirements
- Use the existing proxy terminal screen model (xterm/headless buffer or equivalent) as source of truth.
- Add/adjust IPC method to return rendered visible viewport lines from proxy, not raw recent output.
- Keep protocol/version compatibility handling and actionable restart errors for older controllers.
- Keep `session-status` behavior explicit and documented (if it remains historical, state why; if changed, test it).

## Scope
- `src/controller/*` and/or proxy runtime where terminal screen state is maintained
- `src/commands/session-find.ts`
- viewport fetch helper(s)
- tests: controller/proxy + command behavior enforcing true viewport semantics

## Acceptance Criteria
- Proven by tests that lines no longer visible do not match while visible lines do.
- Proven by tests that overwritten/redrawn screen content is reflected correctly.
- `npm test` passes.
- `npm run verify` passes.

## Mandatory Report Process
1. Copy `tasks/report_stub.md` to:
   - `tasks/todo/task_048_rework_true_viewport_only_session_find_report_draft.md`
2. Fill all sections with concrete evidence and command exit codes.
3. Rename to:
   - `tasks/todo/task_048_rework_true_viewport_only_session_find_report.md`
4. Notify completion:
   - `airelay prompt gpt_master_airelay "task_048_done"`

## Constraints
- No hardcoded harness names in user-facing text.
- No report section omissions.
- Do not claim viewport correctness without tests that demonstrate true screen-state behavior.
