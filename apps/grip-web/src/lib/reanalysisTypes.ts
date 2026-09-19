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
