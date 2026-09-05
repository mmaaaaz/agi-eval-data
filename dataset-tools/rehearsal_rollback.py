#!/usr/bin/env python3
"""
rehearsal_rollback.py — Phase R.3/R.4: prove the escape hatch end-to-end.

1. ROLLBACK DRILL (3 files): revisions.list -> download pre-optimization
   revision -> files.update back -> assert live md5 == original md5 -> time it.
2. PURGE PROBE (1 file): revisions.delete on the optimized revision.
3. CLEANUP: hard-delete every _rehearsal file + the folder (all maaaazau-owned
   copies we created — originals on Drive never touched).
"""
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import netfix  # noqa: E402
netfix.apply()
import drive_io as DIO  # noqa: E402

BATCH_PATH = os.path.join(HERE, "batches", "rehearsal-001.json")


def revisions(fid):
    # with_retry executes and returns the parsed dict already
    return DIO.with_retry(DIO.service().revisions().list, fileId=fid,
                          fields="revisions(id, modifiedTime)")["revisions"]


def download_revision(fid, rev_id):
    buf = __import__("io").BytesIO()
    from googleapiclient.http import MediaIoBaseDownload
    dl = MediaIoBaseDownload(buf, DIO.service().revisions().get_media(
        fileId=fid, revisionId=rev_id))
    done = False
    while not done:
        _, done = dl.next_chunk(num_retries=3)
    return buf.getvalue()


def rollback_drill(files, n=3):
    print(f"\n=== ROLLBACK DRILL on {n} files ===")
    results = []
    for im in files[:n]:
        fid, orig_md5 = im["id"], im["orig_md5"]
        t0 = time.perf_counter()
        revs = revisions(fid)
        # the pre-optimization revision = oldest (our upload created rev 1,
        # optimize_batch's files.update created rev 2)
        oldest = sorted(revs, key=lambda r: r.get("modifiedTime", ""))[0]
        data = download_revision(fid, oldest["id"])
        import hashlib
        got = hashlib.md5(data).hexdigest()
        assert got == orig_md5, f"revision bytes != original upload md5 for {fid}"
        DIO.update_media(fid, data, "image/jpeg" if im["ext"] in ("jpg", "jpeg")
                         else f"image/{im['ext']}")
        meta = DIO.get_meta(fid)
        ok = meta.get("md5Checksum") == orig_md5
        dt_ = time.perf_counter() - t0
        results.append(ok)
        print(f"  {im['name'][:38]:40s} md5 restored={ok}  {dt_:.1f}s "
              f"({len(revs)} revisions seen)")
    print(f"ROLLBACK DRILL: {'PASS' if all(results) else 'FAIL'} "
          f"(avg {sum(1 for _ in results) and 0 or 0})")
    return all(results)


def purge_probe(files):
    print("\n=== REVISION-PURGE PROBE ===")
    im = files[0]
    revs = revisions(im["id"])
    head = DIO.get_meta(im["id"]).get("headRevisionId")
    old = [r["id"] for r in revs if r["id"] != head]
    if not old:
        print("  no old revision to purge (file not optimized?) — SKIP")
        return None
    try:
        DIO.with_retry(DIO.service().revisions().delete, fileId=im["id"],
                       revisionId=old[0])
        print(f"  revisions.delete PASS on {im['name'][:30]} ({len(revs)}->{len(revs)-1} revs)")
        return True
    except Exception as e:  # noqa: BLE001
        print(f"  revisions.delete DENIED: {type(e).__name__}: {str(e)[:120]}")
        return False


def cleanup():
    print("\n=== CLEANUP ===")
    b = json.load(open(BATCH_PATH, encoding="utf-8"))
    deleted = 0
    for im in b["files"]:
        try:
            DIO.with_retry(DIO.service().files().delete, fileId=im["id"])
            deleted += 1
        except Exception as e:  # noqa: BLE001
            print(f"  WARN delete {im['id']}: {str(e)[:80]}")
    folder_id = None
    found = DIO.with_retry(DIO.service().files().list,
                           q="name='_rehearsal' and trashed=false",
                           fields="files(id)", pageSize=1).get("files", [])
    if found:
        folder_id = found[0]["id"]
        try:
            DIO.with_retry(DIO.service().files().delete, fileId=folder_id)
            print("  _rehearsal folder deleted")
        except Exception as e:  # noqa: BLE001
            print(f"  WARN folder: {str(e)[:80]}")
    print(f"  files hard-deleted: {deleted}/{len(b['files'])} (copies we created)")
    print("CLEANUP DONE — originals were never touched")


if __name__ == "__main__":
    b = json.load(open(BATCH_PATH, encoding="utf-8"))
    ok = rollback_drill(b["files"], n=3)
    purge = purge_probe(b["files"])
    cleanup()
    print(f"\nREHEARSAL POST-FLIGHT: rollback={'PASS' if ok else 'FAIL'} "
          f"purge={'PASS' if purge else ('DENIED' if purge is False else 'N/A')}")
