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
  promptMaxLength: unlimited

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
airelay prompt <session> <text>    # Send input to an active session
airelay config list                # Show config and resolved defaults
airelay config set settings.promptMaxLength 1024
airelay help                       # Show this help message
airelay guide                      # New-machine setup guide
```

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

The prompt length check is disabled by default. Set a numeric limit with
`airelay config set settings.promptMaxLength <number|unlimited>`; use
`airelay config list` or `airelay config help` to inspect the effective setting
and its description. `unlimited` disables airelay's prompt-length check; the
IPC transport still limits one input to 256 KiB.

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
