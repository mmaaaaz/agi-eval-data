#!/usr/bin/env python3
"""
Google Drive metadata scanner — SCOPED to the metro/transit_dataset root folder.

Mirror of scripts/drive_scan.py with three differences:
  1. Lists ONLY files inside the root folder (recursive, parents-aware) instead of
     the whole Drive.
  2. v4 artifact (data/metro.json): each files row carries a 9th `folders` column —
     the folder-name path from the root down to the file's parent
     (e.g. ["ours", "Brazil"]).
  3. Counts: images / pdfs / countries / cities instead of the v3 images/videos/dupes.

Downloads METADATA ONLY. Image media metadata is requested ONLY for image mime types
(Google 403s on imageMediaMetadata for PDFs).

Usage:
  python scripts/metro_scan.py                  # interactive OAuth + local scan
  python scripts/metro_scan.py --ci             # headless (DRIVE_* env) -> data/metro.json
  python scripts/metro_scan.py --from-snapshot path.json
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

from drive_common import (
    SCOPES, CLIENT_SECRET, TOKEN_FILE, MIME_EXT_FALLBACK,
    ext_of, get_service, headless_credentials, list_with_retry,
)



def list_children(service, folder_id):
    """List one folder level; every item's metadata + parents array."""
    out = []
    token = None
    while True:
        resp = list_with_retry(
            service,
            q=f"'{folder_id}' in parents and trashed = false",
            pageSize=1000,
            fields=FIELDS,
            pageToken=token,
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
        )
        out.extend(resp.get("files", []))
        token = resp.get("nextPageToken")
        if not token:
            break
    return out


def walk_tree(service, root_id):
    """Recursive walk. Returns (files, folders) where folders maps id -> (name, parent_id)
    for every folder in the tree, and files is the raw file list."""
    folders: dict[str, tuple[str, str | None]] = {}
    files = []

    def visit(fid, parent_id):
        for f in list_children(service, fid):
            if f["mimeType"] == "application/vnd.google-apps.folder":
                folders[f["id"]] = (f["name"], parent_id)
                visit(f["id"], f["id"])
            else:
                files.append(f)

    visit(root_id, root_id)
    return files, folders


def folder_path(f, folders, root_id):
    """The folder-name path from the root down to the file's parent, e.g.
    ["ours", "Brazil"]. Chained by walking each folder's (name, parent_id).

    folders: id -> (name, parent_id) for every folder in the tree.
    """
    segs = []
    parent = (f.get("parents") or [None])[0]
    guard = 0
    while parent and parent != root_id and guard < 32:
        rec = folders.get(parent)
        if rec is None:
            break
        segs.append(rec[0])
        parent = rec[1]
        guard += 1
    segs.reverse()
    return segs


def analyze(files):
    """Dup report over images (pdfs excluded — they share no md5 semantics)."""
    by_md5 = {}
    for f in files:
        if not f.get("mimeType", "").startswith("image/"):
            continue
        md5 = f.get("md5Checksum")
        if md5:
            by_md5.setdefault(md5, []).append(f)
    groups = {k: v for k, v in by_md5.items() if len(v) > 1}
    extra = sum(len(v) - 1 for v in groups.values())
    return {
        "total": len(by_md5),
        "unique": len(by_md5),
        "duplicate_copies": extra,
        "wasted_bytes": sum(int(v[0].get("size") or 0) * (len(v) - 1) for v in groups.values()),
        "groups": [
            {"md5": k, "count": len(v), "size": int(v[0].get("size") or 0),
             "names": [x["name"] for x in v][:10]}
            for k, v in sorted(groups.items(), key=lambda kv: -int(kv[1][0].get("size") or 0))
        ],
    }


def build_payload(files, folders, root_id):
    owners = {}
    rows = []
    cams: list[str] = []
    cam_idx: dict[str, int] = {}
    exif: dict[str, list[int]] = {}
    countries: set[str] = set()
    cities: set[str] = set()

    for f in files:
        mime = f.get("mimeType") or ""
        kind = "i" if mime.startswith("image/") else "o"
        o = (f.get("owners") or [{}])[0]
        email = o.get("emailAddress") or "unknown"
        owners.setdefault(email, o.get("displayName") or
                          (email.split("@")[0].replace(".", " ").replace("_", " ").title()))
        fp = folder_path(f, folders, root_id)
        rows.append([f["id"], f["name"], ext_of(f["name"], mime), int(f.get("size") or 0),
                     (f.get("createdTime") or "")[:10], email,
                     f.get("md5Checksum") or "", kind, fp])
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
        # taxonomy from the folder path: ["<branch>", "<country>", ...]
        # every image file IS one city's network map, so cities == image count;
        # countries == distinct second-level folder names across both branches
        if len(fp) >= 2:
            countries.add(fp[1])
        if kind == "i":
            cities.add(f["id"])

    img_report = analyze(files)
    n_img = sum(1 for f in files if f.get("mimeType", "").startswith("image/"))
    n_pdf = sum(1 for f in files if f.get("mimeType") == "application/pdf")
    return {
        "version": 4,
        "meta": {
            "scannedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "cron": "0 * * * *",
            "root": root_id,
            "counts": {
                "all": len(files), "images": n_img, "pdfs": n_pdf,
                "imagesRaw": n_img, "imagesUnique": img_report["unique"],
                "dupCopies": img_report["duplicate_copies"], "videos": 0,
                "bytes": sum(int(f.get("size") or 0) for f in files),
                "countries": len(countries), "cities": len(cities),
            },
        },
        "files": rows, "owners": owners,
        "exif": exif, "cams": cams, "dupGroups": img_report["groups"],
    }


def write_artifact(payload):
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    c = payload["meta"]["counts"]
    print(f"artifact written: {OUT} ({OUT.stat().st_size/1024:.0f} KB)  "
          f"images={c['images']} pdfs={c['pdfs']} countries={c['countries']} cities={c['cities']}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=DEFAULT_ROOT, help="Drive folder id to scan")
    ap.add_argument("--ci", action="store_true", help="headless auth + write data/metro.json")
    ap.add_argument("--from-snapshot", metavar="PATH",
                    help="build CI artifact offline from an existing snapshot JSON")
    args = ap.parse_args()

    if args.from_snapshot:
        snap = json.loads(Path(args.from_snapshot).read_text(encoding="utf-8"))
        fl = snap.get("files", snap.get("file_list", []))
        folders = {f["id"]: (f["name"], f.get("parent_id")) for f in snap.get("folders", [])}
        files = []
        for f in fl:
            files.append({
                "id": f["id"], "name": f["name"],
                "mimeType": f.get("mime") or f.get("mimeType") or "",
                "size": f.get("size") or "0",
                "md5Checksum": f.get("md5") or "",
                "createdTime": ((f.get("time") or f.get("createdTime") or "")
                                + ("Z" if not (f.get("time") or f.get("createdTime") or "").endswith("Z") else "")),
                "owners": ([{"emailAddress": f["owner"], "displayName": f.get("ownerName") or ""}]
                           if f.get("owner") else []),
                "parents": f.get("parents", []),
                "imageMediaMetadata": f.get("imageMediaMetadata"),
            })
        write_artifact(build_payload(files, folders, args.root))
        return

    if args.ci:
        service = build("drive", "v3", credentials=headless_credentials())
        files, folders = walk_tree(service, args.root)
        write_artifact(build_payload(files, folders, args.root))
        return

    print("Authorizing / connecting to Google Drive...", flush=True)
    service = get_service()
    print(f"Walking {ROOT_NAME} ({args.root})...", flush=True)
    t0 = time.time()
    files, folders = walk_tree(service, args.root)
    dt = time.time() - t0
    payload = build_payload(files, folders, args.root)
    c = payload["meta"]["counts"]
    print(f"Listed {len(files)} items in {dt:.1f}s\n")
    print("=" * 62)
    print("METRO / TRANSIT DATASET SUMMARY")
    print("=" * 62)
    print(f"All items (excl. trash)      : {c['all']:>12,}")
    print(f"Total stored size            : {c['bytes']/1e6:>10.1f} MB")
    print(f"Images (network maps)        : {c['images']:>12,}")
    print(f"PDFs (official plans)        : {c['pdfs']:>12,}")
    print(f"Countries                    : {c['countries']:>12,}")
    print(f"Cities                       : {c['cities']:>12,}")
    print(f"Duplicate image copies       : {c['dupCopies']:>12,}")
    print("=" * 62)
    write_artifact(payload)


if __name__ == "__main__":
    main()
