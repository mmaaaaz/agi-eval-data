import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useFocus, useOM } from "./open-models";
import { Bar, Chip, Dot, Empty, Panel, Section, Seg, TextInput } from "../components/open-models/ui";
import { LevelSpark, shortName } from "../components/open-models/charts";
import { METRICS, type Metric, fmtInt, mean, metricValue, pct, ranked, signed } from "../lib/openModelsFmt";
import type { Artifact, ModelEntry } from "../lib/openModelsTypes";

export const Route = createFileRoute("/open-models/domains/")({ component: DomainsPage });

type View = "domain" | "family" | "level";

interface Cell {
  acc: number | null;
  as: number | null;
  partial: number | null;
  headroom: number | null;
  levels: (number | null)[];
  n: number;
  pf: number;
}

interface Slice {
  key: string;
  label: string;
  sub?: string;
  href?: string;
  flags: string[];
  n: number;
  oracle: number | null;
  cells: Record<string, Cell>;
}

/* --------------------------------------------------------------- builders --- */

function buildRows(a: Artifact, view: View): Slice[] {
  if (view === "family") {
    return a.benchmark.families.map((name, fi) => {
      const cells: Record<string, Cell> = {};
      for (const m of a.models) {
        const f = m.families[fi];
        cells[m.id] = {
          acc: f.acc,
          as: f.as,
          partial: f.partial,
          headroom: f.acc != null && f.oracle != null ? f.acc - f.oracle : null,
          levels: f.levels.map((l) => l.acc),
          n: f.n,
          pf: Math.round((m.totals.pfRate ?? 0) * f.n),
        };
      }
      const f0 = a.models[0].families[fi];
      return { key: name, label: name, flags: [], n: f0.n, oracle: f0.oracle, cells };
    });
  }
  if (view === "level") {
    return a.benchmark.levels.map((lv) => {
      const cells: Record<string, Cell> = {};
      for (const m of a.models) {
        const l = m.totals.levels[lv.n - 1];
        cells[m.id] = {
          acc: l.acc,
          as: l.as,
          partial: l.partial,
          headroom: l.acc != null && l.oracle != null ? l.acc - l.oracle : null,
          levels: [l.acc],
          n: l.n,
          pf: l.pf,
        };
      }
      const l0 = a.models[0].totals.levels[lv.n - 1];
      return { key: String(lv.n), label: "L" + lv.n, sub: lv.task, flags: [], n: l0.n, oracle: l0.oracle ?? null, cells };
    });
  }
  return a.domains.map((d) => {
    const cells: Record<string, Cell> = {};
    for (const m of a.models) {
      const r = d.per.find((p) => p.model === m.id);
      cells[m.id] = {
        acc: r?.acc ?? null,
        as: r?.as ?? null,
        partial: r?.partial ?? null,
        headroom: r?.acc != null && d.oracle != null ? r.acc - d.oracle : null,
        levels: (r?.levels ?? []).map((l) => l.acc ?? null),
        n: r?.n ?? 0,
        pf: r?.pf ?? 0,
      };
    }
    return {
      key: d.key,
      label: d.label,
      sub: d.familyName ?? undefined,
      href: "/open-models/domains/" + d.key,
      flags: d.const.map((c) => "L" + c.level),
      n: d.n,
      oracle: d.oracle,
      cells,
    };
  });
}

/* ------------------------------------------------------------------- page --- */

export function DomainsPage() {
  const a = useOM();
  const { focus } = useFocus();
  const order = ranked(a.models);
  const [view, setView] = useState<View>("domain");
  const [metric, setMetric] = useState<Metric>("acc");
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState<string | null>(null);
  const [onlyConst, setOnlyConst] = useState(false);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "row", dir: 1 });
  const [shapeFor, setShapeFor] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const all = useMemo(() => buildRows(a, view), [a, view]);

  const rows = useMemo(() => {
    let out = all;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      out = out.filter((r) => r.label.toLowerCase().includes(q) || (r.sub ?? "").toLowerCase().includes(q));
    }
    if (family) out = out.filter((r) => r.sub === family);
    if (onlyConst) out = out.filter((r) => r.flags.length > 0);
    const dir = sort.dir;
    if (sort.key === "row") return out;
    return [...out].sort((x, y) => {
      if (sort.key === "spread") {
        const sx = spread(x.cells, order);
        const sy = spread(y.cells, order);
        return ((sx ?? 0) - (sy ?? 0)) * dir;
      }
      const vx = metricValue({ ...x.cells[sort.key], oracle: x.oracle }, metric) ?? 0;
      const vy = metricValue({ ...y.cells[sort.key], oracle: y.oracle }, metric) ?? 0;
      return (vx - vy) * dir;
    });
  }, [all, query, family, onlyConst, sort, metric, order]);

  const shapeModel = order.find((m) => m.id === (shapeFor ?? focus)) ?? order[0];
  const constDomains = a.domains.filter((d) => d.const.length > 0);

  const copyTsv = () => {
    const head = ["slice", "n", ...order.map((m) => m.label + " " + metric), "field mean", "guessing", "spread"].join("\t");
    const body = rows
      .map((r) =>
        [
          r.label,
          r.cells[order[0].id].n,
          ...order.map((m) => ((metricValue({ ...r.cells[m.id], oracle: r.oracle }, metric) ?? 0) * 100).toFixed(2)),
          ((mean(order.map((m) => metricValue({ ...r.cells[m.id], oracle: r.oracle }, metric) ?? 0)) ?? 0) * 100).toFixed(2),
          ((r.oracle ?? 0) * 100).toFixed(2),
          (((spread(r.cells, order) ?? 0) * 100)).toFixed(2),
        ].join("\t"),
      )
      .join("\n");
    navigator.clipboard
      ?.writeText(head + "\n" + body)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => setCopied(false));
  };

  const bestPerRow = (r: Slice) => Math.max(...order.map((m) => metricValue({ ...r.cells[m.id], oracle: r.oracle }, metric) ?? 0));

  return (
    <div>
      <Section
        eyebrow="01 domain table"
        title="Every slice, all runs side by side"
        hint={
          <>
            {a.domains.length} domains · {a.benchmark.families.length} families · 5 levels. The best run in each row is tinted; click a
            column header to sort by that run, or a chip above to isolate it everywhere.
          </>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-[#262626] bg-[#0a0a0a] px-3 py-2.5">
          <Seg
            label="rows"
            value={view}
            onChange={(v) => {
              setView(v);
              setSort({ key: "row", dir: 1 });
              setFamily(null);
            }}
            options={[
              { id: "domain", label: "domains" },
              { id: "family", label: "families" },
              { id: "level", label: "levels" },
            ]}
          />
          <Seg label="metric" value={metric} onChange={setMetric} options={METRICS.map((m) => ({ id: m.id, label: m.short, hint: m.hint }))} />
          <TextInput value={query} onChange={setQuery} placeholder="filter slices…" />
          <Chip active={onlyConst} onClick={() => setOnlyConst((v) => !v)} title="Only slices with a single-answer level">
            ◆ single-answer ({constDomains.length})
          </Chip>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[9px] uppercase tracking-widest text-[#666]">shape for</span>
            <div className="flex flex-wrap gap-1">
              {order.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setShapeFor(shapeModel.id === m.id ? null : m.id)}
                  aria-pressed={shapeModel.id === m.id}
                  title={m.label}
                  className={
                    "rounded border px-1.5 py-0.5 font-mono text-[9px] transition-colors " +
                    (shapeModel.id === m.id ? "border-transparent text-[#0a0a0a]" : "border-[#262626] text-[#666] hover:text-white")
                  }
                  style={shapeModel.id === m.id ? { background: m.accent } : undefined}
                >
                  {shortName(m)}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={copyTsv}
            className="ml-auto rounded border border-[#262626] px-2.5 py-1 font-mono text-[10px] text-[#a1a1a1] transition-colors hover:border-[#404040] hover:text-white"
          >
            {copied ? "copied ✓" : "copy TSV"}
          </button>
        </div>

        {view === "domain" && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <Chip active={family === null} onClick={() => setFamily(null)}>
              all families
            </Chip>
            {a.benchmark.families.map((f) => (
              <Chip key={f} active={family === f} onClick={() => setFamily(family === f ? null : f)}>
                {f}
              </Chip>
            ))}
          </div>
        )}

        <Panel>
          <div className="max-h-[74vh] overflow-auto">
            <table className="w-full border-separate border-spacing-0 text-left text-sm">
              <thead>
                <tr className="font-mono text-[9px] uppercase tracking-widest text-[#666]">
                  <th className="sticky top-0 z-20 min-w-[190px] bg-[#0a0a0a] px-3 py-2.5 font-normal">slice</th>
                  {order.map((m) => (
                    <th key={m.id} className="sticky top-0 z-20 bg-[#0a0a0a] px-3 py-2.5 font-normal">
                      <button
                        type="button"
                        onClick={() => setSort({ key: m.id, dir: sort.key === m.id && sort.dir === -1 ? 1 : -1 })}
                        className="inline-flex items-center gap-1.5 transition-colors hover:text-white"
                        title={"sort by " + m.label + " · " + metric}
                      >
                        <Dot color={m.accent} size={6} />
                        <span style={{ color: focus === m.id ? "#fff" : m.accent }}>{shortName(m)}</span>
                        {sort.key === m.id ? <span className="text-[#a1a1a1]">{sort.dir === -1 ? "▼" : "▲"}</span> : null}
                      </button>
                    </th>
                  ))}
                  <th className="sticky top-0 z-20 bg-[#0a0a0a] px-3 py-2.5 text-center font-normal">leads</th>
                  <th className="sticky top-0 z-20 bg-[#0a0a0a] px-3 py-2.5 text-right font-normal text-[#9a9a9a]" title="average of all runs on this slice">
                    field mean
                  </th>
                  <th className="sticky top-0 z-20 bg-[#0a0a0a] px-3 py-2.5 text-right font-normal" title="what guessing the most common answer scores">
                    guessing
                  </th>
                  <th className="sticky top-0 z-20 bg-[#0a0a0a] px-3 py-2.5 text-right font-normal">spread</th>
                  <th className="sticky top-0 z-20 bg-[#0a0a0a] px-3 py-2.5 text-right font-normal">
                    <span style={{ color: shapeModel.accent }}>{shortName(shapeModel)} L1–L5</span>
                  </th>
                  <th className="sticky top-0 z-20 bg-[#0a0a0a] px-3 py-2.5 text-right font-normal">n</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-[#262626] bg-[#0f0f0f] font-mono text-[10px] text-[#a1a1a1]">
                  <td className="px-3 py-2 uppercase tracking-widest">overall</td>
                  {order.map((m) => (
                    <td key={m.id} className="px-3 py-2 font-semibold" style={{ color: m.accent }}>
                      {pct(metricValue({ acc: m.totals.acc, as: m.totals.as, partial: m.totals.partial, oracle: m.totals.oracle }, metric), 2)}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-center" style={{ color: order[0].accent }}>
                    {shortName(order[0])}
                  </td>
                  <td className="px-3 py-2 text-right text-[#9a9a9a]">
                    {pct(mean(order.map((m) => metricValue({ acc: m.totals.acc, as: m.totals.as, partial: m.totals.partial, oracle: m.totals.oracle }, metric) ?? 0)), 2)}
                  </td>
                  <td className="px-3 py-2 text-right text-[#666]">{pct(a.models[0].totals.oracle, 2)}</td>
                  <td className="px-3 py-2 text-right text-[#666]">
                    {signed((order[0].totals.acc ?? 0) - (order[order.length - 1].totals.acc ?? 0), 1)}
                  </td>
                  <td />
                  <td className="px-3 py-2 text-right text-[#666]">{fmtInt(order[0].totals.n)}</td>
                </tr>
                {rows.map((r) => {
                  const best = bestPerRow(r);
                  const leader = order.filter((m) => Math.abs((metricValue({ ...r.cells[m.id], oracle: r.oracle }, metric) ?? 0) - best) < 1e-12);
                  return (
                    <tr key={r.key} className="border-b border-[#141414] last:border-0 transition-colors hover:bg-[#101010]">
                      <th scope="row" className="sticky left-0 z-10 max-w-[250px] bg-[#0a0a0a] px-3 py-2 text-left font-normal">
                        {r.href ? (
                          <Link to="/open-models/domains/$slug" params={{ slug: r.key }} className="text-[12.5px] text-[#ededed] transition-colors hover:text-accent">
                            {r.label}
                          </Link>
                        ) : (
                          <span className="text-[12.5px] text-[#ededed]">{r.label}</span>
                        )}
                        <span className="mt-0.5 flex items-center gap-2">
                          {r.sub && <span className="font-mono text-[9px] text-[#555]">{r.sub}</span>}
                          {r.flags.length > 0 && (
                            <span className="font-mono text-[9px] text-[#f0a5a5]" title="single-answer levels — guessing scores 100%">
                              ◆ {r.flags.join(", ")}
                            </span>
                          )}
                        </span>
                      </th>
                      {order.map((m) => {
                        const c = r.cells[m.id];
                        const v = metricValue({ ...c, oracle: r.oracle }, metric);
                        const isBest = v != null && Math.abs(v - best) < 1e-12;
                        return (
                          <td
                            key={m.id}
                            className="px-3 py-2"
                            style={{ background: isBest ? m.accent + "14" : undefined, opacity: focus == null || focus === m.id ? 1 : 0.45 }}
                          >
                            <div className="flex items-center gap-2">
                              <span className="w-11 flex-none font-mono text-[11px] tabular-nums" style={{ color: isBest ? m.accent : "#c9c9c9" }}>
                                {pct(v, 1)}
                              </span>
                              <div className="min-w-[46px] flex-1">
                                <Bar value={v} oracle={metric === "headroom" ? null : r.oracle} color={m.accent} height={5} />
                              </div>
                            </div>
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 text-center">
                        <span className="inline-flex items-center gap-1.5 font-mono text-[10px]" style={{ color: leader[0]?.accent }}>
                          <Dot color={leader[0]?.accent ?? "#666"} size={6} />
                          {leader.length === 1 ? shortName(leader[0]) : leader.length + "-way tie"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[10px] tabular-nums text-[#9a9a9a]">
                        {pct(mean(order.map((m) => metricValue({ ...r.cells[m.id], oracle: r.oracle }, metric) ?? 0)), 1)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[10px] tabular-nums text-[#666]">{pct(r.oracle, 1)}</td>
                      <td className="px-3 py-2 text-right font-mono text-[10px] tabular-nums text-[#a1a1a1]">{signed(spread(r.cells, order), 1)}</td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end">
                          <LevelSpark values={r.cells[shapeModel.id].levels} color={shapeModel.accent} />
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[10px] tabular-nums text-[#555]">{fmtInt(r.cells[order[0].id].n)}</td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={order.length + 6}>
                      <Empty>no slice matches those filters</Empty>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <p className="mt-2 font-mono text-[10px] leading-relaxed text-[#666]">
          the tinted cell in each row is the run that leads it · <span className="text-[#9a9a9a]">field mean</span> = average of all{" "}
          {a.models.length} runs (is the slice hard for everyone?) · guessing = always answering the most common ground truth for that slice
          {metric === "headroom" ? "" : "; the tick inside each bar is that floor"} · spread = best run − worst run.
        </p>
        {constDomains.length > 0 && (
          <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-[#f0a5a5]">
            ◆ {constDomains.length} domains carry a level whose ground truth is one value for all images — accuracy there is 100% by
            guessing: {constDomains.map((d) => d.label + " L" + d.const.map((c) => c.level).join("/L")).join(" · ")}
          </p>
        )}
      </Section>
    </div>
  );
}

function spread(cells: Record<string, Cell>, models: ModelEntry[]): number | null {
  const vs = models.map((m) => cells[m.id]?.acc).filter((v): v is number => v != null);
  if (vs.length < 2) return null;
  return Math.max(...vs) - Math.min(...vs);
}
