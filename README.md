# airelay

Cross-platform CLI for launching profile-isolated harness instances with shared-base overlay support.

## Tech Stack

Runtime dependencies:

| Package     | Version | Purpose                         |
| ----------- | ------- | ------------------------------- |
| TypeScript  | 5.9.3   | Type-safe JavaScript superset   |
| zod         | 4.3.6   | Runtime schema validation       |
| yaml        | 2.8.3   | YAML parsing for config files   |
| cross-spawn | 7.0.6   | Cross-platform process spawning |
| node-pty    | 1.0.0   | Pseudo-terminal for promptable sessions |

Dev dependencies:

| Package  | Version | Purpose           |
| -------- | ------- | ----------------- |
| eslint   | 10.2.0  | Code linting      |
| prettier | 3.8.3   | Code formatting   |
| jest     | 30.3.0  | Testing framework |

## Install

## Install

```bash
npm install -g airelay
```

Or from source:

```bash
npm install
npm run build
npm link
```

## Quick Start

```bash
airelay init
```

This creates `~/.airelay/config.yaml` with example profiles.

## Config Location

- Default: `~/.airelay/config.yaml`
- Override: `AIRELAY_CONFIG=/path/to/config.yaml`

## Config Format

```yaml
version: 1

settings:
  promptMaxLength: -1
  hibernateAfter: 5m
  harnessSelfUpdate: false

profiles:
  opencode-work:
    executable: opencode
    cwd: ~/git/work
    description: Work profile
    env:
      OPENCODE_CONFIG_DIR: ~/.config/opencode-work
      XDG_CONFIG_HOME: ~/.airelay/opencode-work/config
      XDG_DATA_HOME: ~/.airelay/opencode-work/data

  codex-personal:
    executable: codex
    cwd: ~/git/personal
    args:
      - --sandbox
      - workspace-write
    description: Personal profile
    env:
      CODEX_HOME: ~/.codex-personal
```

## Commands

```bash
airelay start <profile> [args...]  # Launch profile (PTY-backed, always promptable)
airelay run <profile> [-- ...args] # Run profile with inherited terminal
airelay list                       # List all profiles
airelay which <profile>            # Show resolved runtime details
airelay doctor [profile]           # Run diagnostics
airelay init                       # Create starter config
airelay resume [key]               # Pick a saved launch from this folder or resume by key
airelay sessions [--json] [--active]  # List saved sessions
airelay session-status <session>       # Report canonical State: idle/busy
airelay prompt <session> <text>    # Send input to an active session
airelay config list                # Show config and resolved defaults
airelay config set settings.promptMaxLength 1024
airelay config set settings.hibernateAfter 10m
airelay config set settings.harnessSelfUpdate false
airelay config set profiles.my-profile.cwd ~/git/project
airelay help                       # Show this help message
airelay guide                      # New-machine setup guide
```

When resuming from the interactive project/session picker, `Launch` uses the
recorded profile. `Use another profile (same harness)` keeps the project
directory, session key, session ID and recorded harness arguments, changing
only the selected profile. Profiles for a different harness are not offered.
The main menu also offers `Switch last session profile (same harness)` for the
latest session in the current project; it selects an alternative profile first
and lists the recorded profile last with `(current)`.

## Examples

```bash
airelay init
airelay start opencode-work
airelay start opencode-work -- resume ses_abc123  # Resume with harness-native args
airelay start codex-personal --sandbox workspace-write
airelay prompt myprofile_abcd "write a unit test"
airelay sessions --active
airelay which opencode-work
airelay doctor
```

## New Machine: Two Profiles

Run `airelay guide` for a copy-paste setup guide based on the runtimes detected
on the machine. For example, two isolated profiles for the same runtime can be
created with:

```bash
airelay create codex-work --executable codex
airelay create codex-personal --executable codex
airelay list
airelay start codex-work
airelay start codex-personal
```

Profile definitions are stored in `~/.airelay/config.yaml`. The `create`
command prints the profile's isolated home/config directory after creation.

The prompt length check is disabled by default (`settings.promptMaxLength: -1`).
Set a numeric limit with `airelay config set settings.promptMaxLength <number>`;
use
`airelay config list` or `airelay config help` to inspect the effective setting
and its description. `-1` disables airelay's prompt-length check; the IPC
transport still limits one input to 256 KiB.

All schema-defined profile fields can also be changed without opening YAML:
`profiles.<profile>.executable`, `cwd`, `description`, `args`, `env` and
`createDirs`. Use YAML or JSON syntax for array/map values, for example
`airelay config set profiles.my-profile.args '["--verbose"]'`.
Every change is validated against the config schema before it is written.

Resumable PTY sessions hibernate after five minutes without observed activity by
default. Change the threshold with `airelay config set settings.hibernateAfter
10m`; supported units are `ms`, `s`, `m`, `h` and `d` (maximum `30d`). Use
`airelay config set settings.hibernateAfter off` to disable automatic hibernation.

Harness self-update checks are disabled by default when launched through Airelay,
including after a hibernated session wakes. This prevents update prompts from
interfering with automated startup and wake-up logic. To enable them, run:

```bash
airelay config set settings.harnessSelfUpdate true
```

For manual updates, use the harness directly: `codex update` for Codex or
`opencode upgrade` for OpenCode.
When hibernated, the Airelay controller stays alive and the harness process is
started again from its saved native session when a key is pressed or a prompt is
sent. New sessions without a known native session ID remain running until their
native ID can be saved safely.

> **Note**: `airelay start` launches with a pseudo-terminal (PTY), making sessions both terminal-compatible and promptable.
> Use `airelay run` for simple inherited-terminal execution (non-promptable).
> Direct profile launch (`airelay <profile>`) is no longer supported — use `airelay start <profile>`.

## How It Works

1. Load config from `~/.airelay/config.yaml`
2. Resolve paths (expand `~` to home directory)
3. Merge profile env with parent environment
4. Spawn executable (PTY for `start`, inherited stdio for `run`)
5. Controller socket enables `airelay prompt` for active sessions
6. Pass through exit code

## Platform Support

- Windows
- macOS
- Linux

Uses `node-pty` for PTY-backed sessions (cross-platform) and `cross-spawn` for inherited-terminal execution.

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Test
npm test

# Lint
npm run lint

# Format
npm run format

# Check all before commit
npm run lint && npm run format:check && npm test && npm audit
```

## License

MIT
