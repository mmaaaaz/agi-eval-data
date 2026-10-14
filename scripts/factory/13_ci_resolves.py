#!/usr/bin/env python3
"""
EVERY COMMAND CI RUNS MUST RESOLVE.

WHY THIS EXISTS
---------------
`ci.yml` was edited **four times in four rounds** — adding the unwired guard, the integrity gate,
and the spend checks — and **nothing validated it.** A typo in a path, or a step added under the
wrong key, fails silently: the workflow is still valid YAML, GitHub still starts it, and the guard
simply never runs.

**That is the `--spend`/consent/taxonomy defect one more time**: a guard that exists and is never
invoked. Adding a step to a YAML file is not the same as running it.

This does not parse YAML (no dependency is available). It reads the workflow as text and checks
the things that actually break:

  1. every `python <path>.py` a step names EXISTS
  2. every `python -m <module>` IMPORTS
  3. every `run:` block is non-empty and not a bare `|`
  4. each step carries a `name`, because an unnamed failure in the UI names nothing
  5. the guards known to protect this repo are actually invoked somewhere

Point 5 is the one that matters most: it is the check for THIS file's own purpose.

Usage:
    python scripts/factory/13_ci_resolves.py
    python scripts/factory/13_ci_resolves.py --workflow path/to/ci.yml
"""
from __future__ import annotations

import argparse
import ast
import importlib
import importlib.util
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
WORKFLOW_DIR = ROOT / ".github" / "workflows"
DEFAULT = WORKFLOW_DIR / "ci.yml"

# `python -m pkg.mod` RESOLVES FROM THE WORKING DIRECTORY, so the import check has to do the same
# or it reports every module as missing. The first version did exactly that and produced two false
# failures — a checker that does not reproduce the environment it checks is checking nothing.
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# The guards that protect this repository. If one is absent from CI, that is the defect this
# file exists to find — so the list is checked, not assumed.
REQUIRED_GUARDS = {
    "scripts/factory/08_site_truthfulness.py": "no unsupported claims on the site",
    "scripts/factory/12_unwired.py": "no machinery without a runner",
    "scripts/factory/13_ci_resolves.py": "this checker — a workflow that does not check itself",
    "scripts/factory/14_pipeline_order.py": "the pipeline does not silently skip a stage",
    "scripts/factory/15_source_claims.py": "no source comment contradicts the code",
    "scripts/db/check_migrations.py": "the migrations apply to a fresh database",
    "scripts/factory/03_verify.py": "dataset integrity",
    "scripts/factory/00_provenance.py": "the provenance ledger builds",
    "scripts.harness.selftest": "the harness self-test",
    "scripts.harness.smoke": "the end-to-end smoke test",
}

# EVERY workflow, not only ci.yml. The first version read one file — and there are EIGHT. Seven of
# them had never been checked by anything, including deploy.yml, which is the one that ships the
# Workers.
def all_workflows() -> list[pathlib.Path]:
    return sorted(WORKFLOW_DIR.glob("*.yml"))

_PATH = re.compile(r"python\s+(?:-m\s+)?([A-Za-z0-9_./-]+\.py)")
_MODULE = re.compile(r"python\s+-m\s+([A-Za-z0-9_.]+)")


def run_blocks(text: str) -> list[tuple[int, str]]:
    """(line number, command text) for every run: step, INCLUDING multi-line blocks.

    The first version only read lines beginning with `run:`, so it silently skipped
    `run: |` blocks — which is where a whole build step lives. A checker that skips the
    interesting case is the same defect as a guard that never fires.
    """
    out: list[tuple[int, str]] = []
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        s = lines[i].strip()
        # `- run: <cmd>` IS A STEP TOO, and the first version only matched a bare `run:`. That is
        # the SECOND style this function has skipped — `run: |` was the first — and both were found
        # by planting a fault and getting no complaint. deploy.yml's
        # `- run: pip install pyarrow && python scripts/build_data.py` went unchecked.
        if s.startswith("- run:"):
            s = s[len("- "):]
        if s.startswith("run:"):
            body = s.split("run:", 1)[1].strip()
            if body and body != "|":
                out.append((i + 1, body))
            else:
                j = i + 1
                collected = []
                while j < len(lines) and (lines[j].startswith(" " * 8) or not lines[j].strip()):
                    if lines[j].strip():
                        collected.append(lines[j].strip())
                    j += 1
                out.append((i + 1, "\n".join(collected)))
            i = j if not (body and body != "|") else i + 1
            continue
        i += 1
    return out



# ---------------------------------------------------------------------------
# A STEP WITH NO ACTION
# ---------------------------------------------------------------------------

# FOUND IN ROUND 130, AND IT HAD ALREADY BROKEN BOTH CI AND DEPLOY.
#
# `deploy.yml` contained THREE steps like this:
#
#     - name: Apply migrations (before the code that needs them)
#     - name: Apply migrations (before the code that needs them)
#       run: bunx --bun wrangler@4.125.0 d1 migrations apply ...
#
# The first is a step with NO `run:` and NO `uses:` - **not a valid GitHub Actions step.**
# GitHub rejected the whole workflow, and a rejected run reports `jobs: 0` with conclusion
# `failure`, which reads like a failing test rather than a file that never loaded.
#
# **This guard could not see it.** Every check here parses the YAML with regular expressions for
# things it knows to look for - commands, guards, paths - and a step that is missing its action is
# a shape nothing was looking at. Three of them shipped.
def find_steps_without_actions(base: pathlib.Path) -> list[dict]:
    """A workflow step that has neither `run:` nor `uses:`."""
    out = []
    for p in sorted((base / ".github" / "workflows").glob("*.yml")):
        lines = p.read_text(encoding="utf-8-sig", errors="ignore").splitlines()
        for i, line in enumerate(lines):
            # ONLY A STEP STARTS WITH `- name:`. A bare scalar under `paths:` is a legitimate
            # list item - a version of this check that did not know that reported 63 of them,
            # and a version without this guard at all reported 912. **Both were the check
            # being wrong about its own input**, which is why it stays simple: a step with no
            # `run:` and no `uses:` is the bug that actually shipped (three times, in
            # deploy.yml, and GitHub rejected the whole workflow for it).
            if not re.match(r"^\s+- name: ", line):
                continue
            indent = len(line) - len(line.lstrip())
            body = [line]
            j = i + 1
            while j < len(lines):
                nxt = lines[j]
                if nxt.strip() and (len(nxt) - len(nxt.lstrip())) <= indent:
                    break
                body.append(nxt)
                j += 1
            text = chr(10).join(body)
            if "run:" not in text and "uses:" not in text:
                out.append({"file": p.name, "line": i + 1, "step": line.strip()})
    return out


# ---------------------------------------------------------------------------
# A THIRD-PARTY IMPORT CI WOULD NOT HAVE
# ---------------------------------------------------------------------------

# FOUND IN ROUND 131, AND IT COST AN AFTERNOON.
#
# `selftest.py` does `from PIL import Image` for the GPS-detector check. **Nothing had ever
# installed Pillow** - the runner starts with a bare Python - so the self-test died at 319 of 446
# assertions with an ImportError. Every guard BEFORE it passed, so CI looked like it was testing
# the project when it was testing a subset of it.
#
# A LOCAL MACHINE CANNOT SEE THIS. The bundled interpreter has Pillow, numpy and pandas, so the
# import succeeds here and cannot succeed on the runner. It is exactly the class the cleanroom
# script finds for FILES, and nothing found it for PACKAGES.
#
# So: every third-party import reachable from the modules CI runs must be in requirements.txt.
# Reachable means the CI step scripts themselves plus `scripts/harness/`, because the self-test
# loads harness and factory modules by path at run time.
_REQ_FILE = "requirements.txt"


def _declared_requirements(base: pathlib.Path) -> set[str]:
    p = base / _REQ_FILE
    if not p.exists():
        return set()
    names = set()
    for line in p.read_text(encoding="utf-8-sig").splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        names.add(re.split(r"[<>=!\[\s]", line, 1)[0].strip().lower())
    return names


# IMPORT NAME -> DISTRIBUTION NAME, where they differ. Pillow is the one that bit.
_DIST = {"pil": "pillow", "yaml": "pyyaml", "sklearn": "scikit-learn", "cv2": "opencv-python"}


def find_missing_requirements(base: pathlib.Path) -> list[dict]:
    """A third-party import reachable from the CI steps that requirements.txt does not name."""
    declared = _declared_requirements(base)
    std = set(sys.stdlib_module_names)
    roots = list((base / "scripts" / "harness").glob("*.py"))
    for extra in ("scripts/factory/08_site_truthfulness.py", "scripts/factory/12_unwired.py",
                  "scripts/factory/13_ci_resolves.py", "scripts/factory/14_pipeline_order.py",
                  "scripts/factory/15_source_claims.py", "scripts/factory/03_verify.py",
                  "scripts/factory/00_provenance.py", "scripts/factory/00_metadata_audit.py",
                  "scripts/db/check_migrations.py"):
        q = base / extra
        if q.exists():
            roots.append(q)
    local = {p.stem for p in (base / "scripts").rglob("*.py")}
    seen: dict[str, str] = {}
    for p in roots:
        try:
            tree = ast.parse(p.read_text(encoding="utf-8-sig", errors="ignore"))
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                mods = [a.name.split(".")[0] for a in node.names]
            elif isinstance(node, ast.ImportFrom):
                mods = [(node.module or "").split(".")[0]]
            else:
                continue
            for m in mods:
                if not m or m in std or m in local or m == "scripts":
                    continue
                # CASE-INSENSITIVE, because the module is \`PIL\` and the distribution is
                # \`pillow\`. **The first version of this check reported PIL as missing while
                # requirements.txt named it on the line above** - a check wrong about its own input,
                # which is the defect it was written to find.
                low = m.lower()
                if low in declared or _DIST.get(low, low) in declared:
                    continue
                seen.setdefault(m, p.relative_to(base).as_posix())
    return [{"module": k, "file": v} for k, v in sorted(seen.items())]


# ---------------------------------------------------------------------------
# A DEPLOY THAT CANNOT BE TRIGGERED
# ---------------------------------------------------------------------------
#
# ROUND 134 FOUND THE SITE HAD NOT DEPLOYED IN WEEKS while every run reported success:
#
#   * a push deploys only what its OWN DIFF touched, and the last changes were to scripts/
#     and .github/, so the site was correctly skipped
#   * a manual workflow_dispatch has NO DIFF AT ALL, so dorny/paths-filter returns empty
#     outputs and every job condition is false
#
# There was NO WAY TO DEPLOY THE WEB APP ON DEMAND, and the workflow said so in its own
# comment. The only evidence was a stale string in the live bundle - `Ask AI`, deleted from
# the source two rounds earlier.
#
# So: a deploy workflow with workflow_dispatch must give EVERY conditional job a manual
# escape, or the trigger is decoration.
def find_undeployable_jobs(base: pathlib.Path) -> list[dict]:
    """A deploy job gated on a path filter with no way to force it manually."""
    p = base / ".github" / "workflows" / "deploy.yml"
    if not p.exists():
        return []
    text = p.read_text(encoding='utf-8-sig', errors='ignore')
    if 'workflow_dispatch:' not in text:
        return []
    out = []
    lines = text.splitlines()
    for i, line in enumerate(lines):
        # a job-level condition sits at four spaces
        if not line.startswith('    if: '):
            continue
        cond = line.split('if:', 1)[1]
        if 'inputs.' in cond:
            continue
        job = '?'
        for k in range(i - 1, -1, -1):
            stripped = lines[k]
            if (len(stripped) - len(stripped.lstrip())) == 2 and stripped.rstrip().endswith(':'):
                job = stripped.strip().rstrip(':')
                break
        out.append({'job': job, 'cond': cond.strip()[:70]})
    return out

def find_problems(text: str, check_required: bool = True) -> list[str]:
    problems: list[str] = []
    blocks = run_blocks(text)
    if not blocks:
        return ["the workflow has no run: steps at all"]

    for ln, body in blocks:
        if not body.strip() or body.strip() == "|":
            problems.append("line " + str(ln) + ": an empty run: block")
            continue
        for m in _PATH.finditer(body):
            p = m.group(1)
            if not (ROOT / p).exists():
                problems.append("line " + str(ln) + ": script does not exist: " + p)
        for m in _MODULE.finditer(body):
            mod = m.group(1)
            # find_spec LOCATES the module WITHOUT EXECUTING IT. The first version called
            # import_module, which RUNS the module — so checking `scripts.harness.selftest`
            # executed the whole self-test as a side effect of checking whether it existed, and
            # its output was interleaved with this script's. A check that has side effects is not
            # a check.
            try:
                if importlib.util.find_spec(mod) is None:
                    problems.append("line " + str(ln) + ": module not found: " + mod)
            except (ImportError, ValueError) as e:
                problems.append("line " + str(ln) + ": module does not resolve: " + mod
                                + " (" + type(e).__name__ + ")")

        # guards that must actually be invoked
    if check_required:
        for path, why in REQUIRED_GUARDS.items():
            if path not in " ".join(b for _l, b in blocks):
                problems.append("REQUIRED GUARD NOT RUN IN CI: " + path + " (" + why + ")")
    return problems


# ---------------------------------------------------------------------------
# THE ENV A WORKFLOW SETS MUST MATCH THE ENV THE SCRIPT READS
# ---------------------------------------------------------------------------

_ENV_READ = re.compile(r"environ\.get\(\"([A-Z_][A-Z0-9_]*)\"|getenv\(\"([A-Z_][A-Z0-9_]*)\"")
# ANY env key, not only a `\[object Object]` value. The first version required the expression form, so a
# workflow setting an env to a literal or a shell substitution was read as NOT setting it — the
# check would have flagged a correct workflow.
_ENV_SET = re.compile(r"^\s+([A-Z_][A-Z0-9_]*):", re.M)
_PY_IN_RUN = re.compile(r"python3?\s+(scripts/[A-Za-z0-9_./]+\.py)")


def find_env_mismatches(root: pathlib.Path) -> list[dict]:
    """A script a workflow runs, reading an env var the workflow does not set.

    THE FIRST VERSION OF `export-benchmark.yml` SET `RELAY` AND THE SCRIPT READ `RELAY_URL`. The
    job would have failed on its first run with "refusing to run: set --relay or RELAY_URL." —
    **a workflow that cannot work, written by matching the idea in my head rather than the
    contract in the file.**

    It also passed `HARNESS_CODE`, which the script never sends. An unused secret in the
    environment is the same defect as an unused import, and it implies a gate that is not there.

    Only the env a workflow EXPLICITLY sets is considered, and only for scripts it runs. A
    variable the runner provides itself (`GITHUB_*`, `CI`, `HOME`, `RUNNER_*`) is not a mismatch.
    """
    runner_provided = {
        "GITHUB_OUTPUT", "GITHUB_ENV", "GITHUB_TOKEN", "GITHUB_REPOSITORY", "GITHUB_SHA",
        "GITHUB_REF", "GITHUB_ACTOR", "GITHUB_WORKSPACE", "GITHUB_RUN_ID", "CI", "HOME",
        "PATH", "PWD", "TMPDIR", "USER", "RUNNER_OS", "RUNNER_TEMP", "RUNNER_TOOL_CACHE",
        "PYTHONPATH", "PYTHONUNBUFFERED", "VIRTUAL_ENV", "LANG", "LC_ALL", "NODE_ENV",
    }
    out = []
    for wf in sorted((root / ".github" / "workflows").glob("*.yml")):
        text = wf.read_text(encoding="utf-8-sig", errors="ignore")
        # strip comments: a commented-out schedule names no env
        body = "\n".join(l for l in text.splitlines() if not l.strip().startswith("#"))
        sets = {m.group(1) for m in _ENV_SET.finditer(body)}
        for rel in sorted(set(_PY_IN_RUN.findall(body))):
            script = root / rel
            if not script.exists():
                continue
            reads = set()
            for m in _ENV_READ.finditer(script.read_text(encoding="utf-8-sig", errors="ignore")):
                reads.add(m.group(1) or m.group(2))
            for var in sorted(reads):
                if var in runner_provided or var in sets:
                    continue
                out.append({"workflow": wf.name, "script": rel, "var": var})
    return out



# ---------------------------------------------------------------------------
# A DEPLOY THAT SHIPS CODE BEFORE ITS SCHEMA
# ---------------------------------------------------------------------------

# A KNOWN GAP, RECORDED WITH A REASON. The alternative is to let CI fail on a finding that needs
# the owner's decision - and a guard that is red for reasons unrelated to your change is one
# somebody turns off. **Recording it keeps the finding visible and keeps a NEW one failing.**
#
# `apps/metro-relay` is a separate project with its own D1 database, a `schema.sql` applied by hand,
# and no `migrations/` directory. Giving it a migration path is its own piece of work, and creating
# one unasked would be a bigger change than the finding.
ACCEPTED_NO_MIGRATIONS_DIR = {
    "apps/metro-relay": "separate project; schema.sql applied by hand since before this session. "
                        "A deploy cannot check or apply it - see issue 26",
}


def find_deploy_order_problems(root: pathlib.Path) -> list[str]:
    """A wrangler deploy with no d1 migrations apply before it.

    THE RELAY WAS DEPLOYED WITH NO MIGRATION STEP. A change that needs a new column shipped the
    code and left the database behind: **the API fails in production, on the path a user is
    using**, and nothing here could see it, because check_migrations.py validates the API
    against the migrations in the REPOSITORY, not against what is deployed.

    **Migrations before code is the order that can never be wrong.** The reverse is fine only
    when the change happens to be backward compatible, which is a property of the change rather
    than of the pipeline - so it cannot be relied on.
    """
    out = []
    p = pathlib.Path(root) / ".github" / "workflows" / "deploy.yml"
    if not p.exists():
        return out
    body = "\n".join(l for l in p.read_text(encoding="utf-8-sig").splitlines()
                     if not l.strip().startswith("#"))
    # ONLY AN APP WITH A D1 BINDING NEEDS MIGRATIONS. The first version flagged every deploy and
    # reported three, including `grip-sync`, which uses KV and has no schema at all. **A check
    # that flags a correct workflow is one somebody turns off** - and the two real ones
    # (`relay` and `metro-relay`) were buried in the noise.
    for m in __import__("re").finditer(r"wrangler@[\d.]+ deploy", body):
        before = body[: m.start()]
        # the working-directory of THIS step, searching backwards for the nearest one
        # THE working-directory COMES AFTER run:, NOT BEFORE. Searching backwards found the
        # PREVIOUS step's directory, so the check read the wrong app for every deploy and passed
        # `metro-relay` - which has a D1 database and, like the relay, was never migrated.
        after = body[m.end(): m.end() + 400]
        wm = __import__("re").search(r"working-directory:\s*(\S+)", after)
        wd = wm.group(1) if wm else None
        if not wd:
            continue
        toml = pathlib.Path(root) / wd / "wrangler.toml"
        if not toml.exists() or "[[d1_databases]]" not in toml.read_text(
                encoding="utf-8-sig", errors="ignore"):
            continue
        # AN APP WITH NO MIGRATIONS DIRECTORY HAS NO MIGRATION PATH AT ALL, which is a different
        # statement from "the deploy forgot to apply them". `apps/metro-relay` has a schema.sql
        # and no migrations/, so it is applied by hand and there is nothing for the deploy to run.
        # **Reporting it as a missing step would have produced a step that fails**, and creating
        # another project's migration infrastructure is not this task.
        if not (pathlib.Path(root) / wd / "migrations").exists():
            if wd in ACCEPTED_NO_MIGRATIONS_DIR:
                continue
            out.append("line " + str(before.count(chr(10)) + 1) + ": " + wd
                       + " has a D1 database and NO migrations/ directory - its schema is applied"
                       " by hand, so a deploy cannot check or apply it")
            continue
        # SCOPE THE SEARCH TO THIS JOB. Checking the whole file meant the RELAY's migration step
        # satisfied the check for METRO-RELAY, which sits later and was never migrated. **A check
        # that a neighbour's fix satisfies is not checking the thing in front of it.**
        job_start = 0
        for jm in __import__("re").finditer(r"^  ([a-z][a-z0-9_-]*):\s*$", body[: m.start()],
                                           __import__("re").M):
            job_start = jm.start()
        job_before = body[job_start: m.start()]
        if "d1 migrations apply" not in job_before:
            line = before.count("\n") + 1
            out.append("line " + str(line) + ": " + wd + " deploys with no d1 migrations apply "
                       "earlier in the file, and that app has a D1 database")
    return out


# ---------------------------------------------------------------------------
# A DEPLOY THAT NEVER RUNS THE TESTS
# ---------------------------------------------------------------------------

def find_untested_deploys(root: pathlib.Path) -> list[str]:
    """A deploy step with no test run earlier in the SAME JOB.

    deploy.yml RAN ONLY A TYPECHECK, and every deploy job needed `changes`, NOT `ci`. Both
    workflows trigger on the same push, so **a deploy could complete while CI was failing** -
    and nothing connected the guard suite to what ships.

    The fix runs the tests IN the deploy job, which makes it self-sufficient. That is also what
    this checks, because a requirement expressed as a convention is one that decays.
    """
    import re as _re

    out = []
    p = pathlib.Path(root) / ".github" / "workflows" / "deploy.yml"
    if not p.exists():
        return out
    lines = p.read_text(encoding="utf-8-sig").splitlines()
    job = None
    tested: dict[str, bool] = {}
    for i, line in enumerate(lines, 1):
        m = _re.match(r"^  ([a-z][a-z0-9_-]*):\s*$", line)
        if m:
            job = m.group(1)
            tested.setdefault(job, False)
            continue
        if job is None or line.strip().startswith("#"):
            continue
        if "turbo run test" in line:
            tested[job] = True
        if _re.search(r"wrangler@[\d.]+ (deploy|pages deploy)", line) and not tested.get(job):
            out.append("line " + str(i) + ": job `" + job + "` deploys without running the tests")
    return out


# ---------------------------------------------------------------------------
# A DEPLOY THAT IS GATED OFF SILENTLY
# ---------------------------------------------------------------------------

def find_silent_gates(root: pathlib.Path) -> list[str]:
    """A job output that gates deployments, set without any visible annotation.

    EVERY DEPLOY JOB IS GATED ON `needs.changes.outputs.secrets`. With the Cloudflare secrets
    unset the workflow runs GREEN and deploys NOTHING, and the message saying so went only to
    $GITHUB_OUTPUT - **a file nobody reads**. The run summary said nothing at all.

    **A green run that shipped nothing is the same defect as a pipeline that exits 0 having done
    no work** - the round-87 finding, at the deploy layer.
    """
    import re as _re

    out = []
    p = pathlib.Path(root) / ".github" / "workflows" / "deploy.yml"
    if not p.exists():
        return out
    text = p.read_text(encoding="utf-8-sig")
    # the output names that any deploy job's `if:` actually reads
    gated = set()
    for m in _re.finditer(r"if:.*needs\.changes\.outputs\.([a-z_]+)", text):
        gated.add(m.group(1))
    if not gated:
        return out
    if "::warning" not in text and "::notice" not in text:
        out.append("deploy.yml gates " + str(len(gated)) + " deploy job(s) on "
                   + ", ".join(sorted(gated)) + " and never emits ::warning or ::notice when"
                   " the gate is off, so a run that ships nothing is green and silent")
    return out


# ---------------------------------------------------------------------------
# AN ALERT THAT CANNOT RE-FIRE
# ---------------------------------------------------------------------------

def find_one_shot_alerts(root: pathlib.Path) -> list[str]:
    """A workflow that opens an alert on failure and never closes it.

    FOUR OF THE FIVE DID THIS: the failure step opened an issue ONLY IF none was already open,
    and NOTHING ever closed one. After the first failure the issue stayed open for good, so
    **every later failure created nothing and notified nobody** - the worst state, because it
    looks like alerting.

    grip-rebake was already better: it COMMENTS on an open issue, so a second failure does
    notify. It still left the issue open after a recovery, which is a stale warning - and a
    stale warning is one people learn to ignore.
    """
    out = []
    for p in sorted((pathlib.Path(root) / ".github" / "workflows").glob("*.yml")):
        text = p.read_text(encoding="utf-8-sig", errors="ignore")
        if "failure()" not in text:
            continue
        if not any(k in text for k in ("issues.create", "gh issue create")):
            continue
        closed = ("Alert on recovery" in text or "notify-on-recovery" in text
                  or "state: 'closed'" in text or 'state: "closed"' in text)
        if not closed:
            out.append(p.name + " opens an alert issue and never closes it, so a second"
                       " failure notifies nobody")
    return out


# ---------------------------------------------------------------------------
# A TRIGGER THAT DOES NOT FIRE ON WHAT THE WORKFLOW CHECKS
# ---------------------------------------------------------------------------

def find_path_gaps(root: pathlib.Path) -> list[str]:
    """A workflow whose `paths` filter excludes something its own steps run or read.

    ci.yml triggered on `apps/**`, `packages/**` and `scripts/**` - and NOT on `.github/**` or
    `data/**`. So **a change to a workflow did not run CI**, including the guard that validates
    workflow paths; and a change to the corpus ledger did not run the provenance guard that
    reads it. Every workflow edit made across rounds 105-117 would have skipped CI.

    COVERAGE IS BY EXACT PATH OR BY DIRECTORY WILDCARD. The first version required `scripts/**`
    and reported `graph-check.yml`, which names three exact scripts instead - **a false positive
    on a correct file.** A script is covered when the block lists IT, or lists its directory.

    EACH paths: BLOCK IS CHECKED SEPARATELY: reading the whole file let the `push` list satisfy
    the check for `pull_request`, which a planted fault proved.
    """
    import re as _re

    out = []
    for p in sorted((pathlib.Path(root) / ".github" / "workflows").glob("*.yml")):
        text = p.read_text(encoding="utf-8-sig", errors="ignore")
        if "paths:" not in text:
            continue
        # the exact files this workflow runs
        runs = set(_re.findall(r"python3?\s+(scripts/[A-Za-z0-9_./-]+\.py)", text))
        if not runs:
            continue
        # and the directories whose contents a guard in it reads
        reads_workflows = bool(_re.search(r"13_ci_resolves|12_unwired", text))
        # A BLOCK MAY CONTAIN COMMENTS. The first pattern stopped at the first line that was not
        # a list entry, so a comment inside the block truncated it and every entry after the
        # comment read as MISSING - **the check inventing gaps in a file it had just been given
        # the fix for.** Comment lines are skipped rather than treated as the end.
        blocks = _re.findall(r"paths:\s*\n((?:[ \t]*(?:- [^\n]+|#[^\n]*)\n?)+)", text)
        for b in blocks:
            listed = set(_re.findall(r'"([^"]+)"', b))
            for f in sorted(runs):
                if f in listed or f.split("/")[0] + "/**" in listed:
                    continue
                out.append(p.name + " runs " + f + " but a paths: block covers it by neither"
                           " that path nor " + f.split("/")[0] + "/**")
            if reads_workflows and ".github/**" not in listed:
                out.append(p.name + " runs a guard that reads .github/workflows/, but a"
                           " paths: block does not include .github/**")
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Every command every workflow runs must resolve.")
    ap.add_argument("--workflow", default=None,
                    help="one workflow; by default ALL of them")
    args = ap.parse_args(argv)
    files = [pathlib.Path(args.workflow)] if args.workflow else all_workflows()
    if not files or not all(p.exists() for p in files):
        print("no workflow at " + str(args.workflow), file=sys.stderr)
        return 2

    total_blocks = 0
    all_problems: list[str] = []
    seen_guards: set[str] = set()
    for p in files:
        text = p.read_text(encoding="utf-8-sig")
        blocks = run_blocks(text)
        total_blocks += len(blocks)
        all_problems += [p.name + ": " + x for x in find_problems(text, check_required=False)]
        joined = " ".join(b for _l, b in blocks)
        for g in REQUIRED_GUARDS:
            if g in joined:
                seen_guards.add(g)

    # THE REQUIRED GUARDS ARE CHECKED ACROSS ALL WORKFLOWS TOGETHER, because it does not matter
    # which file runs them — only that something does.
    for g, why in REQUIRED_GUARDS.items():
        if g not in seen_guards:
            all_problems.append("REQUIRED GUARD NOT RUN IN ANY WORKFLOW: " + g + " (" + why + ")")

    print("checked " + str(len(files)) + " workflow(s), " + str(total_blocks) + " run step(s)")
    for p in files:
        print("  " + p.name)
    print()
    path_gaps = find_path_gaps(ROOT)
    if path_gaps:
        print(str(len(path_gaps)) + " TRIGGER PATH GAP(S):")
        for x in path_gaps:
            print("  " + x)
        print()
        print("A workflow that does not fire on what it checks is a check that does not run.")
        print()
        all_problems.append("a check above reported a problem")
    one_shot = find_one_shot_alerts(ROOT)
    if one_shot:
        print(str(len(one_shot)) + " ALERT(S) THAT CANNOT RE-FIRE:")
        for x in one_shot:
            print("  " + x)
        print()
        print("An alert that fires once and then goes quiet is worse than none, because it looks")
        print("like alerting. Closing on recovery is what makes the next failure a new event.")
        print()
        all_problems.append("a check above reported a problem")
    silent = find_silent_gates(ROOT)
    if silent:
        for x in silent:
            print("A GATED DEPLOY THAT SAYS NOTHING:")
            print("  " + x)
        print()
        print("A green run that shipped nothing is the same defect as a pipeline that exits 0")
        print("having done no work.")
        print()
        all_problems.append("a check above reported a problem")
    untested = find_untested_deploys(ROOT)
    if untested:
        print(str(len(untested)) + " DEPLOY(S) THAT NEVER RUN THE TESTS:")
        for x in untested:
            print("  " + x)
        print()
        print("A deploy that does not run the tests can ship a change whose tests fail. Running them")
        print("in the job makes it self-sufficient, whatever else is happening on the same push.")
        print()
        all_problems.append("a check above reported a problem")
    req_problems = find_missing_requirements(ROOT)
    if req_problems:
        print(str(len(req_problems)) + " PACKAGE(S) CI DOES NOT INSTALL:")
        for x in req_problems:
            print("  " + x["module"] + "  (imported by " + x["file"] + ")")
        print()
        print("The runner starts with a bare Python. A local machine HAS these, so the import")
        print("succeeds here and cannot succeed there - add it to " + _REQ_FILE + ".")
        print()
        all_problems.append("a check above reported a problem")
    undep = find_undeployable_jobs(ROOT)
    if undep:
        print(str(len(undep)) + " DEPLOY JOB(S) THAT CANNOT BE TRIGGERED MANUALLY:")
        for x in undep:
            print("  " + x["job"] + "  if: " + x["cond"])
        print()
        print("A manual run has no diff, so a path filter is false there and the job is skipped.")
        print("Every conditional deploy job needs an inputs.force_* escape, or the workflow_dispatch")
        print("trigger does nothing for it.")
        print()
        all_problems.append("a check above reported a problem")
    step_problems = find_steps_without_actions(ROOT)
    if step_problems:
        print(str(len(step_problems)) + " WORKFLOW STEP(S) WITH NO ACTION:")
        for x in step_problems:
            print("  " + x["file"] + ":" + str(x["line"]) + "  " + x["step"])
        print()
        print("A step needs `run:` or `uses:`. Without either, GitHub REJECTS THE WHOLE")
        print("WORKFLOW - and a rejected run reports `jobs: 0` with conclusion `failure`, which")
        print("reads like a failing test rather than a file that never loaded.")
        print()
        all_problems.append("a check above reported a problem")
    order_problems = find_deploy_order_problems(ROOT)
    if order_problems:
        print(str(len(order_problems)) + " DEPLOY(S) THAT SHIP CODE BEFORE ITS SCHEMA:")
        for x in order_problems:
            print("  " + x)
        print()
        print("Migrations before code is the order that can never be wrong. The reverse is fine")
        print("only when the change happens to be backward compatible, which is a property of the")
        print("change rather than of the pipeline, so it cannot be relied on.")
        print()
        all_problems.append("a check above reported a problem")
    env_problems = find_env_mismatches(ROOT)
    if env_problems:
        print(str(len(env_problems)) + " ENV MISMATCH(ES) BETWEEN A WORKFLOW AND THE SCRIPT IT RUNS:")
        for x in env_problems:
            print("  " + x["workflow"] + " runs " + x["script"] + ", which reads " + x["var"])
            print("    but the workflow does not set it, so the script would refuse or misbehave.")
        print()
        print("A workflow that cannot work is worse than no workflow: it looks like automation")
        print("and fails every night. export-benchmark.yml set RELAY where the script read")
        print("RELAY_URL, and would have refused the first time it ran.")
        print()
        # all_problems is a LIST OF STRINGS. The first version set it to True, and the
        # reporting below does len() and iterates it - so a real mismatch crashed the guard
        # instead of reporting it. A check that crashes on the condition it exists to find is
        # the same defect as a check that cannot fail.
        all_problems.append(
            x["workflow"] + " runs " + x["script"] + " but does not set " + x["var"])
    if not all_problems:
        print("OK — every command resolves, every required guard is invoked, and every")
        print("     workflow sets the env its scripts read.")
        return 0
    print(str(len(all_problems)) + " PROBLEM(S):")
    for x in all_problems:
        print("  " + x)
    print()
    print("A step that names a missing file is a guard that will never run.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
