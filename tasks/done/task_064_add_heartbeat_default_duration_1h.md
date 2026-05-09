# Task 064: Add default 1-hour runtime limit to heartbeat command

## Objective
Update `airelay heartbeat <session>` so it runs for 1 hour by default, then exits cleanly.

## Required Behavior
1. Default runtime limit: **1 hour**.
2. During that hour, keep existing heartbeat interval behavior (default 5 minutes).
3. After 1 hour elapsed:
   - stop loop gracefully
   - print completion message
   - exit with code 0
4. Ctrl+C / SIGINT / SIGTERM should still stop early cleanly.

## CLI / Options
Minimum required:
- no new flags required for this task (default 1h behavior only).

Optional (if easy and safe):
- add `--duration <ms>` override (documented + tested), while default remains 1h.

## Tests (Mandatory)
Add/update tests for:
1. Heartbeat stops after default 1h (use fake timers).
2. Existing interval sends still happen during runtime.
3. Early signal stop still works.
4. Non-zero error behavior on prompt failure remains unchanged.

## Acceptance Criteria
- `airelay heartbeat <session>` exits automatically after 1h.
- Existing heartbeat functionality remains intact.
- `npm test` exits 0.
- `npm run verify` exits 0.

## Report Process (Mandatory)
1. Copy `tasks/report_stub.md` to:
   - `tasks/todo/task_064_add_heartbeat_default_duration_1h_report_draft.md`
2. Fill all sections with concrete evidence + exit codes.
3. Rename to:
   - `tasks/todo/task_064_add_heartbeat_default_duration_1h_report.md`
4. Notify completion:
   - `airelay prompt gpt_master_airelay "task_064_done"`
