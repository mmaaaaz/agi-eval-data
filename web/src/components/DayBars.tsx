import { useState } from "react";

interface Props {
  buckets: [string, number][];
  height?: number;
  /** optional per-day owner breakdown: day → [displayName, count][] */
  details?: Map<string, [string, number][]>;
}

/** Minimal per-day bar chart with rich hover tooltip. */
export function DayBars({ buckets, height = 64, details }: Props) {
  const [hover, setHover] = useState<number | null>(null);

  if (buckets.length === 0) {
    return <p className="font-mono text-xs text-[#666]">no uploads in range</p>;
  }
  const max = Math.max(...buckets.map(([, c]) => c), 1);
  const last = buckets.length - 1;
  const n = buckets.length;

  return (
    <div className="relative" onMouseLeave={() => setHover(null)}>
      <div className="flex items-end gap-[2px]" style={{ height }}>
        {buckets.map(([day, count], i) => (
          <button
            key={day}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            aria-label={`${day}: ${count} files`}
            className="min-w-[2px] flex-1 cursor-default rounded-t-[2px] transition-colors"
            style={{
              height: `${Math.max(3, (count / max) * 100)}%`,
              backgroundColor: hover === i ? "#0070f3" : i === last ? "#0070f3" : "#262626",
            }}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[10px] text-[#666]">
        <span>{buckets[0][0]}</span>
        <span>peak {max.toLocaleString()}/day</span>
        <span>{buckets[last][0]}</span>
      </div>

      {hover != null && (
        <Tooltip index={hover} total={n}>
          {(() => {
            const [day, count] = buckets[hover];
            const rows = details?.get(day) ?? [];
            return (
              <>
                <p className="font-mono text-[10px] text-[#666]">{day}</p>
                <p className="font-mono text-xs tabular-nums text-white">
                  {count.toLocaleString()} files
                </p>
                {rows.length > 0 && (
                  <div className="mt-1.5 space-y-0.5 border-t border-[#262626] pt-1.5">
                    {rows.slice(0, 5).map(([name, cnt]) => (
                      <p key={name} className="flex justify-between gap-4 font-mono text-[10px] tabular-nums">
                        <span className="max-w-[140px] truncate text-[#a1a1a1]">{name}</span>
                        <span className="text-[#ededed]">{cnt.toLocaleString()}</span>
                      </p>
                    ))}
                    {rows.length > 5 && (
                      <p className="font-mono text-[9px] text-[#666]">+{rows.length - 5} more</p>
                    )}
                  </div>
                )}
              </>
            );
          })()}
        </Tooltip>
      )}
    </div>
  );
}

function Tooltip({
  index,
  total,
  children,
}: {
  index: number;
  total: number;
  children: React.ReactNode;
}) {
  const pct = ((index + 0.5) / total) * 100;
  const clamped = Math.min(85, Math.max(15, pct));
  return (
    <div
      className="pointer-events-none absolute -top-2 z-30 min-w-[150px] -translate-x-1/2 -translate-y-full rounded-lg border border-[#262626] bg-[#0a0a0a]/95 p-2.5 shadow-2xl shadow-black/60"
      style={{ left: `${clamped}%` }}
    >
      {children}
    </div>
  );
}
