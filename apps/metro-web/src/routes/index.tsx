import { useEffect, useState } from "react";
import { useMemo } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useData } from "../lib/dataContext";
import { countriesOf, imageRows, foldersOf } from "../lib/data";
import { fmtN } from "../lib/format";
import { loadSettings } from "../lib/ai/settings";
import { questionsApi } from "../lib/questions";
import { ThumbImage } from "@site/thumb";
import { Eyebrow } from "@site/section";

export const Route = createFileRoute("/")({ component: Overview });

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function Overview() {
  const { data } = useData();
  const [counts, setCounts] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    const s = loadSettings();
    const relay = s.relay.replace(/\/+$/, "");
    if (!relay) return;
    let alive = true;
    questionsApi.counts(relay, s.accessCode)
      .then((r) => { if (alive) setCounts(r.counts); })
      .catch(() => { /* relay unreachable — coverage hidden */ });
    return () => { alive = false; };
  }, []);

  if (!data) return null;
  const c = data.meta.counts;
  const imgs = imageRows(data);
  const recent = [...imgs].sort((a, b) => b[4].localeCompare(a[4])).slice(0, 12);
  const countries = countriesOf(data);
  const branchOurs = countries.filter((s) => s.branch === "ours").length;
  const branchReason = countries.length - branchOurs;

  /* per-country coverage: avg questions per map (images only).
     Built once per data/counts change — a per-country filter per render is O(N×C). */
  const coverage = useMemo(() => {
    const byCountry = new Map<string, typeof data.files>();
    for (const r of data.files) {
      if (r[7] !== "i") continue;
      const key = `${foldersOf(r)?.[0] ?? ""}::${foldersOf(r)?.[1] ?? ""}`;
      if (!key.endsWith("::")) {
        const arr = byCountry.get(key);
        if (arr) arr.push(r);
        else byCountry.set(key, [r]);
      }
    }
    return countries
      .map((s) => {
        const countryImgs = byCountry.get(`${s.branch}::${s.name}`) ?? [];
        const total = countryImgs.reduce((acc, r) => acc + (counts?.[r[0]] ?? 0), 0);
        const n = countryImgs.length;
        return { name: s.name, branch: s.branch, n, total, avg: n ? total / n : 0 };
      })
      .filter((x) => x.n > 0)
      .sort((a, b) => a.avg - b.avg);
  }, [data, countries, counts]);

  const totalQuestions = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : null;
  const target = counts ? Object.keys(counts).length * 5 : null;

  return (
    <div>
      <Eyebrow n="01">overview</Eyebrow>

      <section className="pb-7">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#a1a1a1]">metro network maps</p>
        <p className="t-num mt-2 text-5xl font-semibold tabular-nums tracking-tighter text-white sm:text-6xl lg:text-7xl">
          {fmtN(c.images)}
        </p>
        <p className="mt-3 font-mono text-[11px] text-[#666] sm:text-xs">
          {fmtN(c.cities)} cities · {fmtN(c.countries)} countries · synced hourly
        </p>
      </section>

      <section aria-label="dataset stats" className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[#262626] bg-[#262626] sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="network maps" value={fmtN(c.images)} />
        <Tile label="official PDFs" value={fmtN(c.pdfs)} />
        <Tile label="countries" value={fmtN(c.countries)} />
        <Tile label="cities" value={fmtN(c.cities)} />
        <Tile label="ours / existing" value={`${branchOurs} / ${branchReason}`} />
        <Tile label="stored" value={fmtBytes(c.bytes)} />
      </section>

      <section aria-label="quick jump" className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Jump to="/catalog" label="Catalog" hint="browse by country" />
        <Jump to="/gallery" label="Gallery" hint="all maps in one grid" />
        <Jump to="/contribute" label="Contribute" hint="author questions" />
        <Jump to="/project" label="Project" hint="about the benchmark" />
      </section>

      {totalQuestions != null && (
        <section className="pt-8 sm:pt-10">
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2 className="font-medium tracking-tight text-white">Question coverage</h2>
            <span className="font-mono text-[10px] text-[#666]">
              {fmtN(totalQuestions)} questions · {fmtN(target ?? 0)} target (5/map)
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {coverage.map((x) => (
              <Link
                key={`${x.branch}/${x.name}`}
                to="/catalog"
                search={{ branch: x.branch, country: x.name }}
                className="group rounded-lg border border-[#262626] px-3 py-2.5 transition-colors hover:border-[#404040]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-mono text-[11px] text-[#ededed]">{x.name}</span>
                  <span className={`shrink-0 font-mono text-[11px] tabular-nums ${x.avg >= 5 ? "text-[#0cce6b]" : x.avg >= 2 ? "text-[#eab308]" : "text-danger"}`}>
                    {x.avg.toFixed(1)}
                  </span>
                </div>
                <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-[#161616]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#0a5c40] to-accent"
                    style={{ width: `${Math.min(100, (x.avg / 5) * 100)}%` }}
                  />
                </div>
                <p className="mt-1 font-mono text-[9px] text-muted-foreground">
                  {x.total}/{x.n * 5} · {fmtN(x.n)} maps
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="pt-8 sm:pt-10">
        <h2 className="mb-4 font-medium tracking-tight text-white">Latest additions</h2>
        <div className="scrollbar-none -mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-2 sm:-mx-1 sm:px-1">
          {recent.map((r) => (
            <div key={r[0]} className="w-[118px] shrink-0 snap-start">
              <ThumbImage fileId={r[0]} alt={r[1]} eager className="h-[84px] w-full rounded-md border border-[#262626]" />
              <p className="mt-1 truncate font-mono text-[9px] text-[#666]" title={r[1]}>
                {r[1]}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="pt-8 sm:pt-10">
        <h2 className="mb-4 font-medium tracking-tight text-white">Country coverage</h2>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[#262626] bg-[#262626] sm:grid-cols-3 lg:grid-cols-4">
          {countries.slice(0, 40).map((s) => (
            <Link
              key={`${s.branch}/${s.name}`}
              to="/catalog"
              search={{ branch: s.branch, country: s.name }}
              className="bg-black px-4 py-3 transition-colors hover:bg-[#0a0a0a]"
            >
              <p className="truncate text-sm font-medium text-[#ededed]">{s.name}</p>
              <p className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-[#666]">
                {s.images} map{s.images === 1 ? "" : "s"}
                {s.pdfs ? ` · ${s.pdfs} pdf` : ""}
              </p>
            </Link>
          ))}
        </div>
      </section>

      <p className="mt-8 border-t border-[#262626]/60 pt-4 font-mono text-[10px] leading-5 text-[#666]">
        two branches: ours (curated) + reason_map (existing dataset) · PDFs are official network plans
      </p>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-black p-3 sm:p-4">
      <p className="font-mono text-base tabular-nums sm:text-lg text-white">{value}</p>
      <p className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-[#666]">{label}</p>
    </div>
  );
}

function Jump({ to, label, hint }: { to: string; label: string; hint: string }) {
  return (
    <Link
      to={to}
      className="group rounded-lg border border-[#262626] bg-[#0a0a0a] px-4 py-3 transition-colors hover:border-[#404040]"
    >
      <span className="flex items-center justify-between">
        <span className="font-mono text-[11px] text-white">{label}</span>
        <span className="font-mono text-xs text-accent transition-transform group-hover:translate-x-0.5">→</span>
      </span>
      <span className="mt-0.5 block font-mono text-[9px] text-[#666]">{hint}</span>
    </Link>
  );
}
