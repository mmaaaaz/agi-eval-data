import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useOM } from "./open-models";
import { Bar, Dot, KeyValue, ModeBadge, Panel, RankPill, Section, Tile, TileGrid } from "../components/open-models/ui";
import { FamilyMatrix, LevelSlope, shortName } from "../components/open-models/charts";
import { accOf, fmtInt, pct, ranked, signed } from "../lib/openModelsFmt";

export const Route = createFileRoute("/open-models/models/$id")({
  component: ModelPage,
  notFoundComponent: () => <p className="font-mono text-sm text-[#a1a1a1]">No such run.</p>,
});

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

export function ModelPage() {
  const a = useOM();
  const { id } = Route.useParams();
  const m = a.models.find((x) => x.id === id);
  if (!m) throw notFound();
  const order = ranked(a.models);
  const rank = order.findIndex((x) => x.id === m.id) + 1;
  const lead = order[0];

  const byAcc = [...a.domains].sort((x, y) => (accOf(y, m.id) ?? 0) - (accOf(x, m.id) ?? 0));
  const wins = a.domains.filter((d) => {
    const best = Math.max(...d.per.map((p) => p.acc ?? 0));
    return Math.abs((accOf(d, m.id) ?? 0) - best) < 1e-12;
  }).length;

  const meta = m.meta;
  const metaRows = [
    { k: "organisation", v: meta.org },
    { k: "mode", v: meta.mode },
    { k: "parameters", v: meta.params },
    { k: "activated", v: meta.activeParams },
    { k: "licence", v: meta.license },
    { k: "released", v: meta.released },
    { k: "context", v: meta.context },
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
            Rank <span className="text-[#ededed]">{rank}</span> of {a.models.length} · wins{" "}
            <span className="text-[#ededed]">{wins}</span> of {a.domains.length} domains · {pct(m.totals.acc, 2)} under the frozen rule
            against {pct(m.totals.as, 2)} from its own scorer.
          </>
        }
        right={
          <div className="flex flex-wrap items-center gap-2">
            <ModeBadge mode={meta.mode} />
            {meta.links?.huggingface && (
              <a href={meta.links.huggingface} target="_blank" rel="noopener noreferrer" className="rounded border border-[#262626] px-2.5 py-1 font-mono text-[10px] text-[#a1a1a1] transition-colors hover:border-[#404040] hover:text-white">
                weights ↗
              </a>
            )}
            {meta.links?.paper && (
              <a href={meta.links.paper} target="_blank" rel="noopener noreferrer" className="rounded border border-[#262626] px-2.5 py-1 font-mono text-[10px] text-[#a1a1a1] transition-colors hover:border-[#404040] hover:text-white">
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
          <Tile label="own score" value={pct(m.totals.as, 2)} sub={"agreement " + pct(m.totals.agreement, 2)} />
          <Tile label="partial credit" value={pct(m.totals.partial, 2)} sub="mean share of parts matched" />
          <Tile label="vs baseline" value={signed(m.totals.headroom, 1)} sub={"majority answer " + pct(m.totals.oracle, 1)} />
          <Tile
            label="unparsed answers"
            value={pct(m.totals.pfRate, 2)}
            accent={(m.totals.pfRate ?? 0) > 0.1 ? "#f0a5a5" : undefined}
            sub={fmtInt(m.totals.pf) + " of " + fmtInt(m.totals.n)}
          />
          <Tile label="scorer disagreements" value={fmtInt(m.totals.over + m.totals.under)} sub={fmtInt(m.totals.over) + " over · " + fmtInt(m.totals.under) + " under"} />
        </TileGrid>
      </Section>

      <Section
        eyebrow="01 levels"
        title="Where it gains and loses on the L1-L5 ladder"
        hint={"Its own line is in full colour; the rest of the field stays visible for context. The dashed line is the majority-answer baseline for each level."}
      >
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Panel className="p-4">
            <LevelSlope models={order} levels={a.benchmark.levels} metric="acc" focus={m.id} />
          </Panel>
          <Panel className="p-0">
            <table className="w-full text-left">
              <thead>
                <tr className="font-mono text-[9px] uppercase tracking-widest text-[#666]">
                  <th className="px-3 py-2 font-normal">level</th>
                  <th className="px-3 py-2 text-right font-normal">this run</th>
                  <th className="px-3 py-2 text-right font-normal">baseline</th>
                  <th className="px-3 py-2 text-right font-normal">field best</th>
                  <th className="px-3 py-2 text-right font-normal">field median</th>
                </tr>
              </thead>
              <tbody>
                {a.benchmark.levels.map((lv, i) => {
                  const mine = m.totals.levels[i];
                  const others = a.models.map((x) => x.totals.levels[i]?.acc ?? 0);
                  const bestIdx = a.models.map((x) => x.totals.levels[i]?.acc ?? 0).indexOf(Math.max(...others));
                  const bestModel = a.models[bestIdx];
                  return (
                    <tr key={lv.n} className="border-t border-[#141414]">
                      <th scope="row" className="px-3 py-2 text-left font-normal">
                        <span className="font-mono text-[11px] text-white">L{lv.n}</span>
                        <span className="ml-1.5 font-mono text-[9px] text-[#666]">{lv.short}</span>
                      </th>
                      <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums" style={{ color: m.accent }}>
                        {pct(mine?.acc ?? null, 1)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-[#666]">{pct(mine?.oracle ?? null, 1)}</td>
                      <td className="px-3 py-2 text-right font-mono text-[10px] tabular-nums">
                        <span style={{ color: bestModel?.accent }}>{pct(Math.max(...others), 1)}</span>
                        <span className="ml-1.5 text-[9px] text-[#555]">{bestModel ? shortName(bestModel) : ""}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-[#a1a1a1]">{pct(median(others), 1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="border-t border-[#1c1c1c] px-3 py-2.5 text-[11.5px] leading-relaxed text-[#a1a1a1]">
              {(() => {
                const lv = m.totals.levels;
                const peak = lv.reduce((best, l, i) => ((l.acc ?? 0) > (lv[best].acc ?? 0) ? i : best), 0);
                const trough = lv.reduce((worst, l, i) => ((l.acc ?? 0) < (lv[worst].acc ?? 0) ? i : worst), 0);
                const delta = (lv[peak].acc ?? 0) - (lv[trough].acc ?? 0);
                return (
                  <>
                    Peaks at <b className="text-[#ededed]">L{peak + 1} ({a.benchmark.levels[peak].task})</b> and bottoms out at{" "}
                    <b className="text-[#ededed]">L{trough + 1} ({a.benchmark.levels[trough].task})</b> — a {signed(delta, 1)} spread across
                    the ladder.
                  </>
                );
              })()}
            </p>
          </Panel>
        </div>
      </Section>

      <Section eyebrow="02 families" title="Reasoning families" hint="Framed cells are the best run in that family; this run's column stays in full colour.">
        <Panel className="p-3 sm:p-4">
          <FamilyMatrix models={order} focus={m.id} />
        </Panel>
      </Section>

      <Section eyebrow="03 standing" title={"Against the field of " + a.models.length}>
        <div className="grid gap-3 lg:grid-cols-[320px_minmax(0,1fr)]">
          <Panel className="p-4">
            <div className="flex items-center gap-3">
              <RankPill rank={rank} accent={m.accent} />
              <span className="font-mono text-[11px] text-[#a1a1a1]">overall rank</span>
            </div>
            <dl className="mt-4 space-y-2">
              <KeyValue label="accuracy" value={pct(m.totals.acc, 2)} />
              <KeyValue label="vs leader" value={m.id === lead.id ? "—" : signed((m.totals.acc ?? 0) - (lead.totals.acc ?? 0), 2)} hint={lead.label} />
              <KeyValue label="vs field median" value={signed((m.totals.acc ?? 0) - median(a.models.map((x) => x.totals.acc ?? 0)), 2)} />
              <KeyValue label="domains won" value={wins + " of " + a.domains.length} />
              <KeyValue label="questions" value={fmtInt(m.totals.n)} />
              <KeyValue label="images" value={fmtInt(m.totals.images)} />
              {metaRows.map((r) => (
                <KeyValue key={r.k} label={r.k} value={r.v} />
              ))}
            </dl>
            {meta.notes && <p className="mt-3 border-t border-[#1c1c1c] pt-3 text-[12px] leading-relaxed text-[#a1a1a1]">{meta.notes}</p>}
            {!meta.notes && metaRows.length === 0 && (
              <p className="mt-3 border-t border-[#1c1c1c] pt-3 font-mono text-[10px] leading-relaxed text-[#666]">
                No card fields yet — add them to <code className="text-[#a1a1a1]">data/open-models/models.meta.json</code> and re-bake.
              </p>
            )}
          </Panel>
          <div className="grid gap-3 sm:grid-cols-2">
            {[byAcc.slice(0, 6), byAcc.slice(-6).reverse()].map((list, li) => (
              <Panel key={li} className="p-3.5">
                <p className="mb-2 font-mono text-[9px] uppercase tracking-widest text-[#666]">{li === 0 ? "strongest domains" : "weakest domains"}</p>
                <ul className="divide-y divide-[#141414]">
                  {list.map((d) => (
                    <li key={d.key} className="flex items-center gap-3 py-2">
                      <Link to="/open-models/domains/$slug" params={{ slug: d.key }} className="min-w-0 flex-1 truncate text-[12.5px] text-[#ededed] hover:text-accent">
                        {d.label}
                      </Link>
                      {d.const.length > 0 && <span className="font-mono text-[9px] text-[#f0a5a5]">◆</span>}
                      <span className="w-20 flex-none">
                        <Bar value={accOf(d, m.id)} oracle={d.oracle} color={m.accent} height={5} />
                      </span>
                      <span className="w-11 flex-none text-right font-mono text-[11px] tabular-nums" style={{ color: m.accent }}>
                        {pct(accOf(d, m.id), 1)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            ))}
          </div>
        </div>
      </Section>

      <Section
        eyebrow="04 grading"
        title="Where its own scorer disagreed"
        hint="Sampled questions behind the counters above; the audit page carries the full taxonomy for every run."
      >
        <Panel className="p-4">
          <ul className="space-y-3">
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
                    <span className="text-[#555]">
                      {e.domain} · L{e.level}
                    </span>
                    <span>
                      <span className="text-[#666]">truth</span> <span className="text-[#ededed]">{e.gt}</span>
                      <span className="text-[#666]"> · answer</span> <span className="text-[#a1a1a1]">{e.pred}</span>
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
