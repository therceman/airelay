import fs from 'fs';
import net from 'net';
import path from 'path';
import { SessionController } from '../src/controller';
import { useTestEnv } from './test-utils';
import { getSocketIdentity, probeUnixSocket, sameSocketIdentity } from '../src/utils/unix-socket';

const testEnv = useTestEnv();
const socketDir = testEnv.socketsDir;

beforeAll(() => fs.mkdirSync(socketDir, { recursive: true }));

describe('Unix socket ownership', () => {
  it('reports missing, stale and live socket states', async () => {
    const missing = path.join(socketDir, 'missing.sock');
    expect(await probeUnixSocket(missing)).toBe('missing');

    const stale = path.join(socketDir, 'stale.sock');
    fs.writeFileSync(stale, 'not a socket');
    expect(await probeUnixSocket(stale)).toBe('stale');

    const live = path.join(socketDir, 'live.sock');
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(live, resolve));
    expect(await probeUnixSocket(live)).toBe('live');
    server.close();
    fs.rmSync(live, { force: true });
  });

  it('rejects a duplicate controller without removing the first owner', async () => {
    const first = new SessionController('duplicate-owner');
    await first.start();
    const second = new SessionController('duplicate-owner');

    await expect(second.start()).rejects.toThrow('already owned');
    expect(await probeUnixSocket(first.endpointPath)).toBe('live');
    await first.stop();
  });

  it('gives exactly one owner in concurrent startup', async () => {
    const attempts = [
      new SessionController('concurrent-owner'),
      new SessionController('concurrent-owner'),
    ];
    const results = await Promise.allSettled(attempts.map((controller) => controller.start()));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await probeUnixSocket(attempts[0].endpointPath)).toBe('live');
    await Promise.all(attempts.map((controller) => controller.stop()));
  });

  it('recovers a proven stale socket artifact', async () => {
    const controller = new SessionController('stale-owner');
    fs.writeFileSync(controller.endpointPath, 'stale socket artifact');

    await controller.start();

    expect(await probeUnixSocket(controller.endpointPath)).toBe('live');
    await controller.stop();
  });

  it('does not remove a pathname whose identity changed to another owner', async () => {
    const first = new SessionController('identity-owner-a');
    await first.start();
    await first.stop();

    const second = new SessionController('identity-owner-a');
    await second.start();
    const secondIdentity = getSocketIdentity(second.endpointPath);
    const firstIdentity = secondIdentity
      ? { dev: secondIdentity.dev, ino: secondIdentity.ino - 1 }
      : null;
    expect(sameSocketIdentity(firstIdentity, secondIdentity)).toBe(false);

    (first as unknown as { socketIdentity: typeof firstIdentity }).socketIdentity = firstIdentity;
    (first as unknown as { cleanupSocket: () => void }).cleanupSocket();
    expect(await probeUnixSocket(second.endpointPath)).toBe('live');
    await second.stop();
  });
});
