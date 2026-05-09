# Task 063: Add `airelay prompt --stdin` support

## Objective
Support sending prompt text from stdin for multi-line input via heredoc/pipes.

## Required UX
Working examples:
`airelay prompt deepseek_aitask --stdin <<'EOF'`
`hello this is message`
`EOF`

`cat message.txt | airelay prompt deepseek_aitask --stdin`

## Semantics
1. `--stdin` tells command to read full stdin as text payload.
2. Multi-line text must be preserved.
3. If stdin is empty with `--stdin`, return non-zero with clear error.
4. `--stdin` must be mutually exclusive with inline text arg / `--text`.
5. Existing prompt behavior unchanged when `--stdin` not used.

## Flags compatibility
- Keep existing options (`--no-warn`, `--no-enter`, `--only-enter`, `--only-sequence`, sender flags) working with stdin mode where valid.
- Invalid combinations should produce clear errors (same style as existing prompt validations).

## Implementation Scope
- CLI parsing/validation for `prompt` command.
- Prompt command text source handling (stdin vs arg).
- Tests for stdin mode and validation conflicts.

## Tests (Mandatory)
Add tests for:
1. Heredoc/pipe style stdin text is sent.
2. Multi-line payload preserved.
3. Empty stdin with `--stdin` errors non-zero.
4. Conflict: `--stdin` + inline text errors non-zero.
5. Existing non-stdin prompt path still passes.

## Acceptance Criteria
- `airelay prompt <session> --stdin <<EOF ... EOF` works.
- Pipe input works.
- Validation and error messages are clear.
- `npm test` exits `0`.
- `npm run verify` exits `0`.

## Report Process (Mandatory)
1. Copy `tasks/report_stub.md` to:
   - `tasks/todo/task_063_add_prompt_stdin_input_support_report_draft.md`
2. Fill all sections with concrete evidence + exit codes.
3. Rename to:
   - `tasks/todo/task_063_add_prompt_stdin_input_support_report.md`
4. Notify completion:
   - `airelay prompt gpt_master_airelay "task_063_done"`
