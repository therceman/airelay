# Task 079: Restore true PTY attach rendering for detached runtimes

## ID
`task_079_restore_true_pty_attach_stream`

## Agent
`DeepSeek`

## Execution Order
`1`

## File Ownership
- `src/commands/attach.ts`
- `src/commands/detached.ts`
- `src/commands/run.ts`
- `src/controller/index.ts`
- `src/controller/protocol.ts`
- `src/runtime/pty.ts`
- `src/types/controller.ts`
- canonical IPC/runtime utilities as required by the source audit
- `test/attach.test.ts`
- focused tests under `test/`
- `tasks/todo/task_079_restore_true_pty_attach_stream_report_draft.md`
- `tasks/todo/task_079_restore_true_pty_attach_stream_report.md`

## Roadmap Ownership
- Do not edit `PLAN.md` or `PLAN_DONE.md`.
- Recommend roadmap changes in the report only.

## Title
Restore true PTY attach rendering for detached runtimes

## Baseline
- Start from clean pushed master `751f9d6`.
- Airelay version: `0.1.68`.
- Do not bump version, commit, push, tag, release, or publish in this task. Master will do that after review.

## Problem
The current `airelay attach <session>` is only a 200 ms `session.viewport` polling client. It clears the terminal and prints already-rendered lines on each poll. This does not look like the original interactive PTY because it loses raw terminal output/control sequences, cursor position, alternate-screen transitions, colors, wrapping, blank-row layout, and other terminal state.

The detached runtime already owns the real PTY. Attach must connect to that existing PTY stream through the controller; it must not create a second agent or PTY.

### Observed live regression to cover
During a real detached attach test, the controller socket disappeared while the detached runtime PID remained alive in `detached.json`; the session was then removed by normal session pruning and `airelay prompt <key>` reported `Session not found`. Investigate and fix this lifecycle inconsistency as part of the task. A runtime with no reachable controller must either terminate/clean its own registry and session state or become a clearly stale, safely pruneable entry; it must not remain as a live-looking detached runtime with an unusable session.

## Mandatory Source Audit
Before changing production code, inspect:
- current `attach.ts`, detached launcher/runtime path, `SessionController`, IPC framing/protocol, PTY output callback, and terminal-buffer implementation;
- how raw PTY output is currently forwarded, buffered, and rendered;
- `~/git/reporelay` for its proxy/session attach implementation and tests, if relevant;
- existing tests and CLI/API conventions.

The report must explain why the current viewport polling cannot reproduce the original PTY state and identify the smallest canonical extension.

## Required Behavior

### 1. Exact PTY-stream attach
- Keep `airelay start <profile> ...` unchanged: ordinary start remains the direct PTY/stdin/resize path with no attach polling.
- Keep explicit `airelay start --detached <profile> ...` as the only detached launch mode. Do not add or restore `--no-attach`.
- `airelay attach <session>` must attach to the existing runtime/controller and never start a second agent or PTY.
- After attach, forward the runtime's PTY output to the client as a raw terminal byte stream or an equivalent lossless framed stream. Preserve ANSI/control bytes and ordering exactly; do not reduce the stream to plain viewport lines.
- Do not clear and redraw the full screen every 200 ms. Do not inject a synthetic `\x1b[2J\x1b[H` on every update.
- The attached terminal must preserve, as far as the existing architecture permits, colors, cursor movement/visibility, alternate-screen transitions, blank rows, line wrapping, and prompt layout.
- Input remains immediate through the existing narrow raw-input IPC path. It must not wait for output polling and must not append Enter.
- Resize remains immediate through the existing narrow resize IPC path and must resize the runtime PTY.
- Ctrl-D, EOF, terminal close, or explicit client disconnect must detach only the client. It must not stop, kill, recreate, or restart the runtime/agent/PTY.
- Preserve the existing safe high-level `prompt` and `interrupt` controller paths.

### 2. Attach bootstrap and stream lifecycle
- Define a typed, narrowly scoped IPC operation/notification for attach bootstrap and/or raw PTY output. Do not add arbitrary shell or general remote-command functionality.
- Eliminate output races between `session.attach` and the first streamed bytes. The report must describe the ordering/handshake guarantee.
- A newly attached client needs a bounded current-state bootstrap. Reuse existing controller/terminal state where possible; do not create a second persistent transcript/log only for attach.
- If exact reconstruction of an already-rendered PTY screen is impossible without a full raw history, document that limitation and provide the best bounded bootstrap supported by the current terminal implementation. New output after attach must be lossless and live.
- Disconnect/error cleanup must remove listeners and pending requests. No unbounded queues, timers, or per-client memory growth.
- Controller loss/runtime failure must not leave a live PID with a missing controller endpoint and an unusable session; test the registry/session cleanup or deterministic stale-prune path.
- Multiple attach clients must either receive the same stream safely or be explicitly rejected with a deterministic structured error. Do not silently corrupt stream ordering.
- Keep the existing `airelay detached` registry and attached-client count accurate.

### 3. Compatibility and safety
- The controller must remain local IPC only, using the existing endpoint abstraction.
- Preserve the existing direct-start behavior and tests.
- Do not add process kill, SIGTERM, SIGKILL, PTY recreation, session recreation, or arbitrary remote shell APIs.
- Do not duplicate the persisted session/PID/registry stores.
- Keep viewport polling only if needed as an explicit fallback/status API; it must not be the primary attach renderer.

## Mandatory Tests
Add deterministic tests proving at minimum:
- direct ordinary `start` still forwards PTY stdout/stdin/resize immediately;
- detached start creates one runtime/agent/PTY and attach does not create another;
- an ANSI/control-sequence fixture is delivered to an attached client losslessly and in order;
- attach does not emit a forced clear/redraw sequence every polling interval;
- attached raw input is immediate, exact, and has no appended Enter;
- attached resize is immediate and reaches the existing PTY;
- attach bootstrap has no output race or duplicated bytes at the attach boundary;
- Ctrl-D/EOF/client close leaves the detached runtime and agent alive and usable;
- prompt and interrupt still route through the canonical controller for the same session;
- disconnect/error cleanup removes stream listeners, timers, and pending state;
- controller loss/runtime failure cannot leave an unusable live-looking detached registry/session entry;
- multiple clients are handled deterministically according to the selected design;
- registry attached-client counts remain correct;
- an older/unsupported controller produces a clear structured compatibility error if the new stream operation requires protocol parity.

Tests must use `test/utils.ts` isolation and must never write to the real `~/.airelay`.

## Validation
Run and include exit codes in the final report:
- `npm run -s build`
- `npm run -s lint`
- `npm run -s format:check`
- `npm test -- --runInBand`
- `npm audit`

Run focused attach/detached IPC and PTY-stream tests separately and include their command, result, and timing.

## Reporting Contract (Mandatory)
- Start by copying the base stub to:
  - `cp tasks/report_stub.md tasks/todo/task_079_restore_true_pty_attach_stream_report_draft.md`
- Fill the draft only; do not author a report from scratch.
- Rename only after all implementation and validation is complete:
  - `mv tasks/todo/task_079_restore_true_pty_attach_stream_report_draft.md tasks/todo/task_079_restore_true_pty_attach_stream_report.md`
- The final report path must be exactly:
  - `tasks/todo/task_079_restore_true_pty_attach_stream_report.md`
- Every validation command must be listed under `## Validation Commands` with exit code.
- Every acceptance criterion must have explicit `pass`/`fail` evidence.
- Include source-audit findings, IPC framing/order, bootstrap limitation, memory/timer bounds, duplicate/performance review, and exact changed files.
- Missing, empty, scratch, or stub-only reports are incomplete.
- After renaming the final report, notify the manager with:
  - `airelay prompt gpt_master_airelay "task_079_done"`

## Deliverables
- true lossless PTY-stream attach for detached runtimes;
- bounded attach bootstrap and deterministic stream lifecycle;
- immediate input/resize preserved;
- direct-start regression coverage;
- final report at the exact required path.
