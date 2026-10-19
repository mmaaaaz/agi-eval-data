#!/usr/bin/env python
"""Publish the decisions made in the review room as static JSON.

    python -m scripts.harness.sync_vqa_decisions --relay https://<relay> --code <reviewer code>

WHY
---
The review room's read path is static on purpose: D1's free tier bills rows read,
so a visitor must never trigger a query. Decisions still land in D1 the moment a
reviewer clicks (that is the write path, and it is small), but what OTHER visitors
read is the snapshot this tool writes: apps/web/public/vqa/decisions.json.

Run it after a review session, then rebuild and redeploy Pages. Until then a
decision is visible only to the reviewer who made it, which is the honest trade
for a read path that is free at any traffic.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "apps" / "web" / "public" / "vqa" / "decisions.json"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--relay", required=True)
    ap.add_argument("--code", required=True)
    args = ap.parse_args()

    req = urllib.request.Request(
        args.relay.rstrip("/") + "/api/vqa/decisions",
        headers={"User-Agent": UA, "x-questions-code": args.code, "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        body = json.load(r)
    decisions = body.get("decisions", [])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(decisions, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {len(decisions)} decisions -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
