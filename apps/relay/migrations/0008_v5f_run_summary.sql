-- CANONICAL MIGRATION. Apply with:  npx wrangler d1 migrations apply agi-eval-questions --remote
-- Source of truth for this file is apps/relay/schema_v5f_run_summary.sql; edit there, then re-run scripts/db/sync_migrations.py.
-- v5f: the leaderboard reads a summary row instead of scanning every evaluation — 445,000 rows per page load against a 5M/day allowance was 11 page loads.

-- ===========================================================================
-- BENCHMARK SCHEMA  v5f — THE LEADERBOARD MUST NOT SCAN THE WHOLE TABLE
--
-- Owner: benchmark lead.  Run AFTER schema_v5e_run_key.sql.
--
-- WHY THIS EXISTS
-- ---------------
-- `/api/insights` ran:
--
--     SELECT model, run_id, COUNT(*), SUM(verdict='correct') ...
--     FROM evaluations WHERE verdict IS NOT NULL GROUP BY model, run_id ORDER BY ...
--
-- Measured on the real schema against a realistic campaign (29 runs x 6 models x 2,500 items
-- per run = 435,000 evaluations), EXPLAIN QUERY PLAN says:
--
--     SCAN evaluations USING INDEX idx_ev_model
--     USE TEMP B-TREE FOR GROUP BY
--     USE TEMP B-TREE FOR ORDER BY
--
-- **It scans, and it reads every evaluation row.** The endpoint also joins every evaluation to
-- its question with no LIMIT. That is ~445,000 rows read per PAGE LOAD, against a D1 free
-- allowance of 5,000,000 rows READ per day:
--
--     ~11 page loads before the daily cap is exhausted.
--
-- Eleven people opening the results page would take the database offline until midnight UTC.
-- `zero-spend.md` claimed "no endpoint scans" and "every query has an index"; that was FALSE for
-- this endpoint, and it is the one claim in this project that could have cost money.
--
-- THE FIX
-- -------
-- One row per (run, model), maintained as evaluations are written. The leaderboard reads 174
-- rows instead of 445,000 — a 2,500x reduction, and ~28,000 page loads per day instead of 11.
--
-- It is a MATERIALISED VIEW, so it can drift. The ingest endpoint recomputes the affected rows
-- from `evaluations` inside the same batch rather than incrementing them, so a retry or a
-- re-published run converges instead of double-counting. `v_run_summary_check` below reports any
-- row that disagrees, and nothing should ever select from it.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS run_summary (
  run_id       TEXT NOT NULL,
  model        TEXT NOT NULL,
  graded       INTEGER NOT NULL DEFAULT 0,
  correct      INTEGER NOT NULL DEFAULT 0,
  close        INTEGER NOT NULL DEFAULT 0,
  wrong        INTEGER NOT NULL DEFAULT 0,
  -- Errors are REPORTED, never counted as wrong answers: an item whose call failed is missing
  -- data, not a model failure. This is the same rule the live query enforced.
  not_answered INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (run_id, model)
);

CREATE INDEX IF NOT EXISTS idx_run_summary_acc ON run_summary(correct * 1.0 / NULLIF(graded, 0) DESC);

-- Backfill from whatever is already stored, so the table is correct the moment it exists.
INSERT OR REPLACE INTO run_summary (run_id, model, graded, correct, close, wrong, not_answered)
SELECT COALESCE(run_id, ''), model,
       COUNT(*),
       SUM(CASE WHEN verdict = 'correct' THEN 1 ELSE 0 END),
       SUM(CASE WHEN verdict = 'close'   THEN 1 ELSE 0 END),
       SUM(CASE WHEN verdict = 'wrong'   THEN 1 ELSE 0 END),
       SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END)
FROM evaluations
WHERE verdict IS NOT NULL
GROUP BY COALESCE(run_id, ''), model;

-- A DRIFT CHECK, not a data source. If this ever returns a row, the summary disagrees with the
-- evaluations it summarises and the leaderboard is wrong; the guard below is what notices.
CREATE VIEW IF NOT EXISTS v_run_summary_drift AS
SELECT s.run_id, s.model, s.graded AS summary_graded, e.graded AS actual_graded
FROM run_summary s
JOIN (
  SELECT COALESCE(run_id, '') AS run_id, model, COUNT(*) AS graded
  FROM evaluations WHERE verdict IS NOT NULL GROUP BY COALESCE(run_id, ''), model
) e ON e.run_id = s.run_id AND e.model = s.model
WHERE s.graded != e.graded;

-- The summary is derived, so a writer that forgets to maintain it must FAIL rather than leave
-- the leaderboard quietly wrong. This does not enforce it (SQLite cannot); it makes the check
-- part of the schema so the smoke test and any operator can run it.
SELECT COUNT(*) AS run_summary_drift FROM v_run_summary_drift;

-- ===========================================================================
-- AND THE SAME FOR byTag
-- ===========================================================================
-- `/api/insights` also ran a second query with NO LIMIT:
--
--     SELECT q.tags, e.model, e.verdict FROM evaluations e
--     JOIN questions q ON q.id = e.question_id
--     WHERE e.verdict IS NOT NULL AND e.error IS NULL
--
-- EXPLAIN QUERY PLAN: "SCAN e | SEARCH q USING INTEGER PRIMARY KEY". **A full scan of every
-- evaluation**, returning one row per evaluation to the Worker. Fixing only the leaderboard
-- left the endpoint scanning anyway — the test that asserted "the endpoint never reads
-- evaluations" is what caught the half-fix, which is why that assertion is worth keeping.
--
-- Grouped by the RAW tags string rather than split in SQL, because tags are a text column the
-- API already parses with normTags. The number of distinct tag strings is small, so this stays
-- bounded: one row per (tag-string, run, model) instead of one row per evaluation.

CREATE TABLE IF NOT EXISTS tag_summary (
  tags    TEXT NOT NULL,
  run_id  TEXT NOT NULL,
  model   TEXT NOT NULL,
  graded  INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tags, run_id, model)
);

INSERT OR REPLACE INTO tag_summary (tags, run_id, model, graded, correct)
SELECT COALESCE(q.tags, ''), COALESCE(e.run_id, ''), e.model,
       COUNT(*),
       SUM(CASE WHEN e.verdict = 'correct' THEN 1 ELSE 0 END)
FROM evaluations e
JOIN questions q ON q.id = e.question_id
WHERE e.verdict IS NOT NULL AND e.error IS NULL
GROUP BY COALESCE(q.tags, ''), COALESCE(e.run_id, ''), e.model;

SELECT COUNT(*) AS tag_summary_rows FROM tag_summary;
