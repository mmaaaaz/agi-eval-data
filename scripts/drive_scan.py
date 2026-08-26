#!/usr/bin/env python3
"""
Google Drive metadata scanner.
Counts images, excludes videos, detects exact duplicates via MD5 checksums.
Downloads METADATA ONLY (~few MB per full scan), never file contents.

Usage:
  python drive_scan.py              # scan whole Drive, print report, save snapshot
  python drive_scan.py --csv dups   # also write duplicate groups to dups.csv
"""

import argparse
import csv
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

SCOPES = ["https://www.googleapis.com/auth/drive.metadata.readonly"]  # read-only!
CLIENT_SECRET = "client_secret.json"
TOKEN_FILE = "token.json"
SNAPSHOT_DIR = Path("snapshots")

FIELDS = ("nextPageToken, files(id,name,mimeType,size,md5Checksum,createdTime,trashed,"
          "shared,owners(displayName,emailAddress),"
          "imageMediaMetadata(width,height,cameraMake,cameraModel))")

MIME_EXT_FALLBACK = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
    "image/heic": "heic", "image/heif": "heif", "image/gif": "gif",
    "image/bmp": "bmp", "image/tiff": "tiff", "image/avif": "avif",
    "video/mp4": "mp4", "video/quicktime": "mov", "video/x-msvideo": "avi",
}


def ext_of(name: str, mime: str) -> str:
    if "." in name:
        e = name.rsplit(".", 1)[1].lower()
        if 1 <= len(e) <= 5 and e.isalnum():
            return e
    return MIME_EXT_FALLBACK.get(mime, (mime.split("/")[-1] if "/" in mime else "bin"))[:8]


def get_service():
    """Authorize once; token is cached in token.json for future runs."""
    creds = None
    if Path(TOKEN_FILE).exists():
        creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(CLIENT_SECRET, SCOPES)
            creds = flow.run_local_server(port=0)  # opens your browser
        Path(TOKEN_FILE).write_text(creds.to_json())
    return build("drive", "v3", credentials=creds)


def list_all_files(service):
    """Recursively list every non-trashed file's metadata. Handles paging + rate limits."""
    all_files = []
    page_token = None
    pages = 0
    while True:
        for attempt in range(6):
            try:
                resp = (
                    service.files()
                    .list(
                        q="trashed = false",
                        pageSize=1000,
                        fields=FIELDS,
                        pageToken=page_token,
                        supportsAllDrives=True,           # shared drives too
                        includeItemsFromAllDrives=True,
                    )
                    .execute()
                )
                break
            except HttpError as e:
                if e.resp.status in (429, 500, 503) and attempt < 5:
                    wait = 2 ** attempt * 2
                    print(f"  rate limited, retrying in {wait}s...", flush=True)
                    time.sleep(wait)
                else:
                    raise
        batch = resp.get("files", [])
        all_files.extend(batch)
        pages += 1
        print(f"  ...{len(all_files)} files listed ({pages} pages)", flush=True)
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return all_files


def human(nbytes):
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if nbytes < 1024:
            return f"{nbytes:.1f} {unit}"
        nbytes /= 1024
    return f"{nbytes:.1f} PB"


def analyze(files):
    buckets = {"images": [], "videos": [], "gdocs": [], "others": []}
    for f in files:
        mt = f.get("mimeType", "")
        if mt.startswith("image/"):
            buckets["images"].append(f)
        elif mt.startswith("video/"):
            buckets["videos"].append(f)
        elif mt.startswith("application/vnd.google-apps"):
            buckets["gdocs"].append(f)  # native Google Docs/Sheets/etc., not binaries
        else:
            buckets["others"].append(f)

    def dup_report(items):
        by_md5 = {}
        for f in items:
            md5 = f.get("md5Checksum")
            if md5:  # native Google files have no checksum -> skipped
                by_md5.setdefault(md5, []).append(f)
        groups = {k: v for k, v in by_md5.items() if len(v) > 1}
        extra = sum(len(v) - 1 for v in groups.values())
        wasted = sum(int(v[0].get("size") or 0) * (len(v) - 1) for v in groups.values())
        return {
            "total": len(items),
            "unique": len(by_md5),
            "duplicate_copies": extra,
            "wasted_bytes": wasted,
            "groups": [
                {"md5": k, "count": len(v),
                 "size": int(v[0].get("size") or 0),
                 "files": [{"id": x["id"], "name": x["name"],
                            "folder_hint": x.get("parents", [])} for x in v]}
                for k, v in sorted(groups.items(), key=lambda kv: -int(kv[1][0].get("size") or 0))
            ],
        }

    reports = {k: dup_report(v) for k, v in (("images", buckets["images"]), ("videos", buckets["videos"]))}
    return buckets, reports


def headless_credentials():
    """CI mode: refresh-token flow, no browser."""
    cid, sec, rt = (os.environ.get(k, "") for k in
                    ("DRIVE_CLIENT_ID", "DRIVE_CLIENT_SECRET", "DRIVE_REFRESH_TOKEN"))
    if not (cid and sec and rt):
        sys.exit("--ci requires DRIVE_CLIENT_ID, DRIVE_CLIENT_SECRET, DRIVE_REFRESH_TOKEN env vars")
    return Credentials(
        token=None, refresh_token=rt,
        token_uri="https://oauth2.googleapis.com/token", client_id=cid, client_secret=sec,
        scopes=["https://www.googleapis.com/auth/drive.metadata.readonly"],
    )


def build_ci_payload(files, reports, buckets):
    """v3 contract consumed by the web app. Rows: [id,name,ext,size,day,email,md5,kind]."""
    owners = {}
    rows = []
    cams: list[str] = []
    cam_idx: dict[str, int] = {}
    exif: dict[str, list[int]] = {}
    for f in files:
        mime = f.get("mimeType") or ""
        kind = "i" if mime.startswith("image/") else ("v" if mime.startswith("video/") else "o")
        o = (f.get("owners") or [{}])[0]
        email = o.get("emailAddress") or "unknown"
        owners.setdefault(email, o.get("displayName") or
                          (email.split("@")[0].replace(".", " ").replace("_", " ").title()))
        rows.append([f["id"], f["name"], ext_of(f["name"], mime), int(f.get("size") or 0),
                     (f.get("createdTime") or "")[:10], email,
                     f.get("md5Checksum") or f.get("md5") or "", kind])
        if kind == "i":
            im = f.get("imageMediaMetadata") or {}
            w, h = im.get("width"), im.get("height")
            if w and h:
                entry = [int(w), int(h)]
                cam = (im.get("cameraModel") or im.get("cameraMake") or "").strip()
                if cam:
                    if cam not in cam_idx:
                        cam_idx[cam] = len(cams)
                        cams.append(cam)
                    entry.append(cam_idx[cam])
                exif[f["id"]] = entry
    dup_groups = [{
        "md5": g["md5"], "count": g["count"], "size": g["size"],
        "names": [x["name"] for x in g["files"]][:10],
    } for g in reports["images"]["groups"]]
    img, _vid = reports["images"], reports["videos"]
    return {
        "version": 3,
        "meta": {
            "scannedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "cron": "0 6 * * *",
            "counts": {
                "all": len(files), "imagesRaw": img["total"], "imagesUnique": img["unique"],
                "dupCopies": img["duplicate_copies"], "videos": len(buckets["videos"]),
                "bytes": sum(int(f.get("size") or 0) for f in files),
            },
        },
        "files": rows, "owners": owners, "dupGroups": dup_groups,
        "cams": cams, "exif": exif,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", metavar="PATH", help="also export duplicate groups to CSV")
    ap.add_argument("--ci", action="store_true", help="headless auth + write data/latest.json")
    ap.add_argument("--from-snapshot", metavar="PATH",
                    help="build CI artifact offline from an existing snapshot JSON")
    args = ap.parse_args()

    if args.from_snapshot:
        snap = json.loads(Path(args.from_snapshot).read_text(encoding="utf-8"))
        fl = snap["file_list"]
        files = [{"id": f["id"], "name": f["name"], "mimeType": f.get("mime") or "",
                  "size": f.get("size") or "0", "md5Checksum": f.get("md5") or "",
                  "createdTime": (f.get("time") or "") + "Z" if f.get("time") else "",
                  "owners": ([{"emailAddress": f["owner"],
                               "displayName": f.get("ownerName") or ""}] if f.get("owner") else [])}
                 for f in fl]
        buckets, reports = analyze(files)
        out = Path("data/latest.json")
        out.parent.mkdir(exist_ok=True)
        out.write_text(json.dumps(build_ci_payload(files, reports, buckets),
                                  ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        c = json.loads(out.read_text(encoding="utf-8"))["meta"]["counts"]
        print(f"CI artifact written: {out} ({out.stat().st_size/1024:.0f} KB)  counts={c}")
        return

    if args.ci:
        creds = headless_credentials()
        service = build("drive", "v3", credentials=creds)
        files = list_all_files(service)
        buckets, reports = analyze(files)
        out = Path("data/latest.json")
        out.parent.mkdir(exist_ok=True)
        out.write_text(json.dumps(build_ci_payload(files, reports, buckets),
                                  ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        img = reports["images"]
        print(f"CI artifact written: images unique={img['unique']:,} "
              f"raw={img['total']:,} dupes={img['duplicate_copies']:,}")
        return

    print("Authorizing / connecting to Google Drive...", flush=True)
    service = get_service()  # interactive local mode

    print("Listing file metadata (not downloading contents)...", flush=True)
    t0 = time.time()
    files = list_all_files(service)
    dt = time.time() - t0
    print(f"Listed {len(files)} items in {dt:.1f}s\n")

    buckets, reports = analyze(files)

    img, vid = reports["images"], reports["videos"]
    total_size = sum(int(f.get("size") or 0) for f in files)

    print("=" * 62)
    print("DRIVE CONTENT SUMMARY")
    print("=" * 62)
    print(f"All items (excl. trash)      : {len(files):>12,}")
    print(f"Total stored size            : {human(total_size):>12}")
    print("-" * 62)
    print(f"IMAGES (raw, incl. dupes)    : {img['total']:>12,}")
    print(f"  unique images              : {img['unique']:>12,}")
    print(f"  exact duplicate copies     : {img['duplicate_copies']:>12,}  ({human(img['wasted_bytes'])})")
    print("-" * 62)
    print(f"VIDEOS (excluded from count) : {vid['total']:>12,}")
    print(f"Google-native docs/files     : {len(buckets['gdocs']):>12,}")
    print(f"Other files                  : {len(buckets['others']):>12,}")
    print("=" * 62)
    print(f"\nANSWER -> true picture count: {img['unique']:,} unique "
          f"({img['total']:,} raw - {img['duplicate_copies']:,} duplicates)")

    # Save snapshot for hourly re-runs / diffing
    SNAPSHOT_DIR.mkdir(exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    snap_path = SNAPSHOT_DIR / f"snapshot_{stamp}.json"
    snap_path.write_text(json.dumps({
        "scanned_at_utc": stamp,
        "summary": {
            "all_items": len(files), "total_bytes": total_size,
            "images_raw": img["total"], "images_unique": img["unique"],
            "image_duplicate_copies": img["duplicate_copies"],
            "images_wasted_bytes": img["wasted_bytes"], "videos": vid["total"],
            "google_native": len(buckets["gdocs"]), "other": len(buckets["others"]),
        },
        "duplicate_groups": reports["images"]["groups"],
        "file_list": [{"id": f["id"], "name": f["name"], "mime": f.get("mimeType"),
                       "size": f.get("size"), "md5": f.get("md5Checksum"),
                       "owner": ((f.get("owners") or [{}])[0].get("emailAddress") or "unknown"),
                       "ownerName": ((f.get("owners") or [{}])[0].get("displayName") or ""),
                       "time": f.get("createdTime") or ""}
                      for f in files],
    }, ensure_ascii=False))
    print(f"\nSnapshot saved: {snap_path}")

    if args.csv and reports["images"]["groups"]:
        with open(args.csv, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(["md5", "count", "size_bytes", "filenames"])
            for g in reports["images"]["groups"]:
                w.writerow([g["md5"], g["count"], g["size"],
                            " | ".join(x["name"] for x in g["files"])])
        print(f"Duplicates CSV saved: {args.csv}")


if __name__ == "__main__":
    main()
