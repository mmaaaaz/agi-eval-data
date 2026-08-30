/**
 * GRIP dataset client — index (tree.json) + per-category detail ({slug}.json.gz).
 *
 * Same stale-while-revalidate CacheStorage pattern as @site/data, but the detail
 * tier is gzip-baked (committed .json.gz) and decompressed with DecompressionStream.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CategoryDetail, GripTree } from "./gripTypes";

const ARTIFACT_BASES = [
  (p: string) => `https://raw.githubusercontent.com/mmaaaaz/agi-eval-data/main/data/grip/${p}`,
  (p: string) => `https://cdn.jsdelivr.net/gh/mmaaaaz/agi-eval-data@main/data/grip/${p}`,
];

const CACHE_KEY = "grip-eval-data-v1";

function isValidTree(x: unknown): x is GripTree {
  if (!x || typeof x !== "object") return false;
  const t = x as Partial<GripTree>;
  return Array.isArray(t.categories) && !!t.counts && !!t.levelNames;
}

async function cachedJson<T>(url: string, validate: (x: unknown) => x is T): Promise<T | null> {
  try {
    if (!("caches" in globalThis)) return null;
    const c = await caches.open(CACHE_KEY);
    const hit = await c.match(url);
    if (!hit) return null;
    const j = (await hit.json()) as unknown;
    return validate(j) ? j : null;
  } catch {
    return null;
  }
}

async function putCachedJson(url: string, data: unknown): Promise<void> {
  try {
    if (!("caches" in globalThis)) return;
    const c = await caches.open(CACHE_KEY);
    await c.put(url, new Response(JSON.stringify(data)));
  } catch {
    /* ignore */
  }
}

async function fetchJson<T>(path: string, validate: (x: unknown) => x is T, onProgress?: (frac: number | null) => void): Promise<T> {
  let lastErr: unknown = null;
  for (const base of ARTIFACT_BASES) {
    const url = base(path);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await readWithProgress(res, onProgress);
      const parsed = JSON.parse(text) as unknown;
      if (!validate(parsed)) throw new Error("malformed artifact");
      return parsed;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("all artifact sources failed");
}

async function readWithProgress(res: Response, onProgress?: (frac: number | null) => void): Promise<string> {
  if (!res.body) return res.text();
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let received = 0;
  const parts: string[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    parts.push(dec.decode(value, { stream: true }));
    onProgress?.(total ? Math.min(1, received / total) : null);
  }
  parts.push(dec.decode());
  onProgress?.(1);
  return parts.join("");
}

/** Decompress a gzip Response body with DecompressionStream (all modern browsers). */
async function fetchGzJson<T>(path: string, validate: (x: unknown) => x is T): Promise<T> {
  let lastErr: unknown = null;
  for (const base of ARTIFACT_BASES) {
    try {
      const res = await fetch(base(path));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body) throw new Error("no body");
      const stream = res.body.pipeThrough(new DecompressionStream("gzip"));
      const text = await new Response(stream).text();
      const parsed = JSON.parse(text) as unknown;
      if (!validate(parsed)) throw new Error("malformed artifact");
      return parsed;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("all artifact sources failed");
}

function isValidDetail(x: unknown): x is CategoryDetail {
  if (!x || typeof x !== "object") return false;
  const d = x as Partial<CategoryDetail>;
  return typeof d.slug === "string" && Array.isArray(d.records);
}

/* ---------- tree (always loaded) ---------- */

export interface TreeState {
  tree: GripTree | null;
  progress: number | null;
  loading: boolean;
  error: string | null;
}

export function useGripTree(): TreeState {
  const [state, setState] = useState<TreeState>({ tree: null, progress: null, loading: true, error: null });
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState((s) => ({ ...s, error: null }));
    try {
      const tree = await fetchJson("tree.json", isValidTree, (frac) =>
        setState((s) => (s.tree ? s : { ...s, progress: frac })));
      setState({ tree, progress: 1, loading: false, error: null });
      void putCachedJson(ARTIFACT_BASES[0]("tree.json"), tree);
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : "fetch failed" }));
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void cachedJson("tree.json", isValidTree).then((cached) => {
      if (!alive || !cached) return;
      setState((s) => (s.tree ? s : { ...s, tree: cached, loading: false, progress: 1 }));
    });
    void load();
    return () => { alive = false; };
  }, [load]);

  return state;
}

/* ---------- per-category detail (gz, lazy + cached in memory) ---------- */

const detailMem = new Map<string, CategoryDetail>();
const detailInFlight = new Map<string, Promise<CategoryDetail>>();

export function loadCategoryDetail(slug: string): Promise<CategoryDetail> {
  const hit = detailMem.get(slug);
  if (hit) return Promise.resolve(hit);
  const pending = detailInFlight.get(slug);
  if (pending) return pending;
  const p = fetchGzJson(`${slug}.json.gz`, isValidDetail)
    .then((d) => {
      detailMem.set(slug, d);
      detailInFlight.delete(slug);
      return d;
    })
    .catch((e) => {
      detailInFlight.delete(slug);
      throw e;
    });
  detailInFlight.set(slug, p);
  return p;
}

export function useCategoryDetail(slug: string): { detail: CategoryDetail | null; loading: boolean; error: string | null } {
  const [state, setState] = useState<{ detail: CategoryDetail | null; loading: boolean; error: string | null }>({
    detail: detailMem.get(slug) ?? null,
    loading: !detailMem.has(slug),
    error: null,
  });

  useEffect(() => {
    if (detailMem.has(slug)) {
      setState({ detail: detailMem.get(slug)!, loading: false, error: null });
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    loadCategoryDetail(slug)
      .then((d) => { if (alive) setState({ detail: d, loading: false, error: null }); })
      .catch((e) => { if (alive) setState({ detail: null, loading: false, error: e instanceof Error ? e.message : "fetch failed" }); });
    return () => { alive = false; };
  }, [slug]);

  return state;
}
