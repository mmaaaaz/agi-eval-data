#!/usr/bin/env python
"""Split a batch's image list into shards for parallel lanes.

    python -m scripts.harness.shard_images --batch full-50k --lanes 2

A "lane" is one process driving its own endpoint (own key, own request budget).
Sharding keeps the lanes from drafting the same photograph twice: images that
already have a parsed row in the batch are skipped, the rest are dealt
round-robin, and the shard files live beside the batch as shard-<n>.jsonl.

Rows already parsed in any of --also batches count as done too, so a second lane
started later never re-pays for images the first lane finished.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUNS = ROOT / "runs" / "generation"


def parsed_ids(candidates: Path) -> set[str]:
    done: set[str] = set()
    if candidates.exists():
        for line in candidates.read_text(encoding="utf-8").splitlines():
            if line.strip():
                r = json.loads(line)
                if r.get("parse_ok"):
                    done.add(r["file_id"])
    return done


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch", required=True)
    ap.add_argument("--lanes", type=int, default=2)
    ap.add_argument("--also", default="", help="comma-separated extra batches whose parsed rows count as done")
    args = ap.parse_args()

    batch_dir = RUNS / args.batch
    images = batch_dir / "images.jsonl"
    todo = [json.loads(l) for l in images.read_text(encoding="utf-8").splitlines() if l.strip()]
    done = parsed_ids(batch_dir / "candidates.jsonl")
    for extra in [b.strip() for b in args.also.split(",") if b.strip()]:
        done |= parsed_ids(RUNS / extra / "candidates.jsonl")
    remaining = [r for r in todo if r["file_id"] not in done]

    lanes = max(1, args.lanes)
    shards: list[list[dict]] = [[] for _ in range(lanes)]
    for i, row in enumerate(remaining):
        shards[i % lanes].append(row)

    for n, shard in enumerate(shards, 1):
        path = batch_dir / f"shard-{n}.jsonl"
        path.write_text("".join(json.dumps(r) + "\n" for r in shard), encoding="utf-8")
        print(f"shard-{n}: {len(shard)} images -> {path}")
    print(f"total {len(remaining)} remaining of {len(todo)} ({len(done)} already parsed)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
