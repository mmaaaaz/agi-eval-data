#!/usr/bin/env python3
"""Run the CI checks against a CLEAN CHECKOUT, before pushing.

WHY THIS EXISTS
---------------
Six defects shipped in one stretch and **not one of them was findable by reading the code**:

  * a self-test that wrote into `data/factory/` without making the directory, dying at 342 of
    446 assertions with NO TRACEBACK, which reads as a mysterious stop rather than a missing folder
  * a self-test that asserted `data/factory/provenance.jsonl` exists
  * a driver that wrote a fixture into the same gitignored directory
  * two paid scripts that refused to spend AFTER reading their input, so an unauthorised spend was
    indistinguishable from a missing file
  * a pipeline that checked missing INPUTS before missing ENV, reporting SKIP where the spend rule
    required a refusal

**Every one passes on a machine that has the private tree.** `data/factory/`, `.scratch/` and
`AGENTS.md` are gitignored, so they are present here and absent on the runner.

WHAT IT DOES
------------
`git worktree add --detach` materialises exactly what CI gets, and each CI step runs there. It
writes nothing to your working tree.

    python -m scripts.harness.cleanroom          # every step
    python -m scripts.harness.cleanroom --quick  # the python ones only

CI is already a clean checkout, so this is NOT a CI step - it is the thing to run BEFORE pushing,
which is where it would have saved the whole afternoon.
"""
from __future__ import annotations

import argparse
import pathlib
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]

# THE STEPS CI RUNS, IN ORDER. Kept in the same shape as the workflow so a step added there is
# noticed here - and 13_ci_resolves.py checks that every guard in REQUIRED_GUARDS is invoked by a
# workflow, so the two lists cannot drift apart silently.
PY_STEPS: list[tuple[str, list[str]]] = [
    ("guard: no unsupported claims", ["scripts/factory/08_site_truthfulness.py"]),
    ("guard: no machinery without a runner", ["scripts/factory/12_unwired.py"]),
    ("check: every command resolves", ["scripts/factory/13_ci_resolves.py"]),
    ("guard: pipeline stage order", ["scripts/factory/14_pipeline_order.py"]),
    ("guard: no source claim contradicts the code", ["scripts/factory/15_source_claims.py"]),
    ("migrations apply to a fresh database", ["scripts/db/check_migrations.py"]),
    ("gate: dataset integrity", ["scripts/factory/03_verify.py"]),
    ("guard: provenance ledger builds", ["scripts/factory/00_provenance.py", "--no-write", "--json"]),
    ("guard: corpus metadata honesty", ["scripts/factory/00_metadata_audit.py"]),
    ("harness selftest", ["-m", "scripts.harness.selftest"]),
    ("harness smoke", ["-m", "scripts.harness.smoke"]),
]


def _run(cmd: list[str], cwd: pathlib.Path) -> tuple[int, str]:
    p = subprocess.run([sys.executable, *cmd], capture_output=True, text=True, cwd=str(cwd))
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    # Every step CI runs IS a python step, so there is nothing to skip - the flag existed and did
    # NOTHING. A flag that does nothing is worse than no flag, so it is gone.
    ap.add_argument("--keep", action="store_true", help="leave the checkout behind for inspection")
    args = ap.parse_args(argv)

    if shutil.which("git") is None:
        print("git is not on PATH, so a clean checkout cannot be made.", file=sys.stderr)
        return 2

    tmp = pathlib.Path(tempfile.mkdtemp(prefix="cleanroom-"))
    work = tmp / "tree"
    print("cleanroom: " + str(work))
    add = subprocess.run(["git", "worktree", "add", "--detach", "--quiet", str(work), "HEAD"],
                         capture_output=True, text=True, cwd=str(ROOT))
    if add.returncode != 0:
        print("could not create the worktree: " + (add.stderr or add.stdout), file=sys.stderr)
        return 2

    failed: list[tuple[str, str]] = []
    try:
        # THE PRIVATE TREE MUST BE ABSENT, or this proves nothing. Asserted rather than assumed -
        # a check whose premise is silently false is the defect this whole script exists to catch.
        leaked = [p for p in ("data/factory", ".scratch", "AGENTS.md") if (work / p).exists()]
        if leaked:
            print("REFUSING: the clean checkout contains " + ", ".join(leaked) +
                  " - the result would prove nothing.", file=sys.stderr)
            return 2
        print("confirmed absent from the checkout: data/factory, .scratch, AGENTS.md")
        print()

        for label, cmd in PY_STEPS:
            rc, out = _run(cmd, work)
            mark = "ok  " if rc == 0 else "FAIL"
            print("  " + mark + "  " + label)
            if rc != 0:
                tail = [x for x in out.splitlines() if x.strip()][-4:]
                failed.append((label, chr(10).join("        " + x for x in tail)))
        print()
        if failed:
            print(str(len(failed)) + " STEP(S) FAIL ON A CLEAN CHECKOUT " +
                  "- CI WILL FAIL AND LOCAL RUNS WILL NOT SHOW IT:")
            for label, tail in failed:
                print("  " + label)
                print(tail)
            print()
            print("This is the whole class: a check that reads a gitignored path passes here and")
            print("cannot pass on the runner. Make the check create what it needs, or name a file")
            print("the repository actually contains.")
            return 1
        print("cleanroom: every step passes where the private tree is absent - CI will agree.")
        return 0
    finally:
        if args.keep:
            print("kept: " + str(work))
        else:
            subprocess.run(["git", "worktree", "remove", "--force", str(work)],
                           capture_output=True, text=True, cwd=str(ROOT))
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
