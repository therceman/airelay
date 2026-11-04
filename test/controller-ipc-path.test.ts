import os from 'os';
import path from 'path';
import { getIpcEndpointPath, getSocketDir, sessionKeyToFilename } from '../src/utils/ipc-path';

const REAL_PLATFORM = process.platform;

describe('getSocketDir', () => {
  it('returns path under .airelay/sockets in home directory', () => {
    const dir = getSocketDir();
    expect(dir).toBe(path.join(os.homedir(), '.airelay', 'sockets'));
  });
});

describe('sessionKeyToFilename', () => {
  it('creates a .sock filename from session key', () => {
    expect(sessionKeyToFilename('my_session_abc1')).toBe('my_session_abc1.sock');
  });

  it('sanitizes special characters to underscores', () => {
    expect(sessionKeyToFilename('bad/key$name')).toBe('bad_key_name.sock');
  });

  it('keeps dotted keys distinct from underscored keys', () => {
    expect(sessionKeyToFilename('session.v1')).toBe('session.v1.sock');
    expect(getIpcEndpointPath('session.v1')).not.toBe(getIpcEndpointPath('session_v1'));
  });

  it('handles empty string', () => {
    expect(sessionKeyToFilename('')).toBe('.sock');
  });
});

describe('getIpcEndpointPath', () => {
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: REAL_PLATFORM });
  });

  it('returns a unix socket path on non-windows platforms', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const p = getIpcEndpointPath('test_session_abc1');
    expect(p).toBe(path.join(os.homedir(), '.airelay', 'sockets', 'test_session_abc1.sock'));
    expect(p).not.toContain('\\');
  });

  it('returns a deterministic unix socket path for same key', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const a = getIpcEndpointPath('mykey');
    const b = getIpcEndpointPath('mykey');
    expect(a).toBe(b);
  });

  it('returns a named pipe path on Windows', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const p = getIpcEndpointPath('test_session_abc1');
    expect(p).toBe('\\\\.\\pipe\\airelay-test_session_abc1');
  });

  it('sanitizes special characters in Windows named pipe path', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const p = getIpcEndpointPath('bad/key$name');
    expect(p).toBe('\\\\.\\pipe\\airelay-bad_key_name');
  });

  it('sanitizes special characters in unix socket path', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const p = getIpcEndpointPath('bad/key$name');
    expect(p).toBe(path.join(os.homedir(), '.airelay', 'sockets', 'bad_key_name.sock'));
  });

  it('guarantees deterministic path from session key', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const keys = ['alpha_1a2b', 'beta_3c4d', 'gamma_5e6f'];
    const paths = keys.map((k) => getIpcEndpointPath(k));
    const pathsAgain = keys.map((k) => getIpcEndpointPath(k));

    for (let i = 0; i < keys.length; i++) {
      expect(paths[i]).toBe(pathsAgain[i]);
    }

    expect(paths[0]).not.toBe(paths[1]);
    expect(paths[1]).not.toBe(paths[2]);
  });
});
