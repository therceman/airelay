# Task 075: Fix interrupt reliability and prompt timing

## ID
`task_075_fix_interrupt_reliability_and_prompt_timing`

## Agent
`DeepSeek`

## Execution Order
`1`

## File Ownership
- `src/runtime/interrupt.ts`
- `src/runtime/input-submit-watcher.ts`
- `src/runtime/capacity-watcher.ts`
- `src/commands/run.ts`
- `src/utils/harness.ts`
- `test/` files covering the changed behavior
- `tasks/todo/task_075_fix_interrupt_reliability_and_prompt_timing_report_draft.md`
- `tasks/todo/task_075_fix_interrupt_reliability_and_prompt_timing_report.md`

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Fix unreliable PTY interrupt and reduce prompt retry timing

## Scope
- First audit the current interrupt lifecycle from `session.interrupt` IPC through `InterruptController` and PTY write, including turn identity, in-flight request sharing, acknowledgement polling, timeout and cleanup.
- Reproduce or deterministically model why an active interrupt can fail to stop the current Agent turn. Use the existing controller/harness abstractions and tests; do not add a second interrupt engine.
- Determine whether the failure is caused by the control sequence, timing, acknowledgement classification, stale state, or PTY delivery. Do not assume that sending several ESC bytes is correct.
- If evidence shows that a repeated ESC sequence is required, implement the smallest bounded and configurable behavior. It must have a strict maximum, no unbounded retry loop, no repeat after positive acknowledgement, no repeat after timeout, and no repeat for a replaced turn. If evidence does not justify repeats, keep one ESC and fix the actual lifecycle defect.
- Preserve immutable turn-generation binding, same-turn in-flight Promise sharing, `turn_changed` handling, bounded acknowledgement timeout, and session/controller/PTY reuse. Never kill, signal, recreate or restart the session as an interrupt implementation.
- Audit every prompt submission path. Reduce the effective text-to-Enter delay by 2x where a non-zero default currently exists, without overriding an explicit caller option unexpectedly. Confirm the effective value in tests and report it. The ordinary prompt path currently appears to use `0 ms`; do not invent an artificial delay if the audit proves there is no delay to reduce.
- Reduce the existing stuck-input retry timeout by 2x. The current `InputSubmitWatcher` default appears to be `5000 ms`; the intended default should therefore be `2500 ms` unless source audit identifies a more authoritative retry timeout. Retry only the submit sequence, never the original prompt text.
- Keep capacity continuation timing separate unless the audit proves the requested retry timeout refers to that watcher. Do not change unrelated capacity backoff behavior silently; document any decision.
- Add compact structured tests and preserve existing delivery semantics: controller acceptance, submit acknowledgement, Agent working state, capacity failure, and terminal completion remain distinct.

## Non-goals
- No Gateway, GPT Tunnel, Hub, or external repository changes.
- No new interrupt API or parallel delivery/watcher state machine.
- No arbitrary shell execution, process termination, SIGTERM, SIGKILL, PTY recreation, or session recreation.
- No broad human-readable output parsing when a controller/harness state is available.
- No unrelated refactors, dependency changes, release/tag/publication, or merge of `master`.

## Acceptance criteria
- [ ] The report identifies the exact current interrupt path and gives concrete evidence for the intermittent failure or states that it cannot be reproduced.
- [ ] Interrupt behavior is bounded and turn-safe: a request targets exactly one active turn; stale/replaced turns cannot be acknowledged or mutate later-turn bookkeeping; duplicate/concurrent same-turn calls have deterministic results; a later turn has an independent lifecycle.
- [ ] If multiple ESC writes are implemented, tests prove the exact maximum physical writes per logical interrupt and prove no writes occur after acknowledgement, timeout, turn replacement, cleanup, or duplicate request. If not implemented, the report explains why one ESC is correct and what defect was fixed instead.
- [ ] No interrupt path can kill or recreate the underlying session, controller, or PTY.
- [ ] Normal prompt submission uses the audited reduced delay. Tests cover the effective delay and explicit override behavior where applicable.
- [ ] Stuck-input recovery uses the audited half timeout, retries only Enter/submit, remains bounded, and never types the prompt twice. Tests cover recovery, acknowledgement, exhaustion, and disposal.
- [ ] Existing capacity continuation behavior remains unchanged unless explicitly justified by the audit and covered by regression tests.
- [ ] Focused tests pass for interrupt, input submit watcher, run/controller IPC, and any changed harness configuration.
- [ ] `npm run build`, `npm run lint`, `npm run format:check`, and `npm test -- --runInBand` pass.
- [ ] The worker bumps the patch version only after the task is accepted, then commits and pushes the accepted change as required by `tasks/RULES.md`.
- [ ] The final report is copied from `tasks/report_stub.md`, completed as a draft first, renamed to the exact final report path, and contains command exit codes plus evidence for every criterion.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm run -s format:check`
- `npm test -- --runInBand`
- task-specific deterministic tests for interrupt write count/turn races and prompt retry timing

## Reporting Contract (Mandatory)
- Start by copying the base stub to a draft file:
  - `cp tasks/report_stub.md tasks/todo/task_075_fix_interrupt_reliability_and_prompt_timing_report_draft.md`
- Fill that draft file only; do not author reports from scratch.
- When the report is complete and validated, rename it to the final path:
  - `mv tasks/todo/task_075_fix_interrupt_reliability_and_prompt_timing_report_draft.md tasks/todo/task_075_fix_interrupt_reliability_and_prompt_timing_report.md`
- The final report file name MUST be exactly `tasks/todo/task_075_fix_interrupt_reliability_and_prompt_timing_report.md` while awaiting master validation.
- `tasks/report_stub.md` is the single source of truth for required report sections and order.
- Every validation command in this task MUST be listed in the report under `## Validation Commands` with exit code.
- Every acceptance criterion MUST be mapped in the report with explicit status (`pass`/`fail`) and supporting evidence (file paths, test names, command output snippets).
- After the final report is renamed, send completion ping to manager:
  - `airelay prompt gpt_master_airelay "task_075_done"`
- If any required report section is missing, renamed, or empty, the task is incomplete.
- Do not mark the task complete without the report.

## Deliverables
- narrowly scoped code changes, only if the audit identifies a concrete fix
- focused regression tests
- report at `tasks/todo/task_075_fix_interrupt_reliability_and_prompt_timing_report.md`
