import { DeliveryTracker } from '../src/runtime/delivery';

describe('delivery tracker', () => {
  it('deduplicates a repeated delivery id without creating a second record', () => {
    const tracker = new DeliveryTracker();
    const first = tracker.begin('delivery-1');

    tracker.markSubmitSent('delivery-1');
    tracker.markSubmitAcknowledged('delivery-1');
    tracker.markWorking('delivery-1', ['working']);

    const duplicate = tracker.begin('delivery-1');

    expect(first.duplicate).toBe(false);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.status.deliveryId).toBe('delivery-1');
    expect(duplicate.status.state).toBe('submitted_working');
    expect(duplicate.status.submitAttempts).toBe(1);
  });

  it('keeps only bounded session-scoped records and preview data', () => {
    const tracker = new DeliveryTracker();
    const longLine = 'x'.repeat(3000);

    for (let i = 0; i < 40; i += 1) {
      tracker.begin(`delivery-${i}`);
    }
    tracker.updatePreview('delivery-39', [
      longLine,
      ...Array.from({ length: 10 }, (_, i) => `line-${i}`),
    ]);

    expect(tracker.get('delivery-0')).toBeUndefined();
    const status = tracker.get('delivery-39');
    expect(status).toBeDefined();
    expect(status!.preview.length).toBeLessThanOrEqual(8);
    expect(Buffer.byteLength(status!.preview.join('\n'), 'utf8')).toBeLessThanOrEqual(2048);
  });

  it('does not retry or change a confirmed terminal result', () => {
    const tracker = new DeliveryTracker();
    tracker.begin('delivery-1');
    tracker.markSubmitSent('delivery-1');
    tracker.markSubmitAcknowledged('delivery-1');
    tracker.markWorking('delivery-1', ['working']);
    tracker.markResponseReceived('delivery-1', ['done']);

    tracker.markSubmitRetry('delivery-1');
    tracker.markCapacity('delivery-1', ['capacity']);
    tracker.markFailure('delivery-1', ['failure']);

    expect(tracker.get('delivery-1')).toMatchObject({
      state: 'response_received',
      submitAttempts: 1,
      preview: ['done'],
    });
  });
});
