# Workspace Preparation: Linux Host

This is a staged migration, not a completed global cutover.

## Verified Preparation

- Installed Devin: `3000.11.205 (6dea39440ae3)`.
- Default role-only workspaces prepared under `~/agent-workspaces/rsg/lead`
  and `~/agent-workspaces/bb_splunk/{lead,worker,advisor,research,watcher,dev}`.
- Optional BB Workers: `bb_splunk/instances/worker-01` and `worker-02`.
  Both link the same canonical Worker instructions and Skill. Their private
  regular MCP files preserve different original Authorization credentials.
- New normal Airelay profiles reference those workspaces. Existing profiles
  were compared against their backup and remain unchanged.
- Native Codex authentication and Devin/OpenCode user settings hashes were
  checked unchanged after provisioning. No existing runtime was stopped or
  restarted, and no source checkout was modified.
- Real installed-CLI discovery of all five requested role/instance directories
  passed with a disposable HOME. This proves local resolution; it is not a
  production authentication/startup claim.

The RSG bootstrap plan was absent from the local checkout. The exact approved
GitHub version at `6987867309963497c9cb1bfa81ee55156a91fe4a` was materialized
as the RSG Lead Skill's `references/bootstrap.md`. Its top-level Owner
simplification supersedes historical XDG/per-instance advice. RSG ADRs remain
referenced from the original source checkout.

The BB checkout's `AGENTS.md` and onboarding refer to a missing `SUBAGENTS.md`.
Workspace preparation does not repair or invent that source policy. Affected
research execution must resolve the missing authority before claiming readiness.

## Global Inventory and Deferred Cleanup

The real Devin user configuration still registers:

```text
bb-mcp-lead
bb-mcp-worker
bb-mcp-worker2
bb-mcp-research
bb-mcp-watcher
bb-mcp-advisor
bb-mcp-dev
gpt-tunnel
```

The seven BB templates were staged in project-local files, preserving their
individual configuration. No aliases have been removed. Active BB/other Devin
controllers still use the global directory; an old controller could wake there
without the replacement configuration after global deletion. Those sessions
must reach a safe cutover before aliases are removed.

One custom global Skill was also discovered:
`default:pwa-tablet-testing`, supplied by an account-uploaded plugin. Its files
are backed up. Its canonical Project/Role destination is awaiting the Owner's
answer; no plugin registration/cache was deleted. Native product built-ins and
Codex system/curated resources were retained. Native Codex and OpenCode default
configuration contained no MCP registrations.

With the real HOME, RSG Lead preflight discovers **8 MCP servers instead of
0** and correctly refuses launch. No production RSG Lead was started and no
production zero-MCP/start-resume acceptance is claimed. Backend Principal
permission checks were not invoked as part of this preparation.

## Private Backup and Rollback

Backup directory:
`~/agent-workspace-backups/2026-10-23T17-58-44-400Z/` (mode 0700).

`manifest.json` records original paths, file modes, ownership and hashes.
`host-audit.json` records nonsecret preparation evidence. Native configuration
backups can contain credentials; the entire directory remains private and is
not committed. `migration-inputs/` holds protected role/template inputs.

No global MCP/Skill cleanup was applied, so provider settings do not need
restoration. To undo the new profiles, compare the current Airelay configuration
with the recorded original and remove only the newly registered `workspace-*`
profiles after checking that no new managed sessions use them. Preserve later
unrelated edits and workspace contents. Use the selective restore helper only
for reviewed files actually changed by a future cutover. Backups are retained.

## Remaining Owner Decisions

1. Select a quiescent cutover point for the active old controllers. Preserve
   their native session IDs, then relaunch through the prepared workspace
   profiles; do not interrupt active jobs merely to clean configuration.
2. Assign the custom PWA Skill to a canonical Project/Role, or retire it, and
   decide the approved project destination for `gpt-tunnel`.
3. Remove only migrated user-level registrations/Skill exposure, keeping
   credentials and daemon services intact. Re-run native verification using
   the real HOME, then validate new RSG/BB sessions and restart/resume.
4. Verify backend Principal identities/permissions and resolve missing BB
   source policy before claiming BB operational readiness.

| Required Status | Preparation Result |
| --- | --- |
| WORKSPACE_PROVISIONER_READY | Implementation and verification described in WORKSPACES.md |
| GLOBAL_MCP_CLEAN | PARTIAL: 8 aliases remain pending safe cutover |
| GLOBAL_CUSTOM_SKILLS_CLEAN | PARTIAL: account PWA Skill remains |
| RSG_LEAD_ZERO_MCP_VERIFIED | BLOCKED: real HOME inventory is 8, not 0 |
| BB_SPLUNK_IDENTITY_ISOLATION_VERIFIED | PARTIAL: distinct local credentials; backend authorization not verified |
| START_RESUME_VERIFIED | PARTIAL: runtime fixtures/native discovery; production cutover pending |
| EXISTING_SESSIONS_PRESERVED | No existing user process stopped/restarted |
| ROLLBACK_READY | Private backup and selective restore helper prepared |
