export type DeliveryState =
  | 'prompt_not_submitted'
  | 'submitted_working'
  | 'transient_capacity'
  | 'terminal_delivery_failure'
  | 'interrupted'
  | 'response_received';

export interface DeliveryStatus {
  deliveryId: string;
  state: DeliveryState;
  acceptedAt: number;
  submitSentAt?: number;
  submitAcknowledgedAt?: number;
  workingAt?: number;
  completedAt?: number;
  submitAttempts: number;
  capacityAttempts: number;
  preview: string[];
}

export interface DeliveryBeginResult {
  status: DeliveryStatus;
  duplicate: boolean;
}

const MAX_RECORDS = 32;
const MAX_PREVIEW_LINES = 8;
const MAX_PREVIEW_BYTES = 2048;

function isTerminalState(state: DeliveryState): boolean {
  return (
    state === 'terminal_delivery_failure' ||
    state === 'interrupted' ||
    state === 'response_received'
  );
}

function cloneStatus(status: DeliveryStatus): DeliveryStatus {
  return { ...status, preview: [...status.preview] };
}

function boundedPreview(lines: string[]): string[] {
  const result: string[] = [];
  let bytes = 0;

  for (const line of lines.slice(-MAX_PREVIEW_LINES).reverse()) {
    const nextBytes = Buffer.byteLength(line, 'utf8') + 1;
    if (bytes + nextBytes > MAX_PREVIEW_BYTES) continue;
    result.unshift(line);
    bytes += nextBytes;
  }

  return result;
}

/** Bounded in-memory delivery state for one running session. */
export class DeliveryTracker {
  private readonly records = new Map<string, DeliveryStatus>();
  private activeDeliveryId: string | null = null;

  begin(deliveryId: string): DeliveryBeginResult {
    const existing = this.records.get(deliveryId);
    if (existing) return { status: cloneStatus(existing), duplicate: true };

    const status: DeliveryStatus = {
      deliveryId,
      state: 'prompt_not_submitted',
      acceptedAt: Date.now(),
      submitAttempts: 0,
      capacityAttempts: 0,
      preview: [],
    };
    this.records.set(deliveryId, status);
    this.activeDeliveryId = deliveryId;
    this.trim();
    return { status: cloneStatus(status), duplicate: false };
  }

  get(deliveryId?: string): DeliveryStatus | undefined {
    const id = deliveryId || this.activeDeliveryId;
    const status = id ? this.records.get(id) : undefined;
    return status ? cloneStatus(status) : undefined;
  }

  markSubmitSent(deliveryId: string): void {
    const status = this.records.get(deliveryId);
    if (!status || isTerminalState(status.state) || status.submitSentAt) return;
    status.submitSentAt = Date.now();
    status.submitAttempts += 1;
  }

  markSubmitRetry(deliveryId: string): void {
    const status = this.records.get(deliveryId);
    if (status && !isTerminalState(status.state)) status.submitAttempts += 1;
  }

  markSubmitAcknowledged(deliveryId: string): void {
    const status = this.records.get(deliveryId);
    if (status && !isTerminalState(status.state)) status.submitAcknowledgedAt ??= Date.now();
  }

  markWorking(deliveryId: string, preview: string[]): void {
    const status = this.records.get(deliveryId);
    if (!status || isTerminalState(status.state)) return;
    status.state = 'submitted_working';
    status.workingAt ??= Date.now();
    status.preview = boundedPreview(preview);
  }

  markCapacity(deliveryId: string, preview: string[]): void {
    const status = this.records.get(deliveryId);
    if (!status || isTerminalState(status.state)) return;
    status.state = 'transient_capacity';
    status.capacityAttempts += 1;
    status.preview = boundedPreview(preview);
  }

  markResponseReceived(deliveryId: string, preview: string[]): void {
    const status = this.records.get(deliveryId);
    if (!status || isTerminalState(status.state)) return;
    status.state = 'response_received';
    status.completedAt ??= Date.now();
    status.preview = boundedPreview(preview);
  }

  markInterrupted(deliveryId: string, preview: string[]): void {
    const status = this.records.get(deliveryId);
    if (!status || isTerminalState(status.state)) return;
    status.state = 'interrupted';
    status.completedAt ??= Date.now();
    status.preview = boundedPreview(preview);
  }

  markFailure(deliveryId: string, preview: string[]): void {
    const status = this.records.get(deliveryId);
    if (!status || isTerminalState(status.state)) return;
    status.state = 'terminal_delivery_failure';
    status.preview = boundedPreview(preview);
  }

  updatePreview(deliveryId: string, preview: string[]): void {
    const status = this.records.get(deliveryId);
    if (status) status.preview = boundedPreview(preview);
  }

  private trim(): void {
    while (this.records.size > MAX_RECORDS) {
      const oldest = this.records.keys().next().value as string | undefined;
      if (!oldest) return;
      this.records.delete(oldest);
    }
  }
}
