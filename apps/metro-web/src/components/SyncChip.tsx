import { useEffect, useState } from "react";
import { nextSlotAfter, timeAgo } from "../lib/format";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Sync pill — counts down to the next DAILY data sync (06:00 UTC) and polls
 * the baked version.json (same-origin, ~200 bytes) every minute. When a newer
 * sync lands, the pill becomes a hard-refresh button. No GitHub API, no
 * multi-megabyte requests.
 */
export function SyncChip() {
  const [now, setNow] = useState(() => Date.now());
  const [scannedAt, setScannedAt] = useState<string | null>(null);
  const [cron, setCron] = useState("0 6 * * *");
  const [update, setUpdate] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);

  // 1s tick for the countdown
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // baseline + 60s poll of the tiny version file (visible tabs only)
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/data/version.json", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const v = (await res.json()) as { scannedAt: string; cron?: string };
        if (cancelled) return;
        setCheckFailed(false);
        setCron(v.cron ?? "0 6 * * *");
        setScannedAt((prev) => {
          if (prev && v.scannedAt !== prev) setUpdate(true);
          return v.scannedAt;
        });
      } catch {
        if (!cancelled) setCheckFailed(true);
      }
    };
    void check();
    const t = window.setInterval(check, 60_000);
    const onVis = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const scannedAtMs = scannedAt
    ? Date.parse(scannedAt.endsWith("Z") ? scannedAt : `${scannedAt}Z`)
    : null;
  const next = scannedAtMs ? nextSlotAfter(cron, new Date(Math.max(now, scannedAtMs))) : null;
  const secsLeft = next ? Math.max(0, Math.floor((next.getTime() - now) / 1000)) : null;
  const mm = String(Math.floor((secsLeft ?? 0) / 3600) * 60 + Math.floor(((secsLeft ?? 0) % 3600) / 60)).padStart(2, "0");
  const ss = String((secsLeft ?? 0) % 60).padStart(2, "0");
  const minsSince = scannedAtMs ? Math.floor((now - scannedAtMs) / 60000) : 0;
  const delayed = minsSince > 26 * 60 && !update;

  const tooltip = scannedAt
    ? `last data sync ${timeAgo(new Date(scannedAtMs ?? now).toISOString())} · daily at 06:00 UTC · checks every minute`
    : "waiting for sync data";

  if (update) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => window.location.reload()}
            className="flex items-center gap-1.5 rounded-md border border-accent bg-accent/10 px-2.5 py-1 font-mono text-[10px] text-accent transition-colors hover:bg-accent hover:text-white"
          >
            ↻ new data — refresh
          </button>
        </TooltipTrigger>
        <TooltipContent>a newer data sync is available — reload to load it</TooltipContent>
      </Tooltip>
    );
  }

  const dot = delayed
    ? "bg-danger"
    : scannedAt
      ? "bg-[#0cce6b] animate-pulse"
      : "bg-[#666]";
  const label = !scannedAt
    ? "sync ?"
    : delayed
      ? "sync delayed"
      : secsLeft != null && secsLeft > 0
        ? `next ${mm}:${ss}`
        : "syncing…";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={() => !checkFailed && window.location.reload()}
          className="flex items-center gap-1.5 rounded-md border border-[#262626] px-2.5 py-1 font-mono text-[10px] text-[#666] transition-colors hover:border-[#404040] hover:text-white"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
          {checkFailed ? "sync offline" : label}
        </button>
      </TooltipTrigger>
      <TooltipContent>{checkFailed ? "couldn't reach the sync feed — check later" : tooltip}</TooltipContent>
    </Tooltip>
  );
}
// re-trigger
