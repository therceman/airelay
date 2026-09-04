# DOMAIN.md — airelay Domain Model

## Core Concepts

### Profile

A named configuration for running an AI coding assistant (harness).

**Attributes:**

- `name`: Unique identifier
- `executable`: Command to run (opencode/codex)
- `cwd`: Optional working directory override
- `args`: Optional default arguments
- `env`: Environment variables (with path expansion)
- `description`: Human-readable description
- `createDirs`: Directories to create before running

**Lifecycle:**

- Created via `airelay create <name>` or `airelay new` (interactive)
- Stored in `~/.airelay/config.yaml`
- Can be default (opencode/codex) or custom

### Session

A specific instance of a harness run with a unique identifier.

**Attributes:**

- `id`: Harness-provided session ID (e.g., `ses_267f917bdffe...`)
- `profile`: Reference to parent profile
- `sessionKey`: User-friendly identifier (default: `<profile>_<last-4>`)
- `description`: Optional user description
- `cwd`: Working directory where started
- `lastUsed`: Timestamp for recency tracking

**Lifecycle:**

- Created when harness starts with `-s <id>` or generates new ID
- Saved after harness exits (manual entry of session ID)
- Stored in `~/.airelay/sessions.json`
- Limited to 50 per profile (oldest pruned)

### Harness

The underlying AI coding assistant executable.

**Supported:**

- `opencode` — OpenCode CLI
- `codex` — OpenAI Codex CLI

**Detection:**

- Via `src/utils/harness.ts` patterns
- Session ID extraction from output
- Args help messages

### Session Key

A user-friendly identifier for referencing sessions.

**Format:** `<profile>_<last-4-chars-of-session-id>`

**Example:** `opencode_XjhS`

**Purpose:**

- Easier to remember than full session ID
- Provides context via profile prefix
- Can be customized by user

## Commands

### Interactive (TUI)

**`airelay`** (no arguments)

Main menu with three options:

1. **Resume session**
   - Select project, shown with its latest-use time and sorted newest first
   - Select session from that project's launch history
2. **Resume current project session**
   - Select a session from the current project's launch history
3. **Start a new session**
   - Select profile → Run without session ID

**`airelay guide`**

- Shows copy-paste setup instructions for creating profiles on a new machine
- Lists detected runtimes and the locations of profile configuration/data

**Post-Run Flow:**
After harness exits:

- Prompt for session ID
- If provided: prompt for session key (pre-filled) and description
- Save to session history

### CLI Commands

**`airelay resume [profile|session-key]`**

- Without an argument, select a resumable launch from the current folder's
  launch history, sorted newest first.
- With a profile or session key, resume using the existing session selector or
  direct key lookup.

**`airelay start <profile> [args...]`**

- Start a new session with optional arguments
- No TUI, direct execution
- Example: `airelay start opencode -m fast`

**`airelay new`**

- Create a new profile (interactive)
- Alias for `airelay create` without arguments

**`airelay create <name> [options]`**

- Create a new profile
- Options: `-e <executable>`, `-k <api-key>`, `-d <config-dir>`

**`airelay run <profile> [args...]`**

- Run a profile with optional arguments
- Default command (can omit `run`)

**`airelay select`**

- Explicit invocation of TUI
- Same as `airelay` with no args

**`airelay list`**

- List all configured profiles

**`airelay which <profile>`**

- Show profile details and resolved paths

**`airelay doctor [profile]`**

- Run diagnostics

**`airelay init [--force]`**

- Initialize config with auto-detected runtimes

**`airelay config`**

- `airelay config list` shows the config and resolved defaults
- `airelay config set settings.promptMaxLength <number|unlimited>` changes the prompt limit
- `settings.promptMaxLength` defaults to `unlimited`
- `unlimited` disables the prompt-length check; the IPC transport still limits one input to 256 KiB
- Length is measured in Unicode code points via `Array.from`; emoji count as one and combining marks count separately

## Data Storage

### Config File

**Location:** `~/.airelay/config.yaml` (or `AIRELAY_CONFIG` env var)

**Structure:**

```yaml
version: 1
settings:
  promptMaxLength: unlimited
profiles:
  opencode:
    executable: opencode
    description: OpenCode profile
    env:
      OPENCODE_CONFIG_DIR: ~/.config/opencode
```

### Session History

**Location:** `~/.airelay/sessions.json` (or `AIRELAY_SESSIONS` env var)

**Structure:**

```json
{
  "opencode": [
    {
      "id": "ses_267f917bdffeOW2yp1TMXjhSFl",
      "profile": "opencode",
      "sessionKey": "opencode_XjhS",
      "description": "Implement texture maker",
      "cwd": "/home/user/project",
      "lastUsed": 1776409079562
    }
  ]
}
```

### Last-Used Profile (Per-Directory)

**Location:** `~/.airelay/last-used/<cwd-hash>.json` (or `AIRELAY_LAST_USED` env var)

**Structure:**

```json
{
  "profile": "opencode",
  "cwd": "/home/user/project",
  "timestamp": 1776409079562
}
```

**Purpose:**

- Track last-used profile per working directory
- Mark profile with "(last used)" in TUI
- Pre-select in profile list

## Environment Variables

| Variable          | Purpose              | Default                     |
| ----------------- | -------------------- | --------------------------- |
| `AIRELAY_CONFIG`    | Config file path     | `~/.airelay/config.yaml`   |
| `AIRELAY_SESSIONS`  | Session history path | `~/.airelay/sessions.json` |
| `AIRELAY_LAST_USED` | Last-used directory  | `~/.airelay/last-used`     |
| `AIRELAY_PIDS`      | PID tracking file    | `~/.airelay/pids.json`     |

## User Workflows

### Quick Resume

```bash
# See session history for the current folder and pick one
airelay resume

# Or pick from the active sessions of one profile
airelay resume myprofile

# Or directly by session key (future)
airelay resume opencode_XjhS
```

### Start New Session

```bash
# Via TUI
airelay
→ Start new session
→ Select profile
→ Confirm

# Via CLI
airelay start opencode
```

### Create Profile

```bash
# Interactive
airelay new

# Or
airelay create myprofile -e opencode
```

### Session Management

After harness exits:

1. Copy session ID from harness output
2. Paste when prompted
3. Accept/modify session key
4. Optionally add description
5. Session saved for future resume

### Process Management

```bash
# List tracked processes
airelay ps

# Kill orphaned processes (parent airelay died)
airelay cleanup
```

**PID Tracking:**

- All harness processes spawned by airelay are tracked in `~/.airelay/pids.json`
- Tracking includes: PID, parent PID, command, args, cwd, start time, profile
- Orphaned processes (where parent airelay died) can be detected and cleaned up
- PID entries are automatically removed when process exits cleanly
- Dead PIDs are cleaned up on module load

## Design Principles

1. **TUI for discovery, CLI for automation**
   - Interactive menu for exploration
   - Direct commands for scripts/aliases

2. **Per-directory context**
   - Last-used tracked per working directory
   - Respects project boundaries

3. **Session keys for memorability**
   - Short, contextual identifiers
   - Default format includes profile name

4. **Manual session save**
   - User controls what to save
   - No automatic capture (harness TTY limitation)

5. **Profile isolation**
   - Separate config/data per profile
   - No cross-contamination
