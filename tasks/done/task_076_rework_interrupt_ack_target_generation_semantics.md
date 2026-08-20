# Task 076: Rework interrupt acknowledgement target-generation semantics

## ID
`task_076_rework_interrupt_ack_target_generation_semantics`

## Agent
`DeepSeek`

## Execution Order
`1`

## File Ownership
- `src/runtime/interrupt.ts`
- `src/commands/run.ts`
- `test/interrupt.test.ts`
- `test/controller-e2e.test.ts` if required
- `tasks/todo/task_076_rework_interrupt_ack_target_generation_semantics_report_draft.md`
- `tasks/todo/task_076_rework_interrupt_ack_target_generation_semantics_report.md`

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Preserve exact active-turn identity during interrupt acknowledgement

## Scope
- This is a follow-up to task 075. Keep the accepted timing changes and the useful interrupt race diagnosis, but correct the acknowledgement semantics before task 075 can be accepted.
- Preserve the prior AIR-2 invariant: an interrupt request is bound to the exact captured active turn generation. If that generation disappears before acknowledgement, return a bounded existing failure with `reason: "turn_changed"` (or the most precise existing outcome), not `interrupt_acknowledged`. A later replacement turn must never be acknowledged or mutated by the stale request.
- Make successful acknowledgement positive: the captured generation must still be identifiable as the same target turn and the controller/harness must positively indicate that the target stopped. Do not infer success solely from `getActiveTurnId() === undefined` after the PTY write.
- Solve the completion-race defect with the smallest existing-lifecycle change. For example, preserve target-generation bookkeeping until the in-flight interrupt resolves, or add a narrow controller-local stopped/completed reason that distinguishes an acknowledged interrupt from natural completion. Do not redesign session execution or add a durable domain object.
- Preserve the task 075 prompt delay reduction (`2000 -> 1000 ms`), `--fast-enter` override, and stuck-input retry reduction (`5000 -> 2500 ms`). Do not send multiple ESC bytes unless source evidence and tests independently require it; the expected interrupt write count remains one ESC per logical interrupt.

## Non-goals
- No Gateway, GPT Tunnel, Hub, or external repository changes.
- No new interrupt API or parallel watcher/state machine.
- No kill, SIGTERM, SIGKILL, PTY recreation, session recreation, or automatic interrupt retry.
- No version bump, commit, push, tag, release, or merge by the worker before master acceptance.
- Do not revert task 075 timing changes merely to avoid the semantic fix.

## Acceptance criteria
- [ ] `session.interrupt` captures one immutable target generation before the PTY write and all acknowledgement/cleanup is guarded by that generation.
- [ ] Normal active interrupt with the same target generation still returns `interrupt_acknowledged`, writes exactly one ESC, preserves the same session/controller/PTY, and allows a later prompt.
- [ ] If target generation becomes `undefined` before acknowledgement, result is bounded failure with machine-readable `reason: "turn_changed"` or an equally precise existing failure; it must not report acknowledgement or call later-turn bookkeeping.
- [ ] If target generation changes from A to B before acknowledgement, stale A returns bounded `turn_changed`; B receives no stale cleanup or ESC. A later interrupt targets B independently.
- [ ] Natural completion before a new interrupt remains `no_active_turn`/`already_idle` as appropriate; no stale interrupt is synthesized.
- [ ] Repeated/concurrent same-turn requests share one in-flight result and one physical ESC; timeout/listener/timer cleanup cannot mutate a later turn.
- [ ] Task 075 timing behavior remains covered: effective prompt delay `1000 ms`, explicit fast override `0 ms`, stuck-input retry `2500 ms`, bounded submit-only retry.
- [ ] Focused tests and full validation pass: `npm run -s build`, `npm run -s lint`, `npm run -s format:check`, `npm test -- --runInBand`.
- [ ] Report is copied from `tasks/report_stub.md`, drafted first, renamed to the exact final report path, and maps every criterion to evidence and command exit codes.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm run -s format:check`
- `npm test -- --runInBand`
- focused interrupt/controller tests covering vanished target, replacement target, timeout cleanup, same-turn deduplication, and later-turn reuse

## Reporting Contract (Mandatory)
- Start by copying the base stub to a draft file:
  - `cp tasks/report_stub.md tasks/todo/task_076_rework_interrupt_ack_target_generation_semantics_report_draft.md`
- Fill that draft file only; do not author reports from scratch.
- When the report is complete and validated, rename it to the final path:
  - `mv tasks/todo/task_076_rework_interrupt_ack_target_generation_semantics_report_draft.md tasks/todo/task_076_rework_interrupt_ack_target_generation_semantics_report.md`
- The final report file name MUST be exactly `tasks/todo/task_076_rework_interrupt_ack_target_generation_semantics_report.md`.
- `tasks/report_stub.md` is the single source of truth for required report sections and order.
- Every validation command in this task MUST be listed in the report under `## Validation Commands` with exit code.
- Every acceptance criterion MUST be mapped with explicit `pass`/`fail` status and evidence.
- After the final report is renamed, send completion ping to manager:
  - `airelay prompt gpt_master_airelay "task_076_done"`
- If any required report section is missing, renamed, or empty, the task is incomplete.

## Deliverables
- narrow production/test correction on top of task 075
- deterministic interrupt lifecycle regressions
- report at `tasks/todo/task_076_rework_interrupt_ack_target_generation_semantics_report.md`
