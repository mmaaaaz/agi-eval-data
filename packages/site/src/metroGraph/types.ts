/** Graph-native metro topology — sidecar only, never inline into data/metro.json v4. */

export interface MetroStation {
  id: string;
  name: string;
  /** line ids this station belongs to */
  lines: string[];
  /** normalized 0..1 viewport coordinates (optional — when absent the assist falls back to search) */
  x?: number;
  y?: number;
  /** interchange hint when station is a transfer */
  transfer?: boolean;
}

export interface MetroEdge {
  from: string;
  to: string;
  /** line id that connects from→to */
  line: string;
}

export interface MetroLine {
  id: string;
  name: string;
  color: string;
  /** ordered station ids along this line */
  stations: string[];
}

export interface MetroGraph {
  /** city/file identifier — matches data/metro.json file id or city slug */
  city: string;
  file_id?: string;
  stations: MetroStation[];
  edges: MetroEdge[];
  lines: MetroLine[];
  /** optional bounding box for x/y normalization debug */
  bounds?: { w: number; h: number };
}

/** BFS shortest path (unweighted) — used for transfer/hop counts and path highlight. */
export function bfsShortest(graph: MetroGraph, from: string, to: string): string[] | null {
  if (from === to) return [from];
  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    if (!adj.has(e.to)) adj.set(e.to, []);
    adj.get(e.from)!.push(e.to);
    adj.get(e.to)!.push(e.from);
  }
  const q: string[] = [from];
  const prev = new Map<string, string | null>([[from, null]]);
  const seen = new Set<string>([from]);
  while (q.length) {
    const cur = q.shift()!;
    const neighbors = adj.get(cur) ?? [];
    for (const nb of neighbors) {
      if (seen.has(nb)) continue;
      seen.add(nb);
      prev.set(nb, cur);
      if (nb === to) {
        const path: string[] = [];
        let at: string | null = nb;
        while (at != null) { path.push(at); at = prev.get(at) ?? null; }
        return path.reverse();
      }
      q.push(nb);
    }
  }
  return null;
}

export function graphStationsByName(graph: MetroGraph): Map<string, MetroStation> {
  const m = new Map<string, MetroStation>();
  for (const s of graph.stations) m.set(s.name.toLowerCase(), s);
  return m;
}

export function hopsOf(path: string[] | null): number {
  return path ? Math.max(0, path.length - 1) : 0;
}

export function transfersOf(graph: MetroGraph, path: string[] | null): number {
  if (!path || path.length < 2) return 0;
  const stationLines = new Map<string, string[]>();
  for (const s of graph.stations) stationLines.set(s.id, s.lines);
  const edgeLine = new Map<string, string>();
  for (const e of graph.edges) {
    edgeLine.set(`${e.from}::${e.to}`, e.line);
    edgeLine.set(`${e.to}::${e.from}`, e.line);
  }
  let transfers = 0;
  let curLine: string | null = null;
  for (let i = 0; i < path.length - 1; i++) {
    const line = edgeLine.get(`${path[i]}::${path[i + 1]}`) ?? stationLines.get(path[i])?.[0] ?? null;
    if (curLine != null && line != null && line !== curLine) transfers++;
    if (line) curLine = line;
  }
  return transfers;
}

export const QUESTION_TEMPLATES = {
  S: [
    "How many stations are on the {line} line?",
    "Which line(s) serve station {station}?",
    "How many transfer stations does this network have?",
    "Which station has the most lines intersecting?",
    "List the stations on the {line} line in order.",
  ],
  L: [
    "How many stops (hops) from {from} to {to} via the shortest path?",
    "How many transfers are needed to go from {from} to {to}?",
    "What is the shortest path from {from} to {to} (list stations)?",
    "Which line(s) would you ride from {from} to {to} with the fewest transfers?",
    "Is there a direct (no-transfer) route from {from} to {to}? If not, where is the transfer?",
  ],
} as const;
