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
 * the free tier. The normal decision is per IMAGE: a reviewer stages edits across
 * its questions, then approves (or rejects) the image once. Those rows are keyed
 * by the image; `sync_vqa_decisions` republishes them as static JSON for everyone
 * else.
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
  category?: string; subcategory?: string;
  prompt_version: string;
  answer_type?: string; relevance?: string; bias_axis?: string; abstention?: boolean;
}
interface PageData { page: number; images: { file_id: string; candidates: Cand[] }[] }
interface PageMeta { p: number; file: string; images: number; first: string; last: string }
interface Index {
  generated_at: string; batch: string; images: number; candidates: number; pages: PageMeta[]; searchParts?: number;
  byCapability: Record<string, number>; byLevel: Record<string, number>; byDomain: Record<string, number>;
  byCategory?: Record<string, number>; bySubcategory?: Record<string, number>; taxonomyVersion?: string;
  byBiasAxis?: Record<string, number>; abstentions?: number;
}
interface ImgRow { f: string; p: number; d: string; c: string[]; s?: string[]; l: string[]; n: number; b?: number; a?: number }
interface Decision {
  id: string; verdict: "approve" | "edit" | "reject" | "clear"; reason: string; reviewer: string;
  file_id?: string; edits?: string;
}
/** One question as the reviewer left it. Staged locally, persisted with the image verdict. */
interface QEdit { question: string; choices: string[]; answer: string; grounding: string }
interface EditDraft { id: string; question: string; choices: string[]; answerIndex: number; grounding: string }
interface Hit { id: string; f: string; q: string; c: string; l: string; d: string }

type Item = { kind: "head"; key: string; label: string; count: number } | { kind: "row"; key: string; row: ImgRow[] };

const DATA = "/vqa";
const LEVELS = ["L1", "L2", "L3", "L4", "L5"];
const GAP = 8;
const CAPTION = 44;
const HEAD_H = 34;

/**
 * This browser's own decisions, kept until the snapshot catches up.
 *
 * The published decisions.json only changes when `sync_vqa_decisions` runs and the
 * site is redeployed. Without this overlay a reviewer would lose sight of their own
 * verdict on reload — and an undo would silently revert. A "clear" entry is a
 * tombstone: it hides the published row until the sync removes it.
 */
const LOCAL_DECISIONS = "vqa.decisions.local.v1";

function readLocalDecisions(): Record<string, Decision> {
  try {
    const raw = localStorage.getItem(LOCAL_DECISIONS);
    return raw ? (JSON.parse(raw) as Record<string, Decision>) : {};
  } catch { return {}; }
}

function writeLocalDecisions(map: Record<string, Decision>) {
  try { localStorage.setItem(LOCAL_DECISIONS, JSON.stringify(map)); } catch { /* private mode: session-only */ }
}

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

  const initialQuery = useRef(new URLSearchParams(window.location.search)).current;
  const initialImage = useRef(initialQuery.get("img") ?? "").current;

  const [search, setSearch] = useState(initialQuery.get("q") ?? "");
  const [domain, setDomain] = useState(initialQuery.get("domain") ?? "");
  const [capability, setCapability] = useState(initialQuery.get("cat") ?? initialQuery.get("capability") ?? "");
  const [level, setLevel] = useState(initialQuery.get("sub") ?? initialQuery.get("level") ?? "");
  const [minN, setMinN] = useState(Number(initialQuery.get("min") ?? 0) || 0);
  const [kind, setKind] = useState<"all" | "bias" | "abstain">(() => {
    const k = initialQuery.get("kind");
    return k === "bias" || k === "abstain" ? k : "all";
  });
  const [group, setGroup] = useState<"none" | "domain" | "level">(() => {
    const g = initialQuery.get("group");
    return g === "none" || g === "level" ? g : "domain";
  });

  const [selected, setSelected] = useState<ImgRow | null>(null);
  const [pageCache, setPageCache] = useState<Record<number, PageData>>({});
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // Edits are staged per image in this browser. Nothing is written until the
  // reviewer approves or rejects the image, so an edit cannot half-land.
  const [editsByFile, setEditsByFile] = useState<Record<string, Record<string, QEdit>>>({});
  const [editFor, setEditFor] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [imgReject, setImgReject] = useState(false);
  const [imgReason, setImgReason] = useState("");

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
          for (const x of Object.values(readLocalDecisions())) {
            if (x.verdict === "clear") delete map[x.id];
            else map[x.id] = x;
          }
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
      && (!level || (r.s ?? r.l).includes(level))
      && r.n >= minN
      && (kind === "all" || (kind === "bias" ? r.b === 1 : r.a === 1))
      && (!searchMatches || searchMatches.has(r.f)),
    );
  }, [rows, domain, capability, level, minN, searchMatches, kind]);

  // The modal is a reading surface: Escape closes it and the grid behind it
  // stops scrolling, so a reviewer's wheel never moves the page under the photo.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelected(null); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [selected]);

  // A shared /review?img=<file_id> link opens that photograph even if the grid is
  // filtered: `rows` holds all 50,000 images, so the lookup does not depend on the
  // current facet selection. The filters from the same URL are already applied.
  useEffect(() => {
    if (!rows || !initialImage) return;
    const r = rows.find((x) => x.f === initialImage);
    if (r) openImage(r);
  }, [rows, initialImage]);

  // Keep the address bar shareable: filters and the open image are mirrored into
  // the query string, and an existing unknown param (a cache buster) is preserved.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const put = (k: string, v: string) => { if (v) p.set(k, v); else p.delete(k); };
    put("cat", capability); put("sub", level); put("domain", domain);
    put("q", search.trim()); put("min", minN ? String(minN) : "");
    put("kind", kind === "all" ? "" : kind);
    put("group", group === "domain" ? "" : group);
    put("img", selected?.f ?? (rows ? "" : initialImage));
    const qs = p.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [capability, level, domain, search, minN, kind, group, selected, rows, initialImage]);

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
      const key = group === "domain" ? r.d : ((r.s?.length ? r.s : r.l).slice().sort().pop() ?? "?");
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

  // Image verdicts come from rows whose id starts with "img:". They key the review
  // room now; per-candidate rows from earlier sessions still count as fallbacks.
  const imageDecByFile = useMemo(() => {
    const m: Record<string, Decision> = {};
    for (const d of Object.values(decisions)) {
      if (d.id.startsWith("img:") && d.file_id && d.verdict !== "clear") m[d.file_id] = d;
    }
    return m;
  }, [decisions]);

  const statusFor = (fileId: string, candId: string) => imageDecByFile[fileId]?.verdict ?? statusOf(candId);

  /** Saved edits from the snapshot, overlaid with anything staged in this browser. */
  const editsFor = (fileId: string): Record<string, QEdit> => {
    const saved = imageDecByFile[fileId]?.edits;
    let fromServer: Record<string, QEdit> = {};
    if (saved) {
      try { fromServer = (JSON.parse(saved) as { questions?: Record<string, QEdit> }).questions ?? {}; }
      catch { fromServer = {}; }
    }
    return { ...fromServer, ...(editsByFile[fileId] ?? {}) };
  };

  const effective = (c: Cand, fileId: string): Cand => {
    const e = editsFor(fileId)[c.id];
    return e ? { ...c, ...e } : c;
  };

  const counts = useMemo(() => {
    let approved = 0, edited = 0, rejected = 0;
    for (const d of Object.values(decisions)) {
      if (!d.id.startsWith("img:")) continue;
      if (d.verdict === "approve") approved++;
      else if (d.verdict === "reject") rejected++;
      if (d.edits) edited++;
    }
    return { approved, edited, rejected, pending: Math.max(0, (index?.images ?? 0) - approved - rejected) };
  }, [decisions, index]);

  function openImage(r: ImgRow) {
    setSelected(r);
    setEditFor(null); setEditDraft(null);
    setImgReject(false); setImgReason("");
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

  async function postDecision(payload: Record<string, unknown>): Promise<Decision | null> {
    if (!relay) { setError("set the relay URL in Settings first"); return null; }
    if (!code) { setError("enter the reviewer code to approve or reject"); return null; }
    setBusy(true); setError("");
    try {
      const actor = getActor();
      const res = await fetch(`${relay.replace(/\/+$/, "")}/api/vqa/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-questions-code": code },
        body: JSON.stringify({ ...payload, reviewer: actor.name || actor.id || "reviewer", batch: index?.batch ?? "" }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      return {
        id: body.id ?? String(payload.id ?? ""),
        verdict: payload.verdict as Decision["verdict"],
        reason: String(payload.reason ?? ""),
        reviewer: actor.name || "reviewer",
      };
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); return null; }
    finally { setBusy(false); }
  }

  /** One verdict per image, carrying every staged question edit in the same row. */
  async function decideImage(verdict: "approve" | "reject" | "clear") {
    if (!selected) return;
    const file = selected.f;
    const staged = editsByFile[file] ?? {};
    const why = verdict === "reject" ? imgReason.trim() : "";
    if (verdict === "reject" && !why) { setError("say why the image is rejected"); return; }
    const payload: Record<string, unknown> = { scope: "image", file_id: file, verdict, reason: why };
    if (verdict === "approve" && Object.keys(staged).length) payload.edits = { questions: staged };
    const row = await postDecision(payload);
    if (!row) return;
    const savedEdits = verdict === "approve" && Object.keys(staged).length ? JSON.stringify({ questions: staged }) : "";
    const localRow: Decision = verdict === "clear"
      ? { ...row, verdict: "clear", file_id: file }
      : { ...row, file_id: file, edits: savedEdits };
    setDecisions((prev) => {
      const next = { ...prev };
      if (verdict === "clear") delete next[row.id];
      else next[row.id] = localRow;
      return next;
    });
    writeLocalDecisions({ ...readLocalDecisions(), [row.id]: localRow });
    if (verdict === "approve") {
      // Edits now live in the decision row; drop the local copies so the row is the record.
      setEditsByFile((prev) => { const next = { ...prev }; delete next[file]; return next; });
      setNote(`image approved · ${Object.keys(staged).length} edited question(s) · ${file.slice(0, 8)}`);
    } else if (verdict === "reject") {
      setNote(`image rejected · ${file.slice(0, 8)}`);
      setImgReject(false); setImgReason("");
    } else {
      setNote("approval withdrawn — image is back to pending");
     
      // Undo hands the edited questions back to this browser so nothing is lost.
      const saved = imageDecByFile[file]?.edits;
      if (saved) {
        try { setEditsByFile((prev) => ({ ...prev, [file]: (JSON.parse(saved) as { questions?: Record<string, QEdit> }).questions ?? {} })); }
        catch { /* a malformed row must not break the undo */ }
      }
    }
  }

  function startEdit(c: Cand) {
    const current = effective(c, selected?.f ?? "");
    setEditFor(c.id);
    setEditDraft({
      id: c.id,
      question: current.question,
      choices: [...current.choices],
      answerIndex: Math.max(0, current.choices.indexOf(current.answer)),
      grounding: current.grounding,
    });
    setError("");
  }

  /** Applies the edit to the image in this browser; the write happens on approve. */
  function applyEdit() {
    if (!selected || !editDraft) return;
    const question = editDraft.question.trim();
    const choices = editDraft.choices.map((c) => c.trim()).filter(Boolean);
    if (!question || choices.length < 2 || !choices[editDraft.answerIndex]) {
      setError("the question needs text, at least two choices, and one selected as the answer");
      return;
    }
    const edit: QEdit = { question, choices, answer: choices[editDraft.answerIndex], grounding: editDraft.grounding.trim() };
    setEditsByFile((prev) => ({ ...prev, [selected.f]: { ...(prev[selected.f] ?? {}), [editDraft.id]: edit } }));
    setEditFor(null); setEditDraft(null); setError("");
  }

  const caps = Object.keys(index?.byCapability ?? {}).sort(natural);
  const doms = Object.keys(index?.byDomain ?? {}).sort(natural);
  const levels = Object.keys(index?.byLevel ?? {}).sort(natural);
  // v5 reports categories and subcategories. The same two filter slots are used:
  // `capability` holds the category, `level` holds the subcategory, so a URL or a
  // bookmark keeps meaning without a second filter bar.
  const isV5 = String(index?.taxonomyVersion ?? "").startsWith("v5");
  const cats = Object.keys(index?.byCategory ?? {}).sort(natural);
  const subs = Object.keys(index?.bySubcategory ?? {}).sort(natural);
  const CAT_OF: Record<string, string> = { P: "physics", G: "geometry", B: "combination", F: "bias", S: "sensitivity" };
  const catOf = (code: string) => (code === "PERC" ? "perc" : CAT_OF[code.slice(0, 1)] ?? "");
  const capOptions = isV5 ? cats : caps;
  const levelOptions = isV5 ? subs : levels;

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
            <Chip k="images approved" v={counts.approved} />
            <Chip k="with edits" v={counts.edited} />
            <Chip k="images rejected" v={counts.rejected} />
            {index?.abstentions ? <Chip k="abstention" v={index.abstentions} /> : null}
            {index?.byBiasAxis ? <Chip k="bias" v={Object.values(index.byBiasAxis).reduce((a, b) => a + b, 0)} /> : null}
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

      {/* COVERAGE — v5: category × its subcategory counts; v4: capability × level */}
      {isV5 ? (
        <div className="mt-5 rounded-lg border border-[#262626] bg-[#0d0d0d] p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="font-mono text-[10px] uppercase tracking-wider text-[#666]">coverage · category × subcategory</span>
            <span className="font-mono text-[9px] text-[#5f5f5f]">click a subcategory to filter</span>
          </div>
          <div className="space-y-2">
            {cats.map((cat) => {
              const total = index?.byCategory?.[cat] ?? 0;
              const mine = subs.filter((s) => catOf(s) === cat);
              return (
                <div key={cat} className="flex flex-wrap items-baseline gap-2 border-t border-[#1c1c1c] pt-2">
                  <button onClick={() => { setCapability(capability === cat ? "" : cat); setLevel(""); }}
                    className={`w-28 text-left font-mono text-[11px] ${capability === cat ? "text-[#60a5fa]" : "text-[#ededed]"}`}>
                    {cat} <span className="text-[#666]">{total.toLocaleString()}</span>
                  </button>
                  <div className="flex flex-1 flex-wrap gap-1">
                    {mine.map((s) => {
                      const n = index?.bySubcategory?.[s] ?? 0;
                      return (
                        <button key={s} onClick={() => { setCapability(cat); setLevel(level === s ? "" : s); }}
                          title={`${s}: ${n}`}
                          className={`rounded border px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${level === s ? "border-[#0070f3] text-[#60a5fa]" : "border-[#262626] text-[#a1a1a1] hover:border-[#404040]"}`}>
                          {s} <span className="text-[#666]">{n}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            <div className="flex items-baseline gap-2 border-t border-[#1c1c1c] pt-2">
              <span className="w-28 font-mono text-[11px] text-[#666]">control</span>
              <span className="font-mono text-[10px] text-[#666]">reported separately; not one of the five categories</span>
            </div>
          </div>
        </div>
      ) : (
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
      )}

      {/* FACETS */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select value={domain} onChange={(e) => setDomain(e.target.value)}
          className="rounded border border-[#262626] bg-[#0a0a0a] px-2 py-1.5 text-[12px] text-[#ededed]">
          <option value="">any domain</option>
          {doms.map((d) => <option key={d} value={d}>{d} ({index?.byDomain[d]})</option>)}
        </select>
        <select value={capability} onChange={(e) => { setCapability(e.target.value); setLevel(""); }}
          className="rounded border border-[#262626] bg-[#0a0a0a] px-2 py-1.5 text-[12px] text-[#ededed]">
          <option value="">{isV5 ? "any category" : "any capability"}</option>
          {capOptions.map((c) => (
            <option key={c} value={c}>{c} ({(isV5 ? index?.byCategory?.[c] : index?.byCapability[c]) ?? 0})</option>
          ))}
        </select>
        <select value={level} onChange={(e) => setLevel(e.target.value)}
          className="rounded border border-[#262626] bg-[#0a0a0a] px-2 py-1.5 text-[12px] text-[#ededed]">
          <option value="">{isV5 ? "any subcategory" : "any level"}</option>
          {levelOptions.map((l) => (
            <option key={l} value={l}>{l} ({(isV5 ? index?.bySubcategory?.[l] : index?.byLevel[l]) ?? 0})</option>
          ))}
        </select>
        <select value={minN} onChange={(e) => setMinN(Number(e.target.value))}
          className="rounded border border-[#262626] bg-[#0a0a0a] px-2 py-1.5 text-[12px] text-[#ededed]">
          <option value={0}>any count</option>
          {isV5
            ? <><option value={6}>≥ 6 questions</option><option value={8}>≥ 8 questions</option><option value={10}>≥ 10 questions</option></>
            : <><option value={3}>≥ 3 questions</option><option value={5}>5 questions</option></>}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value as "all" | "bias" | "abstain")}
          className="rounded border border-[#262626] bg-[#0a0a0a] px-2 py-1.5 text-[12px] text-[#ededed]">
          <option value="all">every item</option>
          <option value="bias">has a bias probe</option>
          <option value="abstain">has an abstention item</option>
        </select>
        <select value={group} onChange={(e) => setGroup(e.target.value as "none" | "domain" | "level")}
          className="rounded border border-[#262626] bg-[#0a0a0a] px-2 py-1.5 text-[12px] text-[#ededed]">
          <option value="domain">group by domain</option>
          <option value="level">{isV5 ? "group by subcategory" : "group by level"}</option>
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
                      const imgDec = imageDecByFile[r.f];
                      const st = imgDec?.verdict ?? (r.c.length === 1 ? statusOfOf(r, pageCache, statusFor) : "pending");
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
                              {(r.s?.length ? r.s : r.l).join(" ")} · {r.c.slice(0, 3).join(" ")}
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

      {/* FULL-SCREEN REVIEW MODAL: the photograph large beside every question */}
      {selected && (
        <div className="fixed inset-0 z-50 bg-black/85 p-2 md:p-5" onClick={() => setSelected(null)}>
          <div className="mx-auto flex h-full w-full max-w-[1600px] flex-col overflow-hidden rounded-xl border border-[#262626] bg-[#0a0a0a]"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-wrap items-center gap-2 border-b border-[#262626] px-4 py-2">
              <span className="font-mono text-[9px] uppercase tracking-wider text-[#666]">image</span>
              <span className="break-all font-mono text-[10px] text-[#a1a1a1]">{selected.f}</span>
              <Chip k="domain" v={selected.d} />
              {selected.c.map((c) => <Chip key={c} k={isV5 ? "category" : "cap"} v={c} />)}
              {(selected.s ?? selected.l).map((s) => <Chip key={s} k={isV5 ? "sub" : "level"} v={s} />)}
              <Chip k="questions" v={selected.n} />
              <button onClick={() => setSelected(null)}
                className="ml-auto rounded border border-[#262626] px-3 py-1 text-[11px] text-[#a1a1a1] hover:border-[#404040]">close ✕</button>
            </div>
            <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_minmax(460px,620px)]">
              <div className="flex min-h-0 items-center justify-center overflow-hidden bg-black p-2 md:p-4">
                <ThumbImage fileId={selected.f} w={1600} alt="review image" fit="contain"
                  className="h-full w-full object-contain" />
              </div>
              <div className="flex min-h-0 flex-col border-t border-[#262626] md:border-l md:border-t-0">
                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {/* Five items read in one column; a ten-item image (the planned
                    next count) pairs them so its list does not double in height. */}
                <div className={openCands.length > 6 ? "grid grid-cols-1 gap-2 md:grid-cols-2" : "space-y-2"}>
              {openCands.length === 0 && <p className="font-mono text-[11px] text-[#666]">loading questions…</p>}
              {openCands.map((c, qi) => {
                const e = effective(c, selected.f);
                const isEdited = Boolean(editsByFile[selected.f]?.[c.id]);
                const editingThis = editFor === c.id && editDraft !== null;
                return (
                  <div key={c.id} className="rounded-lg border border-[#262626] bg-[#0d0d0d] px-2.5 py-1.5">
                    <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 font-mono text-[9px] text-[#8a8a8a]">
                      <span className="rounded bg-[#141414] px-1.5 py-0.5 text-[#ededed]">Q{qi + 1}</span>
                      <span>{(c.category ? `${c.category} · ${c.subcategory}` : `${c.capability} · ${c.level}`)} · {c.difficulty}</span>
                      {c.bias_axis ? <span className="text-[#60a5fa]">bias {c.bias_axis}</span> : null}
                      {c.abstention ? <span className="text-[#60a5fa]">abstention</span> : null}
                      {isEdited ? <span className="ml-auto text-[#60a5fa]">edited</span> : null}
                    </div>
                    {editingThis ? (
                      <div className="space-y-1.5">
                        <textarea value={editDraft.question} rows={2} autoFocus
                          onChange={(ev) => setEditDraft({ ...editDraft, question: ev.target.value })}
                          className="w-full resize-y rounded border border-[#262626] bg-[#0a0a0a] p-2 text-[13px] text-[#ededed]" />
                        <div className="space-y-1">
                          {editDraft.choices.map((ch, i) => (
                            <div key={i} className="flex items-center gap-1.5">
                              <input type="radio" name={`answer-${c.id}`} checked={editDraft.answerIndex === i}
                                onChange={() => setEditDraft({ ...editDraft, answerIndex: i })}
                                className="accent-[#4ade80]" title="correct answer" />
                              <span className="w-3 font-mono text-[10px] text-[#8a8a8a]">{String.fromCharCode(65 + i)}</span>
                              <input value={ch}
                                onChange={(ev) => {
                                  const choices = [...editDraft.choices];
                                  choices[i] = ev.target.value;
                                  setEditDraft({ ...editDraft, choices });
                                }}
                                className="min-w-0 flex-1 rounded border border-[#262626] bg-[#0a0a0a] px-2 py-0.5 text-[12px] text-[#ededed]" />
                              <button title="remove this choice" disabled={editDraft.choices.length <= 2}
                                onClick={() => {
                                  const choices = editDraft.choices.filter((_, j) => j !== i);
                                  setEditDraft({ ...editDraft, choices, answerIndex: Math.min(editDraft.answerIndex, choices.length - 1) });
                                }}
                                className="px-1 text-[12px] text-[#666] disabled:opacity-30">×</button>
                            </div>
                          ))}
                          <button onClick={() => setEditDraft({ ...editDraft, choices: [...editDraft.choices, ""] })}
                            className="font-mono text-[10px] text-[#60a5fa]">+ add choice</button>
                        </div>
                        <input value={editDraft.grounding}
                          onChange={(ev) => setEditDraft({ ...editDraft, grounding: ev.target.value })}
                          placeholder="what in the image makes the answer visible"
                          className="w-full rounded border border-[#262626] bg-[#0a0a0a] px-2 py-1 text-[11px] text-[#ededed]" />
                        <div className="flex items-center gap-1.5">
                          <button disabled={busy} onClick={applyEdit}
                            className="rounded bg-[#0070f3] px-2.5 py-0.5 text-[11px] font-medium text-white disabled:opacity-50">Apply to image</button>
                          <button onClick={() => { setEditFor(null); setEditDraft(null); }}
                            className="rounded border border-[#262626] px-2.5 py-0.5 text-[11px] text-[#a1a1a1]">Cancel</button>
                          <span className="ml-auto font-mono text-[9px] text-[#666]">saves when the image is approved</span>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="text-[13px] font-medium leading-snug text-[#ededed]">{e.question}</div>
                        <div className="mt-1 text-[12px] leading-5 text-[#a1a1a1]">
                          {e.choices.map((ch, i) => (
                            <span key={i} className={ch === e.answer ? "font-semibold text-[#4ade80]" : ""}>
                              {String.fromCharCode(65 + i)}. {ch}{i < e.choices.length - 1 ? "  ·  " : ""}
                            </span>
                          ))}
                        </div>
                        {e.grounding && (
                          <div className="line-clamp-1 text-[10px] italic leading-3.5 text-[#7a7a7a]">{e.grounding}</div>
                        )}
                        <div className="mt-1 flex items-center gap-2">
                          <button disabled={busy} onClick={() => startEdit(c)}
                            className="rounded border border-[#262626] px-2.5 py-0.5 text-[11px] text-[#ededed]">Edit question</button>
                          {isEdited && (
                            <button onClick={() => setEditsByFile((prev) => {
                              const m = { ...(prev[selected.f] ?? {}) };
                              delete m[c.id];
                              return { ...prev, [selected.f]: m };
                            })} className="font-mono text-[9px] text-[#60a5fa]">revert this edit</button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
                </div>
                </div>
                {/* ONE VERDICT PER IMAGE, and it is reversible. Edits staged above ride
                    along with Approve, so what others read is the corrected set. */}
                <div className="shrink-0 border-t border-[#262626] bg-[#0a0a0a] px-3 py-2">
                  {imgReject ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <input autoFocus value={imgReason} onChange={(ev) => setImgReason(ev.target.value)}
                        placeholder="why is this image unusable?"
                        className="min-w-[180px] flex-1 rounded border border-[#262626] bg-[#0a0a0a] px-2 py-1 text-[12px] text-[#ededed]" />
                      <button disabled={busy || !imgReason.trim()} onClick={() => void decideImage("reject")}
                        className="rounded bg-[#b3261e] px-3 py-1 text-[11px] text-white disabled:opacity-50">Reject image</button>
                      <button onClick={() => { setImgReject(false); setImgReason(""); }}
                        className="rounded border border-[#262626] px-3 py-1 text-[11px] text-[#a1a1a1]">Cancel</button>
                    </div>
                  ) : imageDecByFile[selected.f] ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`font-mono text-[10px] ${imageDecByFile[selected.f].verdict === "approve" ? "text-[#4ade80]" : "text-[#f87171]"}`}>
                        {imageDecByFile[selected.f].verdict === "approve" ? "✓ approved" : "✕ rejected"}
                        {imageDecByFile[selected.f].reviewer ? ` · ${imageDecByFile[selected.f].reviewer}` : ""}
                      </span>
                      {imageDecByFile[selected.f].reason && (
                        <span className="max-w-[50%] truncate text-[11px] italic text-[#8a8a8a]">{imageDecByFile[selected.f].reason}</span>
                      )}
                      <button disabled={busy} onClick={() => void decideImage("clear")}
                        className="ml-auto rounded border border-[#262626] px-3 py-1 text-[11px] text-[#ededed] disabled:opacity-50">Undo</button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <button disabled={busy} onClick={() => void decideImage("approve")}
                        className="rounded bg-[#14532d] px-3 py-1 text-[11px] font-medium text-[#4ade80] disabled:opacity-40">Approve image</button>
                      <button disabled={busy} onClick={() => setImgReject(true)}
                        className="rounded border border-[#4c1d1d] px-3 py-1 text-[11px] text-[#f87171] disabled:opacity-40">Reject image</button>
                      <span className="font-mono text-[9px] text-[#666]">
                        {Object.keys(editsByFile[selected.f] ?? {}).length
                          ? `${Object.keys(editsByFile[selected.f] ?? {}).length} edit(s) staged · saved with the approval`
                          : "no edits staged"}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Card border reflects the image's verdict; per-question rows are a fallback. */
function statusOfOf(
  r: ImgRow, cache: Record<number, PageData>, statusFor: (fileId: string, candId: string) => string,
): string {
  const page = cache[r.p];
  if (!page) return "pending";
  const cands = page.images.find((im) => im.file_id === r.f)?.candidates ?? [];
  if (!cands.length) return "pending";
  const states = cands.map((c) => statusFor(r.f, c.id));
  if (states.every((s) => s === "approve")) return "approve";
  if (states.every((s) => s === "reject")) return "reject";
  return "pending";
}
