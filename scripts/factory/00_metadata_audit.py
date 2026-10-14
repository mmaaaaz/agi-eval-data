#!/usr/bin/env python3
"""
STAGE 0 — CORPUS HONESTY AUDIT.

TWO CHECKS
----------
A. METADATA — are the recorded dimensions and camera models trustworthy?
B. PROVENANCE — is the corpus actually what the project describes?

Check B exists because describing the corpus as "55,969 uncurated real personal
photographs" turned out to be wrong. Roughly one fifth of the files carry
dataset-asset naming (brown_wooden_chair_0083.jpg, modern_school_building_12.jpg)
and come from exactly one contributor, who has zero camera-named files. Whether
those are 3D renders or stock catalog images cannot be settled from filenames
alone — that needs the pixels — but the naming convention is not photographic
and the claim "all real personal photographs" is not supportable.

STAGE 0A — METADATA HONESTY AUDIT.

Run this before you write a single sentence about resolution or camera.

WHAT IT CHECKS
--------------
The Drive scanner records width/height and (when present) a camera model from
each file's EXIF block. Those numbers look authoritative and are not. This
script measures how far they can be trusted.

WHY THIS EXISTS
---------------
An early draft of the project described the corpus as "median 2.8 MP with a
14.6% sub-1-MP tail and 32 camera models". That description was wrong. This
script is what proved it, and it is kept in the repo so the correction is
reproducible rather than asserted.

Usage:
    python scripts/factory/00_metadata_audit.py
    python scripts/factory/00_metadata_audit.py --json
"""
from __future__ import annotations

import argparse
import collections
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "data" / "latest.json"
WEB = ROOT / "apps" / "web" / "public" / "data" / "insights.json"

# Google Drive / iCloud-optimised-storage / messaging-app pipelines commonly
# leave images at this exact long edge. A hard spike here means the metadata is
# describing a STORED artefact, not the camera's capture.
THUMBNAIL_LONG_EDGES = {1568, 2048, 1600, 640, 480}


import collections
import re

DESCRIPTIVE = re.compile(r"^[a-z]+(?:_[a-z]+){1,6}_\d+\.(jpg|jpeg|png|webp)$")
CAMERA = re.compile(r"^(IMG|DSC|PANO|SCN|DCIM|WhatsApp|Screenshot|P\d)", re.I)
PROGRAMMATIC = re.compile(r"^\d+_\d{10,}_\d+\.(jpg|jpeg|png|webp)$")


def classify(name: str) -> str:
    if DESCRIPTIVE.match(name):
        return "A_descriptive_asset"
    if CAMERA.match(name):
        return "B_camera_or_phone"
    if PROGRAMMATIC.match(name):
        return "C_programmatic"
    return "D_other"


def provenance(rows, owners, cams) -> dict:
    """Filename-semantics profile. A heuristic, labelled as one."""
    by_owner = collections.defaultdict(collections.Counter)
    totals = collections.Counter()
    global_cls = collections.Counter()
    for fid, name, ext, size, day, owner, md5, kind in rows:
        if kind != "i":
            continue
        o = owners.get(owner, "?")
        c = classify(name)
        totals[o] += 1
        by_owner[o][c] += 1
        global_cls[c] += 1

    lines = []
    lines.append("")
    lines.append(f"{'contributor':<24}{'images':>8}{'A_asset':>9}{'B_camera':>10}{'C_prog':>8}{'A %':>8}")
    for o in sorted(totals, key=lambda x: -totals[x]):
        t = totals[o]
        b = by_owner[o]
        lines.append(f"{o:<24}{t:>8,}{b['A_descriptive_asset']:>9,}"
                     f"{b['B_camera_or_phone']:>10,}{b['C_programmatic']:>8,}"
                     f"{b['A_descriptive_asset']/t*100:>7.1f}%")
    lines.append("")
    n = sum(totals.values())
    for c, v in sorted(global_cls.items()):
        lines.append(f"  {c:<24}{v:>8,}  ({v/n*100:5.2f}%)")
    lines.append("")
    lines.append("KEY: any contributor whose A% is ~100 and B_camera is 0 contributed a")
    lines.append("     single homogeneous non-photographic asset set, not a camera roll.")
    return {"lines": lines,
            "summary": (f"{global_cls['A_descriptive_asset']:,} files ({100*global_cls['A_descriptive_asset']/n:.1f}%) "
                        f"use dataset-asset naming; camera/phone filenames are only "
                        f"{global_cls['B_camera_or_phone']:,} ({100*global_cls['B_camera_or_phone']/n:.1f}%)"),
            "by_class": dict(global_cls)}


def decode_sample(sample_n: int, seed: int, ledger: Path) -> dict:
    """Fetch and DECODE images, then compare the ledger's dimensions and byte size.

    THE CHECK THIS SCRIPT HAS ALWAYS DEMANDED AND NEVER PERFORMED.

    The recommended wording at the bottom of this file tells authors to write that
    resolution was "verified against the decoded image bytes for the release subset".
    Until this function existed, that sentence described nothing — a claim in the
    paper's own instructions with no check behind it.

    It costs nothing: fetching bytes from the CDN is not model inference. The sample is
    stratified so the RARE bands are actually looked at, because a uniform sample of 40
    from a corpus that is 80% one band would check that band and almost nothing else.
    """
    import io
    import random
    import urllib.request

    if not ledger.exists():
        return {"error": "no ledger at " + str(ledger) + " — run 00_provenance.py first",
                "checked": 0, "mismatches": []}

    rows = []
    for line in ledger.read_text(encoding="utf-8-sig").splitlines():
        if not line.strip():
            continue
        o = json.loads(line)
        if "_schema" in o:
            continue
        if o.get("r") == 1 and o.get("w") and o.get("h") and o.get("i"):
            rows.append(o)
    if not rows:
        return {"error": "the ledger has no releasable rows with dimensions",
                "checked": 0, "mismatches": []}

    def band(r):
        mp = r["w"] * r["h"] / 1e6
        return ("<1 MP" if mp < 1 else "1-4 MP" if mp < 4 else "4-12 MP" if mp < 12
                else "12-24 MP" if mp < 24 else "24+ MP")

    by_band = collections.defaultdict(list)
    for r in rows:
        by_band[band(r)].append(r)

    rnd = random.Random(seed)
    chosen, seen = [], set()
    # round-robin across bands, so every band gets checked before any band gets a second
    pools = {}
    for b, pool in by_band.items():
        pool = sorted(pool, key=lambda r: r["i"])
        rnd.shuffle(pool)
        pools[b] = pool
    i = 0
    while len(chosen) < sample_n and any(i < len(p) for p in pools.values()):
        for b in sorted(pools):
            if i < len(pools[b]) and len(chosen) < sample_n:
                r = pools[b][i]
                if r["i"] not in seen:
                    seen.add(r["i"])
                    chosen.append(r)
        i += 1

    # =s0 returns the STORED ORIGINAL. The bare URL (and =w{budget}) returns a CDN
    # resize: a 6000x4000 file comes back as 1600x1067 with no parameter, which would
    # make every large image look like a metadata error. Measured, not assumed.
    template = "https://lh3.googleusercontent.com/d/{file_id}=s0"
    checked = matched = size_matched = transposed = 0
    mismatches, failures = [], []
    band_counts = collections.Counter()
    for r in chosen:
        band_counts[band(r)] += 1
        try:
            req = urllib.request.Request(template.format(file_id=r["i"]),
                                         headers={"User-Agent": "benchmark-audit/1.0"})
            with urllib.request.urlopen(req, timeout=45) as resp:
                data = resp.read()
        except Exception as e:
            failures.append({"file_id": r["i"], "error": type(e).__name__ + " " + str(e)[:80]})
            continue
        try:
            from PIL import Image
            with Image.open(io.BytesIO(data)) as im:
                dw, dh = im.size
        except Exception as e:
            failures.append({"file_id": r["i"], "error": "decode: " + type(e).__name__})
            continue
        checked += 1
        if (dw, dh) == (r["w"], r["h"]):
            matched += 1
        elif (dh, dw) == (r["w"], r["h"]):
            # TRANSPOSED, not wrong. The megapixel count is unchanged, so a resolution
            # band is unaffected — but an ORIENTATION classification from these numbers
            # is inverted, and the selection reports an orientation balance.
            transposed += 1
            mismatches.append({"file_id": r["i"], "ledger": [r["w"], r["h"]],
                               "decoded": [dw, dh], "transposed": True,
                               "name": r.get("n", "")[:48]})
        else:
            mismatches.append({"file_id": r["i"], "ledger": [r["w"], r["h"]],
                               "decoded": [dw, dh], "transposed": False,
                               "name": r.get("n", "")[:48]})
        if r.get("b") and len(data) == r["b"]:
            size_matched += 1

    return {
        "checked": checked,
        "dimensions_match": matched,
        "dimensions_match_pct": round(100 * matched / checked, 1) if checked else 0.0,
        "transposed": transposed,
        "bytes_match": size_matched,
        "bytes_match_pct": round(100 * size_matched / checked, 1) if checked else 0.0,
        "by_band": dict(band_counts),
        "mismatches": mismatches[:20],
        "failures": failures[:20],
        "n_failures": len(failures),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--decode-sample", type=int, default=0, metavar="N",
                    help="fetch and DECODE N images, then compare dimensions and byte size "
                         "against the ledger. Off by default so the audit stays offline. "
                         "Costs nothing: this is bytes, not inference.")
    ap.add_argument("--seed", type=int, default=20261005)
    ap.add_argument("--ledger", default=str(ROOT / "data" / "factory" / "provenance.jsonl"))
    args = ap.parse_args()

    d = json.loads(SRC.read_text(encoding="utf-8-sig"))
    exif = d.get("exif", {})
    cams = d.get("cams", [])

    entries = list(exif.values())
    n = len(entries)
    with_cam = [e for e in entries if len(e) > 2]
    long_edge = [max(e[0], e[1]) for e in entries]
    mp = [e[0] * e[1] / 1e6 for e in entries]

    exact = collections.Counter(long_edge)
    suspicious = sum(v for k, v in exact.items() if k in THUMBNAIL_LONG_EDGES)
    at1568 = exact.get(1568, 0)

    bands = collections.Counter()
    for m in mp:
        bands["<1 MP" if m < 1 else "1-4 MP" if m < 4 else
              "4-12 MP" if m < 12 else "12-24 MP" if m < 24 else "24+ MP"] += 1

    mp_sorted = sorted(mp)
    median = mp_sorted[n // 2]

    # Does the camera-bearing subset agree with the camera-bearing-free subset?
    cam_mp = sorted(e[0] * e[1] / 1e6 for e in with_cam)
    cam_median = cam_mp[len(cam_mp) // 2] if cam_mp else float("nan")

    report = {
        "images_with_exif": n,
        "images_with_camera_model": len(with_cam),
        "camera_coverage_pct": round(100 * len(with_cam) / n, 2),
        "distinct_cameras_listed": len(cams),
        "median_mp_from_metadata": round(median, 2),
        "median_mp_camera_bearing_only": round(cam_median, 2),
        "long_edge_1568_count": at1568,
        "long_edge_1568_pct": round(100 * at1568 / n, 1),
        "long_edge_on_known_pipeline_values_pct": round(100 * suspicious / n, 1),
        "band_histogram_from_metadata": dict(bands),
        "verdict": None,
    }

    if at1568 / n > 0.5:
        report["verdict"] = (
            f"UNRELIABLE: {100*at1568/n:.0f}% of images report a long edge of exactly "
            f"1568 px, a pipeline artefact rather than a capture resolution."
        )
    elif len(with_cam) / n < 0.05:
        report["verdict"] = (
            f"SPARSE: only {100*len(with_cam)/n:.1f}% of images carry a camera model; "
            f"camera stratification is not available at corpus scale."
        )

    if args.json:
        print(json.dumps(report, indent=2))
        return

    print("=" * 68)
    print("METADATA HONESTY AUDIT")
    print("=" * 68)
    print(f"\nimages with EXIF dimensions      : {n:,}")
    print(f"images with a CAMERA model       : {len(with_cam):,} "
          f"({report['camera_coverage_pct']}%)")
    print(f"distinct cameras listed          : {len(cams)}")
    print(f"\nmedian megapixels (metadata)    : {report['median_mp_from_metadata']}")
    print(f"median MP, camera-bearing only   : {report['median_mp_camera_bearing_only']}")
    print(f"\nlong edge == 1568 px            : {at1568:,} ({report['long_edge_1568_pct']}%)")
    print(f"on a known pipeline value        : {report['long_edge_on_known_pipeline_values_pct']}%")
    print("\nband histogram computed from metadata:")
    for b in ["<1 MP", "1-4 MP", "4-12 MP", "12-24 MP", "24+ MP"]:
        print(f"  {b:9} {bands.get(b,0):>7,}")
    print(f"\n{'='*68}")
    print("PROVENANCE AUDIT  (B)")
    print("=" * 68)
    prov = provenance(d['files'], d.get('owners', {}), cams)
    for line in prov["lines"]:
        print(line)
    report["provenance"] = prov["summary"]
    print(f"\nVERDICT (A): {report['verdict']}")
    print(f"VERDICT (B): {prov['summary']}")

    # ---- the decode check, the one this file has always said was required --------
    if args.decode_sample > 0:
        print("\n" + "=" * 68)
        print("DECODE CHECK  (are the recorded dimensions real?)")
        print("=" * 68)
        dc = decode_sample(args.decode_sample, args.seed, Path(args.ledger))
        if dc.get("error"):
            print("  cannot run: " + dc["error"])
            report["decode_check"] = dc
        else:
            print("  fetched and decoded : " + str(dc["checked"]))
            print("  dimensions match    : " + str(dc["dimensions_match"])
                  + "  (" + format(dc["dimensions_match_pct"], ".1f") + "%)")
            print("  byte size matches   : " + str(dc["bytes_match"])
                  + "  (" + format(dc["bytes_match_pct"], ".1f") + "%)")
            if dc.get("transposed"):
                print("  TRANSPOSED w/h      : " + str(dc["transposed"])
                      + "   <- orientation from this ledger is INVERTED for these")
            print("  coverage by band    : " + json.dumps(dc["by_band"], sort_keys=True))
            if dc["mismatches"]:
                print("  MISMATCHES:")
                for m in dc["mismatches"]:
                    tag = "  TRANSPOSED" if m.get("transposed") else "  WRONG"
                    print("    " + str(m["file_id"])[:14] + "  ledger " + str(m["ledger"])
                          + "  decoded " + str(m["decoded"]) + tag + "  " + m.get("name", ""))
            if dc["n_failures"]:
                print("  fetch/decode failures: " + str(dc["n_failures"]))
                for fl in dc["failures"][:5]:
                    print("    " + str(fl["file_id"])[:14] + "  " + fl["error"])
            if dc["checked"] == 0:
                print()
                print("  NOTHING WAS VERIFIED. No network, or every fetch failed. Treat the")
                print("  resolution numbers above as metadata-grade, which is what they are.")
            else:
                wrong = [m for m in dc["mismatches"] if not m.get("transposed")]
                print()
                if not wrong:
                    print("  VERDICT: the ledger is ACCURATE UP TO TRANSPOSITION. Every mismatch")
                    print("  is a pure w/h swap, so the megapixel count is unaffected and a")
                    print("  RESOLUTION band is trustworthy. An ORIENTATION classification from")
                    print("  these numbers is inverted for "
                          + format(100 * dc["transposed"] / max(dc["checked"], 1), ".0f") + "% of images.")
                    print("  Do not report an orientation balance from this ledger.")
                else:
                    print("  VERDICT: the ledger is WRONG, not merely transposed, for "
                          + str(len(wrong)) + " image(s).")
                    print("  Do not quote a resolution figure until that is resolved.")
            if dc["checked"] and dc["bytes_match"] == dc["checked"] and dc["transposed"]:
                print()
                print("  note: byte sizes all matched, so these are the stored files — the")
                print("  dimensions differ only in the order they are written.")
            report["decode_check"] = dc
    else:
        print("\n  (decode check skipped: pass --decode-sample N to verify dimensions")
        print("   against the actual bytes. Off by default so this audit runs offline.)")

    print("\n" + "-" * 68)
    print("WHAT THIS MEANS FOR THE PAPER")
    print("-" * 68)
    print("""
DO NOT write:
  "median 2.8 MP, 14.6% below 1 MP, 32 camera models"

Those numbers come from this metadata and from a September snapshot of it.
They describe how the files are STORED, not what the cameras captured.

DO write:
  "55,969 uncurated photographs whose capture-resolution metadata survives on
   only 1% of files; the observable resolution distribution is dominated by
   the storage pipeline (68% report a 1568 px long edge), so resolution is
   treated as a STORAGE attribute and verified against the decoded image
   bytes for the release subset."

CONSEQUENCES:
  1. Any resolution claim requires downloading bytes and measuring the decoded
     image. Metadata alone cannot support it.
  2. Camera stratification at corpus scale is impossible. If you want the
     camera/ISP axis, restrict it to the 566 EXIF-bearing files and present
     it as a small sub-study, not a headline result.
  3. The "sub-1 MP" stratum is not a low-quality stratum. It is most likely a
     messaging-app or optimised-storage artefact, and those images may look
     perfectly sharp. Verify before building an experiment on them.
  4. This is a publishable data-quality finding in its own right, and it is the
     kind of audit that earns a benchmark's credibility.
""")


if __name__ == "__main__":
    raise SystemExit(main())