#!/usr/bin/env python3
"""Diagnose the REMOTE D1 before applying migrations, and name a partial state.

WHY THIS EXISTS
---------------
Round 140: the relay deploy job ran for the first time and failed at

    Apply migrations (before the code that needs them)

with no usable explanation. The cause was a PARTIALLY APPLIED MIGRATION, reproduced locally:

    X ERROR  duplicate column name: family

Migration 0005 begins with two `ALTER TABLE questions ADD COLUMN` statements and then ran a
six-term `UNION ALL`. **D1 rejects six compound terms**, so the file failed - *after* its ALTERs
had already taken effect. D1 records a migration BY NAME, and only when the whole file succeeds,
so `0005` was never marked applied and every retry re-ran the ALTERs.

**A raw SQLite error names the symptom and not the cause**, and the next person spends the time I
spent working out which migration it was and why.

WHAT IT DOES
------------
Reads the applied list and the real column set from the remote, and prints **which migration is
half-applied** and the exact command to repair it. It does NOT write anything.

    python scripts/db/diagnose_remote.py --db agi-eval-questions

Run it in the deploy job BEFORE the migration step, so a failure is explained in the log rather
than investigated later.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "apps" / "relay" / "migrations"

# columns each migration ADDs, read from the file itself rather than written down twice
ADD_COL = re.compile(r"ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)", re.I)


def d1(args: list[str], db: str, remote: bool) -> tuple[int, str]:
    cmd = ["bunx", "--bun", "wrangler@4.125.0", "d1", *args, db,
           "--remote" if remote else "--local", "--json"]
    p = subprocess.run(cmd, capture_output=True, text=True,
                       cwd=str(ROOT / "apps" / "relay"))
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def _rows(out: str) -> list[dict]:
    """wrangler prints a JSON array; tolerate leading non-JSON lines."""
    i = out.find("[")
    if i < 0:
        return []
    try:
        data = json.loads(out[i:])
    except json.JSONDecodeError:
        return []
    if isinstance(data, list) and data and isinstance(data[0], dict):
        return data[0].get("results", []) or []
    return []


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--db", default="agi-eval-questions")
    ap.add_argument("--remote", action="store_true", default=True)
    args = ap.parse_args(argv)

    rc, out = d1(["migrations", "list"], args.db, True)
    listed = re.findall(r"(\d{4}_[\w.]+\.sql)", out)
    applied = {m for m in listed if "✅" in out.split(m)[-1][:8]} if listed else set()
    # fall back to the table itself, which is the authority
    rc2, out2 = d1(["execute", "--command", "SELECT name FROM d1_migrations ORDER BY id"], args.db, True)
    rows = _rows(out2)
    if rows:
        applied = {r.get("name", "") for r in rows}

    if not applied:
        print("could not read the applied list from the remote (no credentials, or no database).")
        print("run this inside the deploy job, where CLOUDFLARE_API_TOKEN is set.")
        return 0

    all_files = sorted(p.name for p in MIGRATIONS.glob("*.sql"))
    pending = [f for f in all_files if f not in applied]

    rc3, out3 = d1(["execute", "--command",
                    "SELECT name FROM pragma_table_info('questions') "
                    "UNION ALL SELECT name FROM pragma_table_info('evaluations')"],
                   args.db, True)
    have = {r.get("name", "") for r in _rows(out3)}

    print("applied : " + (", ".join(sorted(applied)) or "none"))
    print("pending : " + (", ".join(pending) or "none"))
    print()

    partial = []
    for f in pending:
        text = (MIGRATIONS / f).read_text(encoding="utf-8-sig", errors="ignore")
        cols = [c for _, c in ADD_COL.findall(text)]
        if cols and all(c in have for c in cols):
            partial.append((f, cols))

    if not partial:
        print("no migration is half-applied: every pending file's columns are still absent.")
        return 0

    print(str(len(partial)) + " MIGRATION(S) HALF-APPLIED - the cause of 'duplicate column name':")
    for f, cols in partial:
        print("  " + f)
        print("    its columns ALREADY EXIST: " + ", ".join(cols))
        print("    but the file is NOT recorded as applied, so a retry re-runs the ALTERs and fails.")
    print()
    print("REPAIR - record the file as applied, then let the rest run. It is safe: the ALTERs have")
    print("already taken effect, and any UPDATE inside it is idempotent or has never mattered.")
    for f, _ in partial:
        print("  bunx --bun wrangler@4.125.0 d1 execute " + args.db +
              " --remote --command \"INSERT INTO d1_migrations (name) VALUES ('" + f + "')\"")
    print("  bunx --bun wrangler@4.125.0 d1 migrations apply " + args.db + " --remote")
    print()
    print("See docs/relay-migration-repair.md.")
    # non-zero so the job stops BEFORE the confusing raw error
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
