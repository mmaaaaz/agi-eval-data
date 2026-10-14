-- ===========================================================================
-- BENCHMARK SCHEMA MIGRATION  v3 -> v4
--
-- Owner: benchmark lead.  Run BEFORE the first question is authored.
--
-- WHY THIS EXISTS
-- ---------------
-- The current v3 schema is a working authoring tool, but it cannot carry the
-- claims the paper makes. Specifically it cannot store:
--
--   * a tolerance for numeric answers      -> cannot reproduce a frozen grade
--   * whether the question NEEDS the image -> the blind-guessability screen
--   * a second annotator                   -> no agreement statistic exists
--   * provenance / release state           -> cannot describe the corpus honestly
--   * model confidence or abstention       -> the entire thesis
--   * a ground-truth hash                  -> cannot refuse an unpaired comparison
--
-- v3 keeps working unchanged. Every new column is nullable, so this is
-- additive and safe to run against a live database.
--
-- SQLite / Cloudflare D1. Run with:  bun run db:migrate   (or paste into wrangler d1 execute)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- questions: the six columns the paper depends on
-- ---------------------------------------------------------------------------
ALTER TABLE questions ADD COLUMN tolerance      REAL;      -- numeric band; REQUIRED for answer_type='number'
ALTER TABLE questions ADD COLUMN answer_basis   TEXT;      -- visible | knowledge | inferred
ALTER TABLE questions ADD COLUMN unanswerable_reason TEXT;  -- '' | occlusion | out_of_frame
                                                          -- | indeterminate_spatial | absent_entity
                                                          -- | insufficient_resolution
                                                          -- | requires_world_knowledge
ALTER TABLE questions ADD COLUMN annotator_2    TEXT;      -- blind second annotator's answer
ALTER TABLE questions ADD COLUMN annotator_2_id TEXT;      -- stable id, not an email
ALTER TABLE questions ADD COLUMN release_image  TEXT;      -- public, content-addressed ref for release
ALTER TABLE questions ADD COLUMN pii_flag       TEXT DEFAULT 'unchecked'; -- unchecked|clear|flagged|excluded
ALTER TABLE questions ADD COLUMN quota_stratum  TEXT;      -- orientation/resolution/camera bucket
ALTER TABLE questions ADD COLUMN blind_passed  INTEGER;   -- 1 = answered correctly with NO image
                                                          -- (item is vision-independent -> rewrite)

-- ---------------------------------------------------------------------------
-- evaluations: the model's epistemic state, which is the whole paper
-- ---------------------------------------------------------------------------
ALTER TABLE evaluations ADD COLUMN abstained      INTEGER DEFAULT 0;  -- model declined
ALTER TABLE evaluations ADD COLUMN confidence     REAL;               -- elicited 0-1, nullable
ALTER TABLE evaluations ADD COLUMN frozen_verdict TEXT;               -- frozen rule's call, beside the human's
ALTER TABLE evaluations ADD COLUMN groundtruth_hash TEXT;             -- refuse to pair a run whose labels drifted
ALTER TABLE evaluations ADD COLUMN run_id         TEXT;               -- tie every row to a frozen run
ALTER TABLE evaluations ADD COLUMN prompt_id      TEXT;               -- which elicitation arm produced this
ALTER TABLE evaluations ADD COLUMN latency_ms     INTEGER;
ALTER TABLE evaluations ADD COLUMN parse_ok       INTEGER DEFAULT 1;

-- ---------------------------------------------------------------------------
-- runs: one row per (model, prompt, settings) execution
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS runs (
  run_id        TEXT PRIMARY KEY,
  model         TEXT NOT NULL,
  provider      TEXT NOT NULL DEFAULT '',
  prompt_arm    TEXT NOT NULL DEFAULT 'plain',   -- plain|verbalised|topk|avg_conf
  temperature   REAL NOT NULL DEFAULT 0.0,
  top_p         REAL,
  max_tokens    INTEGER NOT NULL DEFAULT 512,
  image_url_tpl TEXT,                            -- how the image was delivered
  started_at    TEXT NOT NULL DEFAULT (datetime('now')),
  n_items       INTEGER NOT NULL DEFAULT 0,
  notes         TEXT NOT NULL DEFAULT ''
);

-- ---------------------------------------------------------------------------
-- annotations: per-image provenance, so the corpus can be described honestly
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS image_provenance (
  file_id     TEXT PRIMARY KEY,
  tier        TEXT NOT NULL,     -- dataset_asset | phone_vsco | camera_original | unknown
  naming      TEXT NOT NULL,     -- the filename convention detected
  has_exif    INTEGER NOT NULL DEFAULT 0,
  camera_model TEXT,
  stored_w    INTEGER,
  stored_h    INTEGER,
  true_mp     REAL,              -- measured from decoded bytes, NOT from metadata
  pii         TEXT NOT NULL DEFAULT 'unchecked',
  release_ok  INTEGER NOT NULL DEFAULT 0,
  audited_at  TEXT
);

-- ---------------------------------------------------------------------------
-- human ceiling: the number reviewers look for, computed not asserted
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS human_ceiling (
  item_key    TEXT PRIMARY KEY,
  gold        TEXT NOT NULL,
  gold_alt    TEXT,              -- an equally defensible alternative answer, if any
  n_annotators INTEGER NOT NULL DEFAULT 0,
  n_agree     INTEGER NOT NULL DEFAULT 0,
  computed    REAL,              -- filled by make_tables.py
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- indexes: the queries the paper actually runs
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_q_basis    ON questions(answer_basis);
CREATE INDEX IF NOT EXISTS idx_q_stratum  ON questions(quota_stratum);
CREATE INDEX IF NOT EXISTS idx_q_pii      ON questions(pii_flag);
CREATE INDEX IF NOT EXISTS idx_q_dbl      ON questions(annotator_2);
CREATE INDEX IF NOT EXISTS idx_q_tol      ON questions(answer_type, tolerance);
CREATE INDEX IF NOT EXISTS idx_ev_run     ON evaluations(run_id);
CREATE INDEX IF NOT EXISTS idx_ev_model   ON evaluations(model);
CREATE INDEX IF NOT EXISTS idx_ev_frozen  ON evaluations(frozen_verdict);
CREATE INDEX IF NOT EXISTS idx_ev_gthash  ON evaluations(groundtruth_hash);
CREATE INDEX IF NOT EXISTS idx_prov_tier ON image_provenance(tier);

-- ---------------------------------------------------------------------------
-- VIEWS: the paper's tables are views, so they cannot drift from the data
-- ---------------------------------------------------------------------------

-- T2 main leaderboard, with the baselines reviewers expect
CREATE VIEW IF NOT EXISTS v_leaderboard AS
SELECT
  e.model,
  COUNT(*)                                        AS n_graded,
  AVG(e.frozen_verdict = 'correct')               AS accuracy,
  AVG(CASE WHEN e.abstained = 1 THEN 1.0 ELSE 0.0 END) AS abstention_rate,
  AVG(e.confidence)                               AS mean_confidence,
  AVG(e.parse_ok)                                 AS parse_ok_rate
FROM evaluations e
GROUP BY e.model;

-- T4 the 2x2: stated confidence x perturbation instability
-- NOTE: instability comes from 04_perturb.py and is joined on at analysis time.
CREATE VIEW IF NOT EXISTS v_confidence_x_instability AS
SELECT
  e.model,
  CASE WHEN e.confidence < 0.33 THEN 'low'
       WHEN e.confidence < 0.67 THEN 'mid' ELSE 'high' END        AS confidence_bin,
  CASE WHEN i.weighted_flip < 0.15 THEN 'stable'
       WHEN i.weighted_flip < 0.35 THEN 'unstable'
       ELSE 'chaotic' END                                        AS instability_bin,
  COUNT(*)                                                        AS n,
  AVG(e.frozen_verdict = 'correct')                               AS accuracy,
  AVG(e.confidence)                                              AS mean_confidence
FROM evaluations e
JOIN instability i ON i.item_key = e.question_id
GROUP BY e.model, confidence_bin, instability_bin;

-- T5 the decomposition: accuracy split by annotator agreement
CREATE VIEW IF NOT EXISTS v_agreement_bands AS
SELECT
  e.model,
  CASE WHEN h.n_annotators >= 2 AND h.n_agree = h.n_annotators THEN 'unanimous'
       WHEN h.n_annotators >= 2 AND h.n_agree * 2 >= h.n_annotators THEN 'majority'
       ELSE 'single_or_contested' END                            AS agreement_band,
  COUNT(*)                                                        AS n,
  AVG(e.frozen_verdict = 'correct')                               AS accuracy
FROM evaluations e
JOIN human_ceiling h ON h.item_key = e.question_id
GROUP BY e.model, agreement_band;

-- ---------------------------------------------------------------------------
-- v4 contract note
-- ---------------------------------------------------------------------------
-- After this migration the export endpoint MUST additionally emit:
--   tolerance, answer_basis, unanswerable_reason, annotator_2_id,
--   release_image, pii_flag, quota_stratum
-- Update packages/questions-api/src/index.ts export block accordingly, then
-- bump data/latest.json consumers. See docs/runbook.md §MIGRATION.
--
-- Invariants the gate (03_verify.py) checks against these tables:
--   C2.5 every answer_type='number' row has a non-null tolerance
--   C2.6 every answer_type='choice' row has choices
--   C5.x annotator_2 present on >= 15% of rows
--   C6.x every verdict in (correct, close, wrong, unanswered)
-- ---------------------------------------------------------------------------