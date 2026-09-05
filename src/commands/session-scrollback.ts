import net from 'net';

const IPC_TIMEOUT = 5000;

export interface ScrollbackQueryResult {
  lines: string[];
  error?: string;
}

/** Fetch rendered lines from the controller's bounded xterm scrollback. */
export function fetchSessionScrollback(
  endpoint: string,
  lines: number,
  skip: number
): Promise<ScrollbackQueryResult> {
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
      resolve({ lines: [], error: 'IPC timeout' });
    }, IPC_TIMEOUT);

    socket.connect(endpoint, () => {
      socket.write(
        JSON.stringify({
          id: 'scrollback-1',
          method: 'session.scrollback',
          params: { lines, skip },
        }) + '\n'
      );
    });

    socket.on('data', (data: Buffer) => {
      buffer += data.toString();
      const idx = buffer.indexOf('\n');
      if (idx === -1) return;
      cleanup();
      try {
        const parsed = JSON.parse(buffer.slice(0, idx));
        if (parsed.type === 'success' && Array.isArray(parsed.data?.lines)) {
          resolve({ lines: parsed.data.lines as string[] });
        } else if (parsed.type === 'error' && parsed.error?.code === 'METHOD_NOT_FOUND') {
          resolve({
            lines: [],
            error:
              'Session controller protocol is older than this CLI. Restart the session with current airelay.',
          });
        } else {
          resolve({ lines: [], error: 'Unexpected response' });
        }
      } catch {
        resolve({ lines: [], error: 'Invalid response' });
      }
    });

    socket.on('error', (error) => {
      cleanup();
      resolve({ lines: [], error: error.message });
    });
  });
}
