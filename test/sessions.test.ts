import {
  addSession,
  getSessions,
  deleteSession,
  removeSessionByKey,
  pruneStaleSessions,
} from '../src/commands/sessions';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('sessions', () => {
  const testDir = path.join(os.tmpdir(), 'airelay-sessions-test-' + process.pid + '-' + Date.now());
  const testSessionsPath = path.join(testDir, 'sessions.json');
  const originalEnv = process.env.AIRELAY_SESSIONS;

  beforeAll(() => {
    fs.mkdirSync(testDir, { recursive: true });
    process.env.AIRELAY_SESSIONS = testSessionsPath;
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true });
    if (originalEnv) {
      process.env.AIRELAY_SESSIONS = originalEnv;
    } else {
      delete process.env.AIRELAY_SESSIONS;
    }
  });

  beforeEach(() => {
    if (fs.existsSync(testSessionsPath)) {
      fs.unlinkSync(testSessionsPath);
    }
  });

  it('returns empty array when no sessions exist', () => {
    const sessions = getSessions('test-profile');
    expect(sessions).toEqual([]);
  });

  it('adds a session', () => {
    addSession('test-profile', 'ses_123');
    const sessions = getSessions('test-profile');
    expect(sessions.length).toBe(1);
    expect(sessions[0].id).toBe('ses_123');
    expect(sessions[0].profile).toBe('test-profile');
  });

  it('deletes a session', () => {
    addSession('test-profile', 'ses_123');
    addSession('test-profile', 'ses_456');
    const result = deleteSession('test-profile', 'ses_123');
    expect(result).toBe(true);
    const sessions = getSessions('test-profile');
    expect(sessions.length).toBe(1);
    expect(sessions[0].id).toBe('ses_456');
  });

  it('returns false when deleting non-existent session', () => {
    const result = deleteSession('test-profile', 'nonexistent');
    expect(result).toBe(false);
  });

  it('sorts sessions by lastUsed', () => {
    addSession('test-profile', 'ses_first');
    const sessions1 = getSessions('test-profile');
    jest.setTimeout(100);
    addSession('test-profile', 'ses_second');
    const sessions = getSessions('test-profile');
    if (sessions1[0].lastUsed !== sessions[1].lastUsed) {
      expect(sessions[0].id).toBe('ses_second');
      expect(sessions[1].id).toBe('ses_first');
    } else {
      expect(sessions.length).toBe(2);
    }
  });

  it('limits sessions to 50', () => {
    for (let i = 0; i < 55; i++) {
      addSession('test-profile', `ses_${i}`);
    }
    const sessions = getSessions('test-profile');
    expect(sessions.length).toBe(50);
  });

  it('persists controllerEndpoint when provided', () => {
    addSession('test-profile', 'ses_ctrl_1', undefined, 'ctrl_key', '/tmp/sockets/ctrl_key.sock');
    const sessions = getSessions('test-profile');
    const entry = sessions.find((s) => s.id === 'ses_ctrl_1');
    expect(entry).toBeDefined();
    expect(entry!.controllerEndpoint).toBe('/tmp/sockets/ctrl_key.sock');
  });

  it('removeSessionByKey removes session by key', () => {
    addSession('test-profile', 'ses_key_1', undefined, 'mykey');

    const removed = removeSessionByKey('mykey');
    expect(removed).toBe(true);

    const sessions = getSessions('test-profile');
    expect(sessions.length).toBe(0);
  });

  it('removeSessionByKey returns false for unknown key', () => {
    const removed = removeSessionByKey('nonexistent_key');
    expect(removed).toBe(false);
  });

  it('pruneStaleSessions removes entries with dead PID and unreachable controller', async () => {
    addSession('test-profile', 'ses_stale', undefined, 'stale_key', undefined, 999999999);
    addSession('test-profile', 'ses_live', undefined, 'live_key', undefined, process.pid);

    const pruned = await pruneStaleSessions();

    expect(pruned).toBe(1);
    const sessions = getSessions('test-profile');
    expect(sessions.find((s) => s.id === 'ses_stale')).toBeUndefined();
    expect(sessions.find((s) => s.id === 'ses_live')).toBeDefined();
  });

  it('pruneStaleSessions keeps entries without PID', async () => {
    addSession('test-profile', 'ses_nopid', undefined, 'nopid_key');

    const pruned = await pruneStaleSessions();

    expect(pruned).toBe(0);
    const sessions = getSessions('test-profile');
    expect(sessions.find((s) => s.id === 'ses_nopid')).toBeDefined();
  });

  it('pruneStaleSessions removes stale pending_opencode2_60lc-style entry', async () => {
    addSession(
      'opencode2',
      'pending_opencode2_60lc',
      undefined,
      'pending_opencode2_60lc',
      undefined,
      999999999
    );

    const pruned = await pruneStaleSessions();
    expect(pruned).toBe(1);

    const sessions = getSessions('opencode2');
    expect(sessions.find((s) => s.id === 'pending_opencode2_60lc')).toBeUndefined();
  });

  it('updates controllerEndpoint on existing session', () => {
    addSession('test-profile', 'ses_ctrl_2', undefined, 'ctrl_key2');
    let sessions = getSessions('test-profile');
    expect(sessions.find((s) => s.id === 'ses_ctrl_2')!.controllerEndpoint).toBeUndefined();

    addSession('test-profile', 'ses_ctrl_2', undefined, 'ctrl_key2', '/new/endpoint.sock');
    sessions = getSessions('test-profile');
    expect(sessions.find((s) => s.id === 'ses_ctrl_2')!.controllerEndpoint).toBe(
      '/new/endpoint.sock'
    );
  });

  it('persists profileSessionId when provided', () => {
    addSession(
      'test-profile',
      'ses_prof_ses',
      undefined,
      'prof_key',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'codex_resume_abc123'
    );
    const sessions = getSessions('test-profile');
    const entry = sessions.find((s) => s.id === 'ses_prof_ses');
    expect(entry).toBeDefined();
    expect(entry!.profileSessionId).toBe('codex_resume_abc123');
  });

  it('persists profileArgs when provided', () => {
    addSession(
      'test-profile',
      'ses_prof_args',
      undefined,
      'args_key',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      ['resume', 'abc123']
    );
    const sessions = getSessions('test-profile');
    const entry = sessions.find((s) => s.id === 'ses_prof_args');
    expect(entry).toBeDefined();
    expect(entry!.profileArgs).toEqual(['resume', 'abc123']);
  });

  it('session id is distinct from sessionKey', () => {
    addSession('test-profile', 'runtime_internal_id_xyz', undefined, 'my_user_key');
    const sessions = getSessions('test-profile');
    const entry = sessions.find((s) => s.id === 'runtime_internal_id_xyz');
    expect(entry).toBeDefined();
    expect(entry!.id).toBe('runtime_internal_id_xyz');
    expect(entry!.sessionKey).toBe('my_user_key');
    expect(entry!.id).not.toBe(entry!.sessionKey);
  });
});
