#!/usr/bin/env python3
"""
drive_io.py — Drive read-write I/O with per-thread services + retry/backoff.

Auth priority:
  1. CI env: DRIVE_CLIENT_ID + DRIVE_CLIENT_SECRET + DRIVE_RW_REFRESH_TOKEN
  2. Local:  ~/.dataset-tools/token-rw.json (from probe_drive_write.py)

Concurrency contract: googleapiclient service objects are NOT thread-safe.
service() returns a thread-local instance; call it once per thread.
"""
import io
import sys
import threading
import time
from pathlib import Path

import netfix  # TLS1.3 workaround for local network (see module docstring)
netfix.apply()

from google.auth.transport.requests import Request  # noqa: E402
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaIoBaseDownload, MediaIoBaseUpload

SCOPES_RW = ["https://www.googleapis.com/auth/drive"]
LOCAL_TOKEN = Path.home() / ".dataset-tools" / "token-rw.json"
TOKEN_URI = "https://oauth2.googleapis.com/token"

_tls = threading.local()

RETRYABLE = ("rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded",
             "backendError", "internalError", "sharingRateLimitExceeded")


def _creds_from_env():
    import os
    cid = os.environ.get("DRIVE_CLIENT_ID")
    csec = os.environ.get("DRIVE_CLIENT_SECRET")
    rtok = os.environ.get("DRIVE_RW_REFRESH_TOKEN")
    if not (cid and csec and rtok):
        return None
    return Credentials(token=None, refresh_token=rtok, token_uri=TOKEN_URI,
                       client_id=cid, client_secret=csec, scopes=SCOPES_RW)


def _creds_from_local():
    if not LOCAL_TOKEN.exists():
        return None
    return Credentials.from_authorized_user_file(str(LOCAL_TOKEN), SCOPES_RW)


def service():
    """Thread-local RW service. Call once per worker thread."""
    svc = getattr(_tls, "svc", None)
    if svc is not None:
        return svc
    creds = _creds_from_env() or _creds_from_local()
    if creds is None:
        raise RuntimeError(
            "No RW credentials: set DRIVE_CLIENT_ID/DRIVE_CLIENT_SECRET/"
            "DRIVE_RW_REFRESH_TOKEN env (CI) or run dataset-tools/probe_drive_write.py once (local).")
    if not creds.valid:
        creds.refresh(Request())
    svc = build("drive", "v3", credentials=creds, cache_discovery=False)
    _tls.svc = svc
    return svc


def with_retry(fn, *args, **kw):
    """Execute a Drive call with exponential backoff on retryable errors."""
    delay = 2.0
    for attempt in range(7):
        try:
            return fn(*args, **kw).execute()
        except HttpError as e:
            reason = ""
            try:
                reason = e.resp.get("reason", "") or ""
            except Exception:  # noqa: BLE001
                pass
            body = getattr(e, "content", b"") or b""
            if e.resp.status in (403, 429, 500, 502, 503, 504) and (
                    any(r in str(body) for r in RETRYABLE) or e.resp.status != 403):
                if attempt == 6:
                    raise
                time.sleep(delay)
                delay = min(delay * 2, 60)
                continue
            raise
        except (ConnectionError, TimeoutError, OSError) as e:
            if attempt == 6:
                raise
            time.sleep(delay)
            delay = min(delay * 2, 60)


META_FIELDS = ("id, name, mimeType, size, md5Checksum, version, createdTime, "
               "trashed, owners(emailAddress), parents")


def get_meta(fid: str, fields: str = META_FIELDS) -> dict:
    return with_retry(service().files().get, fileId=fid, fields=fields,
                      supportsAllDrives=True)


def download(fid: str) -> bytes:
    """Full-download with own retry loop: googleapiclient's num_retries does
    not cover ssl.SSLEOFError raised mid-handshake by the local network path
    (see netfix.py). 4 attempts, exponential backoff."""
    last = None
    for attempt in range(4):
        try:
            buf = io.BytesIO()
            req = service().files().get_media(fileId=fid)
            dl = MediaIoBaseDownload(buf, req)
            done = False
            while not done:
                _, done = dl.next_chunk(num_retries=3)
            return buf.getvalue()
        except Exception as e:  # noqa: BLE001
            last = e
            name = type(e).__name__
            transient = name in ("SSLEOFError", "SSLError", "ConnectionResetError",
                                 "TimeoutError", "SocketError", "OSError") or \
                "CannotFetch" in name
            if not transient or attempt == 3:
                raise
            time.sleep(2 * (2 ** attempt))
    raise last  # unreachable; keeps linters happy


def update_media(fid: str, data: bytes, mimetype: str, fields: str = META_FIELDS) -> dict:
    """In-place content rewrite. Returns post-write server truth."""
    media = MediaIoBaseUpload(io.BytesIO(data), mimetype=mimetype)
    return with_retry(service().files().update, fileId=fid, media_body=media,
                      fields=fields, supportsAllDrives=True)


def create_media(name: str, parent_id: str, data: bytes, mimetype: str,
                 fields: str = META_FIELDS) -> dict:
    media = MediaIoBaseUpload(io.BytesIO(data), mimetype=mimetype)
    return with_retry(service().files().create,
                      body={"name": name, "parents": [parent_id]},
                      media_body=media, fields=fields, supportsAllDrives=True)


def upload_text(name: str, parent_id: str, text: str) -> dict:
    """Create or overwrite a small text/JSON file (journal, ledger sync)."""
    q = {"name": name, "parents": [parent_id]}
    found = with_retry(service().files().list,
                       q=f"name='{name}' and '{parent_id}' in parents and trashed=false",
                       fields="files(id)", pageSize=1)
    items = found.get("files", [])
    media = MediaIoBaseUpload(io.BytesIO(text.encode()), mimetype="application/json")
    if items:
        return with_retry(service().files().update, fileId=items[0]["id"],
                          media_body=media, fields="id")
    return with_retry(service().files().create, body=q, media_body=media,
                      fields="id")


def read_text(name: str, parent_id: str) -> str | None:
    found = with_retry(service().files().list,
                       q=f"name='{name}' and '{parent_id}' in parents and trashed=false",
                       fields="files(id)", pageSize=1)
    items = found.get("files", [])
    if not items:
        return None
    buf = io.BytesIO()
    dl = MediaIoBaseDownload(buf, service().files().get_media(fileId=items[0]["id"]))
    done = False
    while not done:
        _, done = dl.next_chunk(num_retries=5)
    return buf.getvalue().decode()


def ensure_folder(name: str, parent_id: str) -> str:
    """Find-or-create a folder; returns its id."""
    found = with_retry(service().files().list,
                       q=f"name='{name}' and '{parent_id}' in parents and trashed=false "
                         f"and mimeType='application/vnd.google-apps.folder'",
                       fields="files(id)", pageSize=1)
    items = found.get("files", [])
    if items:
        return items[0]["id"]
    created = with_retry(service().files().create,
                         body={"name": name, "parents": [parent_id],
                               "mimeType": "application/vnd.google-apps.folder"},
                         fields="id")
    return created["id"]
