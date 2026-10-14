#!/usr/bin/env python3
"""
STAGE 00 — PROVENANCE AND RELEASE LEDGER.

WHAT THIS PRODUCES
------------------
One row per image recording where it came from, and whether its FILENAME
PROVENANCE blocks it from release. Plus a summary that answers the only question
that matters before anyone writes a question:

    how many of the corpus can we legally release?

WHY IT RUNS FIRST
-----------------
Every downstream stage is sized by this number. If a fifth of the corpus is a
single contributor's dataset-asset set with unknown rights, the benchmark is
smaller than the plan assumes, and finding that out after people have spent
hundreds of hours authoring is the most expensive mistake available.

WHAT release_ok DOES AND DOES NOT MEAN
--------------------------------------
release_ok = 1 means "the filename does not mark this as someone else's dataset".
It does NOT mean the image is cleared. Three gates remain, and none of them is
software:

  1. CONSENT      — a recorded right to redistribute, per image
  2. PII          — faces and plates reviewed; GPS stripped
  3. TRUE DECODE  — resolution measured from decoded bytes, not from metadata

The ledger records all three as unchecked. Do not read release_ok as permission.

Usage:
    python scripts/factory/00_provenance.py
    python scripts/factory/00_provenance.py --json
    python scripts/factory/00_provenance.py --overrides data/factory/provenance_overrides.json
"""
from __future__ import annotations

import argparse
import collections
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "data" / "latest.json"
OUT_DIR = ROOT / "data" / "factory"
LEDGER = OUT_DIR / "provenance.jsonl"
SUMMARY = OUT_DIR / "provenance_summary.json"
DEFAULT_OVERRIDES = OUT_DIR / "provenance_overrides.json"

# Deliberately the same tests the honesty audit used, so the two agree.
DESCRIPTIVE = re.compile(r"^[a-z]+(?:_[a-z]+){1,6}_\d+\.(jpg|jpeg|png|webp)$")
CAMERA = re.compile(r"^(IMG|DSC|PANO|SCN|DCIM|WhatsApp|Screenshot|P\d)", re.I)
PROGRAMMATIC = re.compile(r"^\d+_\d{10,}_\d+\.(jpg|jpeg|png|webp)$")

TIER_CODES = ("asset", "camera", "programmatic", "other")

# The default policy. An asset-named file is presumed NOT ours until a person
# says otherwise; everything else is presumed releasable pending consent.
DEFAULT_RELEASE_OK = {"asset": 0, "camera": 1, "programmatic": 1, "other": 1}


def classify(name: str) -> str:
    if DESCRIPTIVE.match(name):
        return "asset"
    if CAMERA.match(name):
        return "camera"
    if PROGRAMMATIC.match(name):
        return "programmatic"
    return "other"


def read_json(path: Path):
    """Read JSON tolerating a UTF-8 byte-order mark.

    PowerShell's Set-Content -Encoding utf8, Notepad and most Windows editors all
    write a BOM, and Python's plain utf-8 codec rejects it. A hand-edited overrides
    file is exactly the kind of file that will arrive with one, so this must not be
    the reason a person cannot record a decision.
    """
    return json.loads(path.read_text(encoding="utf-8-sig"))


def load_overrides(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        raw = read_json(path)
    except Exception as e:
        print("overrides file is not valid JSON: " + str(e), file=sys.stderr)
        print("expected an object keyed by file_id, e.g.", file=sys.stderr)
        print('  {"1zHdfv...": {"release_ok": 1, "by": "you", "reason": "written permission"}}', file=sys.stderr)
        raise SystemExit(2)
    if not isinstance(raw, dict):
        print("overrides must be an object keyed by file_id", file=sys.stderr)
        raise SystemExit(2)
    return raw


def duplicate_copies(d: dict) -> dict:
    """Map file_id -> True for every copy that is NOT the canonical one.

    duplicates.csv already prunes these, but they are still in the corpus, and a
    planning number that counts them twice would overstate the benchmark by 215
    images. Canonical = largest byte size, ties broken by file_id, so the choice is
    deterministic and survives a re-run.
    """
    groups: dict[str, list[tuple[str, int]]] = {}
    for fid, name, ext, size, day, owner, md5, kind in d.get("files", []):
        if kind != "i" or not md5:
            continue
        groups.setdefault(md5, []).append((fid, int(size or 0)))
    copies: dict[str, bool] = {}
    for md5, members in groups.items():
        if len(members) < 2:
            continue
        members.sort(key=lambda t: (-t[1], str(t[0])))
        for fid, _ in members[1:]:
            copies[fid] = True
    return copies


def build(d: dict, overrides: dict) -> tuple[list[dict], dict]:
    owners = d.get("owners", {})
    dups = duplicate_copies(d)
    rows: list[dict] = []
    for fid, name, ext, size, day, owner, md5, kind in d["files"]:
        if kind != "i":
            continue
        tier = classify(name)
        rec = {
            "file_id": fid,
            "name": name,
            "ext": ext,
            "bytes": size,
            "owner": owners.get(owner, owner.split("@")[0]),
            "tier": tier,
            "has_exif": False,
            "camera": None,
            "w": None,
            "h": None,
            "true_mp": None,
            "decoded_from_bytes": False,
            "pii": "unchecked",
            "consent": "unchecked",
            "release_ok": DEFAULT_RELEASE_OK[tier],
            "duplicate_copy": bool(dups.get(fid)),
            "override": None,
        }
        ex = d.get("exif", {}).get(fid)
        if isinstance(ex, list) and len(ex) >= 2 and ex[0] and ex[1]:
            rec["w"], rec["h"] = int(ex[0]), int(ex[1])
            rec["has_exif"] = True
            if len(ex) > 2 and ex[2]:
                rec["camera"] = str(ex[2])
        # A human decision always wins, and is recorded with its reason.
        ov = overrides.get(fid)
        if isinstance(ov, dict):
            if "tier" in ov and ov["tier"] in TIER_CODES:
                rec["tier"] = ov["tier"]
            if "release_ok" in ov:
                rec["release_ok"] = 1 if ov["release_ok"] else 0
            rec["override"] = {
                "by": str(ov.get("by", "")),
                "at": str(ov.get("at", "")),
                "reason": str(ov.get("reason", "")),
            }
        rows.append(rec)

    rows.sort(key=lambda r: str(r["file_id"]))

    total = len(rows)
    by_tier = collections.Counter(r["tier"] for r in rows)
    released = sum(1 for r in rows if r["release_ok"] == 1)
    blocked_asset = sum(1 for r in rows if r["release_ok"] == 0)
    asset_owners = collections.Counter(r["owner"] for r in rows if r["tier"] == "asset")

    dup_copies = sum(1 for r in rows if r["duplicate_copy"])
    # The number to plan with: releasable AND not a redundant copy.
    usable = sum(1 for r in rows if r["release_ok"] == 1 and not r["duplicate_copy"])

    summary = {
        "images": total,
        "duplicate_copies": dup_copies,
        "images_after_dedup": total - dup_copies,
        "usable_images": usable,
        "usable_pct": round(100 * usable / total, 2) if total else 0.0,
        "release_ok_true": released,
        "release_ok_false": blocked_asset,
        "potentially_releasable_pct": round(100 * released / total, 2) if total else 0.0,
        "by_tier": dict(sorted(by_tier.items())),
        "blocked_by_tier": {
            "asset": by_tier.get("asset", 0),
        },
        "asset_concentration": dict(asset_owners.most_common(5)),
        "asset_contributors": len(asset_owners),
        "overrides_applied": sum(1 for r in rows if r["override"]),
        "measured_from_bytes": 0,
        "gates_still_open": ["consent", "pii", "true_decode"],
        "note": (
            "release_ok marks only whether the FILENAME provenance blocks release. "
            "It is not permission: consent, PII review and a decode-based resolution "
            "measurement are separate gates, all still unchecked."
        ),
    }
    return rows, summary


# Short keys keep the committed ledger from being mostly repeated field names.
# Anything constant across rows (true_mp, decoded_from_bytes, pii, consent) lives in
# the header rather than being repeated 56,000 times.
LEDGER_SCHEMA = {
    "i": "file_id",
    "n": "name",
    "t": "tier: asset|camera|programmatic|other",
    "b": "bytes",
    "o": "owner display name",
    "w": "stored width from metadata",
    "h": "stored height from metadata",
    "c": "camera model, omitted when absent",
    "r": "release_ok: 1 unless the filename provenance blocks release",
    "d": "1 when this is a redundant duplicate copy, omitted otherwise",
    "ov": "human override {by, at, reason}, omitted otherwise",
    "_constants": {
        "true_mp": None,
        "decoded_from_bytes": False,
        "has_exif": "w and h present",
        "pii": "unchecked",
        "consent": "unchecked",
    },
}


def compact(r: dict) -> dict:
    out = {
        "i": r["file_id"],
        "n": r["name"],
        "t": r["tier"],
        "b": r["bytes"],
        "o": r["owner"],
        "w": r["w"],
        "h": r["h"],
        "r": r["release_ok"],
    }
    if r.get("camera"):
        out["c"] = r["camera"]
    if r.get("duplicate_copy"):
        out["d"] = 1
    if r.get("override"):
        out["ov"] = r["override"]
    return out


def write_ledger(rows: list[dict], summary: dict) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # Compact per-image JSONL: greppable, diffable, and small enough to commit.
    with LEDGER.open("w", encoding="utf-8") as fh:
        fh.write(json.dumps({"_schema": LEDGER_SCHEMA}, separators=(",", ":")) + "\n")
        for r in rows:
            fh.write(json.dumps(compact(r), sort_keys=True, separators=(",", ":")) + "\n")
    SUMMARY.write_text(json.dumps(summary, indent=1, sort_keys=True) + "\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description="Build the provenance and release ledger (stage 00).")
    ap.add_argument("--src", default=str(SRC))
    ap.add_argument("--overrides", default=str(DEFAULT_OVERRIDES))
    ap.add_argument("--json", action="store_true", help="print the summary only")
    ap.add_argument("--no-write", action="store_true", help="report without writing the ledger")
    args = ap.parse_args()

    src = Path(args.src)
    if not src.exists():
        print("corpus ledger not found: " + str(src), file=sys.stderr)
        return 2
    d = read_json(src)
    overrides = load_overrides(Path(args.overrides))
    rows, summary = build(d, overrides)

    if not args.no_write:
        write_ledger(rows, summary)

    if args.json:
        print(json.dumps(summary, indent=2, sort_keys=True))
        return 0

    print("=" * 68)
    print("PROVENANCE AND RELEASE LEDGER  (stage 00)")
    print("=" * 68)
    print()
    print("  images in corpus            : {:>7,}".format(summary["images"]))
    print("  potentially releasable      : {:>7,}  ({:.1f}%)".format(
        summary["release_ok_true"], summary["potentially_releasable_pct"]))
    print("  blocked by filename         : {:>7,}".format(summary["release_ok_false"]))
    print("  duplicate copies            : {:>7,}".format(summary["duplicate_copies"]))
    print()
    print("  ------------------------------------------------------------------")
    print("  PLAN WITH THIS NUMBER: {:>7,} usable images  ({:.1f}%)".format(
        summary["usable_images"], summary["usable_pct"]))
    print("  ------------------------------------------------------------------")
    print()
    print("  by tier:")
    for t in TIER_CODES:
        n = summary["by_tier"].get(t, 0)
        if n:
            print("    {:<14}{:>7,}   release_ok default = {}".format(t, n, DEFAULT_RELEASE_OK[t]))
    print()
    if summary["asset_contributors"]:
        print("  the blocked set is concentrated:")
        for who, n in list(summary["asset_concentration"].items())[:5]:
            print("    {:<22}{:>7,}".format(str(who)[:22], n))
        print("    contributors involved: {}   <- one contributor with 100% asset naming".format(
            summary["asset_contributors"]) if summary["asset_contributors"] == 1
              else "    contributors involved: {}".format(summary["asset_contributors"]))
    print()
    print("  overrides applied           : {:>7,}".format(summary["overrides_applied"]))
    print("  resolution measured from bytes: 0  <- metadata only, unverified")
    print()
    print("-" * 68)
    print("release_ok MEANS ONE THING ONLY")
    print("-" * 68)
    print("""  It means the FILENAME does not mark the file as someone else's dataset.
  It is NOT permission to publish. Three gates remain open, and none is software:

    1. CONSENT      a recorded right to redistribute, per image
    2. PII          faces and plates reviewed; GPS stripped
    3. TRUE DECODE  resolution measured from decoded bytes

  Until 1 and 2 have a ledger of their own, the releasable number is an UPPER
  BOUND, not an answer.""")
    print()
    if not args.no_write:
        print("  ledger  : " + str(LEDGER.relative_to(ROOT)))
        print("  summary : " + str(SUMMARY.relative_to(ROOT)))
        print("  overrides: " + str(Path(args.overrides).relative_to(ROOT)) + "   (create it to record a human decision)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
