import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { ThumbImage } from "@site/thumb";
import { fmtN } from "../lib/format";

export const Route = createFileRoute("/gallery/insights")({ component: Composition });

const AXIS_TICK = { fill: "#666666", fontSize: 9, fontFamily: "Geist Mono" };

interface Bucket { bucket: string; images: number }
interface Insights {
  generated: string;
  scannedAt: string;
  totalImages: number;
  known: number;
  coverage: number;
  orientation: { landscape: number; portrait: number; square: number };
  resolution: {
    median: number;
    percentiles: { p10: number; p25: number; p50: number; p75: number; p90: number };
    buckets: Bucket[];
  };
  size: { buckets: Bucket[] };
  aspects: { aspect: string; count: number }[];
  exts: { total: number; rows: { ext: string; count: number }[]; othersCount: number; othersTypes: number };
  cameras: {
    totalDistinct: number;
    rows: { camera: string; images: number; medianMp: number }[];
    othersImages: number;
    othersDevices: number;
  };
  extremes: {
    smallest: { id: string; name: string; meta: string } | null;
    largest: { id: string; name: string; meta: string } | null;
    heaviest: { id: string; name: string; size: number } | null;
  };
}

const RES_CONFIG = { images: { label: "images", color: "var(--chart-1)" } } satisfies ChartConfig;
const SIZE_CONFIG = { images: { label: "images", color: "var(--chart-1)" } } satisfies ChartConfig;
const EXT_CONFIG = { images: { label: "images", color: "var(--chart-1)" } } satisfies ChartConfig;
const CAM_CONFIG = { images: { label: "images", color: "var(--chart-1)" } } satisfies ChartConfig;

function Composition() {
  const [s, setS] = useState<Insights | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/data/insights.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
      .then(setS)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) {
    return (
      <p className="py-16 text-center font-mono text-xs text-danger">
        insights unavailable ({error}) — the deploy pipeline bakes /data/insights.json from data/latest.json
      </p>
    );
  }
  if (!s) {
    return (
      <div className="space-y-4 pt-2">
        <Skeleton h={32} w={420} />
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[#262626] sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} h={56} />)}
        </div>
        <Skeleton h={180} />
        <Skeleton h={180} />
      </div>
    );
  }

  const orientation = [
    { label: "landscape", n: s.orientation.landscape, color: "#0070f3" },
    { label: "portrait", n: s.orientation.portrait, color: "#66aaff" },
    { label: "square", n: s.orientation.square, color: "#1b3a5c" },
  ];
  const orientTotal = Math.max(s.known, 1);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-white">
        What the dataset is made of
        <span className="mt-2 block font-mono text-sm font-normal tabular-nums text-[#666] sm:ml-3 sm:mt-0 sm:inline">
          {fmtN(s.known)} of {fmtN(s.totalImages)} images with metadata
        </span>
      </h1>

      {/* summary tiles */}
      <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[#262626] bg-[#262626] sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="metadata coverage" value={`${s.coverage}%`} />
        <Tile label="median resolution" value={`${s.resolution.median.toFixed(1)} MP`} />
        <Tile label="distinct cameras" value={fmtN(s.cameras.totalDistinct)} />
        <Tile label="landscape share" value={`${Math.round((s.orientation.landscape / Math.max(s.known, 1)) * 100)}%`} />
        <Tile label="file types" value={fmtN(s.exts.total)} />
        <Tile label="heaviest file" value={s.extremes.heaviest ? fmtSize(s.extremes.heaviest.size) : "—"} />
      </div>

      {/* resolution percentile strip */}
      <section className="pt-8">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-[#666]">resolution percentiles (MP)</p>
        <div className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-[11px] tabular-nums text-[#ededed]">
          {Object.entries(s.resolution.percentiles).map(([label, v]) => (
            <span key={label}>
              <span className="text-[#666]">{label} </span>
              {v.toFixed(1)}
            </span>
          ))}
        </div>
      </section>

      {/* orientation */}
      <section className="pt-10">
        <h2 className="mb-4 font-medium tracking-tight text-white">Orientation</h2>
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-[#141414]">
          {orientation.map((o) => (
            <span key={o.label} title={`${o.label} · ${fmtN(o.n)}`} style={{ width: `${(o.n / orientTotal) * 100}%`, background: o.color }} />
          ))}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-[#666]">
          {orientation.map((o) => (
            <span key={o.label}>
              <i className="mr-1.5 inline-block h-[7px] w-[7px] rounded-full align-middle" style={{ background: o.color }} />
              {o.label} {fmtN(o.n)}
            </span>
          ))}
        </div>
      </section>

      <div className="grid gap-10 pt-10 lg:grid-cols-2">
        {/* resolution */}
        <section>
          <h2 className="mb-5 font-medium tracking-tight text-white">Resolution</h2>
          <ChartContainer config={RES_CONFIG} className="h-44 w-full">
            <BarChart data={s.resolution.buckets} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
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
          <ChartContainer config={EXT_CONFIG} className="h-44 w-full">
            <BarChart data={s.exts.rows} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 4 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="ext" tick={AXIS_TICK} axisLine={false} tickLine={false} width={56} />
              <ChartTooltip content={<ChartTooltipContent hideLabel />} cursor={{ fill: "#141414" }} />
              <Bar dataKey="count" fill="var(--color-images)" radius={[0, 3, 3, 0]} barSize={14} />
            </BarChart>
          </ChartContainer>
          {s.exts.othersCount > 0 && (
            <p className="mt-3 font-mono text-[10px] text-[#666]">
              + {fmtN(s.exts.othersCount)} images across {s.exts.othersTypes} other types
            </p>
          )}
        </section>
      </div>

      <div className="grid gap-10 pt-10 lg:grid-cols-2">
        {/* file size distribution */}
        <section>
          <h2 className="mb-5 font-medium tracking-tight text-white">File size</h2>
          <ChartContainer config={SIZE_CONFIG} className="h-44 w-full">
            <BarChart data={s.size.buckets} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
              <CartesianGrid vertical={false} stroke="#1a1a1a" />
              <XAxis dataKey="bucket" tick={AXIS_TICK} axisLine={false} tickLine={false} interval={0} />
              <YAxis hide />
              <ChartTooltip content={<ChartTooltipContent hideLabel />} cursor={{ fill: "#141414" }} />
              <Bar dataKey="images" fill="var(--color-images)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </section>

        {/* aspect ratios */}
        <section>
          <h2 className="mb-5 font-medium tracking-tight text-white">Aspect ratios</h2>
          {s.aspects.map((a) => {
            const max = Math.max(...s.aspects.map((x) => x.count), 1);
            return (
              <div key={a.aspect} className="mb-2.5 grid grid-cols-[76px_1fr_56px] items-center gap-3">
                <span className="font-mono text-[11px] text-[#a1a1a1]">{a.aspect}</span>
                <span className="h-[10px] overflow-hidden rounded-full bg-[#161616]">
                  <span
                    className="block h-full rounded-full bg-gradient-to-r from-[#155a9d] to-accent"
                    style={{ width: `${Math.max(2, (a.count / max) * 100)}%` }}
                  />
                </span>
                <span className="text-right font-mono text-[11px] tabular-nums text-[#ededed]">{fmtN(a.count)}</span>
              </div>
            );
          })}
          <p className="mt-2 font-mono text-[10px] text-[#666]">↺ = rotated (portrait variant of the ratio)</p>
        </section>
      </div>

      {/* cameras */}
      <section className="pt-10">
        <h2 className="mb-5 font-medium tracking-tight text-white">
          Cameras
          <span className="ml-2 font-mono text-xs font-normal tabular-nums text-[#666]">
            top {s.cameras.rows.length} of {s.cameras.totalDistinct} · hover for median MP
          </span>
        </h2>
        <ChartContainer config={CAM_CONFIG} className="h-64 w-full">
          <BarChart data={s.cameras.rows} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 4 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="camera" tick={AXIS_TICK} axisLine={false} tickLine={false} width={130} />
            <ChartTooltip
              content={<ChartTooltipContent hideLabel />}
              cursor={{ fill: "#141414" }}
            />
            <Bar dataKey="images" fill="var(--color-images)" radius={[0, 3, 3, 0]} barSize={16} />
          </BarChart>
        </ChartContainer>
        {s.cameras.othersImages > 0 && (
          <p className="mt-3 font-mono text-[10px] text-[#666]">
            + {fmtN(s.cameras.othersImages)} images across {s.cameras.othersDevices} other devices
          </p>
        )}
        <p className="mt-6 font-mono text-[10px] leading-5 text-[#666]">
          source: drive imageMediaMetadata · cameras self-reported by exif · unknown-camera images excluded from gear stats
        </p>
      </section>

      {/* resolution extremes */}
      {(s.extremes.smallest || s.extremes.largest) && (
        <section className="pt-10">
          <h2 className="mb-5 font-medium tracking-tight text-white">Resolution extremes</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {s.extremes.smallest && <ExtremeCard title="smallest" data={s.extremes.smallest} />}
            {s.extremes.largest && <ExtremeCard title="largest" data={s.extremes.largest} />}
            {s.extremes.heaviest && (
              <ExtremeCard
                title="heaviest file"
                data={{ id: s.extremes.heaviest.id, name: s.extremes.heaviest.name, meta: fmtSize(s.extremes.heaviest.size) }}
              />
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function fmtSize(n: number): string {
  let b = n;
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) {
    b /= 1024;
    i++;
  }
  return `${b.toFixed(1)} ${u[i]}`;
}

function Skeleton({ h, w }: { h: number; w?: number }) {
  return <div className="animate-pulse rounded bg-[#141414]" style={{ height: h, width: w }} />;
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-black p-3 sm:p-4">
      <p className="font-mono text-base tabular-nums text-white sm:text-lg">{value}</p>
      <p className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-[#666]">{label}</p>
    </div>
  );
}

function ExtremeCard({ title, data }: { title: string; data: { id: string; name: string; meta: string } }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[#262626] bg-[#0a0a0a]">
      <ThumbImage fileId={data.id} alt={data.name} className="h-32 w-full" />
      <div className="px-3 py-2.5">
        <p className="font-mono text-[9px] uppercase tracking-wider text-accent">{title}</p>
        <p className="mt-1 truncate font-mono text-[11px] text-[#ededed]" title={data.name}>{data.name}</p>
        <p className="mt-0.5 font-mono text-[10px] tabular-nums text-[#666]">{data.meta}</p>
      </div>
    </div>
  );
}
