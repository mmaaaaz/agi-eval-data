import { createFileRoute, Link } from "@tanstack/react-router";
import { useOM } from "./open-models";
import { Dot, Panel, Section, Tile, TileGrid, Legend } from "../components/open-models/ui";
import { fmtInt, pct, ranked, signed } from "../lib/openModelsFmt";

export const Route = createFileRoute("/open-models/audit")({ component: Audit });

export function Audit() {
  const a = useOM();
  const order = ranked(a.models);
  const drift = a.integrity.gtDrift;
  const driftRows = Object.entries(drift.byDomain)
    .map(([k, v]) => ({ key: k, label: a.domains.find((d) => d.key === k)?.label ?? k, ...v }))
    .sort((x, y) => y.mismatch - x.mismatch);

  return (
    <div>
      <Section
        eyebrow="01 grader"
        title="Two scorers, one of which is published"
        hint="Every answer was scored twice: by the run's own harness, and by the frozen rule below. Everything on this site reports the frozen rule; the harness is kept as a quality check."
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
          <TileGrid cols={3}>
            {order.map((m) => (
              <Tile
                key={m.id}
                label={m.label + " — agreement"}
                value={pct(m.totals.agreement, 2)}
                accent={m.accent}
                sub={
                  "credits " + fmtInt(m.totals.over) + " answers the rule rejects · rejects " + fmtInt(m.totals.under) + " it accepts"
                }
              />
            ))}
            <Tile
              label="net effect on the headline"
              value={order.map((m) => pct(m.totals.as, 1) + " → " + pct(m.totals.acc, 1)).join("  ·  ")}
              sub="run's own score → frozen rule"
            />
          </TileGrid>
        </div>
      </Section>

      <Section
        eyebrow="02 classes"
        title="Every disagreement, classified"
        hint="Each question where the two scorers disagree is categorised straight from the data, with samples."
      >
        <div className="grid gap-3 lg:grid-cols-2">
          {order.map((m) => {
            const total = m.classes.reduce((s, c) => s + c.n, 0);
            return (
              <Panel key={m.id} className="p-4">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[13px] text-[#ededed]">
                    <Dot color={m.accent} size={6} />
                    {m.label}
                  </span>
                  <span className="font-mono text-[10px] text-[#666]">{fmtInt(total)} disagreements</span>
                </div>
                <table className="mt-3 w-full text-left">
                  <tbody>
                    {m.classes.map((c) => (
                      <tr key={c.name} className="border-t border-[#141414] align-top">
                        <th scope="row" className="w-[45%] py-2 pr-3 text-left text-[12px] font-normal text-[#a1a1a1]">
                          {c.name}
                        </th>
                        <td className="py-2 pr-3 text-right font-mono text-[11px] tabular-nums text-[#ededed]">{fmtInt(c.n)}</td>
                        <td className="py-2">
                          <div className="h-[5px] w-full rounded-sm bg-[#141414]">
                            <div className="h-full rounded-sm" style={{ width: pct(c.n / Math.max(1, total), 1), background: m.accent }} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-3 space-y-2 border-t border-[#1c1c1c] pt-3">
                  {m.classes.slice(0, 3).map((c) =>
                    (m.examples[c.name] ?? []).slice(0, 2).map((e, i) => (
                      <p key={c.name + i} className="font-mono text-[10.5px] leading-relaxed">
                        <span className="text-[#555]">{c.name.slice(0, 26)} · {e.domain} L{e.level}</span>
                        <br />
                        <span className="text-[#666]">truth</span> <span className="text-[#ededed]">{e.gt}</span>{" "}
                        <span className="text-[#666]">answer</span> <span className="text-[#a1a1a1]">{e.pred}</span>
                      </p>
                    )),
                  )}
                </div>
              </Panel>
            );
          })}
        </div>
        <Panel className="mt-3 p-4">
          <p className="font-mono text-[9px] uppercase tracking-widest text-[#666]">how far off were the accepted numbers?</p>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#a1a1a1]">
            “Near-miss number accepted” is the run's scorer crediting a numeric answer outside the frozen 1% / 0.05 tolerance. Distance from
            the ground truth:
          </p>
          <div className="mt-3 space-y-2">
            {a.models.map((m) => {
              const total = m.bands.reduce((s, b) => s + b.n, 0) || 1;
              return (
                <div key={m.id} className="flex items-center gap-3">
                  <span className="w-32 flex-none font-mono text-[10px]" style={{ color: m.accent }}>
                    {m.label}
                  </span>
                  <div className="flex h-[16px] flex-1 overflow-hidden rounded-sm bg-[#141414]">
                    {m.bands.map((b, i) => (
                      <span
                        key={b.name}
                        title={b.name + " · " + fmtInt(b.n)}
                        className="h-full border-r border-black last:border-0"
                        style={{ width: (b.n / total) * 100 + "%", background: m.accent, opacity: 1 - i * 0.2 }}
                      />
                    ))}
                  </div>
                  <span className="w-40 flex-none text-right font-mono text-[10px] text-[#666]">
                    {m.bands.map((b) => b.name + " " + fmtInt(b.n)).join(" · ")}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-3">
            <Legend items={a.models[0].bands.map((b, i) => ({ color: "rgba(139,92,246," + (1 - i * 0.2) + ")", label: b.name }))} />
          </div>
        </Panel>
      </Section>

      <Section
        eyebrow="03 zeros"
        title={a.audit.zeroHarness.length + " levels the run's scorer gave 0.0% to both models"}
        hint="Each one is either a grader failure the frozen rule repairs, a multi-part answer where one part is present, or a genuinely unsolved level."
      >
        <Panel>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left">
              <thead>
                <tr className="font-mono text-[9px] uppercase tracking-widest text-[#666]">
                  <th className="px-3 py-2 font-normal">domain</th>
                  <th className="px-3 py-2 font-normal">level</th>
                  <th className="px-3 py-2 font-normal">why it read as zero</th>
                  {order.map((m) => (
                    <th key={m.id} className="px-3 py-2 text-right font-normal">
                      <span style={{ color: m.accent }}>{m.label}</span>
                      <span className="block text-[8px] normal-case tracking-normal text-[#555]">frozen / partial</span>
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-normal">oracle</th>
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
                      L{z.level}
                      <span className="ml-1.5 text-[9px] text-[#666]">{a.benchmark.levels[z.level - 1]?.short}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className="font-mono text-[10px]"
                        style={{
                          color: z.kind === "structured" ? "#9fd8b4" : z.kind === "plain" ? "#f0a5a5" : "#a1a1a1",
                        }}
                      >
                        {z.category}
                      </span>
                    </td>
                    {order.map((m) => {
                      const p = z.per.find((x) => x.model === m.id);
                      return (
                        <td key={m.id} className="px-3 py-2 text-right font-mono text-[11px] tabular-nums">
                          <span style={{ color: (p?.acc ?? 0) > 0 ? m.accent : "#555" }}>{pct(p?.acc ?? 0, 1)}</span>
                          <span className="ml-2 text-[10px] text-[#666]">{pct(p?.partial ?? 0, 1)}</span>
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-right font-mono text-[10px] tabular-nums text-[#666]">{pct(z.oracle, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <p className="mt-2 font-mono text-[10px] leading-relaxed text-[#666]">
          frozen / partial = accuracy and mean share of parts matched under the frozen rule · {a.audit.zeroFrozen.length} further levels score
          zero for every model under the frozen rule as well:{" "}
          {a.audit.zeroFrozen.map((z) => z.label + " L" + z.level).join(" · ")}.
        </p>
      </Section>

      <Section
        eyebrow="04 design"
        title="Levels with one answer for every image"
        hint="A single ground truth across all 1,500 images means blind answering scores 100%. These levels inflate accuracy and should be excluded or rebalanced."
      >
        <Panel>
          <table className="w-full text-left">
            <thead>
              <tr className="font-mono text-[9px] uppercase tracking-widest text-[#666]">
                <th className="px-3 py-2 font-normal">domain</th>
                <th className="px-3 py-2 font-normal">level</th>
                <th className="px-3 py-2 font-normal">the only answer</th>
                <th className="px-3 py-2 text-right font-normal">oracle</th>
                <th className="px-3 py-2 text-right font-normal">questions</th>
                <th className="px-3 py-2 font-normal">models on it</th>
              </tr>
            </thead>
            <tbody>
              {a.audit.constantLevels.map((c) => (
                <tr key={c.domain + c.level} className="border-t border-[#141414]">
                  <th scope="row" className="px-3 py-2 text-left font-normal">
                    <Link to="/open-models/domains/$slug" params={{ slug: c.domain }} className="text-[12.5px] text-[#ededed] hover:text-accent">
                      {c.label}
                    </Link>
                  </th>
                  <td className="px-3 py-2 font-mono text-[11px] text-white">
                    L{c.level} <span className="text-[9px] text-[#666]">{a.benchmark.levels[c.level - 1]?.short}</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-[#a1a1a1]">“{c.top}”</td>
                  <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-[#f0a5a5]">{pct(c.oracle, 1)}</td>
                  <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-[#a1a1a1]">{fmtInt(c.n)}</td>
                  <td className="px-3 py-2 font-mono text-[11px] tabular-nums">
                    {order.map((m, i) => {
                      const d = a.domains.find((x) => x.key === c.domain);
                      const l = d?.per.find((p) => p.model === m.id)?.levels[c.level - 1];
                      return (
                        <span key={m.id}>
                          {i > 0 && " · "}
                          <span style={{ color: m.accent }}>{pct(l?.acc ?? null, 1)}</span>
                        </span>
                      );
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </Section>

      <Section
        eyebrow="05 movement"
        title="Where the frozen rule moves the score most"
        hint="Differences are frozen-rule accuracy minus the run's own score, averaged over models per domain."
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <MoverList title="Under-scored by the run's own harness" rows={a.audit.underCredited} tone="#9fd8b4" />
          <MoverList title="Over-scored by the run's own harness" rows={a.audit.overCredited} tone="#f0a5a5" />
        </div>
      </Section>

      <Section
        eyebrow="06 provenance"
        title="Ground-truth drift against the current upstream dataset"
        hint="Same question ids, same levels — but the upstream ground truth has changed for a share of them, so the dataset was regenerated after these runs. Grading here always uses the ground truth each run recorded, so the comparison stays paired."
      >
        <TileGrid cols={4}>
          <Tile
            label="paired across runs"
            value={a.integrity.gtPairing.mismatch === 0 && a.integrity.gtPairing.missing === 0 ? "yes" : "no"}
            accent={a.integrity.gtPairing.mismatch === 0 && a.integrity.gtPairing.missing === 0 ? "#9fd8b4" : "#f0a5a5"}
            sub={fmtInt(a.integrity.gtPairing.checked) + " questions share one ground truth vs " + (a.integrity.gtPairing.reference ?? "the reference run")}
          />
          <Tile label="drifted questions" value={fmtInt(drift.mismatch)} sub={"of " + fmtInt(drift.checked) + " · " + pct(drift.mismatch / Math.max(1, drift.checked), 1)} />
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
  const max = Math.max(0.001, ...rows.map((r) => Math.abs(r.delta)));
  return (
    <Panel className="p-4">
      <p className="font-mono text-[9px] uppercase tracking-widest" style={{ color: tone }}>
        {title}
      </p>
      <ul className="mt-3 space-y-2">
        {rows.map((r) => (
          <li key={r.domain} className="grid grid-cols-[150px_1fr_56px] items-center gap-3">
            <Link to="/open-models/domains/$slug" params={{ slug: r.domain }} className="truncate text-[12px] text-[#ededed] hover:text-accent">
              {r.label}
            </Link>
            <div className="h-[9px] rounded-sm bg-[#141414]">
              <div className="h-full rounded-sm" style={{ width: (Math.abs(r.delta) / max) * 100 + "%", background: tone }} />
            </div>
            <span className="text-right font-mono text-[11px] tabular-nums" style={{ color: tone }}>
              {signed(r.delta, 1)}
            </span>
            <span className="col-span-3 -mt-1 font-mono text-[9px] text-[#555]">
              {a.models.map((m, i) => m.label + " " + signed(r.per[i] ?? 0, 1)).join(" · ")}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
