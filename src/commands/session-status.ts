import net from 'net';
import { findSessionByKey } from './sessions';
import { getIpcEndpointPath } from '../utils/ipc-path';
import { fetchSessionOutput } from './session-output';
import { preflightVersionCheck } from './session-ipc';

const IPC_TIMEOUT = 3000;
const ACTIVITY_WINDOW_MS = 10000;

interface StatusResult {
  sessionId: string;
  profile: string;
  sessionKey?: string;
  controllerEndpoint?: string;
  controllerReachable: boolean;
  pingLatencyMs?: number;
  state?: string;
  outputLines: number;
  airelayVersion?: string;
  controllerProtocolVersion?: number;
  startedAt?: number;
  compatError?: string;
}

function pingController(endpoint: string): Promise<{ reachable: boolean; latencyMs?: number }> {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    let cleanedUp = false;

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearTimeout(timeout);
      socket.destroy();
    };

    const timeout = setTimeout(() => {
      cleanup();
      resolve({ reachable: false });
    }, IPC_TIMEOUT);

    socket.connect(endpoint, () => {
      socket.write(JSON.stringify({ id: 'status-1', method: 'ping' }) + '\n');
    });

    let buffer = '';
    socket.on('data', (data: Buffer) => {
      buffer += data.toString();
      const idx = buffer.indexOf('\n');
      if (idx !== -1) {
        cleanup();
        const latencyMs = Date.now() - start;
        resolve({ reachable: true, latencyMs });
      }
    });

    socket.on('error', () => {
      cleanup();
      resolve({ reachable: false });
    });
  });
}

function fetchSessionInfo(endpoint: string): Promise<{
  airelayVersion?: string;
  controllerProtocolVersion?: number;
  startedAt?: number;
  lastOutputChangeAt?: number;
  compatError?: string;
}> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let buffer = '';
    let cleanedUp = false;

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearTimeout(timeout);
      socket.destroy();
    };

    const timeout = setTimeout(() => {
      cleanup();
      resolve({});
    }, IPC_TIMEOUT);

    socket.connect(endpoint, () => {
      socket.write(JSON.stringify({ id: 'info-1', method: 'session.info' }) + '\n');
    });

    socket.on('data', (data: Buffer) => {
      buffer += data.toString();
      const idx = buffer.indexOf('\n');
      if (idx !== -1) {
        cleanup();
        try {
          const parsed = JSON.parse(buffer.slice(0, idx));
          if (parsed.type === 'success' && parsed.data) {
            resolve({
              airelayVersion: parsed.data.airelayVersion as string,
              controllerProtocolVersion: parsed.data.controllerProtocolVersion as number,
              startedAt: parsed.data.startedAt as number,
              lastOutputChangeAt: parsed.data.lastOutputChangeAt as number | undefined,
            });
          } else if (parsed.type === 'error') {
            resolve({
              compatError: 'Session controller is an older version. Restart with current airelay.',
            });
          } else {
            resolve({ compatError: 'Unexpected response from session controller.' });
          }
        } catch {
          resolve({ compatError: 'Invalid response from session controller.' });
        }
      }
    });

    socket.on('error', () => {
      cleanup();
      resolve({});
    });
  });
}

export async function sessionStatusCommand(
  sessionKeyOrId: string,
  options?: { json?: boolean }
): Promise<number> {
  const found = findSessionByKey(sessionKeyOrId);
  if (!found) {
    console.error(`Error: Session not found: ${sessionKeyOrId}`);
    return 1;
  }

  const sessionKey = found.session.sessionKey || found.session.id;
  const endpointPath = found.session.controllerEndpoint || getIpcEndpointPath(sessionKey);

  // Preflight version parity check (blocking — hard-stop on major mismatch)
  const parity = await preflightVersionCheck(endpointPath);
  if (parity.error) {
    console.error(`Error: ${parity.error}`);
    return 1;
  }
  for (const w of parity.warnings) {
    console.warn(`Warning: ${w}`);
  }

  const [ping, output, info] = await Promise.all([
    pingController(endpointPath),
    fetchSessionOutput(endpointPath),
    fetchSessionInfo(endpointPath),
  ]);

  // Compute activity state from last output change timestamp
  let state: string | undefined;
  if (info.lastOutputChangeAt !== undefined) {
    const elapsed = Date.now() - info.lastOutputChangeAt;
    state = elapsed < ACTIVITY_WINDOW_MS ? 'busy' : 'free';
  }

  const result: StatusResult = {
    sessionId: found.session.id,
    profile: found.profile,
    sessionKey: found.session.sessionKey,
    controllerEndpoint: endpointPath,
    controllerReachable: ping.reachable,
    pingLatencyMs: ping.latencyMs,
    state,
    outputLines: output.lines.length,
    airelayVersion: info.airelayVersion,
    controllerProtocolVersion: info.controllerProtocolVersion,
    startedAt: info.startedAt,
    compatError: info.compatError,
  };

  if (options?.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Session: ${result.sessionId}`);
    console.log(`  Profile: ${result.profile}`);
    if (result.sessionKey) {
      console.log(`  Key:     ${result.sessionKey}`);
    }
    console.log(
      `  Controller: ${result.controllerReachable ? `reachable (${result.pingLatencyMs}ms)` : 'unreachable'}`
    );
    if (result.airelayVersion) {
      console.log(`  Airelay version: ${result.airelayVersion}`);
      console.log(`  Protocol version: ${result.controllerProtocolVersion}`);
      console.log(`  Started: ${new Date(result.startedAt!).toISOString()}`);
    }
    if (result.state) {
      console.log(`  State: ${result.state}`);
    }
    if (result.compatError) {
      console.log(`  ⚠ ${result.compatError}`);
    }
  }

  return 0;
}
