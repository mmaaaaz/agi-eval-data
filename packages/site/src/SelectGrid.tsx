import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { ThumbImage } from "./ThumbImage";
import { VirtualGallery } from "./VirtualGallery";
import { useData } from "./dataContext";
import { questionsApi } from "./questions";
import type { AskSettings } from "./settings";
import { orderByScarcity } from "./triageOrder";
import type { Row } from "./data";

/**
 * Select — the grid door of the benchmark.
 *
 * Deciding an image must cost one click, not a keyboard ritual: the queue is a
 * scannable grid of undecided photographs, every card carries its own actions
 * (select / maybe / exclude), and a decided image simply leaves the pool.
 * Selection state and the API are the same as the keyboard triage — the two
 * screens are views of one system, not two systems.
 *
 * Targets come from the 2026-10-16 decision: a 2,000-image test split, of which
 * 500 receive fully human-written questions (the manual core) and the remainder
 * come from generated questions a person has reviewed.
 */

export interface SelectSite {
  loadSettings: () => AskSettings;
  saveSettings?: (s: AskSettings) => void;
}

type SelState = "proposed" | "nominated" | "chosen" | "excluded";
interface Sel { file_id: string; state: SelState; reason?: string }

const MANUAL_TARGET = 500;
const SPLIT_TARGET = 2000;

function bandOf(mp: number | null): string {
  if (mp === null) return "unknown";
  if (mp < 1) return "<1 MP";
  if (mp < 4) return "1-4 MP";
  if (mp < 12) return "4-12 MP";
  if (mp < 24) return "12-24 MP";
  return "24+ MP";
}

function Bar({ n, target, label }: { n: number; target: number; label: string }) {
  const pct = Math.min(100, Math.round((n / target) * 100));
  return (
    <div className="w-36">
      <div className="flex items-baseline justify-between font-mono text-[9px] text-[#666]">
        <span>{label}</span>
        <span className="tabular-nums">{n}/{target}</span>
      </div>
      <div className="mt-1 h-[3px] w-full overflow-hidden rounded bg-[#1a1a1a]">
        <div className="h-full rounded bg-accent transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function SelectGrid({ site }: { site: SelectSite }) {
  const { data } = useData();
  const [settings] = useState<AskSettings>(() => site.loadSettings());
  const [sels, setSels] = useState<Record<string, SelState>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [undecidedOnly, setUndecidedOnly] = useState(true);
  const [steer, setSteer] = useState(true);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [zoomRow, setZoomRow] = useState<Row | null>(null);
  const [excludeFor, setExcludeFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [reasons, setReasons] = useState<string[]>([]);
  const undoRef = useRef<{ fileId: string; prev: SelState | null }[]>([]);

  const relay = settings.relay.replace(/\/+$/, "");
  const code = settings.accessCode;

  /* ---------------- corpus ---------------- */
  const images = useMemo(() => {
    const rows = (data?.files ?? []) as readonly Row[];
    return rows.filter((r) => r[7] === "i");
  }, [data]);

  const bandMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of images) {
      const ex = data?.exif?.[r[0]];
      const mp = ex && ex[0] && ex[1] ? (ex[0] * ex[1]) / 1e6 : null;
      m.set(r[0], bandOf(mp));
    }
    return m;
  }, [images, data]);

  const bands = useMemo(() => {
    const out: Record<string, number> = {};
    for (const b of bandMap.values()) out[b] = (out[b] ?? 0) + 1;
    return out;
  }, [bandMap]);

  const pool = useMemo(() => {
    let list = images as readonly Row[];
    if (undecidedOnly) list = list.filter((r) => !sels[r[0]]);
    if (!steer) return list;
    return orderByScarcity(list as Row[], {
      idOf: (r) => r[0],
      bandOf: (id) => bandMap.get(id) ?? "unknown",
      counts: bands,
    });
  }, [images, sels, undecidedOnly, steer, bandMap, bands]);

  const chosen = useMemo(() => Object.values(sels).filter((s) => s === "chosen").length, [sels]);
  const maybe = useMemo(() => Object.values(sels).filter((s) => s === "nominated").length, [sels]);

  /* ---------------- selections from the API ---------------- */
  const loadSelections = useCallback(async () => {
    setError("");
    try {
      const r = await questionsApi.selections(relay, undefined, 20000);
      const next: Record<string, SelState> = {};
      for (const s of r.selections as unknown as Sel[]) next[s.file_id] = s.state;
      setSels(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  }, [relay]);

  useEffect(() => { void loadSelections(); }, [loadSelections]);

  /* ---------------- decisions ---------------- */
  const decide = useCallback(async (fileId: string, state: SelState, why = "") => {
    if (busyIds.has(fileId)) return;
    const prev = sels[fileId] ?? null;
    setBusyIds((s) => new Set(s).add(fileId));
    setSels((s) => ({ ...s, [fileId]: state }));
    undoRef.current.push({ fileId, prev });
    if (why) setReasons((r) => (r.includes(why) ? r : [why, ...r].slice(0, 6)));
    try {
      await questionsApi.select(relay, code, { file_id: fileId, state, reason: why });
    } catch (e) {
      setSels((s) => {
        const copy = { ...s };
        if (prev) copy[fileId] = prev; else delete copy[fileId];
        return copy;
      });
      undoRef.current.pop();
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyIds((s) => {
        const copy = new Set(s);
        copy.delete(fileId);
        return copy;
      });
    }
  }, [busyIds, sels, relay, code]);

  const undo = useCallback(async () => {
    const last = undoRef.current.pop();
    if (!last) { toast.error("nothing to undo"); return; }
    setSels((s) => {
      const copy = { ...s };
      if (last.prev) copy[last.fileId] = last.prev; else delete copy[last.fileId];
      return copy;
    });
    try {
      if (last.prev) await questionsApi.select(relay, code, { file_id: last.fileId, state: last.prev });
      else await questionsApi.unselect(relay, code, last.fileId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [relay, code]);

  // Escape closes whichever overlay is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setZoomRow(null); setExcludeFor(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const confirmExclude = useCallback(async () => {
    if (!excludeFor || !reason.trim()) return;
    const fileId = excludeFor;
    setExcludeFor(null);
    setZoomRow(null);
    setReason("");
    await decide(fileId, "excluded", reason.trim());
  }, [excludeFor, reason, decide]);

  const renderTile = useCallback((r: Row, _idx: number, size: { colW: number; imgH: number }): ReactNode => (
    <div>
      <button
        onClick={() => setZoomRow(r)}
        className="block w-full cursor-zoom-in"
        title="open larger"
        style={{ height: size.imgH }}
      >
        <ThumbImage
          fileId={r[0]}
          alt={r[1]}
          className="h-full w-full rounded-md border border-[#262626] transition-colors hover:border-[#404040]"
        />
      </button>
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-[#666]" title={r[1]}>{r[1]}</span>
        <span className="shrink-0 font-mono text-[9px] text-[#555]">{bandMap.get(r[0]) ?? ""}</span>
      </div>
      <div className="mt-1 flex gap-1">
        <button
          onClick={() => void decide(r[0], "chosen")}
          disabled={busyIds.has(r[0])}
          className="flex-1 rounded border border-[#0cce6b]/60 px-1.5 py-1 font-mono text-[9px] text-[#0cce6b] transition-colors hover:bg-[#0cce6b] hover:text-black disabled:opacity-30"
          title="select — into the benchmark"
        >
          ✓ select
        </button>
        <button
          onClick={() => void decide(r[0], "nominated")}
          disabled={busyIds.has(r[0])}
          className="flex-1 rounded border border-[#262626] px-1.5 py-1 font-mono text-[9px] text-[#a1a1a1] transition-colors hover:border-accent hover:text-accent disabled:opacity-30"
          title="maybe — flag for a second look"
        >
          ~ maybe
        </button>
        <button
          onClick={() => setExcludeFor(r[0])}
          disabled={busyIds.has(r[0])}
          className="flex-1 rounded border border-danger/60 px-1.5 py-1 font-mono text-[9px] text-danger transition-colors hover:bg-danger hover:text-white disabled:opacity-30"
          title="exclude — never use this image (reason required)"
        >
          ✕
        </button>
      </div>
    </div>
  ), [bandMap, busyIds, decide]);

  if (!loaded) {
    return <p className="font-mono text-[11px] text-[#666]">loading selections…</p>;
  }

  return (
    <div className="flex h-[calc(100dvh-22rem)] min-h-[420px] flex-col md:h-[calc(100dvh-16rem)]">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Select images</h1>
          <p className="mt-1 font-mono text-[11px] text-[#666]">
            {chosen} selected · {maybe} maybe · {pool.length} undecided in this filter
          </p>
          <p className="mt-1 font-mono text-[10px] text-[#555]">
            one click decides · select → into the benchmark · maybe → flag for a second look · ✕ → never
            (a reason is required) · every decision is recorded under your name
          </p>
        </div>
        <div className="flex items-center gap-5">
          <Bar n={chosen} target={MANUAL_TARGET} label="manual core" />
          <Bar n={chosen} target={SPLIT_TARGET} label="test split" />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        <label className="flex items-center gap-2 font-mono text-[10px] text-[#a1a1a1]">
          <input type="checkbox" checked={undecidedOnly} onChange={(e) => setUndecidedOnly(e.target.checked)} />
          undecided only
        </label>
        <label
          className="flex items-center gap-2 font-mono text-[10px] text-[#a1a1a1]"
          title="rarest resolution band first, so the scarce images are not lost to random choice"
        >
          <input type="checkbox" checked={steer} onChange={(e) => setSteer(e.target.checked)} />
          steer to rare bands
        </label>
        <button
          onClick={() => void undo()}
          className="rounded-md border border-[#262626] px-3 py-1 font-mono text-[10px] text-[#a1a1a1] transition-colors hover:border-accent hover:text-accent"
        >
          z · undo last
        </button>
        <span className="flex-1" />
        <Link to="/contribute/triage" className="font-mono text-[10px] text-[#666] transition-colors hover:text-accent">
          keyboard triage ↗
        </Link>
        <Link to="/contribute/rules" className="font-mono text-[10px] text-[#666] transition-colors hover:text-accent">
          what are these questions for? →
        </Link>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-danger/40 bg-danger/10 p-3 font-mono text-[11px] text-danger">
          {error}{" "}
          <button onClick={() => void loadSelections()} className="underline">
            retry
          </button>
        </p>
      )}

      <VirtualGallery rows={pool as Row[]} dupSet={new Set<string>()} onOpen={() => {}} renderTile={renderTile} />

      {pool.length === 0 && !error && undecidedOnly && (
        <p className="mt-4 rounded-lg border border-[#262626] bg-[#0a0a0a]/60 p-6 font-mono text-[11px] text-[#a1a1a1]">
          Nothing left undecided in this filter. Turn off “undecided only” to review earlier decisions,
          or wait — new photographs arrive with the daily sync.
        </p>
      )}

      {zoomRow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setZoomRow(null)}
        >
          <div
            className="w-full max-w-4xl rounded-lg border border-[#262626] bg-[#050505] p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <ThumbImage fileId={zoomRow[0]} w={1600} alt={zoomRow[1]} eager fit="contain" className="h-[70vh] w-full rounded-md" />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-[#666]">
                {zoomRow[1]} · {bandMap.get(zoomRow[0]) ?? "unknown band"}
              </span>
              <button
                onClick={() => { void decide(zoomRow[0], "chosen"); setZoomRow(null); }}
                className="rounded-md border border-[#0cce6b]/60 px-3 py-1.5 font-mono text-[10px] text-[#0cce6b] transition-colors hover:bg-[#0cce6b] hover:text-black"
              >
                ✓ select
              </button>
              <button
                onClick={() => { void decide(zoomRow[0], "nominated"); setZoomRow(null); }}
                className="rounded-md border border-[#262626] px-3 py-1.5 font-mono text-[10px] text-[#a1a1a1] transition-colors hover:border-accent hover:text-accent"
              >
                ~ maybe
              </button>
              <button
                onClick={() => { setExcludeFor(zoomRow[0]); setZoomRow(null); }}
                className="rounded-md border border-danger/60 px-3 py-1.5 font-mono text-[10px] text-danger transition-colors hover:bg-danger hover:text-white"
              >
                ✕ exclude
              </button>
              <button
                onClick={() => setZoomRow(null)}
                className="rounded-md border border-[#262626] px-3 py-1.5 font-mono text-[10px] text-[#666] transition-colors hover:text-white"
              >
                close
              </button>
            </div>
          </div>
        </div>
      )}

      {excludeFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setExcludeFor(null)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-danger/40 bg-[#050505] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="block font-mono text-[10px] uppercase tracking-wider text-[#666]">
              why exclude? the reason is the evidence a person looked
            </span>
            <input
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void confirmExclude(); }}
              placeholder="private moment, unreadable, gallery screenshot…"
              className="mt-2 w-full rounded-md border border-[#262626] bg-[#0a0a0a] px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none focus:border-accent"
            />
            {reasons.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {reasons.map((r) => (
                  <button
                    key={r}
                    onClick={() => setReason(r)}
                    className="rounded-full border border-[#262626] px-2 py-0.5 font-mono text-[9px] text-[#a1a1a1] hover:border-accent hover:text-accent"
                  >
                    {r}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setExcludeFor(null)}
                className="rounded-md border border-[#262626] px-3 py-1.5 font-mono text-[10px] text-[#666] transition-colors hover:text-white"
              >
                cancel
              </button>
              <button
                onClick={() => void confirmExclude()}
                disabled={!reason.trim()}
                className="rounded-md bg-white px-3 py-1.5 font-mono text-[10px] font-semibold text-black disabled:opacity-30"
              >
                exclude it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
