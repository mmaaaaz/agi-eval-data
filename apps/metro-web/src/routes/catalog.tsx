import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useData } from "../lib/dataContext";
import { countriesOf, cityName } from "../lib/data";
import { fmtN } from "../lib/format";
import { ThumbImage } from "../components/ThumbImage";
import { Lightbox } from "../components/Lightbox";
import { Eyebrow } from "../components/Section";
import type { Row } from "@metro/shared/types";

export const Route = createFileRoute("/catalog")({
  component: Catalog,
  validateSearch: (s: Record<string, unknown>) => ({
    branch: typeof s.branch === "string" ? s.branch : "ours",
    country: typeof s.country === "string" ? s.country : "",
  }),
});

const BRANCHES = [
  { id: "ours", label: "Ours", hint: "curated maps" },
  { id: "reason_map(exisiting_dataset)", label: "Existing", hint: "reason_map dataset" },
];

function Catalog() {
  const { data } = useData();
  const search = Route.useSearch();
  if (!data) return null;

  const countries = countriesOf(data);
  const branch = search.branch;
  const country = search.country;

  const branchCountries = countries.filter((s) => s.branch === branch);
  const activeCountry = country
    ? branchCountries.find((s) => s.name === country)
    : undefined;
  const rows = activeCountry
    ? data.files.filter((r) => r[8][0] === branch && r[8][1] === activeCountry.name)
    : [];

  return (
    <div>
      <Eyebrow n="02">catalog</Eyebrow>

      {/* branch toggle */}
      <div className="mb-6 flex gap-1">
        {BRANCHES.map((b) => (
          <Link
            key={b.id}
            to="/catalog"
            search={{ branch: b.id, country: "" }}
            activeOptions={{ exact: false }}
            activeProps={{ className: "bg-white text-black border-white" }}
            className={`shrink-0 rounded-md border px-3.5 py-1.5 font-mono text-[11px] transition-colors ${
              branch === b.id
                ? "border-white bg-white text-black"
                : "border-[#262626] text-[#a1a1a1] hover:border-[#404040] hover:text-white"
            }`}
          >
            {b.label}
            <span className="ml-1.5 opacity-50">
              {fmtN(countries.filter((s) => s.branch === b.id).length)}
            </span>
          </Link>
        ))}
      </div>

      {activeCountry ? (
        <CountryView country={activeCountry.name} rows={rows} />
      ) : (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[#262626] bg-[#262626] sm:grid-cols-3 lg:grid-cols-4">
          {branchCountries.map((s) => (
            <Link
              key={s.name}
              to="/catalog"
              search={{ branch: s.branch, country: s.name }}
              className="group bg-black p-3 transition-colors hover:bg-[#0a0a0a]"
            >
              <div className="h-24 overflow-hidden rounded-md border border-[#262626]">
                {s.sampleId ? (
                  <ThumbImage fileId={s.sampleId} alt={s.name} className="h-full w-full" />
                ) : (
                  <div className="flex h-full items-center justify-center font-mono text-[10px] text-[#666]">PDF</div>
                )}
              </div>
              <p className="mt-2 truncate text-sm font-medium text-[#ededed]">{s.name}</p>
              <p className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-[#666]">
                {s.images} map{s.images === 1 ? "" : "s"}
                {s.pdfs ? ` · ${s.pdfs} pdf` : ""}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function CountryView({ country, rows }: { country: string; rows: Row[] }) {
  const imgs = rows.filter((r) => r[7] === "i");
  const pdfs = rows.filter((r) => r[7] === "o");
  const all = [...imgs, ...pdfs];
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const openRow = openIdx != null ? all[openIdx] ?? null : null;

  const step = (dir: 1 | -1) =>
    setOpenIdx((i) => (i == null ? null : Math.max(0, Math.min(all.length - 1, i + dir))));

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <Link
          to="/catalog"
          search={{ branch: rows[0]?.[8][0] ?? "ours", country: "" }}
          className="font-mono text-xs text-accent hover:underline"
        >
          ← all countries
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-white">{country}</h1>
      </div>

      {imgs.length > 0 && (
        <section>
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-[#666]">
            network maps · {imgs.length}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {imgs.map((r, i) => (
              <button
                key={r[0]}
                onClick={() => setOpenIdx(i)}
                className="group text-left"
              >
                <div className="overflow-hidden rounded-lg border border-[#262626]">
                  <ThumbImage fileId={r[0]} w={1600} alt={r[1]} className="aspect-[3/4] w-full" />
                </div>
                <p className="mt-1.5 truncate font-mono text-[10px] text-[#a1a1a1]" title={r[1]}>
                  {cityName(r) || r[1]}
                </p>
                <p className="truncate font-mono text-[9px] text-[#666]">{r[1]}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      {pdfs.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-[#666]">
            official plans (PDF) · {pdfs.length}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {pdfs.map((r, i) => (
              <button
                key={r[0]}
                onClick={() => setOpenIdx(imgs.length + i)}
                className="group rounded-lg border border-[#262626] p-3 text-left"
              >
                <div className="overflow-hidden rounded-md border border-[#262626]">
                  <ThumbImage fileId={r[0]} kind="o" alt={r[1]} className="aspect-[3/4] w-full" />
                </div>
                <p className="mt-2 line-clamp-2 font-mono text-[10px] text-[#a1a1a1]" title={r[1]}>
                  {r[1]}
                </p>
              </button>
            ))}
          </div>
        </section>
      )}

      {openRow && (
        <Lightbox
          row={openRow}
          pos={openIdx ?? 0}
          total={all.length}
          onClose={() => setOpenIdx(null)}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
        />
      )}
    </div>
  );
}
