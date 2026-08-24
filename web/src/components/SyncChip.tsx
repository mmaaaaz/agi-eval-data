import { useEffect, useState } from "react";
import type { Latest } from "../lib/types";
import { nextSlotAfter, timeAgo } from "../lib/format";

const REPO = import.meta.env.VITE_REPO ?? "mmaaaaz/agi-eval-data";
const STALE_AFTER_MIN = 90;

interface RunState {
  status: string;
  startedAt: string;
}

/**
 * Sync status chip. Countdown anchors to the LAST ACTUAL run start from the
 * GitHub Actions API (public repo → unauthenticated), because GitHub's cron
 * drifts by minutes and "next top of hour" would lie. Falls back to the pure
 * cron estimate if the API is unreachable.
 */
export function SyncChip({ meta }: { meta: Latest["meta"] }) {
  const [, tick] = useState(0);
  const [run, setRun] = useState<RunState | null>(null);
  const [apiUp, setApiUp] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`https://api.github.com/repos/${REPO}/actions/runs?per_page=1`);
        if (!res.ok) throw new Error(String(res.status));
        const j = (await res.json()) as {
          workflow_runs?: { status: string; run_started_at?: string; created_at: string }[];
        };
        const r = j.workflow_runs?.[0];
        if (alive && r) {
          setRun({ status: r.status, startedAt: r.run_started_at ?? r.created_at });
          setApiUp(true);
        }
      } catch {
        if (alive) setApiUp(false);
      }
    };
    void load();
    const t = setInterval(load, 300_000); // every 5 min — 60/hr anon limit is plenty
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const now = Date.now();
  const anchor = run ? Date.parse(run.startedAt) : Date.parse(meta.scannedAt);
  const minsSince = Math.round((now - anchor) / 60000);
  const stale = minsSince > STALE_AFTER_MIN;
  const syncing = run ? run.status !== "completed" : false;

  const next = syncing ? null : nextSlotAfter(meta.cron, new Date(Math.max(now, anchor)));
  const secsLeft = next ? Math.max(0, Math.floor((next.getTime() - now) / 1000)) : 0;
  const hh = Math.floor(secsLeft / 3600);
  const mm = String(Math.floor((secsLeft % 3600) / 60)).padStart(2, "0");
  const ss = String(secsLeft % 60).padStart(2, "0");

  const dot = syncing
    ? "bg-accent animate-pulse"
    : stale
      ? "bg-danger"
      : "bg-[#0cce6b] animate-pulse";
  const stateText = syncing
    ? "syncing now…"
    : `synced ${timeAgo(new Date(anchor).toISOString())}`;

  return (
    <div
      className="flex items-center gap-2 font-mono text-[11px] text-[#a1a1a1]"
      title={`last run ${run?.startedAt ?? meta.scannedAt} · schedule "${meta.cron}"${apiUp ? "" : " · GitHub API unreachable, showing estimate"}`}
    >
      <span className={`inline-block h-[6px] w-[6px] rounded-full ${dot}`} />
      <span>{stateText}</span>
      {!syncing && (
        <>
          <span className="text-[#666]">·</span>
          <span>
            next ~{hh > 0 ? `${hh}h ` : ""}
            {mm}:{ss}
          </span>
        </>
      )}
      {stale && !syncing && <span className="rounded bg-danger/10 px-1.5 py-0.5 text-danger">STALE</span>}
    </div>
  );
}
