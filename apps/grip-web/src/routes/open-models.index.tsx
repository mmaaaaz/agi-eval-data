import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useFocus, useOM } from "./open-models";
import { AccValue, Bar, Chip, Dot, ModeBadge, Panel, RankPill, Section, Tile, TileGrid } from "../components/open-models/ui";
import { FamilyMatrix, LevelSlope, WinnerGrid, shortName } from "../components/open-models/charts";
import { METRICS, type Metric, accOf, fmtInt, mean, pct, ranked, signed } from "../lib/openModelsFmt";
import type { Domain } from "../lib/openModelsTypes";

export const Route = createFileRoute("/open-models/")({ component: Overview });

/* --------------------------------------------------------------- helpers --- */

function levelAcc(domains: Domain[], modelId: string, level: number, skip?: (d: Domain) => boolean) {
  let n = 0;
  let ok = 0;
  for (const d of domains) {
    if (skip?.(d)) continue;
    const l = d.per.find((p) => p.model === modelId)?.levels[level - 1];
    if (!l) continue;
    n += l.n;
    ok += (l.acc ?? 0) * l.n;
  }
  return { n, acc: n ? ok / n : null };
}

/** Best model(s) on one domain. */
function winners(d: Domain): string[] {
  const best = Math.max(...d.per.map((p) => p.acc ?? 0));
  return d.per.filter((p) => Math.abs((p.acc ?? 0) - best) < 1e-12).map((p) => p.model);
}

/* ------------------------------------------------------------------ view --- */

export function Overview() {
  const a = useOM();
  const { focus, setFocus } = useFocus();
  const [metric, setMetric] = useState<Metric>("acc");
  const order = ranked(a.models);
  const lead = order[0];
  const second = order[1];
  const trailing = order[order.length - 1];
  const gap = (lead?.totals.acc ?? 0) - (second?.totals.acc ?? 0);
  const spread = (lead?.totals.acc ?? 0) - (trailing?.totals.acc ?? 0);

  const winRows = order.map((m) => ({ m, wins: a.domains.filter((d) => winners(d).includes(m.id)).length }));
  const maxWins = Math.max(1, ...winRows.map((w) => w.wins));
  const thinking = a.models.filter((m) => m.meta.mode === "thinking").length;

  // levels: everyone peaks at L1 and dips at L4; is every run under the L5 baseline?
  const l5Base = a.models[0].totals.levels[4]?.oracle ?? 0;
  const l5 = order.map((m) => ({ m, ...levelAcc(a.domains, m.id, 5), l4: levelAcc(a.domains, m.id, 4) }));
  const allUnderBaseline = l5.every((x) => (x.acc ?? 0) < l5Base);
  const droppedLevels = a.domains.filter((d) => d.const.some((c) => c.level === 5));
  const l5NoConst = order.map((m) => ({
    m,
    ...levelAcc(a.domains, m.id, 5, (d) => droppedLevels.includes(d)),
    l4: levelAcc(a.domains, m.id, 4),
  }));

  const zeros = a.audit.zeroHarness;
  const structured = zeros.filter((z) => z.kind === "structured");
  const multipart = zeros.filter((z) => z.kind === "multipart");
  const maxPart = multipart.length ? Math.max(...multipart.flatMap((z) => z.per.map((p) => p.partial ?? 0))) : 0;

  const agreement = a.models.map((m) => m.totals.agreement ?? 0);
  const overWorst = [...a.models].sort((x, y) => y.totals.over - x.totals.over)[0];
  const pfWorst = [...a.models].sort((x, y) => (y.totals.pfRate ?? 0) - (x.totals.pfRate ?? 0))[0];
  const pfBest = [...a.models].sort((x, y) => (x.totals.pfRate ?? 0) - (y.totals.pfRate ?? 0))[0];

  const byAcc = [...a.domains].sort((x, y) => (accOf(y, lead?.id ?? "") ?? 0) - (accOf(x, lead?.id ?? "") ?? 0));

  const fieldAcc = mean(a.models.map((m) => m.totals.acc ?? 0));
  const fieldGuess = mean(a.models.map((m) => m.totals.headroom ?? 0));
  const fieldPf = mean(a.models.map((m) => m.totals.pfRate ?? 0));

  return (
    <div>
      {/* ------------------------------------------------------------ hero --- */}
      <section className="pb-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#a1a1a1]">
          {a.benchmark.name} · {a.models.length} open VLMs · {a.domains.length} domains × 5 levels · {fmtInt(a.benchmark.questionsPerModel)} questions each
        </p>
        <h1 className="mt-3 max-w-[30ch] text-3xl font-semibold leading-[1.08] tracking-tighter text-white sm:text-4xl lg:text-[44px]">
          Six open models, one benchmark, <span className="text-accent">one frozen grading rule</span>
        </h1>
        <p className="mt-4 max-w-[88ch] text-[14.5px] leading-relaxed text-[#a1a1a1]">
          Every answer every run produced is re-graded by a single published rule, so each model has exactly one accuracy here and the
          gaps are model differences rather than grading differences. All {fmtInt(a.integrity.gtPairing.checked)} comparable questions
          share one ground truth across the {a.models.length} runs.
        </p>

        <div className="mt-6 grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
          <TileGrid cols={4}>
            <Tile label="runs" value={fmtInt(a.models.length)} sub={thinking + " in thinking mode · sorted by accuracy"} />
            <Tile
              label="questions / run"
              value={
                a.benchmark.questionsRange[0] === a.benchmark.questionsRange[1]
                  ? fmtInt(a.benchmark.questionsRange[0])
                  : fmtInt(a.benchmark.questionsRange[0]) + "–" + fmtInt(a.benchmark.questionsRange[1])
              }
              sub={
                "L1–L5 · " +
                (a.benchmark.imagesRange[0] === a.benchmark.imagesRange[1]
                  ? fmtInt(a.benchmark.imagesRange[0])
                  : fmtInt(a.benchmark.imagesRange[0]) + "–" + fmtInt(a.benchmark.imagesRange[1])) +
                " images each"
              }
            />
            <Tile label="benchmark" value={a.domains.length + " × 5"} sub={a.benchmark.families.length + " reasoning families"} />
            <Tile
              label="accuracy"
              value={pct(lead?.totals.acc ?? null, 2)}
              accent={lead?.accent}
              sub={"best: " + (lead ? shortName(lead) : "") + " · field mean " + pct(fieldAcc, 2) + " · worst " + pct(trailing?.totals.acc ?? null, 1)}
            />
          </TileGrid>

          <Panel className="p-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[9px] uppercase tracking-widest text-[#666]">read the report</span>
              <span className="font-mono text-[9px] text-[#555]">{a.benchmark.grader.version}</span>
            </div>
            <ul className="mt-3 space-y-2">
              {[
                { to: "/open-models/domains", label: "Domain table", hint: "all runs, side by side" },
                { to: "/open-models/matrix", label: "Matrix & winner map", hint: "domain × level" },
                { to: "/open-models/compare", label: "Head to head", hint: "any two runs" },
                { to: "/open-models/audit", label: "Grading audit", hint: "where the scorers differ" },
                { to: "/open-models/method", label: "Method", hint: "rule, checks, caveats" },
              ].map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="group flex items-baseline justify-between gap-3 border-b border-[#141414] pb-2 last:border-0">
                    <span className="font-mono text-[11px] text-[#ededed] group-hover:text-accent">{l.label}</span>
                    <span className="text-right font-mono text-[9px] text-[#555]">{l.hint} →</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </section>

      {/* --------------------------------------------------------- league --- */}
      <Section
        eyebrow="01 league"
        title={"All " + a.models.length + " runs, ranked"}
        hint="Accuracy is right answers ÷ all answers under the one published rule — nothing is excluded from the denominator. The whisker is the 95% interval; the bar shows how far each run sits above what guessing the most common answer scores."
      >
        <Panel>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead>
                <tr className="border-b border-[#262626] font-mono text-[9px] uppercase tracking-widest text-[#666]">
                  <th className="px-3 py-2.5 font-normal">#</th>
                  <th className="px-3 py-2.5 font-normal">run</th>
                  <th className="px-3 py-2.5 font-normal">accuracy</th>
                  <th className="px-3 py-2.5 text-right font-normal" title="accuracy minus what guessing the most common answer scores">
                    vs guessing
                  </th>
                  <th className="px-3 py-2.5 text-right font-normal" title="share of answers with no usable, committed answer">
                    no usable answer
                  </th>
                  <th className="px-3 py-2.5 font-normal" title="accuracy against the guessing baseline" />
                </tr>
              </thead>
              <tbody>
                {order.map((m, i) => (
                  <tr
                    key={m.id}
                    onMouseEnter={() => setFocus(m.id)}
                    onMouseLeave={() => setFocus(null)}
                    className="border-b border-[#141414] last:border-0 transition-colors hover:bg-[#101010]"
                    style={{ background: focus === m.id ? "#101010" : undefined }}
                  >
                    <td className="px-3 py-3">
                      <RankPill rank={i + 1} accent={m.accent} />
                    </td>
                    <td className="px-3 py-3">
                      <Link to="/open-models/models/$id" params={{ id: m.id }} className="group flex flex-wrap items-center gap-2">
                        <Dot color={m.accent} />
                        <span className="text-[#ededed] group-hover:text-accent">{m.label}</span>
                        <ModeBadge mode={m.meta.mode} />
                        {m.meta.org && <span className="font-mono text-[9px] text-[#555]">{m.meta.org}</span>}
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <AccValue value={m.totals.acc} ci={m.totals.ci} color={m.accent} width={64} />
                      <span className="mt-0.5 block font-mono text-[9px] text-[#555]">
                        {i === 0 ? "best" : signed((m.totals.acc ?? 0) - (lead.totals.acc ?? 0), 1) + " vs best"}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs tabular-nums" style={{ color: m.accent }}>
                      {signed(m.totals.headroom, 1)}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs tabular-nums" style={{ color: (m.totals.pfRate ?? 0) > 0.1 ? "#f0a5a5" : "#a1a1a1" }}>
                      {pct(m.totals.pfRate, 1)}
                    </td>
                    <td className="w-[140px] px-3 py-3">
                      <Bar value={m.totals.acc} oracle={m.totals.oracle} color={m.accent} height={6} />
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-[#333] bg-[#0f0f0f] font-mono text-[11px]">
                  <td />
                  <td className="px-3 py-3 text-[#a1a1a1]">
                    field mean
                    <span className="ml-2 text-[9px] text-[#555]">{a.models.length} runs, equal weight</span>
                  </td>
                  <td className="px-3 py-3">
                    <span className="t-num font-semibold tabular-nums text-[#ededed]">{pct(fieldAcc, 2)}</span>
                    <span className="mt-0.5 block font-mono text-[9px] text-[#555]">
                      best {pct(lead.totals.acc, 1)} · worst {pct(trailing.totals.acc, 1)}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-[#a1a1a1]">{signed(fieldGuess, 1)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-[#a1a1a1]">{pct(fieldPf, 1)}</td>
                  <td className="px-3 py-3">
                    <div className="relative h-[6px] w-full overflow-hidden rounded-sm bg-[#141414]">
                      <span className="absolute inset-y-0 left-0 rounded-sm bg-[#6b6b6b]" style={{ width: (fieldAcc ?? 0) * 100 + "%" }} />
                      <span className="absolute top-0 h-full w-px bg-[#8a8a8a]" style={{ left: (a.models[0].totals.oracle ?? 0) * 100 + "%" }} />
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Panel>

        <details className="group mt-2">
          <summary className="cursor-pointer list-none font-mono text-[10px] text-[#666] transition-colors hover:text-[#a1a1a1]">
            ▸ what do these numbers mean?
          </summary>
          <dl className="mt-2 grid gap-x-8 gap-y-1.5 rounded-lg border border-[#1c1c1c] bg-[#080808] p-3.5 lg:grid-cols-2">
            {[
              ["accuracy", "Right answers ÷ all answers, under the one published grading rule. One number per run — the headline."],
              ["vs guessing", "Accuracy minus " + pct(a.models[0].totals.oracle, 2) + ", which is what you score by always writing the most common answer. It answers “is it really looking at the image?”."],
              ["no usable answer", "The share of answers that were blank, or so long no final answer could be read. They may have reasoned correctly — nobody can mark them."],
              ["the run's own scorer", "The mark the run's own harness gave the same answers. A cross-check on our rule, kept on the audit page — not a second ability."],
              ["partly right", "Half marks: the mean share of answer parts matched, e.g. “2; orientable” answered as “2”. Shown on domain and level pages."],
              ["markers agree", "How often our rule and the run's own scorer reached the same verdict (96–98%). High agreement is why the ranking can be trusted."],
            ].map(([term, meaning]) => (
              <div key={term} className="flex gap-3">
                <dt className="w-[130px] flex-none font-mono text-[10px] text-[#a1a1a1]">{term}</dt>
                <dd className="text-[11.5px] leading-relaxed text-[#666]">{meaning}</dd>
              </div>
            ))}
          </dl>
        </details>
      </Section>

      {/* ------------------------------------------------------- findings --- */}
      <Section
        eyebrow="02 findings"
        title="What the field says"
        hint="Every figure is computed from the artifact at render time; nothing here is transcribed by hand."
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <Finding tag="headline" title={(lead?.label ?? "") + " leads, and the field spans " + (spread * 100).toFixed(1) + " points"} accent={lead?.accent}>
            <p>
              {(lead?.label ?? "") + " reaches "}<b>{pct(lead?.totals.acc ?? null, 2)}</b>, {signed(gap, 1)} ahead of{" "}
              {second?.label}. The last-placed run, {trailing?.label}, sits at <b>{pct(trailing?.totals.acc ?? null, 2)}</b>.
            </p>
            <p>
              Nobody clears 43%: even the leader fails {Math.round((1 - (lead?.totals.acc ?? 0)) * 100)} of every 100 questions. Per run, n
              and coverage are identical ({fmtInt(a.benchmark.questionsRange[0])}
              {a.benchmark.questionsRange[1] !== a.benchmark.questionsRange[0] ? "–" + fmtInt(a.benchmark.questionsRange[1]) : ""} questions,
              same {a.domains.length} domains).
            </p>
          </Finding>

          <Finding
            tag="difficulty"
            tone="warn"
            title={"At L5 the majority answer beats every model"}
          >
            <p>
              Accuracy falls from L1 to L4 in every run, then ticks up at L5. That uptick is not ability: L5 carries{" "}
              {droppedLevels.length} single-answer domains. Drop them and the L5 rise narrows from{" "}
              {signed(Math.min(...l5.map((x) => (x.acc ?? 0) - (x.l4.acc ?? 0))), 1)}–
              {signed(Math.max(...l5.map((x) => (x.acc ?? 0) - (x.l4.acc ?? 0))), 1)} to{" "}
              {signed(Math.min(...l5NoConst.map((x) => (x.acc ?? 0) - (x.l4.acc ?? 0))), 1)}–
              {signed(Math.max(...l5NoConst.map((x) => (x.acc ?? 0) - (x.l4.acc ?? 0))), 1)} points.
            </p>
            <p>
              More bluntly: the L5 majority-answer baseline is <b>{pct(l5Base, 1)}</b> and{" "}
              {allUnderBaseline ? <b>every one of the {a.models.length} runs scores below it</b> : "the best run only just clears it"} — on
              those questions a model is worse than guessing the most common answer. The L5 slice is hard to read and should be
              rebalanced upstream.
            </p>
          </Finding>

          <Finding
            tag="grading"
            tone="ok"
            title={"The runs' own scorers agree on " + pct(Math.min(...agreement), 1) + "–" + pct(Math.max(...agreement), 1) + " of questions"}
          >
            <p>
              Every answer is scored twice: by the run's harness and by the frozen rule. Where they disagree, the harness errs both ways —
              it credits answers the rule rejects and rejects answers it accepts. The largest over-crediting run is{" "}
              <b>{overWorst?.label}</b> at <b>{fmtInt(overWorst?.totals.over)}</b> questions.
            </p>
            <p>
              Formatting is the other axis: {pfWorst?.label} leaves <b>{pct(pfWorst?.totals.pfRate ?? null, 1)}</b> of answers with no usable
              answer
              against {pct(pfBest?.totals.pfRate ?? null, 2)} for {pfBest?.label}. A model that cannot format its answer loses questions it
              may have reasoned correctly.
            </p>
          </Finding>

          <Finding
            tag="publish blocker"
            tone="warn"
            title={zeros.length + " domain-levels score 0.0% for all " + a.models.length + " runs"}
          >
            <p>
              <b>{structured.length}</b> are grader failures: ground truth stored as a dict or list, which a string comparison cannot read.
              The frozen rule recovers them — up to <b>{pct(Math.max(...structured.flatMap((z) => z.per.map((p) => p.acc ?? 0))), 1)}</b> for
              the best run. <b>{multipart.length}</b> are semicolon-separated answers where a run supplies one part (up to{" "}
              <b>{pct(maxPart, 1)}</b> of the parts present), so those levels are not empty either.
            </p>
            <p>
              That leaves <b>{a.audit.zeroFrozen.length}</b> levels where every run scores exactly zero under the rule — the benchmark's
              genuinely unsolved core. The audit page lists each one.
            </p>
          </Finding>
        </div>

        <Panel className="mt-3 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-mono text-[9px] uppercase tracking-widest text-[#666]">domains won, out of {a.domains.length}</p>
            <p className="font-mono text-[10px] text-[#555]">a domain is won by the run with the highest frozen-rule accuracy on it</p>
          </div>
          <div className="mt-3 flex h-[10px] w-full overflow-hidden rounded-sm bg-[#141414]">
            {winRows.map((w) => (
              <span key={w.m.id} title={w.m.label + " · " + w.wins} style={{ width: (w.wins / a.domains.length) * 100 + "%", background: w.m.accent, opacity: w.wins ? 1 : 0.25 }} />
            ))}
          </div>
          <div className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {winRows.map((w) => (
              <button
                key={w.m.id}
                type="button"
                onClick={() => setFocus(focus === w.m.id ? null : w.m.id)}
                className="flex items-center gap-2 text-left"
              >
                <Dot color={w.m.accent} size={7} />
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#c9c9c9]">{w.m.label}</span>
                <span className="w-14 flex-none">
                  <Bar value={w.wins / maxWins} color={w.m.accent} height={5} showOracle={false} />
                </span>
                <span className="w-14 flex-none text-right font-mono text-[11px] tabular-nums" style={{ color: w.wins ? w.m.accent : "#555" }}>
                  {w.wins} / {a.domains.length}
                </span>
              </button>
            ))}
          </div>
        </Panel>
      </Section>

      {/* -------------------------------------------------------- curves --- */}
      <Section
        eyebrow="03 difficulty curve"
        title="Accuracy by cognitive task, L1 → L5"
        hint="The levels are the dataset's own ladder. Every run is drawn; click one in the strip above to isolate it. The dashed line is the majority-answer baseline for each level."
        right={
          <div className="flex flex-wrap items-center gap-2">
            {METRICS.filter((m) => m.id !== "headroom").map((m) => (
              <Chip key={m.id} active={metric === m.id} onClick={() => setMetric(m.id)} title={m.hint}>
                {m.short}
              </Chip>
            ))}
          </div>
        }
      >
        <Panel className="p-4 sm:p-5">
          <LevelSlope models={order} levels={a.benchmark.levels} metric={metric} focus={focus} onFocus={setFocus} />
        </Panel>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {a.benchmark.levels.map((lv) => {
            const best = order.map((m) => ({ m, v: m.totals.levels[lv.n - 1]?.acc ?? 0 })).sort((x, y) => y.v - x.v)[0];
            return (
              <div key={lv.n} className="rounded-lg border border-[#262626] bg-[#0a0a0a] p-3">
                <div className="flex items-baseline justify-between">
                  <p className="font-mono text-[9px] uppercase tracking-widest text-[#666]">
                    L{lv.n} — {lv.short}
                  </p>
                  <p className="font-mono text-[10px] tabular-nums" style={{ color: best?.m.accent }}>
                    {pct(best?.v ?? null, 1)}
                  </p>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-[#a1a1a1]">{lv.desc}</p>
                <p className="mt-2 font-mono text-[9px] text-[#555]">
                  best {best ? shortName(best.m) + " " + pct(best.v, 1) : "—"} ·{" "}
                  <span className="text-[#9a9a9a]">field mean {pct(mean(order.map((m) => m.totals.levels[lv.n - 1]?.acc ?? 0)), 1)}</span> · guessing{" "}
                  {pct(a.models[0].totals.levels[lv.n - 1]?.oracle ?? null, 1)}
                </p>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ------------------------------------------------------- families --- */}
      <Section
        eyebrow="04 families"
        title="Reasoning families"
        hint="Nine families over 34 domains. Framed cells are the best run in that family; the last column is the majority-answer baseline for the same slice."
      >
        <Panel className="p-3 sm:p-4">
          <FamilyMatrix models={order} focus={focus} onFocus={setFocus} />
        </Panel>
      </Section>

      {/* ----------------------------------------------------- winner map --- */}
      <Section
        eyebrow="05 winner map"
        title="Who leads each domain × level cell"
        hint={"Each tile is coloured by the run with the highest frozen-rule accuracy in that cell; “—” means every run scored zero. " + a.audit.zeroFrozen.length + " cells are unsolved by all " + a.models.length + " runs."}
      >
        <Panel className="p-3 sm:p-4">
          <WinnerGrid domains={a.domains} levels={a.benchmark.levels} models={order} families={a.benchmark.families} focus={focus} />
        </Panel>
      </Section>

      {/* ---------------------------------------------------------- index --- */}
      <Section
        eyebrow="06 index"
        title="Hardest and easiest slices"
        hint={"Ranked by " + (lead?.label ?? "the leader") + " — the strongest run overall. ◆ marks a domain with a single-answer level."}
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel className="p-3.5">
            <p className="mb-2 font-mono text-[9px] uppercase tracking-widest text-[#666]">easiest for {shortName(lead)}</p>
            <DomainIndex domains={byAcc.slice(0, 6)} modelId={lead.id} accent={lead.accent} />
          </Panel>
          <Panel className="p-3.5">
            <p className="mb-2 font-mono text-[9px] uppercase tracking-widest text-[#666]">
              hardest for {shortName(lead)} — all runs under 25%
            </p>
            <DomainIndex domains={byAcc.slice(-6).reverse()} modelId={lead.id} accent={lead.accent} />
          </Panel>
        </div>
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------- fragments --- */

function DomainIndex({ domains, modelId, accent }: { domains: Domain[]; modelId: string; accent: string }) {
  return (
    <ul className="divide-y divide-[#141414]">
      {domains.map((d) => (
        <li key={d.key} className="flex items-center gap-3 py-2">
          <Link
            to="/open-models/domains/$slug"
            params={{ slug: d.key }}
            className="min-w-0 flex-1 truncate text-[13px] text-[#ededed] transition-colors hover:text-accent"
          >
            {d.label}
          </Link>
          {d.const.length > 0 && (
            <span className="flex-none font-mono text-[9px] text-[#f0a5a5]" title={"single-answer levels: L" + d.const.map((c) => c.level).join(", L")}>
              ◆ {d.const.map((c) => "L" + c.level).join(", ")}
            </span>
          )}
          <span className="hidden w-24 flex-none font-mono text-[9px] text-[#555] sm:inline">{d.familyName}</span>
          <div className="hidden w-24 flex-none sm:block">
            <Bar value={accOf(d, modelId)} oracle={d.oracle} color={accent} height={5} />
          </div>
          <span className="w-12 flex-none text-right font-mono text-[11px] tabular-nums text-[#ededed]">{pct(accOf(d, modelId), 1)}</span>
        </li>
      ))}
    </ul>
  );
}

function Finding({
  tag,
  title,
  tone = "neutral",
  accent,
  children,
}: {
  tag: string;
  title: string;
  tone?: "neutral" | "warn" | "ok";
  accent?: string;
  children: React.ReactNode;
}) {
  const border = tone === "warn" ? "border-[#3a2626]" : tone === "ok" ? "border-[#22362a]" : "border-[#262626]";
  return (
    <article className={"rounded-lg border bg-[#0a0a0a] p-4 " + border}>
      <span className="font-mono text-[9px] uppercase tracking-widest text-[#666]">{tag}</span>
      <h3 className="mt-1.5 text-[15px] font-medium leading-snug tracking-tight" style={{ color: accent ?? "#fff" }}>
        {title}
      </h3>
      <div className="mt-2 space-y-2 text-[13px] leading-relaxed text-[#a1a1a1] [&_b]:font-semibold [&_b]:text-[#ededed]">{children}</div>
    </article>
  );
}
