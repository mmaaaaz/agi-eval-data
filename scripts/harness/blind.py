#!/usr/bin/env python3
"""
THE BLIND FILTER — is this question answerable WITHOUT the image?

WHY THIS IS THE CHEAPEST THREAT TO A VISION BENCHMARK
-----------------------------------------------------
A benchmark can be beaten without looking. Question templates leak their answers
through option shapes, world priors, and the distribution of the answer key.
arXiv:2511.04655 ("Benchmark Designers Should Train on the Test Set") shows exactly
this: a text-only model improves by 13-18 points on template-based vision
benchmarks it never saw an image for.

So every item is asked of a text-only model, with the image withheld and the model
TOLD it is withheld. Anything answered correctly is not vision-dependent and must be
rewritten or dropped.

This also closes a real gap: the gate has had a C4 blind-solvability check since it
was written, and NOTHING PRODUCED ITS INPUT. The check could never fire.

Usage:
    # free, offline, proves the pipeline
    python -m scripts.harness.blind --release release/v1 --model stub \\
        --dry-run --stub-file fixture.json --out data/factory/blind_answers.jsonl

    # against a real text-only model on your own GPU
    python -m scripts.harness.blind --release release/v1 --model Qwen/Qwen3.8-27B

Then:  python scripts/factory/03_verify.py --blind data/factory/blind_answers.jsonl
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request

from .spend import SPEND_HELP, refuse_without_spend
from .backends import OpenAICompatBackend, StubBackend
from .ingest import summarise
from .recipe import Recipe
from .run import run_release

DEFAULT_OUT = pathlib.Path("data/factory/blind_answers.jsonl")


def no_image(item: dict) -> bytes:
    """The whole point: the model is asked without any image bytes at all."""
    return b""


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Ask every item of a text-only model, with no image.")
    ap.add_argument("--release", required=True)
    ap.add_argument("--model", required=True, help="a TEXT model; no vision is used or needed")
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--base-url", default=None, help="OpenAI-compatible endpoint, e.g. a local vLLM server")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--run-id", default=None)
    ap.add_argument("--dry-run", action="store_true", help="offline stub: spends nothing, proves the pipeline")
    ap.add_argument("--spend", action="store_true", help=SPEND_HELP)
    ap.add_argument("--stub-file", default="", help="JSON map of question id -> answer, for --dry-run")
    ap.add_argument("--push", action="store_true",
                    help="post the per-item result to the relay so authors can see it (needs RELAY_URL + HARNESS_CODE)")
    ap.add_argument("--relay", default=os.environ.get("RELAY_URL", ""))
    ap.add_argument("--code", default=os.environ.get("HARNESS_CODE", ""))
    args = ap.parse_args(argv)

    recipe = Recipe(model=args.model, prompt_id="blind_v1", temperature=0.0)

    if args.dry_run:
        answers = json.loads(pathlib.Path(args.stub_file).read_text(encoding="utf-8-sig")) if args.stub_file else {}
        backend = StubBackend(answers)
        print("DRY RUN: offline stub, no image, no network, no spend.")
    else:
        refuse_without_spend(args, "--spend", 'the blind filter')
        if not args.base_url:
            print("refusing to guess an endpoint: pass --base-url (a vLLM server, or a vendor URL).", file=sys.stderr)
            return 2
        backend = OpenAICompatBackend(
            model=args.model,
            base_url=args.base_url,
            api_key=os.environ.get("OPENAI_API_KEY", ""),
            include_image=False,
        )
        print("TEXT-ONLY: the image is withheld and the model is told so.")

    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    result = run_release(
        release_dir=args.release,
        recipe=recipe,
        ask=backend.ask,
        trace_path=out,
        fetch_image=no_image,
        run_id=args.run_id,
        limit=args.limit,
    )
    dt = time.time() - t0

    rows = [json.loads(l) for l in out.read_text(encoding="utf-8-sig").splitlines() if l.strip()]
    s = summarise(rows) if rows else {}
    leaked = [r for r in rows if r.get("correct") == 1]
    rate = (len(leaked) / len(rows)) if rows else 0.0

    print()
    print("run_id       : " + str(result["run_id"]))
    print("items        : " + str(result["n_new"]) + " new, " + str(result["n_already_done"]) + " already done")
    print("wall clock   : " + str(round(dt, 1)) + "s")
    print("BLIND-SOLVABLE: " + format(rate, ".1%") + "  (" + str(len(leaked)) + "/" + str(len(rows)) + ")")
    if s:
        print("abstention   : " + format(s.get("abstention_rate", 0.0), ".1%") + "  (a model that says UNKNOWN is behaving)")
    print()
    print("gate rule: <= 5%. every leaked item above must be rewritten or dropped —")
    print("it is answerable from the words alone, so it measures priors, not vision.")
    print("wrote " + str(out))

    if args.push:
        if not args.relay or not args.code:
            print()
            print("refusing to push: set --relay and --code, or RELAY_URL and HARNESS_CODE.", file=sys.stderr)
            print("the blind result is a measurement, so the harness door fails closed.", file=sys.stderr)
            return 2
        payload = {"results": [{"question_id": r.get("question_id"), "correct": r.get("correct")} for r in rows]}
        req = urllib.request.Request(
            args.relay.rstrip("/") + "/api/blind",
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers={"Content-Type": "application/json", "x-harness-code": args.code},
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                body = json.loads(resp.read().decode("utf-8") or "{}")
                print()
                print("pushed to authors: " + str(body.get("n")) + " items, "
                      + str(body.get("blind_passed")) + " flagged as answerable without the image")
        except urllib.error.HTTPError as e:
            print()
            print("push failed: HTTP " + str(e.code) + " " + e.read().decode("utf-8", "replace")[:180], file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
