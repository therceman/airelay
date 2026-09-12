/** Quiet interval after which a session without PTY activity is idle. */
export const ACTIVITY_QUIET_MS = 5000;

export type ActivityReason = 'prompt_delivery' | 'harness_working' | 'recent_io' | 'idle';

export interface ActivitySnapshot {
  state: 'busy' | 'idle';
  activityReason: ActivityReason;
  lastInputAt: number | null;
  lastOutputAt: number | null;
  lastActivityAt: number | null;
  quietForMs: number | null;
}

export interface ActivitySnapshotOptions {
  promptDeliveryPending?: boolean;
  harnessWorking?: boolean;
  now?: number;
}

/**
 * Owns the single recent-I/O clock used by runtime activity classification.
 * Prompt delivery and harness hints are evaluated separately at snapshot time.
 */
export class ActivityTracker {
  private lastInputAt: number | undefined;
  private lastOutputAt: number | undefined;

  noteInput(now = Date.now()): void {
    this.lastInputAt = now;
  }

  noteOutput(now = Date.now()): void {
    this.lastOutputAt = now;
  }

  getLastInputAt(): number | undefined {
    return this.lastInputAt;
  }

  getLastOutputAt(): number | undefined {
    return this.lastOutputAt;
  }

  getLastActivityAt(): number | undefined {
    if (this.lastInputAt === undefined) return this.lastOutputAt;
    if (this.lastOutputAt === undefined) return this.lastInputAt;
    return Math.max(this.lastInputAt, this.lastOutputAt);
  }

  isRecentlyActive(now = Date.now()): boolean {
    const lastActivityAt = this.getLastActivityAt();
    return lastActivityAt !== undefined && now - lastActivityAt < ACTIVITY_QUIET_MS;
  }

  getQuietForMs(now = Date.now()): number | null {
    const lastActivityAt = this.getLastActivityAt();
    return lastActivityAt === undefined ? null : Math.max(0, now - lastActivityAt);
  }

  snapshot(options: ActivitySnapshotOptions = {}): ActivitySnapshot {
    const now = options.now ?? Date.now();
    const promptDeliveryPending = options.promptDeliveryPending === true;
    const harnessWorking = options.harnessWorking === true;
    const recentIo = this.isRecentlyActive(now);
    const activityReason: ActivityReason = promptDeliveryPending
      ? 'prompt_delivery'
      : harnessWorking
        ? 'harness_working'
        : recentIo
          ? 'recent_io'
          : 'idle';

    return {
      state: activityReason === 'idle' ? 'idle' : 'busy',
      activityReason,
      lastInputAt: this.lastInputAt ?? null,
      lastOutputAt: this.lastOutputAt ?? null,
      lastActivityAt: this.getLastActivityAt() ?? null,
      quietForMs: this.getQuietForMs(now),
    };
  }
}
