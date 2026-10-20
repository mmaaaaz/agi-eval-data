#!/usr/bin/env python
"""Export the drafting batch as static review-room pages (the free read path).

    python -m scripts.harness.export_vqa_static --batch full-50k

WHY STATIC
----------
D1's free tier bills rows read (5M/day). Serving 135k candidates per visit is
not free at any real traffic level, and caching a dynamic API is not a promise.
Static JSON on Cloudflare Pages is: unlimited requests, unlimited bandwidth,
served from the edge, instant. So the candidates live here and D1 keeps only
what a human writes — decisions, which are few and constant-cost.

Output (into apps/web/public/vqa/, gitignored so the dataset is not committed):
    index.json          totals, taxonomy dimensions, page list
    pages/0001.json     one page of images, each with its five candidates
    search.json         compact id+question+file index for client-side search

Every candidate gets a STABLE id: sha1(batch|file_id|qnorm)[:16]. The id is what
a decision row stores, so it survives re-exports and re-sharding.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
from collections import Counter
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[2]
RUNS = ROOT / "runs" / "generation"
OUT = ROOT / "apps" / "web" / "public" / "vqa"
PAGE_SIZE = 40  # images per static page


def cand_id(batch: str, file_id: str, qnorm: str) -> str:
    return hashlib.sha1(f"{batch}|{file_id}|{qnorm}".encode("utf-8")).hexdigest()[:16]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch", default="full-50k")
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--page-size", type=int, default=PAGE_SIZE)
    args = ap.parse_args()

    src = RUNS / args.batch / "candidates.jsonl"
    rows = [json.loads(l) for l in src.read_text(encoding="utf-8").splitlines() if l.strip()]
    images: dict[str, list[dict]] = {}
    search: list[dict] = []
    caps: Counter[str] = Counter()
    lvls: Counter[str] = Counter()
    doms: Counter[str] = Counter()
    matrix: dict[str, Counter[str]] = {}
    total = 0
    trimmed = 0

    for r in rows:
        if not r.get("parse_ok"):
            continue
        fid = r.get("file_id", "")
        batch = args.batch
        valid = [c for c in (r.get("candidates") or []) if not c.get("_errors")]
        # EXACTLY FIVE. The model occasionally returned six to ten; the spec is
        # five per image, so keep the first five in ordinal order and count what
        # was dropped, rather than letting the page size drift per image.
        if len(valid) > 5:
            trimmed += len(valid) - 5
            valid = valid[:5]
        for c in valid:
            cid = cand_id(batch, fid, c.get("qnorm") or c.get("question", ""))
            item = {
                "id": cid,
                "question": c.get("question", ""),
                "choices": c.get("choices", []),
                "answer": c.get("answer", ""),
                "grounding": c.get("grounding", ""),
                "capability": c.get("capability", ""),
                "level": c.get("level", ""),
                "domain": c.get("domain", ""),
                "difficulty": c.get("difficulty", ""),
                "model": r.get("model", ""),
                "endpoint": r.get("endpoint") or "",
                "prompt_version": r.get("prompt_version", ""),
            }
            images.setdefault(fid, []).append(item)
            search.append({"id": cid, "f": fid, "q": item["question"],
                           "c": item["capability"], "l": item["level"], "d": item["domain"]})
            caps[item["capability"]] += 1
            lvls[item["level"]] += 1
            doms[item["domain"]] += 1
            matrix.setdefault(item["capability"], Counter())[item["level"]] += 1
            total += 1

    out = pathlib.Path(args.out)
    (out / "pages").mkdir(parents=True, exist_ok=True)
    # clear stale pages from a previous export
    for old in (out / "pages").glob("*.json"):
        old.unlink()

    fids = sorted(images.keys())
    pages = []
    imgs_index = []
    n = 0
    for start in range(0, len(fids), args.page_size):
        n += 1
        chunk = fids[start:start + args.page_size]
        payload = {"page": n, "images": [{"file_id": f, "candidates": images[f]} for f in chunk]}
        name = f"pages/{n:04d}.json"
        (out / name).write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
        pages.append({"p": n, "file": name, "images": len(chunk), "first": chunk[0], "last": chunk[-1]})
        for f in chunk:
            cs = images[f]
            imgs_index.append({
                "f": f, "p": n,
                "d": cs[0]["domain"], "c": sorted({x["capability"] for x in cs}),
                "l": sorted({x["level"] for x in cs}), "n": len(cs),
            })

    index = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "batch": args.batch,
        "images": len(fids),
        "candidates": total,
        "page_size": args.page_size,
        "pages": pages,
        "byCapability": dict(caps.most_common()),
        "byLevel": dict(sorted(lvls.items())),
        "byDomain": dict(doms.most_common()),
        "trimmedOverFive": trimmed,
    }
    # Pages refuses files over 25 MiB. The question index is sharded at 60k rows
    # (~8 MB each), and the UI fetches the parts in parallel on first search.
    (out / "search").mkdir(exist_ok=True)
    for old in (out / "search").glob("*.json"):
        old.unlink()
    parts = [search[i:i + 60000] for i in range(0, len(search), 60000)]
    for i, part in enumerate(parts, 1):
        (out / "search" / f"{i:02d}.json").write_text(json.dumps(part, separators=(",", ":")), encoding="utf-8")
    # A stale single-file index from an earlier export would still be uploaded;
    # remove it or the deploy trips the 25 MiB limit again.
    (out / "search.json").unlink(missing_ok=True)
    index["searchParts"] = len(parts)
    (out / "index.json").write_text(json.dumps(index, separators=(",", ":")), encoding="utf-8")
    # The virtualized explorer reads this once and filters in memory: 50k rows,
    # no pagination, no per-scroll request, no D1.
    (out / "images.json").write_text(json.dumps(imgs_index, separators=(",", ":")), encoding="utf-8")
    (out / "matrix.json").write_text(
        json.dumps({c: dict(v) for c, v in matrix.items()}, separators=(",", ":")), encoding="utf-8")
    # Decisions are published as static JSON too, so a visitor never reads D1.
    # A re-export must NOT wipe them: only sync_vqa_decisions.py writes this file.
    if not (out / "decisions.json").exists():
        (out / "decisions.json").write_text("[]", encoding="utf-8")

    size = sum(p.stat().st_size for p in out.rglob("*.json"))
    print(f"exported {len(fids)} images / {total} candidates in {n} pages")
    print(f"index: {index['images']} images, dims: {len(caps)} caps / {len(lvls)} levels / {len(doms)} domains")
    print(f"total json: {size/1e6:.1f} MB -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
