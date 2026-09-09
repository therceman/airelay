import {
  waitForInputProbe,
  WAKE_INPUT_PROBE,
  WAKE_INPUT_PROBE_ERASE,
} from '../src/runtime/input-probe';

describe('wake input probe', () => {
  it('writes one probe, waits for visibility, then erases it', async () => {
    const writes: string[] = [];
    let visible = false;

    await waitForInputProbe({
      write: (data) => {
        writes.push(data);
        visible = data === WAKE_INPUT_PROBE;
      },
      readViewport: () => (visible ? [`› ${WAKE_INPUT_PROBE}`] : ['›']),
      timeoutMs: 50,
      eraseTimeoutMs: 50,
      pollIntervalMs: 1,
    });

    expect(writes).toEqual([WAKE_INPUT_PROBE, WAKE_INPUT_PROBE_ERASE]);
  });

  it('does not erase or permit readiness when the probe never appears', async () => {
    const writes: string[] = [];

    await expect(
      waitForInputProbe({
        write: (data) => writes.push(data),
        readViewport: () => ['restoring'],
        timeoutMs: 5,
        eraseTimeoutMs: 5,
        pollIntervalMs: 1,
      })
    ).rejects.toThrow('Input readiness probe timed out');

    expect(writes).toEqual([WAKE_INPUT_PROBE]);
  });
});
