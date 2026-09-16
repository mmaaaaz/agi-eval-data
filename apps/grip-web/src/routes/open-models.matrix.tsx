import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useOM } from "./open-models";
import { Panel, Section, Seg, Tile, TileGrid } from "../components/open-models/ui";
import { HeatGrid } from "../components/open-models/charts";
import { METRICS, type Metric, fmtInt, metricValue, pct, ranked, signed } from "../lib/openModelsFmt";

export const Route = createFileRoute("/open-models/matrix")({ component: MatrixPage });

export function MatrixPage() {
  const a = useOM();
  const order = ranked(a.models);
  const [modelId, setModelId] = useState(order[0]?.id ?? a.models[0].id);
  const [metric, setMetric] = useState<Metric>("acc");
  const model = a.models.find((m) => m.id === modelId) ?? order[0];

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
    return { lv, n, acc: n ? ok / n : null, oracle: n ? oracle / n : null };
  });

  const best = [...a.domains]
    .map((d) => ({ d, v: metricValue({ ...d.per.find((p) => p.model === model.id)!, oracle: d.oracle }, metric) }))
    .filter((x) => x.v != null)
    .sort((x, y) => (y.v ?? 0) - (x.v ?? 0));

  return (
    <div>
      <Section
        eyebrow="01 matrix"
        title="The whole benchmark on one screen"
        hint={
          <>
            {a.domains.length} domains × 5 levels, shaded by {METRICS.find((m) => m.id === metric)?.short}. Rows are grouped by reasoning
            family; the final column is the domain's all-levels score.
          </>
        }
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Seg
              label="model"
              value={modelId}
              onChange={setModelId}
              options={order.map((m) => ({ id: m.id, label: m.label }))}
            />
            <Seg label="metric" value={metric} onChange={setMetric} options={METRICS.map((m) => ({ id: m.id, label: m.short, hint: m.hint }))} />
          </div>
        }
      >
        <Panel className="p-3 sm:p-4">
          <HeatGrid domains={a.domains} levels={a.benchmark.levels} model={model} metric={metric} families={a.benchmark.families} />
        </Panel>
      </Section>

      <Section eyebrow="02 margins" title="Level totals and the constant-level problem">
        <TileGrid cols={4}>
          {perLevel.map((p) => (
            <Tile
              key={p.lv.n}
              label={"L" + p.lv.n + " · " + p.lv.task}
              value={pct(p.acc, 2)}
              accent={model.accent}
              sub={
                "oracle " + pct(p.oracle, 1) + " · n=" + fmtInt(p.n) + " · " + signed((p.acc ?? 0) - (p.oracle ?? 0), 1) + " over blind"
              }
            />
          ))}
          <Tile
            label="all levels"
            value={pct(model.totals.acc, 2)}
            accent={model.accent}
            sub={"oracle " + pct(model.totals.oracle, 1) + " · headroom " + signed(model.totals.headroom, 1)}
          />
        </TileGrid>

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Panel className="p-4">
            <p className="font-mono text-[9px] uppercase tracking-widest text-[#666]">
              {METRICS.find((m) => m.id === metric)?.short} — best and worst slices for {model.label}
            </p>
            <div className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
              <ol className="space-y-1">
                {best.slice(0, 6).map((x) => (
                  <li key={x.d.key} className="flex items-baseline justify-between gap-3 border-b border-[#141414] py-1.5">
                    <Link to="/open-models/domains/$slug" params={{ slug: x.d.key }} className="truncate text-[12.5px] text-[#ededed] hover:text-accent">
                      {x.d.label}
                    </Link>
                    <span className="font-mono text-[11px] tabular-nums" style={{ color: model.accent }}>
                      {pct(x.v, 1)}
                    </span>
                  </li>
                ))}
              </ol>
              <ol className="space-y-1">
                {best.slice(-6).reverse().map((x) => (
                  <li key={x.d.key} className="flex items-baseline justify-between gap-3 border-b border-[#141414] py-1.5">
                    <Link to="/open-models/domains/$slug" params={{ slug: x.d.key }} className="truncate text-[12.5px] text-[#ededed] hover:text-accent">
                      {x.d.label}
                    </Link>
                    <span className="font-mono text-[11px] tabular-nums text-[#a1a1a1]">{pct(x.v, 1)}</span>
                  </li>
                ))}
              </ol>
            </div>
          </Panel>
          <Panel className="p-4">
            <p className="font-mono text-[9px] uppercase tracking-widest text-[#666]">read the grid honestly</p>
            <ul className="mt-3 space-y-2.5 text-[12.5px] leading-relaxed text-[#a1a1a1]">
              <li>
                <b className="text-[#ededed]">{a.audit.constantLevels.length} cells</b> are marked with a single-answer level, so a model
                can score 100% there without reading the image. They are listed on the audit page.
              </li>
              <li>
                A cell near its level's oracle is mostly <b className="text-[#ededed]">guessable</b>; the oracle column on each domain page
                gives that floor.
              </li>
              <li>
                {a.audit.zeroFrozen.length} cells score <b className="text-[#ededed]">zero for every model</b> under the frozen rule — the
                benchmark's unsolved core.
              </li>
            </ul>
            <p className="mt-4 font-mono text-[10px] text-[#555]">
              Switch the model or the metric with the controls above the grid; every cell, tile and list follows.
            </p>
          </Panel>
        </div>
      </Section>
    </div>
  );
}
