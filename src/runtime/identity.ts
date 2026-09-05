import { randomUUID } from 'node:crypto';

export type RuntimeState = 'starting' | 'running' | 'hibernating' | 'hibernated' | 'stopping';

export interface RuntimeIdentity {
  runtimeId: string;
  controllerPid: number;
  harnessPid: number | null;
  runtimeState: RuntimeState;
}

export function createRuntimeIdentity(): RuntimeIdentity {
  return {
    runtimeId: randomUUID(),
    controllerPid: process.pid,
    harnessPid: null,
    runtimeState: 'starting',
  };
}
