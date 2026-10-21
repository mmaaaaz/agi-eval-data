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
    rows = []
    for line in src.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            # A live run may be mid-append; a torn last line is not a batch defect.
            continue
    # A live batch can hold two rows for one image (a retry landed after a success).
    # The last row is the freshest; the end-of-run compaction keeps the best, but an
    # export must not double an image's counts in the meantime.
    latest: dict[str, dict] = {}
    for r in rows:
        if r.get("file_id"):
            latest[r["file_id"]] = r
    rows = list(latest.values())
    images: dict[str, list[dict]] = {}
    search: list[dict] = []
    caps: Counter[str] = Counter()
    lvls: Counter[str] = Counter()
    doms: Counter[str] = Counter()
    matrix: dict[str, Counter[str]] = {}
    axes: Counter[str] = Counter()
    abstentions = 0
    total = 0
    trimmed = 0
    cats: Counter[str] = Counter()
    subs: Counter[str] = Counter()
    taxonomy_versions: Counter[str] = Counter()

    # v5 rows do not carry a scene domain (the five categories are the taxonomy);
    # the v2 draft of the same corpus does. Reuse it by file_id rather than spend a
    # second pass over 50k images just to label the explorer's domain facet.
    dom_map: dict[str, str] = {}
    fallback = RUNS / "full-50k" / "candidates.jsonl"
    if fallback.exists() and fallback != src:
        for line in fallback.read_text(encoding="utf-8").splitlines():
            try:
                fr = json.loads(line)
            except json.JSONDecodeError:
                continue
            for fc in fr.get("candidates") or []:
                if fc.get("domain"):
                    dom_map[fr.get("file_id", "")] = fc["domain"]
                    break

    for r in rows:
        if not r.get("parse_ok"):
            continue
        fid = r.get("file_id", "")
        batch = args.batch
        is_v5 = str(r.get("taxonomy_version") or "").startswith("v5")
        # v5 stores `items`; legacy rows store `candidates`.
        valid = [c for c in ((r.get("items") if is_v5 else r.get("candidates")) or [])
                 if not c.get("_errors")]
        # v5 has no fixed five: it has two items per APPLICABLE category, so the
        # count belongs to the schema and must not be trimmed. Legacy rows keep the
        # old five-item contract.
        if is_v5:
            taxonomy_versions["v5"] += 1
        else:
            taxonomy_versions["v4"] += 1
            if len(valid) > 5:
                trimmed += len(valid) - 5
                valid = valid[:5]
        for c in valid:
            cid = cand_id(batch, fid, c.get("qnorm") or c.get("question", ""))
            cat = c.get("category", "") if is_v5 else ""
            sub = c.get("subcategory", "") if is_v5 else ""
            dom = c.get("domain", "") or r.get("domain", "") or dom_map.get(fid, "")
            dom = str(dom).strip().split()[0].upper() if str(dom).strip() else ""
            item = {
                "id": cid,
                "question": c.get("question", ""),
                "choices": c.get("choices", []),
                "answer": c.get("answer", ""),
                "grounding": c.get("grounding", ""),
                # legacy keys stay so an old page and a v5 page share one reader;
                # in v5 `capability` is the subcategory code.
                "capability": sub or c.get("capability", ""),
                "category": cat,
                "subcategory": sub,
                "level": "" if is_v5 else c.get("level", ""),
                "domain": dom,
                "difficulty": c.get("difficulty", ""),
                "prompt_version": c.get("prompt_version") or r.get("prompt_version", ""),
                "answer_type": c.get("answer_type", ""),
                "relevance": c.get("relevance", ""),
                "bias_axis": c.get("bias_axis", "") or (sub if cat == "bias" else ""),
                "abstention": bool(c.get("abstention")),
            }
            images.setdefault(fid, []).append(item)
            search.append({"id": cid, "f": fid, "q": item["question"],
                           "c": item["capability"], "l": item["level"], "d": item["domain"]})
            caps[item["capability"]] += 1
            lvls[item["level"]] += 1
            doms[item["domain"]] += 1
            matrix.setdefault(item["capability"], Counter())[item["level"]] += 1
            if is_v5:
                cats[cat] += 1
                subs[sub] += 1
                matrix.setdefault(cat, Counter())[sub] += 1
            if item["bias_axis"]:
                axes[item["bias_axis"]] += 1
            if item["abstention"]:
                abstentions += 1
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
                "d": cs[0]["domain"],
                "c": sorted({(x["category"] or x["capability"]) for x in cs}),
                "s": sorted({x["subcategory"] for x in cs if x["subcategory"]}),
                "l": sorted({x["level"] for x in cs if x["level"]}), "n": len(cs),
                "b": 1 if any(x.get("bias_axis") for x in cs) else 0,
                "a": 1 if any(x.get("abstention") for x in cs) else 0,
            })

    index = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "batch": args.batch,
        "images": len(fids),
        "candidates": total,
        "page_size": args.page_size,
        "pages": pages,
        "byCapability": dict(caps.most_common()),
        "byCategory": dict(cats.most_common()),
        "bySubcategory": dict(subs.most_common()),
        "taxonomyVersion": "v5.1" if taxonomy_versions["v5"] else "v4",
        "byLevel": dict(sorted(lvls.items())),
        "byDomain": dict(doms.most_common()),
        "byBiasAxis": dict(sorted(axes.items())),
        "abstentions": abstentions,
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
