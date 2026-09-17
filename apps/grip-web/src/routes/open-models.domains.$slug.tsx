import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useOM } from "./open-models";
import { AccValue, Dot, Legend, Panel, Section, Tile, TileGrid } from "../components/open-models/ui";
import { LevelTable, shortName } from "../components/open-models/charts";
import { fmtInt, pct, ranked } from "../lib/openModelsFmt";
import type { Domain } from "../lib/openModelsTypes";

export const Route = createFileRoute("/open-models/domains/$slug")({
  component: DomainPage,
  notFoundComponent: () => <p className="font-mono text-sm text-[#a1a1a1]">No such domain.</p>,
});

export function DomainPage() {
  const a = useOM();
  const { slug } = Route.useParams();
  const d = a.domains.find((x) => x.key === slug);
  if (!d) throw notFound();

  const order = ranked(a.models).sort((x, y) => (d.per.find((p) => p.model === y.id)?.acc ?? 0) - (d.per.find((p) => p.model === x.id)?.acc ?? 0));
  const siblings = a.domains.filter((x) => x.family === d.family && x.key !== d.key);
  const constLevels = new Set(d.const.map((c) => c.level));
  const constN = d.per[0]?.levels[(d.const[0]?.level ?? 1) - 1]?.n ?? 0;
  const graded = order.filter((m) => d.per.find((p) => p.model === m.id));
  const noisy = [...graded].sort(
    (x, y) =>
      (d.per.find((p) => p.model === y.id)?.over ?? 0) + (d.per.find((p) => p.model === y.id)?.under ?? 0) -
      ((d.per.find((p) => p.model === x.id)?.over ?? 0) + (d.per.find((p) => p.model === x.id)?.under ?? 0)),
  );
  const fieldBest = Math.max(...d.per.map((p) => p.acc ?? 0));

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[#666]">
        <Link to="/open-models/domains" className="transition-colors hover:text-white">
          domains
        </Link>
        <span className="text-[#333]">/</span>
        <span className="text-[#a1a1a1]">{d.familyName}</span>
      </div>

      <Section
        title={d.label}
        hint={
          <>
            {fmtInt(d.n)} questions · {fmtInt(d.per[0]?.images ?? 0)} images · {fmtInt(d.distinctAnswers ?? 0)} distinct ground truths ·
            majority answer <span className="text-[#ededed]">“{d.oracleTop}”</span> scores {pct(d.oracle, 1)} on its own · best run{" "}
            <span className="text-[#ededed]">{pct(fieldBest, 2)}</span>
          </>
        }
      >
        <TileGrid cols={3}>
          {graded.map((m) => {
            const r = d.per.find((p) => p.model === m.id)!;
            return (
              <Tile
                key={m.id}
                label={m.label}
                value={<AccValue value={r.acc} ci={r.ci} color={m.accent} size="md" width={54} />}
                accent={m.accent}
                sub={"own score " + pct(r.as, 1) + " · partial " + pct(r.partial, 1) + " · " + pct((r.acc ?? 0) - (d.oracle ?? 0), 1) + " over baseline"}
              />
            );
          })}
        </TileGrid>
      </Section>

      <Section
        eyebrow="01 levels"
        title="Difficulty ladder"
        hint="Frozen-rule accuracy per level. The baseline tick is drawn once, in the first track — every run is measured against the same floor."
        right={<Legend items={[...graded.map((m) => ({ color: m.accent, label: shortName(m) })), { color: "#666", label: "baseline", dash: true }]} />}
      >
        <Panel>
          <div className="max-h-[70vh] overflow-auto">
            <LevelTable
              levels={a.benchmark.levels}
              series={graded.map((m) => ({
                id: m.id,
                label: shortName(m) + " · " + m.label,
                accent: m.accent,
                cells: (d.per.find((p) => p.model === m.id)?.levels ?? []).map((l) => ({
                  acc: l.acc,
                  partial: l.partial,
                  n: l.n,
                  pf: l.pf,
                  oracle: l.oracle,
                })),
              }))}
            />
          </div>
        </Panel>
        {d.const.length > 0 && (
          <p className="mt-2 rounded border border-[#3a2626] bg-[#150f0f] px-3 py-2 font-mono text-[10px] leading-relaxed text-[#f0a5a5]">
            ◆ single-answer {d.const.map((c) => "L" + c.level + ' is always "' + c.top + '"').join(" · ")} for all {fmtInt(constN)} images —
            guessing scores 100% on {d.const.length > 1 ? "those levels" : "that level"}.
          </p>
        )}
      </Section>

      <Section
        eyebrow="02 question format"
        title="What the models are actually asked"
        hint="Templates and one real question per level, taken from the upstream dataset bank. The bank has since been regenerated, so an example's answer need not match the graded draw."
      >
        <div className="grid gap-3 lg:grid-cols-5">
          {a.benchmark.levels.map((lv) => {
            const f = d.formats[String(lv.n)];
            return (
              <Panel key={lv.n} className="flex flex-col p-3.5">
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-[10px] text-white">L{lv.n}</span>
                  {constLevels.has(lv.n) && <span className="font-mono text-[9px] text-[#f0a5a5]">◆ single answer</span>}
                </div>
                <p className="mt-1 font-mono text-[9px] uppercase tracking-widest text-[#666]">{lv.task}</p>
                {f ? (
                  <>
                    <p className="mt-3 text-[12.5px] leading-relaxed text-[#ededed]">{f.template}</p>
                    {f.example && (
                      <p className="mt-2.5 border-t border-[#1c1c1c] pt-2.5 text-[11.5px] leading-relaxed text-[#a1a1a1]">
                        <span className="font-mono text-[9px] uppercase tracking-widest text-[#555]">example</span>
                        <br />
                        {f.example}
                      </p>
                    )}
                    <p className="mt-auto pt-3 font-mono text-[9px] text-[#555]">
                      {f.answerFormat ? "format: " + f.answerFormat + " · " : ""}
                      {f.templates} prompt variant{f.templates === 1 ? "" : "s"} in the bank
                    </p>
                  </>
                ) : (
                  <p className="mt-3 font-mono text-[10px] text-[#666]">not in the upstream question bank</p>
                )}
              </Panel>
            );
          })}
        </div>
      </Section>

      <Section
        eyebrow="03 grading"
        title="Where each run's own scorer parted ways here"
        hint="Aggregate counts for this domain, then sampled questions from the two runs with the most disagreements."
      >
        <Panel className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className="font-mono text-[9px] uppercase tracking-widest text-[#666]">
                  <th className="px-3 py-2 font-normal">run</th>
                  <th className="px-3 py-2 text-right font-normal">accuracy</th>
                  <th className="px-3 py-2 text-right font-normal">own score</th>
                  <th className="px-3 py-2 text-right font-normal">credits what the rule rejects</th>
                  <th className="px-3 py-2 text-right font-normal">rejects what the rule accepts</th>
                  <th className="px-3 py-2 text-right font-normal">unparsed</th>
                  <th className="px-3 py-2 font-normal">classes</th>
                </tr>
              </thead>
              <tbody>
                {graded.map((m) => {
                  const r = d.per.find((p) => p.model === m.id)!;
                  const ex = m.classes.filter((c) => (m.examples[c.name] ?? []).some((e) => e.domain === d.key));
                  return (
                    <tr key={m.id} className="border-t border-[#141414]">
                      <th scope="row" className="px-3 py-2 text-left font-normal">
                        <Link to="/open-models/models/$id" params={{ id: m.id }} className="inline-flex items-center gap-2 text-[12.5px] text-[#ededed] hover:text-accent">
                          <Dot color={m.accent} size={6} />
                          {m.label}
                        </Link>
                      </th>
                      <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums" style={{ color: m.accent }}>
                        {pct(r.acc, 1)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-[#a1a1a1]">{pct(r.as, 1)}</td>
                      <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-[#a1a1a1]">{fmtInt(r.over)}</td>
                      <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-[#a1a1a1]">{fmtInt(r.under)}</td>
                      <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-[#a1a1a1]">{pct(r.pfRate, 2)}</td>
                      <td className="px-3 py-2 font-mono text-[9.5px] text-[#555]">
                        {ex.map((c) => c.name).join(" · ") || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {noisy.slice(0, 2).map((m) => {
            const r = d.per.find((p) => p.model === m.id)!;
            const classes = m.classes.filter((c) => (m.examples[c.name] ?? []).some((e) => e.domain === d.key));
            return (
              <Panel key={m.id} className="p-4">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[13px] text-[#ededed]">
                    <Dot color={m.accent} size={6} />
                    {m.label}
                  </span>
                  <span className="font-mono text-[9px] text-[#555]">
                    {fmtInt(r.over)} over · {fmtInt(r.under)} under
                  </span>
                </div>
                {classes.length === 0 ? (
                  <p className="mt-2 font-mono text-[10px] text-[#666]">No sampled disagreements on this domain.</p>
                ) : (
                  <ul className="mt-3 space-y-3">
                    {classes.map((c) => (
                      <li key={c.name}>
                        <p className="font-mono text-[10px]" style={{ color: m.accent }}>
                          {c.name}
                        </p>
                        {(m.examples[c.name] ?? [])
                          .filter((e) => e.domain === d.key)
                          .map((e, i) => (
                            <p key={i} className="mt-1 grid grid-cols-[26px_1fr] gap-x-2 font-mono text-[10.5px] leading-relaxed">
                              <span className="text-[#555]">L{e.level}</span>
                              <span>
                                <span className="text-[#666]">truth</span> <span className="text-[#ededed]">{e.gt}</span>
                                <br />
                                <span className="text-[#666]">answer</span> <span className="text-[#a1a1a1]">{e.pred}</span>
                              </span>
                            </p>
                          ))}
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            );
          })}
        </div>
      </Section>

      {siblings.length > 0 && (
        <Section eyebrow="04 neighbours" title={"More in " + (d.familyName ?? "")}>
          <div className="flex flex-wrap gap-2">
            {siblings.map((s) => (
              <Link
                key={s.key}
                to="/open-models/domains/$slug"
                params={{ slug: s.key }}
                className="rounded-full border border-[#262626] px-3 py-1.5 font-mono text-[10px] text-[#a1a1a1] transition-colors hover:border-[#404040] hover:text-white"
              >
                {s.label} · {pct(bestOf(s), 1)}
              </Link>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function bestOf(d: Domain): number | null {
  const vals = d.per.map((p) => p.acc).filter((x): x is number => x != null);
  return vals.length ? Math.max(...vals) : null;
}
