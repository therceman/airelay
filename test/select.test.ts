import { buildMainChoices, getLastUsedProfile, setLastUsedProfile } from '../src/commands/select';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

describe('last-used tracking', () => {
  const testDir = path.join(os.tmpdir(), 'airelay-lastused-test-' + process.pid + '-' + Date.now());
  const testLastUsedPath = path.join(testDir, 'last-used');
  const originalEnv = process.env.AIRELAY_LAST_USED;
  const originalCwd = process.cwd();

  beforeAll(() => {
    fs.mkdirSync(testDir, { recursive: true });
    process.env.AIRELAY_LAST_USED = testLastUsedPath;
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true });
    if (originalEnv) {
      process.env.AIRELAY_LAST_USED = originalEnv;
    } else {
      delete process.env.AIRELAY_LAST_USED;
    }
  });

  beforeEach(() => {
    const cwdHash = crypto.createHash('sha256').update(originalCwd).digest('hex').substring(0, 16);
    const testLastUsedFile = path.join(testLastUsedPath, `${cwdHash}.json`);
    if (fs.existsSync(testLastUsedFile)) {
      fs.unlinkSync(testLastUsedFile);
    }
  });

  it('returns null when no last-used file exists', () => {
    expect(getLastUsedProfile()).toBeNull();
  });

  it('saves and retrieves last-used profile', () => {
    setLastUsedProfile('my-profile');
    const profile = getLastUsedProfile();
    expect(profile).toBe('my-profile');
  });

  it('returns null for corrupted file', () => {
    const cwdHash = crypto.createHash('sha256').update(originalCwd).digest('hex').substring(0, 16);
    const testLastUsedFile = path.join(testLastUsedPath, `${cwdHash}.json`);
    fs.writeFileSync(testLastUsedFile, 'invalid json', 'utf-8');
    expect(getLastUsedProfile()).toBeNull();
  });

  it('creates directory if missing', () => {
    const nestedDir = path.join(testDir, 'nested-dir-' + Date.now());
    const nestedPath = path.join(nestedDir, 'last-used');
    const savedEnv = process.env.AIRELAY_LAST_USED;
    process.env.AIRELAY_LAST_USED = nestedPath;

    setLastUsedProfile('test-profile');

    const cwdHash = crypto.createHash('sha256').update(originalCwd).digest('hex').substring(0, 16);
    const nestedFile = path.join(nestedPath, `${cwdHash}.json`);
    expect(fs.existsSync(nestedFile)).toBe(true);

    process.env.AIRELAY_LAST_USED = savedEnv;
    fs.rmSync(nestedDir, { recursive: true });
  });
});

describe('main selector choices', () => {
  it('places profile session history after Resume and before Start/Create', () => {
    expect(buildMainChoices(true)).toEqual([
      { name: 'Resume', message: 'Resume an existing profile session' },
      { name: 'Show', message: 'Show profile session history' },
      { name: 'Start', message: 'Start a new profile session' },
      { name: 'Create', message: 'Create a new profile' },
    ]);
  });

  it('keeps history available when there are no active sessions', () => {
    expect(buildMainChoices(false)).toEqual([
      { name: 'Show', message: 'Show profile session history' },
      { name: 'Start', message: 'Start a new profile session' },
      { name: 'Create', message: 'Create a new profile' },
    ]);
  });
});
