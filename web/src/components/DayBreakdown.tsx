import { useState, type CSSProperties } from "react";

interface Props {
  buckets: [string, number][];
  height?: number;
}

/** Expandable per-day breakdown — used on contributor pages. */
export function DayBreakdown({ buckets, height = 56 }: Props) {
  const [open, setOpen] = useState(false);
  if (buckets.length === 0) {
    return <p className="mt-3 font-mono text-[11px] text-[#666]">no image uploads in current view</p>;
  }
  const max = Math.max(...buckets.map(([, c]) => c), 1);
  const shown = open ? buckets : buckets.slice(-14);
  void height;
  return (
    <div className="mt-3">
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="w-full rounded-lg border border-dashed border-[#262626] py-2 font-mono text-[11px] tracking-wider text-[#666] transition-colors hover:border-[#404040] hover:text-[#a1a1a1]"
        >
          ▾ DAY-WISE BREAKDOWN ({buckets.length} DAYS)
        </button>
      )}
      {open && (
        <div className="border-t border-[#262626] pt-3">
          {shown.map(([day, count]) => (
            <div key={day} className="mb-1.5 grid grid-cols-[86px_1fr_48px] items-center gap-3">
              <span className="font-mono text-[10px] text-[#666]">{day}</span>
              <span className="h-[7px] overflow-hidden rounded-full bg-[#161616]">
                <span
                  className="block h-full rounded-full bg-gradient-to-r from-[#155a9d] to-accent"
                  style={{ width: `${Math.max(2, (count / max) * 100)}%` } as CSSProperties}
                />
              </span>
              <span className="text-right font-mono text-[10px] tabular-nums text-[#a1a1a1]">
                {count.toLocaleString()}
              </span>
            </div>
          ))}
          {buckets.length > 14 && (
            <button
              onClick={() => setOpen(false)}
              className="mt-2 w-full rounded-lg border border-dashed border-[#262626] py-2 font-mono text-[11px] text-[#666] hover:border-[#404040]"
            >
              ▴ COLLAPSE
            </button>
          )}
        </div>
      )}
    </div>
  );
}
