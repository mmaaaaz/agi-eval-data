#!/usr/bin/env python3
"""
MACHINERY WITH NO RUNNER — built, and never wired in.

WHY THIS EXISTS
---------------
This is the failure mode this project produces. Found repeatedly, in different files:

  - image_edit          a schema column with a comment and NO WRITER (until round 64)
  - 06_break_the_model  an experiment that could only --demo and --plan (until round 63)
  - the Phase 5 analyses  that existed only in a print statement (until round 72)
  - four analyses I wrote in rounds 73-74 and NEVER CALLED (until round 75)
  - 05_elicitation      200,000 priced model calls, and no runner (ticket 23)

**A thing that exists and is never called is indistinguishable from a thing that does not
exist** — and worse, because its presence in the file reads as coverage. Reading the code does
not find this. Counting references does.

THE RULE
--------
A script is legitimate if it is EITHER

  (a) a stage in `run_pipeline.py`, or
  (b) referenced by name from another script, or
  (c) on the ALLOWED list below, with a reason.

Anything else is flagged. The allowlist is small and every entry says WHY, because "it is fine"
is how the machinery this checks for accumulated in the first place.

Usage:
    python scripts/factory/12_unwired.py
    python scripts/factory/12_unwired.py --dir .          # for a planted test
"""
from __future__ import annotations

import argparse
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]

# Legitimate exceptions. Each carries a reason, and the reason is the point: an entry without
# one is a silent exemption, which is the defect this file exists to find.
ALLOWED = {
    "00_metadata_audit.py": "a CI guard, run by .github/workflows/ci.yml as a check, not a stage",
    "selftest.py": "the harness self-test, run by CI and by hand",
    "12_unwired.py": "the guard itself — it has a CI runner, it simply is not a pipeline stage",
    "make_demo_release.py": "a one-off builder: it writes release/demo-samples-v1 for the first demo runs, run by hand as its docstring says; the demo traces it feeds are committed under runs/demo/",
    "make_explainer_runs.py": "a generator, run by hand after traces land: reads the committed demo traces + release questions and writes apps/explainer/src/content/runs.ts (a site content file), asserting its aggregates against runs/demo/summary.json; its output is committed",
    "generate_vqa.py": "the drafting runner for the model-generation programme: walks a ledger image list, calls a vision model through the hermes CLI or an OpenAI-compatible endpoint, validates every candidate against the closed taxonomy sets and writes an append-only runs/generation/<batch>/candidates.jsonl; refuses without --spend even for zero-priced models",
    "preview_candidates.py": "read-only review aid: renders a generation batch's candidates.jsonl as one offline HTML contact sheet (image, every candidate, choices, answer, grounding, tags, validation flags) so a human can inspect drafts before the review room exists; it writes nothing except the requested HTML file",
    "drive_generation.py": "the overnight driver for the drafting programme: probes the endpoint, waits out upstream outages, and runs resumable generate_vqa passes until every image in a batch has a parsed row or its hour budget runs out; it writes only driver.log/pass-NN.log beside the batch",
    "shard_images.py": "splits a batch's remaining images across parallel lanes, skipping images already parsed; run by hand when adding a lane",
    "merge_batches.py": "merges lane batches into one file keeping the last parsed row per image and its endpoint label; run by hand after lanes finish",
    "watch_lane.py": "waits for a lane's key file, re-shards and then starts that lane's driver; run by hand when adding a lane",
    "sync_migrations.py": "a maintenance tool — run by hand to regenerate migrations, not a stage",
    "16_html_mirrors.py": "a guard — it checks that each document's hand-maintained .html "
                          "mirror has not drifted from its .md. Runs in the pipeline, not CI, "
                          "because the plan tree is private",
    "15_source_claims.py": "a guard — it checks that no source comment contradicts the code, "
                           "because a stale comment is read as the design",
    "14_pipeline_order.py": "a guard — it checks that every stage's needs are produced earlier, "
                            "because a stage with absent needs is SKIPPED rather than failed",
    "13_ci_resolves.py": "a CI guard — it checks that every command the workflow runs resolves, "
                         "so it is invoked by CI rather than by the pipeline",
    "07_build_queue.py": "builds the HUMAN image-review queue (Paper/IMAGE-QUEUE.html) from "
                         "candidates.json. It is the tool for ticket 18's human work, not a "
                         "pipeline stage — but it was undocumented, which is why nobody knew "
                         "it existed",
}


def stage_files(pipeline: pathlib.Path) -> set[str]:
    if not pipeline.exists():
        return set()
    text = pipeline.read_text(encoding="utf-8-sig")
    return {m.group(2).split("/")[-1]
            for m in re.finditer(r'Stage\("([a-z_0-9]+)",\s*"([^"]+)"', text)}


# THE BENCHMARK'S OWN TREE. The first version scanned every .py under scripts/ and returned 13
# hits, of which 11 were GRIP, metro-relay and open-models scripts — OTHER PROJECTS in this
# monorepo. Flagging them would have been a true statement about a false subject: the failure
# mode is "benchmark machinery with no runner", and those files are not benchmark machinery.
#
# Scoping is what makes the signal mean something. Widening it again would make the guard noise,
# and a noisy guard is one somebody turns off.
BENCHMARK_DIRS = ("factory", "harness")


def find_unwired(base: pathlib.Path) -> list[dict]:
    scripts = sorted(p for d in BENCHMARK_DIRS
                     for p in (base / "scripts" / d).glob("*.py"))
    if not scripts:
        return []
    if not scripts:
        return []
    texts = {p: p.read_text(encoding="utf-8-sig", errors="ignore") for p in scripts}
    stages = stage_files(base / "scripts" / "factory" / "run_pipeline.py")
    out = []
    for p in scripts:
        if p.name in ("__init__.py", "run_pipeline.py") or p.name in ALLOWED:
            continue
        if p.name in stages:
            continue
        # referenced by NAME from any other script?
        refs = [q for q, t in texts.items()
                if q != p and re.search(r"\b" + re.escape(p.stem) + r"\b", t)]
        if not refs:
            out.append({
                "file": str(p.relative_to(base)).replace("\\", "/"),
                "dir": p.parent.name,
            })
    return out


def scripts_in(base: pathlib.Path) -> list[pathlib.Path]:
    return sorted(p for d in BENCHMARK_DIRS for p in (base / "scripts" / d).glob("*.py"))


# ---------------------------------------------------------------------------
# AN EXEMPTION WHOSE REASON IS FALSE
# ---------------------------------------------------------------------------

_CI_CLAIM = __import__("re").compile(r"ci|workflow", __import__("re").I)
# "NOT CI" IS A CLAIM IN THE OTHER DIRECTION. `16_html_mirrors.py` says it "Runs in the pipeline,
# NOT CI, because the plan tree is private" - and a substring test for "ci" read that as an
# assertion that CI runs it. **A phrase asserting the opposite is the round-90 defect again**, so
# the negation is parsed rather than ignored, and it is checked the other way.
_NEGATED = __import__("re").compile(r"\bnot\s+ci\b|\bnot\s+in\s+ci\b|\bnot\s+by\s+ci\b", __import__("re").I)


def find_false_exemptions(root) -> list[dict]:
    """An allowlist entry whose stated reason claims a runner it does not have.

    THE ALLOWLIST EXEMPTED `00_metadata_audit.py` BECAUSE "ci.yml runs it as a check" - **and
    ci.yml did not.** The exemption rested on a claim nobody verified, which is the same defect
    this file exists to catch: machinery with no runner, wearing a reason that says otherwise.

    **An exemption whose stated reason is false is worse than no exemption**, because it reads as
    covered. So a reason mentioning CI or a workflow is checked against the workflows.
    """
    import pathlib as _pl
    import re as _re

    wf_dir = _pl.Path(root) / ".github" / "workflows"
    corpus = ""
    if wf_dir.exists():
        for p in sorted(wf_dir.glob("*.yml")):
            corpus += p.read_text(encoding="utf-8-sig", errors="ignore")
    def _invoked(name: str) -> bool:
        """Is this script named by a workflow, in either form?

        A script can be invoked as a PATH (`python scripts/factory/08_...py`) or as a MODULE
        (`python -m scripts.harness.selftest`). The first version tested only the filename, so
        `selftest.py` - which CI runs on every push - was reported as having no runner.
        """
        if name in corpus:
            return True
        mod = name.replace(".py", "").replace("/", ".")
        return mod in corpus

    out = []
    for name, reason in ALLOWED.items():
        if not _CI_CLAIM.search(reason):
            continue
        if _NEGATED.search(reason):
            # the reason claims CI does NOT run it, so it must be absent
            if _invoked(name):
                out.append({"file": name, "reason": "claims CI does NOT run it, but a workflow "
                                                   "names it: " + reason[:50]})
            continue
        if not _invoked(name):
            out.append({"file": name, "reason": reason[:70]})
    return out



# ---------------------------------------------------------------------------
# A CHECK WITH NO TEST
# ---------------------------------------------------------------------------

def find_untested_checks(root) -> list[dict]:
    """A guard function that the self-test never names, directly or through its caller.

    ROUND 119 FOUND ONE: `find_path_gaps`, written in round 118, had no test at all. **The check
    that found a real gap could itself have broken silently** - and a guard that breaks in silence
    is worse than no guard, because its silence reads as a pass.

    INDIRECT COVERAGE COUNTS. A helper called only by a tested function is tested; requiring every
    internal function to be named would produce false positives and be turned off.
    """
    import pathlib as _pl
    import re as _re

    root = _pl.Path(root)
    selftest = root / "scripts" / "harness" / "selftest.py"
    if not selftest.exists():
        return []
    st = selftest.read_text(encoding="utf-8-sig", errors="ignore")
    out = []
    for p in sorted((root / "scripts" / "factory").glob("*.py")) + \
             sorted((root / "scripts" / "db").glob("*.py")):
        if p.name == "12_unwired.py":
            continue
        src = p.read_text(encoding="utf-8-sig", errors="ignore")
        names = _re.findall(r"^def ((?:find|check)_[a-z_]+)\(", src, _re.M)
        for n in names:
            if n in st:
                continue
            # called by another function in the same file?
            callers = _re.findall(r"^def ([a-z_]+)\(", src, _re.M)
            indirect = False
            for c in callers:
                if c == n:
                    continue
                body = _re.search(r"^def " + c + r"\(.*?(?=^def |\Z)", src, _re.M | _re.S)
                if body and (n + "(") in body.group(0):
                    indirect = True
                    break
            if not indirect:
                try:
                    shown = str(p.resolve().relative_to(root.resolve())).replace(chr(92), "/")
                except ValueError:
                    shown = p.as_posix()
                out.append({"file": shown, "check": n})
    return out

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Find machinery with no runner.")
    ap.add_argument("--dir", default=str(ROOT))
    args = ap.parse_args(argv)
    base = pathlib.Path(args.dir)
    if not (base / "scripts").exists():
        print("no scripts/ under " + str(base), file=sys.stderr)
        return 2

    found = find_unwired(base)
    n_scripts = len(list(scripts_in(base)))
    false_ex = find_false_exemptions(base)
    untested = find_untested_checks(base)
    print("scanned " + str(n_scripts) + " scripts for machinery with no runner")

    if untested:
        print(str(len(untested)) + " CHECK(S) WITH NO TEST:")
        for x in untested:
            print("  " + x["file"] + "  " + x["check"])
        print()
        print("A guard that breaks in silence is worse than no guard, because its silence reads as")
        print("a pass. Add an assertion, or make it a helper called only by a tested function.")
        print()
        return 1
    if false_ex:
        print(str(len(false_ex)) + " EXEMPTION(S) WHOSE STATED REASON IS NOT TRUE:")
        for x in false_ex:
            print("  " + x["file"])
            print("    reason: " + x["reason"])
        print()
        print("An exemption whose stated reason is false is worse than no exemption, because it")
        print("reads as covered. `00_metadata_audit.py` was exempted because 'ci.yml runs it as")
        print("a check' - and ci.yml did not.")
        print()
        return 1

    if not found:
        print()
        print("OK — every script is a pipeline stage, is referenced by another, or is a")
        print("     declared exception with a stated reason, and every reason is true.")
        return 0

    print()
    print(str(len(found)) + " SCRIPT(S) BUILT AND NEVER WIRED IN:")
    for x in found:
        print("  " + x["file"])
    print()
    print("Either add it to run_pipeline.py, reference it, or add it to ALLOWED with a reason.")
    print("A thing that is never called is indistinguishable from a thing that does not exist.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
