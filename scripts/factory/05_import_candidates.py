#!/usr/bin/env python3
"""
STAGE 05 — IMPORT GENERATED CANDIDATES INTO THE REVIEW QUEUE.

THE MISSING ARROW
-----------------
`02_generate_questions.py` writes candidates to `data/factory/generated.jsonl`, and until now
NOTHING carried them anywhere. A generator could produce ten thousand questions and no person
would ever see one: the benchmark's input stage and its review stage had no connection at all.

THE PAIR RULE, WHICH IS THE WHOLE POINT OF DOING THIS IN ONE SCRIPT
------------------------------------------------------------------
A bridge item is only meaningful next to its twin on the SAME object. If a network failure
lands the geometry probe and not the physics probe, that item contributes nothing to the
paper's 2x2 headline table while quietly inflating the count of "paired" items — a number the
paper reports. So a bridge group is posted as ONE UNIT: both roles, or neither.

Pair identity is derived, not invented: `pair_id = "pair_" + hash(image_id)`, so every bridge
probe on one image shares a pair deterministically and a re-run cannot split one.

IDEMPOTENCY
-----------
The API has UNIQUE(file_id, qnorm), so a re-run returns 409 for anything already imported.
That is counted as ALREADY THERE, not as a failure — a correct no-op must never look like an
error.

COST
----
Zero. This writes to our own API, spends nothing, and touches no model.

Usage:
    python scripts/factory/05_import_candidates.py --dry-run
    RELAY_URL=https://... python scripts/factory/05_import_candidates.py --code "$QUESTIONS_CODE"
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_IN = ROOT / "data" / "factory" / "generated.jsonl"


def pair_id_for(file_id: str) -> str:
    """Deterministic pair identity: every bridge probe on one image shares it."""
    return "pair_" + hashlib.sha256(("pair:" + file_id).encode("utf-8")).hexdigest()[:12]


def to_payload(c: dict) -> dict:
    """A candidate -> the exact shape POST /api/questions accepts."""
    choices = c.get("choices")
    return {
        "file_id": c.get("file_id") or c.get("image_id"),
        "contributor": c.get("generator") or "generator",
        "question": c["question"],
        "answer_type": c.get("answer_type") or "text",
        "answer": str(c.get("answer") or ""),
        "choices": json.dumps(choices) if isinstance(choices, list) and choices else "",
        "difficulty": c.get("difficulty") or "medium",
        "tags": ", ".join(c.get("tags") or []),
        "capability": (c.get("capability") or "").upper(),
        "level": (c.get("level") or "").upper(),
        "pair_id": pair_id_for(str(c.get("file_id") or c.get("image_id"))) if str(c.get("capability") or "").upper().startswith("B") else "",
        "pair_role": (c.get("pair_role") or "").lower(),
        "tolerance": c.get("tolerance"),
        "generator": c.get("generator") or "",
        "verifier": c.get("verifier") or "",
        "family": c.get("family") or "",
        "relevance": c.get("relevance") or "visual_true_premise",
        "unanswerable_reason": c.get("unanswerable_reason") or "",
    }


def trim_payload(p: dict) -> dict:
    """Drop empty optional fields so the request body stays honest about what was set."""
    drop = ("", None)
    return {k: v for k, v in p.items() if v not in drop}


def post(relay: str, code: str, payload: dict, timeout: int = 30) -> tuple[int, dict]:
    req = urllib.request.Request(
        relay.rstrip("/") + "/api/questions",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json", **({"x-questions-code": code} if code else {})},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8") or "{}")
        except Exception:
            return e.code, {}


def plan(cands: list[dict]) -> tuple[list[dict], list[dict], list[dict]]:
    """Split into (postable, held_pairs, unusable).

    A bridge group is postable only when it carries BOTH a geometry and a physics probe.
    """
    usable, unusable = [], []
    for c in cands:
        cap = str(c.get("capability") or "").upper()
        if not c.get("question") or not (c.get("file_id") or c.get("image_id")):
            unusable.append((c, "no question or no image"))
        elif cap not in ({f"G{i}" for i in range(1, 9)} | {f"P{i}" for i in range(1, 9)} | {f"B{i}" for i in range(1, 5)} | {"PERC"}):
            unusable.append((c, "capability missing or outside the closed set"))
        elif not str(c.get("level") or "").upper() in {f"L{i}" for i in range(1, 6)}:
            unusable.append((c, "level missing or outside the closed set"))
        else:
            usable.append(c)

    bridge = [c for c in usable if str(c["capability"]).upper().startswith("B")]
    other = [c for c in usable if not str(c["capability"]).upper().startswith("B")]

    groups: dict[str, list[dict]] = collections.defaultdict(list)
    for c in bridge:
        groups[str(c.get("file_id") or c.get("image_id"))].append(c)

    postable = list(other)
    held: list[dict] = []
    for fid, members in sorted(groups.items()):
        roles = {str(m.get("pair_role") or "").lower() for m in members}
        if {"geometry", "physics"} <= roles:
            postable.extend(members)
        else:
            held.extend(members)
    return postable, held, unusable


def main() -> int:
    ap = argparse.ArgumentParser(description="Import generated candidates into the review queue.")
    ap.add_argument("--in", dest="src", default=str(DEFAULT_IN))
    ap.add_argument("--relay", default=os.environ.get("RELAY_URL", ""))
    ap.add_argument("--code", default=os.environ.get("QUESTIONS_CODE", ""),
                    help="reviewer code. Without it every item lands as a DRAFT, which is the intended default.")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--pause", type=float, default=0.05)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    src = pathlib.Path(args.src)
    if not src.exists():
        print("no candidates file: " + str(src), file=sys.stderr)
        print("run first:  python scripts/factory/02_generate_questions.py --n 40", file=sys.stderr)
        return 2
    cands = [json.loads(l) for l in src.read_text(encoding="utf-8-sig").splitlines() if l.strip()]
    if not cands:
        print("candidates file is empty", file=sys.stderr)
        return 2

    postable, held, unusable = plan(cands)
    if args.limit:
        postable = postable[: args.limit]

    print("candidates      : " + str(len(cands)))
    print("postable        : " + str(len(postable)))
    print("held (pair half): " + str(len(held)) + "   <- a bridge item whose twin is missing")
    print("unusable        : " + str(len(unusable)))
    for c, why in unusable[:5]:
        print("    " + str(c.get("question", "?"))[:60] + "  (" + why + ")")
    if held:
        print()
        print("HELD, not posted. A geometry probe without its physics twin contributes nothing")
        print("to the 2x2 table while inflating the paired count, so it waits for its twin:")
        for c in held[:5]:
            print("    " + str(c.get("file_id"))[:14] + "  " + str(c.get("capability")) + "  "
                  + str(c.get("pair_role") or "(no role)") + "  " + str(c.get("question", ""))[:50])

    if args.dry_run:
        print()
        print("DRY RUN — nothing sent. First payload:")
        if postable:
            print("  " + json.dumps(trim_payload(to_payload(postable[0])), sort_keys=True)[:400])
        print()
        print("a candidate lands as a DRAFT unless the reviewer code is given. That is intended:")
        print("generator output is a proposal, and only a person approves ground truth.")
        return 0

    if not args.relay:
        print()
        print("refusing to send: set --relay or RELAY_URL.", file=sys.stderr)
        return 2

    sent = dupes = failed = 0
    for i, c in enumerate(postable, 1):
        status, body = post(args.relay, args.code, trim_payload(to_payload(c)))
        if status == 429:
            time.sleep(2.0)
            status, body = post(args.relay, args.code, trim_payload(to_payload(c)))
        if status == 200:
            sent += 1
        elif status == 409:
            # UNIQUE(file_id, qnorm): a re-run is meant to be a no-op, not an error.
            dupes += 1
        else:
            failed += 1
            if failed <= 3:
                print("  failed: HTTP " + str(status) + " " + str(body)[:140], file=sys.stderr)
        if args.pause:
            time.sleep(args.pause)
        if i % 200 == 0:
            print("  " + str(i) + "/" + str(len(postable)) + "  sent=" + str(sent) + " already=" + str(dupes) + " failed=" + str(failed))

    print()
    print("imported : " + str(sent))
    print("already  : " + str(dupes) + "  (identical question already on that image; a re-run is a no-op)")
    print("failed   : " + str(failed))
    print("held     : " + str(len(held)) + "   (waiting for a twin)")
    print()
    print("they are DRAFTS. Review them at /contribute/review, or set QUESTIONS_CODE to import")
    print("straight to approved if you are the reviewer.")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
