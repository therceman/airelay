import os from 'os';
import path from 'path';

export function getSocketDir(): string {
  if (process.env.AIRELAY_SOCKETS_DIR) {
    return process.env.AIRELAY_SOCKETS_DIR;
  }
  return path.join(os.homedir(), '.airelay', 'sockets');
}

export function getIpcEndpointPath(sessionKey: string): string {
  const sanitized = sessionKey.replace(/[^a-zA-Z0-9_.-]/g, '_');

  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\airelay-${sanitized}`;
  }

  return path.join(getSocketDir(), `${sanitized}.sock`);
}

export function sessionKeyToFilename(sessionKey: string): string {
  const sanitized = sessionKey.replace(/[^a-zA-Z0-9_.-]/g, '_');
  return `${sanitized}.sock`;
}
