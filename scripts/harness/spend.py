#!/usr/bin/env python3
"""
ONE PLACE THAT DECIDES WHETHER MONEY MAY BE SPENT.

THE RULE, from the owner: **inference on images is the ONLY permitted spend.** Nothing else —
not storage, not requests, not a queue, not a build.

WHY THIS MODULE EXISTS
----------------------
`--spend` was implemented in `run_pipeline.py` and **nowhere else**. So the pipeline refused a
paid stage without it, and every runner did not: measured in round 79,

    python -m scripts.harness.run_crop --release rel --model paid/model \
        --base-url http://... --out runs/x.jsonl

ran the **entire six-condition ladder against a paid endpoint with no --spend flag at all.**

**The pipeline guarded the pipeline, not the tools.** A guard on one of two paths to the same
spend is not a guard; it is a habit that happens to hold while everyone uses the front door.

WHAT COUNTS AS SPEND
--------------------
Anything that reaches a paid endpoint. The OFFLINE stub does not, so it is always allowed — a
dry run exists precisely so the whole path can be exercised for nothing. This module refuses only
what would actually cost, which is what makes the flag meaningful rather than ceremonial.

USAGE
-----
    ap.add_argument("--spend", action="store_true", help=SPEND_HELP)
    ...
    refuse_without_spend(args, "--spend", "the crop ladder")
"""
from __future__ import annotations

import sys

SPEND_HELP = ("confirm this run may spend money. Inference on images is the ONLY permitted "
              "spend; without this flag a paid run is refused.")


def spend_permitted(args) -> bool:
    return bool(getattr(args, "spend", False))


def refuse_without_spend(args, flag: str, what: str) -> None:
    """Exit 2 unless --spend was given, or the run is offline.

    A --dry-run is ALWAYS allowed: it uses the stub backend, touches no network, and costs
    nothing. Refusing it would push people away from the one path that is free to test.
    """
    if getattr(args, "dry_run", False):
        return
    if spend_permitted(args):
        return
    print("REFUSING TO SPEND. " + what + " calls a model, and inference on images is the ONLY", file=sys.stderr)
    print("  permitted spend. Re-run with " + flag + " if you mean it.", file=sys.stderr)
    print("", file=sys.stderr)
    print("  Nothing was sent and nothing was charged. Use --dry-run to exercise the full", file=sys.stderr)
    print("  path against the offline stub for nothing.", file=sys.stderr)
    raise SystemExit(2)
