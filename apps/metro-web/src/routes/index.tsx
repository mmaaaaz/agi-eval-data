import { Link, createFileRoute } from "@tanstack/react-router";
import { useData } from "../lib/dataContext";
import { countriesOf, imageRows } from "../lib/data";
import { fmtN } from "../lib/format";
import { ThumbImage } from "../components/ThumbImage";
import { Eyebrow } from "../components/Section";

export const Route = createFileRoute("/")({ component: Overview });

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function Overview() {
  const { data } = useData();
  if (!data) return null;
  const c = data.meta.counts;
  const imgs = imageRows(data);
  const recent = [...imgs].sort((a, b) => b[4].localeCompare(a[4])).slice(0, 12);
  const countries = countriesOf(data);
  const branchOurs = countries.filter((s) => s.branch === "ours").length;
  const branchReason = countries.length - branchOurs;

  return (
    <div>
      <Eyebrow n="01">overview</Eyebrow>

      <section className="pb-7">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#a1a1a1]">metro network maps</p>
        <p className="t-num mt-2 text-5xl font-semibold tabular-nums tracking-tighter text-white sm:text-6xl lg:text-7xl">
          {fmtN(c.images)}
        </p>
        <p className="mt-3 font-mono text-[11px] text-[#666] sm:text-xs">
          {fmtN(c.cities)} cities · {fmtN(c.countries)} countries · synced daily
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
