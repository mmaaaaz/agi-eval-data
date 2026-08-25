import { useMemo } from "react";

interface Props {
  /** day → count (this contributor) */
  days: Map<string, number>;
  /** last day in dataset (YYYY-MM-DD) */
  endDay: string;
  weeks?: number;
}

const CELL = 11;

/** GitHub-style contribution calendar, last N weeks. */
export function Heatmap({ days, endDay, weeks = 26 }: Props) {
  const { cols, total, activeDays } = useMemo(() => {
    const end = new Date(`${endDay}T00:00:00Z`);
    if (Number.isNaN(end.getTime())) return { cols: [] as { day: string; c: number; monthTick: string | null }[][], total: 0, activeDays: 0 };
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (weeks * 7 - 1));

    const flat: { day: string; c: number; monthTick: string | null }[] = [];
    let prevMonth = -1;
    for (let i = 0; i < weeks * 7; i++) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      // week boundary = Sunday (column start): emit month tick on first column of a new month
      let tick: string | null = null;
      if (i % 7 === 0 && d.getUTCMonth() !== prevMonth) {
        prevMonth = d.getUTCMonth();
        tick = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
      }
      flat.push({ day: key, c: days.get(key) ?? 0, monthTick: tick });
    }
    const colsOut: typeof flat[] = [];
    for (let w = 0; w < weeks; w++) colsOut.push(flat.slice(w * 7, w * 7 + 7));
    const t = [...days.entries()].filter(([d]) => d >= start.toISOString().slice(0, 10)).reduce((s, [, c]) => s + c, 0);
    const ad = [...days.keys()].filter((d) => d >= start.toISOString().slice(0, 10)).length;
    return { cols: colsOut, total: t, activeDays: ad };
  }, [days, endDay, weeks]);

  const max = Math.max(...cols.flat().map((c) => c.c), 1);
  const level = (c: number) => (c === 0 ? "#141414" : c / max > 0.66 ? "#0070f3" : c / max > 0.33 ? "#155a9d" : "#0e2f52");

  return (
    <div>
      <div className="scrollbar-none overflow-x-auto pb-1">
        <div className="inline-block">
          {/* month ticks */}
          <div className="mb-1 flex gap-[3px]" style={{ paddingLeft: 24 }}>
            {cols.map((col, wi) => (
              <div key={wi} className="relative font-mono text-[9px] text-[#666]" style={{ width: CELL }}>
                {col[0]?.monthTick && <span className="absolute left-0 whitespace-nowrap">{col[0].monthTick}</span>}
              </div>
            ))}
          </div>
          <div className="flex gap-[3px]">
            {/* weekday labels */}
            <div className="flex flex-col gap-[3px] pr-1 font-mono text-[8px] text-[#404040]" style={{ width: 20, paddingTop: 0 }}>
              {["", "Mon", "", "Wed", "", "Fri", ""].map((l, i) => (
                <span key={i} style={{ height: CELL, lineHeight: `${CELL}px` }}>{l}</span>
              ))}
            </div>
            {cols.map((col, wi) => (
              <div key={wi} className="flex flex-col gap-[3px]">
                {col.map(({ day, c }) => (
                  <div
                    key={day}
                    title={c ? `${day} · ${c.toLocaleString()} files` : day}
                    className="rounded-[2px]"
                    style={{ width: CELL, height: CELL, backgroundColor: level(c) }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-2 font-mono text-[10px] text-[#666]">
        {total.toLocaleString()} uploads · {activeDays} active days · last {weeks} weeks
      </p>
    </div>
  );
}
