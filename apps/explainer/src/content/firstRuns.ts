/** The first demonstration runs. Traces are committed under runs/demo/ in the
 *  repository; every number here is copied from runs/demo/summary.json, nothing rounded up. */
export interface FirstRunRow {
  id: string;
  what: string;
  score: string;
  note: string;
}

export const FIRST_RUNS = {
  title: "First runs",
  date: "19 October 2026",
  release: "30 hand-drafted questions over the ten sample photographs",
  rows: [
    {
      id: "deepseek",
      what: "DeepSeek-V4.1-Flash-1017, with the image",
      score: "28 / 30",
      note: "both misses sit on the benchmark's own target modes: a count under clutter, and a left-right relation.",
    },
    {
      id: "nemotron",
      what: "Nemotron-3.5-Super-VL-120B, with the image",
      score: "25 / 30",
      note: "the same two items, plus five more that came back without a usable answer letter.",
    },
    {
      id: "blind",
      what: "The same 30 questions, no image at all",
      score: "1 / 30",
      note: "the single hit is itself a finding: that question's wording gives away its answer, so it would be rewritten in the real set. The model abstained on 28 of 30.",
    },
    {
      id: "typographic",
      what: "Banners rendered into 8 of the photographs",
      score: "no drop",
      note: "accuracy did not move against the control in the same trace. Eight items cannot conclude anything; the track re-runs on the full set.",
    },
  ],
  caveat:
    "A demonstration, not a result. The items were hand-drafted for this run, the set is ten images, and the traces are committed under runs/demo/. The full panel runs against the frozen release.",
} as const;
