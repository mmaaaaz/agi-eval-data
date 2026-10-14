import { useEffect, useRef, useState } from "react";
import { questionsApi, type QRow } from "./questions";

/**
 * Live sync, without polling the item table.
 *
 * The cost rule is the whole design: D1 bills rows READ, and a naive
 * `SELECT * FROM questions` on every poll is a full scan — roughly three orders of
 * magnitude over the free daily allowance at fifteen editors. So a poll reads ONE
 * indexed row (the cursor) and only fetches a delta when the cursor has actually
 * moved. An idle tab costs one row per poll and nothing else.
 *
 * Polling stops when the tab is hidden, because a background tab polling fifteen
 * times a minute is pure waste, and resumes with an immediate sync so the screen is
 * never stale when the person looks back at it.
 */


/**
 * What a single poll should do. Pure, so the COST RULE is verifiable rather than asserted in
 * a comment.
 *
 * Why this is a separate function: the file's whole reason for existing is that a naive poll
 * is a full table scan. "An idle tab costs one row per poll and nothing else" is a claim about
 * three branches — do not poll when hidden, do not re-fetch when the cursor has not moved, do
 * not replay the log on first contact — and none of them could be tested from inside a
 * useEffect closure. Extracting them makes the claim checkable.
 *
 *   "skip"   no network at all
 *   "record" read the cursor and remember it WITHOUT fetching a delta (first contact)
 *   "fetch"  the cursor moved, so pull the delta
 */
export type PollAction = "skip" | "record" | "fetch";

export function decidePoll(state: {
  visible: boolean;
  inFlight: boolean;
  known: boolean;
  head: number;
  current: number | null;
}): PollAction {
  // A hidden tab must not poll. Fifteen editors with a background tab open is the workload
  // this exists to avoid.
  if (!state.visible) return "skip";
  if (state.inFlight) return "skip";
  // First contact RECORDS where we are. Fetching here would replay the entire change log to
  // a client that has never seen any of it, which is the expensive mistake.
  if (!state.known) return "record";
  if (state.head > (state.current ?? 0)) return "fetch";
  return "skip";
}

export interface Delta {
  cursor: number;
  questions: QRow[];
  selections: Record<string, unknown>[];
  n_changes: number;
}

export interface LiveSyncState {
  cursor: number;
  lastSyncAt: number | null;
  paused: boolean;
}

export function useLiveSync(opts: {
  relay: string;
  onDelta: (d: Delta) => void;
  intervalMs?: number;
  enabled?: boolean;
}): LiveSyncState {
  const { relay, onDelta, intervalMs = 15000, enabled = true } = opts;

  const cursorRef = useRef<number | null>(null);
  const inFlight = useRef(false);
  const cbRef = useRef(onDelta);
  cbRef.current = onDelta;

  const [cursor, setCursor] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: number | undefined;

    const tick = async () => {
      if (stopped) return;
      const visible = typeof document === "undefined" || document.visibilityState === "visible";
      // The cursor has to be READ before we can decide, so a hidden or in-flight tick is
      // filtered here rather than after a wasted request.
      if (!visible || inFlight.current) return;
      inFlight.current = true;
      try {
        const head = await questionsApi.cursor(relay);
        const action = decidePoll({
          visible,
          inFlight: false,
          known: cursorRef.current !== null,
          head: head.seq,
          current: cursorRef.current,
        });
        if (action === "record") {
          cursorRef.current = head.seq;
          setCursor(head.seq);
        } else if (action === "fetch") {
          const d = await questionsApi.changes(relay, cursorRef.current as number);
          cursorRef.current = d.cursor;
          setCursor(d.cursor);
          cbRef.current(d as Delta);
        }
        setLastSyncAt(Date.now());
      } catch {
        // A failed poll is not something to interrupt someone with. The next tick
        // retries, and a stale screen corrects itself within one interval.
      } finally {
        inFlight.current = false;
      }
    };

    const start = () => {
      if (timer === undefined) timer = window.setInterval(() => { void tick(); }, intervalMs);
    };
    const stop = () => {
      if (timer !== undefined) { window.clearInterval(timer); timer = undefined; }
    };

    const onVisibility = () => {
      const hidden = typeof document !== "undefined" && document.visibilityState !== "visible";
      setPaused(hidden);
      if (hidden) stop();
      else { void tick(); start(); }
    };

    void tick();
    start();
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stopped = true;
      stop();
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [relay, intervalMs, enabled]);

  return { cursor, lastSyncAt, paused };
}
