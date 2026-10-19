import { PANEL } from "./models";
import { FACTS } from "./facts";
import { RUNS } from "./runs";

/** Projected costs for a full benchmark run.
 *
 *  Basis, stated on the page exactly as here:
 *  - prices are the panel's own list (scripts/harness/models.json), per million tokens;
 *  - one item = one photograph at the harness's standard pixel budget plus its question;
 *  - token counts per item are an ASSUMPTION until the first full run logs real usage;
 *    the demo runs measured latency but not tokens, so nothing here pretends otherwise;
 *  - cluster runs (vLLM) are $0 of cash: the machines belong to the group. */

export const COST_ASSUMPTIONS = {
  items: FACTS.benchmark.qaPairs,
  imageTokens: 1600,
  promptTokens: 150,
  completionTokens: 24,
  tokenNote:
    "one item costs about 1,750 input tokens (the image at the standard pixel budget plus the question) and about 24 output tokens; token counts are an assumption until the first full run logs usage",
  priceNote: `prices read from the harness panel (scripts/harness/models.json), snapshot October 2026`,
};

export const tokensPerItem = COST_ASSUMPTIONS.imageTokens + COST_ASSUMPTIONS.promptTokens;
export const outTokensPerItem = COST_ASSUMPTIONS.completionTokens;

export interface CostRow {
  id: string;
  name: string;
  tier: string;
  runsOn: string;
  free: boolean;
  promptPrice: number;
  completionPrice: number;
  /** dollars for one item */
  perItemUsd: number;
  /** dollars for the full item count */
  fullUsd: number;
}

export const fullRunUsd = (promptPrice: number, completionPrice: number, items: number) =>
  (items * (tokensPerItem * promptPrice + outTokensPerItem * completionPrice)) / 1_000_000;

export const COST_ROWS: CostRow[] = PANEL.map((m) => {
  // "free" means cash-free on the group's cluster. The hybrid row (open weights
  // whose API is also available) carries cost_tier "cheap" and is priced.
  const free = m.cost_tier === "free" && !m.runs_on.includes("API");
  const perItemUsd = (tokensPerItem * m.pricing_per_million.prompt + outTokensPerItem * m.pricing_per_million.completion) / 1_000_000;
  return {
    id: m.id,
    name: m.name,
    tier: m.tier,
    runsOn: m.runs_on,
    free,
    promptPrice: m.pricing_per_million.prompt,
    completionPrice: m.pricing_per_million.completion,
    perItemUsd,
    fullUsd: free ? 0 : fullRunUsd(m.pricing_per_million.prompt, m.pricing_per_million.completion, COST_ASSUMPTIONS.items),
  };
});

const sum = (rows: CostRow[]) => rows.reduce((n, r) => n + r.fullUsd, 0);

const cheapTier = COST_ROWS.filter((r) => !r.free && r.tier === "cheap-closed");
const frontierTier = COST_ROWS.filter((r) => r.tier === "frontier-closed");
const dsApi = COST_ROWS.find((r) => r.id === "deepseek/deepseek-v4.1-flash-1017");

/** 2,500 items = one tenth of the set: enough for a frontier smoke run at scale. */
export const FRONTIER_SLICE_ITEMS = Math.round(COST_ASSUMPTIONS.items / 10);
const frontierSlice = frontierTier.map((r) => ({
  ...r,
  fullUsd: fullRunUsd(r.promptPrice, r.completionPrice, FRONTIER_SLICE_ITEMS),
}));

const cheapFullUsd = sum(cheapTier) + (dsApi && !dsApi.free ? dsApi.fullUsd : 0);
const frontierSliceUsd = sum(frontierSlice);

export const PLAN = {
  freeModels: COST_ROWS.filter((r) => r.free).length,
  cheapFullUsd,
  frontierSliceUsd,
  everythingFullUsd: sum(COST_ROWS),
  totalUsd: cheapFullUsd + frontierSliceUsd,
};

export const SCENARIOS = [
  {
    id: "a",
    label: "A · The planned panel (recommended)",
    detail: `all ${PLAN.freeModels} open-weight models on the group's cluster at $0, the cheap API tier across all ${COST_ASSUMPTIONS.items.toLocaleString()} items, and each frontier model on a ${FRONTIER_SLICE_ITEMS.toLocaleString()}-item slice for the comparison`,
    usd: PLAN.totalUsd,
    on: true,
  },
  {
    id: "b",
    label: "B · Everything, every model, full set",
    detail: `every priceable model across all ${COST_ASSUMPTIONS.items.toLocaleString()} items`,
    usd: PLAN.everythingFullUsd,
    on: false,
  },
  {
    id: "c",
    label: "C · Cluster only",
    detail: "open-weight models on the group's machines; no API spend at all, and no frontier comparison",
    usd: 0,
    on: false,
  },
];

/** Measured on the demo runs (30 items each): the only run-timing evidence that exists yet.
 *  A serial projection is an upper bound; the harness parallelises. */
export const LATENCY_ROWS = RUNS.filter((r) => r.id !== "blind").map((r) => ({
  label: r.label,
  meanMs: r.latency.mean,
  p50Ms: r.latency.p50,
  serialHoursForFullSet: (r.latency.mean * COST_ASSUMPTIONS.items) / 3_600_000,
}));
