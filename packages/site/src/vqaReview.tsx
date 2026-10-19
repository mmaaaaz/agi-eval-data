import { useCallback, useEffect, useMemo, useState } from "react";
import { ThumbImage } from "./ThumbImage";
import { getActor } from "./questions";
import type { AskSettings } from "./settings";

/**
 * The review room, static-first.
 *
 * Reading costs D1 nothing: the candidates are exported as static JSON pages on
 * Cloudflare Pages (unlimited requests and bandwidth, served from the edge), and
 * this screen fetches them directly. D1 keeps only what a human writes — one
 * decision row per item, keyed by a stable candidate id — so visits do not turn
 * into row reads. Filtered search is the one dynamic call, edge-cached.
 *
 * Nothing here is ground truth until a reviewer approves it with the reviewer
 * code; the static payload never changes, only the decisions overlay does.
 */

export interface VqaReviewSite {
  loadSettings: () => AskSettings;
  saveSettings?: (s: AskSettings) => void;
}

interface Cand {
  id: string;
  question: string;
  choices: string[];
  answer: string;
  grounding: string;
  capability: string;
  level: string;
  domain: string;
  difficulty: string;
  model: string;
  endpoint: string;
  prompt_version: string;
}
interface PageData { page: number; images: { file_id: string; candidates: Cand[] }[] }
interface PageMeta { p: number; file: string; images: number; first: string; last: string }
interface Index {
  generated_at: string; batch: string; images: number; candidates: number; pages: PageMeta[];
  byCapability: Record<string, number>; byLevel: Record<string, number>; byDomain: Record<string, number>;
}
interface Decision { id: string; verdict: "approve" | "edit" | "reject"; reason: string; reviewer: string }
interface Hit { id: number; file_id: string; question: string; capability: string; level: string; domain: string }

const DATA = "/vqa";
const STATUS_STYLE: Record<string, string> = {
  pending: "border-[#3a3a3a] text-[#a1a1a1]",
  approve: "border-[#14532d] text-[#4ade80]",
  edit: "border-[#1e3a5f] text-[#60a5fa]",
  reject: "border-[#4c1d1d] text-[#f87171]",
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
  const [page, setPage] = useState<PageData | null>(null);
  const [pageNo, setPageNo] = useState(1);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [selected, setSelected] = useState<string>("");
  const [status, setStatus] = useState("all");
  const [capability, setCapability] = useState("");
  const [level, setLevel] = useState("");
  const [domain, setDomain] = useState("");
  const [search, setSearch] = useState("");
  const [searchIndex, setSearchIndex] = useState<Hit[] | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ question: "", choices: "", answer: "", grounding: "" });
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const filtered = Boolean(search || capability || level || domain);
  const fileToPage = useMemo(() => {
    // Pages are sorted by file_id and carry their boundaries, so a lookup is a
    // binary search over ~700 entries instead of a 1 MB id list in the index.
    const pages = index?.pages ?? [];
    return (fid: string): number | undefined => {
      let lo = 0, hi = pages.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const p = pages[mid];
        if (fid < p.first) hi = mid - 1;
        else if (fid > p.last) lo = mid + 1;
        else return p.p;
      }
      return undefined;
    };
  }, [index]);

  const loadDecisions = useCallback(async () => {
    try {
      const r = await fetch(`${DATA}/decisions.json`);
      if (!r.ok) return;
      const d = (await r.json()) as Decision[];
      const m: Record<string, Decision> = {};
      for (const x of d) m[x.id] = x;
      setDecisions(m);
    } catch {
      /* offline: browsing still works, everything shows pending */
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch(`${DATA}/index.json`);
        if (!r.ok) throw new Error(`index.json HTTP ${r.status}`);
        setIndex((await r.json()) as Index);
      } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    })();
    void loadDecisions();
  }, [loadDecisions]);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch(`${DATA}/pages/${String(pageNo).padStart(4, "0")}.json`);
        if (!r.ok) throw new Error(`page HTTP ${r.status}`);
        setPage((await r.json()) as PageData);
        setSelected("");
      } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    })();
  }, [pageNo]);

  useEffect(() => {
    if (!filtered || searchIndex) return;
    // ~2 MB gzipped, fetched once per visitor when they first filter, then every
    // query is answered in memory. No D1 read, no Worker invocation, no quota.
    void (async () => {
      try {
        const r = await fetch(`${DATA}/search.json`);
        if (!r.ok) throw new Error(`search.json HTTP ${r.status}`);
        setSearchIndex((await r.json()) as Hit[]);
      } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    })();
  }, [filtered, searchIndex]);

  const hits = useMemo(() => {
    if (!searchIndex) return [];
    const q = search.trim().toLowerCase();
    return searchIndex.filter((h) =>
      (!capability || h.capability === capability)
      && (!level || h.level === level)
      && (!domain || h.domain === domain)
      && (!q || h.question.toLowerCase().includes(q)),
    ).slice(0, 100);
  }, [searchIndex, capability, level, domain, search]);

  function saveCode() {
    const next = { ...settings, accessCode: codeInput.trim() };
    setSettings(next);
    site.saveSettings?.(next);
    setCodeInput("");
  }

  const statusOf = (id: string) => decisions[id]?.verdict ?? "pending";

  async function decide(c: Cand, verdict: "approve" | "edit" | "reject", edits?: Record<string, unknown>, why = "") {
    if (!relay) { setError("set the relay URL in Settings first"); return; }
    setBusy(true);
    setError("");
    try {
      const actor = getActor();
      const r = await fetch(`${relay.replace(/\/+$/, "")}/api/vqa/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-questions-code": code },
        body: JSON.stringify({
          id: c.id, verdict, reason: why, edits,
          reviewer: actor.name || actor.id || "reviewer",
          batch: index?.batch ?? "", file_id: selected,
        }),
      });
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      setDecisions((prev) => ({
        ...prev,
        [c.id]: { id: c.id, verdict, reason: why, reviewer: actor.name || "reviewer" },
      }));
      setNote(`${verdict} · ${c.id.slice(0, 8)}`);
      setEditing(null);
      setRejectFor(null);
      setReason("");
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
    void decide(c, "edit", {
      question: draft.question.trim(), choices, answer: draft.answer.trim(), grounding: draft.grounding.trim(),
    }, reason.trim() || "edited in the review room");
  }

  const counts = useMemo(() => {
    let approved = 0, edited = 0, rejected = 0;
    for (const d of Object.values(decisions)) {
      if (d.verdict === "approve") approved++;
      else if (d.verdict === "edit") edited++;
      else rejected++;
    }
    const total = index?.candidates ?? 0;
    return { approved, edited, rejected, pending: Math.max(0, total - approved - edited - rejected), total };
  }, [decisions, index]);

  const visibleImages = useMemo(
    () => (page?.images ?? []).filter((im) => status === "all" || im.candidates.some((c) => statusOf(c.id) === status)),
    // statusOf reads decisions, which is the other input
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page, status, decisions],
  );

  function Card({ c }: { c: Cand }) {
    const st = statusOf(c.id);
    const editingThis = editing === c.id;
    return (
      <div className="rounded-lg border border-[#262626] bg-[#0d0d0d] p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] ${STATUS_STYLE[st] ?? ""}`}>{st}</span>
          <Chip k="cap" v={c.capability} /><Chip k="level" v={c.level} /><Chip k="dom" v={c.domain} /><Chip k="diff" v={c.difficulty} />
          <span className="ml-auto font-mono text-[9px] text-[#666]">{c.id.slice(0, 10)}</span>
        </div>
        {editingThis ? (
          <div className="space-y-2">
            <textarea value={draft.question} onChange={(e) => setDraft({ ...draft, question: e.target.value })}
              className="h-16 w-full rounded border border-[#262626] bg-[#0a0a0a] p-2 text-[13px] text-[#ededed]" />
            <textarea value={draft.choices} onChange={(e) => setDraft({ ...draft, choices: e.target.value })}
              className="h-24 w-full rounded border border-[#262626] bg-[#0a0a0a] p-2 text-[13px] text-[#ededed]" />
            <div className="grid grid-cols-2 gap-2">
              <input value={draft.answer} onChange={(e) => setDraft({ ...draft, answer: e.target.value })}
                className="w-full rounded border border-[#262626] bg-[#0a0a0a] p-2 text-[13px] text-[#ededed]" />
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="reason"
                className="w-full rounded border border-[#262626] bg-[#0a0a0a] p-2 text-[13px] text-[#ededed]" />
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
            <div className="mt-2 font-mono text-[9px] text-[#5f5f5f]">{c.model} · {c.endpoint || "lane"} · {c.prompt_version}</div>
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
            {decisions[c.id] && (
              <div className="mt-2 text-[10px] text-[#5f5f5f]">
                {decisions[c.id].verdict} by {decisions[c.id].reviewer || "reviewer"}{decisions[c.id].reason ? ` · ${decisions[c.id].reason}` : ""}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="text-[22px] font-semibold text-[#ededed]">The review room</h1>
      <p className="mt-1 max-w-3xl text-[13px] text-[#a1a1a1]">
        Model-drafted questions, one photograph at a time. Reading is served from the edge and costs nothing;
        a decision is recorded once you approve, fix or reject an item with the reviewer code.
      </p>

      {!code && (
        <div className="mt-4 rounded-lg border border-[#3a3a3a] bg-[#111] p-4">
          <div className="font-mono text-[10px] text-[#a1a1a1]">REVIEWER CODE</div>
          <p className="mt-1 text-[12px] text-[#8a8a8a]">Reading is open; approving needs the reviewer code.</p>
          <div className="mt-2 flex gap-2">
            <input value={codeInput} onChange={(e) => setCodeInput(e.target.value)} type="password"
              className="flex-1 rounded border border-[#262626] bg-[#0a0a0a] px-2 py-1.5 text-[13px] text-[#ededed]" />
            <button onClick={saveCode} className="rounded bg-[#0070f3] px-3 py-1.5 text-[12px] font-medium text-white">Save</button>
          </div>
        </div>
      )}

      {index && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Chip k="images" v={index.images} />
          <Chip k="candidates" v={index.candidates} />
          <Chip k="pending" v={counts.pending} />
          <Chip k="approved" v={counts.approved} />
          <Chip k="edited" v={counts.edited} />
          <Chip k="rejected" v={counts.rejected} />
          <Chip k="snapshot" v={index.generated_at.slice(0, 16).replace("T", " ")} />
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select value={status} onChange={(e) => setStatus(e.target.value)}
          className="rounded border border-[#262626] bg-[#0a0a0a] px-2 py-1.5 text-[12px] text-[#ededed]">
          <option value="all">all</option><option value="pending">pending</option>
          <option value="approve">approved</option><option value="edit">edited</option><option value="reject">rejected</option>
        </select>
        <select value={capability} onChange={(e) => setCapability(e.target.value)}
          className="rounded border border-[#262626] bg-[#0a0a0a] px-2 py-1.5 text-[12px] text-[#ededed]">
          <option value="">any capability</option>
          {Object.entries(index?.byCapability ?? {}).map(([k, n]) => <option key={k} value={k}>{k} ({n})</option>)}
        </select>
        <select value={level} onChange={(e) => setLevel(e.target.value)}
          className="rounded border border-[#262626] bg-[#0a0a0a] px-2 py-1.5 text-[12px] text-[#ededed]">
          <option value="">any level</option>
          {Object.entries(index?.byLevel ?? {}).map(([k, n]) => <option key={k} value={k}>{k} ({n})</option>)}
        </select>
        <select value={domain} onChange={(e) => setDomain(e.target.value)}
          className="rounded border border-[#262626] bg-[#0a0a0a] px-2 py-1.5 text-[12px] text-[#ededed]">
          <option value="">any domain</option>
          {Object.entries(index?.byDomain ?? {}).map(([k, n]) => <option key={k} value={k}>{k} ({n})</option>)}
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="search questions…"
          className="min-w-[200px] flex-1 rounded border border-[#262626] bg-[#0a0a0a] px-2 py-1.5 text-[12px] text-[#ededed]" />
        {selected && <button onClick={() => setSelected("")} className="rounded border border-[#262626] px-3 py-1.5 text-[12px] text-[#a1a1a1]">← back</button>}
      </div>

      {note && <div className="mt-3 rounded border border-[#14532d] bg-[#0a1a10] px-3 py-2 text-[12px] text-[#4ade80]">{note}</div>}
      {error && <div className="mt-3 rounded border border-[#4c1d1d] bg-[#1a0a0a] px-3 py-2 text-[12px] text-[#f87171]">{error}</div>}

      {selected && page ? (
        <div className="mt-5">
          {(() => {
            const img = page.images.find((im) => im.file_id === selected);
            if (!img) return <div className="text-[12px] text-[#a1a1a1]">loading image…</div>;
            return (
              <>
                <div className="mb-3 flex items-center gap-3">
                  <div className="h-24 w-36 overflow-hidden rounded border border-[#262626]">
                    <ThumbImage fileId={img.file_id} w={400} alt="review image" fit="cover" />
                  </div>
                  <div className="break-all font-mono text-[10px] text-[#a1a1a1]">{img.file_id}</div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {img.candidates.map((c) => <Card key={c.id} c={c} />)}
                </div>
              </>
            );
          })()}
        </div>
      ) : filtered ? (
        <div className="mt-5">
          <div className="mb-2 font-mono text-[10px] text-[#666]">{hits.length} matching candidates (first 100)</div>
          <div className="grid gap-2">
            {hits.map((h) => (
              <button key={h.id} onClick={() => { const p = fileToPage(h.file_id); if (p) { setPageNo(p); setSelected(h.file_id); } }}
                className="rounded border border-[#262626] bg-[#0d0d0d] p-3 text-left hover:border-[#0070f3]">
                <div className="text-[13px] text-[#ededed]">{h.question}</div>
                <div className="mt-1 font-mono text-[9px] text-[#666]">{h.capability} · {h.level} · {h.domain} · open image</div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {visibleImages.map((im) => (
              <button key={im.file_id} onClick={() => setSelected(im.file_id)}
                className="group overflow-hidden rounded-lg border border-[#262626] bg-[#0d0d0d] text-left hover:border-[#0070f3]">
                <div className="aspect-[4/3] w-full overflow-hidden bg-[#111]">
                  <ThumbImage fileId={im.file_id} w={400} alt="candidate image" fit="cover" />
                </div>
                <div className="flex items-center justify-between px-2 py-1.5">
                  <span className="font-mono text-[9px] text-[#666]">{im.file_id.slice(0, 10)}…</span>
                  <span className="font-mono text-[9px] text-[#a1a1a1]">{im.candidates.length} q</span>
                </div>
              </button>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-center gap-3 text-[12px] text-[#a1a1a1]">
            <button disabled={pageNo <= 1} onClick={() => setPageNo((n) => Math.max(1, n - 1))}
              className="rounded border border-[#262626] px-3 py-1.5 disabled:opacity-40">← previous</button>
            <span className="font-mono text-[10px]">page {pageNo} / {index?.pages.length ?? "?"}</span>
            <button disabled={!!index && pageNo >= index.pages.length} onClick={() => setPageNo((n) => n + 1)}
              className="rounded border border-[#262626] px-3 py-1.5 disabled:opacity-40">next →</button>
          </div>
        </>
      )}
    </div>
  );
}
