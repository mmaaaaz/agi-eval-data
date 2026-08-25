import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useData } from "../lib/dataContext";
import { byDay, dupCounts, imageRows, ownerStats } from "../lib/data";
import { fmtB, fmtN } from "../lib/format";
import { DayBreakdown } from "../components/DayBreakdown";
import { Heatmap } from "../components/Heatmap";
import { ThumbImage } from "../components/ThumbImage";
import { VirtualGallery } from "../components/VirtualGallery";
import { Lightbox } from "../components/Lightbox";

export const Route = createFileRoute("/gallery/contributors/$email")({ component: Contributor });

function Contributor() {
  const { data } = useData();
  const { email: rawEmail } = Route.useParams();
  // defensive: some historical links double-encode (@ → %40 → %2540)
  let email = rawEmail;
  try {
    email = decodeURIComponent(rawEmail);
    if (email.includes("%")) email = decodeURIComponent(email);
  } catch {
    /* keep as-is */
  }
  const [open, setOpen] = useState<number | null>(null);

  if (!data) return null;
  const stat = ownerStats(data).find((o) => o.email === email);
  if (!stat) {
    return (
      <div className="py-20 text-center">
        <p className="font-mono text-xs text-[#666]">no contributor “{email}” in this snapshot</p>
        <Link to="/gallery/contributors" className="mt-3 inline-block font-mono text-xs text-accent hover:underline">
          ← all contributors
        </Link>
      </div>
    );
  }

  const name = data.owners[email] ?? email;
  const theirImages = imageRows(data).filter((r) => r[5] === email);
  const dups = new Set(dupCounts(theirImages).keys());
  const days = byDay(theirImages, 120);
  const endDay = data.files.reduce((m, r) => (r[4] > m && r[4] !== "?" ? r[4] : m), "0000-00-00");

  return (
    <div>
      <Link to="/gallery/contributors" className="font-mono text-[11px] text-[#666] transition-colors hover:text-white">
        ← contributors
      </Link>

      {/* header: identity + metric tiles */}
      <header className="mt-4 flex flex-wrap items-center gap-4">
        <ThumbImage
          fileId={stat.lastId || ""}
          alt={name}
          eager
          className="h-16 w-16 shrink-0 rounded-full border border-[#262626]"
        />
        <div className="min-w-0 flex-1 basis-52">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-white">{name}</h1>
          <p className="truncate font-mono text-xs text-[#666]">{email}</p>
        </div>
      </header>

      <div className="mt-5 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-[#262626] bg-[#262626] sm:grid-cols-6">
        <Tile label="pictures" value={fmtN(stat.raw)} />
        <Tile label="unique" value={fmtN(stat.unique)} />
        <Tile label="dupes" value={fmtN(stat.dupes)} danger={stat.dupes > 0} />
        <Tile label="videos" value={fmtN(stat.videos)} />
        <Tile label="size" value={fmtB(stat.bytes)} />
        <Tile label="active days" value={fmtN(stat.days.size)} />
      </div>

      {/* rhythm */}
      <section className="pt-8">
        <h2 className="mb-4 font-medium tracking-tight text-white">Upload rhythm</h2>
        <Heatmap days={stat.days} endDay={endDay} />
        <div className="mt-4">
          <DayBreakdown buckets={days} />
        </div>
      </section>

      {/* gallery */}
      <section className="flex min-h-[480px] flex-col pt-10 md:h-[calc(100dvh-22rem)]">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="font-medium tracking-tight text-white">Their gallery</h2>
          <span className="font-mono text-xs tabular-nums text-[#666]">{fmtN(theirImages.length)} images</span>
        </div>
        <VirtualGallery rows={theirImages} dupSet={dups} onOpen={setOpen} />
      </section>

      {open != null && theirImages[open] && (
        <Lightbox
          row={theirImages[open]}
          latest={data}
          pos={open}
          total={theirImages.length}
          onClose={() => setOpen(null)}
          onPrev={() => setOpen(Math.max(0, open - 1))}
          onNext={() => setOpen(Math.min(theirImages.length - 1, open + 1))}
        />
      )}
    </div>
  );
}

function Tile({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="bg-black p-3">
      <p className={`font-mono text-base tabular-nums sm:text-lg ${danger ? "text-danger" : "text-white"}`}>{value}</p>
      <p className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-[#666]">{label}</p>
    </div>
  );
}
