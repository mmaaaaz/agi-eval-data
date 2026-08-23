import { createFileRoute, Link } from "@tanstack/react-router";
import { useData } from "../lib/dataContext";
import { byDay, dupCounts, imageRows, ownerStats } from "../lib/data";
import { fmtB, fmtN } from "../lib/format";
import { DayBreakdown } from "../components/DayBreakdown";
import { ThumbImage } from "../components/ThumbImage";
import { VirtualGallery } from "../components/VirtualGallery";

export const Route = createFileRoute("/contributors/$email")({ component: Contributor });

function Contributor() {
  const { data } = useData();
  const { email: rawEmail } = Route.useParams();
  const email = decodeURIComponent(rawEmail);

  if (!data) return null;
  const stat = ownerStats(data).find((o) => o.email === email);
  if (!stat) {
    return (
      <div className="py-20 text-center">
        <p className="font-mono text-xs text-[#666]">no contributor “{email}” in this snapshot</p>
        <Link to="/contributors" className="mt-3 inline-block font-mono text-xs text-accent hover:underline">
          ← all contributors
        </Link>
      </div>
    );
  }

  const name = data.owners[email] ?? email;
  const theirImages = imageRows(data).filter((r) => r[5] === email);
  const dups = new Set(dupCounts(theirImages).keys());
  const days = byDay(theirImages, 120);

  return (
    <div>
      <Link to="/contributors" className="font-mono text-[11px] text-[#666] transition-colors hover:text-white">
        ← contributors
      </Link>

      <header className="mt-4 flex flex-wrap items-end justify-between gap-4 border-b border-[#262626]/60 pb-6">
        <div className="flex items-center gap-4">
          <ThumbImage
            fileId={stat.lastId || ""}
            alt={name}
            eager
            className="h-14 w-14 shrink-0 rounded-full border border-[#262626]"
          />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">{name}</h1>
            <p className="font-mono text-xs text-[#666]">{email}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-2 font-mono text-xs tabular-nums text-[#a1a1a1]">
          <Metric label="pictures" value={fmtN(stat.raw)} />
          <Metric label="unique" value={fmtN(stat.unique)} />
          <Metric label="dupes" value={fmtN(stat.dupes)} danger={stat.dupes > 0} />
          <Metric label="videos" value={fmtN(stat.videos)} />
          <Metric label="size" value={fmtB(stat.bytes)} />
        </div>
      </header>

      <section className="pt-6">
        <h2 className="mb-3 font-medium tracking-tight text-white">Upload rhythm</h2>
        <DayBreakdown buckets={days} />
      </section>

      <section className="flex min-h-[320px] flex-col pt-8 md:h-[calc(100dvh-30rem)]">
        <h2 className="mb-3 font-medium tracking-tight text-white">
          Their gallery <span className="ml-1 font-mono text-xs tabular-nums text-[#666]">{fmtN(theirImages.length)}</span>
        </h2>
        <VirtualGallery rows={theirImages} dupSet={dups} onOpen={() => {}} />
      </section>
    </div>
  );
}

function Metric({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <span>
      <span className="block text-[10px] uppercase tracking-wider text-[#666]">{label}</span>
      <span className={`text-sm ${danger ? "text-danger" : "text-white"}`}>{value}</span>
    </span>
  );
}
