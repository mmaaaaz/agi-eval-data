#!/usr/bin/env python3
"""
Generate a self-contained interactive HTML dashboard from a Drive scan snapshot.

Usage:
  python make_report.py                 # uses latest snapshot
  python make_report.py snapshots/snapshot_xxx.json
Output: report.html  (open anywhere, works fully offline)
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

MIME_EXT_FALLBACK = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
    "image/heic": "heic", "image/heif": "heif", "image/gif": "gif",
    "image/bmp": "bmp", "image/tiff": "tiff", "image/avif": "avif",
    "video/mp4": "mp4", "video/quicktime": "mov", "video/x-msvideo": "avi",
    "video/webm": "webm", "video/x-matroska": "mkv",
}


def pick_snapshot():
    if len(sys.argv) > 1:
        return Path(sys.argv[1])
    snaps = sorted(Path("snapshots").glob("snapshot_*.json"))
    return snaps[-1]


def ext_of(name, mime):
    if "." in name:
        e = name.rsplit(".", 1)[1].lower()
        if 1 <= len(e) <= 5 and e.isalnum():
            return e
    return MIME_EXT_FALLBACK.get(mime, (mime.split("/")[-1] if "/" in mime else "bin"))[:8]


def main():
    snap_path = pick_snapshot()
    snap = json.loads(snap_path.read_text(encoding="utf-8"))
    files = snap["file_list"]

    # duplicate md5 set (images only, consistent with scanner semantics)
    from collections import Counter
    md5_counts = Counter(f["md5"] for f in files
                         if f.get("md5") and (f.get("mime") or "").startswith("image/"))
    dup_md5 = {k for k, c in md5_counts.items() if c > 1}

    # compact rows: [name, ext, size, day, ownerEmail, md5, kind]  kind: i|v|o
    owners = {}
    rows = []
    for f in files:
        mime = f.get("mime") or ""
        kind = "i" if mime.startswith("image/") else ("v" if mime.startswith("video/") else "o")
        email = f.get("owner") or "unknown"
        if email not in owners:
            owners[email] = ((f.get("ownerName") or email.split("@")[0].replace(".", " ")
                              .replace("_", " ").title()) if email != "unknown" else "Unknown")
        day = (f.get("time") or "")[:10] or "?"
        rows.append([f["name"], ext_of(f["name"], mime), int(f.get("size") or 0),
                     day, email, f.get("md5") or "", kind])

    payload = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "source": snap_path.name,
        "scannedAt": snap.get("scanned_at_utc", ""),
        "owners": owners,
        "rows": rows,
        "dupGroups": [
            {"count": g["count"], "size": g["size"], "names": [x["name"] for x in g["files"]]}
            for g in snap.get("duplicate_groups", [])[:40]
        ],
    }
    blob = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")

    template = Path(__file__).parent / "report_template.html"
    html = template.read_text(encoding="utf-8").replace("__DATA__", blob)
    out = Path(__file__).parent / "report.html"
    out.write_text(html, encoding="utf-8")
    print(f"Dashboard written: {out.resolve()}  ({out.stat().st_size/1024/1024:.2f} MB)")


if __name__ == "__main__":
    main()
