import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useFocus, useOM } from "./open-models";
import { Dot, Panel, Section, Seg, Tile, TileGrid } from "../components/open-models/ui";
import { HeatGrid, WinnerGrid, shortName } from "../components/open-models/charts";
import { METRICS, type Metric, fmtInt, metricValue, pct, ranked, signed } from "../lib/openModelsFmt";
import type { Domain, ModelEntry } from "../lib/openModelsTypes";

export const Route = createFileRoute("/open-models/matrix")({ component: MatrixPage });

type Mode = "values" | "winners";

function winnersOf(d: Domain, i: number) {
  const cells = d.per.map((p) => ({ p, v: p.levels[i]?.acc ?? 0, oracle: p.levels[i]?.oracle ?? null }));
  const best = Math.max(...cells.map((c) => c.v));
  return { tied: cells.filter((c) => Math.abs(c.v - best) < 1e-12), best, oracle: cells[0]?.oracle ?? null };
}

export function MatrixPage() {
  const a = useOM();
  const { focus, setFocus } = useFocus();
  const order = ranked(a.models);
  const [mode, setMode] = useState<Mode>("values");
  const [modelId, setModelId] = useState(order[0]?.id ?? a.models[0].id);
  const [metric, setMetric] = useState<Metric>("acc");
  const model = a.models.find((m) => m.id === modelId) ?? order[0];

  // per-level totals for the chosen model, and for the whole field in winners mode
  const perLevel = a.benchmark.levels.map((lv, i) => {
    let n = 0;
    let ok = 0;
    let oracle = 0;
    for (const d of a.domains) {
      const l = d.per.find((p) => p.model === model.id)?.levels[i];
      if (!l) continue;
      n += l.n;
      ok += (l.acc ?? 0) * l.n;
      oracle += (l.oracle ?? 0) * l.n;
    }
    const fieldWins = order.map((m) => ({
      m,
      wins: a.domains.filter((d) => winnersOf(d, i).tied.some((t) => t.p.model === m.id)).length,
    }));
    const top = [...fieldWins].sort((x, y) => y.wins - x.wins)[0];
    return { lv, n, acc: n ? ok / n : null, oracle: n ? oracle / n : null, top, wins: fieldWins };
  });

  const best = [...a.domains]
    .map((d) => ({ d, v: metricValue({ ...d.per.find((p) => p.model === model.id)!, oracle: d.oracle }, metric) }))
    .filter((x) => x.v != null)
    .sort((x, y) => (y.v ?? 0) - (x.v ?? 0));

  return (
    <div>
      <Section
        eyebrow="01 matrix"
        title={mode === "values" ? "One run, the whole benchmark" : "Who leads every cell"}
        hint={
          mode === "values"
            ? "34 domains x 5 levels shaded by " + (METRICS.find((m) => m.id === metric)?.short ?? metric) + ", grouped by reasoning family; the last column is the domain's all-levels score."
            : "Each tile is coloured by the run with the highest frozen-rule accuracy in that cell. Use it to see where the field splits rather than who wins overall."
        }
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Seg
              value={mode}
              onChange={setMode}
              options={[
                { id: "values", label: "values" },
                { id: "winners", label: "winners" },
              ]}
            />
            {mode === "values" && (
              <>
                <Seg value={modelId} onChange={setModelId} options={order.map((m) => ({ id: m.id, label: shortName(m) }))} />
                <Seg value={metric} onChange={setMetric} options={METRICS.map((m) => ({ id: m.id, label: m.short, hint: m.hint }))} />
              </>
            )}
          </div>
        }
      >
        <Panel className="p-3 sm:p-4">
          {mode === "values" ? (
            <HeatGrid domains={a.domains} levels={a.benchmark.levels} model={model} metric={metric} families={a.benchmark.families} />
          ) : (
            <WinnerGrid domains={a.domains} levels={a.benchmark.levels} models={order} families={a.benchmark.families} focus={focus} />
          )}
        </Panel>
      </Section>

      <Section
        eyebrow="02 levels"
        title={mode === "values" ? "Level totals for " + model.label : "Cells won per level"}
        hint={
          mode === "values"
            ? "How the chosen run accumulates across the ladder, with the baseline for scale and how far ahead of it the run sits."
            : "Across the 34 domains in each level, how many cells each run leads."
        }
      >
        {mode === "values" ? (
          <TileGrid cols={3}>
            {perLevel.map((p) => (
              <Tile
                key={p.lv.n}
                label={"L" + p.lv.n + " · " + p.lv.task}
                value={pct(p.acc, 2)}
                accent={model.accent}
                sub={"baseline " + pct(p.oracle, 1) + " · n=" + fmtInt(p.n) + " · " + signed((p.acc ?? 0) - (p.oracle ?? 0), 1) + " over baseline"}
              />
            ))}
            <Tile
              label="all levels"
              value={pct(model.totals.acc, 2)}
              accent={model.accent}
              sub={"baseline " + pct(model.totals.oracle, 1) + " · " + signed(model.totals.headroom, 1) + " over baseline"}
            />
          </TileGrid>
        ) : (
          <Panel className="p-4">
            <div className="space-y-3">
              {perLevel.map((p) => (
                <div key={p.lv.n} className="grid grid-cols-[92px_1fr] items-center gap-3">
                  <div className="font-mono text-[11px] text-[#a1a1a1]">
                    L{p.lv.n} <span className="text-[9px] text-[#555]">{p.lv.short}</span>
                  </div>
                  <div className="flex h-[18px] overflow-hidden rounded-sm bg-[#141414]">
                    {order.map((m) => {
                      const w = p.wins.find((x) => x.m.id === m.id)?.wins ?? 0;
                      return (
                        <span
                          key={m.id}
                          title={m.label + " · " + w + " of " + a.domains.length + " domains"}
                          style={{ width: (w / a.domains.length) * 100 + "%", background: m.accent, opacity: w ? 0.92 : 0 }}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 grid gap-x-6 gap-y-1.5 sm:grid-cols-3">
              {order.map((m) => {
                const total = perLevel.reduce((s, p) => s + (p.wins.find((x) => x.m.id === m.id)?.wins ?? 0), 0);
                return (
                  <button key={m.id} type="button" onClick={() => setFocus(focus === m.id ? null : m.id)} className="flex items-center gap-2 text-left">
                    <Dot color={m.accent} size={7} />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#c9c9c9]">{shortName(m)}</span>
                    <span className="font-mono text-[11px] tabular-nums" style={{ color: total ? m.accent : "#555" }}>
                      {total} / {a.domains.length * 5}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 font-mono text-[10px] leading-relaxed text-[#666]">
              Cells where every run scores zero are counted as won by nobody: {a.audit.zeroFrozen.length} of the {a.domains.length * 5}{" "}
              cells are unsolved by all {a.models.length} runs.
            </p>
          </Panel>
        )}
      </Section>

      {mode === "values" && (
        <Section eyebrow="03 slices" title={"Best and worst for " + model.label}>
          <div className="grid gap-3 sm:grid-cols-2">
            {[best.slice(0, 6), best.slice(-6).reverse()].map((list, li) => (
              <Panel key={li} className="p-3.5">
                <p className="mb-2 font-mono text-[9px] uppercase tracking-widest text-[#666]">
                  {METRICS.find((m) => m.id === metric)?.short} · {li === 0 ? "highest" : "lowest"}
                </p>
                <ul className="divide-y divide-[#141414]">
                  {list.map((x) => (
                    <li key={x.d.key} className="flex items-baseline justify-between gap-3 py-1.5">
                      <Link to="/open-models/domains/$slug" params={{ slug: x.d.key }} className="truncate text-[12.5px] text-[#ededed] hover:text-accent">
                        {x.d.label}
                      </Link>
                      <span className="font-mono text-[11px] tabular-nums" style={{ color: model.accent }}>
                        {pct(x.v, 1)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

export type { ModelEntry };
