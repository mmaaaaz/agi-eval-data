/** Formatting + metric helpers shared by every open-models page. */
import type { Artifact, Domain, DomainRow, ModelEntry } from "./openModelsTypes";

export const fmtInt = (n: number | null | undefined): string => (n == null ? "—" : n.toLocaleString("en-US"));

export const pct = (x: number | null | undefined, digits = 1): string =>
  x == null ? "—" : (x * 100).toFixed(digits) + "%";

export const ppInt = (x: number | null | undefined): string => (x == null ? "—" : Math.round(x * 100).toString());

export const signed = (x: number | null | undefined, digits = 1): string =>
  x == null ? "—" : (x > 0 ? "+" : "") + (x * 100).toFixed(digits);

export const ciText = (ci: [number, number] | undefined): string =>
  !ci ? "" : (ci[0] * 100).toFixed(1) + "–" + (ci[1] * 100).toFixed(1) + "%";

export const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** Sequential ramp used by the heat grids: near-black -> violet -> warm white. */
export function ramp(t: number): string {
  const stops: [number, number, number][] = [
    [17, 17, 24],
    [49, 46, 90],
    [91, 68, 168],
    [139, 92, 246],
    [196, 168, 253],
    [240, 232, 255],
  ];
  const x = clamp01(t) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
  return "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
}

export function inkOn(t: number): string {
  return t > 0.62 ? "#0a0a0a" : "#ededed";
}

export const modelIndex = (a: Artifact, id: string): number => a.models.findIndex((m) => m.id === id);

export function rowFor(d: Domain, modelId: string): DomainRow | undefined {
  return d.per.find((p) => p.model === modelId);
}

export function accOf(d: Domain, modelId: string): number | null {
  return rowFor(d, modelId)?.acc ?? null;
}

/** Sorted copy of models, best accuracy first - the leaderboard order. */
export function ranked(models: ModelEntry[]): ModelEntry[] {
  return [...models].sort((x, y) => (y.totals.acc ?? 0) - (x.totals.acc ?? 0));
}

export type Metric = "acc" | "as" | "partial" | "headroom";

/**
 * One name per idea, used on every page. Only `acc` is an accuracy — the rest
 * are context (how it compares to guessing), a formatting diagnostic, or a
 * cross-check from the run's own scorer.
 */
export const METRICS: { id: Metric; label: string; short: string; hint: string }[] = [
  { id: "acc", label: "Accuracy", short: "accuracy", hint: "Correct ÷ questions, under the one published grading rule. The headline number." },
  {
    id: "as",
    label: "The run's own scorer",
    short: "own scorer",
    hint: "What the run's own harness reported for the same answers. A cross-check on our rule, not a second ability.",
  },
  { id: "partial", label: "Partly right", short: "partly right", hint: "Mean share of ground-truth parts matched — half marks, not accuracy." },
  { id: "headroom", label: "Vs guessing", short: "vs guessing", hint: "Accuracy minus the majority-answer baseline (13.76%): is it really looking at the image?" },
];

export const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/** Average across the whole field for one slice (equal weight per run). */
export function fieldMean(
  models: { id: string }[],
  pick: (modelId: string) => { acc: number | null; as: number | null; partial: number | null; oracle?: number | null },
  metric: Metric,
): number | null {
  const vs = models.map((m) => pick(m.id)).map((v) => metricValue(v, metric));
  return mean(vs.filter((v): v is number => v != null));
}

export function metricValue(
  k: { acc: number | null; as: number | null; partial: number | null; oracle?: number | null },
  metric: Metric,
): number | null {
  switch (metric) {
    case "acc":
      return k.acc;
    case "as":
      return k.as;
    case "partial":
      return k.partial;
    case "headroom":
      return k.acc != null && k.oracle != null ? k.acc - k.oracle : null;
  }
}
