# airelay — Universal 20-Gate Agent Completion Contract

**Status:** adopted  
**Schema version:** 1  
**Scope:** every implementation, review, bug-fix, migration and documentation change in this repository

## Authority and lifecycle

This document is the sole canonical gate-policy authority for airelay. The
project may add stricter domain, runtime or release checks, but a project
profile MUST NOT weaken, bypass, rename to conflicting semantics, or silently
PASS a universal gate.

Exactly twenty Universal Agent Task Completion and Review Gates apply. Every
applicable gate is fail-closed. PASS requires concrete evidence tied to the
final artifact and affected cone. N/A requires a concrete rationale tied to
the final diff and scope. A build, green test suite, checkpoint, commit or
self-report proves only the risks it actually covers and cannot override a
failed gate.

Before coding, evaluate at minimum Gates 1, 2, 3, 4, 10 and 20 where
applicable. After implementation, evaluate all Gates 1–20 against the actual
final artifact. Any material change after evidence is collected invalidates
affected evidence and requires re-evaluation.

## The twenty gates

### GATE 1 — Requirements & Goal Completeness

Translate every explicit requirement and approved clarification into concrete
verifiable goals before coding. Re-read the authoritative request after
implementation. FAIL when only a helper or partial lifecycle is proven,
required error/default/recovery paths are missing, a later clarification is
absent, or completion has no specific verification path. Evidence maps
requirement → implementation → proof.

### GATE 2 — Assumptions, Ambiguity & Approval Boundaries

Surface material assumptions and ambiguity before choosing semantics. Present
multiple reasonable interpretations when they exist. If product or
architecture ownership is unclear, request the required decision. Preserve
existing behavior when an unrequested semantic change is not authorized. FAIL
if the agent guessed, hid uncertainty, or disclosed the assumption only after
implementation.

### GATE 3 — Existing Behavior & Contract Preservation

Behavior outside approved scope MUST remain unchanged unless the difference is
a necessary, demonstrated consequence of the task. Inspect the authoritative
baseline for every affected semantic path. A new test that merely rewrites an
expected value is not authorization for a behavior change. Preserve
unaffected API, CLI, data, event, error and default semantics.

### GATE 4 — Scope Discipline / Surgical Change

Every changed line and file MUST trace to a requirement, necessary test,
generated consequence, authoritative contract/documentation update or
unavoidable dependency consequence. FAIL for adjacent cleanup, opportunistic
refactoring, unrelated formatting, dependency refresh, broad generated churn,
unrelated dead-code removal or mutation of unrelated user work. Remove only
orphans created by the task unless separate cleanup is requested. Review the
actual final diff.

### GATE 5 — Minimal Correct Design / No Overengineering

Implement the smallest design that fully satisfies the current requirements
and established boundaries. FAIL for speculative frameworks, one-use
abstractions without ownership value, unrequested flexibility, unnecessary
managers/strategies/adapters, defensive handling of impossible states, or
material indirection without a correctness or ownership benefit. Review whether
a materially simpler solution satisfies the same contract.

### GATE 6 — Architecture, Ownership & Responsibility Boundaries

Responsibilities MUST remain with the correct cohesive owners. Controllers,
handlers and orchestrators, domain services, persistence/infrastructure,
adapters and transport MUST NOT accumulate unrelated knowledge for
convenience. FAIL for God services, excessive cross-domain knowledge,
duplicated ownership, hidden orchestration in infrastructure or architecture
drift. Composition roots may wire components but must not own their semantics.

### GATE 7 — Duplication & Existing Capability Reuse

Before adding material logic, inspect the affected cone for an existing owner
or capability. Reuse suitable services, validators, helpers, policies,
repositories, query adapters, serializers, mappers and test utilities. FAIL for
duplicate business rules, a second authority mechanism or equivalent
implementations without justification. Small local repetition is preferable to
an artificial abstraction.

### GATE 8 — No Unrequested Fallback / Shim / Legacy Path

Do not add fallbacks, compatibility shims, aliases, dual read/write sources,
old/new routing, heuristic legacy interpretation, weaker-authority recovery or
executable obsolete paths unless explicitly required and owner-approved.
Required compatibility becomes a bounded, first-class, tested contract.
Existing required compatibility must not be removed merely because a new path
is cleaner. Hidden compatibility used to make migration or tests pass is FAIL.

### GATE 9 — Deterministic Semantics & Stable Contracts

Every public or cross-boundary operation MUST have one deterministic meaning
and stable contract. Make precedence, ordering, cardinality, defaults,
selection, concurrency ownership and error classification explicit when
material. Inputs may select parameters or filters but must not silently change
the fundamental operation. FAIL for ambiguous ordering, unstable schemas or
caller guesswork.

### GATE 10 — Authority, ADR, Rules & Obsolescence

Before coding and during review, resolve current authoritative ADRs, rules,
lifecycle decisions, cutovers, existing implementations and superseding work.
Do not repair, optimize, expand tests for or preserve a surface already
replaced or retiring unless bounded migration safety or owner approval requires
it. FAIL for stale task acceptance, rule drift, obsolete implementation,
duplicate authority or strengthening code scheduled for removal.

### GATE 11 — Failure Safety, Atomicity, Idempotency & Security

Review every changed throw/catch/retry/lock/transaction/mutation/queue
publish/external call and every multi-side-effect boundary. Validate before
invalid durable mutation; keep indivisible state atomic; release resources on
every exit; bound retries and make them idempotent where required; define
timeout and crash outcomes; never report success after incomplete required
side effects; initialize required outputs on all paths; keep secrets and
sensitive data out of errors and logs. Reason explicitly about failure between
adjacent side effects.

### GATE 12 — Boundedness / Resource & Output Discipline

All loops, retries, recursion, scans, queries, pagination, queue drains,
subprocesses, concurrency, retained history, logs, result sets, memory growth
and model-visible output MUST be safely bounded, streamed or paginated as
appropriate. FAIL for unbounded retry/history/scan behavior, silent
truncation, fetch-all where bounded selection exists, or diagnostic/token spam
unrelated to the decision or proof.

### GATE 13 — Dependency, External-System & Blast-Radius Necessity

Every added or widened package, module, service, runtime, build dependency,
subprocess or network dependency MUST be materially necessary. Review the
reverse-dependency, build, test and operational cone. FAIL when a heavier or
new dependency replaces sufficient local capability, adds avoidable open-world
coupling or materially enlarges the affected cone without requirement value.

### GATE 14 — Performance, Latency & Redundant Work

The change MUST NOT introduce or leave a material performance regression or
unnecessary repeated work. Inspect algorithmic complexity, full scans,
repeated config/repository reads, parsing/serialization/copying, duplicate
external calls, synchronous I/O/subprocess work, lock contention and memory
growth. Performance-sensitive paths require representative before/after
evidence where feasible. A hard project SLO failure is FAIL, never merely a
warning.

### GATE 15 — Persistence / Infrastructure Boundary

Persistence and infrastructure mechanics MUST remain behind explicit typed
domain or use-case-oriented boundaries. Application/domain/service/controller
code MUST NOT know physical storage names, driver mechanics, connection/pool
details, transaction mechanics, database-specific locking/retry behavior,
filesystem layout or persistence serialization unless an approved exception
exists. Fast service tests should use fakes; real persistence tests prove
atomicity, rollback, concurrency, reopen and storage behavior where relevant.

### GATE 16 — Verification Sufficiency & Test Quality

Verification MUST prove changed semantics rather than merely execute code.
Features map acceptance criteria to focused automated or runtime evidence.
Cover relevant positive, negative, boundary, precedence, error, concurrency and
integration behavior. Existing relevant tests remain green. Mocks do not
replace real boundary tests when the boundary is the risk. Never weaken
assertions, add unjustified ignores/baselines/skips or suppress failures to
obtain green.

### GATE 17 — Recovery Proportionality / Sunk-Cost Containment

Repair of stale, rejected, obsolete, contaminated or ambiguous execution state
MUST NOT cost or risk more than bounded salvage into a clean lane plus cleanup.
This applies to diagnostics too. FAIL for prolonged archaeology of disposable
state, repeated repair of rejected architecture or recovery complexity
justified mainly by prior effort. Compare repair cost/risk with clean
salvage/restart and choose the bounded safer option.

### GATE 18 — Verification / Review Immutability & Artifact Identity

All mutating formatting, generation, dependency updates and autofixes occur
before authoritative verification. Capture the exact candidate artifact and
repository identity, run verification read-only, capture the post-verification
identity and require exact equality. Any tracked, untracked, index, HEAD,
tree, branch or generated-artifact mutation during verification is FAIL even
with exit 0. If semantic bytes change, restart verification. The exact
verified artifact is what gets committed, pushed, integrated or released.

### GATE 19 — Completion Integrity / Final Artifact Honesty

Before declaring completion, inspect the final artifact and required
authoritative companion artifacts. Every changed file must be justified.
Public/interface/schema/documentation/runbook/generated/lock/dependency
artifacts must match the behavior and exact version tested. Known failures,
races, contract mismatches, stale dependencies, missing runtime proof or
unresolved review concerns MUST NOT be hidden or relabeled without evidence
and an explicit decision. Any remaining material issue reports symptom,
impact, scope, evidence, reason not fixed, release/blocking status and required
owner decision.

### GATE 20 — Systemic Scope Completeness / Exhaustive Invariant Audit

This gate is automatically applicable to cross-cutting, subsystem-wide,
project-wide or repo-wide claims, migrations, hard cuts, replacements,
prohibitions, sole-authority claims and exhaustive language such as all,
every, none, zero, never, no fallback or across the normal lifecycle.

A systemic claim requires systemic evidence. Before the implementation strategy
is considered complete, the reviewer/implementer MUST:

1. Define the invariant.
2. Define the exact bounded applicable surface.
3. Enumerate all candidate violations using semantically appropriate independent discovery methods.
4. Classify every candidate.
5. Fix the complete required violation set.
6. Rerun the same exhaustive audit after edits.
7. Demonstrate zero unexplained candidates.
8. Only then proceed to ordinary verification and finalization.

Maintain an audit table with at least `Candidate`, `Classification` and
`Action`. Close every candidate as a violation, explicit justified exception,
false positive with proof or another explicit classification. Unknown or
unexplained candidates are FAIL.

Exhaustive does not mean one grep. Use independent methods appropriate to the
architecture: static symbol/pattern search, public entry-point inventory,
interface/implementation inventory, configuration/registry inspection,
relevant tests and fixtures, dependency/call-path inspection, changed-cone
analysis, alternate wrappers/adapters and authority/storage/network maps.
Review semantics, not only one function name.

After the second finding of the same architectural defect class in one
implementation or review cycle, STOP incremental whack-a-mole correction.
Perform a complete bounded systemic audit for that defect class and produce
one coherent correction set before any further local fix or acceptance attempt.

## Required evidence report

The completion report MUST record each Gate 1–20 as `PASS`, `FAIL` or `N/A`
with concise evidence or rationale. Detailed command output may remain in
project-native evidence artifacts. A project-specific profile may add stricter
commands, thresholds, matrices, runtime checks, SLOs or deployment proof, but
it cannot replace this vocabulary or weaken its semantics.

The final report must also state the exact verification commands, final commit
or artifact identity, and any remaining issue with its impact and owner.

## airelay project profile

The normal verification commands are the repository scripts documented in
`AGENTS.md`: `npm run build`, `npm run lint`, `npm run format:check`, `npm test`
and `npm audit` (or `npm run verify`). Tests use isolated environments and
must never modify the real `~/.airelay` state.
