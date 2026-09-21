/**
 * Reanalysis artifact client (data/open-models-reanalysis.json).
 *
 * Same source order as the main report: the copy baked into this deploy first,
 * then raw.githubusercontent, then jsDelivr. Fetched only by the reanalysis
 * page, so the rest of the report never pays for it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Reanalysis } from "./reanalysisTypes";

const DATA_REPO = "mmaaaaz/agi-eval-data";
const PATH = "data/open-models/reanalysis.json";
const LOCAL = "/data/open-models-reanalysis.json";
const CACHE_KEY = "open-models-reanalysis-v1";

type Source = "local" | "github" | "cache";

function isValid(x: unknown): x is Reanalysis {
  if (!x || typeof x !== "object") return false;
  const r = x as Partial<Reanalysis>;
  return !!r.models && !!r.definitions && !!r.level_counts;
}

export interface ReanalysisState {
  data: Reanalysis | null;
  loading: boolean;
  error: string | null;
  source: Source | null;
}

let memory: Reanalysis | null = null;
let memorySource: Source | null = null;

export function useReanalysis(): ReanalysisState {
  const [data, setData] = useState<Reanalysis | null>(memory);
  const [source, setSource] = useState<Source | null>(memorySource);
  const [loading, setLoading] = useState(!memory);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const bust = Date.now();
    const candidates: { url: string; source: Source }[] = [
      { url: LOCAL, source: "local" },
      { url: "https://raw.githubusercontent.com/" + DATA_REPO + "/main/" + PATH + "?v=" + bust, source: "github" },
    ];
    for (const c of candidates) {
      try {
        const res = await fetch(c.url, c.source === "local" ? undefined : { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const parsed = (await res.json()) as unknown;
        if (!isValid(parsed)) throw new Error("malformed artifact");
        memory = parsed;
        memorySource = c.source;
        setData(parsed);
        setSource(c.source);
        setError(null);
        return;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  }, []);

  useEffect(() => {
    let alive = true;
    if (memory) {
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        if ("caches" in globalThis) {
          const c = await caches.open(CACHE_KEY);
          const hit = await c.match("reanalysis");
          if (hit) {
            const j = (await hit.json()) as unknown;
            if (isValid(j) && alive) {
              setData(j);
              setSource("cache");
              setLoading(false);
            }
          }
        }
      } catch {
        /* ignore */
      }
      await load();
      if (!alive) return;
      setLoading(false);
      if (memory && "caches" in globalThis) {
        try {
          const c = await caches.open(CACHE_KEY);
          await c.put("reanalysis", new Response(JSON.stringify(memory)));
        } catch {
          /* private mode */
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  return { data, loading, error, source };
}

const GRAIN_PATH = "data/open-models/grain.json";
const GRAIN_LOCAL = "/data/open-models-grain.json";

async function fetchArtifact<T>(path: string, local: string, validate: (x: unknown) => x is T): Promise<{ data: T; source: string }> {
  const bust = Date.now();
  const urls: { url: string; source: string }[] = [
    { url: local, source: "local" },
    { url: `https://raw.githubusercontent.com/${DATA_REPO}/main/${path}?v=${bust}`, source: "github" },
  ];
  let lastError = "unreachable";
  for (const c of urls) {
    try {
      const res = await fetch(c.url, c.source === "local" ? undefined : { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const parsed = (await res.json()) as unknown;
      if (!validate(parsed)) throw new Error("malformed artifact");
      return { data: parsed, source: c.source };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(lastError);
}

function isGrain(x: unknown): x is import("./reanalysisTypes").Grain {
  if (!x || typeof x !== "object") return false;
  const g = x as { models?: unknown; what_it_is?: unknown };
  return !!g.models && !!g.what_it_is;
}

let grainMemory: import("./reanalysisTypes").Grain | null = null;

/** Grain-sweep artifact. Fetched only by the grain page. */
export function useGrain(): { data: import("./reanalysisTypes").Grain | null; loading: boolean; error: string | null } {
  const [data, setData] = useState<import("./reanalysisTypes").Grain | null>(grainMemory);
  const [loading, setLoading] = useState(!grainMemory);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (grainMemory) {
      setLoading(false);
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    fetchArtifact(GRAIN_PATH, GRAIN_LOCAL, isGrain)
      .then(({ data: d }) => {
        grainMemory = d;
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        inFlight.current = false;
        setLoading(false);
      });
  }, []);

  return { data, loading, error };
}
