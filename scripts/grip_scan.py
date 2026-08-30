#!/usr/bin/env python3
"""Enumerate the GRIP suite tree and bake website artifacts into data/grip/.

Source: .grip-cache/ — populated by scripts/grip_fetch.py from the upstream
repo (bilaljawaid980/Geomatric-Reasoning-Benchmark-Dataset), the single source
of truth. Upstream annotations.jsonl are plain git blobs; images stay LFS and
are hotlinked at runtime, never baked.

Writes:
  data/grip/tree.json        — the always-loaded index (counts, per-category meta)
  data/grip/{slug}.json.gz   — per-category full records (scene + questions each)

Applies override patches from .grip-cache/data/overrides/** (synced from the
site via the grip-sync worker) with from-assertions — a mismatch is a hard
fail: the override is stale against the current suite.
"""
from __future__ import annotations

import gzip
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from grip_common import (
    CATEGORIES, LEVEL_NAMES, OUT_DIR, UPSTREAM_REPO, ensure_out_dir,
)

CACHE = Path(".grip-cache")
SCENE_RESERVED = {"id", "image_path", "questions", "seed"}


def gzip_bytes(text: str) -> bytes:
    return gzip.compress(text.encode("utf-8"), 9)


def load_manifest() -> dict:
    m = CACHE / "manifest.json"
    if not m.exists():
        raise SystemExit("no .grip-cache/manifest.json — run scripts/grip_fetch.py first")
    return json.loads(m.read_text(encoding="utf-8"))


# ---------- tree discovery (from the fetched cache) ----------

def find_subsuites(cat_folder: str) -> tuple[list[dict], list[dict]]:
    """(subsuites, galleries) from cached annotation paths.

    main = annotations.jsonl at category root; any sub-directory with its own
    annotations.jsonl = a subsuite (e.g. sample_test). Gallery nodes
    (PNG-only dirs like human_calibration) can't be derived from the cache
    (we never fetch images) — counts come from the last full scan (fallback 0).
    """
    ann = CACHE / "annotations_index.json"
    if not ann.exists():
        raise SystemExit("no .grip-cache/annotations_index.json — run scripts/grip_fetch.py first")
    index = json.loads(ann.read_text(encoding="utf-8"))
    rels = index.get(cat_folder, [])
    subsuites: list[dict] = []
    if f"{cat_folder}/annotations.jsonl" in rels:
        subsuites.append({"id": "main", "hasAnnotations": True})
    seen: set[str] = set()
    for rel in rels:
        parts = rel.split("/")
        if len(parts) == 3:  # <folder>/<subdir>/annotations.jsonl
            sub_id = parts[1]
            if sub_id not in seen:
                seen.add(sub_id)
                subsuites.append({"id": sub_id, "hasAnnotations": True})
    # gallery nodes: persisted from the last tree.json (PNG counts never change
    # — they are derived from the suite, which is append-only upstream)
    prev = _prev_category(cat_folder)
    galleries = prev.get("galleries", []) if prev else []
    return subsuites, galleries


_prev_tree: dict | None = None


def _prev_category(cat_folder: str) -> dict | None:
    global _prev_tree
    if _prev_tree is None:
        p = OUT_DIR / "tree.json"
        _prev_tree = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    for c in _prev_tree.get("categories", []):
        if c["folder"] == cat_folder:
            return c
    return None


def cat_docs(cat_folder: str) -> list[str]:
    """Repo-relative upstream paths of the category's top-level non-PNG files.
    Persisted from the previous tree.json (the cache holds annotations only)."""
    prev = _prev_category(cat_folder)
    return prev.get("docs", []) if prev else []


# ---------- record reading ----------

def read_records(sub: dict, folder: str) -> list[dict]:
    """Read one subsuite's annotations.jsonl into compact site records.

    Subsuites other than `main` (sample_test/stress_test/...) are LEGACY
    pre-retrofit snapshots — their annotations carry 4 questions (the original
    four-level era), unlike main's 5. They stay browsable but are flagged.
    """
    if sub["id"] == "main":
        base = CACHE / "Dataset" / folder
    else:
        base = CACHE / "Dataset" / folder / sub["id"]
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
    """From .grip-cache/data/overrides/{slug}/*.json — fetched from upstream,
    where the grip-sync worker commits them (the ONE durable home)."""
    d = CACHE / "data" / "overrides" / slug
    if not d.exists():
        return {}
    out = {}
    for p in sorted(d.glob("*.json")):
        out[p.stem] = json.loads(p.read_text(encoding="utf-8"))
    return out


def apply_overrides(records: list[dict], slug: str) -> tuple[int, list[str]]:
    """Apply override patches in place. Returns (applied, ids).

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
    manifest = load_manifest()
    built_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    total_img = total_q = 0
    level_counts: Counter[int] = Counter()
    cat_entries: list[dict] = []

    for slug, (folder, display, family, gclass) in CATEGORIES.items():
        subsuites, galleries = find_subsuites(folder)
        records = [r for sub in subsuites for r in read_records(sub, folder)]
        if not records:
            raise SystemExit(f"{slug}: no records — fetch failed for {folder}?")
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
            "docs": cat_docs(folder),
            "questionTypes": sorted(qtypes),
            "score": {"min": min(scores), "mean": round(sum(scores) / len(scores), 4),
                      "max": max(scores)} if scores else None,
            "overridesApplied": n_applied,
            "modifiedSampleIds": modified,
        })
        (OUT_DIR / f"{slug}.json.gz").write_bytes(gzip_bytes(
            json.dumps({"slug": slug, "records": records}, ensure_ascii=False)))
        total_img += len(records)
        total_q += n_q
        print(f"  {slug}: {len(records)} imgs / {n_q} q / "
              f"{len(subsuites)} subsuites / {n_applied} overrides")

    tree = {
        "version": 1,
        "builtAt": built_at,
        "bakedFromCommit": manifest["head"],
        "upstreamRepo": UPSTREAM_REPO,
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
    print(f"tree.json: {total_img} images / {total_q} questions across {len(cat_entries)} categories "
          f"@ {manifest['head'][:12]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
