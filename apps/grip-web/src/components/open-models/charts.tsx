/** Hand-rolled SVG/HTML charts - no chart dependency, full control over ink.
 *
 * All series charts take a \`focus\` model id: the focused model keeps full ink,
 * everything else dims. That one interaction is shared by every page.
 */
import { Fragment, useState } from "react";
import type { Domain, LevelDef, ModelEntry } from "../../lib/openModelsTypes";
import { METRICS, type Metric, fmtInt, inkOn, metricValue, pct, ramp } from "../../lib/openModelsFmt";
import { Bar, Legend } from "./ui";

const metricLabel = (m: Metric) => METRICS.find((x) => x.id === m)?.short ?? m;
export const shortName = (m: ModelEntry) => m.meta.short || m.label;
export const dim = (m: ModelEntry, focus: string | null) => (focus == null || focus === m.id ? 1 : 0.22);

function niceMax(v: number, step = 0.1): number {
  const padded = Math.min(1, v * 1.12 + 0.02);
  return Math.min(1, Math.ceil(padded / step) * step);
}

/* ------------------------------------------------------------ level curve --- */

/** Accuracy across the L1-L5 task ladder, one line per model. Scales to a field. */
export function LevelSlope({
  models,
  levels,
  metric,
  focus,
  onFocus,
}: {
  models: ModelEntry[];
  levels: LevelDef[];
  metric: Metric;
  focus: string | null;
  onFocus?: (id: string | null) => void;
}) {
  const W = 800;
  const H = 330;
  const padL = 46;
  const padR = 108;
  const padT = 22;
  const padB = 46;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const x = (i: number) => padL + (plotW / (levels.length - 1)) * i;

  const series = models.map((m) => ({
    m,
    values: levels.map((_, i) => metricValue(m.totals.levels[i], metric)),
  }));
  const oracle = metric === "headroom" ? null : levels.map((_, i) => models[0]?.totals.levels[i]?.oracle ?? null);
  const rawMax = Math.max(
    ...series.flatMap((s) => s.values.map((v) => v ?? 0)),
    ...(oracle ?? []).map((v) => v ?? 0),
  );
  const maxV = niceMax(rawMax);
  const y = (v: number) => padT + plotH - (Math.max(0, Math.min(maxV, v)) / maxV) * plotH;

  return (
    <svg viewBox={"0 0 " + W + " " + H} className="h-auto w-full" role="img" aria-label="Accuracy by difficulty level">
      {[0, 1, 2, 3, 4, 5].map((k) => {
        const v = (maxV / 5) * k;
        return (
          <g key={k}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke={k === 0 ? "#333" : "#171717"} />
            <text x={padL - 8} y={y(v) + 3.5} textAnchor="end" className="fill-[#666] font-mono text-[10px] tabular-nums">
              {(v * 100).toFixed(0)}
            </text>
          </g>
        );
      })}
      {/* majority-answer baseline for each level */}
      {oracle && (
        <polyline
          points={oracle.map((v, i) => x(i) + "," + y(v ?? 0)).join(" ")}
          fill="none"
          stroke="#7a7a7a"
          strokeWidth="1.5"
          strokeDasharray="3 4"
        />
      )}
      {oracle?.[levels.length - 1] != null && (
        <text x={W - padR + 10} y={y(oracle[levels.length - 1] as number) + 3.5} className="fill-[#7a7a7a] font-mono text-[9px]">
          baseline
        </text>
      )}
      {series.map((s) => {
        const a = dim(s.m, focus);
        return (
          <g key={s.m.id} style={{ opacity: a }} onClick={() => onFocus?.(focus === s.m.id ? null : s.m.id)} className="cursor-pointer">
            <polyline
              points={s.values.map((v, i) => x(i) + "," + y(v ?? 0)).join(" ")}
              fill="none"
              stroke={s.m.accent}
              strokeWidth={focus === s.m.id ? 3 : 2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {s.values.map((v, i) => (
              <g key={i}>
                <title>{s.m.label + " · L" + levels[i].n + " " + pct(v, 1) + " (n=" + fmtInt(models[0]?.totals.levels[i]?.n ?? 0) + ")"}</title>
                <circle cx={x(i)} cy={y(v ?? 0)} r={focus === s.m.id ? 4.5 : 3.2} fill="#0a0a0a" stroke={s.m.accent} strokeWidth="2" />
              </g>
            ))}
            <text
              x={W - padR + 10}
              y={y(s.values[levels.length - 1] ?? 0) + 3.5}
              className="font-mono text-[10px] tabular-nums"
              style={{ fill: s.m.accent }}
            >
              {shortName(s.m)} {pct(s.values[levels.length - 1], 1)}
            </text>
          </g>
        );
      })}
      {levels.map((lv, i) => (
        <g key={lv.n}>
          <text x={x(i)} y={H - 26} textAnchor="middle" className="fill-[#ededed] font-mono text-[11px]">
            L{lv.n}
          </text>
          <text x={x(i)} y={H - 13} textAnchor="middle" className="fill-[#666] font-mono text-[9px] uppercase tracking-wider">
            {lv.short}
          </text>
        </g>
      ))}
    </svg>
  );
}

/* ---------------------------------------------------------- family matrix --- */

/** Families x models. The best model in each row is ringed; the row's baseline sits last. */
export function FamilyMatrix({
  models,
  focus,
  metric = "acc",
  onFocus,
}: {
  models: ModelEntry[];
  focus: string | null;
  metric?: Metric;
  onFocus?: (id: string | null) => void;
}) {
  const names = models[0]?.families.map((f) => f.name) ?? [];
  const rows = names.map((name, fi) => {
    const cells = models.map((m) => ({ m, v: metricValue(m.families[fi], metric) ?? 0 }));
    const mean = cells.reduce((s, c) => s + c.v, 0) / Math.max(1, cells.length);
    const best = Math.max(...cells.map((c) => c.v));
    return { name, fi, cells, mean, best, n: models[0].families[fi].n, oracle: models[0].families[fi].oracle };
  });
  const max = Math.max(0.35, ...rows.flatMap((r) => r.cells.map((c) => c.v)));

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-separate border-spacing-0">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-[#0a0a0a] px-2 pb-1.5 text-left font-mono text-[9px] uppercase tracking-widest text-[#666]">
              family
            </th>
            {models.map((m) => (
              <th key={m.id} className="px-1 pb-1.5 text-center font-mono text-[9px] uppercase tracking-widest">
                <button
                  type="button"
                  onClick={() => onFocus?.(focus === m.id ? null : m.id)}
                  className="transition-colors hover:text-white"
                  style={{ color: focus === m.id ? "#fff" : m.accent, opacity: dim(m, focus) }}
                >
                  {shortName(m)}
                </button>
              </th>
            ))}
            <th className="px-1 pb-1.5 text-center font-mono text-[9px] uppercase tracking-widest text-[#666]">base</th>
            <th className="px-1 pb-1.5 text-center font-mono text-[9px] uppercase tracking-widest text-[#666]">n</th>
          </tr>
        </thead>
        <tbody>
          {rows
            .sort((a, b) => b.mean - a.mean)
            .map((r) => (
              <tr key={r.name}>
                <th scope="row" className="sticky left-0 z-10 max-w-[220px] truncate bg-[#0a0a0a] py-[3px] pr-2 text-left font-mono text-[11px] font-normal text-[#c9c9c9]">
                  {r.name}
                </th>
                {r.cells.map((c) => {
                  const t = Math.max(0, Math.min(1, c.v / max));
                  const isBest = c.v === r.best;
                  return (
                    <td key={c.m.id} className="p-[2px]">
                      <div
                        title={c.m.label + " · " + r.name + " · " + metricLabel(metric) + " " + pct(c.v, 1) + " · baseline " + pct(r.oracle, 1)}
                        onClick={() => onFocus?.(focus === c.m.id ? null : c.m.id)}
                        className="flex h-[30px] cursor-pointer items-center justify-center rounded-[3px] font-mono text-[11px] font-semibold tabular-nums transition-transform duration-150 hover:scale-[1.04]"
                        style={{
                          background: ramp(t * 0.92),
                          color: inkOn(t * 0.92),
                          opacity: dim(c.m, focus),
                          boxShadow: isBest ? "inset 0 0 0 1.5px " + c.m.accent : undefined,
                        }}
                      >
                        {(c.v * 100).toFixed(1)}
                      </div>
                    </td>
                  );
                })}
                <td className="px-1 text-center font-mono text-[10px] tabular-nums text-[#555]">{pct(r.oracle, 1)}</td>
                <td className="px-1 text-center font-mono text-[9px] text-[#444]">{Math.round(r.n / 1000)}k</td>
              </tr>
            ))}
        </tbody>
      </table>
      <p className="mt-2 font-mono text-[10px] text-[#666]">
        {metricLabel(metric)} per family · ringed cell = best in that family · <span className="text-[#555]">base</span> = majority-answer
        baseline · rows ordered by the field's mean.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------- winner map --- */

/** Domain x level, coloured by whichever model leads that cell. */
export function WinnerGrid({
  domains,
  levels,
  models,
  families,
  focus,
}: {
  domains: Domain[];
  levels: LevelDef[];
  models: ModelEntry[];
  families: string[];
  focus: string | null;
}) {
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-[#0a0a0a] px-2 pb-1.5 text-left font-mono text-[9px] uppercase tracking-widest text-[#666]">domain</th>
              {levels.map((lv) => (
                <th key={lv.n} className="px-1 pb-1.5 text-center font-mono text-[9px] uppercase tracking-widest text-[#666]">
                  <div className="text-[#a1a1a1]">L{lv.n}</div>
                  <div className="text-[8px] normal-case tracking-normal text-[#555]">{lv.short}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {families.map((fam) => (
              <Fragment key={fam}>
                <tr>
                  <td colSpan={levels.length + 1} className="sticky left-0 bg-[#0a0a0a] px-2 pt-3 pb-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[#555]">
                    {fam}
                  </td>
                </tr>
                {domains
                  .filter((d) => d.familyName === fam)
                  .map((d) => (
                    <tr key={d.key}>
                      <th scope="row" className="sticky left-0 z-10 max-w-[190px] truncate bg-[#0a0a0a] py-[3px] pr-2 text-left font-normal">
                        <a href={"/open-models/domains/" + d.key} className="font-mono text-[11px] text-[#c9c9c9] transition-colors hover:text-accent">
                          {d.label}
                        </a>
                      </th>
                      {levels.map((lv, i) => {
                        const cells = d.per
                          .map((p) => ({ p, v: p.levels[i]?.acc ?? 0, n: p.levels[i]?.n ?? 0, oracle: p.levels[i]?.oracle ?? null }))
                          .sort((x, y) => y.v - x.v);
                        const win = cells[0];
                        const second = cells[1];
                        if (!win) return <td key={lv.n} />;
                        const model = models.find((m) => m.id === win.p.model)!;
                        const tie = second && Math.abs(second.v - win.v) < 1e-9;
                        return (
                          <td key={lv.n} className="p-[2px]">
                            <div
                              onMouseEnter={() =>
                                setHover(
                                  d.label + " L" + lv.n + " — " + model.label + " " + pct(win.v, 1) +
                                    (tie ? " (tied with " + (models.find((m) => m.id === second.p.model)?.label ?? "") + ")" : ", then " +
                                      (models.find((m) => m.id === second?.p.model)?.label ?? "—") + " " + pct(second?.v ?? 0, 1)) +
                                    " · baseline " + pct(win.oracle, 1),
                                )
                              }
                              onMouseLeave={() => setHover(null)}
                              title={model.label + " · " + pct(win.v, 1)}
                              className="flex h-[26px] items-center justify-center rounded-[3px] font-mono text-[9.5px] font-semibold transition-transform duration-150 hover:scale-[1.06]"
                              style={{
                                background: model.accent,
                                color: "#0a0a0a",
                                opacity: (focus == null || focus === model.id ? 0.95 : 0.19) * (win.v === 0 ? 0.5 : 1),
                              }}
                            >
                              {win.v === 0 ? "—" : shortName(model)}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {models.map((m) => (
          <span key={m.id} className="inline-flex items-center gap-1.5 font-mono text-[10px]" style={{ opacity: dim(m, focus) }}>
            <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: m.accent }} />
            <span style={{ color: m.accent }}>{shortName(m)}</span>
            <span className="text-[#555]">{m.label}</span>
          </span>
        ))}
      </div>
      <div className="mt-2 min-h-[16px] font-mono text-[10px] text-[#a1a1a1]">{hover ?? ""}</div>
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
                  <td colSpan={levels.length + 2} className="sticky left-0 bg-[#0a0a0a] px-2 pt-3 pb-1 text-left font-mono text-[9px] uppercase tracking-[0.18em] text-[#555]">
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
                        <th scope="row" className="sticky left-0 z-10 max-w-[190px] truncate bg-[#0a0a0a] py-[3px] pr-2 text-left font-normal">
                          <a href={"/open-models/domains/" + d.key} className="font-mono text-[11px] text-[#c9c9c9] transition-colors hover:text-accent">
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
                                      " · baseline " + pct(l?.oracle ?? null, 1) +
                                      " · partial " + pct(l?.partial ?? null, 1),
                                  })
                                }
                                onMouseLeave={() => setHover(null)}
                                title={d.label + " L" + lv.n + " · " + metricLabel(metric) + " " + pct(v, 1)}
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
          {model.label} · {metricLabel(metric)} per cell · hover for counts, baseline and partial credit
        </p>
      </div>
      <div className="mt-2 min-h-[16px] font-mono text-[10px] text-[#a1a1a1]">{hover ? hover.label + " — " + hover.text : ""}</div>
    </div>
  );
}

/* --------------------------------------------------------- diverging bars --- */

export function DivergeBars({ domains, a, b, limit = 12 }: { domains: Domain[]; a: ModelEntry; b: ModelEntry; limit?: number }) {
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
                  style={{ background: aAhead ? a.accent : b.accent, left: aAhead ? "50%" : 50 - w + "%", width: w + "%" }}
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

/** One row per difficulty level, one bar per model, baseline tick in the track. */
export function LevelTable({ levels, series }: { levels: LevelDef[]; series: { id?: string; label: string; accent: string; cells: LevelCell[] }[] }) {
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
            <th className="px-3 py-2 text-right font-normal">base</th>
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
                        <Bar value={c?.acc ?? null} oracle={c?.oracle ?? null} color={s.accent} max={max} height={6} showOracle={s === series[0]} />
                      </div>
                      <span className="hidden w-16 flex-none text-right font-mono text-[9px] text-[#555] sm:inline">partial {pct(c?.partial ?? null, 0)}</span>
                    </div>
                  </td>
                );
              })}
              <td className="px-3 py-2.5 text-right font-mono text-[10px] tabular-nums text-[#666]">{pct(series[0]?.cells[lv.n - 1]?.oracle ?? null, 1)}</td>
              <td className="px-3 py-2.5 text-right font-mono text-[10px] tabular-nums text-[#666]">{fmtInt(series[0]?.cells[lv.n - 1]?.n ?? 0)}</td>
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
