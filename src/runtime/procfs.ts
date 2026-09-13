import fs from 'node:fs';

export interface ProcEntry {
  pid: number;
  ppid: number;
  rssBytes: number | null;
}

export interface ProcessTree {
  rootRssBytes: number | null;
  treeRssBytes: number | null;
  processCount: number;
}

function parseKilobytes(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/^(\d+)\s+kB$/i);
  return match ? Number(match[1]) * 1024 : null;
}

/** Parse only stable fields from Linux /proc/<pid>/status. */
export function parseProcStatus(content: string, pid: number): ProcEntry | null {
  const ppid = content.match(/^PPid:\s+(\d+)\s*$/m);
  const rss = content.match(/^VmRSS:\s+(.+)$/m);
  if (!ppid) return null;

  return {
    pid,
    ppid: Number(ppid[1]),
    rssBytes: parseKilobytes(rss?.[1]?.trim()),
  };
}

export function readProcEntry(pid: number): ProcEntry | null {
  try {
    return parseProcStatus(fs.readFileSync(`/proc/${pid}/status`, 'utf8'), pid);
  } catch {
    // Processes can exit between enumeration and reading /proc.
    return null;
  }
}

export function listProcEntries(): ProcEntry[] {
  if (process.platform !== 'linux') return [];

  let names: string[];
  try {
    names = fs.readdirSync('/proc');
  } catch {
    return [];
  }

  const entries: ProcEntry[] = [];
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    const entry = readProcEntry(Number(name));
    if (entry) entries.push(entry);
  }
  return entries;
}

/** Aggregate one process and every reachable descendant exactly once. */
export function collectProcessTree(
  rootPid: number,
  entries: ProcEntry[] = listProcEntries()
): ProcessTree {
  const byPid = new Map(entries.map((entry) => [entry.pid, entry]));
  const root = byPid.get(rootPid);
  if (!root) {
    return { rootRssBytes: null, treeRssBytes: null, processCount: 0 };
  }

  const children = new Map<number, number[]>();
  for (const entry of entries) {
    const siblings = children.get(entry.ppid) || [];
    siblings.push(entry.pid);
    children.set(entry.ppid, siblings);
  }

  const visited = new Set<number>();
  const queue = [rootPid];
  let treeRssBytes = 0;
  let hasUnknownRss = false;

  while (queue.length > 0) {
    const pid = queue.shift()!;
    if (visited.has(pid)) continue;
    visited.add(pid);

    const entry = byPid.get(pid);
    if (!entry) continue;
    if (entry.rssBytes === null) {
      hasUnknownRss = true;
    } else {
      treeRssBytes += entry.rssBytes;
    }
    queue.push(...(children.get(pid) || []));
  }

  return {
    rootRssBytes: root.rssBytes,
    treeRssBytes: hasUnknownRss ? null : treeRssBytes,
    processCount: visited.size,
  };
}
