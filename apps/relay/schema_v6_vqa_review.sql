-- ===========================================================================
-- BENCHMARK SCHEMA  v6 — THE REVIEW ROOM FOR MODEL-DRAFTED VQA CANDIDATES
--
-- Owner: benchmark lead.  Run AFTER schema_v5g_selection_votes.sql.
--
-- WHY THIS EXISTS
-- ---------------
-- The drafting programme produces five candidate questions per photograph in
-- runs/generation/<batch>/candidates.jsonl. Nothing carries them into a place a
-- person can look at. This schema is that place: the candidate table and its
-- review trail.
--
-- Three rules are structural here, not conventions:
--
--   1. A CANDIDATE IS NOT GROUND TRUTH. It lands `pending` and only a review
--      row with the reviewer code can move it to approved/edited/rejected. The
--      questions table (the live authoring state) is never written by ingest.
--
--   2. THE REVIEW TRAIL IS THE EVIDENCE. Every decision is appended to
--      vqa_reviews with reviewer identity, verdict, reason and the exact fields
--      changed. A candidate's status is the latest decision; the rows are how
--      the decision is argued later.
--
--   3. INGEST IS IDEMPOTENT. UNIQUE(batch, file_id, qnorm) means re-posting a
--      resumed run inserts nothing twice, which matters because the drafting
--      runner retries images and the ingest is expected to be re-run.
--
-- Provenance columns (model, endpoint, prompt_version, run_id, image_sha256)
-- ride on every candidate: the dataset is published with its own licence and
-- must be able to say which model and lane produced each item.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS vqa_candidates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  batch         TEXT NOT NULL,
  file_id       TEXT NOT NULL,
  ordinal       INTEGER NOT NULL DEFAULT 0,   -- 1..5 within its image call
  question      TEXT NOT NULL,
  qnorm         TEXT NOT NULL,
  choices       TEXT NOT NULL,                -- JSON array of 4 strings
  answer        TEXT NOT NULL,
  grounding     TEXT NOT NULL DEFAULT '',
  capability    TEXT NOT NULL DEFAULT '',
  level         TEXT NOT NULL DEFAULT '',
  domain        TEXT NOT NULL DEFAULT '',
  difficulty    TEXT NOT NULL DEFAULT '',
  model         TEXT NOT NULL DEFAULT '',
  endpoint      TEXT NOT NULL DEFAULT '',
  prompt_version TEXT NOT NULL DEFAULT '',
  run_id        TEXT NOT NULL DEFAULT '',
  image_sha256  TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending|approved|edited|rejected
  reviewer      TEXT,
  reviewed_at   TEXT,
  reason        TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (batch, file_id, qnorm)
);

CREATE INDEX IF NOT EXISTS idx_vqa_status ON vqa_candidates (status, id);
CREATE INDEX IF NOT EXISTS idx_vqa_file ON vqa_candidates (file_id);
CREATE INDEX IF NOT EXISTS idx_vqa_taxonomy ON vqa_candidates (capability, level, domain);

CREATE TABLE IF NOT EXISTS vqa_reviews (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER NOT NULL,
  reviewer     TEXT NOT NULL,
  verdict      TEXT NOT NULL,                 -- approve|edit|reject
  reason       TEXT NOT NULL DEFAULT '',
  changed      TEXT NOT NULL DEFAULT '',      -- JSON object of edited fields
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vqa_reviews_candidate ON vqa_reviews (candidate_id);
