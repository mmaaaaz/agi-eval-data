/**
 * Open-model evaluation artifact client.
 *
 * One JSON file, read in this order:
 *   1. same-origin /data/open-models.json  - baked into THIS deploy, so it can
 *      never disagree with the schema the bundle was compiled against
 *   2. raw.githubusercontent @main         - survives a deploy that predates the
 *      static copy, and picks up a fresh bake without a rebuild
 *   3. jsDelivr                            - CDN fallback for blocked raw access
 *
 * CacheStorage keeps the last good artifact so a reload renders instantly.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Artifact } from "./openModelsTypes";

const DATA_REPO = "mmaaaaz/agi-eval-data";
const PATH = "data/open-models/models.json";
const CACHE_KEY = "open-models-data-v1";
const SCHEMA = 1;

export type Source = "local" | "github" | "jsdelivr" | "cache";

type Candidate = { source: Source; url: string };

function candidates(): Candidate[] {
  const bust = Date.now();
  return [
    { source: "local", url: "/data/open-models.json" },
    { source: "github", url: "https://raw.githubusercontent.com/" + DATA_REPO + "/main/" + PATH + "?v=" + bust },
    { source: "jsdelivr", url: "https://cdn.jsdelivr.net/gh/" + DATA_REPO + "@main/" + PATH },
  ];
}

function isValid(x: unknown): x is Artifact {
  if (!x || typeof x !== "object") return false;
  const a = x as Partial<Artifact>;
  return a.schema === SCHEMA && Array.isArray(a.models) && a.models.length > 0 && Array.isArray(a.domains) && !!a.benchmark;
}

async function readCache(cacheKey: string): Promise<Artifact | null> {
  try {
    if (!("caches" in globalThis)) return null;
    const c = await caches.open(CACHE_KEY);
    const hit = await c.match(cacheKey);
    if (!hit) return null;
    const j = (await hit.json()) as unknown;
    return isValid(j) ? j : null;
  } catch {
    return null;
  }
}

async function writeCache(cacheKey: string, data: Artifact): Promise<void> {
  try {
    if (!("caches" in globalThis)) return;
    const c = await caches.open(CACHE_KEY);
    await c.put(cacheKey, new Response(JSON.stringify(data)));
  } catch {
    /* private mode - the fetch path still works */
  }
}

async function fetchFrom(c: Candidate): Promise<Artifact> {
  const res = await fetch(c.url, c.source === "local" ? undefined : { cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const parsed = (await res.json()) as unknown;
  if (!isValid(parsed)) throw new Error("artifact schema mismatch");
  return parsed;
}

export interface OpenModelsState {
  data: Artifact | null;
  loading: boolean;
  error: string | null;
  source: Source | null;
  refreshedAt: number | null;
  reload: () => void;
}

let memory: Artifact | null = null;
let memorySource: Source | null = null;

export function useOpenModels(): OpenModelsState {
  const [data, setData] = useState<Artifact | null>(memory);
  const [source, setSource] = useState<Source | null>(memorySource);
  const [loading, setLoading] = useState(!memory);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);
  const inFlight = useRef(false);

  const reload = useCallback(() => {
    memory = null;
    setData(null);
    setLoading(true);
    setError(null);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let alive = true;
    if (memory) {
      setData(memory);
      setSource(memorySource);
      setLoading(false);
      return;
    }
    void (async () => {
      const cached = await readCache("open-models");
      if (alive && cached) {
        setData(cached);
        setSource("cache");
        setLoading(false);
      }
      if (inFlight.current) return;
      inFlight.current = true;
      let lastErr = "unreachable";
      for (const c of candidates()) {
        try {
          const a = await fetchFrom(c);
          if (!alive) return;
          memory = a;
          memorySource = c.source;
          setData(a);
          setSource(c.source);
          setError(null);
          setLoading(false);
          setRefreshedAt(Date.now());
          void writeCache("open-models", a);
          return;
        } catch (e) {
          lastErr = e instanceof Error ? e.message : String(e);
        }
      }
      if (alive && !cached) {
        setError(lastErr);
        setLoading(false);
      }
    })().finally(() => {
      inFlight.current = false;
    });
    return () => {
      alive = false;
    };
  }, [nonce]);

  return { data, loading, error, source, refreshedAt, reload };
}
