import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useData } from "../lib/dataContext";
import { catalogRows, countryOf } from "../lib/data";
import { ThumbImage } from "../components/ThumbImage";
import { Lightbox } from "../components/Lightbox";
import type { Row } from "@metro/shared/types";

export const Route = createFileRoute("/gallery/pdfs")({ component: GalleryPdfs });

function GalleryPdfs() {
  const { data } = useData();
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  if (!data) return null;
  const pdfs: Row[] = catalogRows(data).filter((r) => r[7] === "o");
  const openRow = openIdx != null ? pdfs[openIdx] ?? null : null;

  const step = (dir: 1 | -1) =>
    setOpenIdx((i) => (i == null ? null : Math.max(0, Math.min(pdfs.length - 1, i + dir))));

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-white">Official plans</h1>
      <p className="mt-1 font-mono text-[11px] text-[#666]">
        {pdfs.length} PDFs · click to preview in-app
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {pdfs.map((r, i) => (
          <button key={r[0]} onClick={() => setOpenIdx(i)} className="group text-left">
            <div className="overflow-hidden rounded-lg border border-[#262626]">
              <ThumbImage
                fileId={r[0]}
                kind="o"
                alt={r[1]}
                className="aspect-[3/4] w-full transition-transform duration-300 group-hover:scale-[1.03]"
              />
            </div>
            <p className="mt-1.5 line-clamp-2 font-mono text-[10px] text-[#a1a1a1]" title={r[1]}>
              {r[1]}
            </p>
            <p className="flex items-center justify-between font-mono text-[9px] text-[#666]">
              <span className="truncate">{countryOf(r) || "—"}</span>
              <span className="ml-1 shrink-0 text-accent">PDF</span>
            </p>
          </button>
        ))}
      </div>

      {openRow && (
        <Lightbox
          row={openRow}
          pos={openIdx ?? 0}
          total={pdfs.length}
          onClose={() => setOpenIdx(null)}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
        />
      )}
    </div>
  );
}
