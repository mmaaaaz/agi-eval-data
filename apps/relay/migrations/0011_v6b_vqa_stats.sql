-- CANONICAL MIGRATION. Apply with:  npx wrangler d1 migrations apply agi-eval-questions --remote
-- Source of truth for this file is apps/relay/schema_v6b_vqa_stats.sql; edit there, then re-run scripts/db/sync_migrations.py.
-- v6b: materialised images/stats/dims so the review room costs a constant handful of D1 reads instead of a full scan per page load (the free tier is 5M rows read/day).

-- ===========================================================================
-- BENCHMARK SCHEMA  v6b — CONSTANT-COST READS FOR THE REVIEW ROOM
--
-- Owner: benchmark lead.  Run AFTER schema_v6_vqa_review.sql.
--
-- WHY THIS EXISTS
-- ---------------
-- The review room's list and counters were computed with GROUP BY over
-- vqa_candidates. That is one full scan per dimension per page load: at 81k
-- candidates a single load cost roughly 400k D1 rows read, and the free tier
-- allows 5M/day. Ten page loads exhausted it. The screens must cost a fixed
-- handful of reads no matter how large the corpus grows.
--
-- Three materialised tables do that:
--   vqa_images — one row per photograph: how many candidates, first id, pending
--   vqa_stats  — one row per status: the headline counters
--   vqa_dims   — one row per (dimension, value): the filter dropdown counts
--
-- They are derived data and the API maintains them on ingest and on every
-- review decision. If they ever disagree with vqa_candidates, the candidates
-- table is the truth and a backfill can rebuild them.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS vqa_images (
  file_id     TEXT PRIMARY KEY,
  n           INTEGER NOT NULL DEFAULT 0,
  first_id    INTEGER NOT NULL DEFAULT 0,
  pending     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_vqa_images_first ON vqa_images (first_id);

CREATE TABLE IF NOT EXISTS vqa_stats (
  status TEXT PRIMARY KEY,
  n      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vqa_dims (
  kind  TEXT NOT NULL,      -- capability | level | domain
  value TEXT NOT NULL,
  n     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, value)
);
