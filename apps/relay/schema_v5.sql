-- ===========================================================================
-- BENCHMARK SCHEMA MIGRATION  v4 -> v5
--
-- Owner: benchmark lead.  Run AFTER schema_v4.sql, BEFORE the first item is authored.
--
-- WHY THIS EXISTS
-- ---------------
-- v4 made the database able to *describe* the benchmark. v5 makes it able to
-- *express the paper's claim*: a geometry probe and a physics probe about the same
-- object in the same image, scored as a 2x2 that separates
--     did not see  /  saw but misjudged geometry  /  right geometry wrong physics  /  guessing
--
-- It also fixes one latent bug in v4 and adds the tables open authoring needs.
--
-- Additive and safe to run against a live database. Every new column is nullable
-- or has a default, so v3/v4 keep working unchanged.
--
-- Run with:  npx wrangler d1 execute agi-eval-questions --remote --file schema_v5.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- FIX 1: v4 created v_confidence_x_instability, which JOINs a table that does
-- not exist. SQLite does not validate a view's dependencies at creation time, so
-- the view exists but throws "no such table: main.instability" on any query.
-- Creating the table it expects fixes the view without touching the view.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS instability (
  item_key     TEXT PRIMARY KEY,
  weighted_flip REAL NOT NULL DEFAULT 0,   -- share of semantics-preserving variants that flipped the answer
  n_variants   INTEGER NOT NULL DEFAULT 0,
  computed_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- FIX 2 (deliberate, read this): questions.status defaults to 'approved' in v3.
-- Under the two-doors model every open write must land as a DRAFT, and a column
-- default cannot be altered in SQLite without rebuilding the table. The API sets
-- status explicitly on every insert, so the default is never relied upon; the
-- rebuild is provided separately as schema_v5b_status_default.sql for the moment
-- the table is empty. Do NOT rebuild while rows exist.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- questions: the paper's classification and pairing axis
-- ---------------------------------------------------------------------------
ALTER TABLE questions ADD COLUMN capability     TEXT;    -- G1..G8 | P1..P8 | B1..B4 | PERC
ALTER TABLE questions ADD COLUMN level          TEXT;    -- L1..L5
ALTER TABLE questions ADD COLUMN pair_id        TEXT;    -- groups the probes asked about one anchor
ALTER TABLE questions ADD COLUMN pair_role      TEXT;    -- geometry | physics | perception
ALTER TABLE questions ADD COLUMN counterfactual_of INTEGER; -- the item this is the edited twin of
ALTER TABLE questions ADD COLUMN grounding_box  TEXT;    -- JSON [x1,y1,x2,y2] in ORIGINAL image pixels
ALTER TABLE questions ADD COLUMN generator      TEXT;    -- model id, or 'human'
ALTER TABLE questions ADD COLUMN verifier       TEXT;    -- model id that cross-checked it
ALTER TABLE questions ADD COLUMN review_status  TEXT NOT NULL DEFAULT 'pending'; -- pending|accepted|fixed|rejected
ALTER TABLE questions ADD COLUMN reviewer       TEXT;
ALTER TABLE questions ADD COLUMN review_reason  TEXT;
ALTER TABLE questions ADD COLUMN image_edit     TEXT;    -- NULL | typographic_en | patch | corruption:haze@3 ...
ALTER TABLE questions ADD COLUMN canary         TEXT;
ALTER TABLE questions ADD COLUMN rev            INTEGER NOT NULL DEFAULT 0;  -- optimistic concurrency
ALTER TABLE questions ADD COLUMN actor_id       TEXT NOT NULL DEFAULT '';    -- stable identity, never an email
ALTER TABLE questions ADD COLUMN actor_name     TEXT NOT NULL DEFAULT '';
ALTER TABLE questions ADD COLUMN deleted_at     TEXT;    -- soft delete only

-- ---------------------------------------------------------------------------
-- question_revisions: every save is immutable, so an open door is safe.
-- This is ALSO the rate-limit source: a per-actor write count in the last minute
-- is one indexed count over a table we already need, so rate limiting costs no
-- extra write and needs no paid binding.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS question_revisions (
  rev_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL,
  seq        INTEGER NOT NULL,
  op         TEXT NOT NULL DEFAULT 'update',   -- insert | update | delete | restore | review
  actor_id   TEXT NOT NULL DEFAULT '',
  actor_name TEXT NOT NULL DEFAULT '',
  patch      TEXT NOT NULL,                    -- full row state as JSON, before or after per op
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- selections: which images enter the benchmark.
-- ABSENCE OF A ROW MEANS UNDECIDED. Never store an undecided row: that is what
-- keeps triaging 56,000 images inside the free write quota.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS selections (
  file_id    TEXT PRIMARY KEY,
  state      TEXT NOT NULL CHECK (state IN ('proposed','nominated','chosen','excluded')),
  reason     TEXT NOT NULL DEFAULT '',
  stratum    TEXT NOT NULL DEFAULT '',
  actor_id   TEXT NOT NULL DEFAULT '',
  actor_name TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- change_log: a single monotonic cursor so clients sync without scanning.
-- A poll costs one indexed row read, not a table scan.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS change_log (
  seq       INTEGER PRIMARY KEY AUTOINCREMENT,
  entity    TEXT NOT NULL,          -- question | selection
  entity_id TEXT NOT NULL,
  op        TEXT NOT NULL,          -- insert | update | delete | review | select
  actor_id  TEXT NOT NULL DEFAULT '',
  at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- indexes: one per query the API and the paper actually run
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_q_cap        ON questions(capability, level);
CREATE INDEX IF NOT EXISTS idx_q_pair       ON questions(pair_id);
CREATE INDEX IF NOT EXISTS idx_q_review     ON questions(review_status);
CREATE INDEX IF NOT EXISTS idx_q_deleted    ON questions(deleted_at);
CREATE INDEX IF NOT EXISTS idx_q_edit       ON questions(image_edit);
CREATE INDEX IF NOT EXISTS idx_q_actor_rate ON questions(actor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_q_status_cap ON questions(status, capability);
CREATE INDEX IF NOT EXISTS idx_rev_q        ON question_revisions(question_id, seq);
CREATE INDEX IF NOT EXISTS idx_rev_actor    ON question_revisions(actor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sel_state    ON selections(state);
CREATE INDEX IF NOT EXISTS idx_chg_seq      ON change_log(seq);

-- ---------------------------------------------------------------------------
-- VIEWS: the paper's tables, so they cannot drift from the data
-- ---------------------------------------------------------------------------

-- What may enter a release: approved, not deleted, fully classified.
-- A paired bridge item must also carry a pair_id, or it cannot support the claim.
CREATE VIEW IF NOT EXISTS v_release_items AS
SELECT q.id, q.file_id, q.question, q.answer, q.choices, q.answer_type, q.tolerance,
       q.capability, q.level, q.pair_id, q.pair_role, q.counterfactual_of,
       q.grounding_box, q.image_edit, q.canary, q.review_status
FROM questions q
WHERE q.status = 'approved'
  AND q.deleted_at IS NULL
  AND q.capability IS NOT NULL
  AND q.level IS NOT NULL;

-- Paired bridge items that are missing their twin, or missing a pair_id entirely.
-- The integrity gate reports this; it should trend to zero.
CREATE VIEW IF NOT EXISTS v_unpaired_bridge AS
SELECT q.id, q.file_id, q.capability, q.pair_id, q.pair_role
FROM questions q
WHERE q.deleted_at IS NULL
  AND q.capability LIKE 'B%'
  AND (q.pair_id IS NULL OR q.pair_role IS NULL);

-- One row per (model, pair): did the model get the geometry probe and the physics
-- probe on the same anchor right?
CREATE VIEW IF NOT EXISTS v_pair_cells AS
SELECT model, pair_id, MAX(geo_ok) AS geo_ok, MAX(phys_ok) AS phys_ok
FROM (
  SELECT e.model AS model,
         q.pair_id AS pair_id,
         CASE WHEN q.pair_role = 'geometry' AND e.frozen_verdict = 'correct' THEN 1 ELSE 0 END AS geo_ok,
         CASE WHEN q.pair_role = 'physics'  AND e.frozen_verdict = 'correct' THEN 1 ELSE 0 END AS phys_ok
  FROM evaluations e
  JOIN questions q ON q.id = e.question_id
  WHERE q.pair_id IS NOT NULL
    AND q.pair_role IN ('geometry','physics')
    AND q.deleted_at IS NULL
) GROUP BY model, pair_id;

-- THE HEADLINE TABLE: the 2x2 decomposition, per model.
CREATE VIEW IF NOT EXISTS v_pair_breakdown AS
SELECT model,
       CASE WHEN geo_ok = 1 AND phys_ok = 1 THEN 'understands'
            WHEN geo_ok = 1 AND phys_ok = 0 THEN 'physics_gap'
            WHEN geo_ok = 0 AND phys_ok = 0 THEN 'geometry_or_perception_gap'
            ELSE 'guessing_from_priors' END AS cell,
       COUNT(*) AS n
FROM v_pair_cells
GROUP BY model, cell;

-- Leaderboard that respects the release boundary (approved, not deleted).
CREATE VIEW IF NOT EXISTS v_leaderboard_v5 AS
SELECT e.model,
       COUNT(*)                                             AS n,
       AVG(e.frozen_verdict = 'correct')                    AS accuracy,
       AVG(CASE WHEN e.abstained = 1 THEN 1.0 ELSE 0.0 END) AS abstention_rate,
       AVG(e.confidence)                                    AS mean_confidence,
       AVG(e.parse_ok)                                      AS parse_ok_rate
FROM evaluations e
JOIN questions q ON q.id = e.question_id
WHERE q.status = 'approved' AND q.deleted_at IS NULL
GROUP BY e.model;

-- v5 contract note
-- ---------------------------------------------------------------------------
-- After this migration the export endpoint MUST additionally emit:
--   capability, level, pair_id, pair_role, counterfactual_of, grounding_box,
--   image_edit, canary, review_status, rev, deleted_at IS NULL
-- The harness must refuse to run against a release whose groundtruth_hash does
-- not match the run's stored hash.
-- ===========================================================================
