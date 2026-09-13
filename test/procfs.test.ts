import { collectProcessTree, parseProcStatus, ProcEntry } from '../src/runtime/procfs';
import { useTestEnv } from './test-utils';

useTestEnv();

describe('Linux process metrics', () => {
  it('parses only PPid and VmRSS from proc status', () => {
    expect(
      parseProcStatus(
        ['Name: node', 'PPid: 41', 'State: S (sleeping)', 'VmRSS: 1234 kB', 'Secret: ignored'].join(
          '\n'
        ),
        42
      )
    ).toEqual({ pid: 42, ppid: 41, rssBytes: 1234 * 1024 });
  });

  it('aggregates a root and descendants without double counting', () => {
    const entries: ProcEntry[] = [
      { pid: 10, ppid: 1, rssBytes: 100 },
      { pid: 11, ppid: 10, rssBytes: 200 },
      { pid: 12, ppid: 11, rssBytes: 300 },
      { pid: 13, ppid: 10, rssBytes: 400 },
      { pid: 99, ppid: 1, rssBytes: 1000 },
    ];

    expect(collectProcessTree(10, entries)).toEqual({
      rootRssBytes: 100,
      treeRssBytes: 1000,
      processCount: 4,
    });
  });

  it('reports unknown aggregate RSS when a descendant raced with proc cleanup', () => {
    expect(
      collectProcessTree(10, [
        { pid: 10, ppid: 1, rssBytes: 100 },
        { pid: 11, ppid: 10, rssBytes: null },
      ])
    ).toEqual({
      rootRssBytes: 100,
      treeRssBytes: null,
      processCount: 2,
    });
  });

  it('returns an empty result when the root process has already exited', () => {
    expect(collectProcessTree(404, [])).toEqual({
      rootRssBytes: null,
      treeRssBytes: null,
      processCount: 0,
    });
  });
});
