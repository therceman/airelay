import { randomUUID } from 'node:crypto';

export type RuntimeState = 'starting' | 'running' | 'hibernating' | 'hibernated' | 'stopping';

export type RuntimeHealth =
  | 'healthy'
  | 'stale-registry'
  | 'stale-socket'
  | 'inconsistent'
  | 'dead'
  | 'legacy-unknown';

export interface RuntimeIdentity {
  runtimeId: string;
  controllerPid: number;
  harnessPid: number | null;
  runtimeState: RuntimeState;
}

export interface RuntimeMemory {
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
}

export interface RuntimeBuffers {
  attachedClients: number;
  rawRingBytes: number;
  rawRingChunks: number;
  outputBufferLines: number;
  snapshotBufferLines: number;
}

export function createRuntimeIdentity(): RuntimeIdentity {
  return {
    runtimeId: randomUUID(),
    controllerPid: process.pid,
    harnessPid: null,
    runtimeState: 'starting',
  };
}
