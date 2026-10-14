-- CANONICAL MIGRATION. Apply with:  npx wrangler d1 migrations apply agi-eval-questions --remote
-- Source of truth for this file is apps/relay/schema_v5c_item_axis.sql; edit there, then re-run scripts/db/sync_migrations.py.
-- v5c: the error-analysis axis (family, relevance) that the form collected and the API discarded.

-- ===========================================================================
-- BENCHMARK SCHEMA  v5c — THE ERROR-ANALYSIS AXIS
--
-- Owner: benchmark lead.  Run AFTER schema_v5b_guards.sql.
--
-- WHY THIS EXISTS
-- ---------------
-- The authoring form collects `family` (which VLM failure the item exposes) and
-- `relevance` (visual_true_premise | visual_false_premise | non_visual), requires
-- both, and sends both. The API had NO COLUMN for either and silently discarded
-- them, along with `unanswerable_reason`, which IS a v4 column but was never
-- written.
--
-- Three consequences, all of which this migration and the matching API change fix:
--
--   1. `relevance` is gate check C2.3. With no stored value, every item fails it.
--   2. `unanswerable_reason` is gate check C2.9 (unanswerable share 20-40%). It read
--      0% forever, so a core design requirement was unverifiable.
--   3. An author who chose "not answerable" and explained WHY had that work thrown
--      away on save. That is the worst of the three: it is invisible data loss.
--
-- `family` was surviving only because the form smuggles it into the free-text
-- `tags` field. That is implicit, breaks the edit path (which cannot tell a family
-- tag from a user tag), and would not survive any future tag cleanup.
--
-- Additive and safe: both columns are new, so existing rows keep working.
-- ===========================================================================

-- which VLM failure the item is intended to expose. The six-value closed set the
-- authoring form enforces: counting | scene_text | spatial | attribute_binding |
-- absent_entity | knowledge_boundary.
ALTER TABLE questions ADD COLUMN family TEXT;

-- whether the image can settle the question at all. One of:
--   visual_true_premise | visual_false_premise | non_visual
-- Gate check C2.3 requires it to be one of those three.
ALTER TABLE questions ADD COLUMN relevance TEXT NOT NULL DEFAULT 'visual_true_premise';

-- The queries the gate and the analysis actually run.
CREATE INDEX IF NOT EXISTS idx_q_family    ON questions(family);
CREATE INDEX IF NOT EXISTS idx_q_relevance ON questions(relevance);

-- ---------------------------------------------------------------------------
-- BACKFILL, best effort and explicitly one-way.
--
-- Rows written before this migration smuggled `family` into `tags`. Recover what
-- can be recovered so historical items are not permanently unclassified, and leave
-- anything ambiguous NULL rather than guessing a family.
-- ---------------------------------------------------------------------------
-- SPLIT INTO TWO STATEMENTS OF THREE TERMS EACH, BECAUSE D1 REJECTS THE SIX-TERM FORM.
--
-- Found in round 138 by applying the migrations to a REAL local D1
-- (wrangler d1 migrations apply --local) rather than to plain SQLite:
--
--     too many terms in compound SELECT: SQLITE_ERROR
--
-- check_migrations.py PASSES, because plain SQLite allows far more compound terms than D1
-- does. So this file validated clean in the repo and would have FAILED IN PRODUCTION on the
-- relay's deploy, which applies migrations before the code that needs them.
--
-- The second statement carries `family IS NULL` so it fills only what the first missed, which
-- makes the split exactly equivalent to the single pass.
UPDATE questions
SET family = (
  SELECT t.tag FROM (
    SELECT 'counting' AS tag UNION ALL SELECT 'scene_text' UNION ALL SELECT 'spatial'
  ) AS t
  WHERE (',' || REPLACE(REPLACE(tags, ', ', ','), ' ,', ',') || ',') LIKE '%,' || t.tag || ',%'
  LIMIT 1
)
WHERE family IS NULL AND tags IS NOT NULL AND tags <> '';

UPDATE questions
SET family = (
  SELECT t.tag FROM (
    SELECT 'attribute_binding' AS tag UNION ALL SELECT 'absent_entity'
    UNION ALL SELECT 'knowledge_boundary'
  ) AS t
  WHERE (',' || REPLACE(REPLACE(tags, ', ', ','), ' ,', ',') || ',') LIKE '%,' || t.tag || ',%'
  LIMIT 1
)
WHERE family IS NULL AND tags IS NOT NULL AND tags <> '';
