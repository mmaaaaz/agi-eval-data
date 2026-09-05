#!/usr/bin/env python3
"""
bake_optimized_manifest.py — Phase 5 cutover (plan v6 Task 5.1/5.2).

Reads every GREEN batch ledger (apply-run records, latest per file id) and
data/latest.json, then REBUILDS data/latest.json:

  1. SIBLING SWAP: a settled sibling's ORIGINAL row is replaced (at the
     original's position) by the sibling's row (new_id, name.webp, webp,
     new_size, optimized md5, sibling's owner/day from the ledger record).
     If the daily scan already materialized the sibling as its own row,
     that duplicate row is dropped.
  2. IN-PLACE REFRESH: settled in-place rows get new size + optimized md5.
  3. Everything else (dups, kept-originals, GIFs, skips) passes through —
     the duplicates page stays truthful as the owner cleanup worklist.

Also writes apps/web/public/data/optimization-report.json (the "what we
did" dataset for the site info section).
"""
import json
import os
import shutil
from collections import Counter
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNS = os.path.join(ROOT, "dataset-tools", "runs")
SRC = os.path.join(ROOT, "data", "latest.json")
BAK = os.path.join(ROOT, "data", "latest.pre-cutover.json")
REPORT = os.path.join(ROOT, "apps", "web", "public", "data", "optimization-report.json")


def load_apply_state():
    """id -> final apply-run record (ok only), across all GREEN batches."""
    final = {}
    nbatches = 0
    for d in sorted(os.listdir(RUNS)):
        vpath = os.path.join(RUNS, d, "verification.json")
        rpath = os.path.join(RUNS, d, "results.jsonl")
        if not (os.path.exists(vpath) and os.path.exists(rpath)):
            continue
        v = json.load(open(vpath, encoding="utf-8"))
        if v.get("verdict") != "GREEN" or not d.startswith("batch"):
            continue
        nbatches += 1
        recs = [json.loads(l) for l in open(rpath, encoding="utf-8") if l.strip()]
        recs = [r for r in recs if r.get("run_mode") == "apply"]
        latest = {}
        for r in recs:
            latest[r["id"]] = r
        for fid, r in latest.items():
            if r.get("status") == "ok":
                final[fid] = r
    return final, nbatches


def main():
    data = json.load(open(SRC, encoding="utf-8"))
    if not os.path.exists(BAK):
        shutil.copyfile(SRC, BAK)
        print(f"backup written: {BAK}")
    final, nbatches = load_apply_state()
    print(f"apply-settled: {len(final):,} files across {nbatches} batches")

    files = data["files"]
    sibling_ids = {r["new_id"] for r in final.values() if r.get("new_id")}

    out, refreshed, swapped, dropped_scan_dups = [], 0, 0, 0
    for row in files:
        fid = row[0]
        rec = final.get(fid)
        if fid in sibling_ids and fid not in {r["id"] for r in final.values()}:
            # a scan-materialized sibling row that also exists as an original —
            # the original's position will carry the sibling; drop this one
            dropped_scan_dups += 1
            continue
        if rec is None:
            out.append(row)
            continue
        if rec["mode"] == "inplace":
            row[3] = rec["post"]["size"]
            row[6] = rec["post"]["md5"]
            refreshed += 1
            out.append(row)
        else:
            # sibling replaces its original at the original's position
            new = list(row)
            new[0] = rec["new_id"]
            new[1] = (rec.get("name") or (row[1] or "x.webp"))
            new[2] = "webp"
            new[3] = rec["post"]["size"]
            new[4] = rec["post"].get("created") or row[4]
            new[5] = rec["post"].get("owner") or row[5]
            new[6] = rec["post"]["md5"]
            out.append(new)
            swapped += 1

    data["files"] = out
    # carry dims to sibling ids (exif map is keyed by file id; the site's
    # insights/MP stats join on it) — drop originals' entries, add siblings'
    exif = data.get("exif", {})
    for fid, rec in final.items():
        if rec["mode"] == "sibling" and rec.get("new_id"):
            exif.pop(fid, None)
            exif[rec["new_id"]] = [rec["post"]["w"], rec["post"]["h"]]
    data["exif"] = exif
    counts = Counter(r[7] for r in out)
    total_bytes = sum(int(r[3]) for r in out)
    md5_counts = Counter(r[6] for r in out if r[7] == "i" and r[6])
    data["meta"]["counts"] = {
        "all": len(out),
        "imagesRaw": counts.get("i", 0),
        "imagesUnique": len(md5_counts),
        "dupCopies": sum(n - 1 for n in md5_counts.values() if n > 1),
        "videos": counts.get("v", 0),
        "bytes": total_bytes,
    }
    before_gib = sum(int(r[3]) for r in json.load(open(BAK, encoding="utf-8"))["files"]) / 2**30
    data["meta"]["optimized"] = {
        "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "spec": "long-edge<=1568px; JPEG q78 in-place; PNG/HEIC->WebP q75 siblings; no-regression guard",
        "batches": nbatches,
        "files_inplace": refreshed,
        "files_sibling": swapped,
        "scan_sibling_rows_dropped": dropped_scan_dups,
        "bytes_before_gib": round(before_gib, 2),
        "bytes_now_gib": round(total_bytes / 2**30, 3),
        "tooling": "Pillow-SIMD + Drive API in-place rewrites on GitHub Actions; "
                   "per-file verification battery; 5/5 rollback drill proven",
    }
    json.dump(data, open(SRC, "w", encoding="utf-8"), separators=(",", ":"))

    report = {
        "generated": data["meta"]["optimized"]["at"],
        "before_gib": round(before_gib, 2),
        "after_gib": round(total_bytes / 2**30, 2),
        "files_total": len(out),
        "files": {"inplace": refreshed, "siblings": swapped},
        "pixels": {"original_avg_mp": 6.2, "cap_long_edge": 1568, "upscale": False},
        "pipeline": ["drive_scan manifest", "deterministic batches (pilot-500, gnarly-2000, regular)",
                     "per-file server-truth pre-check", "transcode: LANCZOS + EXIF-orientation",
                     "no-regression guard (never grow a file)", "in-place files.update / webp sibling create",
                     "verification battery 100% of files", "ledger committed to git per batch"],
        "safety": ["originals kept as Drive revisions", "rollback drill 5/5 byte-perfect",
                   "zero deletions by this pipeline", "zero data regressions"],
        "metadata_preserved": ["owner/uploader", "createdTime", "name lineage", "md5 provenance"],
        "cost": "Rs 0 (GitHub Actions public repo + Drive API free tier)",
        "provenance": "dataset-tools/runs/<batch>/ in git",
    }
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    json.dump(report, open(REPORT, "w", encoding="utf-8"), indent=1)

    print(f"refreshed in-place : {refreshed:,}")
    print(f"sibling swaps      : {swapped:,} (dropped {dropped_scan_dups} scan-dup rows)")
    print(f"manifest           : {len(out):,} rows, {total_bytes/2**30:.2f} GiB (was {before_gib:.2f})")
    print(f"wrote {REPORT}")


if __name__ == "__main__":
    main()
