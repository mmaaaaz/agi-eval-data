#!/usr/bin/env python3
"""
THE CROPS-OUT-THE-EVIDENCE ATTACK, as a runnable sweep.

WHY THIS EXISTS
---------------
`06_break_the_model.py` designs this experiment and calls it "the strongest in the project",
and it **cannot run**: its `main()` handles only `--demo` (synthetic numbers) and `--plan`
(counts the calls). There is no way to point it at a release and get a curve. A design document
with a demo is not an experiment.

Rather than write a parallel runner, this is a THIN WRAPPER over the existing harness. A crop is
just `fetch_image` returning a smaller image, so `run_release` already does everything that
matters and this inherits all of it:

  - the release hash check, so a run against drifted labels is refused
  - the exact bytes hashed per row, so the run is auditable
  - resume on (run_id, question_id), so an interrupted sweep continues
  - a per-row error that becomes one failed row rather than a dead sweep
  - ingestion, so the site and the paper cannot disagree

THE LADDER IS THE RUN ID
------------------------
Each crop fraction is a separate `run_id`, which is what makes resume correct: the fraction is
part of the identity of a measurement, so a half-finished ladder continues where it stopped and
two fractions can never overwrite each other.

WHAT THE CURVE MEANS
--------------------
At a small enough crop the gold answer is **provably not in the image**, so the correct behaviour
is to decline. Accuracy that HOLDS while abstention does not rise means the model is answering
without seeing. That is the claim, and it is only supportable because the transform is applied
to the image with the question and the prompt byte-identical.

Usage:
    python -m scripts.harness.run_crop --release release/v1 --model stub \
        --out runs/crop.jsonl --dry-run
    python -m scripts.harness.run_crop --release release/v1 --model Qwen/Qwen3.8-27B \
        --base-url http://localhost:8000/v1 --out runs/crop.jsonl
"""
from __future__ import annotations

import argparse
import io
import json
import os
import pathlib
import sys
import time

from .spend import SPEND_HELP, refuse_without_spend
from .backends import StubBackend, from_env
from .fetch import make_fetcher, make_stub_fetcher
from .recipe import Recipe
from .run import run_release

# The ladder. 1.0 is the uncropped control, so every curve has its own baseline in the same
# trace and no run has to be trusted for a number it did not measure.
LADDER = (1.0, 0.75, 0.5, 0.35, 0.25, 0.15)


def cropper(base_fetch, frac: float):
    """Wrap a fetcher so it returns the image cropped to `frac` of each dimension.

    The crop is CENTRED, which keeps the referent in frame at mild fractions — a corner crop
    would remove the subject immediately and the ladder would measure nothing but the corner.
    Returns the original bytes unchanged at 1.0, so the control is byte-identical to a normal
    sweep and can be compared against one.
    """
    if frac >= 1.0:
        return base_fetch

    def fetch(item: dict) -> bytes:
        data = base_fetch(item)
        if not data:
            return data
        try:
            from PIL import Image
            with Image.open(io.BytesIO(data)) as im:
                w, h = im.size
                nw, nh = max(1, int(w * frac)), max(1, int(h * frac))
                left, top = (w - nw) // 2, (h - nh) // 2
                out = io.BytesIO()
                im.crop((left, top, left + nw, top + nh)).save(out, format="JPEG", quality=90)
                return out.getvalue()
        except Exception as e:
            # One uncroppable image must not kill a sweep, exactly as one unfetchable image
            # does not. It becomes a row with an error, which the analysis excludes.
            raise RuntimeError("crop failed: " + type(e).__name__) from e

    return fetch


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Crops-out-the-evidence attack, over the harness.")
    ap.add_argument("--release", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--out", required=True, help="trace file; one row per (item, fraction)")
    ap.add_argument("--base-url", default=os.environ.get("VLLM_BASE_URL", ""))
    ap.add_argument("--ladder", default=",".join(str(x) for x in LADDER),
                    help="comma-separated crop fractions, 1.0 = the uncropped control")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--prompt-id", default="mcq_v1", choices=["mcq_v1", "open_v1", "yesno_v1"])
    ap.add_argument("--pixel-budget", type=int, default=2048)
    ap.add_argument("--temperature", type=float, default=0.0)
    ap.add_argument("--cache-dir", default=None)
    ap.add_argument("--run-id", default=None, help="prefix; the fraction is appended")
    ap.add_argument("--dry-run", action="store_true", help="offline stub, spends nothing")
    ap.add_argument("--spend", action="store_true", help=SPEND_HELP)
    ap.add_argument("--stub-file", default="")
    args = ap.parse_args(argv)

    try:
        ladder = [float(x) for x in args.ladder.split(",") if x.strip()]
    except ValueError:
        print("--ladder must be comma-separated numbers", file=sys.stderr)
        return 2
    if not ladder or max(ladder) > 1.0 or min(ladder) <= 0:
        print("--ladder fractions must be in (0, 1], and include 1.0 as the control", file=sys.stderr)
        return 2
    if 1.0 not in ladder:
        print("refusing: the ladder must include 1.0, or the curve has no uncropped baseline",
              file=sys.stderr)
        return 2

    recipe = Recipe(model=args.model, prompt_id=args.prompt_id, temperature=args.temperature,
                    pixel_budget=args.pixel_budget)

    if args.dry_run:
        answers = json.loads(pathlib.Path(args.stub_file).read_text(encoding="utf-8-sig")) if args.stub_file else {}
        backend = StubBackend(answers)
        base_fetch = make_stub_fetcher(pixel_budget=args.pixel_budget)
        print("DRY RUN: offline stub, no network, no spend.")
    else:
        refuse_without_spend(args, "--spend", 'the crop ladder')
        if not args.base_url:
            print("refusing to guess an endpoint: pass --base-url (or set VLLM_BASE_URL).",
                  file=sys.stderr)
            return 2
        backend = from_env("open", args.model)[0]
        if backend.is_paid:
            print("PAID BACKEND: " + backend.name + ". This is the intended spend.")
        base_fetch = make_fetcher(args.cache_dir or (args.release + "/images"),
                                  pixel_budget=args.pixel_budget)

    prefix = args.run_id or (args.model.replace("/", "_") + "-crop")
    t0 = time.time()
    per_frac: list[tuple[float, dict]] = []
    for frac in ladder:
        res = run_release(
            release_dir=args.release, recipe=recipe, ask=backend.ask, trace_path=args.out,
            fetch_image=cropper(base_fetch, frac),
            run_id=prefix + "-crop" + ("%03d" % round(frac * 100)),
            limit=args.limit,
        )
        per_frac.append((frac, res))
        print("  crop %4.2f  new %4d  already %4d" % (frac, res["n_new"], res["n_already_done"]))
    backend.close()

    rows = [json.loads(l) for l in pathlib.Path(args.out).read_text(encoding="utf-8-sig").splitlines() if l.strip()]
    by_run: dict[str, list[dict]] = {}
    for r in rows:
        by_run.setdefault(str(r.get("run_id")), []).append(r)

    print()
    print("THE CURVE  (accuracy should FALL and abstention should RISE as evidence leaves)")
    print("  %-8s %8s %10s %10s" % ("crop", "n", "accuracy", "abstained"))
    print("  " + "-" * 40)
    for frac in ladder:
        key = prefix + "-crop" + ("%03d" % round(frac * 100))
        rs = [r for r in by_run.get(key, []) if not r.get("error")]
        n = len(rs)
        acc = (sum(1 for r in rs if r.get("verdict") == "correct") / n) if n else 0.0
        ab = (sum(1 for r in rs if r.get("abstained") == 1) / n) if n else 0.0
        print("  %-8.2f %8d %9.3f %9.3f" % (frac, n, acc, ab))
    print()
    print("  A flat accuracy with a flat abstention at the smallest crop is the finding:")
    print("  the answer is provably not in the frame, and the model answered anyway.")
    print("  " + str(round(time.time() - t0, 1)) + "s total. wrote " + args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
