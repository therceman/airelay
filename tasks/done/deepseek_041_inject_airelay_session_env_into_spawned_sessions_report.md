# Task Report

## Task ID
`deepseek_041_inject_airelay_session_env_into_spawned_sessions`

## Summary
Added automatic injection of `AIRELAY_SESSION_KEY`, `AIRELAY_PROFILE`, `AIRELAY_SESSION_ID`, and `AIRELAY_CWD` env vars into spawned child processes via `runCommand`. The injection happens after `buildProfileEnv` resolves profile env but before `spawnOpts` is constructed, ensuring vars are present in both stdio and PTY spawn paths.

## Files Changed
Modified:
- `src/commands/run.ts` — after `addSession` call, sets `env.AIRELAY_SESSION_KEY`, `env.AIRELAY_PROFILE`, `env.AIRELAY_SESSION_ID`, `env.AIRELAY_CWD` on the env object passed to spawn
- `test/run.test.ts` — 4 new tests verifying injected vars in spawned child process

## Validation Commands
- `npm run -s build` -> `0`
- `npm run -s lint` -> `0`
- `npm test -- run env` -> `0` (35/35 passed)
- `npm test` -> `0` (246/246 passed)

## Runtime/IPC Validation
- Env vars injected into child `env` object before `spawnOpts` creation — both cross-spawn stdio and PTY paths receive them
- Vars set unconditionally (no profile env check — these are internal orchestration vars not expected to be user-configured)

## Duplicate/Performance Review
- No duplicated code; single injection point in `runCommand`
- No performance impact on existing paths

## Acceptance Criteria Mapping
- `Spawned process receives AIRELAY_SESSION_KEY, AIRELAY_PROFILE, AIRELAY_CWD` — **pass**; evidence: `src/commands/run.ts` sets `env.AIRELAY_SESSION_KEY = sessionKey`, `env.AIRELAY_PROFILE = profileName`, `env.AIRELAY_CWD = cwd`; tests "injects AIRELAY_SESSION_KEY", "injects AIRELAY_PROFILE", "injects AIRELAY_CWD as absolute path" pass
- `AIRELAY_SESSION_ID present with deterministic value` — **pass**; evidence: `env.AIRELAY_SESSION_ID = sessionKey` (same as key at launch time); tested in combined "injects AIRELAY_SESSION_KEY" test
- `Existing functionality unchanged` — **pass**; evidence: 246/246 tests pass, no existing test modified
- `Build/lint/tests pass` — **pass**; evidence: build 0, lint 0, full suite 246/246

## Risks and Follow-ups
- Env vars are set unconditionally; if a profile config explicitly sets `AIRELAY_SESSION_KEY` in its `env` block, the injection will override it. This is intentional — these vars identify the current session for self-identification in notifications.
- `AIRELAY_SESSION_ID` equals the session key at launch time since the true session ID is the key itself in the current model. If a future model separates `id` from `key`, this should be updated.
