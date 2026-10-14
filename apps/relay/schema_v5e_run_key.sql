-- ===========================================================================
-- BENCHMARK SCHEMA  v5e — A MEASUREMENT NEEDS ITS RUN IN THE KEY
--
-- Owner: benchmark lead.  Run AFTER schema_v5d_eval_truth.sql.
--
-- WHY THIS EXISTS
-- ---------------
-- `evaluations` is UNIQUE(question_id, model). `run_id` has been a column since v4 and the
-- harness has always written it, but it was never part of the KEY.
--
-- That was correct while a trace held one run. It is wrong now that a trace holds a SERIES:
--
--     run_crop.py            6 crop fractions into one trace
--     run_attack.py         21 conditions into one trace
--     run_counterfactual.py  1 run, but the same question appears in the original too
--
-- Posting a series therefore had each condition OVERWRITE the previous one on
-- (question_id, model), so the site kept only the LAST and showed 8 items while the trace held
-- 168. That is the round-30 defect exactly — "the site and the paper publish different numbers
-- from one trace" — and it fails the same silent way: nothing errors, and the number looks fine.
--
-- The harness now REFUSES to publish a multi-run trace rather than store one condition and call
-- it a result. This migration is what lets it stop refusing.
--
-- WHY A REBUILD AND NOT AN ALTER
-- ------------------------------
-- SQLite cannot alter a UNIQUE table constraint. `CREATE UNIQUE INDEX` would ADD a key without
-- removing the old one, so two runs of the same question would still collide on
-- UNIQUE(question_id, model). The table is therefore rebuilt.
--
-- Nothing is invented. Every column added by v4 and v5d is carried across by name, and every
-- existing row keeps its own run_id — an evaluation written before this migration had one, and
-- rewriting it to '' would silently change which run it belongs to.
-- ===========================================================================

-- THE REBUILD BREAKS THE VIEWS WITHOUT THIS. `ALTER TABLE ... RENAME` reparses every view and
-- trigger that referenced the table, and eight views here select from `evaluations`. With
-- legacy_alter_table OFF (the default) the rename fails with
--     error in view v_leaderboard: no such table: main.evaluations
-- which the migration guard caught on the first run.
--
-- legacy_alter_table ON tells SQLite to rename WITHOUT touching view bodies — correct here,
-- because the views name `evaluations` and `evaluations` is exactly what the table is called
-- again once the rename finishes. Turning it off afterwards restores normal behaviour for
-- every later migration.
PRAGMA legacy_alter_table = ON;

CREATE TABLE evaluations_v5e (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id     INTEGER NOT NULL,
  model           TEXT NOT NULL,
  run_id          TEXT NOT NULL DEFAULT '',
  response        TEXT NOT NULL DEFAULT '',
  verdict         TEXT CHECK (verdict IN ('correct','close','wrong','unanswered')),
  source          TEXT NOT NULL DEFAULT 'manual',
  graded_by       TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  -- v4
  abstained       INTEGER DEFAULT 0,
  confidence      REAL,
  frozen_verdict  TEXT,
  groundtruth_hash TEXT,
  prompt_id       TEXT,
  latency_ms      INTEGER,
  parse_ok        INTEGER DEFAULT 1,
  -- v5d
  error           TEXT,
  n_samples       INTEGER NOT NULL DEFAULT 1,
  unstable        INTEGER NOT NULL DEFAULT 0,
  -- THE KEY, with the run in it
  UNIQUE(question_id, model, run_id)
);

INSERT INTO evaluations_v5e (
  id, question_id, model, run_id, response, verdict, source, graded_by, created_at,
  abstained, confidence, frozen_verdict, groundtruth_hash, prompt_id, latency_ms, parse_ok,
  error, n_samples, unstable
)
SELECT
  id, question_id, model, COALESCE(run_id, ''), response, verdict, source, graded_by, created_at,
  abstained, confidence, frozen_verdict, groundtruth_hash, prompt_id, latency_ms, parse_ok,
  error, n_samples, unstable
FROM evaluations;

DROP TABLE evaluations;
ALTER TABLE evaluations_v5e RENAME TO evaluations;

-- DROP TABLE took the old indexes with it, so every one is recreated.
CREATE INDEX IF NOT EXISTS idx_eval_model         ON evaluations(model);
CREATE INDEX IF NOT EXISTS idx_eval_question      ON evaluations(question_id);
CREATE INDEX IF NOT EXISTS idx_eval_model_verdict ON evaluations(model, verdict);
CREATE INDEX IF NOT EXISTS idx_ev_run             ON evaluations(run_id);
CREATE INDEX IF NOT EXISTS idx_ev_model           ON evaluations(model);
CREATE INDEX IF NOT EXISTS idx_ev_frozen          ON evaluations(frozen_verdict);
CREATE INDEX IF NOT EXISTS idx_ev_gthash          ON evaluations(groundtruth_hash);

PRAGMA legacy_alter_table = OFF;
-- PROOF THE REBUILD WORKED, not just that it ran. If the views did not survive, this raises and
-- the migration fails loudly instead of leaving a database whose leaderboard reads an empty
-- table. The guard applies every migration and would catch it, but a deployed D1 gets no guard.
SELECT COUNT(*) FROM v_leaderboard;
