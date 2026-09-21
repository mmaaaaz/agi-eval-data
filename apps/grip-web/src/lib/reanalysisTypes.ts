/** Mirrors scripts/open_models_test1_reanalysis.py output (data/open-models/reanalysis.json). */

export type Cell = {
  domain: string;
  level: number;
  n: number;
  baseline: number | null;
  modal_gt: string | null;
  raw_exact: number;
  raw_published: number | null;
  exact_n: number;
  adjusted: number | null;
  n_lt_10: boolean;
};

export type Agg = {
  key?: string | number;
  macro: number | null;
  pooled: number | null;
  adjusted: number | null;
  n: number;
  correct: number;
  baseline_expected: number;
  raw_exact: number | null;
  baseline: number | null;
  cells: number;
  cells_used: number;
  cells_constant: number;
  n_lt_10: number;
  macro_ci?: [number, number] | null;
  pooled_ci?: [number, number] | null;
};

export type ModelReanalysis = {
  overall: Agg;
  supplementary_no_small_cells: { macro: number | null; cells_dropped: number; note: string };
  levels: Agg[];
  domains: Agg[];
  families: Agg[];
  cells: Cell[];
  constant_cells: Cell[];
};

export type QwenFamilyDiff = {
  family: string;
  instruct_macro: number | null;
  thinking_macro: number | null;
  difference: number | null;
  difference_ci: [number, number];
  cells: number;
};

export type Blocked = {
  status: string;
  reason: string;
  missing_input?: string;
  ready?: string;
};

export type Reanalysis = {
  generated: string;
  definitions: Record<string, string>;
  level_counts: Record<string, Record<string, number>>;
  l5_verdicts: Record<string, { verdict: string; l5_present: boolean; l5_responses: number; missing_levels: number[]; note: string }>;
  invariants: {
    one_question_per_image_per_level: { violations: unknown[]; checked_cells: number };
    ground_truth_identical_across_models: { cells_compared: number; cells_differing: unknown[]; note: string };
  };
  models: Record<string, ModelReanalysis>;
  qwen_pair?: { a: string; b: string; difference_definition: string; families: QwenFamilyDiff[] };
  serving_configuration: {
    recoverable: {
      model_identifier_stored_per_record: Record<string, Record<string, number>>;
      score_mode_distribution: Record<string, Record<string, number>>;
      run_directories: Record<string, string>;
    };
    not_recoverable: string[];
    evidence: string;
  };
  subset_8500: Blocked;
  frontier_comparison: Blocked;
};

/** Mirrors scripts/open_models_grain.py output (data/open-models/grain.json). */

export type GrainCondition = {
  condition: string;
  n: number;
  cells: number;
  grain_exact: number | null;
  main_exact: number | null;
  delta_pooled: number | null;
  delta_macro: number | null;
  delta_ci: [number, number] | null;
  n_parsed: number;
  grain_exact_parsed: number | null;
  main_exact_parsed: number | null;
  delta_parsed_pooled: number | null;
  delta_parsed_ci: [number, number] | null;
  unparsed_grain: number;
  unparsed_main: number;
};

export type GrainGroupRow = {
  key: string | number;
  condition: string;
  n: number;
  main_n: number;
  grain_exact: number | null;
  main_exact: number | null;
  delta: number | null;
};

export type GrainModel = {
  id: string;
  conditions: string[];
  per_condition: GrainCondition[];
  by_level: GrainGroupRow[];
  by_domain: GrainGroupRow[];
  by_family: GrainGroupRow[];
  completeness: Record<string, { records: number; expected: number; missing: number }>;
};

export type Grain = {
  generated: string;
  what_it_is: {
    conditions: string[];
    images_per_domain: number;
    records_per_condition: number;
    verified: string[];
    unverifiable: string[];
  };
  models: Record<string, GrainModel>;
};
