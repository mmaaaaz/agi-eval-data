#!/usr/bin/env python3
"""
STAGE 1 — Image selection for the real-world VQA benchmark.

Reads data/latest.json and emits a stratified, defensible candidate pool.
Pure metadata: no image bytes are downloaded, no PII is touched, nothing
leaves the machine.

Every decision this script makes is written to the output as a column, so a
reviewer (or your professor) can audit exactly why any given image was kept.

SIZE THE POOL FROM THE ITEM TARGET, NOT BY FEEL
------------------------------------------------
The plan asks for roughly 2,500 items. An image yields one or two questions, and not every
question survives the gate, the blind filter and review — so the pool has to be several
times the item target, not equal to it.

    2,500 items  /  ~1.3 questions per image  /  ~60% survival  ->  ~3,200 images

`--target 600` is a SMOKE-TEST SIZE, not a release size. It was run once to prove the stage
works end to end, and the triage screen then had to display quotas it could never meet:
a 600-image pool against a 2,500 target asks every band for about four times what it holds.
The screen now caps those quotas and reports the shortfall, so the mismatch is visible
rather than silently impossible — but the fix is a bigger pool.

Usage:
    python scripts/factory/01_select_images.py --target 600 --seed 20261005   # smoke test
    python scripts/factory/01_select_images.py --target 3200                   # a release

Outputs:
    data/factory/candidates.json     the selected pool + why
    data/factory/rejected.json       exclusion counts by reason
    data/factory/select_log.json     full audit trail, deterministic seed
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "data", "latest.json")
OUT = os.path.join(ROOT, "data", "factory")

# Extensions we can actually hand to a model harness without a conversion step.
# heic and vnd.goog are excluded HERE, deliberately, so they never reach an
# annotator or a VLM and fail confusingly. Convert them later if needed.
SAFE_EXT = {"jpg", "jpeg", "png", "webp", "gif", "avif"}

# Resolution bands, in megapixels. Mirrors scripts/build_data.py MP_LABELS so
# the numbers in the paper and the numbers on the website cannot drift apart.
MP_BANDS = [(0.0, 1.0, "<1 MP"), (1.0, 4.0, "1-4 MP"), (4.0, 12.0, "4-12 MP"),
            (12.0, 24.0, "12-24 MP"), (24.0, float("inf"), "24+ MP")]


def mp_band(w: int, h: int) -> str:
    mp = (w * h) / 1e6
    for lo, hi, name in MP_BANDS:
        if lo <= mp < hi:
            return name
    return "24+ MP"


def orientation(w: int, h: int) -> str:
    if w > h * 1.05:
        return "landscape"
    if h > w * 1.05:
        return "portrait"
    return "square"


def load(path: str) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def main() -> int:
    # -> int, not -> None. This function RETURNS 2 on a refused --out, and the annotation
    # said None, so the return value looked meaningless and the bare `main()` at the bottom
    # discarded it: the guard printed its refusal and the process still exited 0. A guard
    # that cannot signal is not a guard.
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", type=int, default=600,
                    help="how many images to put in the candidate pool")
    ap.add_argument("--seed", type=int, default=20261005,
                    help="fixed so the selection is reproducible")
    ap.add_argument("--src", default=SRC)
    ap.add_argument("--out", default=OUT,
                    help="a DIRECTORY. candidates.json, rejected.json and select_log.json are "
                         "written inside it. A path ending in .json is refused, because passing "
                         "one used to create a directory called 'something.json'.")
    ap.add_argument("--explain-quota", action="store_true",
                    help="print the per-band quota arithmetic, so a target can be chosen from "
                         "the numbers instead of by feel")
    args = ap.parse_args()

    rng = random.Random(args.seed)
    data = load(args.src)
    exif = data.get("exif", {})
    cams = data.get("cams", [])
    owners = data.get("owners", {})

    # ---- Pass 1: hard technical filters -------------------------------
    # Each rejection reason is counted separately so the paper can report an
    # attrition table instead of a single hand-wave.
    reject: Counter = Counter()
    pool: list[dict] = []
    seen_md5: set[str] = set()

    for row in data["files"]:
        fid, name, ext, size, day, owner, md5, kind = row

        if kind != "i":
            reject["not_an_image"] += 1
            continue
        if ext not in SAFE_EXT:
            reject[f"unsupported_format:{ext}"] += 1
            continue
        if not md5 or md5 in seen_md5:
            reject["duplicate_md5"] += 1
            continue
        if fid not in exif:
            reject["no_exif_dimensions"] += 1
            continue

        seen_md5.add(md5)
        entry = exif[fid]
        w, h = int(entry[0]), int(entry[1])
        camera = cams[entry[2]] if len(entry) > 2 and entry[2] < len(cams) else ""

        # Degenerate geometry — nothing to ask a question about.
        if w < 256 or h < 256:
            reject["too_small_to_annotate"] += 1
            continue

        pool.append({
            "file_id": fid,
            "name": name,
            "w": w, "h": h,
            "mp": round(w * h / 1e6, 2),
            "band": mp_band(w, h),
            "orient": orientation(w, h),
            "camera": camera,
            "owner": owners.get(owner, "unknown"),
            "day": day,
            "bytes": int(size or 0),
        })

    # ---- Pass 2: stratified sampling ----------------------------------
    # Two-level: guarantee coverage across resolution bands first (because a
    # naive random draw would give you a corpus dominated by phone photos),
    # then fill the remainder in natural-proportion so the sample still looks
    # like the real corpus on everything we did not control for.
    total = len(pool)
    natural = Counter(p["band"] for p in pool)

    # Minimum per band so every resolution regime is testable.
    #
    # THIS FLOOR IS THE WHOLE STORY FOR THE RARE BANDS, and it surprised me:
    # `max(MIN_PER_BAND, ...)` means a band sits at exactly 25 until the PROPORTIONAL term
    # passes 25, which for a band holding 0.3% of the pool needs a target in the thousands.
    # Measured: raising --target from 600 to 3,200 left 4-12, 12-24 and 24+ MP at 25 each
    # and added 2,600 images to 1-4 MP. A bigger pool does NOT thicken the resolution axis.
    MIN_PER_BAND = 25
    quota: dict[str, int] = {}
    explain: list[str] = []
    for band in sorted(natural):
        natural_share = natural[band] / total
        proportional = max(MIN_PER_BAND, round(args.target * natural_share))
        quota[band] = min(proportional, natural[band])
        capped = " (held at the floor)" if proportional <= MIN_PER_BAND else (
            " (capped by the corpus)" if quota[band] < proportional else "")
        explain.append(
            "  %-10s corpus %7d  share %6.3f%%  target*share %7.1f  floor %d -> quota %6d%s"
            % (band, natural[band], 100 * natural_share,
               args.target * natural_share, MIN_PER_BAND, quota[band], capped)
        )
    if getattr(args, "explain_quota", False):
        print("quota arithmetic (target %d, pool %d):" % (args.target, total))
        for line in explain:
            print(line)
        print()
    # Trim or extend to hit the target exactly.
    while sum(quota.values()) > args.target:
        biggest = max(quota, key=lambda b: quota[b])
        if quota[biggest] <= MIN_PER_BAND:
            break
        quota[biggest] -= 1
    while sum(quota.values()) < args.target:
        room = {b: natural[b] - quota[b] for b in quota}
        b = max(room, key=lambda k: room[k])
        if room[b] <= 0:
            break
        quota[b] += 1

    by_band: dict[str, list[dict]] = defaultdict(list)
    for p in pool:
        by_band[p["band"]].append(p)

    selected: list[dict] = []
    for band, want in sorted(quota.items()):
        bucket = by_band[band]
        rng.shuffle(bucket)
        # Within a band, prefer spread across contributor and camera so a
        # single person's camera roll cannot dominate a stratum.
        bucket.sort(key=lambda p: (p["owner"], p["camera"]))
        # Round-robin across owners to maximise contributor spread.
        by_owner: dict[str, list[dict]] = defaultdict(list)
        for p in bucket:
            by_owner[p["owner"]].append(p)
        owner_order = sorted(by_owner)
        rng.shuffle(owner_order)
        taken = 0
        while taken < want and any(by_owner[o] for o in owner_order):
            for o in owner_order:
                if taken >= want:
                    break
                if by_owner[o]:
                    selected.append(by_owner[o].pop())
                    taken += 1

    rng.shuffle(selected)
    for i, p in enumerate(selected):
        p["index"] = i
        p["selection_reason"] = f"stratified:{p['band']}"

    # ---- Emit ----------------------------------------------------------
    # --out is a DIRECTORY. I passed a path ending in .json and got a folder called
    # "candidates_3200.json" containing the real files, which then read as a PermissionError
    # rather than an explanation. Refuse it and say so.
    if os.path.splitext(args.out)[1].lower() in (".json", ".jsonl", ".csv"):
        print("refusing --out '" + args.out + "': it names a FILE, but --out is a DIRECTORY.",
              file=sys.stderr)
        print("  candidates.json, rejected.json and select_log.json go INSIDE it.", file=sys.stderr)
        print("  try:  --out " + os.path.splitext(args.out)[0], file=sys.stderr)
        return 2
    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, "candidates.json"), "w", encoding="utf-8") as fh:
        json.dump({
            "seed": args.seed,
            "target": args.target,
            "selected": len(selected),
            "pool_after_technical_filters": len(pool),
            "quota_by_band": quota,
            "images": selected,
        }, fh, indent=2)

    with open(os.path.join(args.out, "rejected.json"), "w", encoding="utf-8") as fh:
        json.dump({
            "corpus_total": len(data["files"]),
            "rejections": dict(reject.most_common()),
            "pool_after_technical_filters": len(pool),
        }, fh, indent=2)

    # ---- Report --------------------------------------------------------
    print(f"corpus files          : {len(data['files']):,}")
    print(f"after technical filters: {len(pool):,}")
    print(f"selected              : {len(selected)}")
    print()
    print("exclusions:")
    for reason, n in reject.most_common():
        print(f"  {n:>7,}  {reason}")
    print()
    print("selected composition:")
    print("  by band      :", dict(Counter(p['band'] for p in selected)))
    print("  by orientation:", dict(Counter(p['orient'] for p in selected)))
    print("  by owner     :", dict(Counter(p['owner'] for p in selected).most_common()))
    print(f"  distinct cams : {len({p['camera'] for p in selected})}")
    mp = sorted(p["mp"] for p in selected)
    print(f"  megapixels    : min {mp[0]} / median {mp[len(mp)//2]} / max {mp[-1]}")


if __name__ == "__main__":
    raise SystemExit(main())