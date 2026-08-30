#!/usr/bin/env python3
"""Validate data/grip/ artifacts against the source suite.

Checks (fail-fast, exit 1 on any failure):
  1. tree.json exists, has 34 categories, correct global counts
  2. every category detail file parses; every record has exactly 5 questions
     with difficulty levels 1..5 in order
  3. per-level totals are exactly 100,000 (main subsuites only)
  4. every record's image path resolves on disk (source suite = read-only check)
  5. overrides: every override file parses and its `from` assertions match the
     CURRENT baked record values (stale from-value = override conflict)

Exit 0 prints "GRIP validation: PASS".
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from grip_common import DATASET_DIR, LEVEL_NAMES, OVERRIDES_DIR, OUT_DIR

FAILURES: list[str] = []


def check(cond: bool, msg: str) -> None:
    if not cond:
        FAILURES.append(msg)


def load_detail(slug: str) -> dict | None:
    p = OUT_DIR / f"{slug}.json"
    if not p.exists():
        check(False, f"missing detail {p}")
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def current_value(rec: dict, field: str):
    """Resolve a patch field ('q:<qid>.<prop>' or 'scene.<key>') to its live value."""
    if field.startswith("q:"):
        qid, prop = field[2:].split(".", 1)
        q = next((q for q in rec["q"] if q["question_id"] == qid), None)
        if q is None:
            return None
        return q.get(prop)
    return rec.get("scene", {}).get(field[len("scene."):])


def check_overrides(details: dict[str, dict]) -> int:
    """Validate data/grip-overrides/**. Returns count of files checked.

    Two levels:
      well-formedness — version/changes/field grammar (checked even without details)
      from-assertions  — `from` must equal the CURRENT value in the baked record
    """
    if not OVERRIDES_DIR.exists():
        return 0
    n = 0
    for ov_path in sorted(OVERRIDES_DIR.rglob("*.json")):
        n += 1
        try:
            ov = json.loads(ov_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            check(False, f"{ov_path.name}: invalid JSON ({e})")
            continue
        check(isinstance(ov.get("changes"), list) and ov["changes"],
              f"{ov_path.name}: missing/empty changes[]")
        check(bool(ov.get("reason")), f"{ov_path.name}: missing reason")
        slug = ov_path.parent.name
        sid = ov_path.stem
        detail = details.get(slug)
        if detail is None:
            continue  # well-formedness only; scan will fail on unknown targets anyway
        rec = next((r for r in detail["records"] if r["id"] == sid), None)
        if rec is None:
            check(False, f"{ov_path.name}: sample {sid} not found in {slug}")
            continue
        for ch in ov["changes"]:
            field = ch.get("field", "")
            check(bool(field) and "to" in ch, f"{ov_path.name}: bad change {ch}")
            if "from" in ch and field:
                cur = current_value(rec, field)
                if cur is None:
                    check(False, f"{ov_path.name}: unknown field {field}")
                elif str(cur) != str(ch["from"]):
                    check(False,
                          f"OVERRIDE CONFLICT {ov_path.name} {field}: "
                          f"from={ch['from']!r} but current={cur!r} — re-assert or drop the change")
    return n


def main() -> int:
    tree_p = OUT_DIR / "tree.json"
    check(tree_p.exists(), f"missing {tree_p} — run scripts/grip_scan.py first")
    if FAILURES:
        print("\n".join(FAILURES))
        print("GRIP validation: FAIL")
        return 1

    tree = json.loads(tree_p.read_text(encoding="utf-8"))
    check(len(tree["categories"]) == 34,
          f"expected 34 categories, got {len(tree['categories'])}")
    counts = tree["counts"]
    check(counts["imagesMain"] == 100_000, f"main images {counts.get('imagesMain')} != 100000")
    check(counts["questionsMain"] == 500_000, f"main questions {counts.get('questionsMain')} != 500000")
    levels = counts.get("levels", {})
    for lv in (1, 2, 3, 4, 5):
        check(levels.get(str(lv)) == 100_000,
              f"level {lv}: {levels.get(str(lv))} != 100000")
    check(tree.get("levelNames") == {str(k): v for k, v in LEVEL_NAMES.items()},
          "levelNames mismatch")

    details: dict[str, dict] = {}
    levels_seen: Counter[int] = Counter()
    for cat in tree["categories"]:
        slug = cat["slug"]
        detail = load_detail(slug)
        if detail is None:
            continue
        details[slug] = detail
        recs = detail["records"]
        check(len(recs) == cat["images"],
              f"{slug}: detail records {len(recs)} != tree {cat['images']}")
        n_q = 0
        for rec in recs:
            qs = rec["q"]
            n_q += len(qs)
            if rec.get("sub") == "main":
                # canonical suite: exactly 5, levels 1..5
                if len(qs) != 5:
                    check(False, f"{slug}/{rec['id']}: {len(qs)} questions (expected 5)")
                    continue
                check([q["difficulty_level"] for q in qs] == [1, 2, 3, 4, 5],
                      f"{slug}/{rec['id']}: levels not 1..5")
                for q in qs:
                    levels_seen[q["difficulty_level"]] += 1
            else:
                # subsuite snapshots: levels ascending from 1 (most are legacy
                # pre-retrofit 1..4; a few are already 1..5)
                check([q["difficulty_level"] for q in qs] == list(range(1, len(qs) + 1)),
                      f"{slug}/{rec['sub']}/{rec['id']}: levels not ascending from 1")
            img = DATASET_DIR / rec["img"]
            check(img.exists(), f"{slug}/{rec['id']}: image missing {rec['img']}")
        check(n_q == cat["questions"],
              f"{slug}: detail questions {n_q} != tree {cat['questions']}")

    check_overrides(details)

    if FAILURES:
        print("\n".join(FAILURES))
        print("GRIP validation: FAIL")
        return 1
    print(f"GRIP validation: PASS — 34 categories, {counts['imagesMain']} main images, "
          f"{counts['questionsMain']} main questions, levels {dict(sorted(levels_seen.items()))}, "
          f"{counts.get('legacyImages', 0)} legacy images")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
