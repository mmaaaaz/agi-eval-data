#!/usr/bin/env python3
"""
RUN THE PIPELINE.

WHY THIS EXISTS
---------------
The pipeline is thirteen documented stages and NOTHING RAN THEM. There was no
orchestration at all: an audit of every script found 18 CLI entry points and exactly two
invoked from CI. "Run the pipeline" meant remembering eight commands, their order, their
inputs, and which of them cost money.

WHAT IT ENFORCES
----------------
1. ORDER. Stages run in dependency order and stop at the first failure, so a broken
   stage is not papered over by the next one.
2. PRECONDITIONS. A stage whose input file is missing is reported as SKIP with the
   reason, not run and left to fail obscurely.
3. THE SPEND BOUNDARY, which is the most useful thing here. Three stages cost money:
   tagging, question generation, and every harness sweep. Those are marked PAID and are
   REFUSED unless --spend is passed. Everything else is free and local. The owner's rule
   is that inference on images is the only permitted spend, so the pipeline should not be
   able to spend by accident.

Usage:
    python scripts/factory/run_pipeline.py --list
    python scripts/factory/run_pipeline.py --from provenance --to verify
    python scripts/factory/run_pipeline.py --from tag --to generate --spend
"""
from __future__ import annotations

import argparse
import os
import pathlib
import subprocess
import sys
from dataclasses import dataclass, field

ROOT = pathlib.Path(__file__).resolve().parents[2]
FACTORY = ROOT / "data" / "factory"


@dataclass
class Stage:
    key: str
    path: str          # relative to the repo root
    what: str
    paid: bool = False
    needs_files: list[str] = field(default_factory=list)
    makes_files: list[str] = field(default_factory=list)
    needs_env: list[str] = field(default_factory=list)
    module: bool = False   # harness modules use relative imports and must run with -m


# The order is the dependency order. Every "makes" feeds a later "needs".
STAGES: list[Stage] = [
    Stage("provenance", "scripts/factory/00_provenance.py",
          "audit the corpus and build the releasable ledger",
          needs_files=["data/latest.json"],
          makes_files=["data/factory/provenance.jsonl", "data/factory/provenance_summary.json"]),
    Stage("select", "scripts/factory/01_select_images.py",
          "stratified shortlist. Size --target from the ITEM target: ~3,200 images, not 600",
          needs_files=["data/latest.json"], makes_files=["data/factory/candidates.json"]),
    Stage("seed", "scripts/factory/00b_seed_selections.py",
          "propose the shortlist to the selection store",
          needs_files=["data/factory/candidates.json"], needs_env=["RELAY_URL"]),
    Stage("tag", "scripts/factory/04_tag_ground.py",
          "domain labels from a closed taxonomy",
          paid=True, needs_files=["data/factory/candidates.json"],
          makes_files=["data/factory/tagged.jsonl"], needs_env=["VLLM_BASE_URL"]),
    Stage("generate", "scripts/factory/02_generate_questions.py",
          "candidate questions, taxonomy enforced. --per-image 4 matches the plan's "
          "10,000 items from 2,500 images in ONE call per image",
          paid=True, needs_files=["data/factory/candidates.json"],
          makes_files=["data/factory/generated.jsonl"], needs_env=["OPENROUTER_API_KEY"]),
    Stage("import", "scripts/factory/05_import_candidates.py",
          "candidates into the review queue as drafts, pairs as one unit",
          needs_files=["data/factory/generated.jsonl"], needs_env=["RELAY_URL"]),
    Stage("export", "scripts/factory/02_fetch_export.py",
          "the canonical export the gate and a release read",
          makes_files=["data/factory/questions.jsonl"], needs_env=["RELAY_URL"]),
    Stage("verify", "scripts/factory/03_verify.py",
          "the integrity gate. exits non-zero on any violation",
          needs_files=["data/factory/questions.jsonl"]),
    Stage("consent", "scripts/factory/09_consent.py",
          "record who granted the right to redistribute, and report coverage",
          makes_files=["data/factory/consent.jsonl"]),
    Stage("pii", "scripts/factory/10_pii.py",
          "record the face and plate review, and guard the GPS requirement",
          makes_files=["data/factory/pii.jsonl"]),
    Stage("mirrors", "scripts/factory/16_html_mirrors.py",
          "each document's hand-maintained .html must not drift from its .md. Free, local, and "
          "it runs where the private plan exists"),
    Stage("plancheck", "scripts/factory/11_plan_truthfulness.py",
          "a stated total must match its own rows. Runs HERE because .scratch/ is private: "
          "CI cannot check the plan, so the release path does"),
    Stage("release", "scripts/harness/build_release.py",
          "freeze a release with a ground-truth hash",
          needs_files=["data/factory/questions.jsonl"]),
    Stage("blind", "scripts/harness/blind.py",
          "ask every item of a text-only model, image withheld",
          paid=True, needs_env=["VLLM_BASE_URL"]),
    Stage("sweep_open", "scripts/harness/run_open.py",
          "run open-weight models on your own GPU", paid=True, needs_env=["VLLM_BASE_URL"]),
    Stage("attacks", "scripts/harness/run_attack.py",
          "typographic, patch and corruption tracks. PAID — one call per (item, condition). "
          "The patch is NOT adversarially optimised; see the module docstring",
          paid=True, needs_files=["data/factory/questions.jsonl"], needs_env=["VLLM_BASE_URL"]),
    Stage("counterfactual", "scripts/harness/run_counterfactual.py",
          "remove the grounded object and check the answer changes. PAID — a diffusion inpaint",
          paid=True, needs_files=["data/factory/questions.jsonl"], needs_env=["VLLM_BASE_URL"]),
    Stage("elicit", "scripts/harness/run_elicitation.py",
          "the three confidence arms. PAID: 2 calls/item for A1+A3, k for A2. This is the only "
          "stage that is allowed to write a confidence column",
          paid=True, needs_env=["OPENROUTER_API_KEY"]),
    Stage("crop", "scripts/harness/run_crop.py",
          "the crops-out-the-evidence curve: accuracy should fall and abstention rise as the "
          "answer leaves the frame. PAID — one call per (item, fraction)",
          paid=True, needs_files=["data/factory/questions.jsonl"], needs_env=["VLLM_BASE_URL"]),
    Stage("sweep_closed", "scripts/harness/run_closed.py",
          "run closed models on a capped subsample", paid=True, needs_env=["OPENROUTER_API_KEY"]),
    Stage("analyze", "scripts/harness/analyze.py",
          "the paper's tables from a trace, with no database"),
]


def missing_files(stage: Stage) -> list[str]:
    """Files a stage needs that are absent OR empty.

    Empty counts as missing. A 0-byte output is what a failed or dry stage leaves
    behind, and treating it as present lets the next stage run against nothing and fail
    for a reason that has nothing to do with the real problem. This is not hypothetical:
    an empty data/factory/questions.jsonl sat in the tree for weeks, created by a dry run
    that should not have touched the filesystem at all.
    """
    out = []
    for f in stage.needs_files:
        p = ROOT / f
        if not p.exists() or p.stat().st_size == 0:
            out.append(f)
    return out


def missing_env(stage: Stage) -> list[str]:
    return [e for e in stage.needs_env if not os.environ.get(e)]


def missing_outputs(stage: Stage) -> list[str]:
    """Files a stage DECLARED it would produce, that are absent or empty.

    WHY THIS IS SEPARATE FROM THE EXIT CODE
    ---------------------------------------
    A stage can exit 0 and write nothing — a misconfigured path, a bug in its output
    handling, a silently-skipped branch. The pipeline printed "EXPECTED BUT ABSENT" and
    then counted the stage as `ran` and carried on, so the run finished reporting
    `failed=0` about a pipeline that had produced nothing. The declaration existed and
    nothing acted on it, which is the same failure as a guard with no signal.

    Empty counts, for the same reason it counts as a missing input: a 0-byte artefact is
    what a broken stage leaves behind.
    """
    out = []
    for f in stage.makes_files:
        p = ROOT / f
        if not p.exists() or p.stat().st_size == 0:
            out.append(f)
    return out


def show() -> None:
    # Wide enough that a stage's description is not cut mid-sentence. The old 46-character
    # column truncated "Size --target from the ITEM target: ~3,200 images, not 600" to
    # "Size --target from the I", which is worse than no note at all.
    print("%-12s %-6s %-64s %s" % ("stage", "cost", "what", "needs"))
    print("-" * 130)
    for s in STAGES:
        cost = "PAID" if s.paid else "free"
        needs = ", ".join(s.needs_files + [e + " (env)" for e in s.needs_env]) or "—"
        print("%-12s %-6s %-64s %s" % (s.key, cost, s.what[:64], needs[:52]))
    paid = [s.key for s in STAGES if s.paid]
    print()
    print("PAID stages (" + str(len(paid)) + "): " + ", ".join(paid))
    print("These are the ONLY permitted spend: inference on images. They are refused")
    print("unless --spend is passed, so the pipeline cannot spend by accident.")


def main() -> int:
    ap = argparse.ArgumentParser(description="Run the benchmark pipeline in dependency order.")
    ap.add_argument("--list", action="store_true", help="show the stages and their cost")
    ap.add_argument("--from", dest="start", default=None, help="first stage key")
    ap.add_argument("--to", dest="end", default=None, help="last stage key")
    ap.add_argument("--spend", action="store_true",
                    help="permit the PAID stages. Without this they are REFUSED, not skipped silently.")
    ap.add_argument("--dry-run", action="store_true", help="show what would run, and why not")
    args = ap.parse_args()

    if args.list:
        show()
        return 0

    keys = [s.key for s in STAGES]
    if args.start and args.start not in keys:
        print("unknown stage: " + args.start, file=sys.stderr); return 2
    if args.end and args.end not in keys:
        print("unknown stage: " + args.end, file=sys.stderr); return 2
    lo = keys.index(args.start) if args.start else 0
    hi = keys.index(args.end) if args.end else len(keys) - 1
    if lo > hi:
        print("--from comes after --to", file=sys.stderr); return 2
    chosen = STAGES[lo:hi + 1]

    print("pipeline: " + chosen[0].key + " -> " + chosen[-1].key
          + ("  (SPEND PERMITTED)" if args.spend else "  (free stages only)"))
    print()

    ran = skipped = refused = failed = 0
    for s in chosen:
        miss_f = missing_files(s)
        miss_e = missing_env(s)

        if s.paid and not args.spend:
            print("REFUSED  " + s.key + "  — this stage costs money.")
            print("         re-run with --spend if you mean it. This is the only permitted")
            print("         spend: inference on images.")
            refused += 1
            continue
        # THE ENV CHECK COMES FIRST, AND IT IS THE SPEND RULE THAT DECIDES THE ORDER.
        #
        # It used to follow the input check, so on a clean checkout - where
        # `data/factory/candidates.json` does not exist - a paid stage with `--spend` and no env
        # reported 'SKIP missing input' and **never reached the refusal**. The owner passes
        # `--spend` to authorise money; the one message they must get back is about the money,
        # not about a file.
        #
        # A free stage is unaffected: it skips for either reason.
        if miss_e:
            # A PAID STAGE IS NEVER SILENTLY SKIPPED.
            #
            # Measured in round 87: `--from tag --to tag --spend` with no VLLM_BASE_URL printed
            # "SKIP tag — missing env" and exited 0. The user had AUTHORISED the spend and the
            # stage did not run, and the pipeline reported success. "Did nothing, looks like
            # success" is the defect this repository keeps producing.
            #
            # A free stage may be skipped: a partial run legitimately does not need it. A paid one
            # was explicitly asked for, so not running it is a REFUSAL.
            if s.paid:
                print("REFUSED  " + s.key + "  — paid stage, but these env vars are unset: "
                      + ", ".join(m for m in miss_e))
                print("         spend was authorised and the work did not happen, so this is not")
                print("         a success. Set them, or drop the stage from the range.")
                refused += 1
                continue
            print("SKIP     " + s.key + "  — missing env: " + ", ".join(m for m in miss_e))
            skipped += 1
            continue
        if miss_f:
            print("SKIP     " + s.key + "  — missing input: " + ", ".join(miss_f))
            skipped += 1
            continue

        cmd = ([sys.executable, "-m", s.path.replace("/", ".")[:-3]] if s.module
               else [sys.executable, str(ROOT / s.path)])
        print("RUN      " + s.key + "  " + s.what)
        if args.dry_run:
            ran += 1
            for f in s.makes_files:
                print("         would write " + f)
            continue

        r = subprocess.run(cmd, cwd=str(ROOT))
        if r.returncode != 0:
            print()
            print("FAILED   " + s.key + " exited " + str(r.returncode) + ".")
            print("         stopping here: the next stage would build on a broken input.")
            failed += 1
            break
        absent = missing_outputs(s)
        for f in s.makes_files:
            if f not in absent:
                print("         wrote  " + f)
        if absent:
            print()
            print("FAILED   " + s.key + " exited 0 but produced no output:")
            for f in absent:
                print("           " + f)
            print("         a stage that reports success and writes nothing is not a")
            print("         success, and the next stage would build on nothing.")
            failed += 1
            break
        ran += 1

    print()
    print("ran=" + str(ran) + " skipped=" + str(skipped)
          + " refused=" + str(refused) + " failed=" + str(failed))
    if refused:
        print("Refused stages are the only ones that would spend money. Nothing else did.")
    # THE EXIT CODE MUST DISTINGUISH "DID THE WORK" FROM "DID NOTHING".
    #
    # It was `1 if failed else 0`, so a range in which every stage was REFUSED or SKIPPED still
    # exited 0 — and a shell script or CI job calling this could not tell a completed run from a
    # run that did nothing at all.
    #
    # `refused` now fails the run: a paid stage that did not execute is the opposite of success.
    # A skipped FREE stage stays exit 0, because a partial run legitimately does not need it.
    if refused:
        print()
        print("EXIT 1: " + str(refused) + " stage(s) were refused, so the requested work did not")
        print("        happen. A refusal is not a quieter kind of success.")
    return 1 if (failed or refused) else 0


if __name__ == "__main__":
    raise SystemExit(main())
