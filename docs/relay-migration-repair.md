# The relay deploy is blocked. Here is the measured state, not a guess.

**Rewritten 2026-10-14 after querying the real database. The first version of this file was
WRONG — see "What the first version got wrong" at the end.**

## What the remote database actually contains

Wrangler is authenticated on the owner's machine, so this is **measured, not inferred**:

```
$ wrangler d1 execute agi-eval-questions --remote --command "SELECT name FROM sqlite_master ..."
  _cf_KV, evaluations, excluded, questions, sqlite_sequence, tags

$ ... "SELECT id, name FROM d1_migrations"
  X ERROR  no such table: d1_migrations

$ ... "SELECT name FROM pragma_table_info('questions')"
  id, file_id, contributor, question, qnorm, answer_type, answer, choices,
  difficulty, tags, status, created_at
```

**Three facts follow, and they are the whole picture:**

1. **There is no `d1_migrations` table.** No migration has **ever** been applied through wrangler.
2. **`questions` has only the twelve columns of the original `schema.sql`.** None of the fifty-odd
   columns from `0002` onward exist.
3. **The database is at the ORIGINAL schema state**, not a partial one.

## And the migrations apply cleanly to it

The exact production DDL was read from the remote, loaded into a local D1, and the real migration
set applied:

```
0001_core.sql            ✅
0002_v4_epistemic.sql    ✅
0003_v5_pairing.sql      ✅
0004_v5b_guards.sql      ✅
0005_v5c_item_axis.sql   ✅
0006_v5d_eval_truth.sql  ✅
0007_v5e_run_key.sql     ✅
0008_v5f_run_summary.sql ✅
```

**So the migrations are not the problem.** The remote failure is environmental — a timeout, a
transient API error, or a wrangler version difference — **and I could not read the remote log to
say which, because the repository is private.**

## What to do

**Re-run the deploy.** Nothing needs repairing first.

**Actions → deploy → Run workflow → tick `force_all`.**

The job now runs `scripts/db/diagnose_remote.py` **before** the migration step, so if it fails
again the log will say **which migration**, instead of a bare SQLite error.

## What the first version of this file got wrong

It said the database was **partially migrated** — that `0005`'s ALTERs had taken effect before its
six-term UNION failed, so `0005` needed recording as applied.

**All of that was false.** I reached it by reproducing a failure mode locally and **treating the
reproduction as evidence about production rather than as a hypothesis to test.** The one command
that settles it — `SELECT name FROM d1_migrations` — I did not run, because the diagnosis felt
complete.

**The advice was also dangerous**: recording `0005` as applied against a database that has none of
its columns would have skipped the migration that creates them, and every later migration would
have failed on a missing column instead.

> **A local reproduction tells you a failure mode exists. It does not tell you which one you have.**
> The remote is one command away, and it is the only thing that answers the question.
