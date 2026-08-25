#!/usr/bin/env python3
"""
Build derived data artifacts for the site from data/latest.json.

Outputs to apps/web/public/data/ (vite copies public/** into dist/):
  files.parquet      id, name, ext, size, day, owner, md5, kind
  exif.parquet       id, w, h, camera (camera name denormalized)
  dupGroups.parquet  md5, count, size
  owners.parquet     email, name
  version.json       { scannedAt, cron, counts }  (sync pill + overview tiles)
  insights.json      pre-aggregated stats for the insights page

Run:  python scripts/build_data.py   (requires: pip install pyarrow)
"""
import json
import os
import time
from collections import Counter
from datetime import datetime, timezone

MP_LABELS = ["<1 MP", "1–4 MP", "4–12 MP", "12–24 MP", "24+ MP"]
SIZE_LABELS = ["<0.1 MB", "0.1–1 MB", "1–5 MB", "5–20 MB", "20 MB+"]

import pyarrow as pa
import pyarrow.parquet as pq

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data", "latest.json")
OUT = os.path.join(ROOT, "apps", "web", "public", "data")


def main():
    t0 = time.perf_counter()
    data = json.loads(open(SRC, encoding="utf-8").read())
    files = data["files"]
    exif = data.get("exif", {})
    cams = data.get("cams", [])
    dup_groups = data.get("dupGroups", [])
    owners = data.get("owners", {})
    counts = data["meta"]["counts"]

    os.makedirs(OUT, exist_ok=True)

    # ---------- files.parquet ----------
    pq.write_table(
        pa.table({
            "id": [r[0] for r in files],
            "name": [r[1] for r in files],
            "ext": [r[2] for r in files],
            "size": [int(r[3]) for r in files],
            "day": [r[4] for r in files],
            "owner": [r[5] for r in files],
            "md5": [r[6] for r in files],
            "kind": [r[7] for r in files],
        }),
        os.path.join(OUT, "files.parquet"),
        compression="zstd",
    )

    # ---------- exif.parquet (camera name denormalized for SQL) ----------
    exif_rows = []
    for fid, v in exif.items():
        if len(v) < 2:
            continue
        cam_idx = v[2] if len(v) > 2 else None
        cam_name = cams[cam_idx] if cam_idx is not None and 0 <= cam_idx < len(cams) else None
        exif_rows.append((fid, int(v[0]), int(v[1]), cam_name))
    pq.write_table(
        pa.table({
            "id": [r[0] for r in exif_rows],
            "w": [r[1] for r in exif_rows],
            "h": [r[2] for r in exif_rows],
            "camera": [r[3] for r in exif_rows],
        }),
        os.path.join(OUT, "exif.parquet"),
        compression="zstd",
    )

    # ---------- dupGroups.parquet ----------
    pq.write_table(
        pa.table({
            "md5": [g["md5"] for g in dup_groups],
            "count": [int(g["count"]) for g in dup_groups],
            "size": [int(g["size"]) for g in dup_groups],
        }),
        os.path.join(OUT, "dupGroups.parquet"),
        compression="zstd",
    )

    # ---------- owners.parquet ----------
    pq.write_table(
        pa.table({"email": list(owners.keys()), "name": list(owners.values())}),
        os.path.join(OUT, "owners.parquet"),
        compression="zstd",
    )

    # ---------- insights.json (pre-aggregated browse stats) ----------
    imgs = [r for r in files if r[7] == "i"]
    ex_pairs = [(r, exif.get(r[0])) for r in imgs]
    ex_pairs = [(r, e) for r, e in ex_pairs if e and len(e) >= 2]
    known = len(ex_pairs)

    land = por = sq = 0
    cams_agg: dict = {}
    mp_counts = [0] * 5
    size_counts = [0] * 5
    aspects: dict = {}
    mps = []
    heaviest = None
    size_buckets = [(0, 100_000), (100_000, 1_000_000), (1_000_000, 5_000_000), (5_000_000, 20_000_000), (20_000_000, None)]
    mp_buckets = [(0, 1), (1, 4), (4, 12), (12, 24), (24, None)]
    aspect_table = [("16:9", 16 / 9), ("3:2", 3 / 2), ("4:3", 4 / 3), ("5:4", 5 / 4), ("1:1", 1)]

    def near_aspect(ratio):
        rr = 1 / ratio if ratio < 1 else ratio
        suffix = " ↺" if ratio < 1 else ""
        for label, v in aspect_table:
            if abs(rr - v) / v <= 0.06:
                return label + suffix
        if abs(rr - 2.39) / 2.39 <= 0.08:
            return "21:9" + suffix
        return "other" + suffix

    for r in imgs:
        size_counts[next(i for i, (lo, hi) in enumerate(size_buckets) if r[3] >= lo and (hi is None or r[3] < hi))] += 1
        if heaviest is None or r[3] > heaviest["size"]:
            heaviest = {"id": r[0], "name": r[1], "size": int(r[3])}
    for r, e in ex_pairs:
        w, h = e[0], e[1]
        ratio = w / h if h else 0
        if ratio > 1.05:
            land += 1
        elif ratio < 0.95:
            por += 1
        else:
            sq += 1
        mp = w * h / 1_000_000
        mps.append(mp)
        mp_counts[next(i for i, (lo, hi) in enumerate(mp_buckets) if mp >= lo and (hi is None or mp < hi))] += 1
        a = near_aspect(ratio)
        aspects[a] = aspects.get(a, 0) + 1
        cam = (e[2] if len(e) > 2 else None)
        if cam is not None and cam >= 0:
            name = cams[cam] if cam < len(cams) else None
            if name:
                entry = cams_agg.setdefault(name, {"count": 0, "mps": []})
                entry["count"] += 1
                entry["mps"].append(mp)

    mps_sorted = sorted(mps)

    def pct(q):
        return round(mps_sorted[min(len(mps_sorted) - 1, max(0, int(q * (len(mps_sorted) - 1))))], 1) if mps_sorted else 0

    cam_rows = sorted(
        ({"camera": name, "images": v["count"], "medianMp": round(sorted(v["mps"])[len(v["mps"]) // 2], 1)}
         for name, v in cams_agg.items()),
        key=lambda x: -x["images"],
    )
    ext_rows = sorted(
        Counter(r[2] for r in imgs).items(), key=lambda kv: -kv[1]
    )

    by_mp = sorted(ex_pairs, key=lambda x: -(x[1][0] * x[1][1]))
    smallest = by_mp[-1] if by_mp else None
    largest = by_mp[0] if by_mp else None

    insights = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "scannedAt": data["meta"]["scannedAt"],
        "totalImages": len(imgs),
        "known": known,
        "coverage": round(known / max(len(imgs), 1) * 100),
        "orientation": {"landscape": land, "portrait": por, "square": sq},
        "resolution": {
            "median": round(mps_sorted[len(mps_sorted) // 2], 1) if mps_sorted else 0,
            "percentiles": {"p10": pct(0.1), "p25": pct(0.25), "p50": pct(0.5), "p75": pct(0.75), "p90": pct(0.9)},
            "buckets": [{"bucket": b, "images": c} for b, c in zip(MP_LABELS, mp_counts)],
        },
        "size": {"buckets": [{"bucket": b, "images": c} for b, c in zip(SIZE_LABELS, size_counts)]},
        "aspects": [{"aspect": a, "count": c} for a, c in
                    sorted(aspects.items(), key=lambda kv: -kv[1])[:6]],
        "exts": {
            "total": len(ext_rows),
            "rows": [{"ext": e, "count": c} for e, c in ext_rows[:9]],
            "othersCount": sum(c for _, c in ext_rows[9:]),
            "othersTypes": len(ext_rows) - 9,
        },
        "cameras": {
            "totalDistinct": len(cams_agg),
            "rows": cam_rows[:8],
            "othersImages": sum(r["images"] for r in cam_rows[8:]),
            "othersDevices": len(cam_rows) - 8,
        },
        "extremes": {
            "smallest": ({"id": smallest[0][0], "name": smallest[0][1],
                          "meta": f"{smallest[1][0]}×{smallest[1][1]} · {smallest[1][0] * smallest[1][1] / 1e6:.2f} MP"}
                         if smallest else None),
            "largest": ({"id": largest[0][0], "name": largest[0][1],
                         "meta": f"{largest[1][0]}×{largest[1][1]} · {largest[1][0] * largest[1][1] / 1e6:.1f} MP"}
                        if largest else None),
            "heaviest": heaviest,
        },
    }

    # the DATA pipeline schedule (daily 06:00 UTC) — the site's sync pill
    # counts down to this, not to the scanner's stale meta value
    version = {
        "scannedAt": data["meta"]["scannedAt"],
        "cron": "0 6 * * *",
        "counts": counts,
        "owners": sorted(owners.keys()),
    }

    with open(os.path.join(OUT, "insights.json"), "w", encoding="utf-8") as f:
        json.dump(insights, f, separators=(",", ":"))
    with open(os.path.join(OUT, "version.json"), "w", encoding="utf-8") as f:
        json.dump(version, f, separators=(",", ":"))

    total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
    print(f"baked {len(os.listdir(OUT))} files → apps/web/public/data ({total/1e6:.2f} MB) in {(time.perf_counter()-t0)*1000:.0f}ms")


if __name__ == "__main__":
    main()
