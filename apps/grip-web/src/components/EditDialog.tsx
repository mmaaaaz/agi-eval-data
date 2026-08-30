import { useMemo, useState } from "react";
import { toast } from "sonner";
import { upstreamBlobUrl } from "../lib/gripImage";
import { stageEdit, workerConfigured } from "../lib/gripSync";
import type { Question, Sample } from "../lib/gripTypes";
import { saveLocalEdit, type LocalEdit } from "../routes/sample.$slug.$";

interface Props {
  slug: string;
  sample: Sample;
  question: Question | null;
  /** scene key to edit, or null when editing a question */
  sceneKey: string | null;
  existing?: LocalEdit;
  onClose: () => void;
  onSaved: () => void;
}

/** Generate + stage an override patch. Falls back to copy-JSON when the
 *  grip-sync worker isn't configured in /settings. */
export function EditDialog({ slug, sample, question, sceneKey, existing, onClose, onSaved }: Props) {
  const target = question
    ? { field: `q:${question.question_id}.${"ground_truth"}`, label: `L${question.difficulty_level} · ${question.question_type}` }
    : { field: sceneKey ? `scene.${sceneKey}` : "", label: sceneKey ?? "" };

  const [field, setField] = useState(target.field);
  const [current, setCurrent] = useState<string>(() => String(currentValue(sample, question, sceneKey)));
  const [next, setNext] = useState("");
  const [reason, setReason] = useState("");
  const [author, setAuthor] = useState(() => {
    try { return localStorage.getItem("grip.author") ?? ""; } catch { return ""; }
  });
  const [busy, setBusy] = useState(false);

  const patch = useMemo(() => {
    const to = coerce(next);
    return {
      version: 1,
      author: author.trim() || "unknown",
      reason: reason.trim(),
      editedAt: new Date().toISOString(),
      changes: [{ field, from: coerce(current), to }],
    };
  }, [field, current, next, reason, author]);

  const valid = next.length > 0 && reason.trim().length > 0 && author.trim().length > 0 && field.length > 0;

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      localStorage.setItem("grip.author", author.trim());
      const edit: LocalEdit = { slug, sampleId: sample.id, patch };
      saveLocalEdit(edit);
      if (workerConfigured()) {
        await stageEdit(slug, sample.id, patch);
        toast.success("edit staged on the worker");
      } else {
        toast.success("edit saved locally — configure the worker in /settings to stage it remotely");
      }
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "staging failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[#262626] bg-[#0a0a0a] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#666]">stage override · {slug}/{sample.id}</p>
        <h2 className="mt-1 text-sm font-medium text-white">{question ? `Question ${question.question_id}` : `Scene key: ${sceneKey}`}</h2>
        {question && <p className="mt-1 line-clamp-2 text-xs text-[#a1a1a1]">{question.question_text}</p>}

        <label className="mt-4 block font-mono text-[10px] uppercase tracking-wider text-[#666]">field</label>
        <input
          value={field}
          onChange={(e) => setField(e.target.value)}
          spellCheck={false}
          className="mt-1 w-full rounded border border-[#262626] bg-black px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none focus:border-[#8b5cf6]"
        />

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-wider text-[#666]">from (asserted)</label>
            <input
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              spellCheck={false}
              className="mt-1 w-full rounded border border-[#262626] bg-black px-2.5 py-1.5 font-mono text-xs text-[#a1a1a1] outline-none focus:border-[#8b5cf6]"
            />
          </div>
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-wider text-[#666]">to (new value)</label>
            <input
              value={next}
              onChange={(e) => setNext(e.target.value)}
              spellCheck={false}
              placeholder="corrected value"
              className="mt-1 w-full rounded border border-[#262626] bg-black px-2.5 py-1.5 font-mono text-xs text-white outline-none focus:border-[#8b5cf6]"
            />
          </div>
        </div>

        <label className="mt-3 block font-mono text-[10px] uppercase tracking-wider text-[#666]">reason (required — lands in the commit)</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="e.g. GT re-measured from the rendered image: …"
          className="mt-1 w-full resize-none rounded border border-[#262626] bg-black px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none focus:border-[#8b5cf6]"
        />

        <label className="mt-3 block font-mono text-[10px] uppercase tracking-wider text-[#666]">author</label>
        <input
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          placeholder="your name"
          className="mt-1 w-full rounded border border-[#262626] bg-black px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none focus:border-[#8b5cf6]"
        />

        {/* live diff */}
        <div className="mt-4 rounded border border-[#262626] bg-[#050505] p-2.5 font-mono text-[10px]">
          <p className="text-[#666]">{patch.changes[0].field}</p>
          <p className="text-[#ee6a6a]">- {current}</p>
          <p className="text-[#7ee2a8]">+ {next || "…"}</p>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded border border-[#262626] px-3 py-1.5 font-mono text-xs text-[#a1a1a1] hover:border-[#404040]">
            cancel
          </button>
          <button
            onClick={save}
            disabled={!valid || busy}
            className="rounded bg-[#8b5cf6] px-4 py-1.5 font-mono text-xs font-medium text-black transition-opacity disabled:opacity-40"
          >
            {busy ? "staging…" : "stage edit"}
          </button>
        </div>
        <p className="mt-3 font-mono text-[9px] leading-4 text-[#555]">
          staged edits are local until synced from /project → sync → one atomic commit on the upstream repo.
          the source suite is never modified.{" "}
          <a href={upstreamBlobUrl(`Dataset/${sample.img.split("/").slice(1, 3).join("/")}`)} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
            view upstream folder ↗
          </a>
        </p>
      </div>
    </div>
  );
}

function currentValue(sample: Sample, question: Question | null, sceneKey: string | null): unknown {
  if (question) return question.ground_truth;
  if (sceneKey) return sample.scene[sceneKey];
  return "";
}

function coerce(v: string): unknown {
  if (v === "") return "";
  const n = Number(v);
  if (!Number.isNaN(n) && /^-?\d+(\.\d+)?$/.test(v.trim())) return n;
  return v;
}
