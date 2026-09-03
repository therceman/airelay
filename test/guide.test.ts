import { guideCommand } from '../src/commands/guide';
import os from 'os';

jest.mock('../src/utils/detect-harnesses', () => ({
  detectAvailableHarnesses: jest.fn(() => [
    { name: 'codex', executable: 'codex', description: 'Codex', available: true },
  ]),
}));

describe('guide command', () => {
  const originalLog = console.log;

  beforeEach(() => {
    console.log = jest.fn();
  });

  afterEach(() => {
    console.log = originalLog;
  });

  it('shows copy-paste setup for each detected runtime', () => {
    guideCommand();

    const output = (console.log as jest.Mock).mock.calls[0][0] as string;
    expect(output).toContain('Detected runtimes: codex');
    expect(output).toContain('airelay create codex-work --executable codex');
    expect(output).toContain('airelay create codex-personal --executable codex');
    expect(output).toContain(`${os.homedir()}/.airelay/config.yaml`);
    expect(output).toContain('airelay prompt <session> "text"');
  });
});
