# Task Report

## Task ID
`task_078_add_detached_runtime_registry_and_attach`

## Summary
- Added explicit `airelay start --detached <profile>` that launches a supervised detached Airelay runtime/controller process (detached PTY + agent), does not inherit launcher stdin/stdout, and keeps running after the launcher exits. (No `--no-attach` alias was added, per correction.)
- Added a canonical detached-runtime registry (`~/.airelay/detached.json`, `AIRELAY_DETACHED`) reusing the existing JSON-store/PID utilities; entries are keyed by a stable `runtimeId` with deterministic duplicate session-key resolution (newest first, ties broken by `runtimeId`).
- Added `airelay attach <session>` viewport client: renders viewport via bounded 200 ms polling, forwards raw input and resize immediately through dedicated `session.input.raw` / `session.resize` IPC (fire-and-forget, no reply, no second Enter), and disconnects on Ctrl-D/EOF/terminal-close without stopping the runtime. A detached client (Ctrl-D/EOF) exits 0; it never creates a second PTY.
- Added `airelay detached` (text and `--json`) listing runtime/session/PID/controller/started/attached fields, and `airelay detached --prune` that removes only confirmed stale entries (controller unreachable AND runtime PID dead, protected against PID reuse) and never kills.
- Preserved the ordinary interactive `airelay start` direct-PTY path (regression-tested), the `airelay prompt` path (unchanged routing/delivery), and extended `session.info` with an attached-client count.

## Files Changed
- `src/types/controller.ts` — new IPC methods, `SessionInputRawParams`, `SessionResizeParams`, `SessionInfoData.attached`, `SessionAttachData`
- `src/controller/protocol.ts` — validation for `session.input.raw` / `session.resize`
- `src/controller/index.ts` — `attachedClients` set, `setOnAttachedChange`, `getAttachedClientCount`, `session.attach`/`session.detach`/`session.info.attached`/`session.input.raw`/`session.resize` handlers (raw/resize have no reply)
- `src/commands/session-ipc.ts` — `ControllerInfo.attached` forwarded
- `src/runtime/pty.ts` — `detached?: boolean` option (no stdout/raw/resize listeners when detached; `onOutput` still fires)
- `src/runtime/detached-registry.ts` — new canonical registry store (add/update/remove/list/find/prune with liveness check)
- `src/commands/detached.ts` — `startDetachedCommand`, `detachedRuntimeMain` (`__detach-run`), `detachedListCommand` (text/JSON), `detachedPruneCommand`, startup receipt
- `src/commands/attach.ts` — `AttachTransport`, `AttachClient` (200 ms `VIEWPORT_POLL_MS`, in-flight guard, immediate raw/resize), `createAttachTransport`, `attachCommand`
- `src/commands/run.ts` — `detached` option, `ptyResizeRef`, registry add/remove on start/exit, `setOnAttachedChange` sync
- `src/commands/start.ts` — `StartOptions.detached` dispatch
- `src/cli.ts` — known commands `attach`/`detached`/`__detach-run`, `--detached`/`--key` start intercepts, help text
- `test/test-utils.ts` — `AIRELAY_DETACHED`, `AIRELAY_DETACHED_RECEIPTS_DIR` env isolation
- `test/attach.test.ts` — new focused attach/protocol tests
- `test/detached.test.ts` — new detached lifecycle/registry/prune/parse/E2E tests

## Validation Commands
- `npm run -s build` -> `0`
- `npm run -s lint` -> `0`
- `npm run -s format:check` -> `0`
- `npm test -- --runInBand` -> `0` (37 suites, 406 tests, all passed)
- `npm audit` -> `0` vulnerabilities (audit-level=high)

## Runtime/IPC Validation (if applicable)
- Controller protocol tests (`test/attach.test.ts`): `session.attach`/`session.detach`/`session.input.raw`/`session.resize` accepted; invalid raw/resize params rejected with `INVALID_PARAMS`.
- Real-socket controller test: `attachedClients` count tracked, raw input forwarded verbatim into PTY, resize propagated to the PTY fd, client close decrements count without stopping the controller.
- AttachClient core: raw write is delivered synchronously via IPC (no Enter appended, no reply); resize is forwarded immediately via `session.resize`; rate-limited viewport poll at 200 ms cadence; Ctrl-D yields a clean detach of exit code 0.
- Detached E2E (`test/detached.test.ts`): `startDetachedCommand` prints receipt with session key/runtime id/runtime PID/agent PID/controller endpoint; the runtime child survives launcher exit and answers controller ping; `attachCommand` reaches the running controller; `SHUT` input ends the runtime and its registry entry is removed; input not ending the runtime leaves a prune-able stale entry.
- Behavior notes: ordinary `airelay start detachpro` E2E uses the direct PTY/stdin path (raw input echoed without waiting on a poll); viewport client exits 0 on Ctrl-D/EOF and code 1 only when the controller is gone; `airelay cleanup` orphan logic does not kill active detached runtimes because the runtime is the process parent and only true orphans (parent dead) are reaped.

## Duplicate/Performance Review
- duplicate code findings: reused `json-store.ts`, `ipc-path.ts`, `session-ipc.ts` (`sendControllerRequest`, `preflightVersionCheck`), PID store and `cleanupOrphanedPIDs`; no second persistence system for the same PID/session facts (detached registry stores runtime-supervision facts only, not session transcript)
- hot-path/performance findings: viewport polling capped at 200 ms (≤5 Hz); raw/resize bypass polling entirely via dedicated socket operations with an in-flight raw guard; a single `ptyResizeRef` avoids per-poll terminal mutations
- proposed refactors: none required

## Acceptance Criteria Mapping
- Ordinary interactive `airelay start` uses existing direct PTY path with stdin forwarding/resize not gated by 200 ms poll -> `pass`; evidence: `src/commands/start.ts`/`src/cli.ts` default path unchanged, E2E in `test/detached.test.ts` ("start without --detached") + `test/cli-runCli.test.ts`
- `airelay start --detached <profile>` returns structured receipt with session key/id, runtime PID, agent PID, controller endpoint; launcher stdin/stdout not inherited -> `pass`; evidence: `startDetachedCommand` (`src/commands/detached.ts`) with `stdio:'ignore'` + `unref()`, E2E test captures receipt, receipt fields tested
- Detached runtime survives launcher/client exit and remains controller-reachable; `attach` creates no second PTY/agent -> `pass`; evidence: E2E liveness/controller-ping test; `attachCommand` resolves existing controller only; `session.detach` leaves controller running
- `airelay attach <session>` renders viewport at ≤5 updates/sec and disconnects without stopping runtime -> `pass`; evidence: `AttachClient` `VIEWPORT_POLL_MS=200`, real-socket controller tests, Ctrl-D/EOF detach exit-0 E2E
- Raw input and resize sent immediately via dedicated IPC, independent of polling, no unintended Enter -> `pass`; evidence: `session.input.raw`/`session.resize` fire-and-forget in `src/controller/index.ts`, `AttachClient.writeRaw/writeResize` tests ("forwarded immediately", "not waiting for a poll")
- Existing `airelay prompt <session>` still reaches detached runtime with one delivery and unchanged timing/watcher -> `pass`; evidence: `promptCommand` unchanged (`src/commands/prompt.ts`), prompt-routing test in `test/detached.test.ts`
- `airelay detached` and `--json` list required runtime/session/PID/controller fields; stable runtime-id keying + deterministic duplicate resolution -> `pass`; evidence: `detachedListCommand` text/`--json`, `findDetachedBySessionKey` newest-first sort, duplicate resolution test
- `airelay detached --prune` removes only confirmed stale entries; PID reuse + live controller protected; `airelay cleanup` does not kill active detached runtimes -> `pass`; evidence: `pruneDetachedEntries` (controller-reachability + runtime-PID liveness gates), `isProcessAlive` tests, cleanup-isolation test
- Explicit runtime stop/exit cleans registry and session; client detach never stops runtime -> `pass`; evidence: `run.ts` finally removes registry entry; `SHUT` E2E removes entry; attach detach keeps runtime alive
- Tests use `test/utils.ts` isolation, never touch real `~/.airelay` -> `pass`; evidence: every E2E/socket test wraps `useTestEnv()`; `AIRELAY_DETACHED`/receipts under `testEnv` dirs
- `npm run -s build`, `lint`, `format:check`, `npm test -- --runInBand`, `npm audit` pass -> `pass`; evidence: exit codes above
- Final report copied from stub, drafted, renamed to exact path, maps every criterion to evidence -> `pass`; evidence: this file; `git status` shows no other report edits

## Risks and Follow-ups
- none blocking; version bump/commit/push intentionally deferred to master per task rules

## Roadmap Recommendations
- none

## Completion Notification
- After final report rename, notify manager:
  - `airelay prompt gpt_master_airelay "task_078_done"`