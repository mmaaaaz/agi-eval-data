import { useCallback, useEffect, useRef, useState } from "react";
import type { Latest, Row } from "./types";

export type { Row };

const REPO = import.meta.env.VITE_REPO ?? "mmaaaaz/agi-eval-data";
const BRANCH = "main";
const PRIMARY = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/data/latest.json`;
const FALLBACK = `https://cdn.jsdelivr.net/gh/${REPO}@${BRANCH}/data/latest.json`;
const CACHE = "agi-eval-data-v1";

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

async function withCache<T>(fn: (c: Cache) => Promise<T>): Promise<T | null> {
  try {
    if (typeof caches === "undefined") return null;
    return await fn(await caches.open(CACHE));
  } catch {
    return null;
  }
}

function isValid(x: unknown): x is Latest {
  const d = x as Latest;
  return !!d && typeof d === "object" && Array.isArray(d.files) && !!d.meta?.counts;
}

export function readCached(): Promise<Latest | null> {
  return withCache(async (c) => {
    const hit = await c.match(PRIMARY);
    if (!hit) return null;
    const parsed = (await hit.json()) as Latest;
    return isValid(parsed) ? parsed : null;
  });
}

function putCached(l: Latest): void {
  void withCache((c) => c.put(PRIMARY, new Response(JSON.stringify(l))));
}

/* ---------- network ---------- */

async function fetchWithProgress(
  url: string,
  onProgress: (frac: number | null) => void,
): Promise<Latest> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const totalHeader = Number(res.headers.get("content-length"));
  const total = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : null;

  let text: string;
  if (!res.body) {
    text = await res.text();
  } else {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let received = 0;
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

export async function fetchLatest(onProgress: (frac: number | null) => void): Promise<Latest> {
  try {
    return await fetchWithProgress(PRIMARY, onProgress);
  } catch (e) {
    console.warn("primary source failed, trying jsDelivr:", e);
    return fetchWithProgress(FALLBACK, onProgress);
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

export function useLatest(): LatestState & { refresh: () => void } {
  const [state, setState] = useState<LatestState>({
    data: null,
    progress: null,
    loadingFirst: true,
    error: null,
  });
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState((s) => ({ ...s, error: null }));
    try {
      const fresh = await fetchLatest((frac) =>
        setState((s) => (s.data ? s : { ...s, progress: frac })),
      );
      setState((prev) => {
        const same = prev.data && prev.data.meta.scannedAt === fresh.meta.scannedAt;
        return { data: same ? prev.data : fresh, progress: 1, loadingFirst: false, error: null };
      });
      putCached(fresh);
    } catch (e) {
      setState((s) => ({
        ...s,
        loadingFirst: false,
        error: e instanceof Error ? e.message : "fetch failed",
      }));
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void readCached().then((cached) => {
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

/* ---------- derived selectors ---------- */

export interface OwnerStat {
  email: string;
  raw: number;
  unique: number;
  dupes: number;
  videos: number;
  bytes: number;
  others: number;
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
        email: r[5], raw: 0, unique: 0, dupes: 0, videos: 0, others: 0,
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
    } else o.others++;
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
