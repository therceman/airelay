import {
  classifyTerminalQueryReply,
  MAX_TERMINAL_QUERY_PREFIX_LENGTH,
  TerminalQueryExtractor,
  TerminalQueryReplyTracker,
  type TerminalQueryMatch,
} from '../src/runtime/terminal-query';

const QUERIES: readonly string[] = [
  '\x1b[6n',
  '\x1b]10;?\x1b\\',
  '\x1b]11;?\x1b\\',
  '\x1b[?u',
  '\x1b[c',
];

describe('terminal query extractor', () => {
  it('extracts a query from one chunk without forwarding visual bytes', () => {
    const extractor = new TerminalQueryExtractor();
    const matches: TerminalQueryMatch[] = [];

    const nonQuery = extractor.feed(`ABC${QUERIES[2]}DEF`, (query) => matches.push(query));

    expect(nonQuery).toBe('ABCDEF');
    expect(matches).toEqual([{ kind: 'default_background', sequence: QUERIES[2] }]);
  });

  it('recognizes every approved query across every chunk boundary', () => {
    for (const query of QUERIES) {
      for (let split = 1; split < query.length; split += 1) {
        const extractor = new TerminalQueryExtractor();
        const matches: TerminalQueryMatch[] = [];

        expect(extractor.feed(query.slice(0, split), (match) => matches.push(match))).toBe('');
        expect(extractor.getBufferedLength()).toBeLessThanOrEqual(MAX_TERMINAL_QUERY_PREFIX_LENGTH);
        expect(extractor.feed(query.slice(split), (match) => matches.push(match))).toBe('');

        expect(matches).toHaveLength(1);
        expect(matches[0].sequence).toBe(query);
        expect(extractor.getBufferedLength()).toBe(0);
      }
    }
  });

  it('forwards multiple approved queries in source order', () => {
    const extractor = new TerminalQueryExtractor();
    const matches: TerminalQueryMatch[] = [];
    const stream = `${QUERIES[0]}hidden${QUERIES[1]}${QUERIES[2]}tail`;

    expect(extractor.feed(stream, (query) => matches.push(query))).toBe('hiddentail');
    expect(matches.map((match) => match.sequence)).toEqual([QUERIES[0], QUERIES[1], QUERIES[2]]);
  });

  it('does not extract lookalike or visual control sequences', () => {
    const extractor = new TerminalQueryExtractor();
    const matches: TerminalQueryMatch[] = [];
    const stream =
      '\x1b[6A\x1b[5n\x1b]10;hello\x1b\\\x1b]11;rgb:1/2/3\x1b\\' + '\x1b[31m\x1b[2J\x1b[?1049h';

    expect(extractor.feed(stream, (query) => matches.push(query))).toBe(stream);
    expect(matches).toEqual([]);
  });

  it('holds incomplete prefixes and clears them on reset', () => {
    const extractor = new TerminalQueryExtractor();
    const matches: TerminalQueryMatch[] = [];

    for (const prefix of ['\x1b', '\x1b[', '\x1b]11;']) {
      extractor.reset();
      expect(extractor.feed(prefix, (query) => matches.push(query))).toBe('');
      expect(extractor.getBufferedLength()).toBeGreaterThan(0);
      extractor.reset();
      expect(extractor.getBufferedLength()).toBe(0);
    }

    expect(extractor.feed('?\x1b\\', (query) => matches.push(query))).toBe('?\x1b\\');
    expect(matches).toEqual([]);
  });

  it('keeps matcher state bounded for malformed long escapes', () => {
    const extractor = new TerminalQueryExtractor();
    const matches: TerminalQueryMatch[] = [];

    extractor.feed(`\x1b[${'9'.repeat(100_000)}`, (query) => matches.push(query));

    expect(matches).toEqual([]);
    expect(extractor.getBufferedLength()).toBeLessThanOrEqual(MAX_TERMINAL_QUERY_PREFIX_LENGTH);
  });

  it('does not retain a partial prefix across reset', () => {
    const extractor = new TerminalQueryExtractor();
    const matches: TerminalQueryMatch[] = [];

    extractor.feed('\x1b]11;', (query) => matches.push(query));
    extractor.reset();
    extractor.feed('?\x1b\\', (query) => matches.push(query));

    expect(matches).toEqual([]);
    expect(extractor.getBufferedLength()).toBe(0);
  });
});

describe('terminal query reply tracker', () => {
  const foregroundQuery = '\x1b]10;?\x1b\\';
  const foregroundReply = '\x1b]10;rgb:cccc/cccc/cccc\x1b\\';
  const backgroundReply = '\x1b]11;rgb:0c0c/0c0c/0c0c\x1b\\';

  it.each([
    ['cursor_position', '\x1b[12;34R'],
    ['default_foreground', foregroundReply],
    ['default_background', backgroundReply],
    ['keyboard_enhancement', '\x1b[?1u'],
    ['device_attributes', '\x1b[?1;2c'],
  ] as const)('classifies %s replies exactly', (kind, reply) => {
    expect(classifyTerminalQueryReply(reply)).toBe(kind);
  });

  it('allows only a recent reply matching an observed query and consumes it once', () => {
    const now = 1000;
    const tracker = new TerminalQueryReplyTracker(() => now);

    tracker.observeOutput(foregroundQuery.slice(0, 5));
    tracker.observeOutput(foregroundQuery.slice(5));
    expect(tracker.filterInput(foregroundReply)).toBe(foregroundReply);
    expect(tracker.filterInput(foregroundReply)).toBe('');
  });

  it('drops late bootstrap replies and preserves adjacent ordinary input', () => {
    let now = 1000;
    const tracker = new TerminalQueryReplyTracker(() => now);
    tracker.observeOutput(foregroundQuery);
    now += 101;

    expect(tracker.filterInput(`hello${foregroundReply} world`)).toBe('hello world');
  });

  it.each([
    [QUERIES[0], '\x1b[12;34R'],
    [QUERIES[1], foregroundReply],
    [QUERIES[2], backgroundReply],
    [QUERIES[3], '\x1b[?1u'],
    [QUERIES[4], '\x1b[?1;2c'],
  ])('rejects an expired reply for query %j', (query, reply) => {
    let now = 1000;
    const tracker = new TerminalQueryReplyTracker(() => now);
    tracker.observeOutput(query);
    now += 101;

    expect(tracker.filterInput(reply)).toBe('');
  });

  it('does not allow a reply for a different query kind', () => {
    const tracker = new TerminalQueryReplyTracker(() => 1000);
    tracker.observeOutput(foregroundQuery);

    expect(tracker.filterInput(backgroundReply)).toBe('');
    expect(tracker.filterInput(foregroundReply)).toBe(foregroundReply);
  });

  it('expires pending queries after the bounded reply window', () => {
    let now = 1000;
    const tracker = new TerminalQueryReplyTracker(() => now);
    tracker.observeOutput(foregroundQuery);
    now += 99;
    expect(tracker.filterInput(foregroundReply)).toBe(foregroundReply);
    now += 1;
    tracker.observeOutput(foregroundQuery);
    now += 100;
    expect(tracker.filterInput(foregroundReply)).toBe('');
  });

  it('clears partial queries when a PTY generation resets', () => {
    const tracker = new TerminalQueryReplyTracker(() => 1000);
    tracker.observeOutput(foregroundQuery.slice(0, 5));
    tracker.reset();
    tracker.observeOutput(foregroundQuery.slice(5));

    expect(tracker.filterInput(foregroundReply)).toBe('');
  });
});
