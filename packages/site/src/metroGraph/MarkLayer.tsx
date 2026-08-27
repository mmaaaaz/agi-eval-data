import { useEffect, useMemo, useState } from "react";
import type { MetroGraph } from "./routing";
import { bfsShortest } from "./routing";

interface MarkLayerProps {
  graph: MetroGraph | null;
  fileId?: string;
  /** kind byte from the row — when "o" (PDF) the overlay is disabled */
  kind?: string;
  /** controlled selection (station ids); when absent the layer manages its own */
  selected?: string[];
  onSelectedChange?: (ids: string[]) => void;
  /** className for the absolute container */
  className?: string;
}

/** Station dots + SVG lines overlay. Zero impact when kind=="o" or graph is null. */
export function MarkLayer({ graph, kind, selected: controlled, onSelectedChange, className }: MarkLayerProps) {
  const [internal, setInternal] = useState<string[]>([]);
  const selected = controlled ?? internal;
  const setSelected = (next: string[]) => {
    if (onSelectedChange) onSelectedChange(next);
    else setInternal(next);
  };

  const toggle = (id: string) => {
    setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id].slice(-2));
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected([]);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [selected]);

  const disabled = kind === "o";
  const hasCoords = useMemo(() => {
    if (!graph) return false;
    for (const [, s] of graph.stations) if (s.x != null && s.y != null) return true;
    return false;
  }, [graph]);

  const path = useMemo(() => {
    if (!graph || selected.length < 2) return null;
    const r = bfsShortest(graph, selected[0], selected[1]);
    return r?.path ?? null;
  }, [graph, selected]);

  const pathSet = useMemo(() => new Set(path ?? []), [path]);

  // disabled for PDFs
  if (disabled) return null;
  if (!graph || graph.stations.size === 0) return null;

  // no x/y → search fallback
  if (!hasCoords) {
    return <MarkSearchFallback graph={graph} selected={selected} onToggle={toggle} className={className} />;
  }

  // coordinate overlay — absolute inside the image container (parent must be relative)
  // normalize stations by raw provenance bounds: use 0..1 already stored
  const stationsArr = [...graph.stations.values()];
  const algoPathSet: Set<string> = pathSet as Set<string>;

  return (
    <div className={className ?? "pointer-events-auto absolute inset-0"}>
      {/* lines — collect from adj */}
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        {graph.raw.edges.map((e, i) => {
          const a = graph.stations.get(e.from);
          const b = graph.stations.get(e.to);
          if (!a || !b || a.x == null || a.y == null || b?.x == null || b?.y == null) return null;
          const onPath = algoPathSet.has(e.from) && algoPathSet.has(e.to) && path != null && Math.abs(path.indexOf(e.from) - path.indexOf(e.to)) === 1;
          // x/y are already 0..1 if authored; if pixel coords need normalization TODO; assume 0..1
          const ax = a.x <= 1 ? a.x * 100 : a.x;
          const ay = a.y <= 1 ? a.y * 100 : a.y;
          const bx = b.x <= 1 ? b.x * 100 : b.x;
          const by = b.y <= 1 ? b.y * 100 : b.y;
          return (
            <line
              key={`${e.from}-${e.to}-${i}`}
              x1={ax}
              y1={ay}
              x2={bx}
              y2={by}
              stroke={onPath ? "#10b981" : "#52525b"}
              strokeWidth={onPath ? 0.9 : 0.35}
              strokeOpacity={onPath ? 1 : 0.55}
            />
          );
        })}
        {path && path.length > 1
          ? path.slice(0, -1).map((id, idx) => {
              const a = graph.stations.get(id);
              const b = graph.stations.get(path[idx + 1]);
              if (!a || !b || a.x == null || a.y == null || b?.x == null || b?.y == null) return null;
              const ax = a.x <= 1 ? a.x * 100 : a.x;
              const ay = a.y <= 1 ? a.y * 100 : a.y;
              const bx = b.x <= 1 ? b.x * 100 : b.x;
              const by = b.y <= 1 ? b.y * 100 : b.y;
              return (
                <line
                  key={`hl-${id}-${idx}`}
                  x1={ax}
                  y1={ay}
                  x2={bx}
                  y2={by}
                  stroke="#10b981"
                  strokeWidth={1.2}
                  strokeOpacity={0.95}
                />
              );
            })
          : null}
      </svg>
      {/* station dots */}
      {stationsArr.map((s) => {
        if (s.x == null || s.y == null) return null;
        const isSelected = selected.includes(s.id);
        const onPath = algoPathSet.has(s.id);
        const sx = s.x <= 1 ? s.x * 100 : s.x;
        const sy = s.y <= 1 ? s.y * 100 : s.y;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => toggle(s.id)}
            title={s.label}
            aria-label={s.label}
            style={{ left: `${sx}%`, top: `${sy}%` }}
            className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border transition-colors ${
              isSelected
                ? "h-3 w-3 border-white bg-[#10b981]"
                : onPath
                  ? "h-2.5 w-2.5 border-[#10b981] bg-[#10b981]/80"
                  : "h-2 w-2 border-[#3f3f46] bg-[#18181b] hover:border-white"
            }`}
          />
        );
      })}
      {selected.length > 0 && (
        <button
          type="button"
          onClick={() => setSelected([])}
          className="absolute bottom-2 right-2 rounded border border-[#262626] bg-black/70 px-2 py-1 font-mono text-[10px] text-[#a1a1a1] backdrop-blur hover:text-white"
        >
          Esc to clear · {selected.join(" → ")}
        </button>
      )}
    </div>
  );
}

function MarkSearchFallback({ graph, selected, onToggle, className }: { graph: MetroGraph; selected: string[]; onToggle: (id: string) => void; className?: string }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const all = [...graph.stations.values()];
    if (!s) return all.slice(0, 40);
    return all.filter((st) => st.label.toLowerCase().includes(s) || st.id.toLowerCase().includes(s)).slice(0, 40);
  }, [graph, q]);
  return (
    <div className={className ?? "absolute bottom-2 left-2 right-2 rounded-lg border border-[#262626] bg-black/85 p-2 backdrop-blur"}>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="search station… (no coordinates for this map)"
        className="w-full rounded border border-[#262626] bg-[#0a0a0a] px-2 py-1 font-mono text-xs text-white outline-none placeholder:text-[#666]"
      />
      <div className="mt-2 flex flex-wrap gap-1">
        {filtered.map((s) => (
          <button
            key={s.id}
            onClick={() => onToggle(s.id)}
            className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${selected.includes(s.id) ? "border-[#10b981] bg-[#10b981]/20 text-[#10b981]" : "border-[#262626] text-[#a1a1a1] hover:border-white hover:text-white"}`}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
