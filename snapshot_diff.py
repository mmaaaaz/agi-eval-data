#!/usr/bin/env python3
"""
Compare two Drive scan snapshots.

Usage:
  python snapshot_diff.py                    # compares the 2 most recent snapshots
  python snapshot_diff.py old.json new.json  # explicit pair
"""

import json
import sys
from pathlib import Path


def load_snapshot(p):
    d = json.loads(Path(p).read_text(encoding="utf-8"))
    files = {f["id"]: f for f in d["file_list"]}
    return d, files


def fmt(n):
    return f"{n:,}"


def human(b):
    for u in ("B", "KB", "MB", "GB", "TB"):
        if abs(b) < 1024:
            return f"{b:.1f} {u}"
        b /= 1024
    return f"{b:.1f} PB"


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    if len(args) == 2:
        pa, pb = Path(args[0]), Path(args[1])
    else:
        snaps = sorted(Path("snapshots").glob("snapshot_*.json"))
        if len(snaps) < 2:
            sys.exit("Need at least two snapshots in ./snapshots — run drive_scan.py again.")
        pa, pb = snaps[-2], snaps[-1]
    print(f"Comparing:\n  OLD: {pa.name}\n  NEW: {pb.name}\n")

    A, fa = load_snapshot(pa)
    B, fb = load_snapshot(pb)

    ids_a, ids_b = set(fa), set(fb)
    added = [fb[i] for i in ids_b - ids_a]
    removed = [fa[i] for i in ids_a - ids_b]
    changed = [
        fb[i] for i in (ids_a & ids_b)
        if (fa[i].get("md5") or fa[i].get("size")) != (fb[i].get("md5") or fb[i].get("size"))
    ]

    sa, sb = A["summary"], B["summary"]

    def delta(label, key, unit=""):
        d = sb[key] - sa[key]
        arrow = "+" if d > 0 else ("-" if d < 0 else "=")
        print(f"  {label:<28} {sb.get(key):>12,}  ({arrow}{abs(d):,}{unit})" if d
              else f"  {label:<28} {sb.get(key):>12,}  (unchanged)")

    print("=" * 62)
    print("WHAT CHANGED")
    print("=" * 62)
    print(f"  Files added                 : {fmt(len(added))}")
    print(f"  Files deleted               : {fmt(len(removed))}")
    print(f"  Files modified (same id)    : {fmt(len(changed))}")
    size_delta = sb["total_bytes"] - sa["total_bytes"]
    print(f"  Size change                 : {'+' if size_delta >= 0 else ''}{human(size_delta)}")
    print("-" * 62)
    print("CATEGORY TOTALS (old -> new)")
    delta("All items", "all_items")
    delta("Images raw", "images_raw")
    delta("Unique images", "images_unique")
    delta("Duplicate copies", "image_duplicate_copies")
    delta("Videos", "videos")
    delta("Google-native", "google_native")
    print("=" * 62)

    def show(title, items, n=15):
        if not items:
            print(f"\n{title}: none")
            return
        print(f"\n{title} ({len(items)}) — showing up to {n}:")
        for f in sorted(items, key=lambda x: -int(x.get("size") or 0))[:n]:
            print(f"   + {f['name'][:70]}  ({human(int(f.get('size') or 0))})")

    show("ADDED", added)
    show("DELETED", removed)
    show("MODIFIED", changed)

    if "--save" in sys.argv:
        out = Path("snapshots") / f"diff_{pb.stem}.json"
        out.write_text(json.dumps({
            "old": pa.name, "new": pb.name,
            "added": added, "removed": removed,
            "changed_ids": [f["id"] for f in changed],
        }, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"\nFull diff saved: {out}")


if __name__ == "__main__":
    main()
