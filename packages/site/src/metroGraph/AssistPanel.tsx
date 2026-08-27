import { useMemo, useState } from "react";
import type { MetroGraph } from "./routing";
import { bfsShortest } from "./routing";
import { QUESTION_TEMPLATES } from "./types";

interface AssistPanelProps {
  graph: MetroGraph | null;
  selected: string[];
  coverage?: { imagesWithQuestions: number; totalImages: number; avgPerMap: number };
  onUseQuestion?: (payload: { question: string; answer: string; tags: string }) => void;
  /** chips to mirror (e.g. branch/country/city) */
  marksChips?: string[];
}

function stationLabel(graph: MetroGraph | null, id: string): string {
  if (!graph) return id;
  return graph.stations.get(id)?.label ?? id;
}

export function AssistPanel({ graph, selected, coverage, onUseQuestion, marksChips }: AssistPanelProps) {
  const [activeTpl, setActiveTpl] = useState<string | null>(null);

  const computed = useMemo(() => {
    if (!graph || selected.length < 2) return null;
    const r = bfsShortest(graph, selected[0], selected[1]);
    if (!r) return { path: null as string[] | null, hops: 0, transfers: 0, lines: [] as string[] };
    return { path: r.path, hops: r.hops, transfers: r.transfers, lines: r.lines };
  }, [graph, selected]);

  const fillTemplate = (tpl: string): { q: string; a: string } => {
    if (!graph) return { q: tpl, a: "" };
    const lineLabel = (() => {
      const firstLineKey = Object.keys(graph.raw.lines)[0];
      return firstLineKey ? (graph.raw.lines[firstLineKey]?.label ?? firstLineKey) : "Line 1";
    })();
    const a = selected[0] ? stationLabel(graph, selected[0]) : ([...graph.stations.values()][0]?.label ?? "Station A");
    const b = selected[1] ? stationLabel(graph, selected[1]) : ([...graph.stations.values()][1]?.label ?? "Station B");
    let q = tpl
      .replaceAll("{line}", lineLabel)
      .replaceAll("{station}", a)
      .replaceAll("{from}", a)
      .replaceAll("{to}", b);
    let ans = "";
    if (tpl.includes("{from}") && tpl.includes("{to}") && computed?.path) {
      if (tpl.toLowerCase().includes("hops") || tpl.toLowerCase().includes("stops")) ans = String(computed.hops);
      else if (tpl.toLowerCase().includes("transfer")) ans = String(computed.transfers);
      else if (tpl.toLowerCase().includes("path") || tpl.toLowerCase().includes("list stations")) ans = computed.path!.map((id) => stationLabel(graph, id)).join(" → ");
    }
    return { q, a: ans };
  };

  if (!graph) {
    return (
      <div className="rounded-lg border border-[#262626] p-3">
        <p className="font-mono text-[11px] text-[#666]">No graph for this map yet. Contribute one via <code className="text-[#a1a1a1]">data/metro-graph/&lt;city&gt;.json</code>.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-[#262626] p-3">
      {coverage && (
        <div className="flex items-center gap-2 font-mono text-[10px] text-[#a1a1a1]">
          <span>coverage: {coverage.imagesWithQuestions}/{coverage.totalImages}</span>
          <span className="opacity-50">·</span>
          <span>avg {coverage.avgPerMap.toFixed(1)}/map</span>
        </div>
      )}

      {marksChips && marksChips.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {marksChips.map((c) => (
            <span key={c} className="rounded-full border border-[#262626] px-2 py-0.5 font-mono text-[9px] text-[#a1a1a1]">{c}</span>
          ))}
        </div>
      )}

      {computed?.path && (
        <div className="rounded border border-[#10b981]/30 bg-[#10b981]/5 p-2 font-mono text-[11px] text-[#ededed]">
          <div>{computed.hops} hops · {computed.transfers} transfers</div>
          <div className="mt-1 text-[#a1a1a1]">{computed.path.map((id) => stationLabel(graph, id)).join(" → ")}</div>
        </div>
      )}

      <div>
        <p className="mb-1 font-mono text-[9px] uppercase tracking-wider text-[#666]">short templates (S1–S5)</p>
        <div className="space-y-1">
          {QUESTION_TEMPLATES.S.map((t, i) => {
            const key = `S${i + 1}`;
            return (
              <button
                key={key}
                onClick={() => setActiveTpl(activeTpl === key ? null : key)}
                className={`w-full text-left rounded border px-2 py-1 font-mono text-[11px] ${activeTpl === key ? "border-[#10b981] bg-[#10b981]/10 text-white" : "border-[#262626] text-[#a1a1a1] hover:border-[#404040]"}`}
              >
                <span className="mr-1.5 text-[#10b981]">{key}</span>{t}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-1 font-mono text-[9px] uppercase tracking-wider text-[#666]">long templates (L1–L5)</p>
        <div className="space-y-1">
          {QUESTION_TEMPLATES.L.map((t, i) => {
            const key = `L${i + 1}`;
            return (
              <button
                key={key}
                onClick={() => setActiveTpl(activeTpl === key ? null : key)}
                className={`w-full text-left rounded border px-2 py-1 font-mono text-[11px] ${activeTpl === key ? "border-[#10b981] bg-[#10b981]/10 text-white" : "border-[#262626] text-[#a1a1a1] hover:border-[#404040]"}`}
              >
                <span className="mr-1.5 text-[#10b981]">{key}</span>{t}
              </button>
            );
          })}
        </div>
      </div>

      {activeTpl && (
        <TemplatePreview
          tpl={[...QUESTION_TEMPLATES.S, ...QUESTION_TEMPLATES.L][activeTpl.startsWith("S") ? Number(activeTpl.slice(1)) - 1 : 5 + Number(activeTpl.slice(1)) - 1]}
          label={activeTpl}
          graph={graph}
          onUse={(q, a) => {
            const tags = [graph.raw.city].filter(Boolean).join(", ");
            onUseQuestion?.({ question: q, answer: a, tags });
          }}
          fill={fillTemplate}
        />
      )}
    </div>
  );
}

function TemplatePreview({ tpl, label, graph, onUse, fill }: { tpl: string; label: string; graph: MetroGraph; onUse: (q: string, a: string) => void; fill: (t: string) => { q: string; a: string } }) {
  const { q, a } = fill(tpl);
  void graph;
  return (
    <div className="rounded border border-[#10b981]/40 p-2">
      <p className="font-mono text-[9px] uppercase tracking-wider text-[#10b981]">{label} preview</p>
      <p className="mt-1 font-mono text-xs text-white">{q}</p>
      {a && <p className="mt-1 font-mono text-xs text-[#a1a1a1]">→ {a}</p>}
      <button
        onClick={() => onUse(q, a)}
        className="mt-2 rounded bg-white px-3 py-1 font-mono text-xs font-semibold text-black hover:bg-[#ededed]"
      >
        Use as question
      </button>
      <p className="mt-1 font-mono text-[9px] text-[#666]">fills fields without submitting</p>
    </div>
  );
}
