# Task 058: Replace ui-hint parsing with activity-based busy/free state

## Objective
Implement harness-agnostic session activity state in `session-status` based on live output changes, and remove text ui-hint parsing logic.

## Required Behavior
1. Determine state from live output changes:
   - Capture/compare output snapshots every 1 second.
   - If output changed at least once within last 10 seconds -> `busy`.
   - If no change within last 10 seconds -> `free`.
2. Spinners/animated output must count as activity (`busy`).
3. Remove dependence on ui-hint string parsing (`esc interrupt`, etc.) for state.

## session-status Output Format
Use this shape (ordering and labels):

Session: <id>
  Profile: <profile>
  Key:     <sessionKey>
  Controller: reachable (<ms>ms)
  Airelay version: <version>
  Protocol version: <protocol>
  Started: <iso>
  State: busy / free
  Output lines buffered: <n>

Notes:
- If key missing, still print line with fallback value.
- If controller unreachable, show actionable message and non-zero exit where appropriate.

## Implementation Requirements
- Add controller-side tracking for last output change timestamp and/or rolling change history.
- Expose needed info via IPC (e.g. `session.info` extension or dedicated method).
- Keep implementation lightweight and bounded.
- No harness-specific text matching for state.

## Tests (Mandatory)
Add tests covering:
1. No output changes for >=10s => `free`.
2. At least one change within 10s => `busy`.
3. Spinner-like rapid updates => `busy`.
4. session-status output format includes `State: busy/free` exactly.
5. Existing session-status functionality remains valid.

## Acceptance Criteria
- `session-status` reports `State: busy/free` from live-output change logic.
- ui-hint parsing no longer used for busy detection.
- Output format matches required layout.
- `npm test` exits `0`.
- `npm run verify` exits `0`.

## Report Process (Mandatory)
1. Copy `tasks/report_stub.md` to:
   - `tasks/todo/task_058_session_status_activity_state_from_live_output_report_draft.md`
2. Fill all sections with concrete evidence + exit codes.
3. Rename to:
   - `tasks/todo/task_058_session_status_activity_state_from_live_output_report.md`
4. Notify completion:
   - `airelay prompt gpt_master_airelay "task_058_done"`
