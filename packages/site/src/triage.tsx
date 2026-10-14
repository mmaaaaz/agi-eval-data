import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ThumbImage } from "./ThumbImage";
import { useData } from "./dataContext";
import { questionsApi } from "./questions";
import type { AskSettings } from "./settings";
import { bandQuotas, orderByScarcity } from "./triageOrder";
import type { Row } from "./data";

/**
 * Gallery triage: choosing which images enter the benchmark.
 *
 * The design rule is that a decision must cost about three seconds. So: one
 * keypress, automatic advance, the next images preloaded, and undo that actually
 * restores "undecided" rather than flipping a flag.
 *
 * The corpus is badly skewed: MEASURED on the ledger, 68.1% of all images and 73.7% of
 * the releasable ones have a LONG EDGE of exactly 1568 px.
 *
 * Long edge, not width. I briefly "corrected" this to 34% after counting rows where
 * width == 1568 — which silently excludes every portrait image stored 1045x1568. The
 * original 68% was right and my correction was the error; the two agree exactly once the
 * comparison is like for like (68.1% both ways).
 *
 * So the queue is STEERED by band scarcity — see triageOrder.ts. It used to display
 * quota progress and filter only by contributor, which meant the rare bands were still
 * lost to random choice: a progress bar that shows you are ignoring the scarce images is
 * not steering. Steering can be switched off.
 */

export interface TriageSite {
  loadSettings: () => AskSettings;
  saveSettings?: (s: AskSettings) => void;
}

type SelState = "proposed" | "nominated" | "chosen" | "excluded";
interface Sel { file_id: string; state: SelState; reason?: string }

const TARGET = 2500;
const RARE_FLOOR = 25;

function bandOf(mp: number | null): string {
  if (mp === null) return "unknown";
  if (mp < 1) return "<1 MP";
  if (mp < 4) return "1-4 MP";
  if (mp < 12) return "4-12 MP";
  if (mp < 24) return "12-24 MP";
  return "24+ MP";
}

export function GalleryTriage({ site }: { site: TriageSite }) {
  const { data } = useData();
  const [settings] = useState<AskSettings>(() => site.loadSettings());
  const [sels, setSels] = useState<Record<string, SelState>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [i, setI] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [excludeOpen, setExcludeOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [reasons, setReasons] = useState<string[]>([]);
  const [undecidedOnly, setUndecidedOnly] = useState(true);
  // Default ON: the scarce bands are the ones a triager will otherwise never reach.
  const [steer, setSteer] = useState(true);
  const [who, setWho] = useState("");
  const [busy, setBusy] = useState(false);
  const undoRef = useRef<{ fileId: string; prev: SelState | null }[]>([]);

  const relay = settings.relay.replace(/\/+$/, "");
  const code = settings.accessCode;

  /* ---------------- corpus, filtered deterministically ---------------- */
  const images = useMemo(() => {
    const rows = (data?.files ?? []) as readonly Row[];
    return rows.filter((r) => r[7] === "i");
  }, [data]);

  // file_id -> resolution band, computed once. Deliberately NOT a module-level
  // map: a shared mutable global would leak across mounts and go stale.
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

  const queue = useMemo(() => {
    let list = images;
    if (who) list = list.filter((r) => r[5] === who);
    if (undecidedOnly) list = list.filter((r) => !sels[r[0]]);
    if (!steer) return list;
    // Rarest band first. Stable and corpus-only, so the queue cannot reshuffle under the
    // triager's hand as decisions accumulate.
    return orderByScarcity(list, {
      idOf: (r) => r[0],
      bandOf: (id) => bandMap.get(id) ?? "unknown",
      counts: bands,
    });
  }, [images, sels, undecidedOnly, who, steer, bandMap, bands]);

  const current = queue[Math.min(i, Math.max(queue.length - 1, 0))];
  const currentBand = current ? bandMap.get(current[0]) ?? "unknown" : "unknown";

  const chosenCount = useMemo(
    () => Object.values(sels).filter((s) => s === "chosen").length,
    [sels],
  );
  // Reachable quotas, plus an honest report of a pool that is too small.
  //
  // The old formula scaled TARGET onto the pool proportionally with a floor, so a
  // 600-image pool against a 2,500 target asked EVERY band for ~4x what it contained:
  // 1-4 MP wanted 1,808 of 434, and the rare bands 104 of 25. A triager who chose every
  // single image still saw every band under quota. A quota you cannot reach is not a
  // goal, it is a bug — so the target is capped by what exists, and the shortfall is
  // reported rather than capped away.
  const quotaPlan = useMemo(() => bandQuotas(bands, TARGET, RARE_FLOOR), [bands]);
  const chosenByBand = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [fid, st] of Object.entries(sels)) {
      if (st !== "chosen") continue;
      const b = bandMap.get(fid);
      if (b) out[b] = (out[b] ?? 0) + 1;
    }
    return out;
  }, [sels, bandMap]);

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
  const decide = useCallback(async (state: SelState, why = "") => {
    if (!current || busy) return;
    const fileId = current[0];
    const prev = sels[fileId] ?? null;
    setBusy(true);
    // optimistic: advance immediately, the write is one row
    setSels((s) => ({ ...s, [fileId]: state }));
    undoRef.current.push({ fileId, prev });
    setI((n) => n + 1);
    setExcludeOpen(false);
    setReason("");
    try {
      await questionsApi.select(relay, code, { file_id: fileId, state, reason: why });
      if (why) setReasons((r) => (r.includes(why) ? r : [why, ...r].slice(0, 6)));
    } catch (e) {
      // roll back rather than leaving the screen lying about what is recorded
      setSels((s) => {
        const copy = { ...s };
        if (prev) copy[fileId] = prev; else delete copy[fileId];
        return copy;
      });
      undoRef.current.pop();
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [current, busy, sels, relay, code]);

  const undo = useCallback(async () => {
    const last = undoRef.current.pop();
    if (!last) { toast.error("nothing to undo"); return; }
    setSels((s) => {
      const copy = { ...s };
      if (last.prev) copy[last.fileId] = last.prev; else delete copy[last.fileId];
      return copy;
    });
    setI((n) => Math.max(0, n - 1));
    try {
      if (last.prev) await questionsApi.select(relay, code, { file_id: last.fileId, state: last.prev });
      else await questionsApi.unselect(relay, code, last.fileId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [relay, code]);

  /* ---------------- keyboard ---------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (excludeOpen && e.key !== "Escape") return;
      switch (e.key) {
        case "1": void decide("nominated"); break;
        case "2": void decide("chosen"); break;
        case "3": setExcludeOpen(true); break;
        case "z": void undo(); break;
        case " ": e.preventDefault(); setZoom((v) => !v); break;
        case "ArrowRight": setI((n) => n + 1); break;
        case "ArrowLeft": setI((n) => Math.max(0, n - 1)); break;
        case "Escape": setExcludeOpen(false); setZoom(false); break;
        default: break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide, undo, excludeOpen]);

  if (!loaded) {
    return <p className="font-mono text-[11px] text-[#666]">loading selections…</p>;
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Choose images</h1>
          <p className="mt-1 font-mono text-[11px] text-[#666]">
            {chosenCount} chosen of {TARGET} · {queue.length} left in this filter
          </p>
        </div>
        <label className="flex items-center gap-2 font-mono text-[10px] text-[#a1a1a1]">
          <input type="checkbox" checked={undecidedOnly} onChange={(e) => { setUndecidedOnly(e.target.checked); setI(0); }} />
          undecided only
        </label>
        <label
          className="flex items-center gap-2 font-mono text-[10px] text-[#a1a1a1]"
          title="rarest resolution band first, so the scarce images are not lost to random choice"
        >
          <input type="checkbox" checked={steer} onChange={(e) => { setSteer(e.target.checked); setI(0); }} />
          steer to rare bands
        </label>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-danger/40 bg-danger/10 p-3 font-mono text-[11px] text-danger">
          {error}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
        <div>
          {!current ? (
            <p className="rounded-lg border border-[#262626] bg-[#0a0a0a]/60 p-6 font-mono text-[11px] text-[#a1a1a1]">
              Nothing left in this filter. Turn off "undecided only" to look again, or the
              corpus is exhausted.
            </p>
          ) : (
            <>
              <div className="relative overflow-hidden rounded-lg border border-[#262626] bg-[#050505]">
                <ThumbImage fileId={current[0]} w={1600} alt={current[1]} eager className="max-h-[62vh] w-full" />
                {sels[current[0]] && (
                  <span className="absolute left-3 top-3 rounded-full border border-accent/60 bg-black/70 px-2.5 py-1 font-mono text-[10px] text-accent">
                    {sels[current[0]]}
                  </span>
                )}
              </div>
              <p className="mt-2 truncate font-mono text-[10px] text-[#666]">
                {current[1]} · {currentBand} · {current[2]}
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button onClick={() => void decide("nominated")} disabled={busy} className="rounded-md border border-[#262626] px-3 py-1.5 font-mono text-[10px] text-[#a1a1a1] transition-colors hover:border-accent hover:text-accent disabled:opacity-30">1 · nominate</button>
                <button onClick={() => void decide("chosen")} disabled={busy} className="rounded-md border border-[#0cce6b]/60 px-3 py-1.5 font-mono text-[10px] text-[#0cce6b] transition-colors hover:bg-[#0cce6b] hover:text-black disabled:opacity-30">2 · choose</button>
                <button onClick={() => setExcludeOpen(true)} disabled={busy} className="rounded-md border border-danger/60 px-3 py-1.5 font-mono text-[10px] text-danger transition-colors hover:bg-danger hover:text-white disabled:opacity-30">3 · exclude</button>
                <button onClick={() => void undo()} className="rounded-md border border-[#262626] px-3 py-1.5 font-mono text-[10px] text-[#a1a1a1] transition-colors hover:border-accent hover:text-accent">z · undo</button>
                <span className="font-mono text-[10px] text-[#555]">← → move · space zoom</span>
              </div>

              {excludeOpen && (
                <div className="mt-3 space-y-2 rounded-md border border-danger/40 bg-[#050505] p-3">
                  <span className="block font-mono text-[10px] uppercase tracking-wider text-[#666]">
                    why exclude? the reason is the evidence a person looked
                  </span>
                  <input
                    autoFocus
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="private moment, unreadable, gallery screenshot…"
                    className="w-full rounded-md border border-[#262626] bg-[#0a0a0a] px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none focus:border-accent"
                  />
                  {reasons.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {reasons.map((r) => (
                        <button key={r} onClick={() => setReason(r)} className="rounded-full border border-[#262626] px-2 py-0.5 font-mono text-[9px] text-[#a1a1a1] hover:border-accent hover:text-accent">{r}</button>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => void decide("excluded", reason.trim())}
                      disabled={!reason.trim()}
                      className="rounded-md bg-white px-3 py-1.5 font-mono text-[10px] font-semibold text-black disabled:opacity-30"
                    >
                      exclude it
                    </button>
                    <button onClick={() => { setExcludeOpen(false); setReason(""); }} className="rounded-md border border-[#262626] px-3 py-1.5 font-mono text-[10px] text-[#a1a1a1]">cancel</button>
                  </div>
                </div>
              )}

              {/* preload the next two so navigation never shows a spinner */}
              <div className="pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0">
                {[1, 2].map((d) => {
                  const nxt = queue[i + d];
                  return nxt ? <ThumbImage key={nxt[0]} fileId={nxt[0]} w={1600} alt="" /> : null;
                })}
              </div>
            </>
          )}
        </div>

        <aside className="rounded-lg border border-[#262626] bg-[#0a0a0a]/40 p-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-[#666]">quota by resolution</p>
          <p className="mt-1 font-mono text-[9px] leading-4 text-[#555]">
            the corpus is skewed; without steering, the rare bands are lost to random choice
          </p>
          {quotaPlan.poolTooSmall && (
            <p className="mt-2 rounded-md border border-[#f59e0b]/40 bg-[#f59e0b]/5 p-2 font-mono text-[9px] leading-4 text-[#f59e0b]">
              {images.length} candidates for a {TARGET}-image target
              {quotaPlan.shortfall > 0 ? " — " + quotaPlan.shortfall + " short" : ""}.
              The quotas below are capped at what exists, so they can be met; the shortfall
              is in the selection, not in your work. Re-run stage 01 with a larger
              --target to fix it.
            </p>
          )}
          <div className="mt-3 space-y-2">
            {quotaPlan.quotas.map((q) => {
              const have = chosenByBand[q.band] ?? 0;
              const pct = Math.min(100, Math.round((have / q.target) * 100));
              const behind = have < q.target * 0.5;
              return (
                <div key={q.band}>
                  <div className="flex justify-between font-mono text-[10px]">
                    <span className={behind ? "text-[#f59e0b]" : "text-[#a1a1a1]"}>{q.band}</span>
                    <span className="text-[#ededed]">{have} / {q.target}</span>
                  </div>
                  <div className="mt-1 h-1 w-full rounded-full bg-[#1a1a1a]">
                    <div className="h-1 rounded-full bg-accent" style={{ width: pct + "%" }} />
                  </div>
                  <div className="mt-0.5 font-mono text-[9px] text-[#555]">{q.have.toLocaleString()} in corpus</div>
                </div>
              );
            })}
          </div>
          <label className="mt-4 block">
            <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-[#666]">one contributor</span>
            <select value={who} onChange={(e) => { setWho(e.target.value); setI(0); }} className="w-full rounded-md border border-[#262626] bg-[#050505] px-2 py-1.5 font-mono text-[11px] text-[#ededed] outline-none focus:border-accent">
              <option value="">everyone</option>
              {Object.keys(data?.owners ?? {}).map((email) => (
                <option key={email} value={email}>{data?.owners?.[email] ?? email}</option>
              ))}
            </select>
          </label>
        </aside>
      </div>

      {zoom && current && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" onClick={() => setZoom(false)}>
          <img
            src={"https://lh3.googleusercontent.com/d/" + current[0] + "=w1600"}
            alt={current[1]}
            className="max-h-full max-w-full object-contain"
          />
        </div>
      )}
    </div>
  );
}

