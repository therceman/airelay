import { createPty } from '../src/runtime/pty';
import { useTestEnv } from './test-utils';

useTestEnv();
it.each([undefined, true, false])(
  'keeps partial-env inheritance by default and honors complete-env opt-out (%s)',
  async (inheritEnv) => {
    const previous = process.env.AIRELAY_FOREIGN_FIXTURE;
    process.env.AIRELAY_FOREIGN_FIXTURE = 'dummy-parent-value';
    let output = '';
    try {
      const pty = createPty({
        file: process.execPath,
        args: [
          '-e',
          'process.stdout.write(JSON.stringify({inherited:process.env.AIRELAY_FOREIGN_FIXTURE,explicit:process.env.AIRELAY_EXPLICIT_FIXTURE}))',
        ],
        env: { AIRELAY_EXPLICIT_FIXTURE: 'explicit-value' },
        inheritEnv,
        detached: true,
        onOutput: (chunk) => {
          output += chunk;
        },
      });
      expect(await pty.exitCode).toBe(0);
      expect(JSON.parse(output)).toEqual({
        ...(inheritEnv === false ? {} : { inherited: 'dummy-parent-value' }),
        explicit: 'explicit-value',
      });
    } finally {
      if (previous === undefined) delete process.env.AIRELAY_FOREIGN_FIXTURE;
      else process.env.AIRELAY_FOREIGN_FIXTURE = previous;
    }
  }
);
