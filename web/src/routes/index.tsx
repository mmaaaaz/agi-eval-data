import { useEffect, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { loadSettings } from "../lib/ai/settings";
import { questionsApi } from "../lib/questions";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { useData } from "../lib/dataContext";
import { byDay, exifOf, megapixels, ownerName } from "../lib/data";
import { fmtB, fmtN } from "../lib/format";
import { ThumbImage } from "../components/ThumbImage";
import { Eyebrow } from "../components/Section";

export const Route = createFileRoute("/")({ component: Overview });

function Overview() {
  const { data } = useData();
  const settings = loadSettings();
  const relay = settings.relay.replace(/\/+$/, "");
  const [progress, setProgress] = useState<{
    questions: number;
    images: number;
    graded: number;
    bestModel: string | null;
  } | null>(null);

  useEffect(() => {
    if (!relay) return;
    let alive = true;
    (async () => {
      try {
        const [c, ins] = await Promise.all([
          questionsApi.counts(relay, settings.accessCode),
          questionsApi.insights(relay, settings.accessCode),
        ]);
        if (!alive) return;
        const graded = ins.leaderboard.reduce((s2, r) => s2 + r.graded, 0);
        const best = ins.leaderboard[0];
        setProgress({
          questions: Object.values(c.counts).reduce((s2, n) => s2 + n, 0),
          images: c.images,
          graded,
          bestModel: graded > 0 ? best.model : null,
        });
      } catch {
        /* questions API locked or unreachable — strip stays hidden */
      }
    })();
    return () => { alive = false; };
  }, [relay, settings.accessCode]);

  if (!data) return null;
  const c = data.meta.counts;
  const imgs = data.files.filter((r) => r[7] === "i");
  const recent = [...imgs]
    .sort((a, b) => b[4].localeCompare(a[4]) || b[1].localeCompare(a[1]))
    .slice(0, 16);
  const activeDays = new Set(imgs.map((r) => r[4]).filter((d) => d !== "?"));
  const sortedDays = [...activeDays].sort();
  const wasted = data.dupGroups.reduce((s, g) => s + (g.count - 1) * g.size, 0);
  const exifKnown = imgs.filter((r) => exifOf(data, r[0]) !== null).length;

  return (
    <div>
      <Eyebrow n="01">overview</Eyebrow>

      {/* hero — mobile-first vertical rhythm */}
      <section className="pb-7">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#a1a1a1]">true picture count</p>
        <p
          key={c.imagesUnique}
          className="t-num mt-2 text-5xl font-semibold tabular-nums tracking-tighter text-white sm:text-6xl lg:text-7xl"
        >
          {fmtN(c.imagesUnique)}
        </p>
        <p className="mt-3 font-mono text-[11px] text-[#666] sm:text-xs">
          unique pictures · {sortedDays[0] ?? "?"} → {sortedDays.at(-1) ?? "?"} · synced hourly
        </p>
      </section>

      {/* stat tiles — 2-up mobile, 6-up desktop */}
      <section aria-label="dataset stats" className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[#262626] bg-[#262626] sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="raw images" value={fmtN(c.imagesRaw)} />
        <Tile label="duplicates" value={fmtN(c.dupCopies)} danger />
        <Tile label="videos" value={fmtN(c.videos)} />
        <Tile label="contributors" value={fmtN(Object.keys(data.owners).length)} />
        <Tile label="stored" value={fmtB(c.bytes)} />
        <Tile label="recoverable" value={fmtB(wasted)} danger={wasted > 0} />
      </section>

      {/* benchmark progress — visible when the questions API is reachable */}
      {progress && progress.questions > 0 && (
        <section aria-label="benchmark progress" className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[#262626] bg-[#262626] sm:grid-cols-4">
          <Tile label="questions authored" value={progress.questions.toLocaleString("en-US")} />
          <Tile label="images covered" value={progress.images.toLocaleString("en-US")} />
          <Tile label="model responses graded" value={progress.graded.toLocaleString("en-US")} />
          <Tile label="leading model" value={progress.bestModel ? familyLabel(progress.bestModel) : "—"} />
        </section>
      )}

      {/* quick jumps */}
      <section aria-label="quick jump" className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Jump to="/gallery" label="Images" hint="browse the dataset" />
        <Jump to="/gallery/insights" label="Insights" hint="orientation · size · cameras" />
        <Jump to="/gallery/duplicates" label="Duplicates" hint="cleanup triage" />
        <Jump to="/contribute" label="Contribute" hint="author questions" />
      </section>

      {/* uploads per day */}
      <section className="pt-8 sm:pt-10">
        <h2 className="mb-4 font-medium tracking-tight text-white">Uploads / day — last 28</h2>
        <UploadsChart imgs={imgs} owners={data.owners} />
      </section>

      {/* latest arrivals */}
      <section className="pt-8 sm:pt-10">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="font-medium tracking-tight text-white">Latest arrivals</h2>
          <span className="font-mono text-[10px] text-[#666]">swipe →</span>
        </div>
        <div className="scrollbar-none -mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-2 sm:-mx-1 sm:px-1">
          {recent.map((r) => (
            <div key={r[0]} className="w-[118px] shrink-0 snap-start">
              <ThumbImage fileId={r[0]} alt={r[1]} eager className="h-[84px] w-full rounded-md border border-[#262626]" />
              <p className="mt-1 truncate font-mono text-[9px] text-[#666]" title={`${r[1]} — ${ownerName(data, r[5])}`}>
                {r[1]}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* insights link */}
      <section className="pt-8 sm:pt-10">
        <h2 className="mb-4 font-medium tracking-tight text-white">Insights</h2>
        <Link
          to="/gallery/insights"
          className="group flex items-center justify-between gap-4 rounded-lg border border-[#262626] bg-[#0a0a0a] px-5 py-4 transition-colors hover:border-[#404040]"
        >
          <span>
            <span className="block text-sm text-[#ededed]">Orientation · resolution · file types · cameras · extremes</span>
            <span className="mt-0.5 block font-mono text-[10px] text-[#666]">
              {exifKnown > 0
                ? `median ${medianMp(imgs, data)} MP · ${fmtN(exifKnown)} images with metadata`
                : "waiting for exif metadata"}
            </span>
          </span>
          <span className="font-mono text-sm text-accent transition-transform group-hover:translate-x-1">→</span>
        </Link>
      </section>

      {/* footnote */}
      <p className="mt-8 border-t border-[#262626]/60 pt-4 font-mono text-[10px] leading-5 text-[#666]">
        uniqueness = first occurrence per md5 checksum · byte-identical dedup only
      </p>
    </div>
  );
}

function Tile({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="bg-black p-3 sm:p-4">
      <p className={`font-mono text-base tabular-nums sm:text-lg ${danger ? "text-danger" : "text-white"}`}>{value}</p>
      <p className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-[#666]">{label}</p>
    </div>
  );
}

function medianMp(imgs: import("../lib/types").Row[], data: import("../lib/types").Latest): string {
  const mps = imgs
    .map((r) => exifOf(data, r[0]))
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .map((e) => megapixels(e.w, e.h))
    .sort((a, b) => a - b);
  return mps.length ? mps[Math.floor(mps.length / 2)].toFixed(1) : "—";
}

function buildDayDetails(
  imgs: import("../lib/types").Row[],
  owners: Record<string, string>,
) {
  const m = new Map<string, Map<string, number>>();
  for (const r of imgs) {
    if (r[4] === "?") continue;
    let d = m.get(r[4]);
    if (!d) m.set(r[4], (d = new Map()));
    d.set(r[5], (d.get(r[5]) ?? 0) + 1);
  }
  return new Map<string, [string, number][]>(
    [...m.entries()].map(([day, om]) => [
      day,
      [...om.entries()].map(([e, c]) => [owners[e] ?? e, c] as [string, number]).sort((a, b) => b[1] - a[1]),
    ]),
  );
}

const uploadsConfig = { uploads: { label: "uploads", color: "var(--chart-1)" } } satisfies ChartConfig;

function UploadsChart({ imgs, owners }: { imgs: import("../lib/types").Row[]; owners: Record<string, string> }) {
  const details = buildDayDetails(imgs, owners);
  const data = byDay(imgs, 28).map(([day, count]) => ({ day, short: day.slice(5), uploads: count }));

  return (
    <ChartContainer config={uploadsConfig} className="h-24 w-full">
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
        <CartesianGrid vertical={false} stroke="#1a1a1a" />
        <XAxis
          dataKey="short"
          tick={{ fill: "#666666", fontSize: 9, fontFamily: "Geist Mono" }}
          axisLine={false}
          tickLine={false}
          interval={Math.max(0, Math.floor(data.length / 7) - 1)}
        />
        <ChartTooltip
          cursor={{ fill: "#141414" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const day = payload[0].payload.day as string;
            const owners2 = (details.get(day) ?? []).slice(0, 5);
            return (
              <div className="rounded-lg border border-[#262626] bg-[#0a0a0a]/95 px-3 py-2 shadow-xl">
                <p className="font-mono text-[10px] text-[#666]">{day}</p>
                <p className="font-mono text-xs tabular-nums text-white">{payload[0].value?.toLocaleString()} uploads</p>
                {owners2.length > 0 && (
                  <div className="mt-1.5 space-y-0.5 border-t border-[#262626] pt-1.5">
                    {owners2.map(([name, cnt]) => (
                      <p key={name} className="flex justify-between gap-4 font-mono text-[10px] tabular-nums">
                        <span className="max-w-[140px] truncate text-[#a1a1a1]">{name}</span>
                        <span className="text-[#ededed]">{cnt.toLocaleString()}</span>
                      </p>
                    ))}
                  </div>
                )}
              </div>
            );
          }}
        />
        <Bar dataKey="uploads" fill="var(--color-uploads)" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}

function familyLabel(model: string): string {
  const provider = model.split("/")[0] ?? "";
  const map: Record<string, string> = {
    openai: "GPT",
    anthropic: "Claude",
    google: "Gemini",
    "meta-llama": "Llama",
    qwen: "Qwen",
    "x-ai": "Grok",
  };
  return map[provider] ?? provider;
}

function Jump({ to, label, hint }: { to: string; label: string; hint: string }) {
  return (
    <Link
      to={to}
      className="group rounded-lg border border-[#262626] bg-[#0a0a0a] px-4 py-3 transition-colors hover:border-[#404040]"
    >
      <span className="flex items-center justify-between">
        <span className="font-mono text-[11px] text-white">{label}</span>
        <span className="font-mono text-xs text-accent transition-transform group-hover:translate-x-0.5">→</span>
      </span>
      <span className="mt-0.5 block font-mono text-[9px] text-[#666]">{hint}</span>
    </Link>
  );
}
