import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ThumbImage } from "./ThumbImage";
import { getActor } from "./questions";
import type { AskSettings } from "./settings";

/**
 * The dataset explorer and review room, static-first.
 *
 * Every read is a static file on Cloudflare Pages: the per-page candidate
 * payloads, a 50k-row image index, the taxonomy matrix, the search index and the
 * decisions snapshot. Nothing here queries D1 to render, so traffic cannot cross
 * the free tier. A decision is the only write, one row keyed by a stable candidate
 * id; `sync_vqa_decisions` republishes those as static JSON for everyone else.
 *
 * The grid is windowed with @tanstack/react-virtual: 50,000 images are a scroll,
 * not 50,000 DOM nodes. Filters and grouping run in memory over the index that was
 * fetched once.
 */

export interface VqaReviewSite {
  loadSettings: () => AskSettings;
  saveSettings?: (s: AskSettings) => void;
}

interface Cand {
  id: string; question: string; choices: string[]; answer: string; grounding: string;
  capability: string; level: string; domain: string; difficulty: string;
  model: string; endpoint: string; prompt_version: string;
}
interface PageData { page: number; images: { file_id: string; candidates: Cand[] }[] }
interface PageMeta { p: number; file: string; images: number; first: string; last: string }
interface Index {
  generated_at: string; batch: string; images: number; candidates: number; pages: PageMeta[]; searchParts?: number;
  byCapability: Record<string, number>; byLevel: Record<string, number>; byDomain: Record<string, number>;
}
interface ImgRow { f: string; p: number; d: string; c: string[]; l: string[]; n: number }
interface Decision { id: string; verdict: "approve" | "edit" | "reject"; reason: string; reviewer: string }
interface Hit { id: string; f: string; q: string; c: string; l: string; d: string }

type Item = { kind: "head"; key: string; label: string; count: number } | { kind: "row"; key: string; row: ImgRow[] };

const DATA = "/vqa";
const LEVELS = ["L1", "L2", "L3", "L4", "L5"];
const GAP = 8;
const CAPTION = 44;
const HEAD_H = 34;

/** D1, D2, … D11 instead of D1, D10, D11, D2; L1…L5 naturally. */
function natural(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

const STATUS_BORDER: Record<string, string> = {
  pending: "border-[#262626]",
  approve: "border-[#14532d]",
  edit: "border-[#1e3a5f]",
  reject: "border-[#4c1d1d]",
};

function Chip({ k, v }: { k: string; v: string | number }) {
  return (
    <span className="inline-flex items-baseline gap-1 rounded-full border border-[#262626] px-2 py-0.5 font-mono text-[9px] text-[#a1a1a1]">
      {k} <span className="text-[#ededed]">{v}</span>
    </span>
  );
}

export function VqaReview({ site }: { site: VqaReviewSite }) {
  const [settings, setSettings] = useState<AskSettings>(() => site.loadSettings());
  const [codeInput, setCodeInput] = useState("");
  const relay = settings.relay;
  const code = settings.accessCode;

  const [index, setIndex] = useState<Index | null>(null);
  const [rows, setRows] = useState<ImgRow[] | null>(null);
  const [matrix, setMatrix] = useState<Record<string, Record<string, number>>>({});
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [searchIndex, setSearchIndex] = useState<Hit[] | null>(null);

  const [search, setSearch] = useState("");
  const [domain, setDomain] = useState("");
  const [capability, setCapability] = useState("");
  const [level, setLevel] = useState("");
  const [minN, setMinN] = useState(0);
  const [group, setGroup] = useState<"none" | "domain" | "level">("domain");

  const [selected, setSelected] = useState<ImgRow | null>(null);
  const [pageCache, setPageCache] = useState<Record<number, PageData>>({});
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ question: "", choices: "", answer: "", grounding: "" });
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const [i, r, m, d] = await Promise.all([
          fetch(`${DATA}/index.json`), fetch(`${DATA}/images.json`),
          fetch(`${DATA}/matrix.json`), fetch(`${DATA}/decisions.json`),
        ]);
        if (!i.ok || !r.ok) throw new Error(`snapshot HTTP ${i.status}/${r.status}`);
        setIndex(await i.json());
        setRows(await r.json());
        if (m.ok) setMatrix(await m.json());
        if (d.ok) {
          const list = (await d.json()) as Decision[];
          const map: Record<string, Decision> = {};
          for (const x of list) map[x.id] = x;
          setDecisions(map);
        }
      } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    })();
  }, []);

  // Text search scans questions lazily: the index is ~2 MB gzipped, fetched only
  // when someone types, then reused for the session.
  const [needText, setNeedText] = useState(false);
  useEffect(() => {
    if (!needText || searchIndex || !index) return;
    void (async () => {
      try {
        const parts = index.searchParts ?? 1;
        const loaded = await Promise.all(
          Array.from({ length: parts }, (_, i) =>
            fetch(`${DATA}/search/${String(i + 1).padStart(2, "0")}.json`).then((r) => (r.ok ? r.json() : []))),
        );
        setSearchIndex((loaded as Hit[][]).flat());
      } catch { /* search simply stays unavailable */ }
    })();
  }, [needText, searchIndex, index]);

  const searchMatches = useMemo(() => {
    if (!search.trim() || !searchIndex) return null;
    const q = search.trim().toLowerCase();
    const hit = new Set<string>();
    for (const h of searchIndex) if (h.q.toLowerCase().includes(q)) hit.add(h.f);
    return hit;
  }, [search, searchIndex]);

  const filtered = useMemo(() => {
    const list = rows ?? [];
    return list.filter((r) =>
      (!domain || r.d === domain)
      && (!capability || r.c.includes(capability))
      && (!level || r.l.includes(level))
      && r.n >= minN
      && (!searchMatches || searchMatches.has(r.f)),
    );
  }, [rows, domain, capability, level, minN, searchMatches]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  // Columns come from the measured width, and the row height from the column
  // width, BEFORE the item list is built — the virtualizer budgets a row by this
  // number, so a fixed height clipped the captions under the images.
  const cols = width >= 1280 ? 5 : width >= 1000 ? 4 : width >= 720 ? 3 : 2;
  const colW = width ? Math.floor((width - 16 - GAP * (cols - 1)) / cols) : 220;
  const imgH = Math.round(colW * 0.75);
  const cardH = imgH + CAPTION;

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    if (group === "none") {
      for (let i = 0; i < filtered.length; i += cols) {
        out.push({ kind: "row", key: `r${i}`, row: filtered.slice(i, i + cols) });
      }
      return out;
    }
    const buckets = new Map<string, ImgRow[]>();
    for (const r of filtered) {
      const key = group === "domain" ? r.d : (r.l.slice().sort().pop() ?? "?");
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(r);
    }
    for (const key of [...buckets.keys()].sort(natural)) {
      const list = buckets.get(key)!;
      out.push({ kind: "head", key: `h-${key}`, label: key, count: list.length });
      for (let i = 0; i < list.length; i += cols) {
        out.push({ kind: "row", key: `${key}-${i}`, row: list.slice(i, i + cols) });
      }
    }
    return out;
  }, [filtered, group, cols]);

  const virt = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (items[i]?.kind === "head" ? HEAD_H : cardH),
    overscan: 4,
    getItemKey: (i) => items[i]?.key ?? i,
  });
  useEffect(() => { virt.measure(); }, [cardH, virt]);

  const statusOf = (id: string) => decisions[id]?.verdict ?? "pending";

  const counts = useMemo(() => {
    let approved = 0, edited = 0, rejected = 0;
    for (const d of Object.values(decisions)) {
      if (d.verdict === "approve") approved++;
      else if (d.verdict === "edit") edited++;
      else rejected++;
    }
    const total = index?.candidates ?? 0;
    return { approved, edited, rejected, pending: Math.max(0, total - approved - edited - rejected) };
  }, [decisions, index]);

  function openImage(r: ImgRow) {
    setSelected(r);
    setEditing(null);
    setRejectFor(null);
    if (!pageCache[r.p]) {
      void (async () => {
        try {
          const res = await fetch(`${DATA}/pages/${String(r.p).padStart(4, "0")}.json`);
          if (!res.ok) throw new Error(`page HTTP ${res.status}`);
          const data = (await res.json()) as PageData;
          setPageCache((prev) => ({ ...prev, [r.p]: data }));
        } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
      })();
    }
  }

  const openCands = selected ? pageCache[selected.p]?.images.find((im) => im.file_id === selected.f)?.candidates ?? [] : [];

  function saveCode() {
    const next = { ...settings, accessCode: codeInput.trim() };
    setSettings(next);
    site.saveSettings?.(next);
    setCodeInput("");
  }

  async function decide(c: Cand, verdict: "approve" | "edit" | "reject", edits?: Record<string, unknown>, why = "") {
    if (!relay) { setError("set the relay URL in Settings first"); return; }
    setBusy(true);
    setError("");
    try {
      const actor = getActor();
      const res = await fetch(`${relay.replace(/\/+$/, "")}/api/vqa/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-questions-code": code },
        body: JSON.stringify({
          id: c.id, verdict, reason: why, edits,
          reviewer: actor.name || actor.id || "reviewer",
          batch: index?.batch ?? "", file_id: selected?.f ?? "",
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setDecisions((prev) => ({ ...prev, [c.id]: { id: c.id, verdict, reason: why, reviewer: actor.name || "reviewer" } }));
      setNote(`${verdict} · ${c.id.slice(0, 8)}`);
      setEditing(null); setRejectFor(null); setReason("");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  function startEdit(c: Cand) {
    setEditing(c.id);
    setDraft({ question: c.question, choices: c.choices.join("\n"), answer: c.answer, grounding: c.grounding });
    setReason("");
  }

  function saveEdit(c: Cand) {
    const choices = draft.choices.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!draft.question.trim() || !draft.answer.trim() || choices.length < 2) {
      setError("question, answer and at least two choices are required");
      return;
    }
    void decide(c, "edit", { question: draft.question.trim(), choices, answer: draft.answer.trim(), grounding: draft.grounding.trim() },
      reason.trim() || "edited in the review room");
  }

  const caps = Object.keys(index?.byCapability ?? {}).sort(natural);
  const doms = Object.keys(index?.byDomain ?? {}).sort(natural);
  const levels = Object.keys(index?.byLevel ?? {}).sort(natural);

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold text-[#ededed]">The dataset, and the review room</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[#a1a1a1]">
            Every drafted question for every photograph. The grid is windowed, so all {index?.images ?? "50,000"} images
            are one scroll; filters and grouping run in memory over a static index, never a database query.
          </p>
        </div>
        {index && (
          <div className="flex flex-wrap gap-2">
            <Chip k="images" v={index.images} />
            <Chip k="questions" v={index.candidates} />
            <Chip k="approved" v={counts.approved} />
            <Chip k="edited" v={counts.edited} />
            <Chip k="rejected" v={counts.rejected} />
            <Chip k="snapshot" v={index.generated_at.slice(0, 16).replace("T", " ")} />
          </div>
        )}
      </div>

      {!code && (
        <div className="mt-4 rounded-lg border border-[#3a3a3a] bg-[#111] p-4">
          <div className="font-mono text-[10px] text-[#a1a1a1]">REVIEWER CODE</div>
          <p className="mt-1 text-[12px] text-[#8a8a8a]">Reading is open; approving needs the reviewer code.</p>
          <div className="mt-2 flex gap-2">
            <input value={codeInput} onChange={(e) => setCodeInput(e.target.value)} type="password"
              className="max-w-sm flex-1 rounded border border-[#262626] bg-[#0a0a0a] px-2 py-1.5 text-[13px] text-[#ededed]" />
            <button onClick={saveCode} className="rounded bg-[#0070f3] px-3 py-1.5 text-[12px] font-medium text-white">Save</button>
          </div>
        </div>
      )}

      {/* COVERAGE MATRIX — capability x level, the shape of the benchmark at a glance */}
      <div className="mt-5 overflow-x-auto rounded-lg border border-[#262626] bg-[#0d0d0d] p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#666]">coverage · capability × level</span>
          <span className="font-mono text-[9px] text-[#5f5f5f]">click a cell to filter</span>
        </div>
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr>
              <th className="text-left font-mono text-[9px] font-normal text-[#666]">cap</th>
              {LEVELS.map((l) => (
                <th key={l} className="px-2 text-right font-mono text-[9px] font-normal text-[#666]">{l}</th>
              ))}
              <th className="px-2 text-right font-mono text-[9px] font-normal text-[#666]">total</th>
            </tr>
          </thead>
          <tbody>
            {caps.map((c) => {
              const total = index?.byCapability[c] ?? 0;
              return (
                <tr key={c} className="border-t border-[#1c1c1c] hover:bg-[#141414]">
                  <td className="py-1 font-mono text-[10px] text-[#ededed]">{c}</td>
                  {LEVELS.map((l) => {
                    const n = matrix[c]?.[l] ?? 0;
                    const alpha = total ? Math.min(0.85, 0.06 + (n / total) * 1.6) : 0;
                    return (
                      <td key={l} className="px-1 py-0.5 text-right">
                        <button
                          onClick={() => { setCapability(c); setLevel(l); }}
                          title={`${c} · ${l}: ${n}`}
                          className="w-full rounded px-1 py-0.5 font-mono text-[10px] tabular-nums"
                          style={{ background: n ? `rgba(0,112,243,${alpha})` : "transparent", color: n ? "#ededed" : "#3a3a3a" }}
                        >
                          {n || "·"}
                        </button>
                      </td>
                    );
                  })}
                  <td className="px-2 text-right font-mono text-[10px] tabular-nums text-[#a1a1a1]">{total}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* FACETS */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select value={domain} onChange={(e) => setDomain(e.target.value)}
          className="rounded border border-[#262626] bg-[#0a0a0a] px-2 py-1.5 text-[12px] text-[#ededed]">
          <option value="">any domain</option>
          {doms.map((d) => <option key={d} value={d}>{d} ({index?.byDomain[d]})</option>)}
        </select>
        <select value={capability} onChange={(e) => setCapability(e.target.value)}
          className="rounded border border-[#262626] bg-[#0a0a0a] px-2 py-1.5 text-[12px] text-[#ededed]">
          <option value="">any capability</option>
          {caps.map((c) => <option key={c} value={c}>{c} ({index?.byCapability[c]})</option>)}
        </select>
        <select value={level} onChange={(e) => setLevel(e.target.value)}
          className="rounded border border-[#262626] bg-[#0a0a0a] px-2 py-1.5 text-[12px] text-[#ededed]">
          <option value="">any level</option>
          {levels.map((l) => <option key={l} value={l}>{l} ({index?.byLevel[l]})</option>)}
        </select>
        <select value={minN} onChange={(e) => setMinN(Number(e.target.value))}
          className="rounded border border-[#262626] bg-[#0a0a0a] px-2 py-1.5 text-[12px] text-[#ededed]">
          <option value={0}>any count</option><option value={3}>≥ 3 questions</option><option value={5}>5 questions</option>
        </select>
        <select value={group} onChange={(e) => setGroup(e.target.value as "none" | "domain" | "level")}
          className="rounded border border-[#262626] bg-[#0a0a0a] px-2 py-1.5 text-[12px] text-[#ededed]">
          <option value="domain">group by domain</option>
          <option value="level">group by level</option>
          <option value="none">no grouping</option>
        </select>
        <input value={search} onChange={(e) => { setSearch(e.target.value); setNeedText(true); }}
          placeholder="search questions…"
          className="min-w-[200px] flex-1 rounded border border-[#262626] bg-[#0a0a0a] px-2 py-1.5 text-[12px] text-[#ededed]" />
        {(domain || capability || level || minN || search) && (
          <button onClick={() => { setDomain(""); setCapability(""); setLevel(""); setMinN(0); setSearch(""); }}
            className="rounded border border-[#262626] px-3 py-1.5 text-[12px] text-[#a1a1a1]">clear</button>
        )}
        <span className="font-mono text-[10px] text-[#666]">
          {filtered.length.toLocaleString()} images{search && !searchIndex ? " · loading search index…" : ""}
        </span>
      </div>

      {note && <div className="mt-3 rounded border border-[#14532d] bg-[#0a1a10] px-3 py-2 text-[12px] text-[#4ade80]">{note}</div>}
      {error && <div className="mt-3 rounded border border-[#4c1d1d] bg-[#1a0a0a] px-3 py-2 text-[12px] text-[#f87171]">{error}</div>}

      <div ref={scrollRef} className="mt-4 h-[68vh] min-h-[420px] overflow-y-auto rounded-lg border border-[#1c1c1c]"
        style={{ contain: "strict" }}>
        <div style={{ height: virt.getTotalSize(), position: "relative" }}>
          {virt.getVirtualItems().map((vi) => {
            const it = items[vi.index];
            if (!it) return null;
            return (
              <div key={vi.key} className="absolute left-0 w-full px-2"
                style={{ height: vi.size, transform: `translateY(${vi.start}px)` }}>
                {it.kind === "head" ? (
                  <div className="flex h-full items-center gap-2 border-b border-[#262626]">
                    <span className="font-mono text-[11px] uppercase tracking-wider text-[#ededed]">{it.label}</span>
                    <span className="font-mono text-[9px] text-[#666]">{it.count.toLocaleString()} images</span>
                  </div>
                ) : (
                  <div className="grid gap-2 py-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                    {it.row.map((r) => {
                      const st = r.c.length === 1 ? statusOfOf(r, pageCache, decisions, statusOf) : "pending";
                      return (
                        <button key={r.f} onClick={() => openImage(r)}
                          className={`group overflow-hidden rounded-lg border bg-[#0d0d0d] text-left hover:border-[#0070f3] ${STATUS_BORDER[st] ?? ""}`}>
                          <div className="w-full overflow-hidden bg-[#111]" style={{ height: imgH }}>
                            <ThumbImage fileId={r.f} w={400} alt="dataset image" fit="cover" />
                          </div>
                          <div className="px-2 py-1.5">
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-[9px] text-[#666]">{r.d}</span>
                              <span className="font-mono text-[9px] text-[#a1a1a1]">{r.n} q</span>
                            </div>
                            <div className="mt-0.5 truncate font-mono text-[9px] text-[#5f5f5f]">
                              {r.l.join(" ")} · {r.c.slice(0, 3).join(" ")}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {filtered.length === 0 && rows && (
          <p className="p-10 text-center font-mono text-xs text-[#666]">nothing matches — loosen the filters</p>
        )}
        {!rows && <p className="p-10 text-center font-mono text-xs text-[#666]">loading the index…</p>}
      </div>

      {/* DETAIL DRAWER */}
      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={() => setSelected(null)}>
          <div className="h-full w-full max-w-[620px] overflow-y-auto border-l border-[#262626] bg-[#0a0a0a] p-5"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-mono text-[9px] uppercase tracking-wider text-[#666]">image</div>
                <div className="break-all font-mono text-[10px] text-[#a1a1a1]">{selected.f}</div>
              </div>
              <button onClick={() => setSelected(null)} className="rounded border border-[#262626] px-2 py-1 text-[11px] text-[#a1a1a1]">close</button>
            </div>
            <div className="mt-3 overflow-hidden rounded-lg border border-[#262626]">
              <ThumbImage fileId={selected.f} w={1600} alt="review image" fit="contain" />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Chip k="domain" v={selected.d} />
              {selected.l.map((l) => <Chip key={l} k="level" v={l} />)}
              {selected.c.map((c) => <Chip key={c} k="cap" v={c} />)}
              <Chip k="questions" v={selected.n} />
            </div>

            <div className="mt-4 space-y-3">
              {openCands.length === 0 && <p className="font-mono text-[11px] text-[#666]">loading questions…</p>}
              {openCands.map((c) => {
                const st = statusOf(c.id);
                const editingThis = editing === c.id;
                return (
                  <div key={c.id} className="rounded-lg border border-[#262626] bg-[#0d0d0d] p-4">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-[#262626] px-2 py-0.5 font-mono text-[9px] text-[#a1a1a1]">{st}</span>
                      <Chip k="cap" v={c.capability} /><Chip k="level" v={c.level} /><Chip k="diff" v={c.difficulty} />
                    </div>
                    {editingThis ? (
                      <div className="space-y-2">
                        <textarea value={draft.question} onChange={(e) => setDraft({ ...draft, question: e.target.value })}
                          className="h-16 w-full rounded border border-[#262626] bg-[#0a0a0a] p-2 text-[13px] text-[#ededed]" />
                        <textarea value={draft.choices} onChange={(e) => setDraft({ ...draft, choices: e.target.value })}
                          className="h-24 w-full rounded border border-[#262626] bg-[#0a0a0a] p-2 text-[13px] text-[#ededed]" />
                        <div className="grid grid-cols-2 gap-2">
                          <input value={draft.answer} onChange={(e) => setDraft({ ...draft, answer: e.target.value })}
                            className="rounded border border-[#262626] bg-[#0a0a0a] p-2 text-[13px] text-[#ededed]" />
                          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="reason"
                            className="rounded border border-[#262626] bg-[#0a0a0a] p-2 text-[13px] text-[#ededed]" />
                        </div>
                        <textarea value={draft.grounding} onChange={(e) => setDraft({ ...draft, grounding: e.target.value })}
                          className="h-14 w-full rounded border border-[#262626] bg-[#0a0a0a] p-2 text-[13px] text-[#ededed]" />
                        <div className="flex gap-2">
                          <button disabled={busy} onClick={() => saveEdit(c)}
                            className="rounded bg-[#0070f3] px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50">Save edit</button>
                          <button onClick={() => setEditing(null)} className="rounded border border-[#262626] px-3 py-1.5 text-[12px] text-[#a1a1a1]">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="text-[14px] font-medium text-[#ededed]">{c.question}</div>
                        <ol className="mt-2 space-y-1 text-[13px]">
                          {c.choices.map((ch, i) => (
                            <li key={i} className={ch === c.answer ? "font-semibold text-[#4ade80]" : "text-[#a1a1a1]"}>
                              {String.fromCharCode(65 + i)}. {ch}{ch === c.answer ? "  ← answer" : ""}
                            </li>
                          ))}
                        </ol>
                        {c.grounding && <div className="mt-2 text-[12px] italic text-[#8a8a8a]">{c.grounding}</div>}
                        <div className="mt-2 font-mono text-[9px] text-[#5f5f5f]">{c.model} · {c.prompt_version}</div>
                        {rejectFor === c.id ? (
                          <div className="mt-3 flex gap-2">
                            <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="why reject?"
                              className="flex-1 rounded border border-[#262626] bg-[#0a0a0a] px-2 py-1.5 text-[12px] text-[#ededed]" />
                            <button disabled={busy || !reason.trim()} onClick={() => decide(c, "reject", undefined, reason.trim())}
                              className="rounded bg-[#b3261e] px-3 py-1.5 text-[12px] text-white disabled:opacity-50">Reject</button>
                            <button onClick={() => setRejectFor(null)} className="rounded border border-[#262626] px-3 py-1.5 text-[12px] text-[#a1a1a1]">Cancel</button>
                          </div>
                        ) : (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button disabled={busy || st === "approve"} onClick={() => decide(c, "approve")}
                              className="rounded bg-[#14532d] px-3 py-1.5 text-[12px] font-medium text-[#4ade80] disabled:opacity-40">Approve</button>
                            <button disabled={busy} onClick={() => startEdit(c)}
                              className="rounded border border-[#262626] px-3 py-1.5 text-[12px] text-[#ededed]">Edit</button>
                            <button disabled={busy || st === "reject"} onClick={() => { setRejectFor(c.id); setReason(""); }}
                              className="rounded border border-[#4c1d1d] px-3 py-1.5 text-[12px] text-[#f87171] disabled:opacity-40">Reject</button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Card border reflects the image's overall state only when every question is decided. */
function statusOfOf(
  r: ImgRow, cache: Record<number, PageData>, decisions: Record<string, Decision>,
  statusOf: (id: string) => string,
): string {
  const page = cache[r.p];
  if (!page) return "pending";
  const cands = page.images.find((im) => im.file_id === r.f)?.candidates ?? [];
  if (!cands.length) return "pending";
  const states = cands.map((c) => statusOf(c.id));
  if (states.every((s) => s === "approve")) return "approve";
  if (states.every((s) => s === "reject")) return "reject";
  return "pending";
}
