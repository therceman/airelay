jest.mock('../src/commands/run', () => ({ runCommand: jest.fn().mockResolvedValue(0) }));
jest.mock('../src/commands/detached', () => ({
  startDetachedCommand: jest.fn().mockResolvedValue(0),
}));

import { startCommand } from '../src/commands/start';
import { runCommand } from '../src/commands/run';
import { startDetachedCommand } from '../src/commands/detached';

describe('start bypass forwarding', () => {
  const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    exitSpy.mockRestore();
  });

  it('forwards bypass to the foreground runtime', async () => {
    await startCommand('codex', ['resume', 'session-id'], { bypass: true });

    expect(runCommand).toHaveBeenCalledWith(
      'codex',
      ['resume', 'session-id'],
      expect.objectContaining({ usePty: true, bypass: true })
    );
  });

  it('forwards bypass to the detached launcher', async () => {
    await startCommand('devin', [], { bypass: true, detached: true, key: 'worker' });

    expect(startDetachedCommand).toHaveBeenCalledWith(
      'devin',
      [],
      expect.objectContaining({ bypass: true, key: 'worker' })
    );
    expect(runCommand).not.toHaveBeenCalled();
  });
});
