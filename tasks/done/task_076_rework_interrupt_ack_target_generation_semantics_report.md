# Task Report

## Task ID
`task_076_rework_interrupt_ack_target_generation_semantics`

## Summary
- Corrected the task-075 interrupt acknowledgement semantics: task-075 inferred success from `getActiveTurnId() === undefined` after the ESC write and returned `interrupt_acknowledged` when the target generation vanished. That violated the AIR-2 invariant (a request is bound to one immutable captured generation; a vanished/replaced generation must never be acknowledged or mutate later-turn bookkeeping).
- `src/runtime/interrupt.ts`: reverted the 075 poll change. `perform()` now returns a bounded `failed` with `reason: "turn_changed"` whenever the captured generation is no longer the active generation, and `interrupt_acknowledged` only for a positive confirmation: the captured generation is still the active target AND `isWorking(turnId)` is false. Added `isPending(turnId)` so the run lifecycle can preserve the captured generation until the in-flight request resolves.
- `src/commands/run.ts`: solved the completion-race defect by preserving target-generation bookkeeping instead of inferring success from it disappearing. The natural-completion path now defers clearing `activeTurnGeneration`/`currentDeliveryId` while an interrupt is pending for that exact generation, re-checking via a bounded short timer. The interrupt itself is bounded by `ackTimeoutMs`, so deferral cannot spin forever.
- Preserved the accepted task-075 timing changes: prompt text-to-Enter `1000 ms` default with `--fast-enter` -> `0 ms`, and stuck-input retry `2500 ms` with bounded submit-only retry.
- Kept exactly one physical ESC per logical interrupt (no repeats, no retries, no kill/signals/PTY/session recreation). Same-session/controller/PTY reuse and same-turn in-flight deduplication unchanged.

## Files Changed
- `src/runtime/interrupt.ts` — ack only when captured generation is still active AND positively not working; vanished/replaced generation -> `failed`/`turn_changed`; new `isPending(turnId)` accessor for the run-lifecycle deferral.
- `src/commands/run.ts` — natural completion defers while `interruptController?.isPending(activeTurnGeneration)` is true, then re-checks on a bounded short timer before marking completion.
- `test/interrupt.test.ts` — replaced the two task-075 ack-on-vanish tests with the corrected semantics (vanished target -> `turn_changed`, no `onAcknowledged` call); added `isPending` lifecycle regression; kept normal-ack, A->B replacement, same-turn dedup, timeout cleanup, later-turn reuse tests.
- Task-075 items preserved (unchanged from 075): `src/commands/prompt.ts` (`TEXT_TO_SUBMIT_DELAY_MS` 2000 -> 1000), `src/utils/harness.ts` (codex `inputSubmitRetry.retryDelayMs` 5000 -> 2500), `test/prompt.test.ts`, `test/input-submit-watcher.test.ts`.

## Validation Commands
- `npm run -s build` -> `0`
- `npm run -s lint` -> `0`
- `npm run -s format:check` -> `0`
- `npm test -- --runInBand` -> `0` (35 suites, 376 tests)
- focused regressions: `npx jest test/interrupt.test.ts test/prompt.test.ts test/input-submit-watcher.test.ts test/capacity-watcher.test.ts --runInBand` -> `0` (58 tests)
- targeted new tests (by name): `returns turn_changed when the target generation clears mid-poll without a replacement` -> `0`; `a stale vanished-turn failure does not contaminate a later turn lifecycle` -> `0`; `reports the in-flight target via isPending until the request resolves` -> `0`.

## Runtime/IPC Validation
- Deterministic controller-level model tests (fake timers) exercise the real `InterruptController` and the `isPending` contract the run lifecycle uses. A live PTY foreground TUI was not available in this environment; byte-level behavior is proven via exact physical write-count assertions.
- behavior verification notes:
  - captured generation is read once in `request()` before the PTY write; every ack/cleanup decision inside `perform()` is guarded by `getActiveTurnId() === turnId` and `isWorking(turnId)`.
  - normal active interrupt: same generation + not-working -> `interrupt_acknowledged`, exactly one `\x1b`, `jest.getTimerCount() === 0`, later prompt works (existing + new tests).
  - vanished target (no replacement): `failed`/`turn_changed`, `requested: true`, exactly one ESC, `onAcknowledged` NOT called, no timer leak (new test).
  - A->B replacement: stale A -> `turn_changed`; B never receives A's ESC/cleanup; a later interrupt targets B independently (existing + new tests).
  - same-turn dedup: one in-flight promise, one ESC (existing test). timeout: reports `timed_out`, no false ack, no timer leak, does not mutate later turns (existing tests).
  - run-lifecycle deferral: while an interrupt is pending for the captured generation, natural completion does not clear the generation (checked via `interruptController.isPending`); on ack the same-generation bookkeeping marks `interrupted`; on timeout/completion afterwards normal response flow resumes.

## Duplicate/Performance Review
- duplicate code findings: none introduced; `isPending` reuses the existing `inFlight` record.
- hot-path/performance findings: poll cadence and 2000 ms ack bound unchanged; the completion deferral adds at most a short bounded re-check (interrupt is itself bounded by `ackTimeoutMs`).
- proposed refactors: none.

## Acceptance Criteria Mapping
- `session.interrupt` captures one immutable target generation before the PTY write and all acknowledgement/cleanup is guarded by that generation -> `pass`; evidence: `src/runtime/interrupt.ts` `request()` captures `turnId` once, `perform()` re-checks `getActiveTurnId() === turnId` before the write and in every poll iteration; `test/interrupt.test.ts` ("reports the in-flight target via isPending...", "returns turn_changed when the target generation clears mid-poll...").
- Normal active interrupt returns `interrupt_acknowledged`, exactly one ESC, same session/controller/PTY, later prompt allowed -> `pass`; evidence: `test/interrupt.test.ts` "acknowledges only after the working state clears and remains reusable", "can interrupt a later turn on the same controller after acknowledgement"; write counts `[\x1b]` per logical interrupt.
- Target generation becomes `undefined` before acknowledgement -> bounded failure with machine-readable `reason: "turn_changed"`, no ack, no later-turn bookkeeping -> `pass`; evidence: `src/runtime/interrupt.ts` poll returns `failed`/`turn_changed` on any `getActiveTurnId() !== turnId`; `test/interrupt.test.ts` "returns turn_changed when the target generation clears mid-poll without a replacement" (asserts `onAcknowledged` not called).
- A->B replacement before acknowledgement: stale A bounded `turn_changed`, B receives no stale cleanup/ESC, later interrupt targets B independently -> `pass`; evidence: `src/runtime/interrupt.ts` poll (A returns `turn_changed`; in-flight record keyed per turn keeps B's promise); `test/interrupt.test.ts` "rejects a stale turn A interrupt when turn B replaces it before polling", "does not let turn A cleanup clear turn B in-flight state", "a stale vanished-turn failure does not contaminate a later turn lifecycle".
- Natural completion before a new interrupt remains `no_active_turn`/`already_idle`; no stale interrupt synthesized -> `pass`; evidence: `src/runtime/interrupt.ts` pre-write guards; `test/interrupt.test.ts` "distinguishes no active and already idle turns"; run.ts completion path is unchanged when no interrupt is pending.
- Repeated/concurrent same-turn requests share one in-flight result and one physical ESC; timeout/listener/timer cleanup cannot mutate a later turn -> `pass`; evidence: `src/runtime/interrupt.ts` `request()` dedup + `finally` record-guard; `test/interrupt.test.ts` "returns the same in-flight result for a repeated interrupt request", "returns timed_out without falsely acknowledging" (timer count 0), "does not let turn A cleanup clear turn B in-flight state".
- Task 075 timing behavior remains covered: effective prompt delay `1000 ms`, explicit fast override `0 ms`, stuck-input retry `2500 ms`, bounded submit-only retry -> `pass`; evidence: `src/commands/prompt.ts`, `src/utils/harness.ts`; `test/prompt.test.ts` ("uses the reduced submit delay", "fastEnter overrides..."), `test/input-submit-watcher.test.ts` ("declares the audited half retry timeout for codex").
- Focused tests and full validation pass (`build`, `lint`, `format:check`, `npm test -- --runInBand`) -> `pass`; evidence: exit codes `0` for all in Validation Commands.
- Report copied from `tasks/report_stub.md`, drafted first, renamed to the exact final path, maps every criterion to evidence and command exit codes -> `pass`; evidence: `cp tasks/report_stub.md tasks/todo/task_076_rework_interrupt_ack_target_generation_semantics_report_draft.md` then renamed to `tasks/todo/task_076_rework_interrupt_ack_target_generation_semantics_report.md`.

## Risks and Follow-ups
- Acknowledgement fidelity still derives from the working-hint viewport substring (`uiWorkingHint`). A genuinely slow post-interrupt repaint can still reach the bounded `timed_out` outcome, and an interrupt issued in the brief window right after a turn binds (hint not yet rendered) returns `already_idle`; both are pre-existing hint-based limitations, now with correct, non-acknowledging semantics.
- The run-lifecycle deferral is bounded by `ackTimeoutMs` (interrupt resolution), so natural completion cannot be delayed indefinitely; verified by the full suite including delivery/controller tests.
- Live-PTY verification was not possible in this environment; conclusions rest on the deterministic controller model, `isPending` lifecycle contract, and exact write-count assertions.

## Roadmap Recommendations
- Replace working-hint substring matching with delivery-tracker state (e.g. `submitted_working`) for ack classification to remove viewport-timing dependence.
- Consider exposing `submitDelayMs` as a configurable profile/caller knob so teams can tune the audited 1000 ms default per harness.

## Completion Notification
- After final report rename, notify manager:
  - `airelay prompt gpt_master_airelay "task_076_done"` -> exit `1` ("Controller offline for session: gpt_master_airelay") in this environment because the session is registered in `~/.airelay/sessions.json` but its controller socket was not running at notification time. The task deliverable (report + validated changes) is complete; the ping must be re-sent once the master session is active.