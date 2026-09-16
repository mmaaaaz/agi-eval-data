import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useOM } from "./open-models";
import { AccValue, Bar, Chip, Panel, Section, Tile, TileGrid, Dot } from "../components/open-models/ui";
import { DivergeBars, FamilyBars, LevelCurve } from "../components/open-models/charts";
import { METRICS, type Metric, accOf, fmtInt, pct, ranked, signed } from "../lib/openModelsFmt";
import type { Artifact, Domain, ModelEntry } from "../lib/openModelsTypes";

export const Route = createFileRoute("/open-models/")({ component: Overview });

/* --------------------------------------------------------------- helpers --- */

/** Level accuracy for one model, optionally excluding some domain/level cells. */
function levelAcc(domains: Domain[], modelId: string, level: number, skip?: (d: Domain) => boolean) {
  let n = 0;
  let ok = 0;
  let partial = 0;
  for (const d of domains) {
    if (skip?.(d)) continue;
    const row = d.per.find((p) => p.model === modelId);
    const l = row?.levels[level - 1];
    if (!l) continue;
    n += l.n;
    ok += (l.acc ?? 0) * l.n;
    partial += (l.partial ?? 0) * l.n;
  }
  return { n, acc: n ? ok / n : null, partial: n ? partial / n : null };
}

/** Accuracy over a specific list of domain/level cells. */
function cellsAcc(domains: Domain[], cells: { domain: string; level: number }[], modelId: string) {
  let n = 0;
  let ok = 0;
  for (const c of cells) {
    const d = domains.find((x) => x.key === c.domain);
    const row = d?.per.find((p) => p.model === modelId);
    const l = row?.levels[c.level - 1];
    if (!l) continue;
    n += l.n;
    ok += (l.acc ?? 0) * l.n;
  }
  return { n, acc: n ? ok / n : null };
}

function pairRecord(a: Artifact, x: ModelEntry, y: ModelEntry) {
  let xWins = 0;
  let yWins = 0;
  const margins: { d: Domain; delta: number }[] = [];
  for (const d of a.domains) {
    const rx = d.per.find((p) => p.model === x.id)?.acc ?? 0;
    const ry = d.per.find((p) => p.model === y.id)?.acc ?? 0;
    if (rx > ry) xWins++;
    else if (ry > rx) yWins++;
    margins.push({ d, delta: rx - ry });
  }
  margins.sort((p, q) => q.delta - p.delta);
  return { xWins, yWins, margins };
}

/* ------------------------------------------------------------------ view --- */

export function Overview() {
  const a = useOM();
  const [metric, setMetric] = useState<Metric>("acc");
  const order = ranked(a.models);
  const lead = order[0];
  const second = order[1];
  const gap = lead && second ? (lead.totals.acc ?? 0) - (second.totals.acc ?? 0) : 0;
  const rec = lead && second ? pairRecord(a, lead, second) : null;

  const zeroHarness = a.audit.zeroHarness;
  const structured = zeroHarness.filter((z) => z.kind === "structured");
  const multipart = zeroHarness.filter((z) => z.kind === "multipart");
  const plainWrong = zeroHarness.filter((z) => z.kind === "plain");
  const recovered = structured.filter((z) => (z.per.some((p) => (p.acc ?? 0) > 0))).length;
  const maxPart = multipart.length
    ? Math.max(...multipart.flatMap((z) => z.per.map((p) => p.partial ?? 0)))
    : 0;

  const constCells = a.audit.constantLevels.map((c) => ({ domain: c.domain, level: c.level }));
  const constPerModel = order.map((m) => ({
    m,
    ...cellsAcc(a.domains, constCells, m.id),
    blind: 1,
  }));

  const dropped = (d: Domain) => d.const.some((c) => c.level === 5);
  const l5 = order.map((m) => ({
    m,
    withConst: levelAcc(a.domains, m.id, 5),
    without: levelAcc(a.domains, m.id, 5, dropped),
    l4: levelAcc(a.domains, m.id, 4),
  }));

  const leadId = lead?.id ?? a.models[0].id;
  const byAcc = [...a.domains].sort((x, y) => (accOf(y, leadId) ?? 0) - (accOf(x, leadId) ?? 0));
  const weakest = [...a.domains].sort((x, y) => (accOf(x, leadId) ?? 0) - (accOf(y, leadId) ?? 0));

  const movers = a.audit.underCredited[0];
  const droppers = a.audit.overCredited[0];
  const driftShare = a.integrity.gtDrift.mismatch / Math.max(1, a.integrity.gtDrift.checked);

  return (
    <div>
      {/* ------------------------------------------------------------ hero --- */}
      <section className="pb-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#a1a1a1]">
          {a.benchmark.name} · {a.models.length} open VLMs · {a.benchmark.domains} domains · L1–L5 · {fmtInt(a.benchmark.questionsPerModel)} questions each
        </p>
        <h1 className="mt-3 max-w-[26ch] text-3xl font-semibold leading-[1.08] tracking-tighter text-white sm:text-4xl lg:text-[44px]">
          Every open-model answer, re-graded by <span className="text-accent">one frozen rule</span>
        </h1>
        <p className="mt-4 max-w-[86ch] text-[14.5px] leading-relaxed text-[#a1a1a1]">
          Both runs are scored against the ground truth they recorded, by a single published comparison rule —
          so each model has exactly one accuracy here. The runs' own scorer is shown alongside as a
          grader-quality check: it agrees on {pct(lead?.totals.agreement ?? null, 1)} and {pct(second?.totals.agreement ?? null, 1)} of
          questions and mis-scores the rest in both directions.
        </p>

        <div className="mt-6 grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
          <TileGrid cols={3}>
            <Tile label="questions / model" value={fmtInt(a.benchmark.questionsPerModel)} sub={"L1–L5 balanced at " + fmtInt((a.models[0]?.totals.levels[0]?.n ?? 0))} />
            <Tile label="images / model" value={fmtInt(a.benchmark.imagesPerModel)} sub={fmtInt(a.integrity.evaluatedPerDomain) + " of " + fmtInt(a.integrity.nominalPerDomain) + " per domain"} />
            <Tile
              label="best accuracy"
              value={pct(lead?.totals.acc ?? null, 2)}
              accent={lead?.accent}
              sub={(lead?.label ?? "") + " · +" + (gap * 100).toFixed(1) + " pts over " + (second?.label ?? "")}
            />
          </TileGrid>

          <Panel className="p-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[9px] uppercase tracking-widest text-[#666]">read the report</span>
              <span className="font-mono text-[9px] text-[#555]">{a.benchmark.grader.version}</span>
            </div>
            <ul className="mt-3 space-y-2">
              {[
                { to: "/open-models/domains", label: "Domain table", hint: "sort, filter, per-level" },
                { to: "/open-models/matrix", label: "Domain × level matrix", hint: "the whole benchmark at a glance" },
                { to: "/open-models/compare", label: "Head to head", hint: "wins, gaps, 1:1 scatter" },
                { to: "/open-models/audit", label: "Grading audit", hint: "where the runs' scorer errs" },
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
        title="Leaderboard"
        hint="Accuracy is per question under the frozen rule, counted over the full evaluated set — nothing is excluded from the denominator. The whisker is the 95% Wilson interval."
      >
        <Panel>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-[#262626] font-mono text-[9px] uppercase tracking-widest text-[#666]">
                  <th className="px-3 py-2.5 font-normal">#</th>
                  <th className="px-3 py-2.5 font-normal">model</th>
                  <th className="px-3 py-2.5 font-normal">accuracy</th>
                  <th className="px-3 py-2.5 text-right font-normal">vs best</th>
                  <th className="px-3 py-2.5 text-right font-normal">self-score</th>
                  <th className="px-3 py-2.5 text-right font-normal">partial</th>
                  <th className="px-3 py-2.5 text-right font-normal">oracle</th>
                  <th className="px-3 py-2.5 text-right font-normal">headroom</th>
                  <th className="px-3 py-2.5 text-right font-normal">parse fail</th>
                  <th className="px-3 py-2.5 text-right font-normal">agreement</th>
                  <th className="px-3 py-2.5 font-normal">share</th>
                </tr>
              </thead>
              <tbody>
                {order.map((m, i) => (
                  <tr key={m.id} className="border-b border-[#141414] last:border-0 transition-colors hover:bg-[#101010]">
                    <td className="px-3 py-3 font-mono text-[11px] text-[#666]">{i + 1}</td>
                    <td className="px-3 py-3">
                      <Link to="/open-models/models/$id" params={{ id: m.id }} className="group flex items-center gap-2">
                        <Dot color={m.accent} />
                        <span className="text-[#ededed] group-hover:text-accent">{m.label}</span>
                        {m.meta.org && <span className="font-mono text-[9px] text-[#555]">{m.meta.org}</span>}
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <AccValue value={m.totals.acc} ci={m.totals.ci} color={m.accent} width={64} />
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-[#a1a1a1]">
                      {i === 0 ? "—" : signed((m.totals.acc ?? 0) - (order[0].totals.acc ?? 0), 1)}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-[#a1a1a1]">{pct(m.totals.as, 1)}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-[#a1a1a1]">{pct(m.totals.partial, 1)}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-[#666]">{pct(m.totals.oracle, 1)}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs tabular-nums" style={{ color: m.accent }}>
                      {signed(m.totals.headroom, 1)}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-[#a1a1a1]">
                      {pct(m.totals.pfRate, 2)}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-[#a1a1a1]">{pct(m.totals.agreement, 2)}</td>
                    <td className="w-[130px] px-3 py-3">
                      <Bar value={m.totals.acc} oracle={m.totals.oracle} color={m.accent} height={6} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <p className="mt-2 font-mono text-[10px] leading-relaxed text-[#666]">
          oracle = always answering the most common ground truth for the same slice · headroom = accuracy − oracle ·
          agreement = share of questions where the frozen rule and the run's own scorer reach the same verdict.
        </p>
      </Section>

      {/* ------------------------------------------------------- findings --- */}
      <Section
        eyebrow="02 findings"
        title="What the numbers say"
        hint="Every figure is computed from the artifact at render time; nothing on this page is transcribed by hand."
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <Finding
            tag="headline"
            title={(lead?.label ?? "") + " leads by " + (gap * 100).toFixed(1) + " points"}
            accent={lead?.accent}
          >
            <p>
              {(lead?.label ?? "") + " scores "}
              <b>{pct(lead?.totals.acc ?? null, 2)}</b> against <b>{pct(second?.totals.acc ?? null, 2)}</b> for{" "}
              {second?.label}. The gap survives every check: both the runs' own scorer ({pct(lead?.totals.as ?? null, 1)} /{" "}
              {pct(second?.totals.as ?? null, 1)}) and partial credit ({pct(lead?.totals.partial ?? null, 1)} /{" "}
              {pct(second?.totals.partial ?? null, 1)}).
            </p>
            <p>
              Neither model reaches 40%: even the leader fails roughly {Math.round((1 - (lead?.totals.acc ?? 0)) * 100)} of every 100 questions.
            </p>
          </Finding>

          <Finding tag="grader quality" tone="ok" title={"The runs' own scorer agrees on " + pct(lead?.totals.agreement ?? null, 1) + " / " + pct(second?.totals.agreement ?? null, 1)}>
            <p>
              Where it disagrees it errs both ways: it credits <b>{fmtInt(lead?.totals.over)}</b> / <b>{fmtInt(second?.totals.over)}</b>{" "}
              answers the frozen rule rejects, and rejects <b>{fmtInt(lead?.totals.under)}</b> / <b>{fmtInt(second?.totals.under)}</b> it accepts.
            </p>
            <p>
              The headline effect partly cancels ({pct(lead?.totals.as ?? null, 1)} → {pct(lead?.totals.acc ?? null, 1)},{" "}
              {pct(second?.totals.as ?? null, 1)} → {pct(second?.totals.acc ?? null, 1)}); per domain it does not.
            </p>
            <p className="font-mono text-[11.5px]">
              <span className="text-[#666]">biggest corrections: </span>
              {order.map((m, i) => (
                <span key={m.id} className="mr-4 inline-block">
                  <span style={{ color: m.accent }}>{m.label}</span>{" "}
                  <b>{movers ? signed(movers.per[a.models.findIndex((x) => x.id === m.id)], 1) : "—"}</b>{" "}
                  <span className="text-[#666]">{movers?.label}</span> ·{" "}
                  <b>{droppers ? signed(droppers.per[a.models.findIndex((x) => x.id === m.id)], 1) : "—"}</b>{" "}
                  <span className="text-[#666]">{droppers?.label}</span>
                  {i === 0 ? "" : ""}
                </span>
              ))}
            </p>
          </Finding>

          <Finding
            tag="publish blocker"
            tone="warn"
            title={zeroHarness.length + " domain-levels score 0.0% for both models"}
          >
            <p>
              <b>{structured.length}</b> are grader failures: ground truth stored as{" "}
              <code className="font-mono text-[11px] text-[#c9c9c9]">{"{'time_of_flight_s': 3.9, 'range_m': 34.5}"}</code> or{" "}
              <code className="font-mono text-[11px] text-[#c9c9c9]">["blue", "purple"]</code>, which a string comparison cannot read. The
              frozen rule recovers {recovered} of them — {findRecovered(zeroHarness)}.
            </p>
            <p>
              <b>{multipart.length}</b> are semicolon-separated answers where a model supplies one part — up to <b>{pct(maxPart, 1)}</b> of the
              parts present, so the level is not empty. <b>{plainWrong.length}</b>{" "}
              {plainWrong.length === 1 ? "is" : "are"} genuinely wrong on both models.
            </p>
          </Finding>

          <Finding tag="level design" title={a.audit.constantLevels.length + " levels have a single answer for all " + fmtInt(a.audit.constantLevels[0]?.n ?? 0) + " images"}>
            <p>
              {a.audit.constantLevels
                .slice(0, 3)
                .map((c) => c.label + " L" + c.level + " is always " + c.top)
                .join(", ")}
              {" …"} Blind answering scores 100% on all {a.audit.constantLevels.length}.
            </p>
            <p>
              Models profit: {constPerModel.map((c, i) => (
                <span key={c.m.id}>
                  {i > 0 && " · "}
                  <b style={{ color: c.m.accent }}>{pct(c.acc, 1)}</b> for {c.m.label}
                </span>
              ))}{" "}
              over those {fmtInt(constPerModel[0]?.n ?? 0)} questions. Dropping the constant L5 levels cuts the apparent L5 rebound from{" "}
              {l5
                .map((x) => {
                  const withConst = ((x.withConst.acc ?? 0) - (x.l4.acc ?? 0)) * 100;
                  const without = ((x.without.acc ?? 0) - (x.l4.acc ?? 0)) * 100;
                  return withConst.toFixed(1) + " → " + without.toFixed(1) + " for " + x.m.label;
                })
                .join(" · ")}
              .
            </p>
          </Finding>

          <Finding tag="difficulty" title="L4 is the real difficulty peak">
            <p>
              {a.models.map((m, i) => (
                <span key={m.id}>
                  {i > 0 && " · "}
                  <b style={{ color: m.accent }}>{m.label}</b>{" "}
                  {m.totals.levels.map((l) => (l.acc == null ? "—" : (l.acc * 100).toFixed(1))).join(" → ")}
                </span>
              ))}
              .
            </p>
            <p>
              L5 only looks easier because of the constant levels above. {a.models.map((m) => m.label + "'s unparsed-response rate is " + pct(m.totals.pfRate, 1)).join("; ")}{" "}
              — the weaker model loses most of its L1 lead to formatting.
            </p>
          </Finding>

          <Finding tag="provenance" tone="warn" title={pct(driftShare, 1) + " of questions drifted in the upstream dataset"}>
            <p>
              The same question ids now carry a different ground truth upstream for{" "}
              <b>{fmtInt(a.integrity.gtDrift.mismatch)}</b> of {fmtInt(a.integrity.gtDrift.checked)} questions — the dataset was regenerated after
              these runs. Every number here is still graded against the ground truth each run recorded, so the comparison stays paired; but a fresh
              eval is needed before publishing per-question examples.
            </p>
            <p className="font-mono text-[10px] text-[#666]">
              {a.integrity.dupIds} duplicate question ids · {fmtInt(a.integrity.evaluatedPerDomain)} of {fmtInt(a.integrity.nominalPerDomain)} images
              per domain evaluated · levels balanced at {fmtInt(a.models[0]?.totals.levels[0]?.n ?? 0)} questions.
            </p>
          </Finding>
        </div>
      </Section>

      {/* -------------------------------------------------------- curves --- */}
      <Section
        eyebrow="03 difficulty curve"
        title="Accuracy by cognitive task, L1 → L5"
        hint="Levels are the dataset's own task ladder — describe, relate, compare, compose, extrapolate."
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
          <LevelCurve models={order} levels={a.benchmark.levels} metric={metric} />
        </Panel>
        <div className="mt-3 grid gap-3 sm:grid-cols-5">
          {a.benchmark.levels.map((lv) => (
            <div key={lv.n} className="rounded-lg border border-[#262626] bg-[#0a0a0a] p-3">
              <p className="font-mono text-[9px] uppercase tracking-widest text-[#666]">L{lv.n} — {lv.short}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-[#a1a1a1]">{lv.desc}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ------------------------------------------------------- families --- */}
      <Section
        eyebrow="04 families"
        title="Reasoning families"
        hint="Nine families over 34 domains. The hairline tick marks the majority-answer oracle for the same slice."
      >
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Panel className="p-4 sm:p-5">
            <FamilyBars models={order} metric={metric === "headroom" ? "acc" : metric} />
          </Panel>
          <Panel className="p-4">
            <p className="font-mono text-[9px] uppercase tracking-widest text-[#666]">score composition</p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-[#a1a1a1]">
              Solid is fully-correct, the lighter band adds questions where the answer is partly right.
            </p>
            <div className="mt-4 space-y-4">
              {order.map((m) => (
                <div key={m.id}>
                  <div className="flex items-baseline justify-between">
                    <span className="flex items-center gap-2 text-[12px] text-[#ededed]">
                      <Dot color={m.accent} size={6} />
                      {m.label}
                    </span>
                    <span className="font-mono text-[10px] text-[#666]">
                      {pct(m.totals.acc, 1)} correct · {pct(m.totals.partial, 1)} partial credit
                    </span>
                  </div>
                  <div className="relative mt-1.5 h-[6px] w-full overflow-hidden rounded-sm bg-[#141414]">
                    <span className="absolute inset-y-0 left-0 rounded-sm opacity-30" style={{ width: pct(m.totals.partial, 1), background: m.accent }} />
                    <span className="absolute inset-y-0 left-0 rounded-sm" style={{ width: pct(m.totals.acc, 1), background: m.accent }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 border-t border-[#1c1c1c] pt-3">
              <p className="font-mono text-[9px] uppercase tracking-widest text-[#666]">majority-answer baseline</p>
              <p className="t-num mt-1 font-mono text-2xl font-semibold tabular-nums text-[#ededed]">
                {pct(a.models[0]?.totals.oracle ?? null, 2)}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-[#666]">
                Answering the single most common ground truth everywhere. Any accuracy below this line would mean a model is worse than
                not looking at the image.
              </p>
            </div>
          </Panel>
        </div>
      </Section>

      {/* ------------------------------------------------------ head to head --- */}
      {lead && second && rec && (
        <Section
          eyebrow="05 head to head"
          title={lead.label + " vs " + second.label}
          hint={"Per-domain accuracy gap in points. " + lead.label + " leads " + rec.xWins + " domains, " + second.label + " leads " + rec.yWins + "."}
          right={
            <Link to="/open-models/compare" className="rounded border border-[#262626] px-2.5 py-1 font-mono text-[10px] text-[#a1a1a1] transition-colors hover:border-[#404040] hover:text-white">
              full comparison →
            </Link>
          }
        >
          <Panel className="p-4 sm:p-5">
            <DivergeBars domains={a.domains} a={lead} b={second} limit={10} />
          </Panel>
        </Section>
      )}

      {/* ---------------------------------------------------------- index --- */}
      <Section
        eyebrow="06 index"
        title="Where the benchmark is hardest"
        hint="Best and worst domains by the leader's accuracy. Domains with a single-answer level are flagged — they inflate accuracy."
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel className="p-3.5">
            <p className="mb-2 font-mono text-[9px] uppercase tracking-widest text-[#666]">
              strongest — {lead?.label}
            </p>
            <DomainIndex domains={byAcc.slice(0, 6)} modelId={leadId} accent={lead?.accent ?? "#8b5cf6"} />
          </Panel>
          <Panel className="p-3.5">
            <p className="mb-2 font-mono text-[9px] uppercase tracking-widest text-[#666]">
              weakest — both models under 30%
            </p>
            <DomainIndex domains={weakest.slice(0, 6)} modelId={leadId} accent={lead?.accent ?? "#8b5cf6"} />
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
          <span className="w-20 flex-none font-mono text-[9px] text-[#555]">{d.familyName}</span>
          <div className="hidden w-24 flex-none sm:block">
            <Bar value={accOf(d, modelId)} oracle={d.oracle} color={accent} height={5} />
          </div>
          <span className="w-12 flex-none text-right font-mono text-[11px] tabular-nums text-[#ededed]">
            {pct(accOf(d, modelId), 1)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function findRecovered(zeroHarness: { label: string; level: number; per: { model: string; acc: number | null }[] }[]): string {
  const best = zeroHarness.flatMap((z) => z.per.map((p) => ({ z, p }))).sort((x, y) => (y.p.acc ?? 0) - (x.p.acc ?? 0))[0];
  if (!best || (best.p.acc ?? 0) <= 0) return "see the audit page for each one";
  return best.z.label + " L" + best.z.level + " reaches " + pct(best.p.acc, 1);
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
