-- ===========================================================================
-- BENCHMARK SCHEMA  v6c — DECISIONS ONLY
--
-- Owner: benchmark lead.  Run AFTER schema_v6b_vqa_stats.sql.
--
-- WHY THIS EXISTS
-- ---------------
-- The review room's read path moved to static JSON on Cloudflare Pages, because
-- D1's free tier bills rows read (5M/day) and no dynamic query over 135k
-- candidates is free at real traffic. What a human writes is small: one row per
-- decision. This table is that write path, keyed by the candidate's STABLE id
-- (sha1(batch|file_id|qnorm)[:16]), so a re-export or a re-shard never orphans a
-- decision.
--
-- The candidate payload itself is not stored here. If you need to know WHAT was
-- approved, the static snapshot the id came from is the record; the id is
-- reproducible from (batch, file_id, question), which is exactly why it is the
-- key.
--
-- TWO KINDS OF ROW
-- ----------------
--   cand_id = sha1(batch|file_id|qnorm)[:16]   one question (legacy per-item verdicts)
--   cand_id = 'img:' + sha256(batch|file_id)[:24]   one IMAGE — the review room's
--             normal verdict: verdict approve|reject, edits = JSON
--             {"questions": {<cand_id>: {question, choices, answer, grounding}}}
--             A 'clear' request deletes the row, which is the undo path.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS vqa_decisions (
  cand_id    TEXT PRIMARY KEY,
  batch      TEXT NOT NULL DEFAULT '',
  file_id    TEXT NOT NULL DEFAULT '',
  verdict    TEXT NOT NULL,              -- approve | edit | reject
  reviewer   TEXT NOT NULL DEFAULT '',
  reason     TEXT NOT NULL DEFAULT '',
  edits      TEXT NOT NULL DEFAULT '',   -- JSON object of edited fields
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vqa_decisions_updated ON vqa_decisions (updated_at);
CREATE INDEX IF NOT EXISTS idx_vqa_decisions_file ON vqa_decisions (file_id);
