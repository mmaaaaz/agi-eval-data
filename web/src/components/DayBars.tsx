interface Props {
  buckets: [string, number][];
  height?: number;
}

/** Minimal per-day bar chart — hairline, hover tooltip via title. */
export function DayBars({ buckets, height = 64 }: Props) {
  if (buckets.length === 0) {
    return <p className="font-mono text-xs text-[#666]">no uploads in range</p>;
  }
  const max = Math.max(...buckets.map(([, c]) => c), 1);
  const last = buckets.length - 1;
  return (
    <div>
      <div className="flex items-end gap-[2px]" style={{ height }}>
        {buckets.map(([day, count], i) => (
          <div
            key={day}
            title={`${day} · ${count.toLocaleString()} files`}
            className="min-w-[2px] flex-1 cursor-default rounded-t-[2px] transition-colors hover:bg-accent"
            style={{
              height: `${Math.max(3, (count / max) * 100)}%`,
              backgroundColor: i === last ? "#0070f3" : "#262626",
            }}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[10px] text-[#666]">
        <span>{buckets[0][0]}</span>
        <span>peak {max.toLocaleString()}/day</span>
        <span>{buckets[last][0]}</span>
      </div>
    </div>
  );
}
