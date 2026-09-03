#!/usr/bin/env python3
"""
Bake nearDup.json for the /gallery/duplicates page — the derived artifact
for the near-duplicate (CLIP) review UI.

Input:  dedup/near-dup.csv  (produced by dedup/colab_clip_dedup.ipynb on Colab,
        committed to the repo by a human). Schema: group_id, kept_file_id,
        dropped_file_id, cosine. One row per dropped member; the kept member
        repeats across rows of its group.
Output: apps/web/public/data/nearDup.json — groups with names/sizes joined
        from data/latest.json. Absent input → absent output (the UI treats
        that as "no near-dup findings yet").

Run:  python dedup/bake_near_dup.py
"""
import csv
import json
import os
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data", "latest.json")
CSV = os.path.join(ROOT, "dedup", "near-dup.csv")
OUT = os.path.join(ROOT, "apps", "web", "public", "data")


def main():
    if not os.path.exists(CSV):
        print("no dedup/near-dup.csv — skipping (review pass not run yet)")
        return
    t0 = time.perf_counter()

    data = json.loads(open(SRC, encoding="utf-8").read())
    img_by_id = {r[0]: r for r in data["files"] if r[7] == "i"}

    # group rows; all rows of a group carry the same kept_file_id
    groups: dict[str, dict] = {}
    with open(CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            g = groups.setdefault(row["group_id"], {"kept": row["kept_file_id"], "peak": 0.0, "members": []})
            if row["kept_file_id"] != g["kept"]:
                raise SystemExit(f"inconsistent kept_file_id in group {row['group_id']}")
            g["peak"] = max(g["peak"], float(row["cosine"]))
            g["members"].append(row)

    out_groups = []
    dropped_total = 0
    for gid, g in groups.items():
        members = []
        for row in g["members"]:
            fid = row["dropped_file_id"]
            r = img_by_id.get(fid)
            members.append({
                "id": fid,
                "kept": fid == g["kept"],
                "cos": round(float(row["cosine"]), 4),
                "name": r[1] if r else fid,
                "size": int(r[3]) if r else 0,
                "owner": r[5] if r else "",
            })
        # also surface the kept member so the UI can render the pair side-by-side
        kr = img_by_id.get(g["kept"])
        members.append({
            "id": g["kept"],
            "kept": True,
            "cos": 1.0,
            "name": kr[1] if kr else g["kept"],
            "size": int(kr[3]) if kr else 0,
            "owner": kr[5] if kr else "",
        })
        out_groups.append({
            "id": gid,
            "kept": g["kept"],
            "peakCos": round(g["peak"], 4),
            "members": sorted(members, key=lambda m: (not m["kept"], -m["cos"])),
        })
        dropped_total += len(g["members"])

    out_groups.sort(key=lambda g: -g["peakCos"])

    os.makedirs(OUT, exist_ok=True)
    out_path = os.path.join(OUT, "nearDup.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({
            "groups": out_groups,
            "groupCount": len(out_groups),
            "droppedCount": dropped_total,
        }, f, separators=(",", ":"))

    n = len(out_groups)
    print(f"baked nearDup.json — {n} near-dup groups, {dropped_total} flagged copies "
          f"({(time.perf_counter() - t0) * 1000:.0f}ms)")


if __name__ == "__main__":
    main()
