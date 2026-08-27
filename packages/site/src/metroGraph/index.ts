/**
 * Graph sidecar — spec routing + difficulty + UI helpers + cached fetch.
 * Cache key separate from dataset: metro-graph.v1 (mirrors data.ts pattern).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { RawGraph } from "./routing";

// -- Re-exports: routing (spec-canonical) + difficulty + UI overlay + persistence --
// routing is the spec oracle; UI types are available under UIMetro* aliases to avoid name clash.
export * from "./routing";
export * from "./difficulty";
export * from "./persistence";
export { MarkLayer } from "./MarkLayer";
export { AssistPanel } from "./AssistPanel";
export type { MetroStation as UIMetroStation, MetroEdge as UIMetroEdge, MetroLine as UIMetroLine, MetroGraph as UIMetroGraph } from "./types";
export { hopsOf, transfersOf, QUESTION_TEMPLATES, graphStationsByName } from "./types";

// -- Sidecar document shape (matches data/metro-graph.schema.json v1) --
export interface GraphDoc {
  version: number;
  generatedAt: string;
  source: string;
  counts: { graphs: number; stations: number; edges: number };
  graphs: Record<string, RawGraph>;
}

export interface GraphConfig {
  repo: string;
  branch?: string;
  cacheKey?: string;
}

const DEFAULT_CACHE_KEY = "metro-graph.v1";
const GRAPH_ARTIFACT = "metro-graph.json";

function graphUrl(cfg: GraphConfig, artifact = GRAPH_ARTIFACT): string {
  const branch = cfg.branch ?? "main";
  return `https://raw.githubusercontent.com/${cfg.repo}/${branch}/data/${artifact}`;
}

function fallbackUrl(cfg: GraphConfig, artifact = GRAPH_ARTIFACT): string {
  const branch = cfg.branch ?? "main";
  return `https://cdn.jsdelivr.net/gh/${cfg.repo}@${branch}/data/${artifact}`;
}

function isValidGraphDoc(x: unknown): x is GraphDoc {
  if (!x || typeof x !== "object") return false;
  const d = x as Partial<GraphDoc>;
  return d.version === 1 && typeof d.generatedAt === "string" && !!d.graphs && typeof d.counts === "object";
}

async function withGraphCache<T>(cacheKey: string, fn: (c: Cache) => Promise<T>): Promise<T | null> {
  try {
    if (!("caches" in globalThis)) return null;
    const c = await caches.open(cacheKey);
    return await fn(c);
  } catch {
    return null;
  }
}

export function readCachedGraph(cfg: GraphConfig): Promise<GraphDoc | null> {
  const cacheKey = cfg.cacheKey ?? DEFAULT_CACHE_KEY;
  const url = graphUrl(cfg);
  return withGraphCache(cacheKey, async (c) => {
    const hit = await c.match(url);
    if (!hit) return null;
    const j = (await hit.json()) as unknown;
    return isValidGraphDoc(j) ? j : null;
  });
}

function putCachedGraph(cfg: GraphConfig, doc: GraphDoc): void {
  const cacheKey = cfg.cacheKey ?? DEFAULT_CACHE_KEY;
  const url = graphUrl(cfg);
  void withGraphCache(cacheKey, (c) => c.put(url, new Response(JSON.stringify(doc))));
}

async function fetchWithProgress(url: string, onProgress: (frac: number | null) => void): Promise<GraphDoc> {
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
  const parsed = JSON.parse(text) as unknown;
  if (!isValidGraphDoc(parsed)) throw new Error("malformed graph artifact");
  if (parsed.version !== 1) throw new Error(`unsupported graph version ${parsed.version}`);
  return parsed;
}

export async function fetchGraph(cfg: GraphConfig, onProgress: (frac: number | null) => void = () => {}): Promise<GraphDoc> {
  const primary = graphUrl(cfg);
  const fallback = fallbackUrl(cfg);
  try {
    const doc = await fetchWithProgress(primary, onProgress);
    putCachedGraph(cfg, doc);
    return doc;
  } catch (e) {
    console.warn("graph primary failed, trying jsDelivr:", e);
    const doc = await fetchWithProgress(fallback, onProgress);
    putCachedGraph(cfg, doc);
    return doc;
  }
}

export async function fetchGraphFromStatic(
  staticUrl = "/data/metro-graph.json",
  onProgress: (frac: number | null) => void = () => {},
): Promise<GraphDoc> {
  return fetchWithProgress(staticUrl, onProgress);
}

export interface GraphState {
  data: GraphDoc | null;
  progress: number | null;
  loadingFirst: boolean;
  error: string | null;
}

export function useGraph(cfg: GraphConfig): GraphState & { refresh: () => void } {
  const [state, setState] = useState<GraphState>({ data: null, progress: null, loadingFirst: true, error: null });
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState((s) => ({ ...s, error: null }));
    try {
      const fresh = await fetchGraph(cfg, (frac) => setState((s) => (s.data ? s : { ...s, progress: frac })));
      setState((prev) => {
        const same = prev.data && prev.data.generatedAt === fresh.generatedAt;
        return { data: same ? prev.data : fresh, progress: 1, loadingFirst: false, error: null };
      });
    } catch (e) {
      setState((s) => ({ ...s, loadingFirst: false, error: e instanceof Error ? e.message : "fetch failed" }));
    } finally {
      inFlight.current = false;
    }
  }, [cfg.repo, cfg.cacheKey, cfg.branch]);

  useEffect(() => {
    let alive = true;
    void readCachedGraph(cfg).then((cached) => {
      if (!alive || !cached) return;
      setState((s) => ({ ...s, data: cached, loadingFirst: false, progress: 1 }));
    });
    void load();
    return () => {
      alive = false;
    };
  }, [load]);

  return { ...state, refresh: () => void load() };
}
