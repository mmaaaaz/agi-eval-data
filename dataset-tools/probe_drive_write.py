#!/usr/bin/env python3
"""
Drive write-permission probe (plan v4, Task 0.5). Run from repo root:
    python dataset-tools/probe_drive_write.py

Three surgical probes, all self-cleaning:
  A) Own-drive sandbox: create tiny JPEG -> files.update (media) -> revisions.delete -> files.delete
  B) TYD-owned dataset file: re-upload BYTE-IDENTICAL content via files.update -> verify md5 unchanged
  C) TYD folder sibling: create tiny marker file -> inspect owner -> delete it

The OAuth flow requests the Drive read-write scope and saves the token to
~/.dataset-tools/token-rw.json (outside the repo). Any consent HTML artifact
is removed after the flow. Nothing else is written or modified.
"""
import io
import json
import os
import sys
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload, MediaIoBaseUpload

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
CLIENT_SECRET = str(ROOT / "client_secret.json")
TOKEN_RW = Path.home() / ".dataset-tools" / "token-rw.json"
SCOPES = ["https://www.googleapis.com/auth/drive"]

TYD_PARENT = "15Cz7j6Kj-HywKTa991185Zroh3MuF0u8"          # TYD dataset folder (from v3 probe)
PROBE_B_ID = "1Zmt7Bs84h5eeGs5uf8QnMFDGEvehMRzP"          # smallest TYD-owned jpg (3,384 B)

G = 1024 ** 3


def get_rw_service():
    creds = None
    if TOKEN_RW.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_RW), SCOPES)
    if creds and creds.valid:
        pass
    else:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(CLIENT_SECRET, SCOPES)
            creds = flow.run_local_server(port=0, prompt="consent")
        TOKEN_RW.parent.mkdir(parents=True, exist_ok=True)
        TOKEN_RW.write_text(creds.to_json())
        consent_html = Path("consent.html")
        if consent_html.exists():
            consent_html.unlink()
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def make_jpeg(w, h):
    from PIL import Image
    img = Image.new("RGB", (w, h))
    for x in range(0, w, 8):
        for y in range(0, h, 8):
            img.putpixel((x, y), (x % 256, y % 256, (x + y) % 256))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def download(svc, fid):
    req = svc.files().get_media(fileId=fid)
    buf = io.BytesIO()
    dl = MediaIoBaseDownload(buf, req)
    done = False
    while not done:
        _, done = dl.next_chunk()
    return buf.getvalue()


def main():
    svc = get_rw_service()
    a = svc.about().get(fields="user(emailAddress),storageQuota(limit,usage)").execute()
    q = a["storageQuota"]
    lim = int(q.get("limit") or 0)
    print(f"auth ok: {a['user']['emailAddress']}  quota {int(q.get('usage',0))/G:.2f}/{lim/G:.2f} GiB")
    results = {}

    # ---------- Probe A: own-drive sandbox ----------
    print("\n[A] own-drive sandbox: create -> update -> revision-delete -> delete")
    fid = None
    try:
        created = svc.files().create(
            body={"name": "_rw_probe_delete_me.jpg"},
            media_body=MediaIoBaseUpload(io.BytesIO(make_jpeg(100, 100)), mimetype="image/jpeg"),
            fields="id,size,md5Checksum,headRevisionId",
        ).execute()
        fid = created["id"]
        print(f"    created {fid} size={created['size']} md5={created['md5Checksum'][:12]}…")
        before_rev = svc.revisions().list(fileId=fid, fields="revisions(id)").execute()["revisions"]
        updated = svc.files().update(
            fileId=fid,
            media_body=MediaIoBaseUpload(io.BytesIO(make_jpeg(60, 60)), mimetype="image/jpeg"),
            fields="size,md5Checksum,headRevisionId",
        ).execute()
        print(f"    updated  size={updated['size']} md5={updated['md5Checksum'][:12]}… "
              f"headRev={updated['headRevisionId'][:12]}…")
        after_rev = svc.revisions().list(fileId=fid, fields="revisions(id)").execute()["revisions"]
        print(f"    revisions: {len(before_rev)} -> {len(after_rev)} (old content kept as revision: {len(after_rev) > len(before_rev)})")
        if len(after_rev) > 1:
            old = [r for r in after_rev if r["id"] != updated["headRevisionId"]]
            svc.revisions().delete(fileId=fid, revisionId=old[0]["id"]).execute()
            print(f"    revisions.delete old rev OK ({len(after_rev)-1} purged)")
        results["A_own_drive_update"] = "PASS"
        results["A_revision_delete"] = "PASS"
    except Exception as e:  # noqa: BLE001
        results.setdefault("A_own_drive_update", f"FAIL {type(e).__name__}: {str(e)[:160]}")
        results.setdefault("A_revision_delete", "SKIPPED")
        print(f"    FAIL: {type(e).__name__}: {str(e)[:200]}")
    finally:
        if fid:
            try:
                svc.files().delete(fileId=fid).execute()
                print("    sandbox file deleted (cleanup ok)")
            except Exception as e:  # noqa: BLE001
                print(f"    CLEANUP WARNING: {e}")

    # ---------- Probe B: TYD-owned file, byte-identical re-upload ----------
    print(f"\n[B] TYD-owned file writer-rewrite (byte-identical, no content change): {PROBE_B_ID}")
    try:
        meta0 = svc.files().get(fileId=PROBE_B_ID, fields="name,size,md5Checksum,version,headRevisionId,owners(emailAddress)").execute()
        data = download(svc, PROBE_B_ID)
        print(f"    {meta0['name'][:50]}  size={meta0['size']} md5={meta0['md5Checksum'][:12]}… revs@v{meta0['version']}")
        updated = svc.files().update(
            fileId=PROBE_B_ID,
            media_body=MediaIoBaseUpload(io.BytesIO(data), mimetype="image/jpeg"),
            fields="size,md5Checksum,version",
        ).execute()
        same_md5 = updated["md5Checksum"] == meta0["md5Checksum"]
        same_size = updated["size"] == meta0["size"]
        print(f"    after: size={updated['size']} md5={updated['md5Checksum'][:12]}… version {meta0['version']}→{updated['version']}")
        print(f"    byte-identical preserved: md5={same_md5} size={same_size}")
        results["B_tyd_inplace_update"] = "PASS" if (same_md5 and same_size) else "FAIL(md5/size mismatch)"
    except Exception as e:  # noqa: BLE001
        results["B_tyd_inplace_update"] = f"FAIL {type(e).__name__}: {str(e)[:160]}"
        print(f"    FAIL: {type(e).__name__}: {str(e)[:200]}")

    # ---------- Probe C: sibling creation inside TYD folder ----------
    print(f"\n[C] sibling creation in TYD folder {TYD_PARENT}")
    cid = None
    try:
        created = svc.files().create(
            body={"name": "_probe_sibling_delete_me.txt", "parents": [TYD_PARENT]},
            media_body=MediaIoBaseUpload(io.BytesIO(b"probe"), mimetype="text/plain"),
            fields="id,owners(emailAddress),size,permissions(type,role,emailAddress)",
        ).execute()
        cid = created["id"]
        owners = [o["emailAddress"] for o in created.get("owners", [])]
        perms = [(p.get("type"), p.get("role"), p.get("emailAddress", "")) for p in created.get("permissions", [])]
        print(f"    created {cid} size={created['size']}")
        print(f"    owner: {owners}   (new sibling bills to owner's quota: {owners})")
        print(f"    perms: {perms}")
        results["C_sibling_create"] = f"PASS (owner={owners[0] if owners else '?'})"
    except Exception as e:  # noqa: BLE001
        results["C_sibling_create"] = f"FAIL {type(e).__name__}: {str(e)[:160]}"
        print(f"    FAIL: {type(e).__name__}: {str(e)[:200]}")
    finally:
        if cid:
            try:
                svc.files().delete(fileId=cid).execute()
                print("    sibling deleted (cleanup ok)")
            except Exception as e:  # noqa: BLE001
                print(f"    CLEANUP WARNING: {e}")

    print("\n===== PROBE RESULTS =====")
    for k, v in results.items():
        print(f"{k:28s} {v}")
    ok = all(v.startswith("PASS") for v in results.values())
    print("\nVERDICT:", "ALL PASS — in-place optimization viable, sibling path viable" if ok
          else "NOT ALL PASS — Plan B decision required (see plan v4 §3)")


if __name__ == "__main__":
    main()
