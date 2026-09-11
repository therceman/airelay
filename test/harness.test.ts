import {
  DEFAULT_INTERRUPT_SEQUENCE,
  detectHarness,
  getHarnessCapabilities,
  getResumeSessionArgs,
  getSessionArgExample,
  getSessionPatterns,
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

  it('extracts Devin resume IDs from recorded command output', () => {
    const patterns = getSessionPatterns('devin');
    expect('devin --resume ritzy-whitefish'.match(patterns[0].idPattern)?.[1]).toBe(
      'ritzy-whitefish'
    );
    expect('devin -r ritzy-whitefish'.match(patterns[0].idPattern)?.[1]).toBe('ritzy-whitefish');
  });
});
