#!/usr/bin/env python3
"""
rehearsal_setup.py — Phase R (plan v6 §4 P3): build a 30-file sandbox copy of
real dataset strata inside the TYD tree as `_rehearsal/` (owned by maaaazau —
full owner rights, hard-deletable, ~40 MB against 4.96 GiB free).

Writes dataset-tools/batches/rehearsal-001.json for optimize_batch --mode apply.
The ORIGINALS stay untouched on Drive; the rehearsal files are copies.
"""
import json
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import netfix  # noqa: E402
netfix.apply()
import drive_io as DIO  # noqa: E402

TYD = "15Cz7j6Kj-HywKTa991185Zroh3MuF0u8"
BATCH_PATH = os.path.join(HERE, "batches", "rehearsal-001.json")


def pick_strata():
    """30 stratified real files: 20 jpg across size deciles, 4 png, 3 heic,
    2 gif, 1 webp."""
    d = json.load(open(os.path.join(ROOT, "data", "latest.json"), encoding="utf-8"))
    exif = d.get("exif", {})
    seen, buckets = set(), defaultdict(list)
    for r in d["files"]:
        if r[7] != "i" or r[6] in seen:
            continue
        seen.add(r[6])
        buckets[r[2]].append(r)
    out = []
    jpgs = sorted(buckets.get("jpg", []) + buckets.get("jpeg", []), key=lambda r: r[3])
    if jpgs:
        step = max(1, len(jpgs) // 10)
        out += [jpgs[min(i * step, len(jpgs) - 1)] for i in range(10)]          # size ladder
        out += jpgs[:: max(1, len(jpgs) // 10)][:10]                            # spread
    for ext, n in (("png", 4), ("heic", 3), ("gif", 2), ("webp", 1)):
        out += (buckets.get(ext) or [])[:n]
    # dedupe by id, cap 30
    seen2, picked = set(), []
    for r in out:
        if r[0] not in seen2:
            seen2.add(r[0])
            picked.append(r)
        if len(picked) == 30:
            break
    return picked


def main():
    rows = pick_strata()
    print(f"strata picked: {len(rows)} files")
    folder_id = DIO.ensure_folder("_rehearsal", TYD)
    print(f"_rehearsal folder: {folder_id}")

    files = []
    for r in rows:
        data = DIO.download(r[0])
        created = DIO.create_media(r[1], folder_id, data,
                                   "image/jpeg" if r[2] in ("jpg", "jpeg") else f"image/{r[2]}")
        e = (json.load(open(os.path.join(ROOT, "data", "latest.json"), encoding="utf-8")).get("exif", {}) or {}).get(r[0], [None, None])
        files.append({
            "id": created["id"], "name": created["name"], "ext": r[2],
            "size": int(created.get("size") or len(data)), "owner": r[5],
            "md5": created.get("md5Checksum"), "w": e[0] or 0, "h": e[1] or 0,
            "orig_id": r[0], "orig_md5": r[6], "orig_size": r[3],
        })
        print(f"  copied {r[1][:40]:42s} {len(data)/1024:8.0f} KB -> {created['id'][:12]}…")

    os.makedirs(os.path.dirname(BATCH_PATH), exist_ok=True)
    json.dump({"batch_id": "rehearsal-001", "count": len(files), "files": files},
              open(BATCH_PATH, "w", encoding="utf-8"), indent=1)
    print(f"wrote {BATCH_PATH} ({len(files)} files)")
    print("NEXT: python dataset-tools/optimize_batch.py --batch "
          "dataset-tools/batches/rehearsal-001.json --mode apply")


if __name__ == "__main__":
    main()
