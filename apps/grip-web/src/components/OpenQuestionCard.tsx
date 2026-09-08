import { useState } from "react";
import { Edit3, Eye, EyeOff, Sigma } from "lucide-react";
import type { OpenQuestion } from "../lib/gripTypes";
import type { StagedEdit } from "../lib/gripTypes";

function ToleranceChip({ tol }: { tol: { absolute_tolerance?: number; unit?: string } }) {
  if (tol.absolute_tolerance == null && !tol.unit) return null;
  const amount = tol.absolute_tolerance != null ? `±${tol.absolute_tolerance}` : "";
  const unit = tol.unit ? ` ${tol.unit}` : "";
  return (
    <span className="rounded border border-[#8b5cf6]/40 bg-[#8b5cf6]/10 px-1.5 py-0.5 font-mono text-[9px] text-[#a78bfa]">
      {amount}{unit}
    </span>
  );
}

/** The open-loop question: a single multi-part prompt whose sub-facts carry
 *  per-field tolerances and an acceptance set (the answer key). Acceptance is
 *  spoiler-hidden, exactly like closed ground truths. */
export function OpenQuestionCard({
  oq,
  edit,
  onEdit,
}: {
  oq: OpenQuestion;
  edit?: StagedEdit;
  onEdit: (oq: OpenQuestion) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const subfactKeys = Object.keys(oq.subfacts);

  return (
    <div className={`rounded-lg border bg-[#0a0a0a] p-3.5 ${edit ? "border-[#8b5cf6]/50" : "border-[#8b5cf6]/30"}`}>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="rounded bg-[#8b5cf6] px-1.5 py-0.5 font-mono text-[10px] font-bold text-black">OPEN</span>
        <span className="font-mono text-[9px] uppercase tracking-wider text-[#666]">open-ended reasoning</span>
        <span className="flex items-center gap-1 rounded border border-[#262626] px-1.5 py-0.5 font-mono text-[9px] text-[#666]">
          <Sigma className="h-3 w-3" /> confidence 0–1
        </span>
        {oq.dataset_version && (
          <span className="rounded border border-[#262626] px-1.5 py-0.5 font-mono text-[9px] text-[#666]">
            {oq.dataset_version}
          </span>
        )}
        {edit && (
          <span
            className="cursor-help rounded bg-[#8b5cf6]/20 px-1.5 py-0.5 font-mono text-[9px] text-[#a78bfa]"
            title={`${edit.patch.reason} — ${edit.patch.author}, ${edit.patch.editedAt}`}
          >
            edited
          </span>
        )}
      </div>

      <p className="text-sm leading-6 text-[#ededed]">{oq.prompt}</p>

      {/* sub-facts */}
      {subfactKeys.length > 0 && (
        <dl className="mt-3 divide-y divide-[#141414] rounded border border-[#262626]">
          {subfactKeys.map((k) => (
            <div key={k} className="grid grid-cols-[minmax(100px,40%)_1fr_auto] items-center gap-2 px-2.5 py-1.5">
              <dt className="truncate font-mono text-[10px] text-[#666]" title={k}>{k}</dt>
              <dd className="break-all font-mono text-xs text-[#ededed]">
                {oq.subfacts[k] === null || oq.subfacts[k] === undefined
                  ? "—"
                  : typeof oq.subfacts[k] === "object"
                    ? JSON.stringify(oq.subfacts[k])
                    : String(oq.subfacts[k])}
              </dd>
              <dd>{oq.tolerances?.[k] && <ToleranceChip tol={oq.tolerances[k]} />}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          onClick={() => setRevealed((v) => !v)}
          className="flex items-center gap-1 font-mono text-[10px] text-[#666] transition-colors hover:text-accent"
        >
          {revealed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          {revealed ? "hide" : "acceptance set"}
        </button>
        <button
          onClick={() => onEdit(oq)}
          title="propose an override (staged, synced via /project)"
          className="flex items-center gap-1 rounded border border-[#262626] px-2 py-1 font-mono text-[10px] text-[#666] transition-colors hover:border-[#8b5cf6]/50 hover:text-[#a78bfa]"
        >
          <Edit3 className="h-3 w-3" /> edit
        </button>
      </div>
      {revealed && (
        <div className="mt-2 space-y-1.5">
          {oq.acceptance_set.map((a, i) => (
            <p key={i} className="break-all rounded bg-[#141414] px-2 py-1 font-mono text-xs text-[#a78bfa]">
              {a}
            </p>
          ))}
          {oq.scoring?.partial_credit_fields?.length > 0 && (
            <p className="font-mono text-[9px] text-[#555]">
              partial credit fields: {oq.scoring.partial_credit_fields.join(", ")}
            </p>
          )}
        </div>
      )}
      <p className="mt-2 font-mono text-[9px] text-[#3a3a3a]">{oq.question_id}</p>
    </div>
  );
}
