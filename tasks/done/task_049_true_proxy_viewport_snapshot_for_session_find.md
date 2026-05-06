# Task 049: Implement true proxy viewport snapshot for session-find

## Objective
Implement **actual current visible terminal viewport** search for `airelay session-find` using proxy terminal state, not reconstructed output-line heuristics.

## Why Task 048 Is Still Not Accepted
Task 048 still derives viewport from processed output lines (`\n`/`\r`) and explicitly does not handle full ANSI cursor movement / alternate buffer redraw behavior. That is not equivalent to real currently visible screen content.

## Required Approach
1. Use proxy terminal screen model as source of truth (same source that renders terminal view).
2. Expose IPC method returning the current rendered viewport text lines exactly as visible now.
3. Make `session-find` consume this true viewport snapshot.
4. Keep compatibility handling for old controllers (`METHOD_NOT_FOUND` -> actionable restart message).

## Functional Requirements
- Searching must reflect the visible screen only.
- Historical lines not visible now must never match.
- Redraw/cursor-motion content must be represented correctly for search.
- Alternate buffer/full-screen sessions must still be searchable by visible text.

## Tests (Mandatory)
Add or adapt tests proving:
1. Cursor rewrite/ANSI redraw case returns final visible text only.
2. Scrolled-off content is absent from viewport snapshot.
3. `session-find` returns match/no-match according to live viewport snapshot.
4. Compatibility error path for older controllers remains actionable.

## Files (likely)
- controller/proxy runtime screen-state files
- `src/commands/session-find.ts`
- viewport IPC helper(s)
- tests under `test/`

## Acceptance Criteria
- `npm test` exits `0`.
- `npm run verify` exits `0`.
- Implementation is based on true proxy viewport snapshot, not line-buffer approximation.
- Report includes concrete evidence of source-of-truth viewport integration.

## Report Process (Mandatory)
1. Copy `tasks/report_stub.md` to:
   - `tasks/todo/task_049_true_proxy_viewport_snapshot_for_session_find_report_draft.md`
2. Fill all sections with concrete evidence + exit codes.
3. Rename to:
   - `tasks/todo/task_049_true_proxy_viewport_snapshot_for_session_find_report.md`
4. Notify completion:
   - `airelay prompt gpt_master_airelay "task_049_done"`

## Constraints
- No hardcoded harness names in user-facing text.
- Do not claim completion with heuristic viewport logic.
- Keep changes minimal and focused on correctness.
