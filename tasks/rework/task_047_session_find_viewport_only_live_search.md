# Task 047: Make session-find search current visible terminal viewport only

## Objective
Change `airelay session-find` behavior to search only what is currently visible in the terminal viewport via live proxy/controller query, not historical ring-buffer output.

## Problem
Current behavior searches controller ring-buffer lines (`session.output`) which includes earlier output that may no longer be visible. This causes false-positive matches for the user expectation of "currently visible terminal only".

## Scope
- Redefine `session-find` to operate on current visible viewport content only.
- Do not use historical ring-buffer lines for `session-find` matching.
- Keep compatibility/error handling robust for old sessions/controllers.

## Required Design
1. Add controller/proxy IPC surface for viewport snapshot (current visible screen content only).
2. Wire `session-find` to call the new viewport method.
3. Maintain clear errors for incompatible/old controllers:
   - actionable message to restart session with current airelay.
4. Keep `session-status` behavior aligned where it depends on search primitives; decide explicitly if it should keep historical mode or switch to viewport mode. Document decision in report.

## Files (expected)
- `src/controller/*` (new IPC method handling)
- `src/commands/session-find.ts`
- `src/commands/session-output.ts` (or split into dedicated viewport fetch helper)
- tests covering new semantics (command + controller E2E/unit)

## Acceptance Criteria
- `airelay session-find <session> <pattern>` matches only currently visible viewport text.
- Text that existed earlier but is no longer visible must not match.
- Clear compatibility error for sessions launched with older controller protocol.
- Tests updated/added to enforce viewport-only semantics.
- Validation passes:
  - `npm test`
  - `npm run verify`

## Report Instructions (Mandatory)
1. Copy `tasks/report_stub.md` to:
   - `tasks/todo/task_047_session_find_viewport_only_live_search_report_draft.md`
2. Fill all sections with concrete evidence.
3. When complete, rename to:
   - `tasks/todo/task_047_session_find_viewport_only_live_search_report.md`
4. Notify completion:
   - `airelay prompt gpt_master_airelay "task_047_done"`

## Constraints
- No hardcoded harness names in user-facing messaging.
- Keep protocol changes versioned/compatible with existing checks.
- Do not leave empty report sections.
