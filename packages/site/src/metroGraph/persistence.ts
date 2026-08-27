/**
 * Graph draft persistence — localStorage fallback + relay D1 graph_drafts.
 * Load preference: relay GET → localStorage → committed sidecar.
 * Save: always localStorage, optionally POST to relay if relay URL present.
 */
import type { RawGraph } from "./routing";

export const GRAPH_DRAFT_PREFIX = "metro-graph-draft:";

export function graphDraftKey(fileId: string): string {
  return `${GRAPH_DRAFT_PREFIX}${fileId}`;
}

/** Read a draft from localStorage (synchronous). Returns null when missing or malformed. */
export function loadLocalGraphDraft(fileId: string): RawGraph | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(graphDraftKey(fileId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RawGraph;
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as unknown as { stations?: unknown }).stations)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Persist a draft to localStorage and dispatch a window event for listeners (GraphAssist). */
export function saveLocalGraphDraft(fileId: string, graph: RawGraph): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(graphDraftKey(fileId), JSON.stringify(graph));
  try {
    window.dispatchEvent(new CustomEvent("graph-updated", { detail: { fileId, graph } }));
  } catch {
    // ignore
  }
}

export function clearLocalGraphDraft(fileId: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(graphDraftKey(fileId));
}

/** Enumerate localStorage drafts (for debugging / badge counts). */
export function listLocalGraphDrafts(): Array<{ fileId: string; graph: RawGraph }> {
  const out: Array<{ fileId: string; graph: RawGraph }> = [];
  if (typeof localStorage === "undefined") return out;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(GRAPH_DRAFT_PREFIX)) continue;
    const fid = k.slice(GRAPH_DRAFT_PREFIX.length);
    const g = loadLocalGraphDraft(fid);
    if (g) out.push({ fileId: fid, graph: g });
  }
  return out;
}

// -- Relay helpers (thin fetch wrappers, reuse x-questions-code header) --

async function relayCall<T>(relay: string, code: string, path: string, init?: RequestInit): Promise<T> {
  const url = `${relay.replace(/\/+$/, "")}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(code ? { "x-questions-code": code } : {}),
    ...((init?.headers as Record<string, string> | undefined) ?? {}),
  };
  const res = await fetch(url, { ...init, headers });
  const body = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

export async function fetchGraphDraftFromRelay(
  relay: string,
  code: string,
  fileId: string,
): Promise<{ graph: RawGraph | null; updated_at?: string; updated_by?: string }> {
  if (!relay) return { graph: null };
  return relayCall(relay, code, `/api/graphs/${encodeURIComponent(fileId)}`);
}

export async function listGraphDraftsFromRelay(
  relay: string,
  code: string,
): Promise<{ drafts: Array<{ file_id: string; updated_at: string; updated_by: string; stationCount: number; edgeCount: number }> }> {
  if (!relay) return { drafts: [] };
  return relayCall(relay, code, "/api/graphs");
}

export async function putGraphDraftToRelay(
  relay: string,
  code: string,
  fileId: string,
  graph: RawGraph,
): Promise<{ ok: boolean; warnings?: string[] }> {
  if (!relay) throw new Error("relay not configured");
  return relayCall(relay, code, `/api/graphs/${encodeURIComponent(fileId)}`, {
    method: "POST",
    body: JSON.stringify({ graph }),
  });
}

/** Save to localStorage and fire-and-forget to relay (best-effort). Returns relay result when available. */
export async function saveGraphDraft(
  fileId: string,
  graph: RawGraph,
  opts?: { relay?: string; code?: string },
): Promise<{ local: true; relay?: { ok: boolean; warnings?: string[] }; relayError?: string }> {
  saveLocalGraphDraft(fileId, graph);
  if (!opts?.relay) return { local: true };
  try {
    const r = await putGraphDraftToRelay(opts.relay, opts.code ?? "", fileId, graph);
    return { local: true, relay: r };
  } catch (e) {
    return { local: true, relayError: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Load effective graph for a fileId with the documented preference:
 * relay GET → localStorage → committed sidecar (caller supplies committed graph).
 * Returns null when none found.
 */
export async function loadEffectiveGraph(
  fileId: string,
  opts: { relay?: string; code?: string; committed?: RawGraph | null },
): Promise<RawGraph | null> {
  // 1. relay
  if (opts.relay) {
    try {
      const r = await fetchGraphDraftFromRelay(opts.relay, opts.code ?? "", fileId);
      if (r.graph) return r.graph;
    } catch {
      // fall through
    }
  }
  // 2. localStorage
  const local = loadLocalGraphDraft(fileId);
  if (local) return local;
  // 3. committed
  return opts.committed ?? null;
}
