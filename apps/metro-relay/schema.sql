-- metro-eval-questions — D1 schema (fresh DB, separate benchmark lifecycle)
-- apply: npx wrangler d1 execute metro-eval-questions --remote --file schema.sql
-- local: npx wrangler d1 execute metro-eval-questions --local --file schema.sql

CREATE TABLE IF NOT EXISTS questions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id     TEXT NOT NULL,
  contributor TEXT NOT NULL DEFAULT '',
  question    TEXT NOT NULL,
  qnorm       TEXT NOT NULL,
  answer_type TEXT NOT NULL DEFAULT 'text',
  answer      TEXT,
  choices     TEXT,
  difficulty  TEXT NOT NULL DEFAULT 'medium',
  tags        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'approved',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(file_id, qnorm)
);
CREATE INDEX IF NOT EXISTS idx_q_file ON questions(file_id);
CREATE INDEX IF NOT EXISTS idx_q_contrib ON questions(contributor);

CREATE TABLE IF NOT EXISTS evaluations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL,
  model       TEXT NOT NULL,
  response    TEXT NOT NULL DEFAULT '',
  verdict     TEXT CHECK (verdict IN ('correct','close','wrong','unanswered')),
  source      TEXT NOT NULL DEFAULT 'manual',
  graded_by   TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(question_id, model)
);
CREATE INDEX IF NOT EXISTS idx_eval_model ON evaluations(model);
CREATE INDEX IF NOT EXISTS idx_eval_question ON evaluations(question_id);

CREATE TABLE IF NOT EXISTS tags (
  tag   TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS excluded (
  file_id    TEXT PRIMARY KEY,
  reason     TEXT NOT NULL DEFAULT '',
  marked_by  TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
