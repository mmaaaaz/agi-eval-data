import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useOM } from "./open-models";
import { AccValue, Dot, Legend, Panel, Section, Tile, TileGrid } from "../components/open-models/ui";
import { LevelTable } from "../components/open-models/charts";
import { fmtInt, pct, ranked, signed } from "../lib/openModelsFmt";
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

  const order = ranked(a.models);
  const siblings = a.domains.filter((x) => x.family === d.family && x.key !== d.key);
  const constLevels = new Set(d.const.map((c) => c.level));
  const constN = d.per[0]?.levels[(d.const[0]?.level ?? 1) - 1]?.n ?? 0;
  const examplesByDomain = a.models.map((m) => ({
    m,
    classes: m.classes
      .map((c) => ({ name: c.name, n: c.n, ex: (m.examples[c.name] ?? []).filter((e) => e.domain === d.key) }))
      .filter((c) => c.ex.length > 0),
  }));

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
            majority answer <span className="text-[#ededed]">“{d.oracleTop}”</span> scores {pct(d.oracle, 1)} blind.
          </>
        }
      >
        <TileGrid cols={4}>
          {order.map((m) => {
            const r = d.per.find((p) => p.model === m.id);
            return (
              <Tile
                key={m.id}
                label={m.label}
                value={<AccValue value={r?.acc ?? null} ci={r?.ci} color={m.accent} size="md" width={54} />}
                accent={m.accent}
                sub={"self-score " + pct(r?.as ?? null, 1) + " · partial " + pct(r?.partial ?? null, 1)}
              />
            );
          })}
          <Tile
            label="headroom vs oracle"
            value={order.map((m) => signed((d.per.find((p) => p.model === m.id)?.acc ?? 0) - (d.oracle ?? 0), 1)).join(" / ")}
            sub="accuracy − majority-answer baseline"
          />
        </TileGrid>
      </Section>

      <Section eyebrow="01 levels" title="Difficulty ladder" hint="Bars are frozen-rule accuracy; the tick inside each track is that level's majority-answer oracle."
        right={
          <Legend items={[...order.map((m) => ({ color: m.accent, label: m.label })), { color: "#666", label: "oracle", dash: true }]} />
        }
      >
        <Panel>
          <LevelTable
            levels={a.benchmark.levels}
            series={order.map((m) => ({
              label: m.label,
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
        </Panel>
        {d.const.length > 0 && (
          <p className="mt-2 rounded border border-[#3a2626] bg-[#150f0f] px-3 py-2 font-mono text-[10px] leading-relaxed text-[#f0a5a5]">
            ◆ single-answer {d.const.map((c) => "L" + c.level + ' is always "' + c.top + '"').join(" · ")} for all{" "}
            {fmtInt(constN)} images — guessing scores 100% on {d.const.length > 1 ? "those levels" : "that level"}.
          </p>
        )}
      </Section>

      <Section
        eyebrow="02 question format"
        title="What the model is actually asked"
        hint="Templates and one real question per level, taken from the upstream dataset bank. The bank has since been regenerated, so the example's answer need not match the graded draw."
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
        eyebrow="03 grading detail"
        title="Where the frozen rule and the runs' scorer part ways here"
        hint="Disagreements sampled from this domain; the audit page carries the full taxonomy."
      >
        <div className="grid gap-3 lg:grid-cols-2">
          {examplesByDomain.map(({ m, classes }) =>
            classes.length === 0 ? (
              <Panel key={m.id} className="p-3.5">
                <div className="flex items-center gap-2">
                  <Dot color={m.accent} size={6} />
                  <span className="text-[13px] text-[#ededed]">{m.label}</span>
                </div>
                <p className="mt-2 font-mono text-[10px] text-[#666]">No sampled disagreements on this domain.</p>
              </Panel>
            ) : (
              <Panel key={m.id} className="p-3.5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[13px] text-[#ededed]">
                    <Dot color={m.accent} size={6} />
                    {m.label}
                  </span>
                  <span className="font-mono text-[9px] text-[#555]">
                    {fmtInt(d.per.find((p) => p.model === m.id)?.over ?? 0)} over-credit ·{" "}
                    {fmtInt(d.per.find((p) => p.model === m.id)?.under ?? 0)} under-credit
                  </span>
                </div>
                <ul className="mt-3 space-y-3">
                  {classes.map((c) => (
                    <li key={c.name}>
                      <p className="font-mono text-[10px]" style={{ color: m.accent }}>
                        {c.name}
                      </p>
                      {c.ex.map((e, i) => (
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
              </Panel>
            ),
          )}
        </div>
      </Section>

      {siblings.length > 0 && (
        <Section eyebrow="04 neighbours" title={"More in " + (d.familyName ?? "")}>
          <div className="flex flex-wrap gap-2">
            {siblings.map((s) => (
              <Link key={s.key} to="/open-models/domains/$slug" params={{ slug: s.key }} className="rounded-full border border-[#262626] px-3 py-1.5 font-mono text-[10px] text-[#a1a1a1] transition-colors hover:border-[#404040] hover:text-white">
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
