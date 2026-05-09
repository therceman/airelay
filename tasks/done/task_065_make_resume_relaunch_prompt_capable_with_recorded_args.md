# Task 065: Make `resume` relaunch prompt-capable using recorded start semantics

## Objective
Ensure resumed sessions are always relaunched in prompt-capable mode, using the same effective launch semantics as `start` with recorded session key and profile args.

## Problem
Current resumed sessions can become non-promptable (`ptyWrite` unavailable), producing:
`Prompt injection unavailable: this session is not in a promptable mode.`

## Required Behavior
For a saved session entry, resume should effectively behave like:
`airelay start <profile> --key <sessionKey> -- <recorded profileArgs>`

Example target behavior:
`airelay start opencode2 --key deepseek_airelay -- -s ses_208a8de9cffeSDpDMnZI6P4XcF`

## Implementation Requirements
1. `resume` command path must call `runCommand` in prompt-capable mode (PTY-enabled path equivalent to `start`).
2. Use persisted metadata in priority order:
   - `sessionKey` for key reuse
   - `profileArgs` for harness args replay
   - `profileSessionId` only as fallback arg source when needed
3. Avoid reconstructing legacy non-PTY behavior.
4. Keep legacy fallback warnings when metadata is missing, but still ensure resulting run is prompt-capable.

## Validation Requirements
Add tests proving:
1. Resume path launches prompt-capable (same mode as `start`).
2. Resume reuses recorded `sessionKey` and `profileArgs`.
3. Prompt command works after resume (or unit-level equivalent showing PTY/input binding present).
4. Legacy metadata fallback still works.

## Acceptance Criteria
- Resumed session accepts `airelay prompt <session> ...` immediately.
- Resume semantics align with start + recorded args/key.
- `npm test` exits `0`.
- `npm run verify` exits `0`.

## Report Process (Mandatory)
1. Copy `tasks/report_stub.md` to:
   - `tasks/todo/task_065_make_resume_relaunch_prompt_capable_with_recorded_args_report_draft.md`
2. Fill all sections with concrete evidence + exit codes.
3. Rename to:
   - `tasks/todo/task_065_make_resume_relaunch_prompt_capable_with_recorded_args_report.md`
4. Notify completion:
   - `airelay prompt gpt_master_airelay "task_065_done"`
