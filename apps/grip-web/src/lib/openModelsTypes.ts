/**
 * Mirrors scripts/open_models_bake.py output (data/open-models/models.json).
 * Every field is derived from the raw evaluation runs; nothing here is hand-typed.
 */

export type LevelDef = { n: number; task: string; short: string; desc: string };

export type KpiLevel = {
  n: number;
  acc: number | null;
  as: number | null;
  partial: number | null;
  pf: number;
  ci: [number, number];
  oracle?: number | null;
  kind?: GtKind | null;
};

export type Kpi = {
  n: number;
  acc: number | null;
  as: number | null;
  partial: number | null;
  pf: number;
  pfRate: number | null;
  over: number;
  under: number;
  agreement: number | null;
  ci: [number, number];
  levels: KpiLevel[];
};

export type FamilyRow = {
  name: string;
  n: number;
  acc: number | null;
  as: number | null;
  partial: number | null;
  oracle: number | null;
  levels: { acc: number | null; n: number }[];
};

export type ModelMeta = {
  label?: string;
  /** compact name for dense visuals — hand-set so it stays unique across the field */
  short?: string | null;
  org?: string | null;
  /** "thinking" | "instruct" — set only where the model name states it */
  mode?: string | null;
  params?: string | null;
  activeParams?: string | null;
  license?: string | null;
  released?: string | null;
  context?: string | null;
  accent?: string;
  notes?: string | null;
  links?: { huggingface?: string | null; paper?: string | null };
};

export type ClassRow = { name: string; n: number };
export type BandRow = { name: string; n: number };
export type ExampleRow = { domain: string; level: number; gt: string; pred: string };

export type GtPairing = {
  checked: number;
  mismatch: number;
  missing: number;
};

export type ModelEntry = {
  id: string;
  label: string;
  accent: string;
  meta: ModelMeta;
  /** ground-truth agreement with the reference run (identity for the reference) */
  gtPairing: GtPairing;
  totals: Kpi & { images: number; oracle: number | null; headroom: number | null };
  families: FamilyRow[];
  classes: ClassRow[];
  bands: BandRow[];
  examples: Record<string, ExampleRow[]>;
  drift: { mismatch: number; missing: number };
};

export type Format = {
  template: string;
  templates: number;
  example: string | null;
  exampleGt: string | null;
  answerFormat: string | null;
};

export type DomainRow = Kpi & {
  model: string;
  images: number;
  bands: Record<string, number>;
};

export type ConstantLevel = { level: number; oracle: number; top: string; distinct: number };

export type Domain = {
  key: string;
  label: string;
  family: number;
  familyName: string | null;
  n: number;
  oracle: number | null;
  oracleTop: string | null;
  oracleLevels: (number | null)[];
  distinctAnswers: number | null;
  const: ConstantLevel[];
  formats: Record<string, Format>;
  per: DomainRow[];
};

export type GtKind = "structured" | "multipart" | "plain";

export type ZeroLevel = {
  domain: string;
  label: string;
  familyName: string | null;
  level: number;
  n: number;
  category?: string;
  /** shape of the ground truth that dominates this level (bake-side classification) */
  kind?: GtKind | null;
  oracle: number | null;
  per: { model: string; acc: number | null; partial: number | null; as?: number | null }[];
};

export type Mover = {
  domain: string;
  label: string;
  familyName: string | null;
  delta: number;
  per: number[];
  n: number;
};

export type ConstantLevelRow = {
  domain: string;
  label: string;
  familyName: string | null;
  level: number;
  oracle: number;
  top: string;
  distinct: number;
  n: number;
};

export type Benchmark = {
  name: string;
  fullName: string;
  families: string[];
  levels: LevelDef[];
  domains: number;
  questionsPerModel: number;
  imagesPerModel: number;
  /** runs are not identical in size — [min, max] across the field */
  questionsRange: [number, number];
  imagesRange: [number, number];
  grader: { version: string; rules: string[] };
};

export type Artifact = {
  schema: number;
  generated: string;
  benchmark: Benchmark;
  models: ModelEntry[];
  domains: Domain[];
  audit: {
    zeroHarness: ZeroLevel[];
    zeroFrozen: ZeroLevel[];
    overCredited: Mover[];
    underCredited: Mover[];
    constantLevels: ConstantLevelRow[];
  };
  integrity: {
    dupIds: number;
    nominalPerDomain: number;
    evaluatedPerDomain: number;
    gtDrift: {
      mismatch: number;
      missing: number;
      checked: number;
      byDomain: Record<string, { n: number; mismatch: number }>;
    };
    /** cross-run pairing: every run must share one ground truth per question id */
    gtPairing: GtPairing & { reference: string | null; perModel: Record<string, GtPairing> };
  };
};
