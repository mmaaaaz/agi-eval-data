/** Mirrors scripts/grip_scan.py output shapes (data/grip/tree.json + {slug}.json.gz). */

export type Question = {
  question_id: string;
  difficulty_level: 1 | 2 | 3 | 4 | 5;
  question_text: string;
  question_type: string;
  ground_truth: string | number | object;
  answer_format: string | object;
};

export type Sample = {
  id: string;
  /** subsuite: "main" = the canonical 5-level suite; others are snapshot dirs */
  sub: string;
  /** legacy snapshot (4-level era, or non-main subsuite) */
  legacy: boolean;
  /** repo-relative image path, e.g. Dataset/route_dataset_3000/images/route_puzzle_0001.png */
  img: string;
  seed: number | null;
  score: number | null;
  canvas: [number, number] | [number | null, number | null];
  scene: Record<string, unknown>;
  q: Question[];
};

export type Subsuite = { id: string; hasAnnotations: boolean };
export type GalleryNode = { id: string; images: number };

export type Category = {
  slug: string;
  folder: string;
  name: string;
  family: "geometric" | "physical";
  geometryClass: string;
  images: number;
  imagesMain: number;
  questions: number;
  questionsMain: number;
  legacyImages: number;
  subsuites: Subsuite[];
  galleries: GalleryNode[];
  docs: string[];
  questionTypes: string[];
  score: { min: number; mean: number; max: number } | null;
  overridesApplied: number;
  modifiedSampleIds: string[];
};

export type GripTree = {
  version: number;
  builtAt: string;
  bakedFromCommit: string;
  upstreamRepo: string;
  counts: {
    categories: number;
    images: number;
    questions: number;
    imagesMain: number;
    questionsMain: number;
    legacyImages: number;
    levels: Record<string, number>;
  };
  levelNames: Record<string, string>;
  categories: Category[];
};

export type CategoryDetail = {
  slug: string;
  records: Sample[];
};

/** A staged (not-yet-synced) override patch, as stored by the grip-sync worker. */
export type StagedEdit = {
  slug: string;
  sampleId: string;
  patch: {
    version: number;
    author: string;
    reason: string;
    editedAt: string;
    baseCommitAtEdit?: string;
    changes: { field: string; from?: unknown; to: unknown }[];
  };
};
