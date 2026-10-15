import { runCommand } from '../src/commands/run';
import { createTestConfig, useTestEnv } from './test-utils';

describe('generated session keys', () => {
  const testEnv = useTestEnv();

  beforeAll(() => {
    createTestConfig(testEnv.configPath, {
      test: {
        executable: process.execPath,
        args: ['-e', 'process.exit(0)'],
      },
    });
  });

  it('separates random letters with digits so letter-words cannot form', async () => {
    const randomValues = [0.24, 0.4, 0.01, 0.7, 0.95, 0.2, 0.9];
    const randomSpy = jest.spyOn(Math, 'random');
    randomValues.forEach((value) => randomSpy.mockReturnValueOnce(value));

    let generatedKey = '';
    try {
      await runCommand('test', [], {
        onSessionStart: (info) => {
          generatedKey = info.sessionKey;
        },
      });
    } finally {
      randomSpy.mockRestore();
    }

    expect(generatedKey).toBe('test_g4a7y2x');
    expect(generatedKey.slice('test_'.length)).toMatch(/^[a-z]\d[a-z]\d[a-z]\d[a-z]$/);
  });
});
