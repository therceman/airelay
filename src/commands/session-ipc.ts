import net from 'net';
import { getAirelayVersion } from '../utils/version';
import type { DeliveryStatus } from '../runtime/delivery';

const IPC_TIMEOUT = 5000;
const PREFLIGHT_TIMEOUT = 2000;

export interface ControllerInfo {
  airelayVersion?: string;
  controllerProtocolVersion?: number;
  startedAt?: number;
  delivery?: DeliveryStatus;
  /** Number of currently attached viewport clients, when reported by the controller. */
  attached?: number;
}

export interface ControllerRequestResponse {
  type: string;
  data?: unknown;
  error?: { code: string; message: string };
}

/** Send one bounded request to an existing session controller. */
export function sendControllerRequest(
  endpoint: string,
  request: { id: string; method: string; params?: Record<string, unknown> },
  timeoutMs: number = IPC_TIMEOUT
): Promise<ControllerRequestResponse> {
  return new Promise((resolve, reject) => {
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
      reject(new Error('IPC timeout'));
    }, timeoutMs);

    socket.connect(endpoint, () => {
      socket.write(JSON.stringify(request) + '\n');
    });

    socket.on('data', (data: Buffer) => {
      buffer += data.toString();
      const idx = buffer.indexOf('\n');
      if (idx === -1) return;
      cleanup();
      try {
        resolve(JSON.parse(buffer.slice(0, idx)) as ControllerRequestResponse);
      } catch {
        reject(new Error('Invalid response'));
      }
    });

    socket.on('error', (error) => {
      cleanup();
      reject(error);
    });
  });
}

export interface ParityResult {
  ok: boolean;
  warnings: string[];
  error?: string;
}

function parseSemver(v: string): { major: number; minor: number; patch: number } {
  const parts = v.split('.');
  return {
    major: parseInt(parts[0], 10) || 0,
    minor: parseInt(parts[1], 10) || 0,
    patch: parseInt(parts[2], 10) || 0,
  };
}

/**
 * Fetch session.info from a controller endpoint.
 */
export function fetchControllerInfo(
  endpoint: string,
  timeoutMs: number = IPC_TIMEOUT
): Promise<ControllerInfo> {
  return new Promise((resolve, reject) => {
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
      reject(new Error('IPC timeout'));
    }, timeoutMs);

    socket.connect(endpoint, () => {
      socket.write(JSON.stringify({ id: 'preflight-1', method: 'session.info' }) + '\n');
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
              delivery: parsed.data.delivery as DeliveryStatus | undefined,
              attached: parsed.data.attached as number | undefined,
            });
          } else if (parsed.type === 'error') {
            reject(new Error('Controller rejected request'));
          } else {
            reject(new Error('Unexpected response'));
          }
        } catch {
          reject(new Error('Invalid response'));
        }
      }
    });

    socket.on('error', (err) => {
      cleanup();
      reject(err);
    });
  });
}

/**
 * Compare controller version against local CLI version.
 * Returns warnings/errors without throwing.
 */
export function checkVersionParity(controllerVersion: string): ParityResult {
  const localVersion = getAirelayVersion();
  const warnings: string[] = [];

  if (!controllerVersion || controllerVersion === localVersion) {
    return { ok: true, warnings: [] };
  }

  const cv = parseSemver(controllerVersion);
  const lv = parseSemver(localVersion);

  if (cv.major !== lv.major) {
    return {
      ok: false,
      warnings,
      error: `Controller version (${controllerVersion}) is incompatible with this CLI (${localVersion}). Restart the session with current airelay.`,
    };
  }

  if (cv.minor < lv.minor || (cv.minor === lv.minor && cv.patch < lv.patch)) {
    warnings.push(
      `Controller (${controllerVersion}) is older than CLI (${localVersion}). Consider restarting the session.`
    );
  } else if (cv.minor > lv.minor || (cv.minor === lv.minor && cv.patch > lv.patch)) {
    warnings.push(
      `Controller (${controllerVersion}) is newer than CLI (${localVersion}). Consider updating airelay.`
    );
  }

  return { ok: true, warnings };
}

/**
 * Preflight version parity check for a controller endpoint.
 * Connects, fetches session.info, compares versions.
 * Only swallows connectivity errors (handled by command's main IPC path).
 * Malformed/unexpected responses propagate as actionable errors.
 */
export async function preflightVersionCheck(endpoint: string): Promise<ParityResult> {
  try {
    const info = await fetchControllerInfo(endpoint, PREFLIGHT_TIMEOUT);
    if (!info.airelayVersion) {
      return { ok: true, warnings: [] };
    }
    return checkVersionParity(info.airelayVersion);
  } catch (err: unknown) {
    const nodeErr = err as Error & { code?: string };
    // Connectivity errors — handled by command's main IPC path
    if (
      nodeErr.code === 'ENOENT' ||
      nodeErr.code === 'ECONNREFUSED' ||
      nodeErr.code === 'ENOTCONN' ||
      (nodeErr.message && nodeErr.message.includes('timed out'))
    ) {
      return { ok: true, warnings: [] };
    }
    // All other errors (malformed response, protocol mismatch, etc.) — surface
    return {
      ok: false,
      warnings: [],
      error: `Preflight check failed: ${nodeErr.message || 'Unknown error'}`,
    };
  }
}
