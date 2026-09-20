import {
  DEFAULT_INTERRUPT_SEQUENCE,
  applyHarnessBypass,
  detectHarness,
  getHarnessCapabilities,
  getResumeSessionArgs,
  getSessionArgExample,
  getSessionPatterns,
  isWorkspaceTrustPromptVisible,
} from '../src/utils/harness';
import { detectAvailableHarnesses } from '../src/utils/detect-harnesses';

describe('harness metadata', () => {
  it('includes Devin in the supported harness catalog', () => {
    expect(detectAvailableHarnesses().map((harness) => harness.name)).toEqual([
      'opencode',
      'codex',
      'devin',
    ]);
  });

  it('detects Devin and uses --resume for native session restoration', () => {
    expect(detectHarness('devin')).toBe('devin');
    expect(getSessionArgExample('devin')).toBe('--resume session-id');
    expect(getResumeSessionArgs('devin', 'ritzy-whitefish')).toEqual([
      '--resume',
      'ritzy-whitefish',
    ]);
  });

  it('keeps Devin on native shared state with generic PTY capabilities', () => {
    expect(getHarnessCapabilities('devin')).toMatchObject({
      submitMode: 'byte',
      submitValue: '\r',
      submitDelayMs: 0,
      uiWorkingHint: '',
      inputPromptMarker: '❭',
      inputSubmitRetry: {
        retryDelayMs: 2500,
        maxRetries: 3,
        maxWindowMs: 10000,
      },
      interrupt: {
        value: DEFAULT_INTERRUPT_SEQUENCE,
      },
    });
  });

  it('recognizes Devin context footers with K or M token-capacity units', () => {
    const readyPattern = getHarnessCapabilities('devin').readyPattern;
    expect(readyPattern).toBeDefined();
    expect(readyPattern?.test('SWE-1.7 Medium  Context: 11k / 262k tokens (4%)')).toBe(true);
    expect(readyPattern?.test('SWE-1.7 Medium  Context: 11k / 1.0M tokens (1%)')).toBe(true);
  });

  it('maps explicit bypass to each supported harness and replaces Devin permission mode', () => {
    expect(applyHarnessBypass('codex', ['resume', 'session-id'])).toEqual([
      '--dangerously-bypass-approvals-and-sandbox',
      'resume',
      'session-id',
    ]);
    expect(
      applyHarnessBypass('devin', ['--permission-mode', 'smart', '--resume', 'session-id'])
    ).toEqual(['--permission-mode', 'bypass', '--resume', 'session-id']);
    expect(applyHarnessBypass('opencode', [])).toBeUndefined();
  });

  it('accepts only complete trust screens with the affirmative choice selected', () => {
    expect(
      isWorkspaceTrustPromptVisible('codex', [
        'Do you trust the contents of this directory?',
        '› 1. Yes, continue',
        '2. No, quit',
        'Press enter to continue',
      ])
    ).toBe(true);
    expect(
      isWorkspaceTrustPromptVisible('devin', [
        'Do you trust the authors of this directory?',
        '❭ 1 Yes, trust',
        '· 2 No, exit',
        '↓↑ to select · ↵ to choose · esc to quit',
      ])
    ).toBe(true);
    expect(
      isWorkspaceTrustPromptVisible('codex', [
        'Do you trust the contents of this directory?',
        '  1. Yes, continue',
        '› 2. No, quit',
        'Press enter to continue',
      ])
    ).toBe(false);
    expect(isWorkspaceTrustPromptVisible('devin', ['Do you trust this random text?'])).toBe(false);
    expect(
      isWorkspaceTrustPromptVisible('opencode', [
        'Do you trust the contents of this directory?',
        '› 1. Yes, continue',
        '2. No, quit',
        'Press enter to continue',
      ])
    ).toBe(false);
  });

  it('extracts Devin resume IDs from recorded command output', () => {
    const patterns = getSessionPatterns('devin');
    expect('devin --resume ritzy-whitefish'.match(patterns[0].idPattern)?.[1]).toBe(
      'ritzy-whitefish'
    );
    expect('devin -r ritzy-whitefish'.match(patterns[0].idPattern)?.[1]).toBe('ritzy-whitefish');
  });
});
