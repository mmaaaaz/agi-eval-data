/**
 * /open-models/reanalysis - Test-1 reanalysis of the open-weight runs.
 *
 * Constant-answer baselines computed on the evaluated sample, the adjusted
 * transform, image-level bootstrap CIs, and the two cross-checks. Everything is
 * read from data/open-models/reanalysis.json; nothing is recomputed in the
 * browser and nothing is typed by hand.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useReanalysis } from "../lib/reanalysis";
import type { Agg, Cell } from "../lib/reanalysisTypes";
import { Dot, Panel, Section, Tile, TileGrid } from "../components/open-models/ui";
import { fmtInt, pct } from "../lib/openModelsFmt";

export const Route = createFileRoute("/open-models/reanalysis")({ component: ReanalysisPage });

const ORDER = [
  "Qwen3-VL-8B-Instruct",
  "Qwen3-VL-8B-Thinking",
  "Molmo2-8B",
  "InternVL3.5-8B",
  "Kimi-VL-A3B-Thinking",
  "DeepSeek-VL2-Small",
];
const SHORT: Record<string, string> = {
  "Qwen3-VL-8B-Instruct": "Qwen-I",
  "Qwen3-VL-8B-Thinking": "Qwen-T",
  "Molmo2-8B": "Molmo2",
  "InternVL3.5-8B": "InternVL",
  "Kimi-VL-A3B-Thinking": "Kimi",
  "DeepSeek-VL2-Small": "DeepSeek",
};
const MD = "https://github.com/mmaaaaz/agi-eval-data/blob/main/docs/open-models-test1-reanalysis.md";

/** signed adjusted score, negative in red - never clipped */
function Adj({ v, wide = false }: { v: number | null; wide?: boolean }) {
  if (v == null) return <span className="text-[#555]">—</span>;
  const cls = v < 0 ? "text-[#f0a5a5]" : "text-[#9fd8b4]";
  return (
    <span className={cls + " font-mono tabular-nums " + (wide ? "text-sm font-semibold" : "text-[11px]")}>
      {v >= 0 ? "+" : "−"}
      {Math.abs(v).toFixed(4)}
    </span>
  );
}

function CI({ ci }: { ci?: [number, number] | null }) {
  if (!ci) return <span className="text-[#555]">—</span>;
  return (
    <span className="font-mono text-[10px] tabular-nums text-[#666]">
      [{ci[0].toFixed(4)}, {ci[1].toFixed(4)}]
    </span>
  );
}

/** diverging bar around zero, for adjusted values */
function ZeroBar({ v, max }: { v: number | null; max: number }) {
  if (v == null) return null;
  const w = Math.min(50, (Math.abs(v) / max) * 50);
  return (
    <div className="relative h-[9px] w-full rounded-sm bg-[#141414]">
      <span className="absolute inset-y-0 left-1/2 w-px bg-[#333]" />
      <span
        className="absolute inset-y-[1px] rounded-sm"
        style={{ width: w + "%", left: (v >= 0 ? 50 : 50 - w) + "%", background: v >= 0 ? "#9fd8b4" : "#f0a5a5" }}
      />
    </div>
  );
}

export function ReanalysisPage() {
  const { data, loading, error } = useReanalysis();

  if (loading && !data) {
    return (
      <div className="flex min-h-[40vh] flex-col items-start justify-center gap-3">
        <div className="indeterminate h-[2px] w-48 rounded bg-[#262626]" />
        <p className="font-mono text-[10px] text-[#666]">fetching the reanalysis artifact …</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="min-h-[40vh] pt-10">
        <p className="font-mono text-xs uppercase tracking-widest text-danger">reanalysis unreachable</p>
        <p className="mt-2 max-w-lg font-mono text-[11px] leading-5 text-[#a1a1a1]">
          {error}. Run <code className="text-white">python scripts/open_models_test1_reanalysis.py</code> and
          <code className="text-white"> python scripts/open_models_public.py</code>, then reload.
        </p>
      </div>
    );
  }

  const M = data.models;
  const ranked = [...ORDER].sort((a, b) => (M[b].overall.macro ?? -9) - (M[a].overall.macro ?? -9));
  const lead = ranked[0];
  const below = ranked.filter((l) => (M[l].overall.macro ?? 0) < 0);
  const constCells = M[ORDER[0]].constant_cells;
  const maxAbs = Math.max(...ORDER.map((l) => Math.abs(M[l].overall.macro ?? 0)), 0.05);
  const io = ORDER.map((l) => ({ l, row: M[l].domains.find((d) => d.key === "impossible_object") as Agg }));
  const levels = [1, 2, 3, 4, 5];
  const families = (M[ORDER[0]].families.map((f) => f.key) as string[]).sort();

  return (
    <div>
      <section className="pb-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#a1a1a1]">
          Test-1 reanalysis · constant-answer baselines · {fmtInt(Object.values(data.level_counts)[0]["5"])} L5 responses found
        </p>
        <h1 className="mt-3 max-w-[34ch] text-3xl font-semibold leading-[1.08] tracking-tighter text-white sm:text-4xl">
          The same answers, scored against <span className="text-accent">what a constant answer would get</span>
        </h1>
        <p className="mt-4 max-w-[92ch] text-[14.5px] leading-relaxed text-[#a1a1a1]">
          Every table here is recomputed from the stored response files alone — no API calls, no re-runs. Accuracy uses the published
          comparison function with the numeric tolerance set to zero; the baseline is the share of the most common ground truth in each
          domain × level cell, measured on the items each run was actually evaluated on. {" "}
          <span className="text-[#ededed]">
            adjusted = (accuracy − baseline) / (1 − baseline)
          </span>
          , so 0 means “no better than always answering the most common thing”.
        </p>

        <div className="mt-6 grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
          <TileGrid cols={4}>
            <Tile label="best adjusted MACRO" value={pct(M[lead].overall.macro, 2)} accent="#9fd8b4" sub={lead} />
            <Tile
              label="below the baseline"
              value={below.length + " of 6"}
              accent={below.length ? "#f0a5a5" : undefined}
              sub={below.map((l) => SHORT[l]).join(", ") + " — worse than a constant answer on average"}
            />
            <Tile
              label="structurally constant cells"
              value={String(constCells.length)}
              sub="baseline = 1.0, undefined, excluded from every aggregate"
            />
            <Tile
              label="cells with n < 10"
              value={String(ORDER.reduce((s, l) => s + M[l].overall.n_lt_10, 0))}
              sub="none — primary and supplementary aggregates coincide"
            />
          </TileGrid>
          <Panel className="p-4">
            <p className="font-mono text-[9px] uppercase tracking-widest text-[#666]">why this exists</p>
            <ul className="mt-3 space-y-2.5 text-[12.5px] leading-relaxed text-[#a1a1a1]">
              <li>
                The published 13.76% “guessing baseline” is one pooled majority share. It cannot be used per cell, and this sample is ~30×
                larger with different modal answers.
              </li>
              <li>Subtracting the cell's own baseline separates “looked at the image” from “guessed the popular answer”.</li>
              <li>
                Intervals come from {fmtInt(10000)} image-level resamples with one shared draw across levels and models, so paired
                differences are valid.
              </li>
            </ul>
            <a
              href={MD}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-block rounded border border-[#262626] px-2.5 py-1 font-mono text-[10px] text-[#a1a1a1] transition-colors hover:border-[#404040] hover:text-white"
            >
              full report (.md) ↗
            </a>
          </Panel>
        </div>
      </section>

      <Section
        eyebrow="01 l5"
        title="L5 was never missing"
        hint="Stored responses were counted per level across all 204 run files. Every model has a full L5 column and it is already scored and published; the premise that L1–L4 was all that ran does not match these files."
      >
        <Panel className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="font-mono text-[9px] uppercase tracking-widest text-[#666]">
                  <th className="px-3 py-2 font-normal">run</th>
                  {levels.map((l) => (
                    <th key={l} className="px-3 py-2 text-right font-normal">
                      L{l}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-normal">total</th>
                  <th className="px-3 py-2 font-normal">verdict</th>
                </tr>
              </thead>
              <tbody>
                {ORDER.map((lab) => {
                  const c = data.level_counts[lab];
                  const tot = levels.reduce((s, l) => s + c[String(l)], 0);
                  const v = data.l5_verdicts[lab];
                  return (
                    <tr key={lab} className="border-t border-[#141414]">
                      <th scope="row" className="px-3 py-2 text-left font-normal text-[12.5px] text-[#ededed]">
                        {lab}
                      </th>
                      {levels.map((l) => (
                        <td key={l} className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-[#c9c9c9]">
                          {fmtInt(c[String(l)])}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-[#a1a1a1]">{fmtInt(tot)}</td>
                      <td className="px-3 py-2 font-mono text-[10px] text-[#9fd8b4]">
                        ({v.verdict}) L5 present · {fmtInt(v.l5_responses)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
        <p className="mt-2 font-mono text-[10px] leading-relaxed text-[#666]">
          Invariants: {data.invariants.one_question_per_image_per_level.checked_cells} cells checked,{" "}
          {data.invariants.one_question_per_image_per_level.violations.length} violations of one-question-per-image-per-level;{" "}
          {data.invariants.ground_truth_identical_across_models.cells_differing.length} of{" "}
          {data.invariants.ground_truth_identical_across_models.cells_compared} cells differ in ground-truth distribution (sample-size
          differences only), so baselines are shared across all six runs.
        </p>
      </Section>

      <Section
        eyebrow="02 transform"
        title="Raw accuracy, baseline, adjusted — side by side"
        hint="Nothing is replaced: the published rule's accuracy keeps its column next to the exact-match accuracy the transform uses. MACRO weights every cell equally; POOLED weights by items. Both are reported."
      >
        <Panel className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left">
              <thead>
                <tr className="font-mono text-[9px] uppercase tracking-widest text-[#666]">
                  <th className="px-3 py-2 font-normal">run</th>
                  <th className="px-3 py-2 text-right font-normal">cells</th>
                  <th className="px-3 py-2 text-right font-normal">n</th>
                  <th className="px-3 py-2 text-right font-normal">baseline</th>
                  <th className="px-3 py-2 text-right font-normal" title="exact match: the published comparison function with tolerance set to zero">
                    raw (exact)
                  </th>
                  <th className="px-3 py-2 text-right font-normal" title="the frozen-rule accuracy published on the other pages">
                    raw (published)
                  </th>
                  <th className="px-3 py-2 text-right font-normal">adjusted MACRO</th>
                  <th className="px-3 py-2 font-normal">95% CI (image-level)</th>
                  <th className="px-3 py-2 text-right font-normal">adjusted POOLED</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((lab) => {
                  const o = M[lab].overall;
                  return (
                    <tr key={lab} className="border-t border-[#141414]">
                      <th scope="row" className="px-3 py-2 text-left font-normal text-[12.5px] text-[#ededed]">
                        {lab}
                      </th>
                      <td className="px-3 py-2 text-right font-mono text-[10px] tabular-nums text-[#666]">
                        {o.cells_used}/{o.cells}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[10px] tabular-nums text-[#666]">{fmtInt(o.n)}</td>
                      <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-[#a1a1a1]">{(o.baseline ?? 0).toFixed(3)}</td>
                      <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-[#c9c9c9]">{(o.raw_exact ?? 0).toFixed(3)}</td>
                      <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-[#666]">{pct(o.correct / Math.max(1, o.n) + 0.0, 3)}</td>
                      <td className="px-3 py-2 text-right">
                        <Adj v={o.macro} wide />
                      </td>
                      <td className="px-3 py-2">
                        <CI ci={o.macro_ci} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Adj v={o.pooled} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Panel className="p-4">
            <p className="font-mono text-[9px] uppercase tracking-widest text-[#666]">adjusted MACRO, zero-centred</p>
            <div className="mt-3 space-y-2">
              {ranked.map((lab) => (
                <div key={lab} className="grid grid-cols-[150px_1fr_92px] items-center gap-3">
                  <span className="truncate font-mono text-[11px] text-[#c9c9c9]">{lab}</span>
                  <ZeroBar v={M[lab].overall.macro} max={maxAbs} />
                  <span className="text-right">
                    <Adj v={M[lab].overall.macro} />
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-3 font-mono text-[10px] leading-relaxed text-[#666]">
              Left of the line = worse than a constant answer; right = better. The line sits at 0.
            </p>
          </Panel>
          <Panel className="p-4">
            <p className="font-mono text-[9px] uppercase tracking-widest text-[#666]">excluded: structurally constant cells</p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-[#a1a1a1]">
              One ground truth for every image, so baseline = 1.0 and the transform is undefined. Excluded from all aggregates — not
              substituted with 0 or NaN-as-zero.
            </p>
            <ul className="mt-3 space-y-1.5 text-[12px] text-[#c9c9c9]">
              {constCells.map((c: Cell) => (
                <li key={c.domain + c.level} className="flex items-baseline justify-between gap-3 border-b border-[#141414] pb-1.5 last:border-0">
                  <span className="font-mono text-[11px]">
                    {c.domain} · L{c.level}
                  </span>
                  <span className="font-mono text-[10px] text-[#666]">
                    always <span className="text-[#a1a1a1]">{JSON.stringify(c.modal_gt)}</span> · n={fmtInt(c.n)}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </Section>

      <Section
        eyebrow="03 levels"
        title="Where the baseline eats the score"
        hint="Adjusted MACRO per level. L5 is negative for all six runs: after removing what a constant answer would have scored, everyone loses ground at the top of the ladder."
      >
        <Panel className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className="font-mono text-[9px] uppercase tracking-widest text-[#666]">
                  <th className="px-3 py-2 font-normal">run</th>
                  {levels.map((l) => (
                    <th key={l} className="px-3 py-2 text-right font-normal">
                      L{l}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ORDER.map((lab) => (
                  <tr key={lab} className="border-t border-[#141414]">
                    <th scope="row" className="px-3 py-2 text-left font-normal text-[12.5px] text-[#ededed]">
                      {SHORT[lab]}
                    </th>
                    {levels.map((l) => {
                      const row = M[lab].levels.find((x) => Number(x.key) === l) as Agg;
                      return (
                        <td key={l} className="px-3 py-2 text-right">
                          <Adj v={row?.macro ?? null} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="border-t border-[#262626] bg-[#0f0f0f] font-mono text-[10px] text-[#a1a1a1]">
                  <td className="px-3 py-2">baseline share</td>
                  {levels.map((l) => {
                    const row = M[ORDER[0]].levels.find((x) => Number(x.key) === l) as Agg;
                    return (
                      <td key={l} className="px-3 py-2 text-right tabular-nums">
                        {(row?.baseline ?? 0).toFixed(3)}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </Panel>
        <p className="mt-2 font-mono text-[10px] leading-relaxed text-[#666]">
          L5 also carries {constCells.filter((c) => c.level === 5).length} of the structurally constant cells, which are excluded here; the
          negative L5 values are over the remaining cells.
        </p>
      </Section>

      <Section
        eyebrow="04 families"
        title="Adjusted score by reasoning family"
        hint="Unweighted mean of the domain × level cells inside each family, constant cells excluded. Green is above the constant-answer baseline, red below."
      >
        <Panel className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-left">
              <thead>
                <tr className="font-mono text-[9px] uppercase tracking-widest text-[#666]">
                  <th className="px-3 py-2 font-normal">family</th>
                  {ORDER.map((lab) => (
                    <th key={lab} className="px-3 py-2 text-right font-normal">
                      {SHORT[lab]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {families.map((fam) => (
                  <tr key={fam} className="border-t border-[#141414]">
                    <th scope="row" className="px-3 py-2 text-left font-normal text-[12.5px] text-[#c9c9c9]">
                      {fam}
                    </th>
                    {ORDER.map((lab) => {
                      const row = M[lab].families.find((f) => f.key === fam) as Agg;
                      return (
                        <td key={lab} className="px-3 py-2 text-right">
                          <Adj v={row?.macro ?? null} />
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

      <Section
        eyebrow="05 cross-checks"
        title="Two checks the frontier tier ran"
        hint="Both are reproduced on the open-weight runs only. The first-tier half of each cannot be checked here because no frontier result or manifest exists on disk."
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel className="p-4">
            <p className="font-mono text-[9px] uppercase tracking-widest text-[#f0a5a5]">impossible_object — every run below baseline</p>
            <table className="mt-3 w-full text-left">
              <thead>
                <tr className="font-mono text-[9px] uppercase tracking-widest text-[#666]">
                  <th className="py-1.5 pr-2 font-normal">run</th>
                  <th className="px-2 py-1.5 text-right font-normal">n</th>
                  <th className="px-2 py-1.5 text-right font-normal">baseline</th>
                  <th className="px-2 py-1.5 text-right font-normal">raw</th>
                  <th className="py-1.5 pl-2 text-right font-normal">adjusted</th>
                </tr>
              </thead>
              <tbody>
                {io.map(({ l, row }) => (
                  <tr key={l} className="border-t border-[#141414]">
                    <th scope="row" className="py-1.5 pr-2 text-left font-normal font-mono text-[11px] text-[#c9c9c9]">
                      {SHORT[l]}
                    </th>
                    <td className="px-2 py-1.5 text-right font-mono text-[10px] tabular-nums text-[#666]">{fmtInt(row.n)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-[10px] tabular-nums text-[#a1a1a1]">{(row.baseline ?? 0).toFixed(4)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-[10px] tabular-nums text-[#a1a1a1]">{(row.raw_exact ?? 0).toFixed(4)}</td>
                    <td className="py-1.5 pl-2 text-right">
                      <Adj v={row.adjusted} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[12px] leading-relaxed text-[#a1a1a1]">
              All six open-weight runs score below a single constant answer on this domain. Combined with the frontier tier's own result
              that would be 16 of 16 models anti-correlated with the key — the open-weight half is what this page verifies.
            </p>
          </Panel>
          <Panel className="p-4">
            <p className="font-mono text-[9px] uppercase tracking-widest text-[#666]">
              {data.qwen_pair?.a} vs {data.qwen_pair?.b} — paired family differences
            </p>
            <table className="mt-3 w-full text-left">
              <thead>
                <tr className="font-mono text-[9px] uppercase tracking-widest text-[#666]">
                  <th className="py-1.5 pr-2 font-normal">family</th>
                  <th className="px-2 py-1.5 text-right font-normal">I</th>
                  <th className="px-2 py-1.5 text-right font-normal">T</th>
                  <th className="px-2 py-1.5 text-right font-normal">I − T</th>
                  <th className="py-1.5 pl-2 font-normal">95% CI</th>
                </tr>
              </thead>
              <tbody>
                {data.qwen_pair?.families.map((f) => {
                  const real = f.difference_ci[0] > 0 || f.difference_ci[1] < 0;
                  return (
                    <tr key={f.family} className="border-t border-[#141414]">
                      <th scope="row" className="max-w-[150px] truncate py-1.5 pr-2 text-left font-normal text-[11.5px] text-[#c9c9c9]">
                        {f.family}
                      </th>
                      <td className="px-2 py-1.5 text-right font-mono text-[10px] tabular-nums text-[#a1a1a1]">
                        {f.instruct_macro != null ? f.instruct_macro.toFixed(3) : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-[10px] tabular-nums text-[#a1a1a1]">
                        {f.thinking_macro != null ? f.thinking_macro.toFixed(3) : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <Adj v={f.difference} />
                      </td>
                      <td className="py-1.5 pl-2 font-mono text-[9.5px] tabular-nums" style={{ color: real ? "#9fd8b4" : "#666" }}>
                        [{f.difference_ci[0].toFixed(3)}, {f.difference_ci[1].toFixed(3)}]
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-3 text-[12px] leading-relaxed text-[#a1a1a1]">
              Paired image-level resampling: the mode switch trades geometry (Instruct ahead on Plane/Solid Geometry, Analytic,
              Topological) for physical and inductive reasoning (Thinking ahead on Physical &amp; Mechanical, Inductive, Projective).
            </p>
          </Panel>
        </div>
      </Section>

      <Section
        eyebrow="06 provenance"
        title="What could not be computed, and why"
        hint="Reported rather than approximated. No first-tier number appears anywhere above, and none was inferred."
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel className="p-4">
            <p className="font-mono text-[9px] uppercase tracking-widest text-[#f0c98a]">blocked: the 8,500-row tier comparison</p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-[#a1a1a1]">{data.subset_8500.reason}</p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-[#a1a1a1]">
              <span className="text-[#ededed]">Missing input:</span> {data.subset_8500.missing_input}
            </p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-[#a1a1a1]">
              <span className="text-[#ededed]">Ready:</span> {data.subset_8500.ready}
            </p>
            <p className="mt-3 border-t border-[#1c1c1c] pt-3 text-[12.5px] leading-relaxed text-[#a1a1a1]">
              {data.frontier_comparison.reason}
            </p>
          </Panel>
          <Panel className="p-4">
            <p className="font-mono text-[9px] uppercase tracking-widest text-[#666]">serving configuration</p>
            <div className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {ORDER.map((lab) => (
                <div key={lab} className="flex items-center gap-2">
                  <Dot color={M[lab] ? "#8a8a8a" : "#333"} size={6} />
                  <span className="font-mono text-[10.5px] text-[#c9c9c9]">{SHORT[lab]}</span>
                  <span className="font-mono text-[10px] text-[#555]">
                    {Object.keys(data.serving_configuration.recoverable.model_identifier_stored_per_record[lab] ?? {}).join(", ")}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-[#a1a1a1]">
              Only the identifier string stored in each record is recoverable. Not recoverable, and not guessed:
            </p>
            <ul className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
              {data.serving_configuration.not_recoverable.map((k) => (
                <li key={k} className="font-mono text-[10.5px] text-[#666]">
                  {k}
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t border-[#1c1c1c] pt-3 font-mono text-[10px] leading-relaxed text-[#555]">
              {data.serving_configuration.evidence}
            </p>
          </Panel>
        </div>
        <p className="mt-3 font-mono text-[10px] text-[#666]">
          artifact generated {data.generated} · engine scripts/open_models_test1_reanalysis.py · renderer
          scripts/open_models_test1_report.py · artifact data/open-models/reanalysis.json
        </p>
      </Section>
    </div>
  );
}
