#!/usr/bin/env python3
"""
DO THE MIGRATIONS APPLY TO A FRESH DATABASE, AND PRODUCE THE SCHEMA WE THINK THEY DO?

WHY THIS EXISTS
---------------
scripts/db/sync_migrations.py regenerates the migrations from the schema*.sql sources and proves
the sequence applies. **But it WRITES FILES, so it cannot run in CI**, and the allowlist is right
that it is a maintenance tool. Nothing else checked the migrations at all.

So a broken migration could sit in the repository until a deployment failed to start - and the
migrations are the ONLY path a new database takes.

THIS IS READ-ONLY. It applies the migrations to an in-memory database and reports. It never writes.

WHAT IT CHECKS
--------------
1. every statement in every migration applies, IN FILENAME ORDER
2. the object counts are the ones the schema is supposed to have
3. a POST-CONDITION query runs, so the objects are not merely present but usable

Usage:
    python scripts/db/check_migrations.py
"""
from __future__ import annotations

import argparse
import pathlib
import sqlite3

# WHAT THE DATABASE ACTUALLY ALLOWS, NOT WHAT THIS INTERPRETER DEFAULTALLY DOES.
#
# SQLite's default is 500. D1 rejects a six-term UNION, so the ceiling is at or below five -
# and every statement in these migrations must fit under it. Verified against a real local D1
# in round 138, where the six-term form failed and the three-term form applied cleanly.
D1_COMPOUND_SELECT_LIMIT = 5
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "apps" / "relay" / "migrations"

# The shape the schema is supposed to have. NOT a guess: these are what the migration set
# produces today, so a change to them is a change to the database contract - which should be a
# deliberate edit here, not a silent drift.
EXPECTED = {"table": 19, "view": 9, "trigger": 11}

# A QUERY THAT MUST RUN. Counting objects proves they exist; running one proves they work.
#
# IT QUERIES WHAT THE API ACTUALLY READS. The first version selected from `v_leaderboard`, which
# has no `run_id` and never did - the post-condition failed and **the failure was in the check, not
# the schema.** The API reads `run_summary` (one row per run and model) and `v_run_summary_drift`.
POSTCONDITION = (
    "SELECT model, run_id, graded, correct FROM run_summary LIMIT 1",
    "SELECT * FROM v_run_summary_drift LIMIT 1",
    "SELECT tags, run_id, graded, correct FROM tag_summary LIMIT 1",
)

# A VIEW THAT WOULD SILENTLY MERGE RUNS.
#
# `v_leaderboard` (v4) and `v_leaderboard_v5` group by `e.model` ALONE. Since v5e a measurement
# is identified by (question_id, model, run_id), so either view would collapse every condition of
# a ladder into one row - **precisely the defect found in round 66, where 21 conditions became
# one and the result looked plausible.**
#
# Nothing reads them today. They are kept because they are part of the applied migration history,
# and this lists them so that "reuse the existing leaderboard view" cannot quietly reintroduce the
# bug.
MERGES_RUNS = ("v_leaderboard", "v_leaderboard_v5")


def split_sql(text: str) -> list[str]:
    """Statements, with -- comments stripped and sqlite3.complete_statement deciding.

    A split on ";" alone breaks on a semicolon inside a string literal or a trigger body, which
    is why this is not a one-liner.
    """
    stmts, buf = [], ""
    for line in text.splitlines():
        i = line.find("--")
        buf += (line[:i] if i >= 0 else line) + "\n"
        if sqlite3.complete_statement(buf):
            stmts.append(buf.strip())
            buf = ""
    if buf.strip():
        stmts.append(buf.strip())
    return stmts


API_SOURCE = ROOT / "packages" / "questions-api" / "src" / "index.ts"
_PREPARE = __import__("re").compile("db[.]prepare[(]")


def extract_api_sql(path: pathlib.Path) -> list[str]:
    """Every SQL string passed to db.prepare() in the API.

    THE API'S SQL WAS CHECKED AGAINST NOTHING. A column renamed in a migration and not in the API
    fails at REQUEST TIME, in production, on the path a user is using - and the TypeScript compiler
    cannot see it, because the SQL is a string.

    This reads the source rather than running it: the API is TypeScript and this is Python, and the
    thing being checked is the TEXT of the query against the SCHEMA, not the handler around it.
    """
    import re as _re

    src = path.read_text(encoding="utf-8-sig")
    out = []
    for m in _PREPARE.finditer(src):
        i = m.end()
        while i < len(src) and src[i] in " \t\n":
            i += 1
        q = src[i] if i < len(src) else ""
        if q == chr(96):
            j = src.index(chr(96), i + 1)
            out.append(src[i + 1:j])
            continue
        if q in (chr(34), chr(39)):
            j = i + 1
            while j < len(src):
                if src[j] == chr(92):
                    j += 2
                    continue
                if src[j] == q:
                    break
                j += 1
            lit = src[i + 1:j]
            # JOIN ADJACENT LITERALS. A long query is written as \`"...col," + " FROM t ..."\`, and
            # taking only the first piece produced a statement that PARSED - it was a bare SELECT
            # with no FROM - and failed with "no such column: rev_id", **naming a column that
            # exists. The check was reporting a fault in a correct file.**
            k = j + 1
            while True:
                while k < len(src) and src[k] in " \t\n":
                    k += 1
                if k < len(src) and src[k] == "+":
                    k += 1
                    while k < len(src) and src[k] in " \t\n":
                        k += 1
                    if k < len(src) and src[k] in (chr(34), chr(39)):
                        qq = src[k]
                        m2 = k + 1
                        while m2 < len(src):
                            if src[m2] == chr(92):
                                m2 += 2
                                continue
                            if src[m2] == qq:
                                break
                            m2 += 1
                        lit += src[k + 1:m2]
                        k = m2 + 1
                        continue
                break
            out.append(lit)
    return out


def check_api_sql(db, path: pathlib.Path) -> tuple[list[tuple[str, str]], list[str]]:
    """(broken, fragments) for the API's queries.

    A FRAGMENT IS NOT AN ERROR. Some queries are built by concatenation - `"... WHERE id IN (" + \
    placeholders + ")"` - so the extracted string is incomplete BY CONSTRUCTION. Those are
    reported separately rather than counted as failures, because **a check that reports a
    correct file as broken is one somebody turns off.** What it can verify is the complete
    statements, and it says how many it could not.
    """
    bad: list[tuple[str, str]] = []
    fragments: list[str] = []
    # DDL IS EXECUTED, NOT EXPLAINED. The API creates \`graph_drafts\` itself, with
    # CREATE TABLE IF NOT EXISTS, immediately before using it - so EXPLAINing the CREATE leaves
    # the table absent and every later query against it reports "no such table". **The API's own
    # DDL is part of its contract with the schema**, so it runs.
    executed_ddl = 0
    for st in extract_api_sql(path):
        t = st.strip()
        if not t:
            continue
        # EXPLAIN PREPARES WITHOUT RUNNING. Preparation is what resolves table and column names,
        # so this catches a renamed column without touching a row.
        #
        # IT NEEDS BINDINGS, and the statement may use \`?1\`, \`?2\` or bare \`?\`. Rather than
        # parse the parameter list - which would have to understand string literals and comments
        # to be right - it TRIES INCREASING COUNTS and accepts the first that prepares. **A
        # binding error is not a schema error**, and only the schema is under test here.
        if t.upper().startswith(("CREATE TABLE", "CREATE INDEX", "CREATE VIEW")):
            try:
                db.execute(t)
                executed_ddl += 1
            except Exception as e:
                bad.append((t.replace("\n", " ")[:70], str(e)))
            continue
        err = None
        # 21 WAS NOT ENOUGH. The widest INSERT in the API binds 25 parameters, so the loop gave up
        # and reported a binding error as a schema error. The limit is now generous, because
        # **guessing a bound too low turns a correct statement into a reported fault.**
        for n in range(0, 65):
            try:
                db.execute("EXPLAIN " + t, (None,) * n)
                err = None
                break
            except Exception as e:
                err = e
                if "bindings" not in str(e):
                    break
        if err is None:
            continue
        msg = str(err)
        if "incomplete input" in msg or "unrecognized token" in msg:
            fragments.append(t.replace("\n", " ")[:60])
            continue
        bad.append((t.replace("\n", " ")[:70], msg))
    return bad, fragments, executed_ddl


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Apply the migrations to a fresh database.")
    ap.add_argument("--dir", default=str(MIGRATIONS))
    args = ap.parse_args(argv)
    d = pathlib.Path(args.dir)
    files = sorted(d.glob("*.sql"))
    if not files:
        print("no migrations in " + str(d), file=sys.stderr)
        return 2

    db = sqlite3.connect(":memory:")

    # D1'S COMPOUND-SELECT LIMIT IS FAR LOWER THAN PLAIN SQLITE'S, AND THIS IS THE POINT OF
    # THE CHECK RATHER THAN A DETAIL OF IT.
    #
    # Round 138 applied these migrations to a REAL local D1 with
    # `wrangler d1 migrations apply --local` and got:
    #
    #     too many terms in compound SELECT: SQLITE_ERROR
    #
    # on a six-term UNION in schema_v5c_item_axis.sql. **Plain sqlite3 reports its limit as
    # 500 and accepts the statement**, so this script validated the file as clean while the
    # relay's deploy - which applies migrations before the code that needs them - would have
    # FAILED IN PRODUCTION.
    #
    # The interpreter is the same; the LIMIT is not. Setting it here costs nothing and makes
    # this check disagree with the runner for the same reason the runner does.
    try:
        db.setlimit(sqlite3.SQLITE_LIMIT_COMPOUND_SELECT, D1_COMPOUND_SELECT_LIMIT)
    except (AttributeError, sqlite3.NotSupportedError):
        print("note: this sqlite3 cannot set the compound-select limit; the check is weaker")
        print("      than the database it stands in for.")
    failures, total = [], 0
    print("applying " + str(len(files)) + " migration(s) to a FRESH database:")
    for f in files:
        ok = 0
        for st in split_sql(f.read_text(encoding="utf-8-sig")):
            total += 1
            try:
                db.execute(st)
                ok += 1
            except Exception as e:
                failures.append((f.name, str(e)))
        print("  %-30s %3d statement(s)" % (f.name, ok))

    print()
    print(str(total) + " statement(s) applied, " + str(len(failures)) + " failed")
    if failures:
        for name, err in failures[:10]:
            print("  FAIL " + name + ": " + err)
        print()
        print("A migration that does not apply is a deployment that does not start.")
        return 1

    counts = {}
    for kind, want in EXPECTED.items():
        n = len(list(db.execute(
            "SELECT name FROM sqlite_master WHERE type=? AND name NOT LIKE 'sqlite_%'",
            (kind,))))
        counts[kind] = n
        mark = "ok" if n == want else "MISMATCH (expected " + str(want) + ")"
        print("  %-9s %3d  %s" % (kind + "s", n, mark))

    bad = [k for k, want in EXPECTED.items() if counts[k] != want]
    if bad:
        print()
        print("THE SCHEMA IS NOT THE ONE WE THINK IT IS: " + ", ".join(bad))
        print("If the change is deliberate, update EXPECTED in this file in the same commit.")
        return 1

    for q in POSTCONDITION:
        try:
            db.execute(q)
        except Exception as e:
            print()
            print("A POST-CONDITION QUERY FAILED: " + q)
            print("  " + str(e))
            print("The objects exist and do not work, which counting them cannot tell you.")
            return 1

    for v in MERGES_RUNS:
        row = db.execute(
            "SELECT sql FROM sqlite_master WHERE type='view' AND name=?", (v,)).fetchone()
        if row and "run_id" not in (row[0] or ""):
            print("  note: " + v + " groups by model only and would MERGE runs (unused; kept for")
            print("        migration history - do not reuse it for a per-run number)")

    if API_SOURCE.exists():
        api_bad, api_frag, api_ddl = check_api_sql(db, API_SOURCE)
        n_api = len(extract_api_sql(API_SOURCE))
        print("  %-9s %3d  queries, %d complete, %d fragment(s), %d DDL the API runs itself"
              % ("api sql", n_api, n_api - len(api_frag), len(api_frag), api_ddl))
        if api_bad:
            print()
            print(str(len(api_bad)) + " API QUERY(IES) THE SCHEMA CANNOT SUPPORT:")
            for st, err in api_bad[:10]:
                print("  " + st)
                print("    " + err)
            print()
            print("The TypeScript compiler cannot see inside a SQL string, so a column renamed in a")
            print("migration and not in the API fails at REQUEST time, in production.")
            return 1

    print()
    print("OK - the migrations apply cleanly to a fresh database and produce the expected schema.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
