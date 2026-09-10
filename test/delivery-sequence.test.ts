import { BODY_TO_MARKER_DELAY_MS, writeCommandInput } from '../src/runtime/delivery-sequence';

describe('command input write sequence', () => {
  it('writes exact body, marker and submit as separate ordered operations', async () => {
    const writes: string[] = [];
    const delays: number[] = [];

    await writeCommandInput({
      body: 'exact body  ',
      marker: '[12:03:07]',
      submit: '\r',
      totalDelayMs: 250,
      write: (value) => writes.push(value),
      delay: async (ms) => {
        delays.push(ms);
      },
    });

    expect(writes).toEqual(['exact body  ', ' [12:03:07]', '\r']);
    expect(delays).toEqual([BODY_TO_MARKER_DELAY_MS, 150]);
  });

  it('keeps fast-enter writes separate without waits', async () => {
    const writes: string[] = [];
    const delays: number[] = [];

    await writeCommandInput({
      body: 'fast body',
      marker: '[01:02:03]',
      submit: '\r',
      totalDelayMs: 0,
      write: (value) => writes.push(value),
      delay: async (ms) => {
        delays.push(ms);
      },
    });

    expect(writes).toEqual(['fast body', ' [01:02:03]', '\r']);
    expect(delays).toEqual([]);
  });

  it('does not write a marker when there is no body', async () => {
    const writes: string[] = [];
    await writeCommandInput({
      body: '',
      marker: undefined,
      submit: '\r',
      totalDelayMs: 0,
      write: (value) => writes.push(value),
      delay: async () => undefined,
    });
    expect(writes).toEqual(['\r']);
  });
});
