#!/usr/bin/env python3
"""
Delta link-sharer: ensures images are viewable via anonymous Google CDN links.
Files flagged shared=false get permissions.create(anyone:reader).
Safe/idempotent; capped per run so hourly CI stays fast. Folder-inherited
access doesn't set the flag, so this is a belt-and-braces pass.
"""

import argparse
import os
import sys
import time

from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

sys.path.insert(0, os.path.dirname(__file__))
from drive_scan import headless_credentials  # noqa: E402


def with_backoff(fn, tries=5):
    for a in range(tries):
        try:
            return fn()
        except HttpError as e:
            if e.resp.status in (429, 500, 503) and a < tries - 1:
                time.sleep(2 ** a * 1.5)
            else:
                raise


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max", type=int, default=400,
                    help="max permission writes this run (bootstrap: use --max 100000)")
    args = ap.parse_args()

    service = build("drive", "v3", credentials=headless_credentials())

    todo, page_token = [], None
    while True:
        resp = with_backoff(lambda: service.files().list(
            # NOTE: 'shared' is not queryable — fetch it as a field, filter client-side
            q="(mimeType contains 'image/' or mimeType = 'application/pdf') and trashed = false",
            pageSize=1000,
            fields="nextPageToken, files(id, shared)",
            pageToken=page_token, supportsAllDrives=True,
            includeItemsFromAllDrives=True,
        ).execute())
        todo += [f["id"] for f in resp.get("files", []) if not f.get("shared", True)]
        page_token = resp.get("nextPageToken")
        if not page_token:
            break

    print(f"{len(todo)} image(s) without explicit anon-read permission")
    batch = todo[: args.max]
    ok = fail = 0
    for i, fid in enumerate(batch):
        try:
            with_backoff(lambda: service.permissions().create(
                fileId=fid, body={"type": "anyone", "role": "reader"},
                supportsAllDrives=True,
            ).execute())
            ok += 1
        except HttpError as e:
            fail += 1
            print(f"  ! {fid}: {e.resp.status}", file=sys.stderr)
        if (i + 1) % 100 == 0:
            print(f"  …{i+1}/{len(batch)}")
    print(f"shared {ok}, failed {fail}, remaining unflagged {max(0, len(todo)-len(batch))}")
    if fail > len(batch) // 2 and batch:
        sys.exit(1)


if __name__ == "__main__":
    main()
