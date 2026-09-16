import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useOM } from "./open-models";
import { Bar, Dot, Legend, Panel, Section, Tile, TileGrid } from "../components/open-models/ui";
import { FamilyBars, LevelTable } from "../components/open-models/charts";
import { accOf, fmtInt, pct, ranked, signed } from "../lib/openModelsFmt";

export const Route = createFileRoute("/open-models/models/$id")({
  component: ModelPage,
  notFoundComponent: () => <p className="font-mono text-sm text-[#a1a1a1]">No such model run.</p>,
});

export function ModelPage() {
  const a = useOM();
  const { id } = Route.useParams();
  const m = a.models.find((x) => x.id === id);
  if (!m) throw notFound();
  const order = ranked(a.models);
  const rank = order.findIndex((x) => x.id === m.id) + 1;

  const byAcc = [...a.domains].sort((x, y) => (accOf(y, m.id) ?? 0) - (accOf(x, m.id) ?? 0));
  const meta = m.meta;
  const metaRows = [
    { k: "organisation", v: meta.org },
    { k: "parameters", v: meta.params },
    { k: "active parameters", v: meta.activeParams },
    { k: "context", v: meta.context },
    { k: "license", v: meta.license },
    { k: "released", v: meta.released },
  ].filter((r) => r.v);

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[#666]">
        <Link to="/open-models" className="transition-colors hover:text-white">
          open models
        </Link>
        <span className="text-[#333]">/</span>
        <span className="text-[#a1a1a1]">{m.label}</span>
      </div>

      <Section
        title={m.label}
        hint={
          <>
            Rank {rank} of {a.models.length} on this benchmark · {fmtInt(m.totals.n)} questions · {fmtInt(m.totals.images)} images ·{" "}
            {pct(m.totals.acc, 2)} under the frozen rule against {pct(m.totals.as, 2)} from the run's own scorer.
          </>
        }
        right={
          <div className="flex flex-wrap items-center gap-2">
            {meta.links?.huggingface && (
              <a
                href={meta.links.huggingface}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded border border-[#262626] px-2.5 py-1 font-mono text-[10px] text-[#a1a1a1] transition-colors hover:border-[#404040] hover:text-white"
              >
                weights ↗
              </a>
            )}
            {meta.links?.paper && (
              <a
                href={meta.links.paper}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded border border-[#262626] px-2.5 py-1 font-mono text-[10px] text-[#a1a1a1] transition-colors hover:border-[#404040] hover:text-white"
              >
                paper ↗
              </a>
            )}
            <Link
              to="/open-models/compare"
              className="rounded border border-[#262626] px-2.5 py-1 font-mono text-[10px] text-[#a1a1a1] transition-colors hover:border-[#404040] hover:text-white"
            >
              compare →
            </Link>
          </div>
        }
      >
        <TileGrid cols={6}>
          <Tile label="accuracy" value={pct(m.totals.acc, 2)} accent={m.accent} sub={"CI " + pct(m.totals.ci[0], 1) + " – " + pct(m.totals.ci[1], 1)} />
          <Tile label="self-scored" value={pct(m.totals.as, 2)} sub={"agreement " + pct(m.totals.agreement, 2)} />
          <Tile label="partial credit" value={pct(m.totals.partial, 2)} sub="mean share of parts matched" />
          <Tile label="oracle / headroom" value={signed(m.totals.headroom, 1)} sub={"blind baseline " + pct(m.totals.oracle, 1)} />
          <Tile
            label="parse failures"
            value={pct(m.totals.pfRate, 2)}
            accent={(m.totals.pfRate ?? 0) > 0.05 ? "#f0a5a5" : undefined}
            sub={fmtInt(m.totals.pf) + " of " + fmtInt(m.totals.n)}
          />
          <Tile label="grader disagreements" value={fmtInt(m.totals.over + m.totals.under)} sub={fmtInt(m.totals.over) + " over · " + fmtInt(m.totals.under) + " under"} />
        </TileGrid>

        {metaRows.length === 0 && (
          <p className="mt-2 font-mono text-[10px] leading-relaxed text-[#666]">
            Model card fields (organisation, parameters, licence) are unset for this run — add them to{" "}
            <code className="text-[#a1a1a1]">data/open-models/models.meta.json</code> and re-bake to show them here.
          </p>
        )}
      </Section>

      <Section eyebrow="01 levels" title="Accuracy by cognitive task">
        <Panel>
          <LevelTable
            levels={a.benchmark.levels}
            series={order.map((x) => ({
              label: x.id === m.id ? x.label + " (this run)" : x.label,
              accent: x.accent,
              cells: x.totals.levels.map((l) => ({ acc: l.acc, partial: l.partial, n: l.n, pf: l.pf, oracle: l.oracle ?? null })),
            }))}
          />
        </Panel>
      </Section>

      <Section eyebrow="02 families" title="Reasoning families">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Panel className="p-4">
            <FamilyBars models={order} metric="acc" />
          </Panel>
          <Panel className="p-4">
            <p className="font-mono text-[9px] uppercase tracking-widest text-[#666]">model card</p>
            <dl className="mt-3 space-y-2">
              {metaRows.map((r) => (
                <div key={r.k} className="flex items-baseline justify-between gap-3 border-b border-[#141414] pb-1.5">
                  <dt className="font-mono text-[10px] uppercase tracking-wider text-[#666]">{r.k}</dt>
                  <dd className="text-right font-mono text-[11px] text-[#ededed]">{r.v}</dd>
                </div>
              ))}
              <div className="flex items-baseline justify-between gap-3 border-b border-[#141414] pb-1.5">
                <dt className="font-mono text-[10px] uppercase tracking-wider text-[#666]">run id</dt>
                <dd className="text-right font-mono text-[11px] text-[#ededed]">{m.id}</dd>
              </div>
            </dl>
            {meta.notes && <p className="mt-3 text-[12px] leading-relaxed text-[#a1a1a1]">{meta.notes}</p>}
          </Panel>
        </div>
      </Section>

      <Section eyebrow="03 strengths" title="Best and worst domains" hint={"Ranked by " + m.label + "'s frozen-rule accuracy."}>
        <div className="grid gap-3 lg:grid-cols-2">
          {[byAcc.slice(0, 7), byAcc.slice(-7).reverse()].map((list, li) => (
            <Panel key={li} className="p-3.5">
              <p className="mb-2 font-mono text-[9px] uppercase tracking-widest text-[#666]">
                {li === 0 ? "strongest" : "weakest"}
              </p>
              <ul className="divide-y divide-[#141414]">
                {list.map((d) => (
                  <li key={d.key} className="flex items-center gap-3 py-2">
                    <Link to="/open-models/domains/$slug" params={{ slug: d.key }} className="min-w-0 flex-1 truncate text-[12.5px] text-[#ededed] hover:text-accent">
                      {d.label}
                    </Link>
                    {d.const.length > 0 && <span className="font-mono text-[9px] text-[#f0a5a5]">◆</span>}
                    <span className="w-24 flex-none">
                      <Bar value={accOf(d, m.id)} oracle={d.oracle} color={m.accent} height={5} />
                    </span>
                    <span className="w-12 flex-none text-right font-mono text-[11px] tabular-nums" style={{ color: m.accent }}>
                      {pct(accOf(d, m.id), 1)}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      </Section>

      <Section
        eyebrow="04 grading"
        title="Where this run's own scorer disagreed"
        hint="Sampled questions behind the counters above; the audit page has the full taxonomy."
      >
        <Panel className="p-4">
          <Legend items={[{ color: m.accent, label: m.label + " — disagreements" }]} />
          <ul className="mt-3 space-y-3">
            {m.classes.map((c) => (
              <li key={c.name}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-[10.5px]" style={{ color: m.accent }}>
                    {c.name}
                  </span>
                  <span className="font-mono text-[10px] tabular-nums text-[#a1a1a1]">{fmtInt(c.n)}</span>
                </div>
                {(m.examples[c.name] ?? []).map((e, i) => (
                  <p key={i} className="mt-1.5 grid grid-cols-[120px_1fr] gap-x-3 font-mono text-[10.5px] leading-relaxed">
                    <span className="text-[#555]">{e.domain} · L{e.level}</span>
                    <span>
                      <span className="text-[#666]">truth</span> <span className="text-[#ededed]">{e.gt}</span>{" "}
                      <span className="text-[#666]">· answer</span> <span className="text-[#a1a1a1]">{e.pred}</span>
                    </span>
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </Panel>
      </Section>

      <Section eyebrow="05 peers" title="Other runs on this benchmark">
        <div className="flex flex-wrap gap-2">
          {order
            .filter((x) => x.id !== m.id)
            .map((x) => (
              <Link
                key={x.id}
                to="/open-models/models/$id"
                params={{ id: x.id }}
                className="inline-flex items-center gap-2 rounded-full border border-[#262626] px-3 py-1.5 font-mono text-[10px] text-[#a1a1a1] transition-colors hover:border-[#404040] hover:text-white"
              >
                <Dot color={x.accent} size={6} />
                {x.label} · {pct(x.totals.acc, 2)}
              </Link>
            ))}
        </div>
      </Section>
    </div>
  );
}
