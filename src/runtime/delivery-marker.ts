export type MarkerObservation = 'visible' | 'absent';

export type DeliveryMarkerPhase =
  | 'pending_visible'
  | 'transient_hidden'
  | 'pending_returned'
  | 'acknowledged';

export interface MarkerViewport {
  lines: string[];
  cursorRow: number;
  cursorColumn: number;
}

/** Format the human-facing marker using the local clock of the Airelay host. */
export function formatTerminalMarker(date = new Date()): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `[${hours}:${minutes}:${seconds}]`;
}

/**
 * Report only whether the active delivery marker is rendered in the bounded
 * current terminal window. Marker geometry is intentionally not an ACK signal:
 * multiline editors may render the input suffix above the terminal cursor.
 */
export function classifyDeliveryMarker(
  viewport: MarkerViewport,
  marker: string,
  windowRows = 16
): MarkerObservation {
  if (!marker) return 'absent';
  const start = Math.max(0, viewport.cursorRow - windowRows);
  const end = Math.min(viewport.lines.length, viewport.cursorRow + 1);
  for (let row = start; row < end; row += 1) {
    if (viewport.lines[row]?.includes(marker)) return 'visible';
  }
  return 'absent';
}

/** Detect a harness-provided active-editor prompt marker in the bounded view. */
export function isInputPromptMarkerVisible(
  viewport: MarkerViewport,
  promptMarker: string,
  windowRows = 16
): boolean {
  if (!promptMarker) return false;
  const start = Math.max(0, viewport.cursorRow - windowRows);
  const end = Math.min(viewport.lines.length, viewport.cursorRow + 1);
  for (let row = start; row < end; row += 1) {
    if (viewport.lines[row]?.trimStart().startsWith(promptMarker)) return true;
  }
  return false;
}

/** Conservative per-delivery marker lifecycle. */
export class DeliveryMarkerTracker {
  private observation: MarkerObservation = 'absent';
  private phase: DeliveryMarkerPhase = 'transient_hidden';
  private sawVisible = false;
  private returnedToVisible = false;
  private acknowledged = false;

  reset(): void {
    this.observation = 'absent';
    this.phase = 'transient_hidden';
    this.sawVisible = false;
    this.returnedToVisible = false;
    this.acknowledged = false;
  }

  observe(observation: MarkerObservation): DeliveryMarkerPhase {
    if (this.acknowledged) return 'acknowledged';

    if (observation === 'visible') {
      if (this.observation === 'absent' && this.sawVisible) {
        this.returnedToVisible = true;
        this.phase = 'pending_returned';
      } else {
        this.phase = 'pending_visible';
      }
      this.sawVisible = true;
    } else if (this.sawVisible) {
      this.phase = 'transient_hidden';
    }

    this.observation = observation;
    return this.phase;
  }

  /** Acknowledgement is granted only by a separate positive signal. */
  markAcknowledged(): DeliveryMarkerPhase {
    this.acknowledged = true;
    this.phase = 'acknowledged';
    return this.phase;
  }

  getPhase(): DeliveryMarkerPhase {
    return this.phase;
  }

  isVisible(): boolean {
    return !this.acknowledged && this.observation === 'visible';
  }

  isAcknowledged(): boolean {
    return this.acknowledged;
  }

  /** Working-state fallback is unsafe after a redraw-return cycle. */
  canUseWorkingAck(): boolean {
    return this.sawVisible && !this.returnedToVisible;
  }
}
