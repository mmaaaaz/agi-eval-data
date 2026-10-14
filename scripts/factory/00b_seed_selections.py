#!/usr/bin/env python3
"""
SEED THE SHORTLIST — push the stratified proposer's output into the selection store.

WHY
---
`01_select_images.py` already picks a balanced, seeded pool across resolution bands,
contributors and cameras. Without seeding, triage opens on 56,000 unranked images and
every session drifts to the common band. With seeding, people confirm or override a
shortlist instead of facing the corpus.

THE INVARIANT THIS RELIES ON
----------------------------
A machine proposal must never overwrite a human decision. That is enforced in the
database statement itself (`WHERE selections.state = 'proposed'`), not here, so
re-running this script cannot undo a morning of triage. A skipped row comes back with
`applied: false` and is counted, not treated as an error.

Usage:
    python scripts/factory/00b_seed_selections.py --dry-run
    RELAY_URL=https://... python scripts/factory/00b_seed_selections.py --limit 300
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CANDIDATES = ROOT / "data" / "factory" / "candidates.json"


def post(relay: str, payload: dict, actor: str, actor_name: str, timeout: int = 30) -> tuple[int, dict]:
    req = urllib.request.Request(
        relay.rstrip("/") + "/api/selections",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "x-actor": actor,
            "x-actor-name": actor_name,
            # A USER-AGENT, BECAUSE CLOUDFLARE BLOCKS PYTHON'S DEFAULT WITH A 403.
            #
            # Found in round 144 by seeding for real: **every one of 600 requests returned
            # 403**, while the same payload sent by hand returned 200. The difference was the
            # client, and the client's only distinguishing feature is its User-Agent:
            #
            #     urllib default (Python-urllib/3.x)  ->  403
            #     agi-eval-data/1.0                    ->  200
            #
            # **A script that cannot talk to its own API is indistinguishable from an API that
            # refuses it**, and the failure said nothing about why. Named so the next person does
            # not spend the same time on it.
            "User-Agent": "agi-eval-data-seeder/1.0 (+https://github.com/mmaaaaz/agi-eval-data)",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8") or "{}")
        except Exception:
            return e.code, {}


def main() -> int:
    ap = argparse.ArgumentParser(description="Seed selection proposals from the stratified proposer.")
    ap.add_argument("--candidates", default=str(CANDIDATES))
    ap.add_argument("--relay", default=os.environ.get("RELAY_URL", ""))
    ap.add_argument("--actor", default="seeder")
    ap.add_argument("--actor-name", default="shortlist proposer")
    ap.add_argument("--limit", type=int, default=0, help="0 = all")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--pause", type=float, default=0.05, help="seconds between writes")
    args = ap.parse_args()

    src = Path(args.candidates)
    if not src.exists():
        print("no candidates file: " + str(src), file=sys.stderr)
        print("run first:  python scripts/factory/01_select_images.py --target 3000", file=sys.stderr)
        return 2

    doc = json.loads(src.read_text(encoding="utf-8-sig"))
    images = doc.get("images", [])
    if not images:
        print("candidates file has no images", file=sys.stderr)
        return 2

    chosen = images[: args.limit] if args.limit else images
    print("proposer seed   : " + str(doc.get("seed")))
    print("proposed target : " + str(doc.get("target")))
    print("images to seed  : " + str(len(chosen)) + " of " + str(len(images)))
    bands: dict[str, int] = {}
    for p in chosen:
        bands[p.get("band", "?")] = bands.get(p.get("band", "?"), 0) + 1
    print("by band         : " + json.dumps(dict(sorted(bands.items()))))

    payloads = [
        {"file_id": str(p["file_id"]), "state": "proposed", "stratum": str(p.get("band", ""))}
        for p in chosen
        if p.get("file_id")
    ]

    if args.dry_run:
        print()
        print("DRY RUN — nothing sent. First payload:")
        print("  " + json.dumps(payloads[0], sort_keys=True))
        print("  ... and " + str(len(payloads) - 1) + " more")
        print()
        print("the open door is used deliberately: proposing is meant to be crowd-sourced.")
        print("the guard that matters lives in the database, so a re-run cannot clobber a human.")
        return 0

    if not args.relay:
        print()
        print("refusing to send: set --relay or RELAY_URL.", file=sys.stderr)
        return 2

    sent = skipped = failed = 0
    for i, payload in enumerate(payloads, 1):
        status, body = post(args.relay, payload, args.actor, args.actor_name)
        if status == 429:
            # the open door rate-limits writes per actor; back off rather than fail
            time.sleep(2.0)
            status, body = post(args.relay, payload, args.actor, args.actor_name)
        if status == 200:
            if body.get("applied") is False:
                skipped += 1
            else:
                sent += 1
        else:
            failed += 1
            if failed <= 3:
                print("  failed " + payload["file_id"] + ": HTTP " + str(status) + " " + str(body)[:120], file=sys.stderr)
        if args.pause:
            time.sleep(args.pause)
        if i % 250 == 0:
            print("  " + str(i) + "/" + str(len(payloads)) + "  sent=" + str(sent) + " skipped=" + str(skipped) + " failed=" + str(failed))

    print()
    print("seeded  : " + str(sent))
    print("skipped : " + str(skipped) + "  (already a human decision, or already proposed)")
    print("failed  : " + str(failed))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
