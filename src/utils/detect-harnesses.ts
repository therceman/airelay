import { resolveExecutable } from '../runtime/resolveExecutable';

export interface HarnessInfo {
  name: string;
  executable: string;
  description: string;
  available: boolean;
}

const KNOWN_HARNESSES: HarnessInfo[] = [
  {
    name: 'opencode',
    executable: 'opencode',
    description: 'OpenCode AI',
    available: false,
  },
  {
    name: 'codex',
    executable: 'codex',
    description: 'OpenAI Codex',
    available: false,
  },
  {
    name: 'devin',
    executable: 'devin',
    description: 'Devin CLI',
    available: false,
  },
];

export function detectAvailableHarnesses(): HarnessInfo[] {
  return KNOWN_HARNESSES.map((harness) => ({
    ...harness,
    available: resolveExecutable(harness.executable) !== null,
  }));
}

export function getAvailableHarnessNames(): string[] {
  return detectAvailableHarnesses()
    .filter((h) => h.available)
    .map((h) => h.name);
}
