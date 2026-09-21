/**
 * /open-models/grain — the grain-corruption sweep.
 *
 * A separate robustness result, deliberately not part of the leaderboard: it is a
 * different image condition, a 250-image-per-domain subset, and only some of the
 * runs. Everything is read from data/open-models/grain.json.
 */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useGrain } from "../lib/reanalysis";
import type { GrainCondition } from "../lib/reanalysisTypes";
import { Dot, Panel, Section, Tile, TileGrid } from "../components/open-models/ui";
import { fmtInt, pct } from "../lib/openModelsFmt";

export const Route = createFileRoute("/open-models/grain")({ component: GrainPage });

const MD = "https://github.com/mmaaaaz/agi-eval-data/blob/main/docs/open-models-grain-sweep.md";
const SIGMA = ["sigma15", "sigma25", "sigma40"];
const SIGMA_LABEL: Record<string, string> = { sigma15: "σ 15", sigma25: "σ 25", sigma40: "σ 40" };
const ACCENT: Record<string, string> = {
  "InternVL3_5-8B": "#8b5cf6",
  "Molmo2-8B": "#10b981",
  "Qwen3-VL-8B-Instruct": "#f43f5e",
};
/** compact names — the grain run keys are directory names */
const SHORT: Record<string, string> = {
  "InternVL3_5-8B": "InternVL3.5-8B",
  "Molmo2-8B": "Molmo2-8B",
  "Qwen3-VL-8B-Instruct": "Qwen3-VL-I",
};
const shortOf = (l: string) => SHORT[l] ?? l;

function Delta({ v, ci, wide = false }: { v: number | null; ci?: [number, number] | null; wide?: boolean }) {
  if (v == null) return <span className="text-[#555]">—</span>;
  const bad = v < 0;
  return (
    <span className={wide ? "text-sm font-semibold" : "text-[11px]"}>
      <span className={(bad ? "text-[#f0a5a5]" : "text-[#9fd8b4]") + " font-mono tabular-nums"}>
        {v >= 0 ? "+" : "−"}
        {Math.abs(v).toFixed(4)}
      </span>
      {ci && (
        <span className="ml-2 font-mono text-[9.5px] tabular-nums text-[#666]">
          [{ci[0].toFixed(4)}, {ci[1].toFixed(4)}]
        </span>
      )}
    </span>
  );
}

/** degradation vs sigma, one line per model, two comparison modes */
function Curve({ models, mode }: { models: { label: string; conds: GrainCondition[] }[]; mode: "all" | "parsed" }) {
  const W = 640, H = 260, padL = 58, padR = 92, padT = 22, padB = 42;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const vals = models.flatMap((m) => m.conds.map((c) => (mode === "all" ? c.delta_pooled : c.delta_parsed_pooled) ?? 0));
  const lo = Math.min(-0.03, ...vals) - 0.005;
  const hi = Math.max(0.02, ...vals) + 0.005;
  const x = (i: number) => padL + (plotW / (SIGMA.length - 1)) * i;
  const y = (v: number) => padT + plotH - ((v - lo) / (hi - lo)) * plotH;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="degradation by condition">
      {[lo, 0, hi].map((v, k) => (
        <g key={k}>
          <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke={v === 0 ? "#3a3a3a" : "#171717"} />
          <text x={padL - 8} y={y(v) + 3.5} textAnchor="end" className="fill-[#666] font-mono text-[10px] tabular-nums">
            {(v * 100).toFixed(1)}
          </text>
        </g>
      ))}
      {SIGMA.map((c, i) => (
        <text key={c} x={x(i)} y={H - 16} textAnchor="middle" className="fill-[#a1a1a1] font-mono text-[10px]">
          {SIGMA_LABEL[c]}
        </text>
      ))}
      {models.map((m) => {
        const colour = ACCENT[m.label] ?? "#8a8a8a";
        const pts = SIGMA.map((c, i) => {
          const row = m.conds.find((x) => x.condition === c);
          return { i, v: (mode === "all" ? row?.delta_pooled : row?.delta_parsed_pooled) ?? 0 };
        });
        return (
          <g key={m.label}>
            <polyline points={pts.map((p) => `${x(p.i)},${y(p.v)}`).join(" ")} fill="none" stroke={colour} strokeWidth="2" />
            {pts.map((p) => (
              <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r="3.2" fill="#0a0a0a" stroke={colour} strokeWidth="2" />
            ))}
            <text x={W - padR + 10} y={y(pts[pts.length - 1].v) + 3.5} className="font-mono text-[10px] tabular-nums" style={{ fill: colour }}>
              {shortOf(m.label)} {pts[pts.length - 1].v >= 0 ? "+" : "−"}
              {Math.abs(pts[pts.length - 1].v).toFixed(3)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function GrainPage() {
  const { data, loading, error } = useGrain();
  const [mode, setMode] = useState<"all" | "parsed">("all");

  if (loading && !data) {
    return (
      <div className="flex min-h-[40vh] flex-col items-start justify-center gap-3">
        <div className="indeterminate h-[2px] w-48 rounded bg-[#262626]" />
        <p className="font-mono text-[10px] text-[#666]">fetching the grain artifact …</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="min-h-[40vh] pt-10">
        <p className="font-mono text-xs uppercase tracking-widest text-danger">grain artifact unreachable</p>
        <p className="mt-2 max-w-lg font-mono text-[11px] leading-5 text-[#a1a1a1]">
          {error}. Run <code className="text-white">python scripts/open_models_grain.py</code> and
          <code className="text-white"> python scripts/open_models_public.py</code>, then reload.
        </p>
      </div>
    );
  }

  const labels = Object.keys(data.models).sort();
  const rows = labels.map((l) => ({ label: l, conds: data.models[l].per_condition }));
  const all = rows.flatMap((r) => r.conds);
  const worst = [...all].sort((a, b) => (a.delta_parsed_pooled ?? 0) - (b.delta_parsed_pooled ?? 0))[0];
  const worstRaw = [...all].sort((a, b) => (a.delta_pooled ?? 0) - (b.delta_pooled ?? 0))[0];
  const qwen = data.models["Qwen3-VL-8B-Instruct"];
  const missing = labels.flatMap((l) =>
    Object.entries(data.models[l].completeness)
      .filter(([, v]) => v.missing > 0)
      .map(([cond, v]) => ({ label: l, cond, ...v })),
  );
  const families = [...new Set(labels.flatMap((l) => data.models[l].by_family.filter((x) => x.condition === "sigma40").map((x) => x.key)))].sort() as string[];

  return (
    <div>
      <section className="pb-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#a1a1a1]">
          robustness sweep · {data.what_it_is.conditions.join(" / ")} · {labels.length} runs · paired against the same images, ungrainy
        </p>
        <h1 className="mt-3 max-w-[32ch] text-3xl font-semibold leading-[1.08] tracking-tighter text-white sm:text-4xl">
          What does image corruption <span className="text-accent">actually cost</span>?
        </h1>
        <p className="mt-4 max-w-[92ch] text-[14.5px] leading-relaxed text-[#a1a1a1]">
          The same {fmtInt(data.what_it_is.images_per_domain)} images per domain — {" "}
          {fmtInt(data.what_it_is.images_per_domain * 34)} in total — were re-run under three corruption labels, and every question's ground truth is
          byte-identical to the main run. So each answer here is compared against the <span className="text-[#ededed]">same question answered on the clean image by the same model</span>,
          not against a different sample. These runs are deliberately <span className="text-[#ededed]">not</span> in the leaderboard: different condition, subset of images, {labels.length} of the runs.
        </p>

        <div className="mt-6 grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
          <TileGrid cols={4}>
            <Tile
              label="largest drop"
              value={pct(worst?.delta_parsed_pooled ?? null, 2)}
              accent="#f0a5a5"
              sub={(worst?.condition ?? "") + " · " + (labels.find((l) => data.models[l].per_condition.includes(worst)) ?? "")}
            />
            <Tile label="largest drop, raw" value={pct(worstRaw?.delta_pooled ?? null, 2)} accent="#f0a5a5" sub={worstRaw?.condition} />
            <Tile
              label="records compared"
              value={fmtInt(all.reduce((s, c) => s + c.n, 0))}
              sub={labels.length + " models × 3 conditions × 42,500 records"}
            />
            <Tile
              label="confounded run"
              value={qwen ? pct(qwen.per_condition[0].unparsed_main, 2) : "—"}
              sub="Qwen main run unparsed, against 0.7% under grain — reason the parsed-only column exists"
            />
          </TileGrid>
          <Panel className="p-4">
            <p className="font-mono text-[9px] uppercase tracking-widest text-[#666]">verified before use</p>
            <ul className="mt-3 space-y-2 text-[12px] leading-relaxed text-[#a1a1a1]">
              {data.what_it_is.verified.map((v) => (
                <li key={v}>· {v}</li>
              ))}
            </ul>
            <a href={MD} target="_blank" rel="noopener noreferrer" className="mt-4 inline-block rounded border border-[#262626] px-2.5 py-1 font-mono text-[10px] text-[#a1a1a1] transition-colors hover:border-[#404040] hover:text-white">
              full report (.md) ↗
            </a>
          </Panel>
        </div>
      </section>

      <Section
        eyebrow="01 degradation"
        title="Accuracy under each condition, against the same images"
        hint="Both sides use the published comparison function at tolerance zero, restricted to the ids that condition contains, so the delta isolates the image condition. The parsed-only column drops records either side could not turn into a short answer."
      >
        <Panel className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left">
              <thead>
                <tr className="font-mono text-[9px] uppercase tracking-widest text-[#666]">
                  <th className="px-3 py-2 font-normal">run</th>
                  <th className="px-3 py-2 font-normal">condition</th>
                  <th className="px-3 py-2 text-right font-normal">n</th>
                  <th className="px-3 py-2 text-right font-normal">grain</th>
                  <th className="px-3 py-2 text-right font-normal">same images, clean</th>
                  <th className="px-3 py-2 text-right font-normal">delta</th>
                  <th className="px-3 py-2 font-normal">paired 95% CI</th>
                  <th className="px-3 py-2 text-right font-normal" title="delta over records both sides parsed">delta, parsed</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) =>
                  r.conds.map((c) => (
                    <tr key={r.label + c.condition} className="border-t border-[#141414]">
                      <th scope="row" className="px-3 py-2 text-left font-normal">
                        <span className="inline-flex items-center gap-2 text-[12.5px] text-[#ededed]">
                          <Dot color={ACCENT[r.label] ?? "#8a8a8a"} size={6} />
                          {r.label}
                        </span>
                      </th>
                      <td className="px-3 py-2 font-mono text-[11px] text-[#c9c9c9]">{SIGMA_LABEL[c.condition] ?? c.condition}</td>
                      <td className="px-3 py-2 text-right font-mono text-[10px] tabular-nums text-[#666]">{fmtInt(c.n)}</td>
                      <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-[#c9c9c9]">{pct(c.grain_exact, 2)}</td>
                      <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-[#a1a1a1]">{pct(c.main_exact, 2)}</td>
                      <td className="px-3 py-2 text-right">
                        <Delta v={c.delta_pooled} wide />
                      </td>
                      <td className="px-3 py-2 font-mono text-[9.5px] tabular-nums text-[#666]">
                        {c.delta_ci ? `[${c.delta_ci[0].toFixed(4)}, ${c.delta_ci[1].toFixed(4)}]` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Delta v={c.delta_parsed_pooled} />
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </Section>

      <Section
        eyebrow="02 curve"
        title="Does it get worse as the label rises?"
        hint="Degradation against the corruption label. With extraction held equal, every run loses ground as the label rises — but the effect is small, at most about two accuracy points."
        right={
          <div className="flex items-center gap-1.5">
            {(["all", "parsed"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={
                  "rounded border px-2.5 py-1 font-mono text-[10px] transition-colors " +
                  (mode === m ? "border-accent bg-accent/15 text-white" : "border-[#262626] text-[#a1a1a1] hover:text-white")
                }
              >
                {m === "all" ? "all records" : "parsed only"}
              </button>
            ))}
          </div>
        }
      >
        <Panel className="p-4">
          <Curve models={rows} mode={mode} />
          <p className="mt-2 font-mono text-[10px] text-[#666]">
            delta = grain − clean, in accuracy points · dashed-free lines: each model is one colour · the parsed-only view removes the
            answer-extraction difference between the two runs
          </p>
        </Panel>
        <Panel className="mt-3 p-4">
          <p className="font-mono text-[9px] uppercase tracking-widest text-[#666]">delta by level</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[620px] text-left">
              <thead>
                <tr className="font-mono text-[9px] uppercase tracking-widest text-[#666]">
                  <th className="px-3 py-1.5 font-normal">run</th>
                  <th className="px-3 py-1.5 font-normal">condition</th>
                  {[1, 2, 3, 4, 5].map((l) => (
                    <th key={l} className="px-3 py-1.5 text-right font-normal">
                      L{l}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {labels.flatMap((l) =>
                  SIGMA.map((cond) => {
                    const by = data.models[l].by_level.filter((x) => x.condition === cond);
                    return (
                      <tr key={l + cond} className="border-t border-[#141414]">
                        <th scope="row" className="px-3 py-1.5 text-left font-normal font-mono text-[11px] text-[#c9c9c9]">
                          {shortOf(l)}
                        </th>
                        <td className="px-3 py-1.5 font-mono text-[10px] text-[#666]">{SIGMA_LABEL[cond]}</td>
                        {[1, 2, 3, 4, 5].map((lv) => (
                          <td key={lv} className="px-3 py-1.5 text-right">
                            <Delta v={by.find((x) => Number(x.key) === lv)?.delta ?? null} />
                          </td>
                        ))}
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </Section>

      <Section
        eyebrow="03 families"
        title="Where the damage concentrates (σ 40)"
        hint="Family-level deltas at the strongest condition. Red is a loss, green a gain — and a gain needs explaining before it is believed."
      >
        <Panel className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left">
              <thead>
                <tr className="font-mono text-[9px] uppercase tracking-widest text-[#666]">
                  <th className="px-3 py-2 font-normal">family</th>
                  {labels.map((l) => (
                    <th key={l} className="px-3 py-2 text-right font-normal">
                      {shortOf(l)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {families.map((f) => (
                  <tr key={f} className="border-t border-[#141414]">
                    <th scope="row" className="px-3 py-2 text-left font-normal text-[12.5px] text-[#c9c9c9]">
                      {f}
                    </th>
                    {labels.map((l) => {
                      const row = data.models[l].by_family.find((x) => x.key === f && x.condition === "sigma40");
                      return (
                        <td key={l} className="px-3 py-2 text-right">
                          <Delta v={row?.delta ?? null} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </Section>

      <Section eyebrow="04 caveats" title="Two numbers a reader must not misread" hint="Both are computed above; both are printed here because they are easy to quote wrongly.">
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel className="p-4">
            <p className="font-mono text-[9px] uppercase tracking-widest text-[#9fd8b4]">a real robustness signal: shadow_inference</p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-[#a1a1a1]">
              It falls monotonically with the label in all {labels.length} runs — the one pattern in this sweep that looks like a genuine effect of
              the images rather than of the two runs differing.
            </p>
            <table className="mt-3 w-full text-left">
              <thead>
                <tr className="font-mono text-[9px] uppercase tracking-widest text-[#666]">
                  <th className="py-1.5 pr-2 font-normal">run</th>
                  {SIGMA.map((c) => (
                    <th key={c} className="px-2 py-1.5 text-right font-normal">
                      {SIGMA_LABEL[c]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {labels.map((l) => {
                  const by = data.models[l].by_domain.filter((x) => x.key === "shadow_inference");
                  return (
                    <tr key={l} className="border-t border-[#141414]">
                      <th scope="row" className="py-1.5 pr-2 text-left font-normal font-mono text-[11px] text-[#c9c9c9]">
                        {shortOf(l)}
                      </th>
                      {SIGMA.map((c) => (
                        <td key={c} className="px-2 py-1.5 text-right">
                          <Delta v={by.find((x) => x.condition === c)?.delta ?? null} />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
          <Panel className="p-4">
            <p className="font-mono text-[9px] uppercase tracking-widest text-[#f0a5a5]">not a robustness effect: Qwen on physical_stability</p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-[#a1a1a1]">
              Qwen3-VL-8B-Instruct appears to gain on this domain under <em>every</em> condition, by nearly the same amount. A gain that is flat
              across the conditions cannot be caused by them: it is a difference between the two runs. Something in its main run is degraded on
              those 250 images, so its deltas for this domain are uninterpretable until that run is repeated.
            </p>
            <table className="mt-3 w-full text-left">
              <thead>
                <tr className="font-mono text-[9px] uppercase tracking-widest text-[#666]">
                  <th className="py-1.5 pr-2 font-normal">run</th>
                  {SIGMA.map((c) => (
                    <th key={c} className="px-2 py-1.5 text-right font-normal">
                      {SIGMA_LABEL[c]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {labels.map((l) => {
                  const by = data.models[l].by_domain.filter((x) => x.key === "physical_stability");
                  return (
                    <tr key={l} className="border-t border-[#141414]">
                      <th scope="row" className="py-1.5 pr-2 text-left font-normal font-mono text-[11px] text-[#c9c9c9]">
                        {shortOf(l)}
                      </th>
                      {SIGMA.map((c) => (
                        <td key={c} className="px-2 py-1.5 text-right">
                          <Delta v={by.find((x) => x.condition === c)?.delta ?? null} />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
        </div>
        <Panel className="mt-3 p-4">
          <p className="font-mono text-[9px] uppercase tracking-widest text-[#666]">completeness, and what cannot be verified</p>
          <p className="mt-2 text-[12.5px] leading-relaxed text-[#a1a1a1]">
            {missing.length === 0
              ? "Every condition is complete."
              : missing.map((m) => `${m.label} · ${m.cond} is short by ${fmtInt(m.missing)} records`).join("; ") +
                ". Both sides of that comparison are restricted to the ids that exist, so the delta stays paired."}
          </p>
          <ul className="mt-3 space-y-1.5 text-[12.5px] leading-relaxed text-[#a1a1a1]">
            {data.what_it_is.unverifiable.map((u) => (
              <li key={u}>· {u}</li>
            ))}
          </ul>
          <p className="mt-3 font-mono text-[10px] text-[#666]">artifact generated {data.generated} · engine scripts/open_models_grain.py</p>
        </Panel>
      </Section>
    </div>
  );
}
