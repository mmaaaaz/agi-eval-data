import { useEffect, useState } from "react";
import { formatCountdown, nextSlotAfter, timeAgo } from "./format";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui";

interface Props {
  /** same-origin baked version file (e.g. "/data/version.json") */
  versionUrl?: string;
  /** fallback cron used until the version file is read */
  defaultCron?: string;
  /** human label for the tooltip's schedule, e.g. "daily at 06:00 UTC" */
  scheduleLabel?: string;
  /**
   * scannedAt (ISO) of the ledger the app actually loaded. The baked version.json
   * goes stale between deploys, so freshness is judged against whichever of the
   * two is newer — never against the baked file alone.
   */
  ledgerScannedAt?: string | null;
}

/** parse an ISO timestamp, tolerating values missing the trailing Z */
const toMs = (s: string): number => Date.parse(s.endsWith("Z") ? s : `${s}Z`);

/**
 * Sync pill — counts down to the next data sync and polls the baked
 * version.json (same-origin, ~200 bytes) every minute. When a newer sync
 * lands, the pill becomes a hard-refresh button. No GitHub API, no
 * multi-megabyte requests. Freshness is judged against the *loaded ledger's*
 * scannedAt when the app has one (the baked file can lag it by days).
 */
export function SyncChip({
  versionUrl = "/data/version.json",
  defaultCron = "0 6 * * *",
  scheduleLabel = "daily at 06:00 UTC",
  ledgerScannedAt = null,
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [scannedAt, setScannedAt] = useState<string | null>(null);
  const [cron, setCron] = useState(defaultCron);
  const [update, setUpdate] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);

  const ledgerMs = ledgerScannedAt ? toMs(ledgerScannedAt) : null;

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
        const res = await fetch(versionUrl, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const v = (await res.json()) as { scannedAt: string; cron?: string };
        if (cancelled) return;
        setCheckFailed(false);
        setCron(v.cron ?? defaultCron);
        setScannedAt((prev) => {
          const changed = prev != null && v.scannedAt !== prev;
          // Only announce "new data" when the poll is newer than what this
          // session actually loaded — a stale baked file never counts.
          const newer = ledgerMs == null || toMs(v.scannedAt) > ledgerMs;
          if (changed && newer) setUpdate(true);
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
  }, [versionUrl, defaultCron, ledgerMs]);

  const polledMs = scannedAt ? toMs(scannedAt) : null;
  const freshMs = Math.max(polledMs ?? 0, ledgerMs ?? 0) || null;
  const next = freshMs ? nextSlotAfter(cron, new Date(Math.max(now, freshMs))) : null;
  const secsLeft = next ? Math.max(0, Math.floor((next.getTime() - now) / 1000)) : null;
  const minsSince = freshMs ? Math.floor((now - freshMs) / 60000) : 0;
  const delayed = minsSince > 26 * 60 && !update;

  const tooltip = freshMs
    ? `last data sync ${timeAgo(new Date(freshMs).toISOString())} · ${scheduleLabel} · checks every minute`
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
    : freshMs
      ? "bg-[#0cce6b] animate-pulse"
      : "bg-[#666]";
  const label = !freshMs
    ? "sync ?"
    : delayed
      ? "sync delayed"
      : secsLeft != null && secsLeft > 0
        ? `next ${formatCountdown(secsLeft)}`
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
