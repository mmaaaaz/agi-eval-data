import { createFileRoute } from "@tanstack/react-router";
import { useData } from "../lib/dataContext";
import { exifOf, imageRows, megapixels, orientationOf } from "../lib/data";
import { fmtN } from "../lib/format";
import { Eyebrow } from "../components/Section";

export const Route = createFileRoute("/composition")({ component: Composition });

const MP_BUCKETS: [string, number, number][] = [
  // label, min, max
  ["<1 MP", 0, 1],
  ["1–4 MP", 1, 4],
  ["4–12 MP", 4, 12],
  ["12–24 MP", 12, 24],
  ["24+ MP", 24, Infinity],
];

const ASPECTS: [string, number][] = [
  ["16:9", 16 / 9],
  ["3:2", 3 / 2],
  ["4:3", 4 / 3],
  ["5:4", 5 / 4],
  ["1:1", 1],
];

function nearestAspect(r: number): string {
  // portrait ratios are mirrored landscape ratios
  const rr = r < 1 ? 1 / r : r;
  const suffix = r < 1 ? " ↺" : "";
  for (const [label, v] of ASPECTS) {
    if (Math.abs(rr - v) / v <= 0.06) return label + suffix;
  }
  if (Math.abs(rr - 2.39) / 2.39 <= 0.08) return "21:9" + suffix;
  return "other" + suffix;
}

function Composition() {
  const { data } = useData();
  if (!data) return null;

  const imgs = imageRows(data);
  const ex = imgs.map((r) => ({ r, e: exifOf(data, r[0]) })).filter((x) => x.e) as {
    r: (typeof imgs)[0];
    e: { w: number; h: number; camera?: string };
  }[];
  const known = ex.length;
  const coverage = Math.round((known / Math.max(imgs.length, 1)) * 100);

  let land = 0, por = 0, sq = 0;
  const cams = new Map<string, number>();
  const mpCounts = MP_BUCKETS.map(() => 0);
  const aspects = new Map<string, number>();
  const mps: number[] = [];
  for (const { e } of ex) {
    const o = orientationOf(e.w, e.h);
    if (o === "landscape") land++;
    else if (o === "portrait") por++;
    else sq++;
    const mp = megapixels(e.w, e.h);
    mps.push(mp);
    mpCounts[MP_BUCKETS.findIndex(([, lo, hi]) => mp >= lo && mp < hi)]++;
    const a = nearestAspect(e.w / e.h);
    aspects.set(a, (aspects.get(a) ?? 0) + 1);
    if (e.camera) cams.set(e.camera, (cams.get(e.camera) ?? 0) + 1);
  }
  const medMp = known ? [...mps].sort((a, b) => a - b)[Math.floor(known / 2)] : 0;
  const maxMp = Math.max(...mpCounts, 1);

  const camRows = [...cams.entries()].sort((a, b) => b[1] - a[1]);
  const topCams = camRows.slice(0, 8);
  const othersCount = camRows.slice(8).reduce((s, [, c]) => s + c, 0);
  const maxCam = Math.max(...camRows.map(([, c]) => c), 1);

  const aspectRows = [...aspects.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxAspect = Math.max(...aspectRows.map(([, c]) => c), 1);

  return (
    <div>
      <Eyebrow n="03">composition</Eyebrow>
      <h1 className="text-2xl font-semibold tracking-tight text-white">
        What the dataset is made of
        <span className="ml-3 font-mono text-sm font-normal tabular-nums text-[#666]">
          {fmtN(known)} of {fmtN(imgs.length)} images with metadata
        </span>
      </h1>

      {/* coverage tiles */}
      <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[#262626] bg-[#262626] sm:grid-cols-4">
        <Tile label="metadata coverage" value={`${coverage}%`} />
        <Tile label="median resolution" value={`${medMp.toFixed(1)} MP`} />
        <Tile label="distinct cameras" value={fmtN(camRows.length)} />
        <Tile label="landscape share" value={`${Math.round((land / Math.max(known, 1)) * 100)}%`} />
      </div>

      {/* orientation */}
      <section className="pt-10">
        <h2 className="mb-4 font-medium tracking-tight text-white">Orientation</h2>
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-[#141414]">
          <span title={`landscape · ${fmtN(land)}`} style={{ width: `${(land / Math.max(known, 1)) * 100}%`, background: "#0070f3" }} />
          <span title={`portrait · ${fmtN(por)}`} style={{ width: `${(por / Math.max(known, 1)) * 100}%`, background: "#66aaff" }} />
          <span title={`square · ${fmtN(sq)}`} style={{ width: `${(sq / Math.max(known, 1)) * 100}%`, background: "#1b3a5c" }} />
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-[#666]">
          <span><i className="mr-1.5 inline-block h-[7px] w-[7px] rounded-full align-middle" style={{ background: "#0070f3" }} />landscape {fmtN(land)}</span>
          <span><i className="mr-1.5 inline-block h-[7px] w-[7px] rounded-full align-middle" style={{ background: "#66aaff" }} />portrait {fmtN(por)}</span>
          <span><i className="mr-1.5 inline-block h-[7px] w-[7px] rounded-full align-middle" style={{ background: "#1b3a5c" }} />square {fmtN(sq)}</span>
        </div>
      </section>

      <div className="grid gap-10 pt-10 lg:grid-cols-2">
        {/* resolution histogram */}
        <section>
          <h2 className="mb-5 font-medium tracking-tight text-white">Resolution</h2>
          <div className="flex h-44 items-end gap-3">
            {MP_BUCKETS.map(([label], i) => (
              <div key={label} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                <span className="font-mono text-[10px] tabular-nums text-[#a1a1a1]">{fmtN(mpCounts[i])}</span>
                <div
                  className="w-full rounded-t-[3px] transition-colors hover:bg-accent"
                  style={{
                    height: `${Math.max(3, (mpCounts[i] / maxMp) * 100)}%`,
                    backgroundColor: i === MP_BUCKETS.length - 1 ? "#0070f3" : "#262626",
                  }}
                  title={`${label} · ${fmtN(mpCounts[i])} images`}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-3 border-t border-[#262626]/60 pt-2">
            {MP_BUCKETS.map(([label]) => (
              <span key={label} className="min-w-0 flex-1 text-center font-mono text-[9px] text-[#666]">{label}</span>
            ))}
          </div>
        </section>

        {/* aspect ratios */}
        <section>
          <h2 className="mb-5 font-medium tracking-tight text-white">Aspect ratios</h2>
          {aspectRows.map(([a, c]) => (
            <div key={a} className="mb-2.5 grid grid-cols-[76px_1fr_56px] items-center gap-3">
              <span className="font-mono text-[11px] text-[#a1a1a1]">{a}</span>
              <span className="h-[10px] overflow-hidden rounded-full bg-[#161616]">
                <span
                  className="block h-full rounded-full bg-gradient-to-r from-[#155a9d] to-accent"
                  style={{ width: `${Math.max(2, (c / maxAspect) * 100)}%` }}
                />
              </span>
              <span className="text-right font-mono text-[11px] tabular-nums text-[#ededed]">{fmtN(c)}</span>
            </div>
          ))}
          <p className="mt-2 font-mono text-[10px] text-[#666]">↺ = rotated (portrait variant of the ratio)</p>
        </section>
      </div>

      {/* cameras */}
      <section className="pt-10">
        <h2 className="mb-5 font-medium tracking-tight text-white">
          Cameras
          <span className="ml-2 font-mono text-xs font-normal tabular-nums text-[#666]">top {topCams.length} of {camRows.length}</span>
        </h2>
        {topCams.map(([cam, c]) => (
          <div key={cam} className="mb-2.5 grid grid-cols-[minmax(110px,240px)_1fr_64px] items-center gap-3">
            <span className="truncate font-mono text-[11px] text-[#a1a1a1]" title={cam}>{cam}</span>
            <span className="h-[10px] overflow-hidden rounded-full bg-[#161616]">
              <span
                className="block h-full rounded-full bg-gradient-to-r from-[#155a9d] to-accent"
                style={{ width: `${Math.max(2, (c / maxCam) * 100)}%` }}
              />
            </span>
            <span className="text-right font-mono text-[11px] tabular-nums text-[#ededed]">{fmtN(c)}</span>
          </div>
        ))}
        {othersCount > 0 && (
          <p className="mt-3 font-mono text-[10px] text-[#666]">
            + {fmtN(othersCount)} images across {camRows.length - topCams.length} other devices
          </p>
        )}
        <p className="mt-6 font-mono text-[10px] leading-5 text-[#666]">
          source: drive imageMediaMetadata · cameras self-reported by exif · unknown-camera images excluded from gear stats
        </p>
      </section>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-black p-4">
      <p className="font-mono text-lg tabular-nums text-white">{value}</p>
      <p className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-[#666]">{label}</p>
    </div>
  );
}
