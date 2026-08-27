import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AuthorQuestions } from "@site/authoring";
import { buildAdj, fetchGraph, fetchGraphFromStatic, MarkLayer, AssistPanel, GRAPH_DRAFT_PREFIX } from "@site/metroGraph";
import type { MetroGraph, GraphDoc, RawGraph } from "@site/metroGraph";
import type { Row } from "@site/data";

/**
 * Graph-enabled wrapper — code-split behind VITE_ENABLE_MAPS_ASSIST.
 * Fetches the single-file sidecar `data/metro-graph.json` ONCE at mount
 * via cached fetchGraph (Cache API metro-graph.v1) → fallback static.
 * Then selects `graphs[file_id]` per-row via overlayFor(row) — no manual
 * paste required. Manual input remains as optional override/search fallback.
 * AssistPanel is sited next to the sheet and wired to the same graph+selection.
 *
 * Bridge: per-row "Edit graph" CTA links to the dedicated full-screen page
 * at `/graph/$fileId`; a stations/edges badge is shown next to the n/5
 * question count. The sheet refreshes its doc on `graph-updated` events
 * dispatched by the editor after a local + relay save.
 */

interface Props {
  site: Parameters<typeof AuthorQuestions>[0]["site"];
}

function graphCounts(raw: RawGraph | null | undefined): { stations: number; edges: number } | null {
  if (!raw) return null;
  return { stations: raw.stations.length, edges: raw.edges.length };
}

export default function GraphAssist({ site }: Props) {
  const [doc, setDoc] = useState<GraphDoc | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [manualId, setManualId] = useState<string>("");
  const [debouncedManualId, setDebouncedManualId] = useState<string>("");

  // localStorage draft presence per fileId (for badges / empty->annotated hint)
  const [draftIds, setDraftIds] = useState<Set<string>>(new Set());
  const refreshDraftIds = useCallback(() => {
    try {
      if (typeof localStorage === "undefined") { setDraftIds(new Set()); return; }
      const s2 = new Set<string>();
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(GRAPH_DRAFT_PREFIX)) s2.add(k.slice(GRAPH_DRAFT_PREFIX.length));
      }
      setDraftIds(s2);
    } catch { setDraftIds(new Set()); }
  }, []);

  useEffect(() => { refreshDraftIds(); }, [refreshDraftIds]);

  // debounce manual input (350ms) — immediate on Enter
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedManualId(manualId.trim()), 350);
    return () => window.clearTimeout(t);
  }, [manualId]);

  const loadDoc = useCallback(async (signal?: AbortSignal) => {
    try {
      let d: GraphDoc;
      try {
        d = await fetchGraph({ repo: "mmaaaaz/agi-eval-data", branch: "main" });
      } catch {
        if (signal?.aborted) return;
        d = await fetchGraphFromStatic("/data/metro-graph.json");
      }
      if (signal?.aborted) return;
      setDoc(d);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // fetch doc ONCE at mount
  useEffect(() => {
    const ac = new AbortController();
    void loadDoc(ac.signal);
    return () => ac.abort();
  }, [loadDoc]);

  // refresh on graph-updated (editor save) and on window focus (cross-tab relay)
  useEffect(() => {
    const onGraphUpdated = (e: Event) => {
      const ce = e as CustomEvent<{ fileId: string; graph: RawGraph }>;
      const fid = ce.detail?.fileId;
      const g = ce.detail?.graph;
      if (fid && g) {
        setDoc((prev) => {
          if (!prev) return prev;
          return { ...prev, graphs: { ...prev.graphs, [fid]: g } };
        });
      }
      refreshDraftIds();
    };
    const onFocus = () => refreshDraftIds();
    const onStorage = (ev: StorageEvent) => {
      if (ev.key && ev.key.startsWith(GRAPH_DRAFT_PREFIX)) refreshDraftIds();
    };
    window.addEventListener("graph-updated", onGraphUpdated as EventListener);
    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("graph-updated", onGraphUpdated as EventListener);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
    };
  }, [refreshDraftIds]);

  // WeakMap/Map of built graphs per file_id for fast lookup
  const adjCacheRef = useRef<Map<string, MetroGraph>>(new Map());
  const getAdj = useCallback((raw: RawGraph): MetroGraph => {
    const cached = adjCacheRef.current.get(raw.fileId);
    if (cached) return cached;
    const g = buildAdj(raw);
    adjCacheRef.current.set(raw.fileId, g);
    return g;
  }, []);

  // Invalidate cached adj when a draft replaces committed graph
  useEffect(() => {
    const h = (e: Event) => {
      const ce = e as CustomEvent<{ fileId: string }>;
      const fid = ce.detail?.fileId;
      if (fid) adjCacheRef.current.delete(fid);
    };
    window.addEventListener("graph-updated", h as EventListener);
    return () => window.removeEventListener("graph-updated", h as EventListener);
  }, []);

  // selection scoped to the current sheet; reset when switching maps
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const activeFileIdRef = useRef<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  // reset selection when active graph changes (switching maps or manual override)
  useEffect(() => {
    setSelected([]);
  }, [activeFileId, debouncedManualId]);

  const overrideId = debouncedManualId.trim();

  // active graph for AssistPanel (per current sheet + optional manual override)
  const activeRaw: RawGraph | null = useMemo(() => {
    if (!doc) return null;
    if (overrideId && doc.graphs[overrideId]) return doc.graphs[overrideId] as RawGraph;
    if (activeFileId && doc.graphs[activeFileId]) return doc.graphs[activeFileId] as RawGraph;
    return null;
  }, [doc, activeFileId, overrideId]);

  const activeGraph: MetroGraph | null = useMemo(() => {
    if (!activeRaw) return null;
    if (activeRaw.stations.length === 0) return null;
    return getAdj(activeRaw);
  }, [activeRaw, getAdj]);

  const overlayFor = useCallback(
    (row: Row) => {
      const fileId = row[0] as string;
      const kind = row[7] as string;
      if (kind === "o") return null;
      if (activeFileIdRef.current !== fileId) {
        activeFileIdRef.current = fileId;
        queueMicrotask(() => setActiveFileId(fileId));
      }
      const effectiveId = overrideId && doc?.graphs[overrideId] ? overrideId : fileId;
      if (!doc) {
        return (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/60 p-4 text-center font-mono text-[11px] text-[#a1a1a1]">
            loading graph…
          </div>
        );
      }
      if (loadError) {
        return (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/60 p-4 text-center font-mono text-[11px] text-danger">
            graph load failed: {loadError}
          </div>
        );
      }
      const raw = doc.graphs[effectiveId] as RawGraph | undefined;
      const hasDraft = draftIds.has(effectiveId);
      if (!raw || raw.stations.length === 0) {
        // Keep the sheet summary useful — CTA still prominent
        return (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/60 p-4 text-center font-mono text-[11px] leading-relaxed text-[#a1a1a1]">
            empty skeleton — not yet annotated
            <br />
            <span className="text-[10px] text-[#666]">{hasDraft ? "local draft available — open editor to continue" : "open the full editor to annotate"}</span>
          </div>
        );
      }
      const g = getAdj(raw);
      return <MarkLayer graph={g} kind={kind} selected={selected} onSelectedChange={setSelected} />;
    },
    [doc, overrideId, getAdj, selected, loadError, draftIds],
  );

  // wrap AuthorQuestions to inject per-row graph badge next to the n/5 badge
  // We keep AuthorQuestions intact and add Site-ish badge via the overlay header:
  // instead, render a small enhancement alongside — do this via an effect that mirrors counts
  // Minimal intrusive approach: patch nothing inside AuthorQuestions; badges live in our own panel + a small header CTA below.

  const graphBadgeFor = useCallback(
    (row: Row) => {
      const fid = String(row[0] ?? "");
      const raw = doc?.graphs[fid] as RawGraph | undefined;
      if (!raw || raw.stations.length === 0) {
        if (draftIds.has(fid)) {
          return <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1 py-0.5 font-mono text-[8px] leading-none text-amber-400">draft</span>;
        }
        return null;
      }
      return (
        <span className="rounded border border-[#10b981]/30 bg-[#10b981]/10 px-1 py-0.5 font-mono text-[8px] leading-none text-[#10b981]">
          {raw.stations.length}·{raw.edges.length}
        </span>
      );
    },
    [doc, draftIds],
  );

  const siteWithOverlay = useMemo(
    () => ({ ...site, overlayFor, graphBadgeFor }),
    [site, overlayFor, graphBadgeFor],
  );

  const demoCount = useMemo(() => {
    if (!doc) return 0;
    return Object.values(doc.graphs).filter((g) => (g as RawGraph).stations.length > 0).length;
  }, [doc]);

  const activeCounts = graphCounts(activeRaw);
  const activeHasDraft = activeFileId ? draftIds.has(activeFileId) : false;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[#262626] p-3">
        <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[#666]">graph assist (flagged)</p>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <input
            value={manualId}
            onChange={(e) => setManualId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setDebouncedManualId(manualId.trim());
            }}
            placeholder="optional override: graph file id"
            className="w-72 rounded border border-[#262626] bg-[#0a0a0a] px-2 py-1 font-mono text-xs text-white outline-none placeholder:text-[#666]"
          />
          <span className="font-mono text-[10px] text-[#666]">
            {doc
              ? `${doc.counts.stations} stations · ${demoCount} annotated · ${doc.counts.graphs} total`
              : loadError
                ? `load failed`
                : "loading graphs…"}
          </span>
          {activeGraph && activeCounts && (
            <span className="rounded border border-[#10b981]/40 bg-[#10b981]/10 px-1.5 py-0.5 font-mono text-[10px] leading-none text-[#10b981]">
              {activeCounts.stations} stations · {activeCounts.edges} edges
            </span>
          )}
          {!activeGraph && activeHasDraft && activeFileId && (
            <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] leading-none text-amber-400">
              local draft
            </span>
          )}
        </div>
        <p className="font-mono text-[10px] leading-relaxed text-[#666]">
          Pick any map — graph auto-loads via single-file sidecar. Manual input only as override/search fallback.
          The full editor is the real UX — the sheet is just a summary.
        </p>
      </div>

      <AuthorQuestions site={siteWithOverlay} />

      {activeFileId && (
        <div className="rounded-lg border border-[#262626] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-mono text-[11px] leading-none">
              <span className="text-[#666]">graph</span>
              {activeCounts ? (
                <>
                  <span className="rounded border border-[#10b981]/30 px-1.5 py-0.5 tabular-nums text-[#10b981]">{activeCounts.stations} stations</span>
                  <span className="rounded border border-[#262626] px-1.5 py-0.5 tabular-nums text-[#a1a1a1]">{activeCounts.edges} edges</span>
                  {activeGraph ? (
                    <span className="rounded border border-[#262626] px-1.5 py-0.5 tabular-nums text-[#a1a1a1]">{Object.keys(activeGraph.raw.lines).length} lines</span>
                  ) : null}
                </>
              ) : (
                <span className="text-[#666]">empty — not yet annotated</span>
              )}
              {activeHasDraft && <span className="rounded border border-amber-500/30 px-1.5 py-0.5 text-amber-400">local draft</span>}
            </div>
            <Link
              to="/graph/$fileId"
              params={{ fileId: activeFileId }}
              className="inline-flex items-center rounded-md bg-[#10b981] px-3 py-1.5 font-mono text-[11px] font-semibold text-black hover:bg-[#0ea371]"
            >
              Open full editor →
            </Link>
          </div>
        </div>
      )}

      {activeFileId && doc && (
        activeGraph ? (
          <AssistPanel
            graph={activeGraph}
            selected={selected}
            onUseQuestion={({ question, answer, tags }) => {
              window.dispatchEvent(new CustomEvent("metro:use-template", { detail: { question, answer, tags } }));
            }}
          />
        ) : (
          <div className="rounded-lg border border-[#262626] p-3 font-mono text-[11px] leading-relaxed text-[#666]">
            empty skeleton — not yet annotated for this map
            <span className="ml-2 text-[#a1a1a1]">(open the full editor to annotate — zoom/pan the w1600 image, drag station dots, connect edges)</span>
          </div>
        )
      )}
    </div>
  );
}
