/**
 * Pure graph routing — BFS / Dijkstra / fewestTransfers for metro sidecar.
 * No deps. Mirrors Pass 2 §2.3 API.
 */

export type StationId = string;

export interface Station {
  id: StationId;
  label: string;
  lines: string[];
  x: number | null;
  y: number | null;
  interchange: boolean;
}

export interface Edge {
  from: StationId;
  to: StationId;
  line: string;
  bidirectional: boolean;
  weight: number;
}

export interface RawGraph {
  fileId: string;
  city: string;
  country: string;
  branch: string;
  stations: Station[];
  edges: Edge[];
  lines: Record<string, { color: string; label: string; stations: string[] }>;
  provenance: { annotatedBy: string; annotatedAt: string; tool: string };
}

export interface AdjEdge {
  to: StationId;
  line: string;
  weight: number;
}

export interface MetroGraph {
  stations: Map<StationId, Station>;
  adj: Map<StationId, AdjEdge[]>;
  raw: RawGraph;
}

export interface RouteResult {
  path: StationId[];
  hops: number;
  transfers: number;
  lines: string[];
  distance: number;
}

export const TRANSFER_LINE = "__transfer__";
export const FEWEST_TRANSFERS_BIG = 1000;

function countTransfers(lines: string[]): number {
  let t = 0;
  let prev: string | null = null;
  for (const line of lines) {
    if (line === TRANSFER_LINE) {
      if (prev !== null) t += 1;
      prev = null;
      continue;
    }
    if (prev !== null && line !== prev) t += 1;
    prev = line;
  }
  return t;
}

function reconstruct(
  prev: Map<StationId, { from: StationId; edge: AdjEdge } | null>,
  to: StationId,
): { path: StationId[]; lines: string[]; distance: number } {
  let cur: StationId | null = to;
  let distance = 0;
  const revPath: StationId[] = [];
  const revLines: string[] = [];
  while (cur !== null) {
    revPath.push(cur);
    const info = prev.get(cur);
    if (info) {
      revLines.push(info.edge.line);
      distance += info.edge.weight;
      cur = info.from;
    } else {
      cur = null;
    }
  }
  revPath.reverse();
  revLines.reverse();
  return { path: revPath, lines: revLines, distance };
}

export function buildAdj(raw: RawGraph): MetroGraph {
  const stations = new Map<StationId, Station>();
  for (const s of raw.stations) stations.set(s.id, s);

  const adj = new Map<StationId, AdjEdge[]>();
  for (const id of stations.keys()) adj.set(id, []);

  function pushEdge(from: StationId, to: StationId, line: string, weight: number): void {
    const list = adj.get(from);
    if (!list) return;
    list.push({ to, line, weight });
  }

  for (const e of raw.edges) {
    pushEdge(e.from, e.to, e.line, e.weight);
    if (e.bidirectional) pushEdge(e.to, e.from, e.line, e.weight);
  }

  const interchanges = raw.stations.filter((s) => s.interchange && s.lines.length > 1);
  const transferPairs = new Set<string>();
  for (const e of raw.edges) {
    if (e.line === TRANSFER_LINE) {
      transferPairs.add(`${e.from}::${e.to}`);
      transferPairs.add(`${e.to}::${e.from}`);
    }
  }
  for (let i = 0; i < interchanges.length; i++) {
    for (let j = i + 1; j < interchanges.length; j++) {
      const a = interchanges[i]!;
      const b = interchanges[j]!;
      const share = a.lines.some((l) => b.lines.includes(l));
      if (!share) continue;
      const key = `${a.id}::${b.id}`;
      if (transferPairs.has(key)) continue;
      pushEdge(a.id, b.id, TRANSFER_LINE, 1);
      pushEdge(b.id, a.id, TRANSFER_LINE, 1);
    }
  }

  return { stations, adj, raw };
}

export function bfsShortest(graph: MetroGraph, from: StationId, to: StationId): RouteResult | null {
  if (!graph.adj.has(from) || !graph.adj.has(to)) return null;
  if (from === to) return { path: [from], hops: 0, transfers: 0, lines: [], distance: 0 };

  const q: StationId[] = [from];
  const visited = new Set<StationId>([from]);
  const prev = new Map<StationId, { from: StationId; edge: AdjEdge } | null>([[from, null]]);
  let head = 0;
  while (head < q.length) {
    const u = q[head++]!;
    const edges = graph.adj.get(u) ?? [];
    for (const e of edges) {
      if (visited.has(e.to)) continue;
      visited.add(e.to);
      prev.set(e.to, { from: u, edge: e });
      if (e.to === to) {
        const rec = reconstruct(prev, to);
        const hops = rec.path.length - 1;
        const transfers = countTransfers(rec.lines);
        return { path: rec.path, hops, transfers, lines: rec.lines, distance: rec.distance };
      }
      q.push(e.to);
    }
  }
  return null;
}

export function dijkstra(
  graph: MetroGraph,
  from: StationId,
  to: StationId,
  weight: (e: AdjEdge) => number = (e) => e.weight,
): RouteResult | null {
  if (!graph.adj.has(from) || !graph.adj.has(to)) return null;
  if (from === to) return { path: [from], hops: 0, transfers: 0, lines: [], distance: 0 };

  const dist = new Map<StationId, number>([[from, 0]]);
  const prev = new Map<StationId, { from: StationId; edge: AdjEdge } | null>([[from, null]]);
  const visited = new Set<StationId>();
  const pq: Array<[number, StationId]> = [[0, from]];

  function popMin(): [number, StationId] | undefined {
    if (pq.length === 0) return undefined;
    let minIdx = 0;
    for (let i = 1; i < pq.length; i++) if (pq[i]![0] < pq[minIdx]![0]) minIdx = i;
    const item = pq[minIdx]!;
    pq.splice(minIdx, 1);
    return item;
  }

  while (pq.length) {
    const cur = popMin();
    if (!cur) break;
    const [d, u] = cur;
    if (visited.has(u)) continue;
    visited.add(u);
    if (u === to) break;
    const best = dist.get(u);
    if (best !== undefined && d > best) continue;
    for (const e of graph.adj.get(u) ?? []) {
      const w = weight(e);
      const nd = d + w;
      const prevDist = dist.get(e.to);
      if (prevDist === undefined || nd < prevDist) {
        dist.set(e.to, nd);
        prev.set(e.to, { from: u, edge: e });
        pq.push([nd, e.to]);
      }
    }
  }

  if (!dist.has(to)) return null;
  const rec = reconstruct(prev, to);
  const hops = rec.path.length - 1;
  const transfers = countTransfers(rec.lines);
  return { path: rec.path, hops, transfers, lines: rec.lines, distance: dist.get(to)! };
}

export function fewestTransfers(graph: MetroGraph, from: StationId, to: StationId): RouteResult | null {
  // With explicit __transfer__ edges, fewestTransfers is Dijkstra where transfer edges cost BIG.
  // For correctness when transfers are implicit (line change), prefer fewestTransfersStateful.
  return dijkstra(graph, from, to, (e) => (e.line === TRANSFER_LINE ? FEWEST_TRANSFERS_BIG + 1 : 1));
}

export function fewestTransfersStateful(graph: MetroGraph, from: StationId, to: StationId): RouteResult | null {
  if (!graph.adj.has(from) || !graph.adj.has(to)) return null;
  if (from === to) return { path: [from], hops: 0, transfers: 0, lines: [], distance: 0 };

  type StateKey = string;
  const startKey: StateKey = `${from}::__start__`;
  const dist = new Map<StateKey, number>([[startKey, 0]]);
  const prev = new Map<StateKey, { prevKey: StateKey; line: string } | null>([[startKey, null]]);
  const stationForKey = new Map<StateKey, StationId>([[startKey, from]]);
  const lineForKey = new Map<StateKey, string>([[startKey, "__start__"]]);
  const visited = new Set<StateKey>();
  const pq: Array<[number, StateKey]> = [[0, startKey]];

  function popMinState(): [number, StateKey] | undefined {
    if (pq.length === 0) return undefined;
    let minIdx = 0;
    for (let i = 1; i < pq.length; i++) if (pq[i]![0] < pq[minIdx]![0]) minIdx = i;
    const item = pq[minIdx]!;
    pq.splice(minIdx, 1);
    return item;
  }

  let bestTargetKey: StateKey | null = null;
  let bestTargetDist = Infinity;

  while (pq.length) {
    const cur = popMinState();
    if (!cur) break;
    const [d, key] = cur;
    if (visited.has(key)) continue;
    visited.add(key);
    if (d > bestTargetDist) break;
    const station = stationForKey.get(key)!;
    const curLine = lineForKey.get(key)!;

    if (station === to && d < bestTargetDist) {
      bestTargetDist = d;
      bestTargetKey = key;
    }

    for (const e of graph.adj.get(station) ?? []) {
      const isTransfer = e.line === TRANSFER_LINE;
      let add = 1;
      if (!isTransfer && curLine !== "__start__" && curLine !== TRANSFER_LINE && e.line !== curLine) {
        add += FEWEST_TRANSFERS_BIG;
      } else if (isTransfer) {
        add += FEWEST_TRANSFERS_BIG;
      }
      const nextLine = isTransfer ? TRANSFER_LINE : e.line;
      const nextKey: StateKey = `${e.to}::${nextLine}`;
      const nd = d + add;
      const prevDist = dist.get(nextKey);
      if (prevDist === undefined || nd < prevDist) {
        dist.set(nextKey, nd);
        prev.set(nextKey, { prevKey: key, line: e.line });
        stationForKey.set(nextKey, e.to);
        lineForKey.set(nextKey, nextLine);
        pq.push([nd, nextKey]);
      }
    }
  }

  if (bestTargetKey === null) return null;

  const revStations: StationId[] = [];
  let k: StateKey | null = bestTargetKey;
  while (k !== null) {
    revStations.push(stationForKey.get(k)!);
    const info = prev.get(k);
    k = info ? info.prevKey : null;
  }
  revStations.reverse();
  const path = revStations;
  const lines: string[] = [];
  let distance = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const u = path[i]!;
    const v = path[i + 1]!;
    const edge = (graph.adj.get(u) ?? []).find((e) => e.to === v);
    if (edge) {
      lines.push(edge.line);
      distance += edge.weight;
    }
  }
  const hops = path.length - 1;
  const transfers = countTransfers(lines);
  return { path, hops, transfers, lines, distance };
}

export function reachableWithin(graph: MetroGraph, from: StationId, k: number): Set<StationId> {
  const result = new Set<StationId>();
  if (!graph.adj.has(from) || k < 0) return result;
  const q: Array<[StationId, number]> = [[from, 0]];
  const visited = new Map<StationId, number>([[from, 0]]);
  result.add(from);
  let head = 0;
  while (head < q.length) {
    const [u, d] = q[head++]!;
    if (d >= k) continue;
    for (const e of graph.adj.get(u) ?? []) {
      const nd = d + 1;
      const prior = visited.get(e.to);
      if (prior !== undefined && prior <= nd) continue;
      visited.set(e.to, nd);
      result.add(e.to);
      q.push([e.to, nd]);
    }
  }
  return result;
}

const allPairsCache = new WeakMap<MetroGraph, Map<string, RouteResult>>();

export function allPairs(graph: MetroGraph): Map<string, RouteResult> {
  const cached = allPairsCache.get(graph);
  if (cached) return cached;
  const m = new Map<string, RouteResult>();
  const ids = [...graph.stations.keys()];
  for (const a of ids) {
    for (const b of ids) {
      if (a === b) {
        m.set(`${a}::${b}`, { path: [a], hops: 0, transfers: 0, lines: [], distance: 0 });
      } else {
        const r = bfsShortest(graph, a, b);
        if (r) m.set(`${a}::${b}`, r);
      }
    }
  }
  allPairsCache.set(graph, m);
  return m;
}
