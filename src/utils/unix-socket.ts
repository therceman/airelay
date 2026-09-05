import fs from 'fs';
import net from 'net';

export type SocketProbeResult = 'missing' | 'live' | 'stale' | 'unknown';

export interface SocketIdentity {
  dev: number;
  ino: number;
}

export function getSocketIdentity(socketPath: string): SocketIdentity | null {
  try {
    const stat = fs.lstatSync(socketPath);
    return { dev: stat.dev, ino: stat.ino };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export function sameSocketIdentity(
  left: SocketIdentity | null,
  right: SocketIdentity | null
): boolean {
  return !!left && !!right && left.dev === right.dev && left.ino === right.ino;
}

export function probeUnixSocket(socketPath: string, timeoutMs = 250): Promise<SocketProbeResult> {
  if (!fs.existsSync(socketPath)) {
    return Promise.resolve('missing');
  }

  return new Promise((resolve) => {
    const socket = net.createConnection({ path: socketPath });
    let settled = false;
    const finish = (result: SocketProbeResult): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.once('connect', () => finish('live'));
    socket.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        finish('missing');
      } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTSOCK') {
        finish('stale');
      } else {
        finish('unknown');
      }
    });
    socket.setTimeout(timeoutMs, () => finish('unknown'));
  });
}
