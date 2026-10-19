#!/usr/bin/env python
"""Merge lane batches into one candidates file, last parsed row per image wins.

    python -m scripts.harness.merge_batches --out-batch full-50k \
        --batches full-50k,full-50k-lane2,full-50k-lane3

Writes runs/generation/<out-batch>/merged.jsonl and prints per-lane counts and
how many images remain unparsed. It never touches a live lane's own
candidates.jsonl — merging is a read of the lanes and a write of one new file.

Provenance: every row keeps the model, endpoint label, prompt_version and run
id it was drafted under, so a merged file can always be traced back to the lane
that produced a given image.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUNS = ROOT / "runs" / "generation"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-batch", required=True)
    ap.add_argument("--batches", required=True)
    args = ap.parse_args()

    order: list[str] = []
    best: dict[str, dict] = {}
    lanes = Counter()
    rows_total = 0
    for name in [b.strip() for b in args.batches.split(",") if b.strip()]:
        path = RUNS / name / "candidates.jsonl"
        if not path.exists():
            print(f"missing lane: {path}")
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            r = json.loads(line)
            rows_total += 1
            fid = r["file_id"]
            if fid not in best:
                order.append(fid)
            prev = best.get(fid)
            if r.get("parse_ok") or (prev is not None and not prev.get("parse_ok")):
                best[fid] = r
                lanes[r.get("endpoint") or name] += 1

    out = RUNS / args.out_batch / "merged.jsonl"
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as f:
        for fid in order:
            f.write(json.dumps(best[fid]) + "\n")

    parsed = sum(1 for r in best.values() if r.get("parse_ok"))
    print(f"rows read: {rows_total} | images: {len(best)} | parsed: {parsed} | unparsed: {len(best) - parsed}")
    print("rows kept per lane:", dict(lanes))
    print(f"merged -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
