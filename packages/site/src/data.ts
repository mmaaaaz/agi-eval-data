import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Shared dataset client for the agi-eval sites.
 *
 * The row shape differs per dataset (apps/web uses 8-tuples from
 * `./lib/types.ts`, apps/metro-web uses 9-tuples incl. a folders column from
 * `@metro/shared/types`). To keep this package free of app-specific types,
 * rows are treated structurally — the selectors here only read positions
 * that are identical across both datasets (day = [4], owner = [5], md5 = [6],
 * kind = [7]) and the `Latest`/`Row` types are declared locally.
 */

export type Kind = "i" | "v" | "o";

/**
 * Row tuple shared by both datasets. The metro dataset appends a 9th `folders`
 * element (folder path from the dataset root); the real-world dataset doesn't.
 * The optional element lets both apps' rows satisfy this type while metro can
 * narrow through it.
 */
export type Row = readonly [
  id: string,
  name: string,
  ext: string,
  size: number,
  day: string,
  who: string,
  md5: string,
  kind: Kind,
  folders?: readonly string[],
];

export interface DupGroup {
  md5: string;
  count: number;
  size: number;
  names: string[];
}

export interface Counts {
  all: number;
  imagesRaw: number;
  imagesUnique: number;
  dupCopies: number;
  videos: number;
  bytes: number;
  [key: string]: number;
}

export interface Latest {
  version: number;
  meta: { scannedAt: string; cron: string; counts: Counts };
  files: Row[];
  owners: Record<string, string>;
  dupGroups: DupGroup[];
  /** fileId → [width, height, cameraIndex?] (cameraIndex absent = unknown) */
  exif?: Record<string, number[]>;
  cams?: string[];
}

export interface DataConfig {
  /** "owner/repo" for the GitHub raw + jsDelivr mirrors */
  repo: string;
  /** path inside the repo's data/ dir, e.g. "latest.json" or "metro.json" */
  artifact: string;
  /** CacheStorage name (per-site) */
  cacheKey: string;
  /** git branch; defaults to "main" */
  branch?: string;
}

export function ownerName(latest: Latest, email: string): string {
  return latest.owners[email] ?? email;
}

/* ---------- exif helpers ---------- */

export interface ExifInfo {
  w: number;
  h: number;
  camera?: string;
}

export function exifOf(l: Latest, id: string): ExifInfo | null {
  const e = l.exif?.[id];
  if (!e || e.length < 2) return null;
  return {
    w: e[0],
    h: e[1],
    camera: e[2] != null && e[2] >= 0 ? l.cams?.[e[2]] : undefined,
  };
}

export type Orientation = "landscape" | "portrait" | "square";

export function orientationOf(w: number, h: number): Orientation {
  const r = w / h;
  if (r > 1.05) return "landscape";
  if (r < 0.95) return "portrait";
  return "square";
}

export function megapixels(w: number, h: number): number {
  return (w * h) / 1_000_000;
}

/* ---------- cache (stale-while-revalidate) ---------- */

async function withCache<T>(cacheKey: string, fn: (c: Cache) => Promise<T>): Promise<T | null> {
  try {
    if (!("caches" in globalThis)) return null;
    const c = await caches.open(cacheKey);
    return await fn(c);
  } catch {
    return null;
  }
}

function isValid(x: unknown): x is Latest {
  if (!x || typeof x !== "object") return false;
  const d = x as Partial<Latest>;
  return Array.isArray(d.files) && !!d.meta?.counts;
}

export function readCached(cfg: DataConfig): Promise<Latest | null> {
  const { repo, artifact, cacheKey, branch = "main" } = cfg;
  const url = `https://raw.githubusercontent.com/${repo}/${branch}/data/${artifact}`;
  return withCache(cacheKey, async (c) => {
    const hit = await c.match(url);
    if (!hit) return null;
    const j = (await hit.json()) as unknown;
    return isValid(j) ? j : null;
  });
}

function putCached(cfg: DataConfig, l: Latest): void {
  const { repo, artifact, cacheKey, branch = "main" } = cfg;
  const url = `https://raw.githubusercontent.com/${repo}/${branch}/data/${artifact}`;
  void withCache(cacheKey, (c) => c.put(url, new Response(JSON.stringify(l))));
}

/* ---------- network ---------- */

async function fetchWithProgress(
  url: string,
  onProgress: (frac: number | null) => void,
): Promise<Latest> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let text: string;
  if (!res.body) {
    text = await res.text();
  } else {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let received = 0;
    const total = Number(res.headers.get("content-length")) || 0;
    const parts: string[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      parts.push(dec.decode(value, { stream: true }));
      onProgress(total ? Math.min(1, received / total) : null);
    }
    parts.push(dec.decode());
    text = parts.join("");
    onProgress(1);
  }
  const parsed = JSON.parse(text) as Latest;
  if (!isValid(parsed)) throw new Error("malformed artifact");
  return parsed;
}

export async function fetchLatest(cfg: DataConfig, onProgress: (frac: number | null) => void): Promise<Latest> {
  const { repo, artifact, branch = "main" } = cfg;
  const primary = `https://raw.githubusercontent.com/${repo}/${branch}/data/${artifact}`;
  const fallback = `https://cdn.jsdelivr.net/gh/${repo}@${branch}/data/${artifact}`;
  try {
    return await fetchWithProgress(primary, onProgress);
  } catch (e) {
    console.warn("primary source failed, trying jsDelivr:", e);
    return fetchWithProgress(fallback, onProgress);
  }
}

/* ---------- hook ---------- */

export interface LatestState {
  data: Latest | null;
  /** first-load progress (0..1); null while indeterminate */
  progress: number | null;
  loadingFirst: boolean;
  error: string | null;
}

export function useLatest(cfg: DataConfig): LatestState & { refresh: () => void } {
  const [state, setState] = useState<LatestState>({ data: null, progress: null, loadingFirst: true, error: null });
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState((s) => ({ ...s, error: null }));
    try {
      const fresh = await fetchLatest(cfg, (frac) => setState((s) => (s.data ? s : { ...s, progress: frac })));
      setState((prev) => {
        const same = prev.data && prev.data.meta.scannedAt === fresh.meta.scannedAt;
        return { data: same ? prev.data : fresh, progress: 1, loadingFirst: false, error: null };
      });
      putCached(cfg, fresh);
    } catch (e) {
      setState((s) => ({ ...s, loadingFirst: false, error: e instanceof Error ? e.message : "fetch failed" }));
    } finally {
      inFlight.current = false;
    }
  }, [cfg.repo, cfg.artifact, cfg.cacheKey, cfg.branch]);

  useEffect(() => {
    let alive = true;
    void readCached(cfg).then((cached) => {
      if (!alive || !cached) return;
      setState((s) => ({ ...s, data: cached, loadingFirst: false, progress: 1 }));
    });
    void load();
    // NOTE: no visibilitychange refetch — the artifact is 12+ MB and parsing
    // it on every tab switch stalled browsers. New-data detection lives in
    // the SyncPill (HEAD poll) whose refresh button reloads the page.
    return () => { alive = false; };
  }, [load]);

  return { ...state, refresh: () => void load() };
}

/* ---------- derived selectors (shared by both apps) ---------- */

export interface OwnerStat {
  email: string;
  raw: number;
  unique: number;
  dupes: number;
  videos: number;
  bytes: number;
  days: Map<string, number>;
  lastDay: string;
  /** file id of their most recent upload — used as avatar */
  lastId: string;
}

export function imageRows(latest: Latest): Row[] {
  return latest.files.filter((r) => r[7] === "i");
}

export function dupCounts(images: Row[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of images) if (r[6]) m.set(r[6], (m.get(r[6]) ?? 0) + 1);
  for (const [k, v] of [...m]) if (v < 2) m.delete(k);
  return m;
}

/** per-owner aggregates; uniqueness computed WITHIN each owner's own files */
export function ownerStats(latest: Latest): OwnerStat[] {
  interface Acc extends OwnerStat {
    seen: Set<string>;
  }
  const map = new Map<string, Acc>();
  for (const r of latest.files) {
    const o =
      map.get(r[5]) ??
      ({
        email: r[5], raw: 0, unique: 0, dupes: 0, videos: 0,
        bytes: 0, days: new Map(), lastDay: "", lastId: "", seen: new Set<string>(),
      } satisfies Acc);
    o.bytes += r[3];
    if (r[4] > o.lastDay) {
      o.lastDay = r[4];
      o.lastId = r[0];
    }
    if (r[7] === "v") o.videos++;
    else if (r[7] === "i") {
      o.raw++;
      if (r[6]) o.seen.add(r[6]);
      o.days.set(r[4], (o.days.get(r[4]) ?? 0) + 1);
    }
    map.set(r[5], o);
  }
  return [...map.values()]
    .map(({ seen, ...o }) => ({ ...o, unique: seen.size, dupes: Math.max(0, o.raw - seen.size) }))
    .sort((a, b) => b.raw - a.raw);
}

/** uploads-per-day buckets, ascending by day */
export function byDay(images: Row[], capDays = 60): [string, number][] {
  const m = new Map<string, number>();
  for (const r of images) if (r[4] !== "?") m.set(r[4], (m.get(r[4]) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-capDays);
}
