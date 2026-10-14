import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ThumbImage } from "./ThumbImage";
import { ActorBar } from "./ActorBar";
import { useLiveSync } from "./useLiveSync";
import { parseChoices, questionsApi, type QRow } from "./questions";
import type { AskSettings } from "./settings";

/**
 * The review queue: the only place ground truth is approved.
 *
 * Under the two-door model every open write lands as a DRAFT, so without this
 * screen an author's item is invisible in every results table and the benchmark
 * never grows. Approval is what the reviewer code buys.
 *
 * Deliberately minimal: image, question, options, stored answer, and three
 * buttons. Judging should take seconds, because a reviewer will do it thousands
 * of times and the second-reviewer audit rides on top.
 */

export interface ReviewSite {
  loadSettings: () => AskSettings;
  saveSettings?: (s: AskSettings) => void;
}

type Decision = "accept" | "fix" | "reject";

const LETTERS = ["A", "B", "C", "D", "E", "F"];

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[#262626] px-2 py-0.5 font-mono text-[9px] text-[#a1a1a1]">
      {label} <span className="text-[#ededed]">{value}</span>
    </span>
  );
}

export function ReviewQueue({ site }: { site: ReviewSite }) {
  const [settings, setSettings] = useState<AskSettings>(() => site.loadSettings());
  const [codeInput, setCodeInput] = useState("");
  const [rows, setRows] = useState<QRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [pending, setPending] = useState<{ id: number; decision: Decision } | null>(null);
  const [reason, setReason] = useState("");
  const [secondFor, setSecondFor] = useState<number | null>(null);
  const [secondAnswer, setSecondAnswer] = useState("");
  // The audit sample has to include items that are ALREADY in the benchmark, or the
  // agreement figure only ever covers items nobody has approved yet.
  const [auditMode, setAuditMode] = useState(false);
  const [done, setDone] = useState(0);

  const relay = settings.relay.replace(/\/+$/, "");
  const code = settings.accessCode;

  const load = useCallback(async () => {
    if (!code) { setRows([]); return; }
    setLoading(true);
    setError("");
    try {
      // Decide (drafts), or audit (already approved). Two different jobs on the same
      // items, and the second is where the agreement figure comes from.
      const r = await questionsApi.list(relay, code, {
        status: auditMode ? "approved" : "draft",
        limit: 200,
      });
      setRows(r.questions);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [relay, code, auditMode]);

  useEffect(() => { void load(); }, [load]);

  // Live, and merged rather than reloaded: a reviewer mid-decision must not have the
  // card under their cursor swapped out. Someone else's new draft appears; a draft
  // someone else approved leaves.
  const sync = useLiveSync({
    relay,
    enabled: Boolean(code),
    onDelta: (d) => {
      setRows((prev) => {
        const byId = new Map(prev.map((q) => [q.id, q]));
        for (const q of d.questions) {
          if (q.status === "draft") byId.set(q.id, q);
          else byId.delete(q.id);
        }
        return [...byId.values()].sort((a, b) => b.id - a.id);
      });
    },
  });

  const remember = () => {
    const next = { ...settings, accessCode: codeInput.trim() };
    setSettings(next);
    site.saveSettings?.(next);
    setCodeInput("");
  };

  const decide = async (id: number, decision: Decision, why: string) => {
    setBusyId(id);
    try {
      const r = await questionsApi.review(relay, code, id, decision, why);
      setRows((prev) => prev.filter((q) => q.id !== id));
      setDone((n) => n + 1);
      setPending(null);
      setReason("");
      toast.success(
        r.status === "approved"
          ? "accepted — it is now part of the benchmark"
          : "rejected — the item is back in the author's hands",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  /**
   * Record an independent second annotation.
   *
   * The blinding is THIS screen's responsibility: while a card is in second-opinion
   * mode the stored answer and the gold highlight are hidden. Without that the two
   * annotations are not independent and the agreement figure is inflated — it would
   * measure the second reviewer's ability to read the first reviewer's answer.
   */
  const recordSecond = async (id: number) => {
    const answer = secondAnswer.trim();
    if (!answer) return;
    try {
      await questionsApi.second(relay, code, id, answer);
      toast.success("second opinion recorded — the two answers are now compared");
      setRows((prev) => prev.map((q) => (q.id === id ? { ...q, annotator_2: answer } : q)));
      setSecondFor(null);
      setSecondAnswer("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  if (!code) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Review queue</h1>
        <p className="mt-2 font-mono text-[11px] leading-5 text-[#a1a1a1]">
          Approving ground truth needs the reviewer code. It is a separate secret from the
          harness code, and the door fails closed: with no code set, nobody can approve.
        </p>
        <label className="mt-6 block">
          <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-[#666]">reviewer code</span>
          <div className="flex gap-2">
            <input
              type="password"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              placeholder="the reviewer code"
              className="w-full rounded-md border border-[#262626] bg-[#050505] px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none focus:border-accent"
            />
            <button
              onClick={remember}
              disabled={!codeInput.trim()}
              className="shrink-0 rounded-md border border-accent/60 px-3 py-1.5 font-mono text-xs text-accent transition-colors hover:bg-accent hover:text-white disabled:opacity-30"
            >
              use it
            </button>
          </div>
        </label>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Review queue</h1>
          <p className="mt-1 font-mono text-[11px] text-[#666]">
            {loading ? "loading…" : auditMode ? rows.length + " approved items to audit" : rows.length + " awaiting a decision"}
            {done > 0 ? " · " + done + " decided this session" : ""}
            {" · "}
            <span className={sync.paused ? "text-[#f59e0b]" : "text-[#0cce6b]"}>
              {sync.paused ? "paused (tab hidden)" : "live"}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => { setAuditMode((v) => !v); setSecondFor(null); }}
            title="audit items already in the benchmark, to measure inter-annotator agreement"
            className={
              "rounded-md border px-3 py-1.5 font-mono text-[10px] transition-colors " +
              (auditMode ? "border-accent text-accent" : "border-[#262626] text-[#a1a1a1] hover:border-accent hover:text-accent")
            }
          >
            {auditMode ? "auditing approved" : "audit approved"}
          </button>
          <ActorBar compact />
          <button
            onClick={() => void load()}
            disabled={loading}
            className="rounded-md border border-[#262626] px-3 py-1.5 font-mono text-[10px] text-[#a1a1a1] transition-colors hover:border-accent hover:text-accent disabled:opacity-30"
          >
            reload
          </button>
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-danger/40 bg-danger/10 p-3 font-mono text-[11px] text-danger">
          {error}
        </p>
      )}

      {!loading && !error && rows.length === 0 && (
        <p className="rounded-lg border border-[#262626] bg-[#0a0a0a]/60 p-6 font-mono text-[11px] text-[#a1a1a1]">
          Nothing is waiting. Every item written has been decided.
        </p>
      )}

      <div className="space-y-4">
        {rows.map((q) => {
          const choices = parseChoices(q.choices);
          const isPending = pending?.id === q.id;
          // In second-opinion mode the stored answer is withheld from THIS reviewer.
          const blind = secondFor === q.id;
          return (
            <article key={q.id} className="rounded-lg border border-[#262626] bg-[#0a0a0a]/40 p-4">
              <div className="grid gap-4 md:grid-cols-[260px_1fr]">
                <ThumbImage
                  fileId={q.file_id}
                  w={1600}
                  alt="the image this question is about"
                  className="aspect-square w-full rounded-md"
                />
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    <Chip label="cap" value={q.capability ?? "—"} />
                    <Chip label="level" value={q.level ?? "—"} />
                    <Chip label="family" value={q.family ?? "—"} />
                    {q.pair_role && <Chip label="pair" value={q.pair_role} />}
                    <Chip label="by" value={q.actor_name || q.contributor || "—"} />
                  </div>

                  <p className="text-sm leading-6 text-[#ededed]">{q.question}</p>

                  {choices.length > 0 && (
                    <ol className="mt-2 space-y-1">
                      {choices.map((c, i) => {
                        const letter = LETTERS[i] ?? "?";
                        const isGold = !blind && (q.answer ?? "").trim().toUpperCase() === letter;
                        return (
                          <li key={i} className="flex gap-2 font-mono text-[11px]">
                            <span className={isGold ? "text-[#0cce6b]" : "text-[#666]"}>{letter}</span>
                            <span className={isGold ? "text-[#0cce6b]" : "text-[#a1a1a1]"}>{c}</span>
                            {isGold && <span className="text-[#0cce6b]">· stored answer</span>}
                          </li>
                        );
                      })}
                    </ol>
                  )}

                  {!blind && choices.length === 0 && (
                    <p className="mt-2 font-mono text-[11px] text-[#0cce6b]">
                      stored answer: {q.answer ?? "—"}
                      {q.tolerance ? " (±" + q.tolerance + ")" : ""}
                    </p>
                  )}

                  {!blind && q.annotator_2 && (
                    <p className="mt-1 font-mono text-[10px] text-[#a1a1a1]">
                      second opinion: <span className="text-[#ededed]">{q.annotator_2}</span>
                      {String(q.annotator_2).trim().toLowerCase() === String(q.answer ?? "").trim().toLowerCase()
                        ? " · agrees"
                        : " · DISAGREES with the stored answer"}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => void decide(q.id, "accept", "")}
                      disabled={busyId === q.id}
                      className="rounded-md border border-[#0cce6b]/60 px-3 py-1.5 font-mono text-[10px] text-[#0cce6b] transition-colors hover:bg-[#0cce6b] hover:text-black disabled:opacity-30"
                    >
                      accept
                    </button>
                    <button
                      onClick={() => { setPending({ id: q.id, decision: "fix" }); setReason(""); }}
                      disabled={busyId === q.id}
                      className="rounded-md border border-[#f59e0b]/60 px-3 py-1.5 font-mono text-[10px] text-[#f59e0b] transition-colors hover:bg-[#f59e0b] hover:text-black disabled:opacity-30"
                    >
                      fix
                    </button>
                    <button
                      onClick={() => { setPending({ id: q.id, decision: "reject" }); setReason(""); }}
                      disabled={busyId === q.id}
                      className="rounded-md border border-danger/60 px-3 py-1.5 font-mono text-[10px] text-danger transition-colors hover:bg-danger hover:text-white disabled:opacity-30"
                    >
                      reject
                    </button>
                    <button
                      onClick={() => { setSecondFor(blind ? null : q.id); setSecondAnswer(""); }}
                      className="rounded-md border border-[#262626] px-3 py-1.5 font-mono text-[10px] text-[#a1a1a1] transition-colors hover:border-accent hover:text-accent"
                    >
                      {blind ? "cancel" : "second opinion"}
                    </button>
                  </div>

                  {blind && (
                    <div className="mt-3 space-y-2 rounded-md border border-accent/40 bg-accent/5 p-3">
                      <span className="block font-mono text-[10px] uppercase tracking-wider text-accent">
                        answer it yourself — the stored answer is hidden
                      </span>
                      <p className="font-mono text-[10px] leading-4 text-[#a1a1a1]">
                        Two independent answers are what make the agreement figure mean anything.
                        Seeing the first answer would make this a reading test, not a second opinion.
                      </p>
                      {choices.length > 0 ? (
                        <div className="space-y-1">
                          {choices.map((c, i) => {
                            const letter = LETTERS[i] ?? "?";
                            const picked = secondAnswer === letter;
                            return (
                              <button
                                key={i}
                                onClick={() => setSecondAnswer(letter)}
                                className={
                                  "block w-full rounded-md border px-2.5 py-1.5 text-left font-mono text-[11px] transition-colors " +
                                  (picked ? "border-accent bg-accent/10 text-accent" : "border-[#262626] text-[#a1a1a1] hover:border-[#404040]")
                                }
                              >
                                {letter}) {c}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <input
                          autoFocus
                          value={secondAnswer}
                          onChange={(e) => setSecondAnswer(e.target.value)}
                          placeholder="your answer"
                          className="w-full rounded-md border border-[#262626] bg-[#0a0a0a] px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none focus:border-accent"
                        />
                      )}
                      <button
                        onClick={() => void recordSecond(q.id)}
                        disabled={!secondAnswer.trim()}
                        className="rounded-md bg-white px-3 py-1.5 font-mono text-[10px] font-semibold text-black disabled:opacity-30"
                      >
                        record second opinion
                      </button>
                    </div>
                  )}

                  {isPending && pending && (
                    <div className="mt-3 space-y-2 rounded-md border border-[#262626] bg-[#050505] p-3">
                      <span className="block font-mono text-[10px] uppercase tracking-wider text-[#666]">
                        why {pending.decision === "reject" ? "reject" : "fix"}? the author sees this
                      </span>
                      <input
                        autoFocus
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder={
                          pending.decision === "reject"
                            ? "two defensible answers, or answerable without the image…"
                            : "the option text is ambiguous, or the level is wrong…"
                        }
                        className="w-full rounded-md border border-[#262626] bg-[#0a0a0a] px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none focus:border-accent"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => void decide(q.id, pending.decision, reason.trim())}
                          disabled={!reason.trim() || busyId === q.id}
                          className="rounded-md bg-white px-3 py-1.5 font-mono text-[10px] font-semibold text-black disabled:opacity-30"
                        >
                          {pending.decision === "reject" ? "reject it" : "send it back"}
                        </button>
                        <button
                          onClick={() => { setPending(null); setReason(""); }}
                          className="rounded-md border border-[#262626] px-3 py-1.5 font-mono text-[10px] text-[#a1a1a1] hover:border-[#404040]"
                        >
                          cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
