import { Fragment, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useOM } from "./open-models";
import { Bar, Chip, Empty, Panel, Section, Seg, TextInput } from "../components/open-models/ui";
import { LevelSpark } from "../components/open-models/charts";
import { METRICS, type Metric, metricValue, pct, ranked, signed } from "../lib/openModelsFmt";
import type { Artifact } from "../lib/openModelsTypes";

export const Route = createFileRoute("/open-models/domains/")({ component: DomainsPage });

type View = "domain" | "family" | "level";
type SortKey = "label" | "n" | "spread" | "oracle" | string;

interface RowMetrics {
  acc: number | null;
  as: number | null;
  partial: number | null;
  headroom: number | null;
  oracle: number | null;
  levels: (number | null)[];
  n: number;
  pf: number;
}

interface Row {
  key: string;
  label: string;
  href?: string;
  family: string | null;
  flags: string[];
  per: Record<string, RowMetrics>;
  spread: number | null;
}

/* --------------------------------------------------------------- builders --- */

function perFrom(
  acc: number | null,
  as: number | null,
  partial: number | null,
  oracle: number | null,
  levels: (number | null)[],
  n: number,
  pf: number,
): RowMetrics {
  return { acc, as, partial, oracle, headroom: acc != null && oracle != null ? acc - oracle : null, levels, n, pf };
}

function domainRows(a: Artifact): Row[] {
  return a.domains.map((d) => {
    const per: Record<string, RowMetrics> = {};
    for (const m of a.models) {
      const r = d.per.find((p) => p.model === m.id);
      per[m.id] = perFrom(
        r?.acc ?? null,
        r?.as ?? null,
        r?.partial ?? null,
        d.oracle,
        (r?.levels ?? []).map((l) => l.acc ?? null),
        r?.n ?? 0,
        r?.pf ?? 0,
      );
    }
    const accs = a.models.map((m) => per[m.id].acc).filter((x): x is number => x != null);
    return {
      key: d.key,
      label: d.label,
      href: "/open-models/domains/" + d.key,
      family: d.familyName,
      flags: d.const.map((c) => "L" + c.level),
      per,
      spread: accs.length > 1 ? Math.max(...accs) - Math.min(...accs) : null,
    };
  });
}

function familyRows(a: Artifact): Row[] {
  const names = a.benchmark.families;
  return names.map((name, fi) => {
    const per: Record<string, RowMetrics> = {};
    for (const m of a.models) {
      const f = m.families[fi];
      per[m.id] = perFrom(
        f.acc,
        f.as,
        f.partial,
        f.oracle,
        f.levels.map((l) => l.acc),
        f.n,
        m.families[fi] ? Math.round((m.totals.pfRate ?? 0) * f.n) : 0,
      );
    }
    const accs = a.models.map((m) => per[m.id].acc).filter((x): x is number => x != null);
    return {
      key: name,
      label: name,
      family: null,
      flags: [],
      per,
      spread: accs.length > 1 ? Math.max(...accs) - Math.min(...accs) : null,
    };
  });
}

function levelRows(a: Artifact): Row[] {
  return a.benchmark.levels.map((lv) => {
    const per: Record<string, RowMetrics> = {};
    for (const m of a.models) {
      const l = m.totals.levels[lv.n - 1];
      per[m.id] = perFrom(l.acc, l.as, l.partial, l.oracle ?? null, [l.acc], l.n, l.pf);
    }
    const accs = a.models.map((m) => per[m.id].acc).filter((x): x is number => x != null);
    return {
      key: String(lv.n),
      label: "L" + lv.n + " · " + lv.task,
      family: lv.short,
      flags: [],
      per,
      spread: accs.length > 1 ? Math.max(...accs) - Math.min(...accs) : null,
    };
  });
}

/* ------------------------------------------------------------------- page --- */

export function DomainsPage() {
  const a = useOM();
  const order = ranked(a.models);
  const [view, setView] = useState<View>("domain");
  const [metric, setMetric] = useState<Metric>("acc");
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState<string | null>(null);
  const [onlyConst, setOnlyConst] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "label", dir: 1 });
  const [copied, setCopied] = useState(false);

  const all = useMemo(() => (view === "domain" ? domainRows(a) : view === "family" ? familyRows(a) : levelRows(a)), [a, view]);

  const rows = useMemo(() => {
    let out = all;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      out = out.filter((r) => r.label.toLowerCase().includes(q) || (r.family ?? "").toLowerCase().includes(q));
    }
    if (family) out = out.filter((r) => r.family === family);
    if (onlyConst) out = out.filter((r) => r.flags.length > 0);
    const dir = sort.dir;
    return [...out].sort((x, y) => {
      if (sort.key === "label") return x.label.localeCompare(y.label) * dir;
      if (sort.key === "n") return (x.per[order[0].id].n - y.per[order[0].id].n) * dir;
      if (sort.key === "spread") return ((x.spread ?? 0) - (y.spread ?? 0)) * dir;
      if (sort.key === "oracle") return ((x.per[order[0].id].oracle ?? 0) - (y.per[order[0].id].oracle ?? 0)) * dir;
      const xi = metricValue(x.per[sort.key], metric) ?? 0;
      const yi = metricValue(y.per[sort.key], metric) ?? 0;
      return (xi - yi) * dir;
    });
  }, [all, query, family, onlyConst, sort, metric, order]);

  const constDomains = a.domains.filter((d) => d.const.length > 0);

  const copyTsv = () => {
    const head = ["slice", "n", ...a.models.map((m) => m.label + " " + metric), "oracle", "spread"].join("\t");
    const body = rows
      .map((r) =>
        [
          r.label,
          r.per[order[0].id].n,
          ...a.models.map((m) => ((metricValue(r.per[m.id], metric) ?? 0) * 100).toFixed(2)),
          ((r.per[order[0].id].oracle ?? 0) * 100).toFixed(2),
          ((r.spread ?? 0) * 100).toFixed(2),
        ].join("\t"),
      )
      .join("\n");
    navigator.clipboard
      ?.writeText(head + "\n" + body)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => setCopied(false));
  };

  return (
    <div>
      <Section
        eyebrow="01 domain table"
        title="Every slice, sortable and filterable"
        hint={
          <>
            {a.domains.length} domains · {a.benchmark.families.length} families · 5 levels. Click any column header to sort; the
            sparkline under each score is that slice's L1–L5 shape.
          </>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-[#262626] bg-[#0a0a0a] px-3 py-2.5">
          <Seg
            label="rows"
            value={view}
            onChange={(v) => {
              setView(v);
              setSort({ key: "label", dir: 1 });
            }}
            options={[
              { id: "domain", label: "by domain" },
              { id: "family", label: "by family" },
              { id: "level", label: "by level" },
            ]}
          />
          <Seg label="metric" value={metric} onChange={setMetric} options={METRICS.map((m) => ({ id: m.id, label: m.short, hint: m.hint }))} />
          <TextInput value={query} onChange={setQuery} placeholder="filter slices…" />
          <Chip active={onlyConst} onClick={() => setOnlyConst((v) => !v)} title="Only slices with a single-answer level">
            ◆ single-answer ({constDomains.length})
          </Chip>
          <button
            type="button"
            onClick={copyTsv}
            className="ml-auto rounded border border-[#262626] px-2.5 py-1 font-mono text-[10px] text-[#a1a1a1] transition-colors hover:border-[#404040] hover:text-white"
          >
            {copied ? "copied ✓" : "copy TSV"}
          </button>
        </div>

        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <Chip active={family === null} onClick={() => setFamily(null)}>
            all families
          </Chip>
          {a.benchmark.families.map((f) => (
            <Chip key={f} active={family === f} onClick={() => setFamily(family === f ? null : f)}>
              {f}
            </Chip>
          ))}
        </div>

        <Panel>
          <div className="max-h-[74vh] overflow-auto">
            <table className="w-full min-w-[1000px] border-separate border-spacing-0 text-left text-sm">
              <thead>
                <tr className="font-mono text-[9px] uppercase tracking-widest text-[#666]">
                  <th className="sticky top-0 z-20 bg-[#0a0a0a] px-3 py-2 font-normal" rowSpan={2}>
                    slice
                  </th>
                  {order.map((m) => (
                    <th key={m.id} colSpan={3} className="sticky top-0 z-20 bg-[#0a0a0a] border-b border-[#262626] px-3 py-1.5 text-left font-normal">
                      <span style={{ color: m.accent }}>{m.label}</span>
                    </th>
                  ))}
                  <th className="sticky top-0 z-20 bg-[#0a0a0a] border-b border-[#262626] px-3 py-1.5 text-right font-normal" rowSpan={2}>
                    oracle
                  </th>
                  <th className="sticky top-0 z-20 bg-[#0a0a0a] border-b border-[#262626] px-3 py-1.5 text-right font-normal" rowSpan={2}>
                    L1–L5 shape
                  </th>
                  <th className="sticky top-0 z-20 bg-[#0a0a0a] border-b border-[#262626] px-3 py-1.5 text-right font-normal" rowSpan={2}>
                    spread
                  </th>
                  <th className="sticky top-0 z-20 bg-[#0a0a0a] border-b border-[#262626] px-3 py-1.5 text-right font-normal" rowSpan={2} title="Parse failures: empty or over-long extracted answers">
                    parse fail
                  </th>
                </tr>
                <tr className="font-mono text-[9px] uppercase tracking-widest text-[#555]">
                  {order.map((m) => (
                    <Fragment key={m.id}>
                      <th className="sticky top-[30px] z-20 bg-[#0a0a0a] px-3 py-1.5 text-left font-normal">
                        <button type="button" onClick={() => setSort({ key: m.id, dir: sort.key === m.id && sort.dir === -1 ? 1 : -1 })} className="transition-colors hover:text-white">
                          {metric} {sort.key === m.id ? (sort.dir === -1 ? "▼" : "▲") : ""}
                        </button>
                      </th>
                      <th className="sticky top-[30px] z-20 bg-[#0a0a0a] px-2 py-1.5 text-right font-normal">
                        partial
                      </th>
                      <th className="sticky top-[30px] z-20 bg-[#0a0a0a] px-2 py-1.5 text-right font-normal">
                        vs oracle
                      </th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-[#262626] bg-[#0f0f0f] font-mono text-[10px] text-[#a1a1a1]">
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => setSort({ key: "label", dir: sort.key === "label" && sort.dir === -1 ? 1 : -1 })} className="uppercase tracking-widest transition-colors hover:text-white">
                      {view} · {rows.length} shown
                    </button>
                  </td>
                  {order.map((m) => {
                    const tot = m.totals;
                    return (
                      <Fragment key={m.id}>
                        <td className="px-3 py-2 font-semibold" style={{ color: m.accent }}>
                          {pct(metric === "headroom" ? tot.headroom : metric === "acc" ? tot.acc : metric === "as" ? tot.as : tot.partial, 2)}
                        </td>
                        <td className="px-2 py-2 text-right text-[#666]">{pct(tot.partial, 1)}</td>
                        <td className="px-2 py-2 text-right text-[#666]">{signed(tot.headroom, 1)}</td>
                      </Fragment>
                    );
                  })}
                  <td className="px-3 py-2 text-right">{pct(a.models[0]?.totals.oracle ?? null, 1)}</td>
                  <td />
                  <td className="px-3 py-2 text-right">{pct(order[0] ? order[0].totals.acc : null, 1)}</td>
                  <td className="px-3 py-2 text-right">{pct(a.models[0]?.totals.pfRate ?? null, 2)}</td>
                </tr>
                {rows.map((r) => (
                  <tr key={r.key} className="border-b border-[#141414] last:border-0 transition-colors hover:bg-[#101010]">
                    <th scope="row" className="sticky left-0 z-10 max-w-[230px] bg-[#0a0a0a] px-3 py-2 text-left font-normal">
                      {r.href ? (
                        <Link to="/open-models/domains/$slug" params={{ slug: r.key }} className="text-[13px] text-[#ededed] transition-colors hover:text-accent">
                          {r.label}
                        </Link>
                      ) : (
                        <span className="text-[13px] text-[#ededed]">{r.label}</span>
                      )}
                      <span className="mt-0.5 flex items-center gap-2">
                        {r.family && <span className="font-mono text-[9px] text-[#555]">{r.family}</span>}
                        {r.flags.length > 0 && (
                          <span className="font-mono text-[9px] text-[#f0a5a5]" title="single-answer levels — blind answering scores 100%">
                            ◆ {r.flags.join(", ")}
                          </span>
                        )}
                      </span>
                    </th>
                    {order.map((m) => {
                      const v = metricValue(r.per[m.id], metric);
                      return (
                        <Fragment key={m.id}>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span className="w-11 flex-none font-mono text-[11px] tabular-nums" style={{ color: m.accent }}>
                                {pct(v, 1)}
                              </span>
                              <Bar value={v} oracle={metric === "headroom" ? null : r.per[m.id].oracle} color={m.accent} height={5} />
                            </div>
                          </td>
                          <td className="px-2 py-2 text-right font-mono text-[10px] tabular-nums text-[#666]">
                            {pct(r.per[m.id].partial, 1)}
                          </td>
                          <td className="px-2 py-2 text-right font-mono text-[10px] tabular-nums" style={{ color: m.accent }}>
                            {signed(r.per[m.id].headroom, 1)}
                          </td>
                        </Fragment>
                      );
                    })}
                    <td className="px-3 py-2 text-right font-mono text-[10px] tabular-nums text-[#666]">{pct(r.per[order[0].id].oracle, 1)}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1.5">
                        {order.map((m) => (
                          <LevelSpark key={m.id} values={r.per[m.id].levels} color={m.accent} />
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-[10px] tabular-nums text-[#a1a1a1]">{signed(r.spread, 1)}</td>
                    <td className="px-3 py-2 text-right font-mono text-[10px] tabular-nums text-[#a1a1a1]">
                      {r.per[order[0].id].n ? pct(r.per[order[0].id].pf / r.per[order[0].id].n, 2) : "—"}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={10}>
                      <Empty>no slice matches those filters</Empty>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <p className="mt-2 font-mono text-[10px] leading-relaxed text-[#666]">
          spread = best model − worst model on that slice · vs oracle = accuracy − majority-answer baseline · partial = mean share of
          ground-truth parts matched.
        </p>
        {constDomains.length > 0 && (
          <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-[#f0a5a5]">
            ◆ {constDomains.length} domains carry a level whose ground truth is one value for all 1,500 images — accuracy on those levels is
            100% by guessing. {constDomains.map((d) => d.label + " L" + d.const.map((c) => c.level).join("/L")).join(" · ")}
          </p>
        )}
      </Section>
    </div>
  );
}

