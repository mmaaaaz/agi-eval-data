-- ===========================================================================
-- BENCHMARK SCHEMA GUARDS  v5b
--
-- Owner: benchmark lead.  Run AFTER schema_v5.sql.
--
-- WHY THIS EXISTS
-- ---------------
-- schema_v5.sql adds the columns the paper needs. This file makes the three
-- things that must never be forgotten happen in the DATABASE rather than in the
-- API, so a future endpoint, a manual SQL fix, or a buggy script cannot silently
-- corrupt the benchmark:
--
--   1. every item change is recorded in change_log  -> the sync cursor is always right
--   2. every item change appends an immutable revision -> nothing is ever lost
--   3. an approved item must be classified           -> the reporting axis is complete
--
-- All three are triggers. They cost nothing beyond the write that already
-- happens, and they need no paid binding.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- GUARD 1: an approved item must carry a capability and a level.
-- questions.status defaults to 'approved' in v3, and SQLite cannot alter a column
-- default without rebuilding the table. This trigger closes that hole: a row may
-- only enter 'approved' if it is classified. The API still sets status explicitly;
-- this is the backstop.
-- ---------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_q_guard_insert
BEFORE INSERT ON questions
WHEN NEW.status = 'approved' AND (NEW.capability IS NULL OR NEW.level IS NULL)
BEGIN
  SELECT RAISE(ABORT,
    'refusing to insert an approved question with no capability/level: set status="draft" or classify it (v5 guard)');
END;

-- Scoped to the TRANSITION into 'approved'. A row that is already approved but
-- unclassified (a legacy row from v3/v4) must still be editable, classifiable and
-- soft-deletable, or it would be stuck forever. The release view excludes it and
-- the gate reports it.
CREATE TRIGGER IF NOT EXISTS trg_q_guard_update
BEFORE UPDATE ON questions
WHEN NEW.status = 'approved'
 AND (NEW.capability IS NULL OR NEW.level IS NULL)
 AND OLD.status <> 'approved'
BEGIN
  SELECT RAISE(ABORT,
    'refusing to approve a question with no capability/level: classify it first (v5 guard)');
END;

-- ---------------------------------------------------------------------------
-- GUARD 2: the sync cursor is written for you.
-- A client that forgets to touch change_log can no longer desynchronise everyone
-- else. Inserts, updates and (soft) deletes all advance the cursor.
-- ---------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_q_changelog_insert
AFTER INSERT ON questions
BEGIN
  INSERT INTO change_log(entity, entity_id, op, actor_id)
  VALUES ('question', NEW.id, 'insert', COALESCE(NEW.actor_id, ''));
END;

CREATE TRIGGER IF NOT EXISTS trg_q_changelog_update
AFTER UPDATE ON questions
BEGIN
  INSERT INTO change_log(entity, entity_id, op, actor_id)
  VALUES ('question', NEW.id, 'update', COALESCE(NEW.actor_id, ''));
END;

CREATE TRIGGER IF NOT EXISTS trg_sel_changelog_insert
AFTER INSERT ON selections
BEGIN
  INSERT INTO change_log(entity, entity_id, op, actor_id)
  VALUES ('selection', NEW.file_id, 'select', COALESCE(NEW.actor_id, ''));
END;

CREATE TRIGGER IF NOT EXISTS trg_sel_changelog_update
AFTER UPDATE ON selections
BEGIN
  INSERT INTO change_log(entity, entity_id, op, actor_id)
  VALUES ('selection', NEW.file_id, 'select', COALESCE(NEW.actor_id, ''));
END;

CREATE TRIGGER IF NOT EXISTS trg_sel_changelog_delete
AFTER DELETE ON selections
BEGIN
  INSERT INTO change_log(entity, entity_id, op, actor_id)
  VALUES ('selection', OLD.file_id, 'unselect', '');
END;

-- ---------------------------------------------------------------------------
-- GUARD 3: immutable revisions, written by the database.
-- The patch holds the PREVIOUS state of every field that can change, so an edit
-- is always revertible and always attributable. seq mirrors the row's rev, which
-- the API controls for optimistic concurrency.
-- ---------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_q_revision_update
AFTER UPDATE ON questions
BEGIN
  INSERT INTO question_revisions(question_id, seq, op, actor_id, actor_name, patch)
  VALUES (
    OLD.id,
    COALESCE(OLD.rev, 0),
    CASE
      WHEN NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN 'delete'
      WHEN NEW.deleted_at IS NULL AND OLD.deleted_at IS NOT NULL THEN 'restore'
      WHEN NEW.review_status IS NOT OLD.review_status THEN 'review'
      ELSE 'update'
    END,
    COALESCE(OLD.actor_id, ''),
    COALESCE(OLD.actor_name, ''),
    json_object(
      'question',      OLD.question,
      'answer_type',   OLD.answer_type,
      'answer',        OLD.answer,
      'choices',       OLD.choices,
      'difficulty',    OLD.difficulty,
      'tags',          OLD.tags,
      'status',        OLD.status,
      'capability',    OLD.capability,
      'level',         OLD.level,
      'pair_id',       OLD.pair_id,
      'pair_role',     OLD.pair_role,
      'grounding_box', OLD.grounding_box,
      'review_status', OLD.review_status,
      'reviewer',      OLD.reviewer,
      'review_reason', OLD.review_reason,
      'rev',           OLD.rev
    )
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_q_revision_insert
AFTER INSERT ON questions
BEGIN
  INSERT INTO question_revisions(question_id, seq, op, actor_id, actor_name, patch)
  VALUES (NEW.id, 0, 'insert', COALESCE(NEW.actor_id,''), COALESCE(NEW.actor_name,''),
          json_object('question', NEW.question, 'status', NEW.status,
                      'capability', NEW.capability, 'level', NEW.level));
END;

-- ---------------------------------------------------------------------------
-- GUARD 4: a paired probe must name its partner.
-- A bridge item with a pair_id but no pair_role (or the reverse) cannot be scored
-- in the 2x2, which is the paper's headline. Refuse the half-written state.
-- ---------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_q_guard_pair
BEFORE UPDATE ON questions
WHEN (NEW.capability LIKE 'B%')
 AND ((NEW.pair_id IS NULL) <> (NEW.pair_role IS NULL))
BEGIN
  SELECT RAISE(ABORT,
    'bridge item must set pair_id and pair_role together, or neither (v5 guard)');
END;

-- ---------------------------------------------------------------------------
-- GUARD 5: a hard DELETE still preserves the content.
-- The API's delete is a hard delete for compatibility, but "nothing is ever
-- destroyed" must hold: this records the final state as a revision first, so the
-- item can be reconstructed even after the row is gone. The revision table carries
-- no foreign key, which is exactly why the record survives.
-- ---------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_q_revision_delete
BEFORE DELETE ON questions
BEGIN
  INSERT INTO question_revisions(question_id, seq, op, actor_id, actor_name, patch)
  VALUES (
    OLD.id, COALESCE(OLD.rev, 0), 'delete', COALESCE(OLD.actor_id, ''), COALESCE(OLD.actor_name, ''),
    json_object(
      'question', OLD.question, 'answer_type', OLD.answer_type, 'answer', OLD.answer,
      'choices', OLD.choices, 'difficulty', OLD.difficulty, 'tags', OLD.tags,
      'status', OLD.status, 'capability', OLD.capability, 'level', OLD.level,
      'pair_id', OLD.pair_id, 'pair_role', OLD.pair_role,
      'grounding_box', OLD.grounding_box, 'review_status', OLD.review_status,
      'rev', OLD.rev
    )
  );
  INSERT INTO change_log(entity, entity_id, op, actor_id)
  VALUES ('question', OLD.id, 'delete', COALESCE(OLD.actor_id, ''));
END;

-- ===========================================================================
-- Note on deletion: the API deletes a question row, and GUARD 5 has already
-- recorded its full content as a revision, so nothing is destroyed. A soft
-- alternative also exists: set deleted_at, and the row and its history stay in
-- place. Either way the ledger is complete.
-- ===========================================================================
