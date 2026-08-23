import { createFileRoute } from "@tanstack/react-router";
import { useData } from "../lib/dataContext";
import { byDay, exifOf, megapixels, orientationOf, ownerName } from "../lib/data";
import { fmtB, fmtN } from "../lib/format";
import { DayBars } from "../components/DayBars";
import { ThumbImage } from "../components/ThumbImage";

export const Route = createFileRoute("/")({ component: Overview });

function Eyebrow({ n, children }: { n: string; children: string }) {
  return (
    <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.2em] text-[#666]">
      <span className="text-accent">{n}</span> — {children}
    </p>
  );
}

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

  // exif composition
  let land = 0, por = 0, sq = 0;
  const cams = new Map<string, number>();
  const mps: number[] = [];
  for (const r of imgs) {
    const e = exifOf(data, r[0]);
    if (!e) continue;
    const o = orientationOf(e.w, e.h);
    if (o === "landscape") land++;
    else if (o === "portrait") por++;
    else sq++;
    mps.push(megapixels(e.w, e.h));
    if (e.camera) cams.set(e.camera, (cams.get(e.camera) ?? 0) + 1);
  }
  const known = mps.length;
  const medMp = known ? [...mps].sort((a, b) => a - b)[Math.floor(known / 2)] : 0;
  const topCams = [...cams.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);

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
          {known > 0 ? (
            <div>
              {/* orientation segmented bar */}
              <div className="flex h-2 w-full overflow-hidden rounded-full">
                <span title={`landscape · ${fmtN(land)}`} style={{ width: `${(land / known) * 100}%`, background: "#0070f3" }} />
                <span title={`portrait · ${fmtN(por)}`} style={{ width: `${(por / known) * 100}%`, background: "#66aaff" }} />
                <span title={`square · ${fmtN(sq)}`} style={{ width: `${(sq / known) * 100}%`, background: "#1b3a5c" }} />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-[#666]">
                <span><i className="mr-1 inline-block h-[7px] w-[7px] rounded-full align-middle" style={{ background: "#0070f3" }} />landscape {fmtN(land)}</span>
                <span><i className="mr-1 inline-block h-[7px] w-[7px] rounded-full align-middle" style={{ background: "#66aaff" }} />portrait {fmtN(por)}</span>
                <span><i className="mr-1 inline-block h-[7px] w-[7px] rounded-full align-middle" style={{ background: "#1b3a5c" }} />square {fmtN(sq)}</span>
              </div>
              <p className="mt-3 font-mono text-[11px] tabular-nums text-[#a1a1a1]">
                median {medMp.toFixed(1)} MP · metadata on {(known / Math.max(imgs.length, 1) * 100).toFixed(0)}% of images
              </p>
              {topCams.length > 0 && (
                <dl className="mt-3">
                  {topCams.map(([cam, n]) => (
                    <div key={cam} className="flex justify-between border-b border-[#262626]/50 py-1.5 font-mono text-[11px] last:border-b-0">
                      <dt className="truncate pr-3 text-[#a1a1a1]" title={cam}>{cam}</dt>
                      <dd className="tabular-nums text-[#ededed]">{fmtN(n)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          ) : (
            <p className="font-mono text-xs text-[#666]">waiting for exif metadata (next sync)</p>
          )}

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
