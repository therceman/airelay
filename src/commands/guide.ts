import os from 'os';
import { detectAvailableHarnesses } from '../utils/detect-harnesses';

function getProfileSetup(harness: string): string {
  const workProfile = `${harness}-work`;
  const personalProfile = `${harness}-personal`;

  return `
For ${harness}:
  airelay create ${workProfile} --executable ${harness}
  airelay create ${personalProfile} --executable ${harness}

  # Authenticate each profile if the runtime requires it:
  airelay start ${workProfile} -- login
  airelay start ${personalProfile} -- login

  # Start a profile:
  airelay start ${workProfile}
  airelay start ${personalProfile}
`;
}

export function guideCommand(): void {
  const availableHarnesses = detectAvailableHarnesses()
    .filter((harness) => harness.available)
    .map((harness) => harness.executable);
  const detected = availableHarnesses.length > 0 ? availableHarnesses.join(', ') : 'none';
  const setup = availableHarnesses.map((harness) => getProfileSetup(harness)).join('\n');

  console.log(`
airelay guide — setup profiles on a new machine

Detected runtimes: ${detected}

1. Install the runtime(s) you want to use.
2. Create two named airelay profiles. Each profile gets its own isolated
   credentials/home when the runtime supports profile isolation.${
     setup ||
     '\n\nNo supported runtime was detected. Install one, then run:\n  airelay create <name> --executable <runtime>\n'
   }
3. Inspect the result:
   airelay list
   airelay which <profile>

Configuration locations:
  ${os.homedir()}/.airelay/config.yaml       profile definitions
  ${os.homedir()}/.airelay/                 profile overlays and session data

Interactive mode:
  airelay                                  choose resume/start from the TUI
  airelay guide                            show this guide again

Useful rules:
  airelay start <profile>                  start a new promptable session
  airelay resume                           resume from launch history
  airelay prompt <session> "text"          send input to an active session
  airelay sessions --active                list currently active sessions
`);
}
