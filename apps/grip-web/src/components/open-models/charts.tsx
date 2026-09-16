/** Hand-rolled SVG/HTML charts - no chart dependency, full control over ink. */
import { Fragment, useState } from "react";
import type { Domain, LevelDef, ModelEntry } from "../../lib/openModelsTypes";
import { METRICS, type Metric, fmtInt, inkOn, metricValue, pct, ramp } from "../../lib/openModelsFmt";
import { Bar, Legend } from "./ui";

const metricLabel = (m: Metric) => METRICS.find((x) => x.id === m)?.short ?? m;

/* ------------------------------------------------------------ level curve --- */

export function LevelCurve({
  models,
  levels,
  metric,
}: {
  models: ModelEntry[];
  levels: LevelDef[];
  metric: Metric;
}) {
  const W = 760;
  const H = 280;
  const padL = 42;
  const padR = 12;
  const padT = 26;
  const padB = 52;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const slot = plotW / levels.length;
  const barW = Math.min(26, (slot - 26) / Math.max(1, models.length));
  const maxV = 0.6;
  const y = (v: number) => padT + plotH - (Math.max(0, Math.min(maxV, v)) / maxV) * plotH;

  const oracleByLevel = levels.map((_, i) => models[0]?.totals.levels[i]?.oracle ?? null);

  return (
    <div>
      <Legend
        items={[
          ...models.map((m) => ({ color: m.accent, label: m.label })),
          { color: "#666", label: "majority-answer oracle", dash: true },
        ]}
      />
      <svg viewBox={"0 0 " + W + " " + H} className="mt-3 h-auto w-full" role="img" aria-label="Accuracy by difficulty level">
        {[0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6].map((v) => (
          <g key={v}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke={v === 0 ? "#333" : "#1c1c1c"} strokeWidth="1" />
            <text x={padL - 8} y={y(v) + 3.5} textAnchor="end" className="fill-[#666] font-mono text-[10px]">
              {Math.round(v * 100)}
            </text>
          </g>
        ))}
        {levels.map((lv, i) => {
          const cx = padL + slot * i + slot / 2;
          const groupW = barW * models.length + 4 * (models.length - 1);
          const x0 = cx - groupW / 2;
          return (
            <g key={lv.n}>
              {models.map((m, mi) => {
                const v = metricValue(m.totals.levels[i], metric) ?? 0;
                const bx = x0 + mi * (barW + 4);
                return (
                  <g key={m.id}>
                    <rect x={bx} y={y(v)} width={barW} height={Math.max(1, padT + plotH - y(v))} rx="2" fill={m.accent} opacity="0.92" />
                    <text
                      x={bx + barW / 2}
                      y={y(v) - 6}
                      textAnchor="middle"
                      className="font-mono text-[10px] tabular-nums"
                      fill={m.accent}
                    >
                      {(v * 100).toFixed(1)}
                    </text>
                  </g>
                );
              })}
              {oracleByLevel[i] != null && (
                <line
                  x1={cx - slot / 2 + 8}
                  x2={cx + slot / 2 - 8}
                  y1={y(oracleByLevel[i] as number)}
                  y2={y(oracleByLevel[i] as number)}
                  stroke="#8a8a8a"
                  strokeWidth="1.5"
                  strokeDasharray="3 3"
                />
              )}
              <text x={cx} y={H - 32} textAnchor="middle" className="fill-[#ededed] font-mono text-[11px]">
                L{lv.n}
              </text>
              <text x={cx} y={H - 18} textAnchor="middle" className="fill-[#666] font-mono text-[9px] uppercase tracking-wider">
                {lv.short}
              </text>
              <text x={cx} y={H - 5} textAnchor="middle" className="fill-[#555] font-mono text-[9px]">
                n={fmtInt(models[0]?.totals.levels[i]?.n ?? 0)}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-1 font-mono text-[10px] text-[#666]">
        Y axis capped at 60% to keep the gap legible · bars = {metricLabel(metric)} · dashed line = the level's majority-answer oracle.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------ family bars --- */

export function FamilyBars({
  models,
  metric,
  onSelect,
}: {
  models: ModelEntry[];
  metric: Metric;
  onSelect?: (family: string) => void;
}) {
  const names = models[0]?.families.map((f) => f.name) ?? [];
  const max = Math.max(0.35, ...models.flatMap((m) => m.families.map((f) => metricValue(f, metric) ?? 0)));
  return (
    <div className="space-y-3">
      {names.map((name, fi) => {
        const oracle = models[0].families[fi].oracle;
        return (
          <div key={name} className="grid grid-cols-[130px_1fr] items-center gap-3 sm:grid-cols-[168px_1fr]">
            <button
              type="button"
              onClick={() => onSelect?.(name)}
              className="text-left font-mono text-[11px] text-[#a1a1a1] transition-colors hover:text-white"
            >
              {name}
            </button>
            <div className="space-y-1">
              {models.map((m) => {
                const f = m.families[fi];
                const v = metricValue(f, metric);
                return (
                  <div key={m.id} className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <Bar value={v} oracle={metric === "headroom" ? null : oracle} color={m.accent} max={max} height={7} />
                    </div>
                    <span className="w-11 flex-none text-right font-mono text-[10px] tabular-nums" style={{ color: m.accent }}>
                      {v == null ? "—" : pct(v, 1)}
                    </span>
                    <span className="hidden w-16 flex-none text-right font-mono text-[9px] text-[#555] sm:block">
                      n={fmtInt(f.n)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------- diverging bars --- */

export function DivergeBars({
  domains,
  a,
  b,
  limit = 12,
}: {
  domains: Domain[];
  a: ModelEntry;
  b: ModelEntry;
  limit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const rows = domains
    .map((d) => {
      const ra = d.per.find((p) => p.model === a.id)?.acc ?? 0;
      const rb = d.per.find((p) => p.model === b.id)?.acc ?? 0;
      return { d, ra, rb, delta: ra - rb };
    })
    .sort((x, y) => y.delta - x.delta);
  const shown = expanded ? rows : [...rows.slice(0, limit / 2), ...rows.slice(-limit / 2)];
  const max = Math.max(0.1, ...rows.map((r) => Math.abs(r.delta)));

  return (
    <div>
      <div className="mb-2 flex items-center justify-between font-mono text-[10px] text-[#666]">
        <span>← {b.label} ahead</span>
        <span>{a.label} ahead →</span>
      </div>
      <div className="space-y-[5px]">
        {shown.map((r) => {
          const w = (Math.abs(r.delta) / max) * 50;
          const aAhead = r.delta >= 0;
          return (
            <div key={r.d.key} className="grid grid-cols-[150px_1fr_58px] items-center gap-2 sm:grid-cols-[190px_1fr_58px]">
              <span className="truncate text-right font-mono text-[11px] text-[#a1a1a1]">{r.d.label}</span>
              <div className="relative h-[13px] rounded-sm bg-[#101010]">
                <span className="absolute inset-y-0 left-1/2 w-px bg-[#333]" />
                <span
                  className="absolute top-[2px] bottom-[2px] rounded-sm"
                  style={{
                    background: aAhead ? a.accent : b.accent,
                    left: aAhead ? "50%" : 50 - w + "%",
                    width: w + "%",
                  }}
                />
              </div>
              <span className="text-right font-mono text-[10px] tabular-nums" style={{ color: aAhead ? a.accent : b.accent }}>
                {r.delta > 0 ? "+" : ""}
                {(r.delta * 100).toFixed(1)}
              </span>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-3 rounded border border-[#262626] px-2.5 py-1 font-mono text-[10px] text-[#a1a1a1] transition-colors hover:border-[#404040] hover:text-white"
      >
        {expanded ? "show extremes only" : "show all " + rows.length + " domains"}
      </button>
    </div>
  );
}

/* --------------------------------------------------------------- heat grid --- */

export function HeatGrid({
  domains,
  levels,
  model,
  metric,
  families,
}: {
  domains: Domain[];
  levels: LevelDef[];
  model: ModelEntry;
  metric: Metric;
  families: string[];
}) {
  const [hover, setHover] = useState<{ label: string; text: string } | null>(null);
  const cells = domains.flatMap((d) => {
    const row = d.per.find((p) => p.model === model.id);
    return (row?.levels ?? []).map((l) => metricValue(l, metric));
  });
  const max = Math.max(0.35, ...cells.filter((c): c is number => c != null));

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-[#0a0a0a] px-2 pb-1.5 text-left font-mono text-[9px] uppercase tracking-widest text-[#666]">
                domain
              </th>
              {levels.map((lv) => (
                <th key={lv.n} className="px-1 pb-1.5 text-center font-mono text-[9px] uppercase tracking-widest text-[#666]">
                  <div className="text-[#a1a1a1]">L{lv.n}</div>
                  <div className="text-[8px] normal-case tracking-normal text-[#555]">{lv.short}</div>
                </th>
              ))}
              <th className="px-1 pb-1.5 text-center font-mono text-[9px] uppercase tracking-widest text-[#666]">all</th>
            </tr>
          </thead>
          <tbody>
            {families.map((fam) => (
              <Fragment key={fam}>
                <tr>
                  <td
                    colSpan={levels.length + 2}
                    className="sticky left-0 bg-[#0a0a0a] px-2 pt-3 pb-1 text-left font-mono text-[9px] uppercase tracking-[0.18em] text-[#555]"
                  >
                    {fam}
                  </td>
                </tr>
                {domains
                  .filter((d) => d.familyName === fam)
                  .map((d) => {
                    const row = d.per.find((p) => p.model === model.id);
                    const overall = row ? metricValue({ ...row, oracle: d.oracle }, metric) : null;
                    return (
                      <tr key={d.key}>
                        <th
                          scope="row"
                          className="sticky left-0 z-10 max-w-[190px] truncate bg-[#0a0a0a] py-[3px] pr-2 text-left font-normal"
                        >
                          <a
                            href={"/open-models/domains/" + d.key}
                            className="font-mono text-[11px] text-[#c9c9c9] transition-colors hover:text-accent"
                          >
                            {d.label}
                          </a>
                        </th>
                        {levels.map((lv, i) => {
                          const l = row?.levels[i];
                          const v = l ? metricValue(l, metric) : null;
                          const t = v == null ? 0 : Math.max(0, Math.min(1, v / max));
                          return (
                            <td key={lv.n} className="p-[2px]">
                              <div
                                onMouseEnter={() =>
                                  setHover({
                                    label: d.label + " · L" + lv.n,
                                    text:
                                      (v == null ? "no data" : metricLabel(metric) + " " + pct(v, 1)) +
                                      " · n=" + fmtInt(l?.n ?? 0) +
                                      " · oracle " + pct(l?.oracle ?? null, 1) +
                                      " · partial " + pct(l?.partial ?? null, 1),
                                  })
                                }
                                onMouseLeave={() => setHover(null)}
                                title={
                                  d.label + " L" + lv.n + " · " + metricLabel(metric) + " " + pct(v, 1) +
                                  " · oracle " + pct(l?.oracle ?? null, 1)
                                }
                                className="flex h-[26px] items-center justify-center rounded-[3px] font-mono text-[10px] tabular-nums transition-transform duration-150 hover:scale-[1.06]"
                                style={{ background: ramp(t), color: inkOn(t) }}
                              >
                                {v == null ? "" : (v * 100).toFixed(0)}
                              </div>
                            </td>
                          );
                        })}
                        <td className="p-[2px]">
                          <div
                            className="flex h-[26px] items-center justify-center rounded-[3px] border border-[#262626] font-mono text-[10px] font-semibold tabular-nums text-white"
                            title={d.label + " · all levels · " + pct(overall, 1)}
                          >
                            {overall == null ? "—" : (overall * 100).toFixed(1)}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[9px] text-[#666]">0%</span>
          {[0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => (
            <span key={t} className="h-2.5 w-6 rounded-[2px]" style={{ background: ramp(t) }} />
          ))}
          <span className="font-mono text-[9px] text-[#666]">{(max * 100).toFixed(0)}%+</span>
        </div>
        <p className="font-mono text-[10px] text-[#666]">
          {model.label} · {metricLabel(metric)} per cell · hover for counts, oracle and partial credit
        </p>
      </div>
      <div className="mt-2 min-h-[16px] font-mono text-[10px] text-[#a1a1a1]">
        {hover ? hover.label + " — " + hover.text : ""}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- scatter --- */

export function Scatter({ domains, a, b }: { domains: Domain[]; a: ModelEntry; b: ModelEntry }) {
  const S = 440;
  const pad = 40;
  const plot = S - pad * 2;
  const pts = domains
    .map((d) => ({
      d,
      x: d.per.find((p) => p.model === a.id)?.acc ?? 0,
      y: d.per.find((p) => p.model === b.id)?.acc ?? 0,
    }))
    .sort((p, q) => p.y - q.y);
  const maxV = Math.max(0.35, ...pts.flatMap((p) => [p.x, p.y]));
  const sx = (v: number) => pad + (v / maxV) * plot;
  const sy = (v: number) => S - pad - (v / maxV) * plot;
  return (
    <div>
      <svg viewBox={"0 0 " + S + " " + S} className="h-auto w-full max-w-[520px]" role="img" aria-label={a.label + " versus " + b.label}>
        <rect x={pad} y={pad} width={plot} height={plot} fill="#0a0a0a" stroke="#1c1c1c" />
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={pad} x2={S - pad} y1={sy(maxV * f)} y2={sy(maxV * f)} stroke="#151515" />
            <line x1={sx(maxV * f)} x2={sx(maxV * f)} y1={pad} y2={S - pad} stroke="#151515" />
            <text x={pad - 6} y={sy(maxV * f) + 3} textAnchor="end" className="fill-[#555] font-mono text-[9px]">
              {Math.round(maxV * f * 100)}
            </text>
            <text x={sx(maxV * f)} y={S - pad + 12} textAnchor="middle" className="fill-[#555] font-mono text-[9px]">
              {Math.round(maxV * f * 100)}
            </text>
          </g>
        ))}
        <line x1={sx(0)} y1={sy(0)} x2={sx(maxV)} y2={sy(maxV)} stroke="#444" strokeDasharray="4 4" />
        {pts.map((p) => (
          <g key={p.d.key}>
            <title>{p.d.label + " — " + a.label + " " + pct(p.x, 1) + " · " + b.label + " " + pct(p.y, 1)}</title>
            <circle cx={sx(p.x)} cy={sy(p.y)} r="4" fill={p.y > p.x ? b.accent : a.accent} fillOpacity="0.85" stroke="#000" strokeWidth="0.8" />
          </g>
        ))}
        <text x={S / 2} y={S - 6} textAnchor="middle" className="fill-[#666] font-mono text-[9px]">
          {a.label} accuracy →
        </text>
        <text x={10} y={S / 2} textAnchor="middle" transform={"rotate(-90 10 " + S / 2 + ")"} className="fill-[#666] font-mono text-[9px]">
          {b.label} accuracy →
        </text>
      </svg>
      <Legend items={[{ color: a.accent, label: a.label + " leads" }, { color: b.accent, label: b.label + " leads" }]} />
    </div>
  );
}

/* ------------------------------------------------------------- level table --- */

export type LevelCell = {
  acc: number | null;
  as?: number | null;
  partial: number | null;
  n: number;
  pf?: number;
  oracle?: number | null;
};

/** One row per difficulty level, one bar per model, oracle tick in the track. */
export function LevelTable({
  levels,
  series,
}: {
  levels: LevelDef[];
  series: { label: string; accent: string; cells: LevelCell[] }[];
}) {
  const max = Math.max(0.35, ...series.flatMap((s) => s.cells.map((c) => c.acc ?? 0)));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left">
        <thead>
          <tr className="font-mono text-[9px] uppercase tracking-widest text-[#666]">
            <th className="px-3 py-2 font-normal">level</th>
            {series.map((s) => (
              <th key={s.label} className="px-3 py-2 font-normal">
                <span style={{ color: s.accent }}>{s.label}</span>
              </th>
            ))}
            <th className="px-3 py-2 text-right font-normal">oracle</th>
            <th className="px-3 py-2 text-right font-normal">n</th>
          </tr>
        </thead>
        <tbody>
          {levels.map((lv) => (
            <tr key={lv.n} className="border-b border-[#141414] last:border-0">
              <th scope="row" className="px-3 py-2.5 text-left font-normal">
                <span className="font-mono text-[11px] text-white">L{lv.n}</span>
                <span className="ml-2 font-mono text-[10px] text-[#666]">{lv.task}</span>
                <span className="block max-w-[46ch] text-[11px] leading-snug text-[#555]">{lv.desc}</span>
              </th>
              {series.map((s) => {
                const c = s.cells[lv.n - 1];
                return (
                  <td key={s.label} className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="w-11 flex-none font-mono text-[11px] tabular-nums" style={{ color: s.accent }}>
                        {pct(c?.acc ?? null, 1)}
                      </span>
                      <div className="min-w-[70px] flex-1">
                        <Bar value={c?.acc ?? null} oracle={c?.oracle ?? null} color={s.accent} max={max} height={6} />
                      </div>
                      <span className="hidden w-16 flex-none text-right font-mono text-[9px] text-[#555] sm:inline">
                        partial {pct(c?.partial ?? null, 0)}
                      </span>
                    </div>
                  </td>
                );
              })}
              <td className="px-3 py-2.5 text-right font-mono text-[10px] tabular-nums text-[#666]">
                {pct(series[0]?.cells[lv.n - 1]?.oracle ?? null, 1)}
              </td>
              <td className="px-3 py-2.5 text-right font-mono text-[10px] tabular-nums text-[#666]">
                {fmtInt(series[0]?.cells[lv.n - 1]?.n ?? 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------- level spark --- */

export function LevelSpark({ values, color, width = 54, height = 14 }: { values: (number | null)[]; color: string; width?: number; height?: number }) {
  const max = Math.max(0.01, ...values.map((v) => v ?? 0));
  const bw = (width - 4 * 3) / 5;
  return (
    <svg width={width} height={height} viewBox={"0 0 " + width + " " + height} aria-hidden className="flex-none">
      {values.map((v, i) => {
        const h = Math.max(1, ((v ?? 0) / max) * (height - 2));
        return <rect key={i} x={i * (bw + 3)} y={height - h} width={bw} height={h} rx="1" fill={color} opacity={0.5 + (i / 5) * 0.5} />;
      })}
    </svg>
  );
}
