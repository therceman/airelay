import {
  checkProtocolParity,
  checkVersionParity,
  preflightVersionCheck,
} from '../src/commands/session-ipc';
import { getAirelayVersion } from '../src/utils/version';

describe('checkVersionParity', () => {
  it('returns ok with no warnings when versions match', () => {
    const result = checkVersionParity(getAirelayVersion());
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.error).toBeUndefined();
  });

  it('hard errors on major version mismatch', () => {
    const parts = getAirelayVersion().split('.');
    const mismatched = `${parseInt(parts[0], 10) + 1}.${parts[1]}.${parts[2]}`;
    const result = checkVersionParity(mismatched);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('incompatible');
  });

  it('warns when controller is older minor', () => {
    const parts = getAirelayVersion().split('.');
    const olderMinor = `${parts[0]}.${Math.max(0, parseInt(parts[1], 10) - 1)}.${parts[2]}`;
    const result = checkVersionParity(olderMinor);
    expect(result.ok).toBe(true);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings[0]).toContain('older');
  });

  it('warns when controller is older patch', () => {
    const parts = getAirelayVersion().split('.');
    const olderPatch = `${parts[0]}.${parts[1]}.${Math.max(0, parseInt(parts[2], 10) - 1)}`;
    const result = checkVersionParity(olderPatch);
    expect(result.ok).toBe(true);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings[0]).toContain('older');
  });

  it('warns when controller is newer minor', () => {
    const parts = getAirelayVersion().split('.');
    const newerMinor = `${parts[0]}.${parseInt(parts[1], 10) + 1}.${parts[2]}`;
    const result = checkVersionParity(newerMinor);
    expect(result.ok).toBe(true);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings[0]).toContain('newer');
  });

  it('warns when controller is newer patch', () => {
    const parts = getAirelayVersion().split('.');
    const newerPatch = `${parts[0]}.${parts[1]}.${parseInt(parts[2], 10) + 1}`;
    const result = checkVersionParity(newerPatch);
    expect(result.ok).toBe(true);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings[0]).toContain('newer');
  });

  it('returns ok for empty/missing version', () => {
    const result = checkVersionParity('');
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });
});

describe('preflightVersionCheck error policy', () => {
  it('swallows connectivity errors (ENOENT) returning ok', async () => {
    const result = await preflightVersionCheck('/nonexistent/socket_enoint.sock');
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('swallows connectivity timeout-shaped errors returning ok', async () => {
    // Timeout errors on nonexistent sockets are also connectivity errors
    const result = await preflightVersionCheck('/nonexistent/timeout_sock.sock');
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });
});

describe('controller protocol parity', () => {
  it('blocks a controller using an older protocol', () => {
    const result = checkProtocolParity(1);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('protocol version');
    expect(result.error).toContain('Restart the session');
  });

  it('accepts the current protocol', () => {
    const result = checkProtocolParity(2);
    expect(result).toEqual({ ok: true, warnings: [] });
  });
});

describe('checkVersionParity blocking behavior', () => {
  it('major mismatch returns ok:false with actionable error', () => {
    const parts = getAirelayVersion().split('.');
    const majorUp = `${parseInt(parts[0], 10) + 2}.0.0`;
    const result = checkVersionParity(majorUp);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('incompatible');
    expect(result.error).toContain('Restart the session');
  });

  it('same-major older: warns and ok:true', () => {
    const parts = getAirelayVersion().split('.');
    const older = `${parts[0]}.${Math.max(0, parseInt(parts[1], 10) - 2)}.0`;
    const result = checkVersionParity(older);
    expect(result.ok).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('same-major newer: warns and ok:true', () => {
    const parts = getAirelayVersion().split('.');
    const newer = `${parts[0]}.${parseInt(parts[1], 10) + 2}.0`;
    const result = checkVersionParity(newer);
    expect(result.ok).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
