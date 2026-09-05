#!/usr/bin/env python3
"""
rollback_batch.py — restore files to their pre-optimization revision.
Usage: python dataset-tools/rollback_batch.py batch_0002 [--only id1,id2,...]
Pulls each file's OLDEST revision (= pre-optimization bytes), verifies md5
against the ledger's recorded pre-md5, writes back in place, re-verifies.
"""
import hashlib
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import netfix  # noqa: E402
netfix.apply()
import drive_io as DIO  # noqa: E402
from googleapiclient.http import MediaIoBaseDownload  # noqa: E402


def revision_bytes(fid):
    revs = DIO.with_retry(DIO.service().revisions().list, fileId=fid,
                          fields="revisions(id, modifiedTime)")["revisions"]
    oldest = sorted(revs, key=lambda r: r.get("modifiedTime", ""))[0]
    buf = io.BytesIO()
    dl = MediaIoBaseDownload(buf, DIO.service().revisions().get_media(
        fileId=fid, revisionId=oldest["id"]))
    done = False
    while not done:
        _, done = dl.next_chunk(num_retries=3)
    return buf.getvalue()


def main():
    batch_id = sys.argv[1]
    only = None
    if len(sys.argv) > 3 and sys.argv[2] == "--only":
        only = set(x.strip() for x in sys.argv[3].split(",") if x.strip())
    recs = [json.loads(l) for l in open(
        os.path.join(HERE, "runs", batch_id, "results.jsonl"), encoding="utf-8")
        if l.strip()]
    targets = [r for r in recs if r["status"] in ("battery_failed", "error")
               and r.get("mode") == "inplace"
               and (only is None or r["id"] in only)]
    print(f"restoring {len(targets)} files to pre-optimization bytes")
    ok = 0
    for r in targets:
        fid, pre_md5 = r["id"], r["pre"]["md5"]
        data = revision_bytes(fid)
        assert hashlib.md5(data).hexdigest() == pre_md5, \
            f"revision md5 mismatch for {fid} — refusing to write"
        DIO.update_media(fid, data, "image/jpeg" if r["ext"] in ("jpg", "jpeg")
                         else f"image/{r['ext']}")
        live = DIO.get_meta(fid)
        restored = live.get("md5Checksum") == pre_md5
        print(f"  {r['name'][:40]:42s} restored={restored}")
        ok += restored
    print(f"DONE: {ok}/{len(targets)} restored byte-perfect")
    sys.exit(0 if ok == len(targets) else 4)


if __name__ == "__main__":
    main()
