import { createFileRoute } from "@tanstack/react-router";
import { useData } from "../lib/dataContext";
import { byDay, exifOf, megapixels, ownerName } from "../lib/data";
import { fmtB, fmtN } from "../lib/format";
import { Eyebrow } from "../components/Section";
import { Link } from "@tanstack/react-router";
import { DayBars } from "../components/DayBars";
import { ThumbImage } from "../components/ThumbImage";

export const Route = createFileRoute("/")({ component: Overview });

function StatRow({ label, value, note, danger }: { label: string; value: string; note?: string; danger?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[#262626]/60 py-3">
      <dt className="font-mono text-[11px] uppercase tracking-wider text-[#a1a1a1]">{label}</dt>
      <dd className={`text-right font-mono text-sm tabular-nums ${danger ? "text-danger" : "text-[#ededed]"}`}>
        {value}
        {note && <span className="ml-2 text-[10px] text-[#666]">{note}</span>}
      </dd>
    </div>
  );
}

function Overview() {
  const { data } = useData();
  if (!data) return null;
  const c = data.meta.counts;
  const imgs = data.files.filter((r) => r[7] === "i");
  const days = byDay(imgs, 28);
  const exifKnown = imgs.filter((r) => exifOf(data, r[0]) !== null).length;
  const sortedMps = imgs
    .map((r) => exifOf(data, r[0]))
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .map((e) => megapixels(e.w, e.h))
    .sort((a, b) => a - b);
  const medMp = sortedMps.length ? sortedMps[Math.floor(sortedMps.length / 2)] : 0;
  const recent = [...imgs]
    .sort((a, b) => b[4].localeCompare(a[4]) || b[1].localeCompare(a[1]))
    .slice(0, 16);
  const activeDays = new Set(imgs.map((r) => r[4]).filter((d) => d !== "?"));
  const sortedDays = [...activeDays].sort();
  const wasted = data.dupGroups.reduce((s, g) => s + (g.count - 1) * g.size, 0);

  // per-day, per-owner breakdown for chart tooltips
  const dayOwner = new Map<string, Map<string, number>>();
  for (const r of imgs) {
    if (r[4] === "?") continue;
    let m = dayOwner.get(r[4]);
    if (!m) dayOwner.set(r[4], (m = new Map()));
    m.set(r[5], (m.get(r[5]) ?? 0) + 1);
  }
  const dayDetails = new Map<string, [string, number][]>([
    ...[...dayOwner.entries()].map(([day, m]) => [
      day,
      [...m.entries()]
        .map(([e, cnt]) => [data.owners[e] ?? e, cnt] as [string, number])
        .sort((a, b) => b[1] - a[1]),
    ] as [string, [string, number][]]),
  ]);


  return (
    <div>
      <Eyebrow n="01">overview</Eyebrow>

      {/* hero */}
      <section className="border-b border-[#262626]/60 pb-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#a1a1a1]">true picture count</p>
        <p key={c.imagesUnique} className="t-num mt-2 text-5xl font-semibold tabular-nums tracking-tighter text-white sm:text-6xl lg:text-7xl">
          {fmtN(c.imagesUnique)}
        </p>
      </section>

      <div className="grid gap-10 pt-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-4 font-medium tracking-tight text-white">The ledger</h2>
          <dl>
            <StatRow label="raw image files" value={fmtN(c.imagesRaw)} />
            <StatRow label="exact duplicate copies" value={fmtN(c.dupCopies)} danger />
            <StatRow label="videos (excluded)" value={fmtN(c.videos)} />
            <StatRow label="other items" value={fmtN(c.all - c.imagesRaw - c.videos)} />
            <StatRow label="contributors" value={fmtN(Object.keys(data.owners).length)} />
            <StatRow label="upload window" value={`${sortedDays[0] ?? "?"} → ${sortedDays.at(-1) ?? "?"}`} />
            <StatRow label="recoverable space" value={fmtB(wasted)} />
          </dl>
          <p className="mt-3 font-mono text-[10px] leading-5 text-[#666]">
            uniqueness = first occurrence per md5 checksum · byte-identical dedup only
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-medium tracking-tight text-white">Uploads / day — last 28</h2>
          <DayBars buckets={days} height={96} details={dayDetails} />

          <h2 className="mb-4 mt-10 font-medium tracking-tight text-white">Composition</h2>
          <Link
            to="/composition"
            className="group flex items-center justify-between gap-4 rounded-lg border border-[#262626] bg-[#0a0a0a] px-5 py-4 transition-colors hover:border-[#404040]"
          >
            <span>
              <span className="block text-sm text-[#ededed]">Orientation · resolution · aspect ratios · cameras</span>
              <span className="mt-0.5 block font-mono text-[10px] text-[#666]">
                {exifKnown > 0 ? `median ${medMp.toFixed(1)} MP · ${fmtN(exifKnown)} images with metadata` : "waiting for exif metadata"}
              </span>
            </span>
            <span className="font-mono text-sm text-accent transition-transform group-hover:translate-x-1">→</span>
          </Link>

          <h2 className="mb-4 mt-10 font-medium tracking-tight text-white">Latest arrivals</h2>
          <div className="-mx-1 flex gap-2 overflow-x-auto pb-2">
            {recent.map((r) => (
              <div key={r[0]} className="w-[118px] shrink-0">
                <ThumbImage fileId={r[0]} alt={r[1]} eager className="h-[84px] w-full rounded-md border border-[#262626]" />
                <p className="mt-1 truncate font-mono text-[9px] text-[#666]" title={`${r[1]} — ${ownerName(data, r[5])}`}>
                  {r[1]}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
