import { getTranscriptStats } from '../src/utils/transcript';
import { cleanupEnv, setupEnv, setupTestEnv } from './test-utils';

describe('transcript storage limit', () => {
  const testEnv = setupTestEnv();
  const originalMaxBytes = process.env.AIRELAY_TRANSCRIPT_MAX_BYTES;

  beforeAll(() => {
    setupEnv(testEnv);
    delete process.env.AIRELAY_TRANSCRIPT_MAX_BYTES;
  });

  afterAll(() => {
    if (originalMaxBytes === undefined) {
      delete process.env.AIRELAY_TRANSCRIPT_MAX_BYTES;
    } else {
      process.env.AIRELAY_TRANSCRIPT_MAX_BYTES = originalMaxBytes;
    }
    cleanupEnv(testEnv);
  });

  it('uses a 50 MiB default limit', () => {
    expect(getTranscriptStats('default-limit').maxBytes).toBe(50 * 1024 * 1024);
  });

  it('preserves the environment override', () => {
    process.env.AIRELAY_TRANSCRIPT_MAX_BYTES = '12345';
    expect(getTranscriptStats('custom-limit').maxBytes).toBe(12345);
    delete process.env.AIRELAY_TRANSCRIPT_MAX_BYTES;
  });
});
