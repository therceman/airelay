# Task 082: Filter attach keyboard combinations

## ID
`task_082_filter_attach_key_combinations`

## Agent
`DeepSeek`

## Execution Order
`1`

## File Ownership
- `src/commands/attach.ts`
- attach-focused tests under `test/`
- `tasks/todo/task_082_filter_attach_key_combinations_report_draft.md`
- `tasks/todo/task_082_filter_attach_key_combinations_report.md`

## Title
Block keyboard combinations in attach mode without breaking normal typing

## Baseline
- Start from clean pushed master `e00e7e8`.
- Airelay version: `0.1.70`.
- Task 081 Ctrl-C detach-only behavior is accepted and must remain intact.
- Do not bump version, commit, push, tag, release, or publish. Master will do that after review.

## User Semantics
- A key combination such as `Ctrl+A`, `Ctrl+Z`, `Ctrl+\\`, `Alt+X`, or modified navigation must not be forwarded to the underlying harness from `airelay attach`.
- Sequential ordinary input such as `A` then `B` remains allowed and must be forwarded immediately in order.
- `Ctrl+C` and `Ctrl+D` remain attach-client detach controls and must not reach the PTY.
- `airelay interrupt <session>` remains the separate active-turn interrupt mechanism.

## Terminal Encoding Constraint
The attach client receives terminal bytes, not physical key events. Enter and `Ctrl+M` both commonly encode as `0x0D`; Tab/`Ctrl+I` as `0x09`; Backspace/`Ctrl+H` may encode as `0x08` or `0x7F`. Do not claim these physically indistinguishable cases can be separated. Preserve normal Enter/Tab/Backspace behavior and explicitly document the unavoidable equivalence in the report.

## Required Behavior
- Implement a small, bounded, byte-wise attach input filter in the existing `AttachClient` path.
- Never delay or queue ordinary printable input merely to inspect a future byte.
- Forward printable UTF-8 input unchanged and in order, including consecutive bytes/chunks (`A` then `B`).
- Drop unambiguous C0 control shortcuts instead of forwarding them to the PTY, except the normal terminal editing/submission bytes that must remain usable (`CR`, `LF`, `TAB`, and standard Backspace encoding as supported by current tests).
- `Ctrl+C` (`0x03`) must call `detach('ctrl-c')`, write no raw input, and leave the runtime alive.
- `Ctrl+D` (`0x04`) must call `detach('ctrl-d')`, write no raw input, and leave the runtime alive.
- Filter modifier escape sequences: plain arrows/home/end/delete/page/function sequences supported by current attach input may pass; sequences that clearly encode Ctrl/Alt/Meta modifiers must be dropped as one bounded sequence.
- Do not introduce an unbounded escape-sequence buffer or timer. Define deterministic behavior for an incomplete/unknown escape sequence and test it.
- Do not alter ordinary direct `airelay start` stdin behavior.
- Do not add process kill, SIGTERM, SIGKILL, PTY recreation, session recreation, arbitrary shell, or remote command behavior.

## Mandatory Tests
Add deterministic tests proving:
- `Ctrl+A`, `Ctrl+Z`, `Ctrl+\\`, and representative unambiguous C0 shortcuts produce no raw PTY writes;
- `Ctrl+C` and `Ctrl+D` detach exactly once and produce no raw write;
- printable `A` followed by `B` is forwarded as `AB` in order;
- normal Enter, Tab, Backspace, and plain navigation remain usable;
- modified arrow/Alt/Meta escape sequences are dropped and do not leak partial bytes;
- incomplete/unknown escape sequences have bounded deterministic handling;
- filtering is immediate and does not wait for viewport/stream polling;
- reattach/runtime lifecycle remains unchanged after Ctrl+C/D detach;
- ordinary direct start still forwards the same raw stdin bytes as before.

Tests must use `test/utils.ts` isolation and never write to real `~/.airelay`.

## Validation
Run and include exit codes and timings:
- `npm run -s build`
- `npm run -s lint`
- `npm run -s format:check`
- `npm test -- --runInBand`
- `npm audit`
- `npx jest test/attach.test.ts --runInBand`
- `npx jest test/detached.test.ts --runInBand`

## Reporting Contract (Mandatory)
- First copy the canonical stub:
  - `cp tasks/report_stub.md tasks/todo/task_082_filter_attach_key_combinations_report_draft.md`
- Fill only the draft while working.
- Rename it to the exact final path only after implementation and validation:
  - `tasks/todo/task_082_filter_attach_key_combinations_report.md`
- Include the before/after byte policy, physical-key encoding limitation, exact changed files, bounded-filter proof, duplicate/performance review, all validation exit codes, and explicit pass/fail acceptance mapping.
- After the final report exists, send:
  - `airelay prompt gpt_master_airelay "task_082_done"`

## Completion
- Do not commit or push from the worker.
- Master reviews, bumps version, commits, and pushes after acceptance.
