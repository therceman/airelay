import {
  MAX_TERMINAL_QUERY_PREFIX_LENGTH,
  TerminalQueryExtractor,
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
