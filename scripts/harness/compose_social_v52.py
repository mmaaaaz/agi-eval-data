#!/usr/bin/env python
"""Join new v5.2 social probes onto the existing ten-item rows.

    python -m scripts.harness.compose_social_v52 --base taxonomy-v5-ten \
        --social social-pilot --out social-pilot-pre

The old bias/sensitivity items are dropped; the new 2-4 are pinned; the remaining
slots are filled from the old non-social items (hard first, one per category). A row
may come out short if the old social bundle was larger than the new one; the normal
fill_to_ten.py pass tops it back up with --exclude-categories bias,sensitivity.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

from scripts.harness.generate_vqa import ROOT
from scripts.harness.taxonomy_v5 import CATEGORIES, PERC_ITEMS, TOTAL_ITEMS


def load_latest(batch: str) -> dict[str, dict]:
    src = ROOT / "runs" / "generation" / batch / "candidates.jsonl"
    out: dict[str, dict] = {}
    for line in src.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        if r.get("file_id"):
            out[r["file_id"]] = r
    return out


def choose_non_social(row: dict, slots: int) -> list[dict]:
    """Keep the two control items, one hard per applicable category, then hard/medium."""
    items = [i for i in (row.get("items") or []) if i.get("category") not in ("bias", "sensitivity")]
    app = row.get("applicability") or {}
    perc = [i for i in items if i.get("category") == "perc"][:PERC_ITEMS]
    rest = [i for i in items if i.get("category") != "perc"]
    chosen: list[dict] = list(perc)
    used: set[int] = set()

    def take(cat: str) -> None:
        pool = [(n, i) for n, i in enumerate(rest) if i.get("category") == cat and n not in used]
        pool.sort(key=lambda t: 0 if t[1].get("difficulty") == "hard" else 1)
        if pool:
            n, i = pool[0]
            used.add(n)
            chosen.append(i)

    for cat in ("physics", "geometry", "combination"):
        if len(chosen) < slots and app.get(cat, {}).get("applicable"):
            take(cat)
    pool = [(n, i) for n, i in enumerate(rest) if n not in used]
    pool.sort(key=lambda t: (0 if t[1].get("difficulty") == "hard" else 1, t[1].get("category", "")))
    for n, i in pool:
        if len(chosen) >= slots:
            break
        used.add(n)
        chosen.append(i)
    return chosen[:slots]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="taxonomy-v5-ten")
    ap.add_argument("--social", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    base = load_latest(args.base)
    social = load_latest(args.social)
    out_dir = ROOT / "runs" / "generation" / args.out
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "candidates.jsonl"

    rows = 0
    replaced = 0
    short = 0
    with out_path.open("w", encoding="utf-8") as f:
        for fid, row in base.items():
            if fid not in social:
                continue
            srow = social[fid]
            social_items = [i for i in (srow.get("social_items") or []) if i.get("category") in ("bias", "sensitivity")][:4]
            if not social_items:
                continue
            chosen = choose_non_social(row, TOTAL_ITEMS - len(social_items))
            items = chosen + social_items
            if len(items) > TOTAL_ITEMS:
                items = items[:TOTAL_ITEMS]
            rec = {
                "file_id": fid,
                "name": row.get("name", ""),
                "taxonomy_version": "v5.2",
                "applicability": row.get("applicability") or {},
                "items": items,
                "prompt_version": "compose-social-v5.2-v1",
                "parse_ok": True,
                "social_notes": srow.get("social_notes", ""),
            }
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            rows += 1
            replaced += 1
            if len(items) != TOTAL_ITEMS:
                short += 1

    manifest = {
        "batch": args.out, "base": args.base, "social": args.social,
        "images": rows, "replaced": replaced, "short_rows": short,
        "items": None,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    print(json.dumps(manifest, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
