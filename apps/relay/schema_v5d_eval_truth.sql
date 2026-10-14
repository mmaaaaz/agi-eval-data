-- ===========================================================================
-- BENCHMARK SCHEMA  v5d — WHAT THE SITE STORES MUST BE WHAT THE PAPER COMPUTES
--
-- Owner: benchmark lead.  Run AFTER schema_v5c_item_axis.sql.
--
-- WHY THIS EXISTS
-- ---------------
-- `evaluations` has UNIQUE(question_id, model) and the harness ingest upserts
-- `verdict`. The harness posted the RAW TRACE, which holds one row per SAMPLE, so a
-- 3-repeat run overwrote itself three times and the API kept the LAST sample's verdict
-- -- while analyze.py's collapse() used the MAJORITY. The site and the paper therefore
-- published different accuracies from the same trace.
--
-- Worse, run.py sets verdict='wrong' when a call errors, and there was nowhere to
-- record the error. So a rate-limited request was stored as a wrong answer forever, and
-- the site's accuracy fell every time the API wobbled.
--
-- Three columns, so the site can hold what the harness already knows:
--   error      the failure text, NULL on success. An errored item has NO verdict and
--              must never enter an accuracy denominator.
--   n_samples  how many attempts produced this verdict (1 unless --repeats was used)
--   unstable   1 when the attempts DISAGREED. A model that answers the same question
--              differently on separate calls is worth reporting, not averaging away.
--
-- Additive and safe. Existing rows keep working: error is NULL, n_samples is 1.
-- ===========================================================================

ALTER TABLE evaluations ADD COLUMN error     TEXT;
ALTER TABLE evaluations ADD COLUMN n_samples INTEGER NOT NULL DEFAULT 1;
ALTER TABLE evaluations ADD COLUMN unstable  INTEGER NOT NULL DEFAULT 0;

-- The leaderboard filters on these, so index the cheap discriminator.
CREATE INDEX IF NOT EXISTS idx_eval_model_verdict ON evaluations(model, verdict);

-- Anything already stored as 'wrong' that arrived from the harness with no response and
-- a parse failure is very likely a failed call, but it CANNOT be proven from here.
-- Deliberately left alone rather than guessed at: rewriting a measurement because it
-- looks suspicious is how a benchmark loses its own audit trail.
