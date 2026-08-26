import { createFileRoute } from "@tanstack/react-router";
import { useData } from "../lib/dataContext";
import { catalogRows, cityName, countryOf } from "../lib/data";
import { ThumbImage } from "../components/ThumbImage";
import { Eyebrow } from "../components/Section";

export const Route = createFileRoute("/gallery")({ component: Gallery });

function Gallery() {
  const { data } = useData();
  if (!data) return null;
  const rows = catalogRows(data);
  const imgs = rows.filter((r) => r[7] === "i");
  const pdfs = rows.filter((r) => r[7] === "o");

  return (
    <div>
      <Eyebrow n="03">gallery</Eyebrow>
      <h1 className="text-2xl font-semibold tracking-tight text-white">All maps</h1>
      <p className="mt-1 font-mono text-[11px] text-[#666]">
        {imgs.length} network maps · {pdfs.length} PDFs · tap a map for full size
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {rows.map((r) => (
          <a
            key={r[0]}
            href={r[7] === "o"
              ? `https://drive.google.com/file/d/${r[0]}/preview`
              : `https://lh3.googleusercontent.com/d/${r[0]}=w1600`}
            target="_blank"
            rel="noopener noreferrer"
            className="group"
          >
            <div className="overflow-hidden rounded-lg border border-[#262626]">
              <ThumbImage
                fileId={r[0]}
                kind={r[7]}
                alt={r[1]}
                className="aspect-[3/4] w-full transition-transform duration-300 group-hover:scale-[1.03]"
              />
            </div>
            <p className="mt-1.5 truncate font-mono text-[10px] text-[#a1a1a1]" title={r[1]}>
              {cityName(r) || r[1]}
            </p>
            <p className="flex items-center justify-between font-mono text-[9px] text-[#666]">
              <span className="truncate">{countryOf(r) || "—"}</span>
              {r[7] === "o" && <span className="ml-1 shrink-0 text-accent">PDF</span>}
            </p>
          </a>
        ))}
      </div>

      <p className="mt-6 border-t border-[#262626]/60 pt-4 font-mono text-[10px] text-[#666]">
        images open full-size via Google's CDN · PDFs open the Drive preview
      </p>
    </div>
  );
}
