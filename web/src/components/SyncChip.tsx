import { useEffect, useState } from "react";
import type { Latest } from "../lib/types";
import { nextSync, timeAgo, tzShort } from "../lib/format";

export function SyncChip({ meta }: { meta: Latest["meta"] }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const minsSince = Math.round((Date.now() - Date.parse(meta.scannedAt)) / 60000);
  const stale = minsSince > 90;
  const next = nextSync(meta.cron);
  const secsLeft = Math.max(0, Math.floor((next.getTime() - Date.now()) / 1000));
  const mm = String(Math.floor(secsLeft / 60)).padStart(2, "0");
  const ss = String(secsLeft % 60).padStart(2, "0");
  const hh = Math.floor(secsLeft / 3600);

  return (
    <div
      className="flex items-center gap-2 font-mono text-[11px] text-[#a1a1a1]"
      title={`last scan ${meta.scannedAt} · schedule "${meta.cron}"`}
    >
      <span className={`inline-block h-[6px] w-[6px] rounded-full ${stale ? "bg-danger" : "bg-[#0cce6b] animate-pulse"}`} />
      <span>synced {timeAgo(meta.scannedAt)}</span>
      <span className="text-[#666]">·</span>
      <span>
        next ~
        {hh > 0 ? `${hh}h ` : ""}
        {mm}:{ss}
      </span>
      {stale && <span className="rounded bg-danger/10 px-1.5 py-0.5 text-danger">STALE</span>}
    </div>
  );
}

export function TzNote() {
  return <span className="font-mono text-[10px] text-[#666]">{tzShort()}</span>;
}
