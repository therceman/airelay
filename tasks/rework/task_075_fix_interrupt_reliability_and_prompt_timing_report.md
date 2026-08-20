# Task Report

## Task ID
`task_075_fix_interrupt_reliability_and_prompt_timing`

## Summary
- Audited the full `session.interrupt` lifecycle: `airelay interrupt` IPC -> `SessionController.handleMessage` (`src/controller/index.ts:290`) -> `run.ts` `onRequest` -> `InterruptController.request()` -> single `\x1b` PTY write -> polled acknowledgement via the working-hint viewport check -> bounded `timed_out`/`turn_changed` classification. The audit found a deterministic acknowledgement-classification race: after the ESC write already lands, `run.ts`'s natural-completion path can clear `activeTurnGeneration` mid-poll, after which the poll returned `failed/turn_changed` even though no replacement turn existed and the working signal had already cleared. This makes a successful single-ESC interrupt intermittently report failure and skip the mark-interrupted bookkeeping.
- Fixed the classification in `src/runtime/interrupt.ts` with the narrowest change: when the post-write poll sees a turn id, `failed/turn_changed` is returned only if a *different later turn* owns the session (replacement); when no turn is active at all, the ESC has already been delivered and the working signal cleared, so the controller acknowledges exactly once. Bounded, no repeats, no unbounded loops, no mutation of later-turn bookkeeping.
- Kept exactly one `\x1b` per logical interrupt. Evidence: opencode and codex accept a single ESC to stop generation; the failure was acknowledgement classification, not byte count. Tests now prove exact physical write counts (one per interrupt, none after ack/timeout/replacement/duplicate).
- Halved the authoritative non-zero prompt text-to-Enter default `TEXT_TO_SUBMIT_DELAY_MS` 2000 -> 1000 ms (`src/commands/prompt.ts`); `--fast-enter` still forces 0 ms (explicit caller override preserved). The `run.ts` prompt handler itself has no non-zero default (`0 ms` when the caller does not supply `submitDelayMs`), confirmed by audit.
- Halved the stuck-input retry timeout: codex `inputSubmitRetry.retryDelayMs` 5000 -> 2500 ms (`src/utils/harness.ts`). Capacity-continuation timing is unchanged (separate watcher; decision documented in this report).

## Files Changed
- `src/runtime/interrupt.ts` — ack poll now distinguishes a replaced turn (`turn_changed`, no ack) from a vanished turn with no replacement (ack exactly once after the ESC write).
- `src/commands/prompt.ts` — `TEXT_TO_SUBMIT_DELAY_MS` 2000 -> 1000 (authoritative non-zero prompt Enter delay).
- `src/utils/harness.ts` — codex `inputSubmitRetry.retryDelayMs` 5000 -> 2500.
- `test/interrupt.test.ts` — added deterministic regressions: acknowledge-when-turn-clears-mid-poll-without-replacement; vanished-turn ack does not contaminate a later turn.
- `test/prompt.test.ts` — assert effective delay 1000 by default; added `fastEnter` -> 0 override test.
- `test/input-submit-watcher.test.ts` — adopt audited 2500 ms config throughout; assert the codex capability default is 2500.

## Validation Commands
- `npm run -s build` -> `0`
- `npm run -s lint` -> `0`
- `npm run -s format:check` -> `0`
- `npm test -- --runInBand` -> `0` (35 suites, 375 tests)
- focused regressions: `npx jest test/interrupt.test.ts test/prompt.test.ts test/input-submit-watcher.test.ts --runInBand` -> `0` (48 tests)
- targeted new tests (by name): `acknowledges when the turn clears mid-poll without a replacement turn` -> `0`; `a vanished turn acknowledgement does not contaminate a later turn lifecycle` -> `0`; `declares the audited half retry timeout for codex` -> `0`.

## Runtime/IPC Validation
- Deterministic model tests run the real `InterruptController`, the real `promptCommand` IPC parameter generation, and the real watcher accounting under fake timers; a live PTY/foreground TUI was not available in this environment, so byte-level behavior is proven through exact physical write-count assertions.
- behavior verification notes:
  - interrupt write counts: exactly one `\x1b` per logical interrupt; no writes after acknowledgement, timeout, turn replacement, duplicate request, or cleanup (asserted in `test/interrupt.test.ts`, including `jest.getTimerCount() === 0` on ack and timeout paths).
  - turn safety: a stale/replaced turn returns `failed/turn_changed` (`requested: true`) and never calls `onAcknowledged` on the replacement's bookkeeping; a vanished turn acks once; a later turn starts an independent lifecycle (new regressions + pre-existing dedup/turn-binding tests).
  - effective prompt Enter delay audited: `1000 ms` default (was `2000`); `--fast-enter` -> `0 ms` (asserted in `test/prompt.test.ts`).
  - stuck-input recovery audited: `2500 ms` (was `5000`), bounded at `maxRetries: 3`, retries only the submit byte, never retypes the original prompt text (asserted in `test/input-submit-watcher.test.ts`).

## Duplicate/Performance Review
- duplicate code findings: none introduced; the poll-loop change reuses the existing `onAcknowledged` contract.
- hot-path/performance findings: poll cadence unchanged (50 ms interval / bounded 2000 ms window); the vanish-ack add no extra polling or allocation.
- proposed refactors: none.

## Acceptance Criteria Mapping
- Report identifies the exact interrupt path and gives concrete evidence for the intermittent failure -> `pass`; evidence: `src/runtime/interrupt.ts` poll loop, `src/commands/run.ts:140-285` (IPC handler, `isWorking`, `onAcknowledged`, `observeDeliveryState` completion clearing `activeTurnGeneration`), and new deterministic regressions in `test/interrupt.test.ts` that reproduce the turn-clear-mid-poll misclassification.
- Interrupt behavior is bounded and turn-safe (one active turn per request; stale/replaced turns cannot ack or mutate later-turn bookkeeping; duplicate/concurrent same-turn calls deterministic; later turn independent) -> `pass`; evidence: `src/runtime/interrupt.ts` in-flight dedup + new poll distinction; tests in `test/interrupt.test.ts` ("returns the same in-flight result", "does not let turn A cleanup clear turn B in-flight state", "a vanished turn acknowledgement does not contaminate a later turn lifecycle").
- Multiple ESC writes: not implemented; report explains why one ESC is correct and what defect was fixed -> `pass`; evidence: one `\x1b` kept as `DEFAULT_INTERRUPT_SEQUENCE`; opencode/codex accept a single ESC; failure was ack classification, proven by write-count assertions (`writes` arrays) in `test/interrupt.test.ts`. Physical counts: 1 write per logical interrupt, none after ack/timeout/replacement/duplicate.
- No interrupt path kills/recreates session, controller, or PTY -> `pass`; evidence: only `write(value)` in `src/runtime/interrupt.ts`; no spawn/signal/PTY/session code touched (`git diff` limited to interrupt.ts/prompt.ts/harness.ts + tests).
- Normal prompt submission uses audited reduced delay; tests cover effective delay and explicit override -> `pass`; evidence: `src/commands/prompt.ts` 2000 -> 1000; `test/prompt.test.ts` asserts `"submitDelayMs":1000` default and `fastEnter` -> `0`.
- Stuck-input recovery uses audited half timeout, retries only Enter/submit, bounded, never types prompt twice -> `pass`; evidence: `src/utils/harness.ts` 5000 -> 2500; `test/input-submit-watcher.test.ts` covers retry, acknowledgement, exhaustion, disposal and asserts the 2500 default.
- Existing capacity continuation behavior unchanged unless justified -> `pass`; evidence: `src/runtime/capacity-watcher.ts` untouched and `test/capacity-watcher.test.ts` still passes; decision: the "stuck-input retry timeout" named in the task refers to `InputSubmitWatcher.retryDelayMs`, not capacity backoff; no silent change to capacity continuation.
- Focused tests pass for interrupt, input submit watcher, run/controller IPC, and changed harness configuration -> `pass`; evidence: focused suite `test/interrupt.test.ts`, `test/prompt.test.ts`, `test/input-submit-watcher.test.ts` -> `0`; full `npm test -- --runInBand` -> `0` (includes controller-e2e/run IPC tests).
- `npm run build`, `npm run lint`, `npm run format:check`, `npm test -- --runInBand` pass -> `pass`; evidence: exit codes `0` for each (see Validation Commands).
- Worker bumps patch version only after task accepted, then commits/pushes -> `pass`; evidence: no version bump or commit performed during execution (deferred to the master verification loop per `tasks/RULES.md`; `npm run build` did not bump the version).
- Final report copied from stub, drafted first, renamed to exact final path, contains command exit codes + evidence for every criterion -> `pass`; evidence: `cp tasks/report_stub.md tasks/todo/task_075_fix_interrupt_reliability_and_prompt_timing_report_draft.md` then renamed to `tasks/todo/task_075_fix_interrupt_reliability_and_prompt_timing_report.md`; Validation Commands section lists exit codes; this mapping section covers all criteria.

## Risks and Follow-ups
- Acknowledgement fidelity still derives from the working-hint viewport substring (`uiWorkingHint`). A genuinely slow post-interrupt repaint can still reach `timed_out` inside the bounded 2000 ms window, and an interrupt issued in the brief window right after a turn binds (hint not yet rendered) returns `already_idle`. Both are pre-existing, hint-based limitations; this change removes the artificial `failed/turn_changed` on vanished turns and does not attempt broader viewport-agnostic state inference.
- Live-PTY verification was not possible in this environment; conclusions rest on the deterministic controller model and exact write-count tests.

## Roadmap Recommendations
- Replace working-hint substring matching with the delivery-tracker state (e.g. `submitted_working`) for ack classification to remove viewport-timing dependence.
- Consider exposing `submitDelayMs` as a configurable profile/caller knob so teams can tune the audited 1000 ms default per harness.

## Completion Notification
- After final report rename, notify manager:
  - `airelay prompt gpt_master_airelay "task_075_done"` -> exit `1` ("Controller offline for session: gpt_master_airelay") in this environment because the session is registered in `~/.airelay/sessions.json` but its controller socket was not running at notification time. The task deliverable (report + validated changes) is complete; the ping must be re-sent once the master session is active.