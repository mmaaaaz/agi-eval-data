#!/usr/bin/env python3
"""
make_batches.py — deterministic batch generator (plan v6 Task 4.1).

Order rules (fully deterministic, re-runs reproduce identical batches):
  - Universe: unique post-md5 images from the manifest, sorted by id.
  - pilot-500: stratified round-robin over (ext_group, size_decile, ratio_bucket),
    ids sorted within stratum.
  - batch_0001 "gnarly 2000": hardest files first — score = unusual ext bonus
    + size rank + extreme-ratio bonus; ties by id.
  - remaining: sorted by id, sliced into 2000s.

Usage:
  python dataset-tools/make_batches.py            # writes dataset-tools/batches/*.json
  python dataset-tools/make_batches.py --dry      # prints summary only
"""
import argparse
import json
import os
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data", "latest.json")
OUT = os.path.join(ROOT, "dataset-tools", "batches")
PILOT_N, REGULAR_N = 500, 2000

EXT_GROUP = {"png": "png", "heic": "heic", "gif": "gif", "webp": "webp",
             "avif": "avif", "jpeg": "jpg", "jpg": "jpg"}


def decile(x):
    return min(9, int(x / 10))


def stratify(size, w, h):
    ratio = max(w, h) / max(1, min(w, h))
    rb = 0 if ratio < 1.5 else (1 if ratio < 2.5 else (2 if ratio < 4 else 3))
    return (decile(size), rb)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()

    d = json.load(open(SRC, encoding="utf-8"))
    exif = d.get("exif", {})
    seen, imgs = set(), []
    for r in d["files"]:
        if r[7] != "i" or r[6] in seen:
            continue
        seen.add(r[6])
        e = exif.get(r[0]) or [None, None]
        w, h = e[0] or 0, e[1] or 0
        imgs.append({"id": r[0], "name": r[1], "ext": r[2], "size": r[3],
                     "owner": r[5], "md5": r[6], "w": w, "h": h})
    imgs.sort(key=lambda x: x["id"])
    print(f"universe: {len(imgs)} unique images")

    # --- pilot 500: stratified round-robin ---
    strata = defaultdict(list)
    for im in imgs:
        g = EXT_GROUP.get(im["ext"], "other")
        s = stratify(im["size"], im["w"], im["h"])
        strata[(g, s)].append(im)
    keys = sorted(strata)  # deterministic stratum order
    pilot, ki = [], 0
    pools = {k: list(strata[k]) for k in keys}
    while len(pilot) < PILOT_N and any(pools[k] for k in keys):
        k = keys[ki % len(keys)]
        if pools[k]:
            pilot.append(pools[k].pop(0))
        ki += 1
    pilot_ids = {x["id"] for x in pilot}

    # --- gnarly 2000 ---
    rest = [im for im in imgs if im["id"] not in pilot_ids]
    by_size = sorted(rest, key=lambda x: -x["size"])
    size_rank = {im["id"]: i for i, im in enumerate(by_size)}

    def gnarl(im):
        g = EXT_GROUP.get(im["ext"], "other")
        ratio = max(im["w"], im["h"]) / max(1, min(im["w"], im["h"]))
        s = (0 if g == "jpg" else 3) + (2 if ratio > 2.5 else 0) + size_rank[im["id"]] / max(1, len(rest))
        return (-s, im["id"])

    gnarly = sorted(rest, key=gnarl)[:REGULAR_N]
    gnarly_ids = {x["id"] for x in gnarly}
    leftovers = [im for im in rest if im["id"] not in gnarly_ids]

    # --- regular 2000s ---
    batches = [("pilot-500", pilot), ("batch_0001", gnarly)]
    for i in range(0, len(leftovers), REGULAR_N):
        chunks = leftovers[i:i + REGULAR_N]
        batches.append((f"batch_{len(batches):04d}", chunks))

    print(f"batches: {len(batches)} (pilot 500 + gnarly 2000 + {len(batches)-2} regular)")
    for name, members in batches:
        print(f"  {name}: {len(members)} files, {sum(m['size'] for m in members)/2**30:.2f} GiB")

    if args.dry:
        return
    os.makedirs(OUT, exist_ok=True)
    for name, members in batches:
        members.sort(key=lambda x: x["id"])
        payload = {"batch_id": name, "count": len(members), "files": members}
        with open(os.path.join(OUT, f"{name}.json"), "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=1)
    print(f"wrote {len(batches)} batch files to {OUT}")


if __name__ == "__main__":
    main()
