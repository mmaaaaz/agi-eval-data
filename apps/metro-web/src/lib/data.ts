import { useCallback, useEffect, useRef, useState } from "react";
import type { Latest, Row } from "@metro/shared/types";

export type { Row };

const REPO = import.meta.env.VITE_REPO_METRO ?? "mmaaaaz/agi-eval-data";
const BRANCH = "main";
const ARTIFACT = "data/metro.json";
const PRIMARY = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${ARTIFACT}`;
const FALLBACK = `https://cdn.jsdelivr.net/gh/${REPO}@${BRANCH}/${ARTIFACT}`;
const CACHE = "metro-eval-data-v1";

export function ownerName(latest: Latest, email: string): string {
  return latest.owners[email] ?? email;
}

/* ---------- folder taxonomy helpers ---------- */

export function branchOf(row: Row): string {
  return row[8][0] ?? "ours";
}

export function countryOf(row: Row): string {
  // ["ours", "Brazil"] → Brazil ; ["reason_map(...)", "china"] → china
  return row[8][1] ?? "";
}

export function isPdf(row: Row): boolean {
  return row[7] === "o";
}

/** Pretty city label from the filename: "Fortaleza Metro Map.jpg" → "Fortaleza". */
export function cityName(row: Row): string {
  const base = row[1].replace(/\.[a-z0-9]+$/i, "");
  return base
    .replace(/\b(Metro|MetroRail|Metrorail|Railway|Rail|Map|Route|Network|Transit)\b/gi, "")
    .replace(/\b(v1|v2)\b/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function exifOf(l: Latest, id: string): { w: number; h: number } | null {
  const e = l.exif?.[id];
  if (!e || e.length < 2) return null;
  return { w: e[0], h: e[1] };
}

export function orientationOf(w: number, h: number): "landscape" | "portrait" | "square" {
  const r = w / h;
  return r > 1.05 ? "landscape" : r < 0.95 ? "portrait" : "square";
}

/* ---------- cache (stale-while-revalidate) ---------- */

async function withCache<T>(fn: (c: Cache) => Promise<T>): Promise<T | null> {
  try {
    if (!("caches" in globalThis)) return null;
    const c = await caches.open(CACHE);
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

export async function readCached(): Promise<Latest | null> {
  return withCache(async (c) => {
    const hit = await c.match(PRIMARY);
    if (!hit) return null;
    const j = (await hit.json()) as unknown;
    return isValid(j) ? j : null;
  });
}

function putCached(l: Latest): void {
  void withCache((c) => c.put(PRIMARY, new Response(JSON.stringify(l))));
}

/* ---------- network ---------- */

async function fetchWithProgress(url: string, onProgress: (frac: number | null) => void): Promise<Latest> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}`);
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
  progress: number | null;
  loadingFirst: boolean;
  error: string | null;
}

export function useLatest(): LatestState & { refresh: () => void } {
  const [state, setState] = useState<LatestState>({ data: null, progress: null, loadingFirst: true, error: null });
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState((s) => ({ ...s, error: null }));
    try {
      const fresh = await fetchLatest((frac) => setState((s) => (s.data ? s : { ...s, progress: frac })));
      setState((prev) => {
        const same = prev.data && prev.data.meta.scannedAt === fresh.meta.scannedAt;
        return { data: same ? prev.data : fresh, progress: 1, loadingFirst: false, error: null };
      });
      putCached(fresh);
    } catch (e) {
      setState((s) => ({ ...s, loadingFirst: false, error: e instanceof Error ? e.message : "fetch failed" }));
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
    return () => { alive = false; };
  }, [load]);

  return { ...state, refresh: () => void load() };
}

/* ---------- derived selectors ---------- */

export function imageRows(latest: Latest): Row[] {
  return latest.files.filter((r) => r[7] === "i");
}

/** catalog rows: images AND pdfs */
export function catalogRows(latest: Latest): Row[] {
  return latest.files.filter((r) => r[7] === "i" || r[7] === "o");
}

export interface CountryStat {
  name: string;
  branch: string;
  images: number;
  pdfs: number;
  /** file ids, newest first */
  ids: string[];
  sampleId: string;
}

/** Group catalog rows by (branch, country). Countries with no images are skipped. */
export function countriesOf(latest: Latest): CountryStat[] {
  const m = new Map<string, CountryStat>();
  for (const r of catalogRows(latest)) {
    const branch = branchOf(r);
    const country = countryOf(r);
    if (!country) continue;
    const key = `${branch}::${country}`;
    let s = m.get(key);
    if (!s) m.set(key, (s = { name: country, branch, images: 0, pdfs: 0, ids: [], sampleId: "" }));
    if (r[7] === "i") s.images++;
    else s.pdfs++;
    s.ids.push(r[0]);
  }
  for (const s of m.values()) {
    if (s.images === 0 && s.pdfs === 0) continue;
    s.sampleId = s.ids.find((id) => {
      const r = latest.files.find((f) => f[0] === id);
      return r && r[7] === "i";
    }) ?? s.ids[0] ?? "";
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
}
