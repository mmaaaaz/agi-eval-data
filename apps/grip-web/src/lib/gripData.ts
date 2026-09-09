/**
 * GRIP dataset client — index (tree.json) + per-category detail ({slug}.json.gz).
 *
 * Same stale-while-revalidate CacheStorage pattern as @site/data, but the detail
 * tier is gzip-baked (committed .json.gz) and decompressed with DecompressionStream.
 *
 * Version pinning (anti-staleness): the jsDelivr fallback caches @main for 12h
 * at the edge and 7 days in browsers, so a plain @main fallback can serve a
 * PREVIOUS bake for days (seen live 2026-09-09: mobile users behind CGNAT
 * exhausted raw.githubusercontent's per-IP anonymous limit, 429'd, and silently
 * fell back to stale jsDelivr). Every bake commits version.json {commit,
 * builtAt}; the client probes it fresh (cache-busted) and pins ALL artifact
 * URLs to that commit — jsDelivr @<commit> is immutable, raw gets ?v=<commit> —
 * so a fallback can never disagree with the primary.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CategoryDetail, GripTree } from "./gripTypes";

const DATA_REPO = "mmaaaaz/agi-eval-data";
const VERSION_LS_KEY = "grip-data-version";
const CACHE_KEY = "grip-eval-data-v1";
const LEGACY_MAIN_BASES = [
  (p: string) => `https://raw.githubusercontent.com/${DATA_REPO}/main/data/grip/${p}`,
  (p: string) => `https://cdn.jsdelivr.net/gh/${DATA_REPO}@main/data/grip/${p}`,
];

let versionPromise: Promise<string | null> | null = null;

function readPinnedVersion(): string | null {
  try {
    return window.localStorage.getItem(VERSION_LS_KEY);
  } catch {
    return null;
  }
}

function savePinnedVersion(commit: string): void {
  try {
    window.localStorage.setItem(VERSION_LS_KEY, commit);
  } catch {
    /* private mode etc. — probe still works per-load */
  }
}

/** Fresh (cache-busted) version probe; resolves to a full commit sha. */
async function probeVersion(): Promise<string> {
  const res = await fetch(
    `https://raw.githubusercontent.com/${DATA_REPO}/main/data/grip/version.json?v=${Date.now()}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const v = (await res.json()) as { commit?: unknown };
  if (typeof v.commit !== "string" || v.commit.length < 8) throw new Error("malformed version.json");
  return v.commit;
}

/** The commit all artifact URLs are pinned to (null → legacy @main bases). */
async function pinnedCommit(): Promise<string | null> {
  versionPromise ??= probeVersion()
    .then((c) => {
      savePinnedVersion(c);
      return c;
    })
    .catch(() => readPinnedVersion()); // probe failed → last known good, else null
  return versionPromise;
}

function artifactBases(commit: string | null): ((p: string) => string)[] {
  if (!commit) return LEGACY_MAIN_BASES;
  const qs = `?v=${commit}`;
  return [
    (p: string) => `https://raw.githubusercontent.com/${DATA_REPO}/main/data/grip/${p}${qs}`,
    (p: string) => `https://cdn.jsdelivr.net/gh/${DATA_REPO}@${commit}/data/grip/${p}`,
  ];
}

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

async function fetchJson<T>(bases: ((p: string) => string)[], path: string, validate: (x: unknown) => x is T, onProgress?: (frac: number | null) => void): Promise<T> {
  let lastErr: unknown = null;
  for (const base of bases) {
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

/** Gunzip a Response. Falls back to a blob round-trip where the fetch layer
 *  exposes no stream body (some in-app/automated browsers — they threw
 *  "no body" on the old pipeThrough path even though arrayBuffer works). */
async function gunzipToText(res: Response): Promise<string> {
  if (res.body && "DecompressionStream" in globalThis) {
    return new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).text();
  }
  const buf = await res.arrayBuffer();
  return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
}

async function fetchGzJson<T>(bases: ((p: string) => string)[], path: string, validate: (x: unknown) => x is T): Promise<T> {
  let lastErr: unknown = null;
  for (const base of bases) {
    try {
      const res = await fetch(base(path));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await gunzipToText(res);
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
      const commit = await pinnedCommit();
      const bases = artifactBases(commit);
      const tree = await fetchJson(bases, "tree.json", isValidTree, (frac) =>
        setState((s) => (s.tree ? s : { ...s, progress: frac })));
      setState({ tree, progress: 1, loading: false, error: null });
      // same URL the cache read uses below — the pair must agree on the key
      void putCachedJson(bases[0]("tree.json"), tree);
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : "fetch failed" }));
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void pinnedCommit()
      .then((commit) => (commit ? cachedJson(artifactBases(commit)[0]("tree.json"), isValidTree) : null))
      .then((cached) => {
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
  const p = pinnedCommit()
    .then((commit) => fetchGzJson(artifactBases(commit), `${slug}.json.gz`, isValidDetail))
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
