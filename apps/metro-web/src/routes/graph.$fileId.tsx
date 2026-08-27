import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { buildAdj, bfsShortest, fetchGraph, fetchGraphFromStatic, QUESTION_TEMPLATES, putGraphDraftToRelay, fetchGraphDraftFromRelay, type RawGraph, type Station, type Edge } from "@site/metroGraph";
import { useData } from "../lib/dataContext";

export const Route = createFileRoute("/graph/$fileId")({ component: GraphEditor });

const PALETTE = ["#10b981", "#3b82f6", "#ef4444", "#f59e0b", "#a855f7", "#ec4899", "#06b6d4", "#f97316", "#84cc16", "#6366f1"];

function emptyRaw(fileId: string, fallbackCity = "Untitled"): RawGraph {
  return {
    fileId,
    city: fallbackCity,
    country: "",
    branch: "ours",
    stations: [],
    edges: [],
    lines: {},
    provenance: { annotatedBy: "human", annotatedAt: new Date().toISOString().slice(0, 10), tool: "graph.$fileId editor v1" },
  };
}
function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }


function cloneRaw(r: RawGraph): RawGraph {
  return JSON.parse(JSON.stringify(r)) as RawGraph;
}

const GRAPH_DRAFT_PREFIX_LOCAL = "metro-graph-draft:";
function graphDraftKey(fileId: string) { return `${GRAPH_DRAFT_PREFIX_LOCAL}${fileId}`; }

function saveLocalDraft(fileId: string, g: RawGraph) {
  try {
    localStorage.setItem(graphDraftKey(fileId), JSON.stringify(g));
    try { window.dispatchEvent(new CustomEvent("graph-updated", { detail: { fileId, graph: g } })); } catch { /* ignore */ }
  } catch { /* ignore */ }
}
function loadLocalDraft(fileId: string): RawGraph | null {
  try {
    const v = localStorage.getItem(graphDraftKey(fileId));
    if (!v) return null;
    const j = JSON.parse(v) as RawGraph;
    if (j && typeof j.fileId === "string" && Array.isArray(j.stations)) return j;
    return null;
  } catch { return null; }
}

/** Relay settings from /settings (localStorage). */
function relayOpts(): { relay?: string; code?: string } {
  try {
    const raw = localStorage.getItem("metro.settings.v1");
    if (raw) {
      const s = JSON.parse(raw) as { relay?: string; accessCode?: string };
      if (s.relay) return { relay: s.relay, code: s.accessCode ?? "" };
    }
  } catch { /* ignore */ }
  return {};
}

async function putRelay(fileId: string, graph: RawGraph): Promise<{ ok: boolean; warnings?: string[] }> {
  const { relay, code } = relayOpts();
  if (!relay) return { ok: false };
  try {
    return await putGraphDraftToRelay(relay, code ?? "", fileId, graph);
  } catch {
    return { ok: false };
  }
}

async function getRelay(fileId: string): Promise<RawGraph | null> {
  const { relay, code } = relayOpts();
  if (!relay) return null;
  try {
    const r = await fetchGraphDraftFromRelay(relay, code ?? "", fileId);
    return r.graph ?? null;
  } catch {
    return null;
  }
}

function GraphEditor() {
  const { fileId } = Route.useParams();
  const navigate = useNavigate();
  const { data: latest } = useData();

  const row = useMemo(() => latest?.files.find((r) => r[0] === fileId) ?? null, [latest, fileId]);
  const kind: "i" | "o" = (row?.[7] as "i" | "o" | undefined) === "o" ? "o" : "i";
  const imageUrl = kind === "o"
    ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w1600`
    : `https://lh3.googleusercontent.com/d/${fileId}=w1600`;
  const fallbackCity = useMemo(() => {
    const n = row?.[1] ?? "";
    return n ? n.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 48) || fileId.slice(0, 8) : fileId.slice(0, 8);
  }, [row, fileId]);

  const [raw, setRaw] = useState<RawGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [history, setHistory] = useState<RawGraph[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [activeLineId, setActiveLineId] = useState<string | null>(null);
  const [editingStationId, setEditingStationId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // viewport
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const draggingPan = useRef<{ startX: number; startY: number; orig: { x: number; y: number } } | null>(null);
  const draggingStation = useRef<{ id: string } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const didInitPan = useRef(false);

  // Esc to close
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") navigate({ to: "/contribute" });
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [navigate]);

  // Load graph: relay GET → localStorage → committed sidecar
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadErr(null);
    (async () => {
      // 1) relay
      try {
        const relayGraph = await getRelay(fileId);
        if (relayGraph && alive) {
          setRaw(relayGraph);
          if (!relayGraph.lines || Object.keys(relayGraph.lines).length === 0) {
            // keep line selection null
          } else if (!activeLineId) {
            const first = Object.keys(relayGraph.lines)[0];
            setActiveLineId(first);
          }
          setLoading(false);
          return;
        }
      } catch { /* ignore */ }
      // 2) localStorage
      const local = loadLocalDraft(fileId);
      if (local && alive) {
        setRaw(local);
        if (local.lines && Object.keys(local.lines).length && !activeLineId) setActiveLineId(Object.keys(local.lines)[0]!);
        setLoading(false);
        return;
      }
      // 3) committed sidecar
      const cfg = { repo: (import.meta.env.VITE_REPO_METRO as string | undefined) ?? "mmaaaaz/agi-eval-data", branch: (import.meta.env.VITE_BRANCH as string | undefined) ?? "main" } as const;
      try {
        let doc: { graphs: Record<string, RawGraph> } | null = null;
        try { doc = await fetchGraph(cfg as never); } catch { doc = null; }
        if (!doc) doc = await fetchGraphFromStatic("/data/metro-graph.json");
        const g = doc?.graphs?.[fileId] ?? null;
        if (!alive) return;
        if (g) {
          // ensure fileId shape
          const normalized: RawGraph = {
            fileId: (g.fileId as string) ?? fileId,
            city: (g.city as string) ?? fallbackCity,
            country: (g.country as string) ?? "",
            branch: (g.branch as string) ?? "ours",
            stations: (g.stations as Station[]) ?? [],
            edges: (g.edges as Edge[]) ?? [],
            lines: (g.lines as RawGraph["lines"]) ?? {},
            provenance: (g.provenance as RawGraph["provenance"]) ?? { annotatedBy: "seed", annotatedAt: new Date().toISOString().slice(0, 10), tool: "metro_graph_seed.py v1" },
          };
          setRaw(normalized);
          if (normalized.lines && Object.keys(normalized.lines).length) setActiveLineId(Object.keys(normalized.lines)[0]!);
        } else {
          setRaw(emptyRaw(fileId, fallbackCity));
        }
      } catch (e) {
        if (!alive) return;
        setLoadErr(e instanceof Error ? e.message : "failed to load graph");
        setRaw(emptyRaw(fileId, fallbackCity));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  const pushHistory = useCallback((prev: RawGraph) => {
    setHistory((h) => [...h.slice(-19), cloneRaw(prev)]);
  }, []);

  const updateRaw = useCallback((next: RawGraph | ((p: RawGraph) => RawGraph)) => {
    setRaw((prev) => {
      if (!prev) return prev;
      const n = typeof next === "function" ? (next as (p: RawGraph) => RawGraph)(cloneRaw(prev)) : next;
      pushHistory(prev);
      return n;
    });
  }, [pushHistory]);

  const undo = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1]!;
      setRaw(cloneRaw(prev));
      return h.slice(0, -1);
    });
  }, []);

  // derived graph for routing
  const adj = useMemo(() => {
    if (!raw) return null;
    try { return buildAdj(raw); } catch { return null; }
  }, [raw]);

  const pathInfo = useMemo(() => {
    if (!adj || selected.length < 2) return null;
    const a = selected[0]!, b = selected[1]!;
    const r = bfsShortest(adj, a, b);
    if (!r) return { path: null as string[] | null, hops: 0, transfers: 0, lines: [] as string[], distance: 0, found: false as const, a, b };
    return { path: r.path, hops: r.hops, transfers: r.transfers, lines: r.lines, distance: r.distance, found: true as const, a, b };
  }, [adj, selected]);

  const pathSet = useMemo(() => new Set(pathInfo?.path ?? []), [pathInfo]);

  // canvas interactions
  const onWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > 0) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
      setScale((s) => clamp(s * factor, 0.5, 4));
    }
  }, []);

  const onViewportPointerDown = useCallback((e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-station-dot]") || target.closest("[data-no-pan]")) return;
    // left drag pans; middle also
    if (e.button !== 0 && e.button !== 1) return;
    draggingPan.current = { startX: e.clientX, startY: e.clientY, orig: { ...pan } };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [pan]);

  const onViewportPointerMove = useCallback((e: React.PointerEvent) => {
    // station drag
    if (draggingStation.current && raw) {
      const id = draggingStation.current.id;
      const vp = viewportRef.current;
      if (!vp) return;
      const inner = vp.querySelector("[data-canvas-inner]") as HTMLElement | null;
      if (!inner) return;
      const ir = inner.getBoundingClientRect();
      const nx = clamp((e.clientX - ir.left) / ir.width, 0, 1);
      const ny = clamp((e.clientY - ir.top) / ir.height, 0, 1);
      setRaw((prev) => {
        if (!prev) return prev;
        const next = cloneRaw(prev);
        const st = next.stations.find((s) => s.id === id);
        if (st) { st.x = nx; st.y = ny; }
        return next;
      });
      return;
    }
    if (!draggingPan.current) return;
    const dx = e.clientX - draggingPan.current.startX;
    const dy = e.clientY - draggingPan.current.startY;
    setPan({ x: draggingPan.current.orig.x + dx, y: draggingPan.current.orig.y + dy });
  }, [raw]);

  const onViewportPointerUp = useCallback((e: React.PointerEvent) => {
    if (draggingStation.current) {
      draggingStation.current = null;
      // commit history for station move: push snapshot? already live; push a history entry on drag end is done via update pattern — we mutated directly without push.
      // For undo granularity, take a snapshot now.
      setRaw((prev) => {
        if (!prev) return prev;
        // we already pushed? no — push previous history entry first? We skipped push to avoid spam; create one now for the move end by pushing previous cloned state.
        // No-op: keep as is but push history so next change can undo. Instead just return same (history already captured before drag via prior push if any).
        return prev;
      });
    }
    draggingPan.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */}
  }, []);

  const placeStationAt = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-station-dot]") || target.closest("[data-no-pan]") || target.closest("button") || target.closest("a") || target.closest("input") || target.closest("select")) return;
    if (!raw) return;
    const inner = viewportRef.current?.querySelector("[data-canvas-inner]") as HTMLElement | null;
    if (!inner) return;
    const ir = inner.getBoundingClientRect();
    const nx = clamp((e.clientX - ir.left) / ir.width, 0, 1);
    const ny = clamp((e.clientY - ir.top) / ir.height, 0, 1);
    const id = `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const n = raw.stations.length + 1;
    const name = `Station ${n}`;
    const lineForNew = activeLineId && raw.lines[activeLineId] ? activeLineId : null;
    updateRaw((prev) => {
      const next = cloneRaw(prev);
      const st: Station = { id, label: name, lines: lineForNew ? [lineForNew] : [], x: nx, y: ny, interchange: false };
      next.stations.push(st);
      if (lineForNew) {
        const ln = next.lines[lineForNew]!;
        if (!ln.stations.includes(id)) ln.stations.push(id);
      }
      // keep provenance fresh on edit
      next.provenance = { annotatedBy: "human", annotatedAt: new Date().toISOString().slice(0, 10), tool: "graph.$fileId editor v1" };
      return next;
    });
    // auto-select new station for immediate rename
    setEditingStationId(id);
    setEditName(name);
    didInitPan.current = true;
  }, [raw, activeLineId, updateRaw]);

  const selectToggle = useCallback((id: string, e?: React.MouseEvent) => {
    const withShift = !!(e && (e.shiftKey || e.metaKey || e.ctrlKey));
    setSelected((prev) => {
      if (withShift && prev.length === 1 && prev[0] !== id && raw) {
        // Shift+click pair → create edge immediately with active line if possible
        const pair = [prev[0]!, id];
        const lineId = activeLineId && raw.lines[activeLineId] ? activeLineId : Object.keys(raw.lines)[0] ?? null;
        if (lineId) {
          const exists = raw.edges.some((ed) => (ed.from === pair[0] && ed.to === pair[1]) || (ed.from === pair[1] && ed.to === pair[0]));
          if (!exists) {
            updateRaw((p) => {
              const next = cloneRaw(p);
              next.edges.push({ from: pair[0]!, to: pair[1]!, line: lineId, bidirectional: true, weight: 1 });
              // ensure stations know the line
              for (const sid of pair) {
                const st = next.stations.find((s) => s.id === sid);
                if (st && !st.lines.includes(lineId)) st.lines.push(lineId);
                const ln = next.lines[lineId];
                if (ln && !ln.stations.includes(sid)) ln.stations.push(sid);
              }
              return next;
            });
          }
        }
        return pair;
      }
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      const next = [...prev, id].slice(-2);
      return next;
    });
  }, [raw, activeLineId, updateRaw]);

  const addLine = useCallback(() => {
    if (!raw) return;
    updateRaw((prev) => {
      const next = cloneRaw(prev);
      const idx = Object.keys(next.lines).length;
      const id = `ln_${Math.random().toString(36).slice(2, 7)}`;
      const color = PALETTE[idx % PALETTE.length]!;
      next.lines[id] = { color, label: `Line ${idx + 1}`, stations: [] };
      return next;
    });
    // after render, select new line
    setTimeout(() => {
      setRaw((cur) => {
        if (!cur) return cur;
        const ids = Object.keys(cur.lines);
        const last = ids[ids.length - 1];
        if (last) setActiveLineId(last);
        return cur;
      });
    }, 0);
  }, [raw, updateRaw]);

  const removeLine = useCallback((lid: string) => {
    updateRaw((prev) => {
      const next = cloneRaw(prev);
      delete next.lines[lid];
      // strip from stations and drop edges on that line
      for (const s of next.stations) s.lines = s.lines.filter((x) => x !== lid);
      next.edges = next.edges.filter((ed) => ed.line !== lid);
      return next;
    });
    setActiveLineId((cur) => (cur === lid ? null : cur));
  }, [updateRaw]);

  const connectSelected = useCallback(() => {
    if (!raw || selected.length !== 2) return;
    const [a, b] = selected as [string, string];
    const lineId = activeLineId && raw.lines[activeLineId] ? activeLineId : Object.keys(raw.lines)[0] ?? null;
    if (!lineId) return;
    const exists = raw.edges.some((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
    if (exists) return;
    updateRaw((prev) => {
      const next = cloneRaw(prev);
      next.edges.push({ from: a, to: b, line: lineId, bidirectional: true, weight: 1 });
      for (const sid of [a, b]) {
        const st = next.stations.find((s) => s.id === sid);
        if (st && !st.lines.includes(lineId)) st.lines.push(lineId);
        const ln = next.lines[lineId];
        if (ln && !ln.stations.includes(sid)) ln.stations.push(sid);
      }
      return next;
    });
  }, [raw, selected, activeLineId, updateRaw]);

  const deleteEdge = useCallback((from: string, to: string) => {
    updateRaw((prev) => {
      const next = cloneRaw(prev);
      next.edges = next.edges.filter((ed) => !((ed.from === from && ed.to === to) || (ed.from === to && ed.to === from)));
      return next;
    });
  }, [updateRaw]);

  const deleteStation = useCallback((id: string) => {
    updateRaw((prev) => {
      const next = cloneRaw(prev);
      next.stations = next.stations.filter((s) => s.id !== id);
      next.edges = next.edges.filter((ed) => ed.from !== id && ed.to !== id);
      for (const lid of Object.keys(next.lines)) next.lines[lid]!.stations = next.lines[lid]!.stations.filter((x) => x !== id);
      return next;
    });
    setSelected((s) => s.filter((x) => x !== id));
    if (editingStationId === id) setEditingStationId(null);
  }, [updateRaw, editingStationId]);

  const toggleInterchange = useCallback((id: string) => {
    updateRaw((prev) => {
      const next = cloneRaw(prev);
      const st = next.stations.find((s) => s.id === id);
      if (st) st.interchange = !st.interchange;
      return next;
    });
  }, [updateRaw]);

  const save = useCallback(async () => {
    if (!raw) return;
    setSaveState("saving");
    setSaveMsg(null);
    const toSave: RawGraph = { ...cloneRaw(raw), provenance: { annotatedBy: "human", annotatedAt: new Date().toISOString().slice(0, 10), tool: "graph.$fileId editor v1" } };
    saveLocalDraft(fileId, toSave);
    const res = await putRelay(fileId, toSave);
    if (res.ok) {
      setSaveState("saved");
      setSaveMsg(res.warnings?.length ? res.warnings.join("; ") : "saved to relay drafts");
      setTimeout(() => setSaveState("idle"), 2000);
    } else {
      setSaveState("error");
      setSaveMsg("saved locally only — relay unreachable (set the relay URL in /settings); export JSON and PR it to data/metro-graph.json as fallback");
      setTimeout(() => setSaveState("idle"), 6000);
    }
  }, [raw, fileId]);

  const exportJson = useCallback(() => {
    if (!raw) return;
    const blob = new Blob([JSON.stringify(raw, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileId}.graph.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [raw, fileId]);

  const clearSelection = useCallback(() => setSelected([]), []);

  const isEmpty = raw ? raw.stations.length === 0 : false;

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
        <div className="flex flex-col items-center gap-3 font-mono text-xs text-[#a1a1a1]">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-[#262626] border-t-[#10b981]" />
          loading graph…
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-[#ededed]" style={{ fontFamily: "inherit" }}>
      {/* top bar */}
      <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[#262626] bg-black px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <Link to="/contribute" className="inline-flex h-8 shrink-0 items-center rounded-md border border-[#262626] px-2.5 font-mono text-xs text-[#a1a1a1] hover:border-[#404040] hover:text-white">← Contribute</Link>
          <div className="min-w-0">
            <div className="truncate font-mono text-xs font-semibold tracking-wide text-white sm:text-sm">{raw?.city ?? fallbackCity} <span className="font-normal text-[#666]">· {fileId.slice(0, 10)}…</span></div>
            <div className="hidden font-mono text-[10px] text-[#666] sm:block">{raw?.country ? `${raw.country} · ` : ""}{raw?.branch ?? ""} · {kind === "o" ? "PDF thumbnail" : "w1600"} {loadErr ? <span className="text-amber-400">· {loadErr}</span> : null}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2" data-no-pan>
          <span className="hidden font-mono text-[11px] text-[#666] sm:inline">{raw?.stations.length ?? 0} stations · {raw?.edges.length ?? 0} edges · {raw ? Object.keys(raw.lines).length : 0} lines</span>
          <button onClick={clearSelection} disabled={selected.length === 0} className="rounded-md border border-[#262626] px-2.5 py-1.5 font-mono text-[11px] text-[#a1a1a1] hover:border-[#404040] hover:text-white disabled:opacity-40">Clear</button>
          <button onClick={undo} disabled={history.length === 0} className="rounded-md border border-[#262626] px-2.5 py-1.5 font-mono text-[11px] text-[#a1a1a1] hover:border-[#404040] hover:text-white disabled:opacity-40">Undo</button>
          <button onClick={exportJson} className="rounded-md border border-[#262626] px-2.5 py-1.5 font-mono text-[11px] text-[#a1a1a1] hover:border-[#404040] hover:text-white">Export JSON</button>
          <button onClick={save} className={`rounded-md px-3 py-1.5 font-mono text-[11px] font-semibold transition-colors ${saveState === "saved" ? "bg-[#10b981] text-black" : saveState === "saving" ? "bg-[#262626] text-[#a1a1a1]" : saveState === "error" ? "bg-red-500/80 text-white hover:bg-red-500" : "bg-[#10b981] text-black hover:bg-[#0ea371]"}`}>{saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved ✓" : saveState === "error" ? "Save failed ✗" : "Save"}</button>
        </div>
      </div>
      {saveMsg ? <div className="border-b border-[#262626] bg-[#0a0a0a] px-4 py-1.5 font-mono text-[11px] text-[#a1a1a1]">{saveMsg}</div> : null}

      {/* body: canvas 75% + rail 25%; stacks on narrow */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* canvas */}
        <div
          ref={viewportRef}
          className="relative flex min-h-[52vh] flex-1 items-center justify-center overflow-hidden bg-[#0a0a0a] lg:min-h-0 lg:w-[75%]"
          onWheel={onWheel}
          onPointerDown={onViewportPointerDown}
          onPointerMove={onViewportPointerMove}
          onPointerUp={onViewportPointerUp}
          onClick={placeStationAt}
        >
          {/* zoom/pan controls */}
          <div className="pointer-events-auto absolute left-3 top-3 z-10 flex items-center gap-1 rounded-md border border-[#262626] bg-black/80 p-1 backdrop-blur" data-no-pan>
            <button onClick={() => setScale((s) => clamp(s * 1.18, 0.5, 4))} className="h-7 w-7 rounded bg-[#141414] font-mono text-sm text-white hover:bg-[#1e1e1e]">+</button>
            <span className="w-12 text-center font-mono text-[11px] text-[#a1a1a1]">{Math.round(scale * 100)}%</span>
            <button onClick={() => setScale((s) => clamp(s / 1.18, 0.5, 4))} className="h-7 w-7 rounded bg-[#141414] font-mono text-sm text-white hover:bg-[#1e1e1e]">−</button>
            <div className="mx-1 h-4 w-px bg-[#262626]" />
            <button onClick={() => { setScale(1); setPan({ x: 0, y: 0 }); }} className="rounded px-2 py-1 font-mono text-[11px] text-[#a1a1a1] hover:text-white">Reset</button>
          </div>
          <div className="pointer-events-none absolute bottom-3 left-3 z-10 hidden font-mono text-[10px] leading-relaxed text-[#666] sm:block" data-no-pan>
            <div>click map → add station · click dot → select · Shift+click pair → connect</div>
            <div>drag dot → move · wheel/Ctrl+scroll → zoom · drag bg → pan · Esc → back</div>
          </div>

          {/* empty state */}
          {isEmpty ? (
            <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center p-6">
              <div className="rounded-xl border border-dashed border-[#333] bg-black/70 px-6 py-5 text-center backdrop-blur">
                <div className="font-mono text-sm font-semibold text-white">No stations yet</div>
                <div className="mt-1 font-mono text-xs text-[#a1a1a1]">Click the map to add your first station.</div>
                <div className="mt-2 font-mono text-[11px] text-[#666]">Tip: create a line first so new stations join it automatically.</div>
              </div>
            </div>
          ) : null}

          {/* scaled content */}
          <div
            data-canvas-inner
            className="relative h-[72vh] max-h-[78vh] w-[min(1100px,92vw)] shrink-0 overflow-hidden rounded-lg border border-[#262626] bg-black shadow-2xl lg:h-[76vh] lg:w-[min(980px,68vw)]"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`, transformOrigin: "center center" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* image */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt={raw?.city ?? fallbackCity}
              draggable={false}
              className="h-full w-full object-contain bg-[#0a0a0a] select-none"
              style={{ display: "block" }}
            />
            {/* pdf hint */}
            {kind === "o" ? (
              <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/70 px-2 py-1 font-mono text-[10px] text-[#a1a1a1]">PDF preview — graph coords are still normalized 0..1</div>
            ) : null}
            {/* edges */}
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
              {raw?.edges.map((ed, i) => {
                const a = raw.stations.find((s) => s.id === ed.from);
                const b = raw.stations.find((s) => s.id === ed.to);
                if (!a?.x || !b?.x || a.x == null || a.y == null || b.x == null || b.y == null) return null;
                const line = raw.lines[ed.line];
                const color = line?.color ?? "#10b981";
                const isPath = pathSet.has(ed.from) && pathSet.has(ed.to) && pathInfo?.path?.includes(ed.from) && pathInfo?.path?.includes(ed.to);
                const highlight = isPath && pathInfo?.found && pathInfo.path && areAdjacentInPath(pathInfo.path, ed.from, ed.to);
                return (
                  <line
                    key={`${ed.from}-${ed.to}-${i}`}
                    x1={a.x * 100} y1={a.y * 100} x2={b.x * 100} y2={b.y * 100}
                    stroke={highlight ? "#10b981" : color}
                    strokeWidth={highlight ? 0.9 : 0.55}
                    strokeOpacity={highlight ? 1 : 0.95}
                    strokeLinecap="round"
                  />
                );
              })}
            </svg>
            {/* stations */}
            {raw?.stations.map((s) => {
              const isSel = selected.includes(s.id);
              const inPath = pathSet.has(s.id);
              const hasXY = s.x != null && s.y != null;
              if (!hasXY) return null;
              return (
                <button
                  key={s.id}
                  data-station-dot
                  onClick={(e) => { e.stopPropagation(); selectToggle(s.id, e); }}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); deleteStation(s.id); }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    draggingStation.current = { id: s.id };
                    // push history snapshot at drag start for undo
                    setHistory((h) => [...h.slice(-19), cloneRaw(raw!)]);
                    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  }}
                  onPointerUp={(e) => { try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ } }}
                  className={`absolute flex h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 shadow-md transition-all ${inPath ? "ring-2 ring-[#10b981]/40" : ""} ${isSel ? "z-20 scale-125" : "z-10 hover:scale-110"}`}
                  style={{
                    left: `${(s.x as number) * 100}%`,
                    top: `${(s.y as number) * 100}%`,
                    background: isSel ? "#10b981" : s.interchange ? "#ededed" : "#0a0a0a",
                    borderColor: isSel ? "#10b981" : s.lines.length ? (raw.lines[s.lines[0]!] as { color: string } | undefined)?.color ?? "#404040" : "#404040",
                  }}
                  title={`${s.label}${s.interchange ? " · interchange" : ""} · ${s.lines.map((lid) => raw.lines[lid]?.label ?? lid).join(", ") || "no line"} (drag to move, right-click to remove)`}
                  aria-label={s.label}
                >
                  {s.interchange ? <span className="h-1.5 w-1.5 rounded-full bg-black" /> : null}
                </button>
              );
            })}
            {/* selected labels */}
            {raw?.stations.filter((s) => selected.includes(s.id) && s.x != null).map((s) => (
              <div
                key={`lbl-${s.id}`}
                className="pointer-events-none absolute z-20 -translate-x-1/2 rounded bg-black/85 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white shadow"
                style={{ left: `${(s.x as number) * 100}%`, top: `calc(${(s.y as number) * 100}% - 18px)` }}
              >{s.label}</div>
            ))}
          </div>
        </div>

        {/* rail */}
        <div className="flex w-full shrink-0 flex-col gap-4 overflow-auto border-t border-[#262626] bg-black p-3 sm:p-4 lg:w-[25%] lg:min-w-[320px] lg:max-w-[420px] lg:border-l lg:border-t-0" data-no-pan>
          {/* selection + path */}
          <section className="rounded-lg border border-[#262626] p-3">
            <div className="flex items-center justify-between">
              <h3 className="font-mono text-[11px] font-semibold uppercase tracking-widest text-[#a1a1a1]">Selection & path</h3>
              <span className="font-mono text-[10px] text-[#666]">{selected.length}/2</span>
            </div>
            {selected.length === 0 ? (
              <p className="mt-2 font-mono text-xs leading-relaxed text-[#666]">Click up to two stations. Live BFS highlights the shortest path on the map.</p>
            ) : (
              <div className="mt-2 space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {selected.map((id) => {
                    const st = raw?.stations.find((s) => s.id === id);
                    return <span key={id} className="rounded-full border border-[#10b981]/30 bg-[#10b981]/15 px-2 py-1 font-mono text-[11px] text-[#ededed]">{st?.label ?? id.slice(0, 6)}</span>;
                  })}
                </div>
                {selected.length === 2 ? (
                  <>
                    {pathInfo?.found ? (
                      <div className="rounded-md border border-[#10b981]/20 bg-[#0f1a15] p-2">
                        <div className="font-mono text-[11px] text-[#ededed]"><span className="text-[#10b981]">{pathInfo.hops}</span> hops · <span className="text-[#10b981]">{pathInfo.transfers}</span> transfers</div>
                        <div className="mt-1 font-mono text-[11px] leading-relaxed text-[#a1a1a1] break-words">{pathInfo.path!.map((pid) => raw?.stations.find((s) => s.id === pid)?.label ?? pid).join(" → ")}</div>
                        <div className="mt-1 font-mono text-[10px] text-[#666]">lines: {(pathInfo.lines.length ? pathInfo.lines.map((lid) => raw?.lines[lid]?.label ?? lid).join(" → ") : "—")}</div>
                      </div>
                    ) : (
                      <div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-2 font-mono text-[11px] text-amber-200">No path between selected stations with current edges.</div>
                    )}
                    <button onClick={connectSelected} disabled={!activeLineId || !raw?.lines[activeLineId!]} className="w-full rounded-md bg-white px-3 py-1.5 font-mono text-xs font-semibold text-black hover:bg-[#ededed] disabled:opacity-40">Connect selected with {activeLineId ? raw?.lines[activeLineId!]?.label : "line"}</button>
                  </>
                ) : null}
                <button onClick={clearSelection} className="w-full rounded-md border border-[#262626] px-3 py-1.5 font-mono text-xs text-[#a1a1a1] hover:border-[#404040] hover:text-white">Clear selection</button>
              </div>
            )}
            <div className="mt-3 grid grid-cols-3 gap-2 border-t border-[#262626] pt-3 font-mono text-[10px]">
              <div className="rounded bg-[#0a0a0a] px-2 py-1.5 text-center"><div className="text-[#666]">stations</div><div className="text-sm font-semibold text-white">{raw?.stations.length ?? 0}</div></div>
              <div className="rounded bg-[#0a0a0a] px-2 py-1.5 text-center"><div className="text-[#666]">edges</div><div className="text-sm font-semibold text-white">{raw?.edges.length ?? 0}</div></div>
              <div className="rounded bg-[#0a0a0a] px-2 py-1.5 text-center"><div className="text-[#666]">lines</div><div className="text-sm font-semibold text-white">{raw ? Object.keys(raw.lines).length : 0}</div></div>
            </div>
          </section>

          {/* lines */}
          <section className="rounded-lg border border-[#262626] p-3">
            <div className="flex items-center justify-between">
              <h3 className="font-mono text-[11px] font-semibold uppercase tracking-widest text-[#a1a1a1]">Lines</h3>
              <button onClick={addLine} className="rounded bg-[#141414] px-2 py-1 font-mono text-[11px] text-white hover:bg-[#1e1e1e]">+ Add line</button>
            </div>
            {raw && Object.keys(raw.lines).length === 0 ? (
              <p className="mt-2 font-mono text-xs text-[#666]">No lines yet — add one, then new stations will join the active line.</p>
            ) : null}
            <div className="mt-2 space-y-2">
              {raw ? Object.entries(raw.lines).map(([lid, ln]) => (
                <div key={lid} className={`rounded-md border p-2 ${activeLineId === lid ? "border-[#10b981]/40 bg-[#0f1a15]" : "border-[#262626] bg-[#0a0a0a]"}`}>
                  <div className="flex items-center gap-2">
                    <input type="color" value={ln.color} onChange={(e) => updateRaw((p) => { const n = cloneRaw(p); n.lines[lid]!.color = e.target.value; return n; })} className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0" title="line color" />
                    <input value={ln.label} onChange={(e) => updateRaw((p) => { const n = cloneRaw(p); n.lines[lid]!.label = e.target.value; return n; })} className="min-w-0 flex-1 rounded border border-[#262626] bg-black px-2 py-1 font-mono text-xs text-white placeholder:text-[#666] focus:border-[#10b981] focus:outline-none" placeholder="Line name" />
                    <button onClick={() => setActiveLineId(lid)} className={`shrink-0 rounded px-2 py-1 font-mono text-[10px] ${activeLineId === lid ? "bg-[#10b981] text-black" : "bg-[#141414] text-[#a1a1a1] hover:text-white"}`}>{activeLineId === lid ? "Active" : "Use"}</button>
                    <button onClick={() => removeLine(lid)} className="shrink-0 rounded px-1.5 py-1 font-mono text-[11px] text-[#666] hover:text-red-400" title="remove line">×</button>
                  </div>
                  <div className="mt-1.5 font-mono text-[10px] text-[#666]">{ln.stations.length} stations on this line · id {lid.slice(0, 6)}</div>
                </div>
              )) : null}
            </div>
          </section>

          {/* stations list */}
          <section className="rounded-lg border border-[#262626] p-3">
            <h3 className="font-mono text-[11px] font-semibold uppercase tracking-widest text-[#a1a1a1]">Stations</h3>
            {raw?.stations.length === 0 ? (
              <p className="mt-2 font-mono text-xs text-[#666]">Click the map to place stations. They appear here for renaming, line assignment, and interchange toggle.</p>
            ) : (
              <div className="mt-2 max-h-[38vh] space-y-1.5 overflow-auto pr-1">
                {raw!.stations.map((s) => (
                  <div key={s.id} className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${selected.includes(s.id) ? "border-[#10b981]/30 bg-[#0f1a15]" : "border-[#1a1a1a] bg-[#0a0a0a]"}`}>
                    <button onClick={(e) => selectToggle(s.id, e)} className="h-2.5 w-2.5 shrink-0 rounded-full border" style={{ background: selected.includes(s.id) ? "#10b981" : "#0a0a0a", borderColor: s.lines[0] ? raw!.lines[s.lines[0]]?.color ?? "#404040" : "#404040" }} title="toggle selection" />
                    {editingStationId === s.id ? (
                      <input autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} onBlur={() => { const v = editName.trim() || s.label; updateRaw((p) => { const n = cloneRaw(p); const t = n.stations.find((x) => x.id === s.id); if (t) t.label = v; return n; }); setEditingStationId(null); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditingStationId(null); }} className="min-w-0 flex-1 rounded border border-[#10b981] bg-black px-1.5 py-0.5 font-mono text-xs text-white focus:outline-none" />
                    ) : (
                      <button onClick={() => { setEditingStationId(s.id); setEditName(s.label); }} className="min-w-0 flex-1 truncate text-left font-mono text-xs text-[#ededed] hover:text-white" title="click to rename">{s.label}</button>
                    )}
                    <span className="hidden font-mono text-[10px] text-[#555] sm:inline">{s.x != null ? `${Math.round((s.x as number) * 100)}%,${Math.round((s.y as number) * 100)}%` : "—"}</span>
                    <label className="flex shrink-0 items-center gap-1 font-mono text-[10px] text-[#a1a1a1]" title="interchange">
                      <input type="checkbox" checked={!!s.interchange} onChange={() => toggleInterchange(s.id)} className="accent-[#10b981]" /> ⇄
                    </label>
                    <button onClick={() => deleteStation(s.id)} className="shrink-0 rounded px-1 font-mono text-xs text-[#666] hover:text-red-400" title="remove station (or right-click dot)">×</button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* edges */}
          {raw && raw.edges.length > 0 ? (
            <section className="rounded-lg border border-[#262626] p-3">
              <h3 className="font-mono text-[11px] font-semibold uppercase tracking-widest text-[#a1a1a1]">Edges</h3>
              <div className="mt-2 max-h-[22vh] space-y-1 overflow-auto pr-1">
                {raw.edges.map((ed, i) => {
                  const a = raw.stations.find((s) => s.id === ed.from)?.label ?? ed.from.slice(0, 6);
                  const b = raw.stations.find((s) => s.id === ed.to)?.label ?? ed.to.slice(0, 6);
                  const ln = raw.lines[ed.line];
                  return (
                    <div key={`${ed.from}-${ed.to}-${i}`} className="flex items-center gap-2 rounded bg-[#0a0a0a] px-2 py-1">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: ln?.color ?? "#404040" }} />
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#a1a1a1]">{a} ↔ {b}</span>
                      <span className="shrink-0 font-mono text-[10px] text-[#666]">{ln?.label ?? ed.line.slice(0, 6)}</span>
                      <button onClick={() => deleteEdge(ed.from, ed.to)} className="shrink-0 font-mono text-xs text-[#666] hover:text-red-400">×</button>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {/* which questions this graph supports */}
          <section className="rounded-lg border border-[#262626] p-3">
            <h3 className="font-mono text-[11px] font-semibold uppercase tracking-widest text-[#a1a1a1]">Questions this graph supports</h3>
            <div className="mt-2 space-y-2">
              <div>
                <div className="font-mono text-[11px] font-semibold text-white">S — single-station / line (no path)</div>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 font-mono text-[11px] leading-relaxed text-[#a1a1a1]">
                  {QUESTION_TEMPLATES.S.map((t) => <li key={t}>{t}</li>)}
                </ul>
              </div>
              <div>
                <div className="font-mono text-[11px] font-semibold text-white">L — path (needs ≥2 connected stations)</div>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 font-mono text-[11px] leading-relaxed text-[#a1a1a1]">
                  {QUESTION_TEMPLATES.L.map((t) => <li key={t}>{t}</li>)}
                </ul>
                <div className={`mt-2 rounded px-2 py-1.5 font-mono text-[11px] ${raw && raw.stations.length >= 2 && raw.edges.length >= 1 ? "bg-[#10b981]/15 text-[#10b981] border border-[#10b981]/20" : "bg-[#1a1a1a] text-[#666] border border-[#262626]"}`}>
                  {raw && raw.stations.length >= 2 && raw.edges.length >= 1 ? "✓ Graph has paths — L questions are answerable (select two stations to preview hops/transfers)." : "— Add at least 2 stations and 1 edge to enable L questions."}
                </div>
              </div>
            </div>
          </section>

          <div className="rounded-md border border-[#262626] bg-[#0a0a0a] p-2 font-mono text-[10px] leading-relaxed text-[#666]">
            <div>Graph is <span className="text-[#a1a1a1]">human-authored only</span>. Save writes to <code className="text-[#888]">metro-graph-draft:{fileId.slice(0, 8)}…</code> locally and to <code className="text-[#888]">POST /api/graphs/:fileId</code> when the relay is configured.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function areAdjacentInPath(path: string[], a: string, b: string): boolean {
  for (let i = 0; i < path.length - 1; i++) {
    if ((path[i] === a && path[i + 1] === b) || (path[i] === b && path[i + 1] === a)) return true;
  }
  return false;
}
