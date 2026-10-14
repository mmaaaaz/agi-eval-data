#!/usr/bin/env python3
"""
RUN THE THREE CONFIDENCE-ELICITATION ARMS against a frozen release.

WHY THIS EXISTS
---------------
`scripts/factory/05_elicitation.py` builds the three arms and parses their replies. **It calls
nothing.** Measured in round 76: no other script in `scripts/` mentions elicitation at all, so the
paper's calibration contribution was a design with no measurement behind it.

And that mattered more than a missing tool: `roadmap.md` and that file's own docstring state the
claim that **the elicitation METHOD is a confound in reported calibration**. Running one arm and
calling it "the model's confidence" is the exact mistake being criticised. The project criticised
a practice it could not itself avoid, because it had no arm running.

WHAT IT DOES
-------------
  A1  verbalised        1 call/item   - answer, then state a confidence
  A2  self-consistency  k calls/item  - sample at T>0, answer frequency IS the distribution
  A3  order-then-rate   1 call/item   - answer FIRST, then rate it

Each call is one row carrying `arm` and `confidence`, so `analyze.py --field confidence` can put
the three side by side - which is the whole point, since they are expected to disagree.

THE PROMPTS ARE NOT DUPLICATED HERE. They are the experimental apparatus and live in
`05_elicitation.py`; this imports them by path, because a module whose name starts with a digit
cannot be imported normally. Two copies of a prompt would be two experiments wearing one name.

COST
----
A1+A3 = 2 calls/item/model. A2 = k calls/item/model. This is a PAID stage and refuses without
`--spend`, like every other runner.

Usage:
    python -m scripts.harness.run_elicitation --release release/v1 --model m --out runs/e.jsonl --dry-run
    python -m scripts.harness.run_elicitation --release release/v1 --model m --out runs/e.jsonl --spend
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import sys
import time

from .backends import StubBackend, from_env
from .recipe import Recipe
from .release import load
from .spend import SPEND_HELP, refuse_without_spend

ROOT = pathlib.Path(__file__).resolve().parents[2]

# The apparatus. Imported by path because `05_elicitation` begins with a digit.
_spec = importlib.util.spec_from_file_location(
    "_elic", str(ROOT / "scripts" / "factory" / "05_elicitation.py"))
_elic = importlib.util.module_from_spec(_spec)
sys.modules["_elic"] = _elic
_spec.loader.exec_module(_elic)

ARMS = ("A1_verbalised", "A2_self_consistency", "A3_order_then_rate")


def prompts_for(arm: str, question: str) -> list[str]:
    """The prompt(s) one call to this arm sends. A2 sends the SAME prompt k times."""
    if arm == "A1_verbalised":
        return [_elic.P_VERBALISED.format(question=question)]
    if arm == "A2_self_consistency":
        return [_elic.P_ANSWER.format(question=question)]
    if arm == "A3_order_then_rate":
        return [_elic.P_ORDER_THEN_RATE.format(question=question)]
    raise ValueError("unknown arm: " + arm)


def confidence_for(arm: str, replies: list[str]) -> tuple[float | None, str]:
    """(confidence, answer_text) for one item under one arm.

    A missing confidence is returned as None and the row is written anyway. **It is never
    imputed**: an arm that failed to produce a number is a datum about that arm, and filling it in
    would invent the very quantity being measured. `analyze.calibration` excludes those rows and
    reports how many it excluded.
    """
    if arm == "A2_self_consistency":
        # The distribution comes from the SAMPLES, not from a stated number.
        dist = _elic.frequency_distribution(replies)
        conf = _elic.top_probability(dist) if dist else None
        # the ANSWER still comes through the parser. The first version returned replies[0] raw,
        # so the answer column held "ANSWER: 2\nCONFIDENCE: 80" - the whole reply, including the
        # confidence line - for this arm only.
        answer = ""
        for r in replies:
            a = _elic.parse_answer(r)
            if a:
                answer = a
                break
        return conf, answer
    conf = None
    answer = ""
    for r in replies:
        c = _elic.parse_confidence(r)
        if c is not None and conf is None:
            conf = c / 100.0 if c > 1.0 else c
        a = _elic.parse_answer(r)
        if a and not answer:
            answer = a
    return conf, answer


def run(args) -> int:
    # THE SPEND CHECK COMES FIRST - before the release is read and before any endpoint is
    # touched. The first version put it in the `else` of the dry-run branch, BELOW `load()`, and
    # that is the defect `sweep.py` documents in its own comment: a paid run then does work before
    # being refused, and **a data error masks the spend refusal entirely**. Measured: a paid run
    # against a malformed release printed "item has no file_id" and exited 1, never mentioning
    # spend. The user learns the wrong thing about why their run stopped.
    if not args.dry_run:
        refuse_without_spend(args, "--spend", "the elicitation arms")

    items, manifest = load(args.release)
    if args.limit:
        items = items[: args.limit]
    arms = [a.strip() for a in args.arms.split(",") if a.strip()]
    for a in arms:
        if a not in ARMS:
            print("unknown arm " + a + "; known: " + ", ".join(ARMS), file=sys.stderr)
            return 2

    if args.dry_run:
        stub = json.loads(pathlib.Path(args.stub_file).read_text(encoding="utf-8-sig")) \
            if args.stub_file else {}
        backend = StubBackend(stub)
        print("DRY RUN: offline stub, no network, no spend.")
    else:
        backend = from_env(args.backend, args.model)[0]
        if getattr(backend, "is_paid", False):
            print("PAID BACKEND: " + backend.name + ". This is the intended spend.")

    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    run_id = args.run_id or (args.model.replace("/", "_") + "-elic")
    recipe = Recipe(model=args.model, prompt_id="open_v1", temperature=args.temperature)

    n_rows = 0
    t0 = time.time()
    with out.open("a", encoding="utf-8") as fh:
        for arm in arms:
            k = args.k if arm == "A2_self_consistency" else 1
            got = 0
            for it in items:
                replies = []
                for _ in range(k):
                    p = prompts_for(arm, it["question"])[0]
                    try:
                        # THE BACKEND'S SIGNATURE IS ask(item, image_bytes, prompt). The first
                        # version called ask(prompt, temperature=...), which matches NO backend in
                        # this repo — it happened to "work" against the stub only because the stub
                        # tolerates it, and would have failed on the first paid call.
                        #
                        # image_bytes IS EMPTY ON PURPOSE. These arms are text-only by design:
                        # the confidence must not come from looking at the image, and sending it
                        # would confound the measurement with perception.
                        replies.append(backend.ask(it, b"", p))
                    except Exception as e:  # a failed call is a datum, not a crash
                        replies.append("")
                        row_err = type(e).__name__ + ": " + str(e)
                    else:
                        row_err = ""
                conf, answer = confidence_for(arm, replies)
                if conf is not None:
                    got += 1
                fh.write(json.dumps({
                    "run_id": run_id + "-" + arm.lower(),
                    "arm": arm,
                    "question_id": it.get("id"),
                    "model": args.model,
                    "prompt_id": "open_v1",
                    "recipe_hash": recipe.recipe_hash(),
                    "confidence": conf,
                    "answer": answer,
                    "n_samples": k,
                    "parse_ok": 0 if conf is None else 1,
                    "graded": 0,
                    "verdict": "",
                    "error": row_err,
                    "groundtruth_hash": manifest.get("groundtruth_hash", ""),
                }, sort_keys=True) + "\n")
                n_rows += 1
            print("  %-20s items %4d  with a confidence %4d  (k=%d)"
                  % (arm, len(items), got, k))
    if hasattr(backend, "close"):
        backend.close()
    print("wrote %d row(s) to %s in %.1fs" % (n_rows, out, time.time() - t0))
    print("NOTE: confidence is elicited, not returned by the API. A row with confidence=null")
    print("      is EXCLUDED from calibration, never imputed - see analyze.calibration.")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Run the three confidence-elicitation arms.")
    ap.add_argument("--release", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--arms", default=",".join(ARMS))
    ap.add_argument("--k", type=int, default=5, help="samples for A2; 1 is not self-consistency")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--temperature", type=float, default=0.7,
                    help="A2 needs T>0 or every sample agrees and the distribution is degenerate")
    ap.add_argument("--backend", default="closed", choices=["open", "closed"])
    ap.add_argument("--run-id", default=None)
    ap.add_argument("--dry-run", action="store_true", help="offline stub, spends nothing")
    ap.add_argument("--stub-file", default="")
    ap.add_argument("--spend", action="store_true", help=SPEND_HELP)
    args = ap.parse_args(argv)
    if args.k < 2 and "A2_self_consistency" in args.arms:
        print("refusing: A2 with k<2 is not self-consistency - every sample would agree, so the",
              file=sys.stderr)
        print("distribution would be degenerate and the arm would measure nothing.", file=sys.stderr)
        return 2
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())