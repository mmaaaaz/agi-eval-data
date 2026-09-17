import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useOM } from "./open-models";
import { AccValue, Bar, Dot, Legend, ModelSelect, Panel, Section, Tile, TileGrid } from "../components/open-models/ui";
import { DivergeBars, LevelSpark, Scatter, shortName } from "../components/open-models/charts";
import { accOf, fmtInt, pct, ranked, signed } from "../lib/openModelsFmt";

export const Route = createFileRoute("/open-models/compare")({ component: Compare });

export function Compare() {
  const a = useOM();
  const order = ranked(a.models);
  const [aId, setAId] = useState(order[0]?.id ?? "");
  const [bId, setBId] = useState(order[1]?.id ?? order[0]?.id ?? "");
  const A = a.models.find((m) => m.id === aId) ?? order[0];
  const B = a.models.find((m) => m.id === bId) ?? order[order.length - 1];

  if (!A || !B) return <p className="font-mono text-sm text-[#a1a1a1]">Need at least one model run to compare.</p>;

  const rows = a.domains.map((d) => ({ d, ra: accOf(d, A.id) ?? 0, rb: accOf(d, B.id) ?? 0, delta: (accOf(d, A.id) ?? 0) - (accOf(d, B.id) ?? 0) }));
  const aWins = rows.filter((r) => r.delta > 0).length;
  const bWins = rows.filter((r) => r.delta < 0).length;
  const ties = rows.length - aWins - bWins;
  const sorted = [...rows].sort((x, y) => y.delta - x.delta);
  const meanDelta = rows.reduce((s, r) => s + r.delta, 0) / Math.max(1, rows.length);
  const biggest = sorted[0];
  const worst = sorted[sorted.length - 1];

  const familyRows = A.families.map((f) => {
    const g = B.families.find((x) => x.name === f.name);
    return { name: f.name, n: f.n, a: f.acc, b: g?.acc ?? null, ao: f.oracle, bo: g?.oracle ?? null, delta: (f.acc ?? 0) - (g?.acc ?? 0) };
  });

  return (
    <div>
      <Section
        eyebrow="01 head to head"
        title={A.label + " vs " + B.label}
        hint="Same questions, same ground truth, same grading rule — the difference is the model."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <ModelSelect label="A" models={order} value={aId} onChange={setAId} />
            <span className="font-mono text-[10px] text-[#555]">vs</span>
            <ModelSelect label="B" models={order} value={bId} onChange={setBId} />
            <button
              type="button"
              onClick={() => {
                setAId(bId);
                setBId(aId);
              }}
              className="rounded border border-[#262626] px-2 py-1 font-mono text-[10px] text-[#a1a1a1] transition-colors hover:border-[#404040] hover:text-white"
            >
              swap
            </button>
          </div>
        }
      >
        <TileGrid cols={4}>
          <Tile
            label={A.label}
            value={<AccValue value={A.totals.acc} ci={A.totals.ci} color={A.accent} size="md" width={54} />}
            accent={A.accent}
            sub={fmtInt(aWins) + " of " + rows.length + " domains ahead"}
          />
          <Tile
            label={B.label}
            value={<AccValue value={B.totals.acc} ci={B.totals.ci} color={B.accent} size="md" width={54} />}
            accent={B.accent}
            sub={fmtInt(bWins) + " ahead · " + fmtInt(ties) + " tied"}
          />
          <Tile
            label="mean domain gap"
            value={signed(meanDelta, 1)}
            sub="A − B in accuracy points"
          />
          <Tile
            label="largest swing"
            value={biggest ? biggest.d.label : "—"}
            sub={biggest ? signed(biggest.delta, 1) + " · " + (worst ? "narrowest " + worst.d.label + " " + signed(worst.delta, 1) : "") : ""}
          />
        </TileGrid>

        <div className="mt-3 grid gap-3 lg:grid-cols-[440px_minmax(0,1fr)]">
          <Panel className="p-4">
            <p className="font-mono text-[9px] uppercase tracking-widest text-[#666]">per-domain accuracy, plotted 1:1</p>
            <div className="mt-3">
              <Scatter domains={a.domains} a={A} b={B} />
            </div>
            <p className="mt-2 text-[11.5px] leading-relaxed text-[#a1a1a1]">
              Points on the diagonal are drawn. Distance above the line is where {B.label} leads; below, {A.label}.
            </p>
          </Panel>
          <Panel className="p-4">
            <p className="font-mono text-[9px] uppercase tracking-widest text-[#666]">domain gaps, sorted</p>
            <div className="mt-3">
              <DivergeBars domains={a.domains} a={A} b={B} limit={rows.length} />
            </div>
          </Panel>
        </div>
      </Section>

      <Section eyebrow="02 families and levels" title="Where the lead is built">
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel className="p-4">
            <Legend items={[{ color: A.accent, label: A.label }, { color: B.accent, label: B.label }]} />
            <table className="mt-3 w-full text-left">
              <thead>
                <tr className="font-mono text-[9px] uppercase tracking-widest text-[#666]">
                  <th className="py-1.5 pr-2 font-normal">family</th>
                  <th className="px-2 py-1.5 text-right font-normal">{shortName(A)}</th>
                  <th className="px-2 py-1.5 text-right font-normal">{shortName(B)}</th>
                  <th className="px-2 py-1.5 text-right font-normal">Δ</th>
                  <th className="py-1.5 pl-2 font-normal">gap</th>
                </tr>
              </thead>
              <tbody>
                {familyRows.map((f) => (
                  <tr key={f.name} className="border-t border-[#141414]">
                    <th scope="row" className="max-w-[150px] py-2 pr-2 text-left text-[12px] font-normal text-[#ededed]">
                      {f.name}
                    </th>
                    <td className="px-2 py-2 text-right font-mono text-[11px] tabular-nums" style={{ color: A.accent }}>
                      {pct(f.a, 1)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-[11px] tabular-nums" style={{ color: B.accent }}>
                      {pct(f.b, 1)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-[11px] tabular-nums text-[#a1a1a1]">{signed(f.delta, 1)}</td>
                    <td className="w-[90px] py-2 pl-2">
                      <div className="relative h-[9px] rounded-sm bg-[#141414]">
                        <span className="absolute inset-y-0 left-1/2 w-px bg-[#333]" />
                        <span
                          className="absolute inset-y-[1px] rounded-sm"
                          style={{
                            width: Math.min(50, (Math.abs(f.delta) / 0.25) * 50) + "%",
                            left: f.delta >= 0 ? "50%" : 50 - Math.min(50, (Math.abs(f.delta) / 0.25) * 50) + "%",
                            background: f.delta >= 0 ? A.accent : B.accent,
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel className="p-4">
            <Legend items={[{ color: A.accent, label: A.label }, { color: B.accent, label: B.label }]} />
            <table className="mt-3 w-full text-left">
              <thead>
                <tr className="font-mono text-[9px] uppercase tracking-widest text-[#666]">
                  <th className="py-1.5 pr-2 font-normal">level</th>
                  <th className="px-2 py-1.5 font-normal">{shortName(A)}</th>
                  <th className="px-2 py-1.5 font-normal">{shortName(B)}</th>
                  <th className="px-2 py-1.5 text-right font-normal">Δ</th>
                  <th className="py-1.5 pl-2 text-right font-normal">oracle</th>
                </tr>
              </thead>
              <tbody>
                {a.benchmark.levels.map((lv, i) => {
                  const la = A.totals.levels[i];
                  const lb = B.totals.levels[i];
                  const delta = (la.acc ?? 0) - (lb.acc ?? 0);
                  return (
                    <tr key={lv.n} className="border-t border-[#141414]">
                      <th scope="row" className="py-2 pr-2 text-left font-normal">
                        <span className="font-mono text-[11px] text-white">L{lv.n}</span>
                        <span className="ml-2 font-mono text-[10px] text-[#666]">{lv.short}</span>
                      </th>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-2">
                          <span className="w-11 font-mono text-[11px] tabular-nums" style={{ color: A.accent }}>
                            {pct(la.acc, 1)}
                          </span>
                          <div className="min-w-[50px] flex-1">
                            <Bar value={la.acc} oracle={la.oracle ?? null} color={A.accent} height={5} />
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-2">
                          <span className="w-11 font-mono text-[11px] tabular-nums" style={{ color: B.accent }}>
                            {pct(lb.acc, 1)}
                          </span>
                          <div className="min-w-[50px] flex-1">
                            <Bar value={lb.acc} oracle={lb.oracle ?? null} color={B.accent} height={5} />
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-[11px] tabular-nums text-[#a1a1a1]">{signed(delta, 1)}</td>
                      <td className="py-2 pl-2 text-right font-mono text-[10px] tabular-nums text-[#666]">{pct(la.oracle ?? null, 1)}</td>
                    </tr>
                  );
                })}
                <tr className="border-t border-[#262626]">
                  <th scope="row" className="py-2 pr-2 text-left font-mono text-[11px] text-white">
                    all
                  </th>
                  <td className="px-2 py-2 font-mono text-[12px] font-semibold tabular-nums" style={{ color: A.accent }}>
                    {pct(A.totals.acc, 2)}
                  </td>
                  <td className="px-2 py-2 font-mono text-[12px] font-semibold tabular-nums" style={{ color: B.accent }}>
                    {pct(B.totals.acc, 2)}
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-[11px] tabular-nums text-[#a1a1a1]">
                    {signed((A.totals.acc ?? 0) - (B.totals.acc ?? 0), 2)}
                  </td>
                  <td className="py-2 pl-2 text-right font-mono text-[10px] text-[#666]">{pct(A.totals.oracle, 1)}</td>
                </tr>
              </tbody>
            </table>
          </Panel>
        </div>
      </Section>

      <Section eyebrow="03 domain pairing" title="Every domain, side by side" hint="Sorted by the gap. Sparklines are each model's L1–L5 shape inside that domain.">
        <Panel>
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full min-w-[820px] text-left">
              <thead>
                <tr className="sticky top-0 z-10 bg-[#0a0a0a] font-mono text-[9px] uppercase tracking-widest text-[#666]">
                  <th className="px-3 py-2 font-normal">domain</th>
                  <th className="px-3 py-2 font-normal">{A.label}</th>
                  <th className="px-3 py-2 font-normal">{B.label}</th>
                  <th className="px-3 py-2 text-right font-normal">Δ</th>
                  <th className="px-3 py-2 text-right font-normal">oracle</th>
                  <th className="px-3 py-2 text-right font-normal">n</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const ra = r.d.per.find((p) => p.model === A.id);
                  const rb = r.d.per.find((p) => p.model === B.id);
                  return (
                    <tr key={r.d.key} className="border-t border-[#141414] transition-colors hover:bg-[#101010]">
                      <th scope="row" className="max-w-[220px] px-3 py-2 text-left font-normal">
                        <Link to="/open-models/domains/$slug" params={{ slug: r.d.key }} className="text-[12.5px] text-[#ededed] hover:text-accent">
                          {r.d.label}
                        </Link>
                        <span className="mt-0.5 block font-mono text-[9px] text-[#555]">{r.d.familyName}</span>
                      </th>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="w-11 flex-none font-mono text-[11px] tabular-nums" style={{ color: A.accent }}>
                            {pct(ra?.acc ?? null, 1)}
                          </span>
                          <LevelSpark values={(ra?.levels ?? []).map((l) => l.acc ?? null)} color={A.accent} />
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="w-11 flex-none font-mono text-[11px] tabular-nums" style={{ color: B.accent }}>
                            {pct(rb?.acc ?? null, 1)}
                          </span>
                          <LevelSpark values={(rb?.levels ?? []).map((l) => l.acc ?? null)} color={B.accent} />
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums" style={{ color: r.delta >= 0 ? A.accent : B.accent }}>
                        {signed(r.delta, 1)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[10px] tabular-nums text-[#666]">{pct(r.d.oracle, 1)}</td>
                      <td className="px-3 py-2 text-right font-mono text-[10px] tabular-nums text-[#666]">{fmtInt(r.d.n)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
        <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-[#666]">
          <span className="inline-flex items-center gap-1.5">
            <Dot color={A.accent} size={6} /> {A.label} · {fmtInt(A.totals.images)} images · parse fail {pct(A.totals.pfRate, 2)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Dot color={B.accent} size={6} /> {B.label} · {fmtInt(B.totals.images)} images · parse fail {pct(B.totals.pfRate, 2)}
          </span>
        </p>
      </Section>
    </div>
  );
}
