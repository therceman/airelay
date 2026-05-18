#!/usr/bin/env node
import { runCommand } from './commands/run';
import { listCommand, listCommandJson } from './commands/list';
import { whichCommand } from './commands/which';
import { doctorCommand } from './commands/doctor';
import { initCommand } from './commands/init';
import { createCommand } from './commands/create';
import { selectCommand } from './commands/select';
import { resumeCommand } from './commands/resume';
import { startCommand } from './commands/start';
import { newCommand } from './commands/new';
import { cleanupCommand, psCommand } from './commands/cleanup';
import { isolateCommand } from './commands/isolate';
import { removeCommand } from './commands/remove';
import { promptCommand } from './commands/prompt';
import { sessionsListCommand } from './commands/sessions-list';
import { sessionStatusCommand } from './commands/session-status';
import { sessionFindCommand } from './commands/session-find';
import { heartbeatCommand } from './commands/heartbeat';
import * as path from 'path';
import * as fs from 'fs';

interface ParseResult {
  command: string;
  args: string[];
  flags: Record<string, string | boolean>;
  profile?: string;
  extraArgs: string[];
}

const KNOWN_COMMANDS = [
  'init',
  'create',
  'new',
  'resume',
  'start',
  'list',
  'which',
  'doctor',
  'run',
  'help',
  'select',
  'cleanup',
  'ps',
  'isolate',
  'remove',
  'prompt',
  'sessions',
  'session-status',
  'session-find',
  'heartbeat',
];
const PROFILE_COMMANDS = ['run', 'which', 'doctor', 'start'];

function parseArgs(argv: string[]): ParseResult {
  const args = argv.slice(2);
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  let extraArgs: string[] = [];

  const command = args[0];
  const isKnownCommand = command && KNOWN_COMMANDS.includes(command);
  const takesProfile = command && PROFILE_COMMANDS.includes(command);

  if (!isKnownCommand) {
    if (!command && args.length === 0) {
      return {
        command: 'select',
        args: [],
        flags: {},
        profile: undefined,
        extraArgs: [],
      };
    }

    if (command === '--help' || command === '-h') {
      showHelp();
      process.exit(0);
    }

    if (command === '--version' || command === '-v') {
      const pkgPath = path.join(__dirname, '..', 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      console.log(`airelay v${pkg.version}`);
      process.exit(0);
    }

    return {
      command: 'error',
      args: [],
      flags: {},
      profile: command,
      extraArgs: [],
    };
  }

  let i = 1;
  let profileFound = false;

  while (i < args.length) {
    const arg = args[i];

    if (arg === '--') {
      extraArgs.push(...args.slice(i + 1));
      break;
    }

    if (profileFound) {
      // For start command, intercept known flags before they become harness args
      if (command === 'start' && arg === '--key') {
        if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          flags.key = args[i + 1];
          i += 2;
        } else {
          flags._error = '--key requires a value.';
          break;
        }
        continue;
      }
      extraArgs.push(arg);
      i++;
      continue;
    }

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        flags[key] = args[i + 1];
        i += 2;
      } else {
        flags[key] = true;
        i++;
      }
    } else if (arg.startsWith('-') && arg.length > 1) {
      const key = arg.slice(1);
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        flags[key] = args[i + 1];
        i += 2;
      } else {
        flags[key] = true;
        i++;
      }
    } else {
      positional.push(arg);
      if (takesProfile && positional.length === 1) {
        profileFound = true;
      }
      i++;
    }
  }

  const profile = positional[0];
  const cmdArgs = positional.slice(1);

  // Map short flags to long forms for known options
  if (flags.e) flags.executable = flags.e;
  if (flags.k) flags.apiKey = flags.k;
  if (flags.d) flags.dir = flags.d;
  if (flags.f) flags.force = flags.f;
  if (flags.m) flags.mode = flags.m;
  if (flags.s) flags.session = flags.s;
  if (flags.j) flags.json = flags.j;

  return {
    command,
    args: cmdArgs,
    flags,
    profile,
    extraArgs,
  };
}

function showHelp(): void {
  console.log(`
airelay - Cross-platform CLI for shared-base profile overlays

Usage:
  airelay <command> [options]

Commands:
  init                  Initialize config with auto-detected runtimes
  create <name>         Create a new profile
  new                   Create a new profile (interactive)
  resume <key>          Resume a session by profile or session key
  start <profile>       Start a new session (--key <key>, -- <harness_args>)
  list                  List all profiles
  which <profile>       Show resolved runtime details
  doctor [profile]      Run diagnostics
  run <profile>         Run a profile with inherited terminal
  select                Interactive profile selector (TUI)
  ps                    List tracked processes
  cleanup               Kill orphaned processes
  isolate [name]        Show/set up overlay for codex executable profiles
  remove [name]         Remove profile overlay (safe, keeps shared data)
  prompt <session>      Send input to an active session
  sessions              List saved sessions
  session-status <key>  Show session health and UI status
  session-find <key>    Search recent session output for pattern
  heartbeat <session>   Send periodic heartbeat to a session
  help                  Show this help message

Examples:
  airelay init
  airelay start opencode
  airelay start opencode resume ses_abc123
  airelay start opencode2 --key worker_1 -- -s ses_xxx
  airelay resume myprofile_abc123
  airelay create myprofile -e opencode
  airelay opencode --help
  airelay myprofile -m fast
  airelay run myprofile --verbose
  airelay ps
  airelay cleanup
  airelay prompt mysession "write a test"
  airelay prompt mysession --text "continue" --no-enter
  airelay prompt mysession --stdin <<'EOF'
  airelay prompt mysession --only-enter
  airelay prompt mysession --only-sequence $'\x1b[106;4u'
  airelay sessions
  airelay sessions --json
  airelay sessions --active
  airelay sessions --cwd
  airelay sessions --cwd --active --json

Create options:
  -e, --executable <name>  Executable name (opencode or codex)
  -k, --api-key <key>      API key
  -d, --dir <path>         Config directory

Init options:
  -f, --force              Overwrite existing config

Prompt options:
  --stdin                  Read prompt text from stdin (pipe/heredoc)
  --text <text>            Text to send to the session
  --no-enter               Do not append newline after text (default: enter)
  --only-enter             Send Enter key only (no text)
  --only-sequence <seq>    Send raw sequence only (no text)
  --sequence <seq>         Override submit sequence, e.g. $'\\x1b[106;4u'
  --no-sender              Disable auto @-sender prefix
  --sender <id>            Override sender identifier (default: $AIRELAY_SESSION_KEY)

Start options:
  --key <key>              Custom session key (overrides auto-generated key)

Session options:
  --json                   Output in JSON format
  --active                 Show only currently active sessions
  --cwd                    Show only sessions started in current directory

Heartbeat options:
  --no-warn                Suppress version parity warnings
  --interval <seconds>     Heartbeat interval in seconds (default: 300, i.e. 5m)
  --duration <seconds>     Runtime limit in seconds (default: 3600, i.e. 1h)
  --msg <text>             Override heartbeat message (default: [from=cron] heartbeat)
`);
}

async function runCli(): Promise<void> {
  const { command, flags, profile, extraArgs, args } = parseArgs(process.argv);

  try {
    switch (command) {
      case 'init':
        initCommand(flags.force === true);
        break;

      case 'create':
        await createCommand(
          profile,
          flags.executable as string | undefined,
          flags.apiKey as string | undefined,
          flags.dir as string | undefined,
          flags.force as boolean | undefined
        );
        break;

      case 'new':
        await newCommand();
        break;

      case 'resume':
        if (!profile) {
          console.error('Error: Profile or session key required');
          console.error('Usage: airelay resume <profile|session-key>');
          process.exit(1);
        }
        await resumeCommand(profile);
        break;

      case 'start':
        if (!profile) {
          console.error('Error: Profile name required');
          console.error('Usage: airelay start <profile> [--key <key>] [-- <harness_args...>]');
          process.exit(1);
        }
        if (flags._error) {
          console.error(`Error: ${flags._error}`);
          process.exit(1);
        }
        {
          const sessionKey = flags.key as string | boolean | undefined;
          if (sessionKey !== undefined) {
            if (typeof sessionKey !== 'string' || sessionKey.trim().length === 0) {
              console.error('Error: --key requires a value.');
              process.exit(1);
            }
            if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(sessionKey)) {
              console.error(`Error: Invalid key "${sessionKey}". Must start with a letter/digit and contain only letters, digits, -, _.`);
              process.exit(1);
            }
          }
          await startCommand(profile, extraArgs, { key: sessionKey });
        }
        break;

      case 'list':
        if (flags.json === true) {
          const profiles = listCommandJson();
          console.log(JSON.stringify(profiles, null, 2));
        } else {
          listCommand();
        }
        break;

      case 'which':
        if (!profile) {
          console.error('Error: Profile name required');
          console.error('Usage: airelay which <profile>');
          process.exit(1);
        }
        whichCommand(profile);
        break;

      case 'doctor':
        doctorCommand(profile);
        break;

      case 'run':
        if (!profile) {
          console.error('Error: Profile name required');
          console.error('Usage: airelay run <profile>');
          process.exit(1);
        }
        {
          const exitCode = await runCommand(profile, extraArgs);
          process.exit(exitCode);
        }

      case 'help':
        showHelp();
        break;

      case 'error':
        console.error(`Error: Unknown command or profile: "${profile}".`);
        console.error(`Use "airelay start ${profile}" to launch this profile.`);
        console.error('Run "airelay help" for available commands.');
        process.exit(1);

      case 'cleanup':
        cleanupCommand();
        break;

      case 'ps':
        psCommand();
        break;

      case 'isolate':
        isolateCommand(profile);
        break;

      case 'remove':
        await removeCommand(profile);
        break;

      case 'prompt':
        if (!profile) {
          console.error('Error: Session key or ID required');
          console.error('Usage: airelay prompt <session> [text]');
          process.exit(1);
        }
        {
          const text = args[0] || (flags.text as string | undefined);
          const onlyEnter = flags['only-enter'] === true;
          const onlySequence =
            (flags['only-sequence'] as string | undefined) ||
            (flags.sequence as string | undefined) ||
            args.find((a) => a.startsWith('sequence='))?.slice('sequence='.length);
          const stdin = flags.stdin === true;

          if (onlyEnter && onlySequence) {
            console.error('Error: --only-enter and --only-sequence cannot be combined.');
            process.exit(1);
          }
          if ((onlyEnter || onlySequence) && text) {
            console.error('Error: Text argument cannot be combined with --only-enter or --only-sequence.');
            process.exit(1);
          }
          if (stdin && text) {
            console.error('Error: --stdin cannot be combined with inline text or --text.');
            process.exit(1);
          }

          const noEnter = flags['no-enter'] === true;
          const enterValue = noEnter ? false : true;

          const noSender = flags['no-sender'] === true;
          const sender = flags['sender'] as string | undefined;

          if (noSender && sender) {
            console.error('Error: --no-sender and --sender cannot be combined.');
            process.exit(1);
          }
          if (sender !== undefined && sender.trim().length === 0) {
            console.error('Error: --sender cannot be empty.');
            process.exit(1);
          }

          const noWarn = flags['no-warn'] === true;

          const exitCode = await promptCommand(profile, text, {
            enter: enterValue,
            onlyEnter,
            onlySequence,
            noSender,
            sender,
            noWarn,
            stdin,
          });
          process.exit(exitCode);
        }

      case 'sessions':
        await sessionsListCommand({
          json: flags.json === true,
          active: flags.active === true,
          cwd: flags.cwd === true,
        });
        break;

      case 'session-status':
        if (!profile) {
          console.error('Error: Session key or ID required');
          console.error('Usage: airelay session-status <session> [--field <name>]');
          process.exit(1);
        }
        {
          const field = flags.field as string | undefined;
          const noWarn = flags['no-warn'] === true;
          const exitCode = await sessionStatusCommand(profile, {
            json: flags.json === true,
            field,
            noWarn,
          });
          process.exit(exitCode);
        }

      case 'heartbeat':
        if (!profile) {
          console.error('Error: Session key or ID required');
          console.error(
            'Usage: airelay heartbeat <session> [--no-warn] [--msg <text>] [--interval <seconds>] [--duration <seconds>]'
          );
          process.exit(1);
        }
        {
          const intervalFlag = flags.interval as string | undefined;
          const intervalSeconds = intervalFlag ? parseInt(intervalFlag, 10) : undefined;
          if (intervalFlag && (isNaN(intervalSeconds!) || intervalSeconds! <= 0)) {
            console.error('Error: --interval must be a positive number (seconds).');
            process.exit(1);
          }
          const durationFlag = flags.duration as string | undefined;
          const durationSeconds = durationFlag ? parseInt(durationFlag, 10) : undefined;
          if (durationFlag && (isNaN(durationSeconds!) || durationSeconds! <= 0)) {
            console.error('Error: --duration must be a positive number (seconds).');
            process.exit(1);
          }
          const msg = flags.msg as string | undefined;
          if (msg !== undefined && msg.trim().length === 0) {
            console.error('Error: --msg cannot be empty.');
            process.exit(1);
          }
          const noWarn = flags['no-warn'] === true;
          const exitCode = await heartbeatCommand(profile, {
            noWarn,
            intervalMs: intervalSeconds ? intervalSeconds * 1000 : undefined,
            durationMs: durationSeconds ? durationSeconds * 1000 : undefined,
            msg,
          });
          process.exit(exitCode);
        }

      case 'session-find':
        if (!profile) {
          console.error('Error: Session key or ID required');
          console.error('Usage: airelay session-find <session> <pattern>');
          process.exit(1);
        }
        {
          const pattern = args[0];
          const noWarn = flags['no-warn'] === true;
          const exitCode = await sessionFindCommand(profile, pattern, { json: flags.json === true, noWarn });
          process.exit(exitCode);
        }

      case 'select':
      default:
        await selectCommand();
        break;
    }
  } catch (e) {
    console.error(`Error: ${(e as Error).message}`);
    process.exit(1);
  }
}

export { runCli, parseArgs };

// Invoke CLI when run as script
if (require.main === module) {
  runCli();
}
