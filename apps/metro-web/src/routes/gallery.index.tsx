import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useData } from "../lib/dataContext";
import { catalogRows, cityName, countryOf } from "../lib/data";
import { ThumbImage } from "@site/thumb";
import { Lightbox } from "@site/lightbox";
import type { Row } from "@site/data";

export const Route = createFileRoute("/gallery/")({ component: GalleryImages });

function GalleryImages() {
  const { data } = useData();
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  if (!data) return null;

  const imgs: Row[] = useMemo(() => {
    const s = search.trim().toLowerCase();
    const all = catalogRows(data).filter((r) => r[7] === "i");
    if (!s) return all;
    return all.filter(
      (r) =>
        r[1].toLowerCase().includes(s) ||
        cityName(r).toLowerCase().includes(s) ||
        countryOf(r).toLowerCase().includes(s),
    );
  }, [data, search]);

  const openRow = openIdx != null ? imgs[openIdx] ?? null : null;
  const step = (dir: 1 | -1) =>
    setOpenIdx((i) => (i == null ? null : Math.max(0, Math.min(imgs.length - 1, i + dir))));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">All maps</h1>
          <p className="mt-1 font-mono text-[11px] text-[#666]">
            {imgs.length} network maps · click anything to open it full-screen
          </p>
        </div>
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOpenIdx(null); }}
          placeholder="filter city or country…"
          className="w-52 rounded-md border border-[#262626] bg-[#0a0a0a] px-3 py-1.5 font-mono text-xs text-[#ededed] outline-none transition-colors placeholder:text-muted-foreground focus:border-accent"
        />
      </div>

      {imgs.length === 0 ? (
        <p className="py-16 text-center font-mono text-xs text-muted-foreground">no maps match "{search}"</p>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {imgs.map((r, i) => (
            <button key={r[0]} onClick={() => setOpenIdx(i)} className="group text-left">
              <div className="overflow-hidden rounded-lg border border-[#262626]">
                <ThumbImage
                  fileId={r[0]}
                  alt={r[1]}
                  className="aspect-[3/4] w-full transition-transform duration-300 group-hover:scale-[1.03]"
                />
              </div>
              <p className="mt-1.5 truncate font-mono text-[10px] text-[#a1a1a1]" title={r[1]}>
                {cityName(r) || r[1]}
              </p>
              <p className="flex items-center justify-between font-mono text-[9px] text-[#666]">
                <span className="truncate">{countryOf(r) || "—"}</span>
              </p>
            </button>
          ))}
        </div>
      )}

      {openRow && (
        <Lightbox
          row={openRow}
          pos={openIdx ?? 0}
          total={imgs.length}
          onClose={() => setOpenIdx(null)}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
        />
      )}
    </div>
  );
}
