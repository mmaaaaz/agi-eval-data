#!/usr/bin/env python3
"""Enumerate the GRIP suite tree and bake website artifacts into data/grip/.

Read-only over Geomatric-Reasoning-Benchmark-Dataset-main/. Writes only:
  data/grip/tree.json        — the always-loaded index (counts, per-category meta)
  data/grip/{slug}.json      — per-category full records (scene + 5 questions each)
Applies override patches from data/grip-overrides/** with from-assertions
(mismatch = hard fail: the override is stale against the current suite).
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from grip_common import (
    CATEGORIES, DATASET_DIR, LEVEL_NAMES, OVERRIDES_DIR, OUT_DIR,
    SUITE_DATA_DIR, UPSTREAM_OVERRIDES_PREFIX, ensure_out_dir,
)

SKIP_ANN_FILES = {"annotations.jsonl"}  # exact name only — legacy snapshots excluded
SCENE_RESERVED = {"id", "image_path", "questions", "seed"}


# ---------- tree discovery ----------

def find_subsuites(cat_dir: Path) -> tuple[list[dict], list[dict]]:
    """(subsuites, galleries). main = annotations.jsonl at category root; any
    sub-directory with its own annotations.jsonl = a subsuite (e.g. sample_test);
    PNG-only sub-directories = gallery nodes (e.g. human_calibration)."""
    subsuites, galleries = [], []
    if (cat_dir / "annotations.jsonl").exists():
        subsuites.append({"id": "main", "hasAnnotations": True})
    for child in sorted(cat_dir.iterdir()):
        if not child.is_dir():
            continue
        has_ann = (child / "annotations.jsonl").exists()
        if has_ann:
            subsuites.append({"id": child.name, "hasAnnotations": True})
        else:
            n_pngs = sum(1 for _ in child.rglob("*.png"))
            if n_pngs:
                galleries.append({"id": child.name, "images": n_pngs})
    return subsuites, galleries


def cat_docs(cat_dir: Path) -> list[str]:
    """Repo-relative paths of the category's top-level non-PNG files (docs,
    validators, reports — shown on the category page as upstream links)."""
    return sorted(
        f"Dataset/{cat_dir.name}/{p.name}"
        for p in cat_dir.iterdir()
        if p.is_file() and p.suffix != ".png"
    )


# ---------- record reading ----------

def read_records(sub: dict, folder: str) -> list[dict]:
    """Read one subsuite's annotations.jsonl into compact site records.

    Subsuites other than `main` (sample_test/stress_test/...) are LEGACY
    pre-retrofit snapshots — their annotations carry 4 questions (the original
    four-level era), unlike main's 5. They stay browsable but are flagged.
    """
    if sub["id"] == "main":
        base = SUITE_DATA_DIR / folder
    else:
        base = SUITE_DATA_DIR / folder / sub["id"]
    ann = base / "annotations.jsonl"
    legacy = sub["id"] != "main"
    out: list[dict] = []
    with ann.open(encoding="utf-8") as f:
        for line in f:
            o = json.loads(line)
            scene = {k: v for k, v in o.items() if k not in SCENE_RESERVED}
            out.append({
                "id": o["id"],
                "sub": sub["id"],
                "legacy": legacy,
                "img": f"Dataset/{folder}" + ("" if sub["id"] == "main" else f"/{sub['id']}") + f"/{o['image_path'].replace(chr(92), '/')}",
                "seed": o.get("seed"),
                "score": o.get("difficulty_score"),
                "canvas": o.get("canvas_size") or [o.get("canvas_width"), o.get("canvas_height")],
                "scene": scene,
                "q": o["questions"],
            })
    return out


# ---------- overrides ----------

def load_overrides(slug: str) -> dict[str, dict]:
    d = OVERRIDES_DIR / slug
    if not d.exists():
        return {}
    out = {}
    for p in sorted(d.glob("*.json")):
        out[p.stem] = json.loads(p.read_text(encoding="utf-8"))
    return out


def apply_overrides(records: list[dict], slug: str) -> tuple[int, list[str]]:
    """Apply data/grip-overrides/{slug}/*.json in place. Returns (applied, ids).

    A `from` that does not match the CURRENT value is a hard error — the
    override is stale and a human must re-assert or drop it.
    """
    ovs = load_overrides(slug)
    if not ovs:
        return 0, []
    by_id = {r["id"]: r for r in records}
    applied, modified = 0, []
    for sid, ov in ovs.items():
        rec = by_id.get(sid)
        if rec is None:
            raise SystemExit(f"override target not found: {slug}/{sid}")
        for ch in ov.get("changes", []):
            field, to = ch.get("field"), ch.get("to")
            if not field or to is None:
                raise SystemExit(f"{slug}/{sid}: bad change {ch}")
            if field.startswith("q:"):
                qid, prop = field[2:].split(".", 1)
                q = next((q for q in rec["q"] if q["question_id"] == qid), None)
                if q is None:
                    raise SystemExit(f"{slug}/{sid}: unknown question {qid}")
                if "from" in ch and str(q.get(prop)) != str(ch["from"]):
                    raise SystemExit(
                        f"override conflict {slug}/{sid} {qid}.{prop}: "
                        f"from={ch['from']!r} actual={q.get(prop)!r}")
                q[prop] = to
            elif field.startswith("scene."):
                key = field[len("scene."):]
                if "from" in ch and str(rec["scene"].get(key)) != str(ch["from"]):
                    raise SystemExit(
                        f"override conflict {slug}/{sid} scene.{key}: "
                        f"from={ch['from']!r} actual={rec['scene'].get(key)!r}")
                rec["scene"][key] = to
            else:
                raise SystemExit(f"{slug}/{sid}: bad field {field}")
            applied += 1
        modified.append(sid)
    return applied, modified


# ---------- main ----------

def main() -> int:
    ensure_out_dir()
    built_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    total_img = total_q = 0
    level_counts: Counter[int] = Counter()
    cat_entries: list[dict] = []

    for slug, (folder, display, family, gclass) in CATEGORIES.items():
        cat_dir = SUITE_DATA_DIR / folder
        if not cat_dir.is_dir():
            raise SystemExit(f"category folder missing: {cat_dir}")
        subsuites, galleries = find_subsuites(cat_dir)
        records = [r for sub in subsuites for r in read_records(sub, folder)]
        n_applied, modified = apply_overrides(records, slug)

        qtypes: Counter[str] = Counter()
        n_q = 0
        for r in records:
            n_q += len(r["q"])
            if r["sub"] == "main":
                for q in r["q"]:
                    qtypes[q["question_type"]] += 1
                    level_counts[q["difficulty_level"]] += 1
        scores = [r["score"] for r in records if isinstance(r["score"], (int, float))]

        cat_entries.append({
            "slug": slug,
            "folder": folder,
            "name": display,
            "family": family,
            "geometryClass": gclass,
            "images": len(records),
            "imagesMain": sum(1 for r in records if r["sub"] == "main"),
            "questions": n_q,
            "questionsMain": sum(len(r["q"]) for r in records if r["sub"] == "main"),
            "legacyImages": sum(1 for r in records if r.get("legacy")),
            "subsuites": subsuites,
            "galleries": galleries,
            "docs": cat_docs(cat_dir),
            "questionTypes": sorted(qtypes),
            "score": {"min": min(scores), "mean": round(sum(scores) / len(scores), 4),
                      "max": max(scores)} if scores else None,
            "overridesApplied": n_applied,
            "modifiedSampleIds": modified,
        })
        (OUT_DIR / f"{slug}.json").write_text(
            json.dumps({"slug": slug, "records": records}, ensure_ascii=False),
            encoding="utf-8")
        total_img += len(records)
        total_q += n_q
        print(f"  {slug}: {len(records)} imgs / {n_q} q / "
              f"{len(subsuites)} subsuites / {n_applied} overrides")

    tree = {
        "version": 1,
        "builtAt": built_at,
        "bakedFromCommit": "local-download-2026-08-29",
        "upstreamRepo": "bilaljawaid980/Geomatric-Reasoning-Benchmark-Dataset",
        "counts": {
            "categories": len(cat_entries),
            "images": total_img,
            "questions": total_q,
            "imagesMain": sum(c["imagesMain"] for c in cat_entries),
            "questionsMain": sum(c["questionsMain"] for c in cat_entries),
            "legacyImages": sum(c["legacyImages"] for c in cat_entries),
            "levels": {str(k): v for k, v in sorted(level_counts.items())},
        },
        "levelNames": LEVEL_NAMES,
        "categories": cat_entries,
    }
    (OUT_DIR / "tree.json").write_text(json.dumps(tree, ensure_ascii=False), encoding="utf-8")
    print(f"tree.json: {total_img} images / {total_q} questions across {len(cat_entries)} categories")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
