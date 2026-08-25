import { useEffect, useState } from "react";
import type { Latest } from "../lib/types";
import { timeAgo } from "../lib/format";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const REPO = import.meta.env.VITE_REPO ?? "mmaaaaz/agi-eval-data";
const ARTIFACT = `https://raw.githubusercontent.com/${REPO}/main/data/latest.json`;
const INTERVAL_MIN = 10;
const DELAYED_AFTER_MIN = 30;

/**
 * Sync pill v2 — countdown to the next 10-min scan; the moment a newer
 * artifact is detected (visibility-aware 60s Range-poll, ~300 bytes) it
 * flips to a hard-refresh button. No GitHub API, no stale tabs.
 */
export function SyncChip({ meta }: { meta: Latest["meta"] }) {
  const [now, setNow] = useState(() => Date.now());
  const [update, setUpdate] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const scannedAtMs = Date.parse(
    meta.scannedAt.endsWith("Z") ? meta.scannedAt : `${meta.scannedAt}Z`,
  );

  // 1s tick for the countdown
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // 60s poll for a newer artifact — visible tabs only
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`${ARTIFACT}?t=${Date.now()}`, {
          headers: { Range: "bytes=0-300" },
        });
        const text = await res.text();
        const latest = text.match(/"scannedAt":"([^"]+)"/)?.[1];
        if (!latest) throw new Error("no scannedAt");
        if (!cancelled) {
          setCheckFailed(false);
          if (latest !== meta.scannedAt) setUpdate(true);
        }
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
  }, [meta.scannedAt]);

  const nextAt = scannedAtMs + INTERVAL_MIN * 60_000;
  const secsLeft = Math.max(0, Math.floor((nextAt - now) / 1000));
  const mm = String(Math.floor(secsLeft / 60)).padStart(2, "0");
  const ss = String(secsLeft % 60).padStart(2, "0");
  const minsSince = Math.floor((now - scannedAtMs) / 60000);
  const delayed = minsSince > DELAYED_AFTER_MIN && !update;

  const tooltip = `last scan ${timeAgo(new Date(scannedAtMs).toISOString())} · auto-checks every minute · cron ${meta.cron}`;

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
        <TooltipContent>a newer scan is available — reload to load it</TooltipContent>
      </Tooltip>
    );
  }

  const dot = delayed
    ? "bg-danger"
    : secsLeft > 0
      ? "bg-[#0cce6b] animate-pulse"
      : "bg-accent animate-pulse";
  const label = delayed ? "sync delayed" : secsLeft > 0 ? `next ${mm}:${ss}` : "syncing…";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1.5 rounded-md border border-[#262626] px-2.5 py-1 font-mono text-[10px] tabular-nums text-[#a1a1a1]">
          <span className={`h-[6px] w-[6px] rounded-full ${dot}`} />
          {label}
        </div>
      </TooltipTrigger>
      <TooltipContent>{checkFailed ? `${tooltip} · check failed, retrying` : tooltip}</TooltipContent>
    </Tooltip>
  );
}
