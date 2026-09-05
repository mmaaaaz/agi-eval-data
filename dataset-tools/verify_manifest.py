#!/usr/bin/env python3
"""
verify_manifest.py — parity gate: data/latest.json must equal live Drive
before any phase that mutates state (plan v6 Phase 1, Task 1.1).
Exit 0 = PASS, 2 = FAIL.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts"))
sys.path.insert(0, HERE)

import netfix  # noqa: E402  (TLS1.3 local-network workaround — see module)
netfix.apply()

from drive_common import get_service  # noqa: E402


def main():
    d = json.load(open(os.path.join(ROOT, "data", "latest.json"), encoding="utf-8"))
    mfiles = d["files"]
    m_ids = {r[0] for r in mfiles}
    m_img = {r[0] for r in mfiles if r[7] == "i"}
    md5_counts = {}
    for r in mfiles:
        if r[7] == "i" and r[6]:
            md5_counts[r[6]] = md5_counts.get(r[6], 0) + 1

    svc = get_service()
    live, token = [], None
    while True:
        resp = svc.files().list(
            q="trashed = false", pageSize=1000, pageToken=token,
            fields="nextPageToken, files(id, md5Checksum, mimeType)",
            supportsAllDrives=True, includeItemsFromAllDrives=True).execute()
        live.extend(resp["files"])
        token = resp.get("nextPageToken")
        if not token:
            break

    live_ids = {f["id"] for f in live}
    live_img = {f["id"] for f in live
                if f.get("mimeType", "").startswith("image/")}
    live_md5 = {}
    for f in live:
        if f.get("mimeType", "").startswith("image/") and f.get("md5Checksum"):
            live_md5[f["md5Checksum"]] = live_md5.get(f["md5Checksum"], 0) + 1

    problems = []
    if len(live_ids) != len(m_ids):
        problems.append(f"count: manifest {len(m_ids)} vs live {len(live_ids)}")
    missing = m_ids - live_ids
    if missing:
        problems.append(f"{len(missing)} manifest ids not live (e.g. {sorted(missing)[:3]})")
    extra = live_ids - m_ids
    if extra:
        problems.append(f"{len(extra)} live ids missing from manifest (e.g. {sorted(extra)[:3]})")
    # dupGroups still resolve to >=2 live copies?
    broken_groups = sum(1 for g in d.get("dupGroups", [])
                        if live_md5.get(g["md5"], 0) < 2)
    if broken_groups:
        problems.append(f"{broken_groups} dupGroups no longer resolve to 2+ live copies")

    print(f"manifest files : {len(m_ids)}")
    print(f"live files     : {len(live_ids)}")
    print(f"manifest images: {len(m_img)}  live images: {len(live_img)}")
    print(f"dupGroups ok   : {len(d.get('dupGroups', [])) - broken_groups}/{len(d.get('dupGroups', []))}")
    if problems:
        print("FAIL:")
        for p in problems:
            print("  -", p)
        sys.exit(2)
    print("PASS — manifest ≡ live Drive")


if __name__ == "__main__":
    main()
