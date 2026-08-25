import { createFileRoute } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import { useData } from "../lib/dataContext";
import { exifOf, imageRows, megapixels, orientationOf, type ExifInfo, type Row } from "../lib/data";
import { fmtB, fmtN } from "../lib/format";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { ThumbImage } from "../components/ThumbImage";

export const Route = createFileRoute("/gallery/insights")({ component: Composition });

const MP_BUCKETS: [string, number, number][] = [
  // label, min, max
  ["<1 MP", 0, 1],
  ["1–4 MP", 1, 4],
  ["4–12 MP", 4, 12],
  ["12–24 MP", 12, 24],
  ["24+ MP", 24, Infinity],
];

const SIZE_BUCKETS: [string, number, number][] = [
  // label, min bytes, max bytes
  ["<0.1 MB", 0, 100_000],
  ["0.1–1 MB", 100_000, 1_000_000],
  ["1–5 MB", 1_000_000, 5_000_000],
  ["5–20 MB", 5_000_000, 20_000_000],
  ["20 MB+", 20_000_000, Infinity],
];

const ASPECTS: [string, number][] = [
  ["16:9", 16 / 9],
  ["3:2", 3 / 2],
  ["4:3", 4 / 3],
  ["5:4", 5 / 4],
  ["1:1", 1],
];

const AXIS_TICK = { fill: "#666666", fontSize: 9, fontFamily: "Geist Mono" };

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

function percentile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];
}

interface ExEntry {
  r: Row;
  e: ExifInfo;
}

function Composition() {
  const { data } = useData();
  if (!data) return null;

  const imgs = imageRows(data);
  const ex = imgs
    .map((r) => ({ r, e: exifOf(data, r[0]) }))
    .filter((x) => x.e !== null) as ExEntry[];
  const known = ex.length;
  const coverage = Math.round((known / Math.max(imgs.length, 1)) * 100);

  let land = 0, por = 0, sq = 0;
  const cams = new Map<string, { count: number; mps: number[] }>();
  const mpCounts = MP_BUCKETS.map(() => 0);
  const sizeCounts = SIZE_BUCKETS.map(() => 0);
  const aspects = new Map<string, number>();
  const exts = new Map<string, number>();
  const mps: number[] = [];
  let heaviest: { r: Row; size: number } | null = null;

  for (const r of imgs) {
    exts.set(r[2], (exts.get(r[2]) ?? 0) + 1);
    sizeCounts[SIZE_BUCKETS.findIndex(([, lo, hi]) => r[3] >= lo && r[3] < hi)]++;
    if (!heaviest || r[3] > heaviest.size) heaviest = { r, size: r[3] };
  }
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
    if (e.camera) {
      const c = cams.get(e.camera) ?? { count: 0, mps: [] as number[] };
      c.count++;
      c.mps.push(mp);
      cams.set(e.camera, c);
    }
  }
  const sortedMps = [...mps].sort((a, b) => a - b);
  const medMp = known ? percentile(sortedMps, 0.5) : 0;

  const resolutionData = MP_BUCKETS.map(([label], i) => ({ bucket: label, images: mpCounts[i] }));
  const sizeData = SIZE_BUCKETS.map(([label], i) => ({ bucket: label, images: sizeCounts[i] }));
  const resolutionConfig = { images: { label: "images", color: "var(--chart-1)" } } satisfies ChartConfig;
  const sizeConfig = { images: { label: "images", color: "var(--chart-1)" } } satisfies ChartConfig;

  const camRows = [...cams.entries()].sort((a, b) => b[1].count - a[1].count);
  const topCams = camRows.slice(0, 8);
  const othersCount = camRows.slice(8).reduce((s, [, c]) => s + c.count, 0);
  const camData = topCams.map(([cam, c]) => ({
    camera: cam.length > 18 ? cam.slice(0, 17) + "…" : cam,
    fullName: cam,
    images: c.count,
    medianMp: Number(percentile([...c.mps].sort((a, b) => a - b), 0.5).toFixed(1)),
  }));
  const camConfig = { images: { label: "images", color: "var(--chart-1)" } } satisfies ChartConfig;

  const extRowsAll = [...exts.entries()].sort((a, b) => b[1] - a[1]);
  const extData = extRowsAll.slice(0, 9).map(([e, c]) => ({ ext: `.${e}`, images: c }));
  const extConfig = { images: { label: "images", color: "var(--chart-1)" } } satisfies ChartConfig;

  const aspectRows = [...aspects.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxAspect = Math.max(...aspectRows.map(([, c]) => c), 1);

  const othersExtCount = extRowsAll.slice(9).reduce((s, [, c]) => s + c, 0);

  const byMp = [...ex].sort((a, b) => megapixels(b.e.w, b.e.h) - megapixels(a.e.w, a.e.h));
  const smallest = byMp.at(-1);
  const largest = byMp[0];

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-white">
        What the dataset is made of
        <span className="mt-2 block font-mono text-sm font-normal tabular-nums text-[#666] sm:ml-3 sm:mt-0 sm:inline">
          {fmtN(known)} of {fmtN(imgs.length)} images with metadata
        </span>
      </h1>

      {/* summary tiles */}
      <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[#262626] bg-[#262626] sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="metadata coverage" value={`${coverage}%`} />
        <Tile label="median resolution" value={`${medMp.toFixed(1)} MP`} />
        <Tile label="distinct cameras" value={fmtN(camRows.length)} />
        <Tile label="landscape share" value={`${Math.round((land / Math.max(known, 1)) * 100)}%`} />
        <Tile label="file types" value={fmtN(extRowsAll.length)} />
        <Tile label="heaviest file" value={heaviest ? fmtB(heaviest.size) : "—"} />
      </div>

      {/* resolution percentile strip */}
      <section className="pt-8">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-[#666]">resolution percentiles (MP)</p>
        <div className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-[11px] tabular-nums text-[#ededed]">
          {([["p10", 0.1], ["p25", 0.25], ["p50", 0.5], ["p75", 0.75], ["p90", 0.9]] as const).map(([label, q]) => (
            <span key={label}>
              <span className="text-[#666]">{label} </span>
              {known ? percentile(sortedMps, q).toFixed(1) : "—"}
            </span>
          ))}
        </div>
      </section>

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
        {/* resolution */}
        <section>
          <h2 className="mb-5 font-medium tracking-tight text-white">Resolution</h2>
          <ChartContainer config={resolutionConfig} className="h-44 w-full">
            <BarChart data={resolutionData} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
              <CartesianGrid vertical={false} stroke="#1a1a1a" />
              <XAxis dataKey="bucket" tick={AXIS_TICK} axisLine={false} tickLine={false} interval={0} />
              <YAxis hide />
              <ChartTooltip content={<ChartTooltipContent hideLabel />} cursor={{ fill: "#141414" }} />
              <Bar dataKey="images" fill="var(--color-images)" radius={[3, 3, 0, 0]}>
                <LabelList dataKey="images" position="top" style={{ fill: "#a1a1a1", fontSize: 9, fontFamily: "Geist Mono" }} />
              </Bar>
            </BarChart>
          </ChartContainer>
        </section>

        {/* file types */}
        <section>
          <h2 className="mb-5 font-medium tracking-tight text-white">File types</h2>
          <ChartContainer config={extConfig} className="h-44 w-full">
            <BarChart data={extData} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 4 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="ext" tick={AXIS_TICK} axisLine={false} tickLine={false} width={56} />
              <ChartTooltip content={<ChartTooltipContent hideLabel />} cursor={{ fill: "#141414" }} />
              <Bar dataKey="images" fill="var(--color-images)" radius={[0, 3, 3, 0]} barSize={14} />
            </BarChart>
          </ChartContainer>
          {othersExtCount > 0 && (
            <p className="mt-3 font-mono text-[10px] text-[#666]">
              + {fmtN(othersExtCount)} images across {extRowsAll.length - 9} other types
            </p>
          )}
        </section>
      </div>

      <div className="grid gap-10 pt-10 lg:grid-cols-2">
        {/* file size distribution */}
        <section>
          <h2 className="mb-5 font-medium tracking-tight text-white">File size</h2>
          <ChartContainer config={sizeConfig} className="h-44 w-full">
            <BarChart data={sizeData} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
              <CartesianGrid vertical={false} stroke="#1a1a1a" />
              <XAxis dataKey="bucket" tick={AXIS_TICK} axisLine={false} tickLine={false} interval={0} />
              <YAxis hide />
              <ChartTooltip content={<ChartTooltipContent hideLabel />} cursor={{ fill: "#141414" }} />
              <Bar dataKey="images" fill="var(--color-images)" radius={[3, 3, 0, 0]}>
                <LabelList dataKey="images" position="top" style={{ fill: "#a1a1a1", fontSize: 9, fontFamily: "Geist Mono" }} />
              </Bar>
            </BarChart>
          </ChartContainer>
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
          <span className="ml-2 font-mono text-xs font-normal tabular-nums text-[#666]">
            top {camData.length} of {camRows.length} · hover for median MP
          </span>
        </h2>
        <ChartContainer config={camConfig} className="h-64 w-full">
          <BarChart data={camData} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 4 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="camera" tick={AXIS_TICK} axisLine={false} tickLine={false} width={130} />
            <ChartTooltip
              content={<ChartTooltipContent hideLabel />}
              cursor={{ fill: "#141414" }}
              formatter={(_value, _name, item) => (
                <span className="font-mono text-[10px] text-[#ededed]">
                  {fmtN(Number(item.payload.images))} images · median {item.payload.medianMp} MP
                </span>
              )}
            />
            <Bar dataKey="images" fill="var(--color-images)" radius={[0, 3, 3, 0]} barSize={16} />
          </BarChart>
        </ChartContainer>
        {othersCount > 0 && (
          <p className="mt-3 font-mono text-[10px] text-[#666]">
            + {fmtN(othersCount)} images across {camRows.length - topCams.length} other devices
          </p>
        )}
        <p className="mt-6 font-mono text-[10px] leading-5 text-[#666]">
          source: drive imageMediaMetadata · cameras self-reported by exif · unknown-camera images excluded from gear stats
        </p>
      </section>

      {/* resolution extremes */}
      {known > 0 && smallest && largest && (
        <section className="pt-10">
          <h2 className="mb-5 font-medium tracking-tight text-white">Resolution extremes</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <ExtremeCard
              title="smallest"
              row={smallest.r}
              meta={`${smallest.e.w}×${smallest.e.h} · ${megapixels(smallest.e.w, smallest.e.h).toFixed(2)} MP`}
            />
            <ExtremeCard
              title="largest"
              row={largest.r}
              meta={`${largest.e.w}×${largest.e.h} · ${megapixels(largest.e.w, largest.e.h).toFixed(1)} MP`}
            />
            {heaviest && (
              <ExtremeCard title="heaviest file" row={heaviest.r} meta={fmtB(heaviest.size)} />
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-black p-3 sm:p-4">
      <p className="font-mono text-base tabular-nums text-white sm:text-lg">{value}</p>
      <p className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-[#666]">{label}</p>
    </div>
  );
}

function ExtremeCard({
  title,
  row,
  meta,
}: {
  title: string;
  row: Row;
  meta: string;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-[#262626] bg-[#0a0a0a]">
      <ThumbImage fileId={row[0]} alt={row[1]} className="h-32 w-full" />
      <div className="px-3 py-2.5">
        <p className="font-mono text-[9px] uppercase tracking-wider text-accent">{title}</p>
        <p className="mt-1 truncate font-mono text-[11px] text-[#ededed]" title={row[1]}>{row[1]}</p>
        <p className="mt-0.5 font-mono text-[10px] tabular-nums text-[#666]">{meta}</p>
      </div>
    </div>
  );
}
