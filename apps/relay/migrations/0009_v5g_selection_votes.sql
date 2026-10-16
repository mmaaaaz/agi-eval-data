-- CANONICAL MIGRATION. Apply with:  npx wrangler d1 migrations apply agi-eval-questions --remote
-- Source of truth for this file is apps/relay/schema_v5g_selection_votes.sql; edit there, then re-run scripts/db/sync_migrations.py.
-- v5g: two distinct votes promote a nomination to chosen, and retracting below two undoes only a vote-promotion (promoted_by), never a human's own pick.

-- ===========================================================================
-- BENCHMARK SCHEMA  v5g — A NOMINATION NEEDS TWO VOTES, AND VOTES ARE UNDOABLE
--
-- Owner: benchmark lead.  Run AFTER schema_v5f_run_summary.sql.
--
-- WHY THIS EXISTS
-- ---------------
-- `nominated` is one person's opinion. The 2026-10-16 decision makes the human
-- review step explicit: a nominated image becomes `chosen` when TWO distinct
-- OTHER people vote for it, and it returns to `nominated` when the count drops
-- below two again ("it could be reversed too").
--
-- Two things this schema refuses to do:
--
--   1. VOTE ARITHMETIC MUST NEVER DEMOTE A HUMAN'S OWN PICK. A direct `chosen`
--      from the Select grid has promoted_by = NULL and is untouched by votes;
--      only a promotion this table performed (promoted_by = 'votes') can be
--      undone by retracting a vote. The alternative — recomputing state from
--      vote counts — silently undoes a deliberate human decision the moment a
--      voter changes their mind.
--
--   2. A VOTE MUST SURVIVE ITS VOTER. actor_id is the server-issued identity
--      (the same one selections already records), so one person cannot vote
--      twice by renaming themselves, and the nominator is refused by the API
--      (matching the repo's existing two-distinct-people rule for review).
--
-- The vote row is the evidence: who voted, when, for what. Losing it would
-- make "this image was promoted by two people" unfalsifiable one stage before
-- the release hash makes the set itself unfalsifiable.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS selection_votes (
  file_id    TEXT NOT NULL,
  actor_id   TEXT NOT NULL,
  actor_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- One vote per person per image, enforced by the storage engine.
  PRIMARY KEY (file_id, actor_id)
);

-- The nominated board reads votes per file; the promotion count is a COUNT(*)
-- over this index, not a scan.
CREATE INDEX IF NOT EXISTS idx_sel_votes_file ON selection_votes(file_id);

-- NULL = the state was set by a person (or a machine proposal); 'votes' = the
-- API promoted it because the vote count crossed the threshold. Only the
-- latter is reversible by vote arithmetic.
ALTER TABLE selections ADD COLUMN promoted_by TEXT;
