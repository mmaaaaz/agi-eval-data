"""Shared sweep CLI. run_open.py and run_closed.py are thin wrappers over this.

--dry-run uses the offline stub backend, so the whole path can be verified without
spending anything. Do that before every real sweep.
"""
from __future__ import annotations
import argparse
import json
import pathlib
import time

from .spend import SPEND_HELP, refuse_without_spend
from .backends import StubBackend, from_env
from .fetch import make_fetcher, make_stub_fetcher
from .ingest import summarise
from .recipe import Recipe
from .run import run_release


def main(kind: str, argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Sweep a model over a frozen release (" + kind + " backend).")
    ap.add_argument("--release", required=True, help="frozen release directory")
    ap.add_argument("--model", required=True, help="model id, e.g. Qwen/Qwen3.8-27B")
    ap.add_argument("--out", required=True, help="trace file to append to, e.g. runs/qwen38.jsonl")
    ap.add_argument("--limit", type=int, default=None, help="cap the number of items (closed models: use it)")
    ap.add_argument("--prompt-id", default="mcq_v1", choices=["mcq_v1", "open_v1", "yesno_v1"])
    ap.add_argument("--pixel-budget", type=int, default=2048,
                    help="long edge the CDN serves. 0 or less = the STORED ORIGINAL (=s0). "
                         "The CDN resizes, so this decides what the model actually sees: at "
                         "2048 an image the ledger calls 24 MP arrives as about 2.8 MP.")
    ap.add_argument("--temperature", type=float, default=0.0)
    ap.add_argument("--max-tokens", type=int, default=512)
    ap.add_argument("--repeats", type=int, default=1)
    ap.add_argument("--run-id", default=None)
    ap.add_argument("--cache-dir", default=None, help="image cache; defaults to <release>/images")
    ap.add_argument("--dry-run", action="store_true",
                    help="offline stub backend: exercises the full pipeline and spends nothing")
    ap.add_argument("--spend", action="store_true", help=SPEND_HELP)
    ap.add_argument("--stub-answers", default="", help="JSON map of question id -> answer (avoid: shell quoting is fragile)")
    ap.add_argument("--stub-file", default="", help="path to a JSON file of question id -> answer, for --dry-run")
    args = ap.parse_args(argv)

    # THE SPEND CHECK COMES FIRST, before the release is read and before any endpoint is
    # touched. run_open.py and run_closed.py are thin shims onto this function, so a guard
    # placed anywhere else would leave one of the two unguarded.
    refuse_without_spend(args, "--spend", "the model sweep")

    # THE SPEND CHECK COMES FIRST, before the release is read and before any endpoint is
    # touched. run_open.py and run_closed.py are thin shims onto this function, so a guard
    # placed anywhere else would leave one of the two unguarded.

    recipe = Recipe(
        model=args.model,
        prompt_id=args.prompt_id,
        temperature=args.temperature,
        max_tokens=args.max_tokens,
        pixel_budget=args.pixel_budget,
        repeats=args.repeats,
    )

    if args.dry_run:
        if args.stub_file:
            # utf-8-sig, because a stub file written from PowerShell carries a BOM and
            # json.loads rejects one. Every read of a file a PERSON could have created is
            # BOM-tolerant: utf-8-sig decodes a BOM-less file identically to utf-8, so it
            # costs nothing and removes a whole class of Windows-only failure.
            answers = json.loads(pathlib.Path(args.stub_file).read_text(encoding="utf-8-sig"))
        elif args.stub_answers:
            answers = json.loads(args.stub_answers)
        else:
            answers = {}
        backend = StubBackend(answers)
        print("DRY RUN: offline stub backend. This spends nothing.")
    else:
        backend, default_limit = from_env(kind, args.model)
        if args.limit is None and default_limit is not None:
            args.limit = default_limit
            print("no --limit given; using " + str(default_limit) + " for a " + kind + " sweep")
        elif args.limit is not None and default_limit is not None and args.limit > default_limit:
            # AN EXPLICIT LIMIT ABOVE THE PAID DEFAULT IS THE ACCIDENTAL-OVERSPEND CASE.
            #
            # The default is 3,000 for a closed model because per-image cost on a long-context
            # frontier model is what dominates the budget. An explicit --limit bypasses it, which
            # is right — but silently is not: someone who types --limit 50000 has probably not
            # worked out what that costs.
            #
            # A WARNING, not a refusal: it is their spend and their call, and --spend was already
            # required to get this far.
            print("WARNING: --limit " + str(args.limit) + " is ABOVE the " + str(default_limit)
                  + " default for a " + kind + " sweep.")
            print("         Every item is a paid call. Check the cost before running this.")
            print("         (the default exists because per-image cost on a long-context model is")
            print("          what dominates the budget — see costs.md)")
        if backend.is_paid:
            print("PAID BACKEND: " + backend.name + ". This is the intended spend.")

    if args.dry_run:
        # offline by construction: no Drive, no quota, no network
        fetcher = make_stub_fetcher(pixel_budget=args.pixel_budget)
    else:
        cache = args.cache_dir or (str(pathlib.Path(args.release) / "images"))
        fetcher = make_fetcher(cache, pixel_budget=args.pixel_budget)

    t0 = time.time()
    result = run_release(
        release_dir=args.release,
        recipe=recipe,
        ask=backend.ask,
        trace_path=args.out,
        fetch_image=fetcher,
        run_id=args.run_id,
        limit=args.limit,
    )
    dt = time.time() - t0

    rows_path = pathlib.Path(args.out)
    rows = [json.loads(l) for l in rows_path.read_text(encoding="utf-8-sig").splitlines() if l.strip()]
    s = summarise(rows)
    print()
    print("run_id        : " + str(result["run_id"]))
    print("model         : " + str(result["model"]))
    print("items new     : " + str(result["n_new"]) + "  (already done: " + str(result["n_already_done"]) + ")")
    print("groundtruth   : " + str(result["groundtruth_hash"])[:16] + "...")
    print("recipe hash   : " + str(result["recipe_hash"])[:16] + "...")
    print("wall clock    : " + str(round(dt, 1)) + "s")
    if s:
        print("accuracy all  : " + format(s["accuracy"], ".3f") + "  (n=" + str(s["n"]) + ")")
        print("abstention    : " + format(s["abstention_rate"], ".3f"))
        print("parse fail    : " + format(s["parse_fail_rate"], ".3f"))
        print("errors        : " + format(s["error_rate"], ".3f"))
    backend.close()
    return 0


if __name__ == "__main__":
    raise SystemExit("use run_open.py or run_closed.py")
