import { promptCommand } from './prompt';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

export interface HeartbeatOptions {
  noWarn?: boolean;
  intervalMs?: number;
  durationMs?: number;
}

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(' ');
}

/**
 * Send a periodic heartbeat to a session.
 * Runs for durationMs (default 1h), then exits cleanly.
 */
export async function heartbeatCommand(
  sessionKeyOrId: string,
  options?: HeartbeatOptions
): Promise<number> {
  const intervalMs = options?.intervalMs || DEFAULT_INTERVAL_MS;
  const durationMs = options?.durationMs ?? DEFAULT_DURATION_MS;
  const startTime = Date.now();

  console.log(`Heartbeat started for session: ${sessionKeyOrId}`);
  console.log(`Interval: ${intervalMs}ms`);
  console.log(`Duration: ${formatDuration(durationMs)}`);
  console.log('Press Ctrl+C to stop.\n');

  let running = true;

  const shutdown = () => {
    if (running) {
      running = false;
      console.log('\nHeartbeat stopped.');
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  while (running) {
    const text = '[from=cron] heartbeat';
    const exitCode = await promptCommand(sessionKeyOrId, text, {
      enter: true,
      noWarn: options?.noWarn,
    });

    if (!running) break;

    if (exitCode !== 0) {
      console.error(`Heartbeat failed for session: ${sessionKeyOrId}`);
      process.removeListener('SIGINT', shutdown);
      process.removeListener('SIGTERM', shutdown);
      return exitCode;
    }

    console.log(`  [${new Date().toISOString()}] heartbeat sent`);

    // Check if duration has elapsed
    if (Date.now() - startTime >= durationMs) {
      console.log(`\nHeartbeat duration reached (${formatDuration(durationMs)}).`);
      running = false;
      break;
    }

    // Wait for the interval, checking running flag and duration periodically
    const checkInterval = 200;
    for (let waited = 0; waited < intervalMs && running; waited += checkInterval) {
      if (Date.now() - startTime >= durationMs) {
        console.log(`\nHeartbeat duration reached (${formatDuration(durationMs)}).`);
        running = false;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }
  }

  process.removeListener('SIGINT', shutdown);
  process.removeListener('SIGTERM', shutdown);
  return 0;
}
