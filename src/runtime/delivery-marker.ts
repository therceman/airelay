export type MarkerObservation = 'editor' | 'committed' | 'absent';

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
 * Classify only the bounded cursor window. A marker above the active editor is
 * committed content; an absent marker is deliberately ambiguous.
 */
export function classifyDeliveryMarker(
  viewport: MarkerViewport,
  marker: string,
  windowRows = 16
): MarkerObservation {
  if (!marker) return 'absent';
  const start = Math.max(0, viewport.cursorRow - windowRows);
  const end = Math.min(viewport.lines.length, viewport.cursorRow + 1);
  let nearestRow = -1;

  for (let row = start; row < end; row += 1) {
    if (viewport.lines[row]?.includes(marker)) nearestRow = row;
  }

  if (nearestRow < 0) return 'absent';

  if (nearestRow === viewport.cursorRow) {
    const line = viewport.lines[nearestRow] || '';
    const markerStart = line.lastIndexOf(marker);
    const markerEnd = markerStart + marker.length;
    if (markerStart < 0 || markerEnd > viewport.cursorColumn) return 'absent';
    if (/\S/.test(line.slice(markerEnd, viewport.cursorColumn))) return 'absent';
    return 'editor';
  }

  // A wrapped editor line can place the suffix one row above the cursor.
  if (
    nearestRow === viewport.cursorRow - 1 &&
    viewport.cursorColumn === 0 &&
    viewport.lines[viewport.cursorRow]?.trim() === ''
  ) {
    const line = viewport.lines[nearestRow] || '';
    const markerIndex = line.lastIndexOf(marker);
    if (markerIndex < 0) return 'absent';
    const markerEnd = markerIndex + marker.length;
    if (line.slice(markerEnd).trim() === '') return 'editor';
  }

  return nearestRow < viewport.cursorRow ? 'committed' : 'absent';
}

/** Conservative per-delivery marker lifecycle. */
export class DeliveryMarkerTracker {
  private observation: MarkerObservation = 'absent';
  private phase: DeliveryMarkerPhase = 'transient_hidden';
  private sawEditor = false;
  private returnedToEditor = false;
  private acknowledged = false;

  reset(): void {
    this.observation = 'absent';
    this.phase = 'transient_hidden';
    this.sawEditor = false;
    this.returnedToEditor = false;
    this.acknowledged = false;
  }

  observe(observation: MarkerObservation): DeliveryMarkerPhase {
    if (this.acknowledged) return 'acknowledged';

    if (observation === 'committed') {
      this.acknowledged = true;
      this.observation = observation;
      this.phase = 'acknowledged';
      return this.phase;
    }

    if (observation === 'editor') {
      if (this.observation === 'absent' && this.sawEditor) {
        this.returnedToEditor = true;
        this.phase = 'pending_returned';
      } else {
        this.phase = 'pending_visible';
      }
      this.sawEditor = true;
    } else if (observation === 'absent' && this.sawEditor) {
      this.phase = 'transient_hidden';
    }

    this.observation = observation;
    return this.phase;
  }

  getPhase(): DeliveryMarkerPhase {
    return this.phase;
  }

  isInEditor(): boolean {
    return !this.acknowledged && this.observation === 'editor';
  }

  isAcknowledged(): boolean {
    return this.acknowledged;
  }

  /** Working-state fallback is unsafe after a redraw-return cycle. */
  canUseWorkingAck(): boolean {
    return (
      this.acknowledged ||
      (this.sawEditor && !this.returnedToEditor && this.observation !== 'editor')
    );
  }
}
