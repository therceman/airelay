# Task Report

## Task ID
`task_080_rework_detached_lifecycle_without_process_kill`

## Summary
- Removed the task-079 process-control violation completely: `SpawnOptions.onPtyReady.kill`, `ptyKillRef` in `run.ts`, the detached controller watchdog, its `SIGTERM` call, and all watchdog-only env flags/constants/timers. `src/runtime/spawn.ts` is now byte-identical to master (no `kill` passthrough), and no task-079-added kill path remains anywhere.
- Preserved and revalidated all valid task-079 stream-attach work: lossless typed `stream` framing (`IpcStreamFrame`), bounded raw bootstrap ring + attach ordering guarantee, immediate raw input/resize, no clear/redraw polling, deterministic multi-client broadcast, bounded `SessionController.stop()` (client-connection cleanup only, unchanged), Ctrl-D/EOF/client-close detach-only semantics, and Ctrl-C as raw harness input (never an attach escape).
- Reworked controller-loss lifecycle honestly, without inventing a process-kill replacement: when a detached runtime's controller endpoint becomes unreachable while the runtime PID stays alive, the runtime is NOT terminated and no record is faked/deleted. The detached entry and session record are preserved (both gate liveness on the runtime PID), the entry is truthfully shown/concerning `controllerReachable: false` by `airelay detached`, `airelay prompt` reports `Controller offline for session: <key>` instead of claiming usability or an inconsistent `Session not found`, and `airelay detached --prune` keeps the entry (PID-reuse protection) — it never deletes a live runtime and never kills anything.
- Fixed the source of the earlier inconsistent state: for a detached runtime the session's liveness PID now tracks the runtime/controller process (the PID that serves the session and owns the controller socket) instead of the harness agent PID, so session pruning and the detached registry prune on the same lifecycle fact and cannot drop the session out from under a still-registered, still-alive runtime.

## Files Changed
Removed paths (task-079 process-control additions, now gone):
- `src/runtime/spawn.ts` — removed `kill: (signal?: string) => void;` from the `onPtyReady` param contract and `kill: (signal?: string) => pty.kill(signal),` from the `onPtyReady` invocation. File now matches master exactly (`git diff` shows no `src/runtime/spawn.ts`).
- `src/commands/run.ts` — removed `import { isControllerReachable } from './sessions'`, `DETACHED_WATCHDOG_DEFAULT_MS`, `CONTROLLER_FAULT_LIMIT`, `readWatchdogInterval()`, `ptyKillRef`, `detachedWatchdog`, `detachedShuttingDown`, `stopDetachedWatchdog()`, `ptyKillRef.current = pty.kill`, the entire watchdog `setInterval(… isControllerReachable … ptyKillRef.current?.('SIGTERM') …)` supervision block, and the `finally` `detachedShuttingDown=true` / `stopDetachedWatchdog()` calls.
- `test/test-utils.ts` — removed the `AIRELAY_DETACHED_WATCHDOG_MS` save/restore in `TestEnv`/`originalEnv`, the `TestEnv.originalEnv` interface field, the `delete` in `setupEnv`, and the `cleanupEnv` restore branch. File now matches master exactly.
- `test/detached.test.ts` — removed the "watchdog self-terminates …" test.

Changed (rework):
- `src/commands/run.ts` — session liveness PID now `process.pid` for detached runtimes (the runtime/controller process) instead of the harness agent PID, keeping session-prune and detached-registry-prune on the same lifecycle fact.
- `test/detached.test.ts` — replaced the watchdog test with an honest controller-loss test proving: no kill (runtime PID stays alive well beyond any watchdog window), entry + session preserved and marked `controllerReachable: false`, `promptCommand` returns 1 with `Controller offline` (never fake success, never inconsistent `Session not found`), and `pruneDetachedEntries` removes nothing while the PID is alive.

Preserved from task 079 (stream attach, unchanged by this rework):
- `src/commands/attach.ts` — `StreamTransport`/`createStreamTransport`, `AttachClient` (stream-driven verbatim render, Ctrl-D/EOF/client-close detach), `attachCommand` (bounded handshake, structured compat error). Ctrl-C (0x03) remains documented raw harness input.
- `src/controller/index.ts` — raw ring (`RAW_RING_MAX_BYTES=256KiB`, `RAW_RING_MAX_CHUNKS=8192`), `feedOutput` broadcast, synchronous `session.attach` replay+success ordering, `writeStreamFrame` per-socket cap (`STREAM_MAX_BUFFERED_BYTES=256KiB`), bounded `stop()` (`STOP_TIMEOUT_MS=2000ms` force-close of attached client sockets — client-connection cleanup only, never kills the agent/session).
- `src/controller/protocol.ts` — `serializeStreamFrame`.
- `src/types/controller.ts` — `IpcStreamFrame`.
- `test/attach.test.ts` — protocol/`serializeStreamFrame`/controller replay+broadcast/AttachClient/transport/compat/direct-vs-detached tests (20).

## Validation Commands
- `npm run -s build` -> `0`
- `npm run -s lint` -> `0`
- `npm run -s format:check` -> `0`
- `npm test -- --runInBand` -> `0` (37 suites, 418 tests, all passed)
- `npm audit` -> `0` vulnerabilities
- `npx jest test/attach.test.ts --runInBand` -> `0` (20 passed, ~2.0 s, clean exit)
- `npx jest test/detached.test.ts --runInBand` -> `0` (22 passed, ~8.6 s, clean exit)

### Source-level no-kill proof
- `rg -n "ptyKillRef|detachedWatchdog|CONTROLLER_FAULT_LIMIT|DETACHED_WATCHDOG|readWatchdogInterval|stopDetachedWatchdog|detachedShuttingDown|AIRELAY_DETACHED_WATCHDOG_MS" src/ test/` -> `NO MATCHES (clean)`
- `onPtyReady` contract now is `(pty: { pid; write; resize }) => void` — no `kill` member (`src/runtime/spawn.ts:15-19`), and `git diff` contains no `src/runtime/spawn.ts` (byte-identical to master).
- The only remaining `kill`/signal references in `src/` are pre-existing baseline functionality NOT added by task 079 (verified: `git diff --name-only` no longer lists `src/runtime/spawn.ts`, `src/utils/pid.ts`, `src/runtime/signals.ts`, `src/commands/heartbeat.ts`, `src/runtime/pty.ts`, `src/runtime/detached-registry.ts`, `src/commands/sessions.ts`): interactive Ctrl-C/SIGINT/SIGTERM forwarding in `spawnAndWaitPty`, `pty.ts` PTY `kill` used by that same interactive signal forwarding, `heartbeat.ts` teardown handlers, `signals.ts`/`pid.ts` PID-tracked cleanup, and `process.kill(pid, 0)` liveness probes. None of these are a detached controller-loss watchdog and none are invoked for controller-loss "cleanup"; they existed in the `751f9d6` baseline.

## Runtime/IPC Validation (if applicable)
- Honest controller-loss E2E (`test/detached.test.ts`, `loss_runtime_1`): a live detached runtime with a reachable controller has its socket file unlinked (controller endpoint gone while the runtime PID stays alive). Result: the runtime PID remains alive after 700 ms (no kill — the failing case under the old watchdog would have terminated it), the detached entry persists and `isEntryReachable` resolves `false`, the session record persists (session prune gates on the alive runtime PID), `promptCommand` returns 1 and prints `Error: Controller offline for session:` (never a fake `✓ Prompt sent`, never an inconsistent `Session not found`), and `pruneDetachedEntries()` returns 0 keeping the entry while the PID lives.
- Stream attach revalidation (unchanged from task 079, all still green after removing the watchdog): `serializeStreamFrame` round-trips newline/ANSI/UTF-8 losslessly; attach replays the bounded ring then streams live chunks in order with no boundary duplication; a chunk raced at the attach boundary arrives exactly once; three clients get identical lossless broadcasts; raw ANSI/UTF-8 output reaches the client render path byte-for-byte; attach is stream-driven (idle period produces zero renders — no poller); raw input is immediate/exact/no-appended-Enter; resize is immediate; Ctrl-D/EOF/client-close detach client-only and leave the runtime alive + reattachable; Ctrl-C (0x03) is forwarded raw to the harness and never detaches; a controller lacking `session.attach` yields one clear structured compat error; bounded shutdown force-closes attached client sockets (`controller.stop()`, `STOP_TIMEOUT_MS`) and resolves promptly.
- Ordinary direct `airelay start` remains the direct PTY/stdin/resize path (no attach polling) and never creates a detached registry entry; `prompt`/`interrupt` still route through the canonical controller.

## Lifecycle Limitation (exact source-level blocker) and Fix
- Blocker: with process-control prohibited, an already-running detached harness whose controller socket path was removed/unlinked externally cannot be safely compelled to terminate — there is no in-band byte or lifecycle signal the runtime can send the agent, and `pty.kill`/SIGTERM/SIGKILL are disallowed. No replacement kill mechanism was invented.
- Honest behavior implemented instead (deterministic + truthful): the runtime is left running; the detached entry and session record are both retained because they gate on the alive runtime PID; the entry is truthfully presented as `unreachable` (`airelay detached` text column and `--json controllerReachable: false`); `airelay prompt` reports `Controller offline for session: <key>` and exits 1; `airelay detached --prune` never removes it while the PID is alive (PID-reuse protection) but removes it the moment the PID is confirmed dead — the same safe path that also covers a hard-crashed runtime.
- Consistency fix: the session's liveness PID for detached runtimes is now the runtime/controller process PID (`process.pid`), matching the registry's `runtimePid` gate, so session pruning and registry pruning can never disagree (previously the session keyed on the harness agent PID, which could be dead while the runtime wrapper stayed alive, producing the live-looking entry with a pruned/unusable session the live test observed).

## Duplicate/Performance Review
- duplicate code findings: the rework removes the entire watchdog duplication (a second controller-prober) rather than layering anything new; `pruneStaleSessions` and `pruneDetachedEntries` both already reused the canonical `isControllerReachable` and `process.kill(pid,0)` liveness primitives — no new lifecycle machinery was added; no second store/PTY/transcript created.
- hot-path/performance findings: after the removal there is no periodic controller probing at all in any production runtime path (the old watchdog interval is gone), so no idle CPU/IO; stream delivery remains O(chunks) with bounded ring/backlog/per-socket write-buffer caps and bounded 2000 ms shutdown.
- proposed refactors: none required

## Acceptance Criteria Mapping
- No production path added by task 079 exposes or calls PTY/process kill for controller-loss cleanup -> `pass`; evidence: `rg` no-kill proof above; `src/runtime/spawn.ts` identical to master; `src/commands/run.ts` has no `kill`/`SIGTERM`/watchdog identifiers; only baseline (pre-079) signal forwarding remains, untouched by this diff.
- Raw stream ANSI/control/UTF-8 forwarding remains lossless and ordered -> `pass`; evidence: preserved `feedOutput` broadcast + `serializeStreamFrame` round-trip and raw-bytes E2E in `test/attach.test.ts` / `test/detached.test.ts`.
- Attach does not clear/redraw on a polling timer -> `pass`; evidence: `writeChunk` verbatim render, stream-driven AttachClient, E2E no-render-during-idle test.
- Attach raw input and resize remain immediate and exact -> `pass`; evidence: `writeRaw`/`writeResize` narrow IPC tests.
- Attach bootstrap has no duplicate/lost boundary bytes -> `pass`; evidence: synchronous replay+success ordering and boundary-race tests.
- Ctrl-D/EOF/client close leaves a healthy detached runtime alive and reattachable -> `pass`; evidence: detach-only semantics + E2E "client detach never stops the runtime and attached count returns to zero".
- Ctrl-C is forwarded as `0x03` and is not an attach escape -> `pass`; evidence: `writeRaw` doc + AttachClient 0x03 forwarding unit test + Ctrl-C harness-exit cleanup E2E.
- Prompt and interrupt still use the canonical controller -> `pass`; evidence: `prompt.ts`/`interrupt.ts` unchanged; prompt-routing E2E.
- Controller-loss behavior is deterministic and truthful without killing a process -> `pass`; evidence: honest controller-loss E2E (`loss_runtime_1`): PID stays alive, entry+session preserved and `unreachable`, prompt reports `Controller offline`, prune removes nothing while alive.
- No unbounded per-client buffer/listener/timer remains -> `pass`; evidence: ring/backlog/per-socket caps, bounded `controller.stop()`, listener cleanup tests.
- Older controller compatibility errors remain clear -> `pass`; evidence: structured compat-error test (code 1, single clear message).
- Tests use `test/test-utils.ts` isolation and never write to real `~/.airelay` -> `pass`; evidence: every socket/E2E test wraps `useTestEnv()`; watchdog env flag fully removed from test-utils.
- `npm run -s build`, `lint`, `format:check`, `npm test -- --runInBand`, `npm audit`, focused attach/detached suites -> `pass`; evidence: exit codes and timings above.
- Final report copied from stub, drafted, renamed to exact path, includes exact removed paths + source-level no-kill proof + pass/fail mapping -> `pass`; evidence: this file at `tasks/todo/task_080_rework_detached_lifecycle_without_process_kill_report.md` after rename.

## Risks and Follow-ups
- none blocking; task 079 remains in `tasks/rework` until this correction is reviewed and accepted; version bump/commit/push intentionally deferred to master per task rules.
- Operational note: a detached runtime whose controller socket file is removed while its PID is alive stays running and is retained (truthfully marked unreachable) until the runtime PID is confirmed dead; users should stop such a runtime themselves if it must exit — airelay deliberately cannot and must not kill it.

## Roadmap Recommendations
- none

## Completion Notification
- After final report rename, notify manager:
  - `airelay prompt gpt_master_airelay "task_080_done"`
  - Attempted: `node dist/airelay.cjs prompt gpt_master_airelay "task_080_done"` -> exit 1, `Error: Controller offline for session: gpt_master_airelay` (manager session not active). Re-send when the manager session is running.