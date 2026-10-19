import { useCallback, useEffect, useState } from "react";
import { ThumbImage } from "./ThumbImage";
import {
  getActor,
  questionsApi,
  type VqaCandidate,
  type VqaCounts,
  type VqaImageGroup,
} from "./questions";
import type { AskSettings } from "./settings";

/**
 * The review room for model-drafted VQA candidates (migration 0010).
 *
 * A candidate is NOT ground truth: it lands `pending` and this screen is the
 * only place a reviewer moves it to approved / edited / rejected, with a reason
 * and an appended review row. The live `questions` table is never written here.
 *
 * Two views in one screen:
 *   - by image (default): the grid, because judging a question needs the photo;
 *   - filtered flat list: when a search or a taxonomy filter is set, because
 *     coverage questions ("what L4 items exist?") are not image-shaped.
 */

export interface VqaReviewSite {
  loadSettings: () => AskSettings;
  saveSettings?: (s: AskSettings) => void;
}

type Draft = { question: string; choices: string; answer: string; grounding: string };

const STATUS_STYLE: Record<string, string> = {
  pending: "border-[#3a3a3a] text-[#a1a1a1]",
  approved: "border-[#14532d] text-[#4ade80]",
  edited: "border-[#1e3a5f] text-[#60a5fa]",
  rejected: "border-[#4c1d1d] text-[#f87171]",
};

function Chip({ k, v }: { k: string; v: string | number }) {
  return (
    <span className="inline-flex items-baseline gap-1 rounded-full border border-[#262626] px-2 py-0.5 font-mono text-[9px] text-[#a1a1a1]">
      {k} <span className="text-[#ededed]">{v}</span>
    </span>
  );
}

function parseChoices(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

export function VqaReview({ site }: { site: VqaReviewSite }) {
  const [settings, setSettings] = useState<AskSettings>(() => site.loadSettings());
  const [codeInput, setCodeInput] = useState("");
  const relay = settings.relay;
  const code = settings.accessCode;

  const [counts, setCounts] = useState<VqaCounts | null>(null);
  const [images, setImages] = useState<VqaImageGroup[]>([]);
  const [flat, setFlat] = useState<VqaCandidate[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [candidates, setCandidates] = useState<VqaCandidate[]>([]);
  const [status, setStatus] = useState("pending");
  const [capability, setCapability] = useState("");
  const [level, setLevel] = useState("");
  const [domain, setDomain] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>({ question: "", choices: "", answer: "", grounding: "" });
  const [rejectFor, setRejectFor] = useState<number | null>(null);
  const [reason, setReason] = useState("");

  const filtered = Boolean(search || capability || level || domain);

  const loadCounts = useCallback(async () => {
    try {
      setCounts(await questionsApi.vqaCounts(relay, code));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [relay, code]);

  const loadImages = useCallback(async (after = 0) => {
    try {
      const r = await questionsApi.vqaImages(relay, code, { status: status === "all" ? "" : status, limit: 60, after });
      setImages((prev) => (after ? [...prev, ...r.images] : r.images));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [relay, code, status]);

  const loadFlat = useCallback(async () => {
    try {
      const r = await questionsApi.vqaCandidates(relay, code, {
        status: status === "all" ? "" : status,
        capability: capability || undefined,
        level: level || undefined,
        domain: domain || undefined,
        search: search || undefined,
        limit: 100,
      });
      setFlat(r.candidates);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [relay, code, status, capability, level, domain, search]);

  useEffect(() => { void loadCounts(); }, [loadCounts]);
  useEffect(() => {
    if (filtered) { setSelected(""); void loadFlat(); } else { setFlat([]); void loadImages(0); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, loadFlat, loadImages]);

  useEffect(() => {
    if (!selected) { setCandidates([]); return; }
    void (async () => {
      try {
        const r = await questionsApi.vqaCandidates(relay, code, { file_id: selected, limit: 200 });
        setCandidates(r.candidates);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [selected, relay, code]);

  function saveCode() {
    const next = { ...settings, accessCode: codeInput.trim() };
    setSettings(next);
    site.saveSettings?.(next);
    setCodeInput("");
  }

  async function decide(id: number, verdict: "approve" | "edit" | "reject", edits?: Record<string, unknown>, why = "") {
    setBusy(true);
    setError("");
    try {
      const actor = getActor();
      const r = await questionsApi.vqaReview(relay, code, {
        candidate_id: id, verdict, reason: why, reviewer: actor.name || actor.id || "reviewer", edits,
      });
      setCandidates((prev) => prev.map((c) => (c.id === id ? r.candidate : c)));
      setFlat((prev) => prev.map((c) => (c.id === id ? r.candidate : c)));
      setNote(verdict === "reject" ? `Rejected #${id}` : verdict === "edit" ? `Saved edits on #${id}` : `Approved #${id}`);
      setEditing(null);
      setRejectFor(null);
      setReason("");
      void loadCounts();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function startEdit(c: VqaCandidate) {
    setEditing(c.id);
    setDraft({
      question: c.question,
      choices: parseChoices(c.choices).join("\n"),
      answer: c.answer,
      grounding: c.grounding,
    });
    setReason("");
  }

  function saveEdit(c: VqaCandidate) {
    const choices = draft.choices.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!draft.question.trim() || !draft.answer.trim() || choices.length < 2) {
      setError("question, answer and at least two choices are required");
      return;
    }
    void decide(c.id, "edit", {
      question: draft.question.trim(),
      choices,
      answer: draft.answer.trim(),
      grounding: draft.grounding.trim(),
    }, reason.trim() || "edited in the review room");
  }

  function Card({ c }: { c: VqaCandidate }) {
    const choices = parseChoices(c.choices);
    const editingThis = editing === c.id;
    return (
      <div className="rounded-lg border border-[#262626] bg-[#0d0d0d] p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] ${STATUS_STYLE[c.status] ?? ""}`}>{c.status}</span>
          <Chip k="cap" v={c.capability} /><Chip k="level" v={c.level} /><Chip k="dom" v={c.domain} /><Chip k="diff" v={c.difficulty} />
          <span className="ml-auto font-mono text-[9px] text-[#666]">#{c.id} · {c.ordinal}</span>
        </div>
        {editingThis ? (
          <div className="space-y-2">
            <label className="block font-mono text-[9px] text-[#a1a1a1]">QUESTION
              <textarea value={draft.question} onChange={(e) => setDraft({ ...draft, question: e.target.value })}
                className="mt-1 h-16 w-full rounded border border-[#262626] bg-[#0a0a0a] p-2 text-[13px] text-[#ededed]" />
            </label>
            <label className="block font-mono text-[9px] text-[#a1a1a1]">CHOICES (one per line — the answer must match one exactly)
              <textarea value={draft.choices} onChange={(e) => setDraft({ ...draft, choices: e.target.value })}
                className="mt-1 h-24 w-full rounded border border-[#262626] bg-[#0a0a0a] p-2 text-[13px] text-[#ededed]" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block font-mono text-[9px] text-[#a1a1a1]">ANSWER
                <input value={draft.answer} onChange={(e) => setDraft({ ...draft, answer: e.target.value })}
                  className="mt-1 w-full rounded border border-[#262626] bg-[#0a0a0a] p-2 text-[13px] text-[#ededed]" />
              </label>
              <label className="block font-mono text-[9px] text-[#a1a1a1]">REASON
                <input value={reason} onChange={(e) => setReason(e.target.value)}
                  className="mt-1 w-full rounded border border-[#262626] bg-[#0a0a0a] p-2 text-[13px] text-[#ededed]" />
              </label>
            </div>
            <label className="block font-mono text-[9px] text-[#a1a1a1]">GROUNDING
              <textarea value={draft.grounding} onChange={(e) => setDraft({ ...draft, grounding: e.target.value })}
                className="mt-1 h-14 w-full rounded border border-[#262626] bg-[#0a0a0a] p-2 text-[13px] text-[#ededed]" />
            </label>
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
              {choices.map((ch, i) => (
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
                <button disabled={busy || !reason.trim()} onClick={() => decide(c.id, "reject", undefined, reason.trim())}
                  className="rounded bg-[#b3261e] px-3 py-1.5 text-[12px] text-white disabled:opacity-50">Reject</button>
                <button onClick={() => setRejectFor(null)} className="rounded border border-[#262626] px-3 py-1.5 text-[12px] text-[#a1a1a1]">Cancel</button>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                <button disabled={busy || c.status === "approved"} onClick={() => decide(c.id, "approve")}
                  className="rounded bg-[#14532d] px-3 py-1.5 text-[12px] font-medium text-[#4ade80] disabled:opacity-40">Approve</button>
                <button disabled={busy} onClick={() => startEdit(c)}
                  className="rounded border border-[#262626] px-3 py-1.5 text-[12px] text-[#ededed]">Edit</button>
                <button disabled={busy || c.status === "rejected"} onClick={() => { setRejectFor(c.id); setReason(""); }}
                  className="rounded border border-[#4c1d1d] px-3 py-1.5 text-[12px] text-[#f87171] disabled:opacity-40">Reject</button>
              </div>
            )}
          </>
        )}
        {c.reviewer && c.status !== "pending" && (
          <div className="mt-2 text-[10px] text-[#5f5f5f]">reviewed by {c.reviewer} · {c.reviewed_at}{c.reason ? ` · ${c.reason}` : ""}</div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="text-[22px] font-semibold text-[#ededed]">The review room</h1>
      <p className="mt-1 max-w-3xl text-[13px] text-[#a1a1a1]">
        Model-drafted questions, one photograph at a time. Nothing here is ground truth until you approve it.
        Approve, fix or reject each candidate; every decision is recorded with your reason.
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

      {counts && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Chip k="images" v={counts.images} />
          <Chip k="candidates" v={counts.total} />
          <Chip k="pending" v={counts.byStatus.pending ?? 0} />
          <Chip k="approved" v={counts.byStatus.approved ?? 0} />
          <Chip k="edited" v={counts.byStatus.edited ?? 0} />
          <Chip k="rejected" v={counts.byStatus.rejected ?? 0} />
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select value={status} onChange={(e) => setStatus(e.target.value)}
          className="rounded border border-[#262626] bg-[#0a0a0a] px-2 py-1.5 text-[12px] text-[#ededed]">
          <option value="pending">pending</option><option value="all">all</option>
          <option value="approved">approved</option><option value="edited">edited</option><option value="rejected">rejected</option>
        </select>
        <select value={capability} onChange={(e) => setCapability(e.target.value)}
          className="rounded border border-[#262626] bg-[#0a0a0a] px-2 py-1.5 text-[12px] text-[#ededed]">
          <option value="">any capability</option>
          {(counts?.byCapability ?? []).map((r) => <option key={r.capability} value={r.capability}>{r.capability} ({r.n})</option>)}
        </select>
        <select value={level} onChange={(e) => setLevel(e.target.value)}
          className="rounded border border-[#262626] bg-[#0a0a0a] px-2 py-1.5 text-[12px] text-[#ededed]">
          <option value="">any level</option>
          {(counts?.byLevel ?? []).map((r) => <option key={r.level} value={r.level}>{r.level} ({r.n})</option>)}
        </select>
        <select value={domain} onChange={(e) => setDomain(e.target.value)}
          className="rounded border border-[#262626] bg-[#0a0a0a] px-2 py-1.5 text-[12px] text-[#ededed]">
          <option value="">any domain</option>
          {(counts?.byDomain ?? []).map((r) => <option key={r.domain} value={r.domain}>{r.domain} ({r.n})</option>)}
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="search questions…"
          className="min-w-[200px] flex-1 rounded border border-[#262626] bg-[#0a0a0a] px-2 py-1.5 text-[12px] text-[#ededed]" />
        {selected && <button onClick={() => setSelected("")} className="rounded border border-[#262626] px-3 py-1.5 text-[12px] text-[#a1a1a1]">← back to images</button>}
      </div>

      {note && <div className="mt-3 rounded border border-[#14532d] bg-[#0a1a10] px-3 py-2 text-[12px] text-[#4ade80]">{note}</div>}
      {error && <div className="mt-3 rounded border border-[#4c1d1d] bg-[#1a0a0a] px-3 py-2 text-[12px] text-[#f87171]">{error}</div>}

      {selected ? (
        <div className="mt-5">
          <div className="mb-3 flex items-center gap-3">
            <div className="h-24 w-36 overflow-hidden rounded border border-[#262626]">
              <ThumbImage fileId={selected} w={400} alt="review image" fit="cover" />
            </div>
            <div>
              <div className="font-mono text-[10px] text-[#666]">IMAGE</div>
              <div className="break-all font-mono text-[11px] text-[#a1a1a1]">{selected}</div>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {candidates.map((c) => <Card key={c.id} c={c} />)}
          </div>
        </div>
      ) : filtered ? (
        <div className="mt-5">
          <div className="mb-2 font-mono text-[10px] text-[#666]">{flat.length} matching candidates</div>
          <div className="grid gap-3 md:grid-cols-2">
            {flat.map((c) => (
              <div key={c.id}>
                <button onClick={() => { setSelected(c.file_id); setSearch(""); setCapability(""); setLevel(""); setDomain(""); }}
                  className="mb-1 text-left font-mono text-[9px] text-[#0070f3] hover:underline">
                  open image {c.file_id.slice(0, 16)}…
                </button>
                <Card c={c} />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {images.map((g) => (
              <button key={g.file_id} onClick={() => setSelected(g.file_id)}
                className="group overflow-hidden rounded-lg border border-[#262626] bg-[#0d0d0d] text-left hover:border-[#0070f3]">
                <div className="aspect-[4/3] w-full overflow-hidden bg-[#111]">
                  <ThumbImage fileId={g.file_id} w={400} alt="candidate image" fit="cover" />
                </div>
                <div className="flex items-center justify-between px-2 py-1.5">
                  <span className="font-mono text-[9px] text-[#666]">{g.file_id.slice(0, 10)}…</span>
                  <span className="font-mono text-[9px] text-[#a1a1a1]">{g.n} q{g.has_pending ? " · pending" : ""}</span>
                </div>
              </button>
            ))}
          </div>
          {images.length >= 60 && (
            <div className="mt-4 text-center">
              <button onClick={() => loadImages(images[images.length - 1]?.first_id ?? 0)}
                className="rounded border border-[#262626] px-4 py-2 text-[12px] text-[#ededed]">Load more images</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
