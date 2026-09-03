# ADR 001: Session Management with Session Keys

## Status

Accepted

## Context

The airelay CLI tool manages profile-isolated sessions for AI coding assistants (opencode/codex). Users need to:

- Resume previous sessions across different working directories
- Reference sessions with memorable identifiers
- Track session metadata (profile, description, working directory)
- Maintain both short-term (last-used per directory) and long-term (session history) memory

## Decision

Implement a session management system with the following characteristics:

### Session Data Structure

Each session entry contains:

- `id`: The harness-provided session ID (e.g., `ses_267f917bdffeOW2yp1TMXjhSFl`)
- `profile`: The profile name used for this session
- `sessionKey`: User-friendly identifier (default: `<profile>_<last-4-chars-of-id>`)
- `description`: Optional user-provided description
- `cwd`: Working directory where session was started
- `lastUsed`: Timestamp for sorting/recency tracking

### Session Key Format

Default session key format: `<profile>_<last-4-chars-of-session-id>`

Example: `opencode_XjhS`

Users can customize the session key during session save.

### Session Resume

Sessions can be resumed by:

1. Project picker, followed by launch-history session picker
2. Current project session picker
3. Session key (direct resume)
4. Session ID (direct resume)

### Commands

- `airelay` (no args) → Interactive TUI with project resume/current resume/start options
- `airelay resume [profile|session-key]` → Select a launch from the current
  folder or resume an existing session by profile/key
- `airelay start <profile> [args...]` → Start new session with optional args
- `airelay new` → Create new profile (interactive)
- `airelay guide` → Show new-machine profile setup instructions

### TUI Behavior

The interactive TUI:

1. Does NOT prompt for extra arguments (keeps flow simple)
2. Offers project resume, current-project resume, and starting a new session
3. Shows projects with latest-use times sorted newest first, then launch-history
   rows newest first, including session key and resume args
4. After harness exits, prompts for:
   - Session ID (from harness output)
   - Session key (pre-filled with default)
   - Description (optional)

### Last-Used Tracking

Last-used profile is tracked **per working directory**, not globally:

- Storage: `~/.airelay/last-used/<cwd-hash>.json`
- Allows different "last used" profiles in different project directories

## Consequences

### Positive

- Users can quickly resume sessions with memorable keys
- Session metadata helps identify the right session to resume
- Per-directory last-used tracking respects project context
- TUI flow is simplified (no argument prompts)
- CLI remains flexible for power users (start with args)

### Negative

- Session keys must be unique (potential for collision if users customize)
- Additional prompts after harness exit may feel redundant
- Session management complexity increases

### Neutral

- Sessions are limited to 50 per profile (automatic cleanup)
- Session keys are user-customizable but default to predictable format

## Implementation Details

### Session Storage

Location: `~/.airelay/sessions.json`

```json
{
  "opencode": [
    {
      "id": "ses_267f917bdffeOW2yp1TMXjhSFl",
      "profile": "opencode",
      "sessionKey": "opencode_XjhS",
      "description": "Implement texture maker feature",
      "cwd": "/home/user/project",
      "lastUsed": 1776409079562
    }
  ]
}
```

### Session Save Flow

After harness exits (Ctrl+C):

1. Prompt: "Session ID to save (or press enter to skip)"
2. If ID provided:
   - Prompt: "Session key" (pre-filled: `<profile>_XXXX`)
   - Prompt: "Session description (optional)"
   - Save to sessions.json

### Resume Command Logic

```typescript
resumeCommand(profileOrSessionKey?: string):
  1. If no argument: select a resumable launch from current-folder history
  2. Check if profileOrSessionKey matches a profile name
     - If yes and has sessions: show session selector
     - If yes and no sessions: start new session
  3. Check if profileOrSessionKey matches a session key
     - If yes: resume that session directly
  4. Check if profileOrSessionKey matches a session ID
     - If yes: resume that session directly
  5. Error: not found
```

The folder picker uses the launch-history entry ID as its choice value, so
repeated launches with the same session key remain separate selectable rows.
