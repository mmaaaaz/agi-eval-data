import { useState } from "react";
import { Edit3, Eye, EyeOff } from "lucide-react";
import type { Question } from "../lib/gripTypes";
import type { StagedEdit } from "../lib/gripTypes";

/** Render an answer_format (string prose or the dict tolerance form) as a chip. */
export function AnswerFormatChip({ format }: { format: Question["answer_format"] }) {
  if (typeof format === "string") {
    return <span className="rounded border border-[#262626] px-1.5 py-0.5 font-mono text-[9px] text-[#666]">{format}</span>;
  }
  const obj = format as Record<string, unknown>;
  if (obj.type === "numeric_tolerance" && typeof obj.tolerance_percent === "number") {
    return <span className="rounded border border-[#8b5cf6]/40 bg-[#8b5cf6]/10 px-1.5 py-0.5 font-mono text-[9px] text-[#a78bfa]">numeric · ±{obj.tolerance_percent}%</span>;
  }
  return <span className="rounded border border-[#262626] px-1.5 py-0.5 font-mono text-[9px] text-[#666]">{JSON.stringify(format)}</span>;
}

function GroundTruth({ q, revealed }: { q: Question; revealed: boolean }) {
  const gt = q.ground_truth;
  const display = typeof gt === "object" ? JSON.stringify(gt, null, 1) : String(gt);
  if (!revealed) {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[10px] text-[#555]">
        <EyeOff className="h-3 w-3" /> hidden — spoiler toggle below
      </span>
    );
  }
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded bg-[#141414] px-2 py-0.5 font-mono text-xs text-[#a78bfa]">
      <Eye className="h-3 w-3 shrink-0 self-center" />
      <span className="whitespace-pre-wrap break-all">{display}</span>
    </span>
  );
}

interface Props {
  q: Question;
  levelName: string;
  index: number;
  edit?: StagedEdit;
  onEdit: (q: Question) => void;
}

export function QuestionCard({ q, levelName, index, edit, onEdit }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`rounded-lg border bg-[#0a0a0a] p-3.5 ${edit ? "border-[#8b5cf6]/50" : "border-[#262626]"}`}>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="rounded bg-[#8b5cf6] px-1.5 py-0.5 font-mono text-[10px] font-bold text-black">
          L{q.difficulty_level}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-wider text-[#666]">{levelName}</span>
        <span className="rounded border border-[#262626] px-1.5 py-0.5 font-mono text-[9px] text-[#666]">{q.question_type}</span>
        <AnswerFormatChip format={q.answer_format} />
        {edit && (
          <span
            className="cursor-help rounded bg-[#8b5cf6]/20 px-1.5 py-0.5 font-mono text-[9px] text-[#a78bfa]"
            title={`${edit.patch.reason} — ${edit.patch.author}, ${edit.patch.editedAt}`}
          >
            edited
          </span>
        )}
      </div>
      <p className="text-sm leading-6 text-[#ededed]">{q.question_text}</p>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <div>
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1 font-mono text-[10px] text-[#666] transition-colors hover:text-accent"
          >
            {open ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            {open ? "hide" : "ground truth"}
          </button>
          {open && (
            <div className="mt-1.5">
              <GroundTruth q={q} revealed />
            </div>
          )}
        </div>
        <button
          onClick={() => onEdit(q)}
          title="propose an override (staged, synced via /project)"
          className="flex items-center gap-1 rounded border border-[#262626] px-2 py-1 font-mono text-[10px] text-[#666] transition-colors hover:border-[#8b5cf6]/50 hover:text-[#a78bfa]"
        >
          <Edit3 className="h-3 w-3" /> edit
        </button>
      </div>
      <p className="mt-2 font-mono text-[9px] text-[#3a3a3a]">{index + 1}/5 · {q.question_id}</p>
    </div>
  );
}
