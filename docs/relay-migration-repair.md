# The relay deploy is blocked on a partially-applied migration

**Written 2026-10-14. This is a one-time repair for a production database. Read it before running
anything.**

## What happened

The `relay` deploy job had **never run** — `deploy.yml` declared `changes.outputs.relay` but had no
`relay:` key in its `filters:` block, so the output was always empty. Fixed in round 140; the job
now runs.

When it finally ran, the **migration step failed**. The remote log is not readable (private repo),
but the failure mode is reproduced locally:

```
X ERROR  duplicate column name: family
```

**Why.** Migration `0005_v5c_item_axis.sql` begins with two `ALTER TABLE questions ADD COLUMN`
statements and then ran a six-term `UNION ALL`. **D1 rejects six compound terms**, so that file
failed — *after* its ALTERs had already taken effect. D1 records a migration **by name, and only
when the whole file succeeds**, so `0005` was never marked applied.

Every retry therefore re-runs the ALTERs, which now hit existing columns.

**The six-term UNION is fixed** (round 138, split into two three-term statements). The remaining
problem is purely the recorded state.

## What the database actually looks like

The ALTERs from `0002`, `0003` and `0005` **have run**. What did NOT run is:

* the `UPDATE` backfills at the end of `0005`
* everything in `0006`, `0007`, `0008`

## The repair, in order

**1. See exactly where you are.** Nothing below this line should run until this is read.

```bash
cd apps/relay
bunx --bun wrangler@4.125.0 d1 migrations list agi-eval-questions --remote
bunx --bun wrangler@4.125.0 d1 execute agi-eval-questions --remote \
  --command "SELECT name FROM d1_migrations ORDER BY id"
```

**2. Confirm the columns from 0005 exist.**

```bash
bunx --bun wrangler@4.125.0 d1 execute agi-eval-questions --remote \
  --command "SELECT name FROM pragma_table_info('questions') WHERE name IN ('family','relevance')"
```

**If both rows come back**, `0005`'s ALTERs ran and its name must be recorded without re-running it.

**3. Record 0005 as applied.**

```bash
bunx --bun wrangler@4.125.0 d1 execute agi-eval-questions --remote \
  --command "INSERT INTO d1_migrations (name) VALUES ('0005_v5c_item_axis.sql')"
```

**4. Run the backfill that 0005 never reached, and the rest of the migrations.**

```bash
bunx --bun wrangler@4.125.0 d1 migrations apply agi-eval-questions --remote
```

`0006`, `0007` and `0008` are all `ADD COLUMN` and `CREATE` statements that have never run, so they
apply cleanly. **They are still the new ones — nothing else is stale.**

**5. Re-run the deploy.**

Actions → deploy → Run workflow → tick **force_all**.

## Why the backfill is not lost

The `UPDATE` in `0005` only recovers a `family` value that an old row smuggled into its `tags`
field. **If no items were authored before the migration, there is nothing to recover** — and
`scripts/factory/03_verify.py` reports `C1.4` and the item-count checks, so the gate will say so
rather than a guess.

**If items DO exist**, run the two `UPDATE` statements from
`apps/relay/migrations/0005_v5c_item_axis.sql` by hand with `d1 execute --remote`. They are
idempotent in effect: the second carries `family IS NULL`, so running both again fills only what is
missing.

## What I did NOT do

**I did not run any of this against your database.** It is production, the state is inferred from a
reproduced failure mode rather than from the remote log, and step 1 exists to replace my inference
with your measurement.
