import { createFileRoute, Link } from "@tanstack/react-router";
import { useOM } from "./open-models";
import { Dot, Panel, Section, Tile, TileGrid } from "../components/open-models/ui";
import { shortName } from "../components/open-models/charts";
import { fmtInt, pct, ranked, signed } from "../lib/openModelsFmt";

export const Route = createFileRoute("/open-models/audit")({ component: Audit });

export function Audit() {
  const a = useOM();
  const order = ranked(a.models);
  const drift = a.integrity.gtDrift;
  const pair = a.integrity.gtPairing;
  const paired = pair.mismatch === 0 && pair.missing === 0;

  const driftRows = Object.entries(drift.byDomain)
    .map(([k, v]) => ({ key: k, label: a.domains.find((d) => d.key === k)?.label ?? k, ...v }))
    .sort((x, y) => y.mismatch - x.mismatch);

  // every class name any run produced, ordered by how much it happens overall
  const classNames = [...new Set(a.models.flatMap((m) => m.classes.map((c) => c.name)))].sort((x, y) => {
    const tot = (n: string) => a.models.reduce((s, m) => s + (m.classes.find((c) => c.name === n)?.n ?? 0), 0);
    return tot(y) - tot(x);
  });
  const classTotal = (n: string) => a.models.reduce((s, m) => s + (m.classes.find((c) => c.name === n)?.n ?? 0), 0);
  const bandNames = ["<=2%", "<=5%", "<=10%", ">10%"];
  const zeroRecovered = a.audit.zeroHarness.filter((z) => z.per.some((p) => (p.acc ?? 0) > 0)).length;

  return (
    <div>
      <Section
        eyebrow="01 graders"
        title="Two scorers, one of which is published"
        hint="Every answer is scored twice: by the run's own harness and by the frozen rule below. Every page of this report uses the frozen rule; each harness is kept as a quality check."
      >
        <Panel className="p-4">
          <ol className="grid gap-x-8 gap-y-2.5 lg:grid-cols-2">
            {a.benchmark.grader.rules.map((r, i) => (
              <li key={i} className="flex gap-3 text-[12.5px] leading-relaxed text-[#a1a1a1]">
                <span className="font-mono text-[10px] text-accent">{String(i + 1).padStart(2, "0")}</span>
                <span>{r}</span>
              </li>
            ))}
          </ol>
        </Panel>
        <div className="mt-3">
          <Panel className="p-4">
            <table className="w-full text-left">
              <thead>
                <tr className="font-mono text-[9px] uppercase tracking-widest text-[#666]">
                  <th className="py-1.5 pr-3 font-normal">run</th>
                  <th className="px-2 py-1.5 text-right font-normal">agreement</th>
                  <th className="px-2 py-1.5 text-right font-normal" title="the run's own scorer accepted, our rule rejects">credited wrongly</th>
                  <th className="px-2 py-1.5 text-right font-normal" title="the run's own scorer rejected, our rule accepts">rejected wrongly</th>
                  <th className="px-2 py-1.5 text-right font-normal">own scorer → accuracy</th>
                  <th className="px-2 py-1.5 font-normal">disagreement volume</th>
                </tr>
              </thead>
              <tbody>
                {order.map((m) => {
                  const total = m.totals.over + m.totals.under;
                  const max = Math.max(...a.models.map((x) => x.totals.over + x.totals.under));
                  return (
                    <tr key={m.id} className="border-t border-[#141414]">
                      <th scope="row" className="py-2 pr-3 text-left font-normal">
                        <Link to="/open-models/models/$id" params={{ id: m.id }} className="inline-flex items-center gap-2 text-[12.5px] text-[#ededed] hover:text-accent">
                          <Dot color={m.accent} size={6} />
                          {m.label}
                        </Link>
                      </th>
                      <td className="px-2 py-2 text-right font-mono text-[11px] tabular-nums text-[#ededed]">{pct(m.totals.agreement, 2)}</td>
                      <td className="px-2 py-2 text-right font-mono text-[11px] tabular-nums text-[#a1a1a1]">{fmtInt(m.totals.over)}</td>
                      <td className="px-2 py-2 text-right font-mono text-[11px] tabular-nums text-[#a1a1a1]">{fmtInt(m.totals.under)}</td>
                      <td className="px-2 py-2 text-right font-mono text-[11px] tabular-nums text-[#a1a1a1]">
                        {pct(m.totals.as, 1)} → {pct(m.totals.acc, 1)}
                      </td>
                      <td className="px-2 py-2">
                        <div className="h-[6px] w-full rounded-sm bg-[#141414]">
                          <div className="h-full rounded-sm" style={{ width: (total / max) * 100 + "%", background: m.accent }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
        </div>
      </Section>

      <Section
        eyebrow="02 classes"
        title="Every disagreement, classified"
        hint="Each question where the two scorers disagree is categorised straight from the data. “Credited wrongly” means the run's own scorer accepted an answer the published rule rejects; “rejected wrongly” is the reverse."
      >
        <Panel className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left">
              <thead>
                <tr className="font-mono text-[9px] uppercase tracking-widest text-[#666]">
                  <th className="px-3 py-2 font-normal">class</th>
                  {order.map((m) => (
                    <th key={m.id} className="px-3 py-2 text-right font-normal">
                      <span style={{ color: m.accent }}>{shortName(m)}</span>
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-normal">total</th>
                </tr>
              </thead>
              <tbody>
                {classNames.map((name) => (
                  <tr key={name} className="border-t border-[#141414]">
                    <th scope="row" className="px-3 py-2 text-left text-[12.5px] font-normal text-[#c9c9c9]">
                      {name}
                    </th>
                    {order.map((m) => {
                      const n = m.classes.find((c) => c.name === name)?.n ?? 0;
                      const share = n / Math.max(1, m.totals.over + m.totals.under);
                      return (
                        <td key={m.id} className="px-3 py-2 text-right font-mono text-[11px] tabular-nums">
                          <span style={{ color: n ? "#ededed" : "#3a3a3a" }}>{fmtInt(n)}</span>
                          {n > 0 && <span className="ml-1.5 text-[9px] text-[#555]">{(share * 100).toFixed(0)}%</span>}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-[#a1a1a1]">{fmtInt(classTotal(name))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {classNames.slice(0, 2).map((name) => {
            const sample = a.models.flatMap((m) => (m.examples[name] ?? []).slice(0, 2).map((e) => ({ m, e }))).slice(0, 4);
            if (!sample.length) return null;
            return (
              <Panel key={name} className="p-4">
                <p className="font-mono text-[10px]" style={{ color: sample[0].m.accent }}>
                  {name}
                </p>
                <ul className="mt-2 space-y-2">
                  {sample.map(({ m, e }, i) => (
                    <li key={i} className="font-mono text-[10.5px] leading-relaxed">
                      <span className="text-[#555]">
                        <span style={{ color: m.accent }}>{shortName(m)}</span> · {e.domain} L{e.level}
                      </span>
                      <br />
                      <span className="text-[#666]">truth</span> <span className="text-[#ededed]">{e.gt}</span>{" "}
                      <span className="text-[#666]">· answer</span> <span className="text-[#a1a1a1]">{e.pred}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            );
          })}
        </div>
        <Panel className="mt-3 p-4">
          <p className="font-mono text-[9px] uppercase tracking-widest text-[#666]">how far off were the accepted numbers?</p>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#a1a1a1]">
            “Near-miss number accepted” is a harness crediting a numeric answer outside the frozen 1% / 0.05 tolerance. Distance from the
            ground truth, per run:
          </p>
          <table className="mt-3 w-full text-left">
            <thead>
              <tr className="font-mono text-[9px] uppercase tracking-widest text-[#666]">
                <th className="py-1.5 pr-3 font-normal">distance</th>
                {order.map((m) => (
                  <th key={m.id} className="px-2 py-1.5 text-right font-normal">
                    <span style={{ color: m.accent }}>{shortName(m)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bandNames.map((b) => (
                <tr key={b} className="border-t border-[#141414]">
                  <th scope="row" className="py-1.5 pr-3 text-left font-mono text-[11px] font-normal text-[#a1a1a1]">
                    {b}
                  </th>
                  {order.map((m) => (
                    <td key={m.id} className="px-2 py-1.5 text-right font-mono text-[11px] tabular-nums text-[#ededed]">
                      {fmtInt(m.bands.find((x) => x.name === b)?.n ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </Section>

      <Section
        eyebrow="03 zeros"
        title={"Levels where every one of the " + a.models.length + " runs scored 0.0% on its own harness"}
        hint={"Each level is one of three things: structured ground truth the frozen rule can read, a multi-part answer where one part is present, or a slice nobody solves. " + zeroRecovered + " of " + a.audit.zeroHarness.length + " are recovered by the frozen rule."}
      >
        <Panel className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[940px] text-left">
              <thead>
                <tr className="font-mono text-[9px] uppercase tracking-widest text-[#666]">
                  <th className="px-3 py-2 font-normal">domain</th>
                  <th className="px-3 py-2 font-normal">level</th>
                  <th className="px-3 py-2 font-normal">why it read as zero</th>
                  {order.map((m) => (
                    <th key={m.id} className="px-3 py-2 text-right font-normal">
                      <span style={{ color: m.accent }}>{shortName(m)}</span>
                      <span className="block text-[8px] normal-case tracking-normal text-[#555]">frozen / partial</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {a.audit.zeroHarness.map((z) => (
                  <tr key={z.domain + z.level} className="border-t border-[#141414]">
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      <Link to="/open-models/domains/$slug" params={{ slug: z.domain }} className="text-[12.5px] text-[#ededed] hover:text-accent">
                        {z.label}
                      </Link>
                      <span className="mt-0.5 block font-mono text-[9px] text-[#555]">{z.familyName}</span>
                    </th>
                    <td className="px-3 py-2 font-mono text-[11px] text-white">
                      L{z.level} <span className="text-[9px] text-[#666]">{a.benchmark.levels[z.level - 1]?.short}</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px]" style={{ color: z.kind === "structured" ? "#9fd8b4" : "#a1a1a1" }}>
                      {z.category}
                    </td>
                    {order.map((m) => {
                      const p = z.per.find((x) => x.model === m.id);
                      return (
                        <td key={m.id} className="px-3 py-2 text-right font-mono text-[11px] tabular-nums">
                          <span style={{ color: (p?.acc ?? 0) > 0 ? m.accent : "#444" }}>{pct(p?.acc ?? 0, 1)}</span>
                          <span className="ml-1.5 text-[9px] text-[#555]">{pct(p?.partial ?? 0, 0)}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <Panel className="p-4">
            <p className="font-mono text-[9px] uppercase tracking-widest text-[#f0a5a5]">
              unsolved by every run under the frozen rule ({a.audit.zeroFrozen.length} cells)
            </p>
            <ul className="mt-3 space-y-2">
              {a.audit.zeroFrozen.map((z) => (
                <li key={z.domain + z.level} className="flex items-baseline justify-between gap-3 border-b border-[#141414] pb-1.5 last:border-0">
                  <Link to="/open-models/domains/$slug" params={{ slug: z.domain }} className="text-[12.5px] text-[#ededed] hover:text-accent">
                    {z.label} · L{z.level}
                  </Link>
                  <span className="font-mono text-[10px] text-[#666]">guessing {pct(z.oracle, 1)}</span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel className="p-4">
            <p className="font-mono text-[9px] uppercase tracking-widest text-[#f0a5a5]">
              single-answer levels ({a.audit.constantLevels.length}) — 100% by guessing
            </p>
            <table className="mt-3 w-full text-left">
              <thead>
                <tr className="font-mono text-[9px] uppercase tracking-widest text-[#666]">
                  <th className="py-1.5 pr-2 font-normal">level</th>
                  <th className="py-1.5 pr-2 font-normal">the only answer</th>
                  {order.map((m) => (
                    <th key={m.id} className="px-1.5 py-1.5 text-right font-normal">
                      <span style={{ color: m.accent }}>{shortName(m)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {a.audit.constantLevels.map((c) => (
                  <tr key={c.domain + c.level} className="border-t border-[#141414]">
                    <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                      <Link to="/open-models/domains/$slug" params={{ slug: c.domain }} className="text-[11.5px] text-[#ededed] hover:text-accent">
                        {c.label}
                      </Link>
                      <span className="ml-1.5 font-mono text-[9px] text-[#555]">L{c.level}</span>
                    </th>
                    <td className="py-1.5 pr-2 font-mono text-[11px] text-[#a1a1a1]">“{c.top}”</td>
                    {order.map((m) => {
                      const d = a.domains.find((x) => x.key === c.domain);
                      const l = d?.per.find((p) => p.model === m.id)?.levels[c.level - 1];
                      return (
                        <td key={m.id} className="px-1.5 py-1.5 text-right font-mono text-[10.5px] tabular-nums" style={{ color: m.accent }}>
                          {pct(l?.acc ?? null, 0)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
      </Section>

      <Section
        eyebrow="04 movement"
        title="Where the frozen rule moves a score most"
        hint="Mean difference per domain across the field (accuracy minus the run's own scorer). Negative means the harness was over-crediting."
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <MoverList title="Under-scored by the runs' own harnesses" rows={a.audit.underCredited} tone="#9fd8b4" />
          <MoverList title="Over-scored by the runs' own harnesses" rows={a.audit.overCredited} tone="#f0a5a5" />
        </div>
      </Section>

      <Section
        eyebrow="05 provenance"
        title="Ground truth, pairing and drift"
        hint="Same question ids, same levels, same ground truth across every run in this report — which is what makes the gaps model differences. Drift is measured against the current upstream dataset snapshot, which has since been regenerated."
      >
        <TileGrid cols={4}>
          <Tile
            label="paired across runs"
            value={paired ? "yes" : "no"}
            accent={paired ? "#9fd8b4" : "#f0a5a5"}
            sub={fmtInt(pair.checked) + " questions share one ground truth vs " + (pair.reference ?? "the reference run")}
          />
          <Tile label="drifted upstream" value={fmtInt(drift.mismatch)} sub={"of " + fmtInt(drift.checked) + " · " + pct(drift.mismatch / Math.max(1, drift.checked), 1)} />
          <Tile label="missing upstream" value={fmtInt(drift.missing)} sub="ids absent from the current snapshot" />
          <Tile label="duplicate ids / error records" value={fmtInt(a.integrity.dupIds) + " / 0"} sub="checked across every record" />
        </TileGrid>
        <Panel className="mt-3 p-4">
          <p className="font-mono text-[9px] uppercase tracking-widest text-[#666]">drift by domain</p>
          <div className="mt-3 space-y-[5px]">
            {driftRows.map((r) => (
              <div key={r.key} className="flex items-center gap-3">
                <Link to="/open-models/domains/$slug" params={{ slug: r.key }} className="w-40 flex-none truncate text-[11.5px] text-[#a1a1a1] hover:text-accent">
                  {r.label}
                </Link>
                <div className="h-[9px] flex-1 rounded-sm bg-[#141414]">
                  <div className="h-full rounded-sm bg-[#8b5cf6]/70" style={{ width: (r.mismatch / Math.max(1, r.n)) * 100 + "%" }} />
                </div>
                <span className="w-24 flex-none text-right font-mono text-[10px] text-[#666]">
                  {fmtInt(r.mismatch)} / {fmtInt(r.n)}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </Section>
    </div>
  );
}

function MoverList({ title, rows, tone }: { title: string; rows: { domain: string; label: string; delta: number; per: number[] }[]; tone: string }) {
  const a = useOM();
  const order = ranked(a.models);
  const max = Math.max(0.001, ...rows.map((r) => Math.abs(r.delta)));
  return (
    <Panel className="p-4">
      <p className="font-mono text-[9px] uppercase tracking-widest" style={{ color: tone }}>
        {title}
      </p>
      <ul className="mt-3 space-y-2.5">
        {rows.map((r) => (
          <li key={r.domain}>
            <div className="grid grid-cols-[150px_1fr_56px] items-center gap-3">
              <Link to="/open-models/domains/$slug" params={{ slug: r.domain }} className="truncate text-[12px] text-[#ededed] hover:text-accent">
                {r.label}
              </Link>
              <div className="h-[9px] rounded-sm bg-[#141414]">
                <div className="h-full rounded-sm" style={{ width: (Math.abs(r.delta) / max) * 100 + "%", background: tone }} />
              </div>
              <span className="text-right font-mono text-[11px] tabular-nums" style={{ color: tone }}>
                {signed(r.delta, 1)}
              </span>
            </div>
            <p className="mt-0.5 font-mono text-[9px] text-[#555]">
              {order.map((m) => {
                const i = a.models.findIndex((x) => x.id === m.id);
                return shortName(m) + " " + signed(r.per[i] ?? 0, 1);
              }).join(" · ")}
            </p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
