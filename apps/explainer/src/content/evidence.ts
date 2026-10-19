import { SAMPLES } from "./samples";
import { RUNS } from "./runs";
import type { RunItem } from "./runs";

/** Derives the image-first evidence board from the generated run data:
 *  every photograph that ran in the demo, its five questions, and each
 *  model's verdict on each question. Nothing here is hand-copied; it is a
 *  join of runs.ts (traces) and samples.ts (the photographs). */

export interface RunCell {
  verdict: RunItem["verdict"];
  response: string;
  responseText: string | null;
  latencyMs: number;
}

export interface EvidenceQuestion {
  qid: number;
  question: string;
  answer: string;
  capability: string;
  level: string;
  cells: Record<string, RunCell>;
}

export interface ImageEvidence {
  id: string;
  name: string;
  domain: string;
  caps: string[];
  levels: string[];
  thumbUrl: string;
  sourceUrl: string;
  questions: EvidenceQuestion[];
  scores: Record<string, { correct: number; n: number; parseFail: number; abstained: number }>;
  anyMiss: boolean;
}

export const EVIDENCE_RUNS = RUNS.map((r) => ({ id: r.id, label: r.label, n: r.n }));

const qidsByFile = new Map<string, Set<number>>();
for (const run of RUNS) {
  for (const it of run.items) {
    const set = qidsByFile.get(it.fileId) ?? new Set<number>();
    set.add(it.qid);
    qidsByFile.set(it.fileId, set);
  }
}

const itemFor = (runId: string, fileId: string, qid: number): RunItem | undefined =>
  RUNS.find((r) => r.id === runId)?.items.find((it) => it.fileId === fileId && it.qid === qid);

export const EVIDENCE: ImageEvidence[] = SAMPLES.filter((s) => qidsByFile.has(s.id)).map((s) => {
  const qids = [...(qidsByFile.get(s.id) ?? new Set<number>())].sort((a, b) => a - b);
  const allItems = RUNS.flatMap((r) => r.items);
  const questions = qids.map((qid) => {
    const meta = allItems.find((it) => it.fileId === s.id && it.qid === qid);
    const cells: Record<string, RunCell> = {};
    for (const run of RUNS) {
      const it = itemFor(run.id, s.id, qid);
      cells[run.id] = {
        verdict: it?.verdict ?? "abstained",
        response: it?.response ?? "",
        responseText: it?.responseText ?? null,
        latencyMs: it?.latencyMs ?? 0,
      };
    }
    return {
      qid,
      question: meta?.question ?? `Item ${qid}`,
      answer: meta?.answer ?? "",
      capability: meta?.capability ?? "",
      level: meta?.level ?? "",
      cells,
    };
  });
  const scores: ImageEvidence["scores"] = {};
  let anyMiss = false;
  for (const run of RUNS) {
    const qItems = run.items.filter((it) => it.fileId === s.id);
    scores[run.id] = {
      correct: qItems.filter((it) => it.verdict === "correct").length,
      n: qItems.length,
      parseFail: qItems.filter((it) => it.verdict === "parse_fail").length,
      abstained: qItems.filter((it) => it.verdict === "abstained").length,
    };
    if (scores[run.id].correct < scores[run.id].n) anyMiss = true;
  }
  return {
    id: s.id,
    name: s.name,
    domain: s.domain,
    caps: s.caps,
    levels: s.levels,
    thumbUrl: s.thumbUrl,
    sourceUrl: s.sourceUrl,
    questions,
    scores,
    anyMiss,
  };
});
