#!/usr/bin/env python3
"""
Shared plumbing for the Google Drive metadata scanners (drive_scan.py, metro_scan.py).
Credentials, mime→ext mapping, and the API retry loop live here — ONE canonical copy.
"""
import os
import sys
import time
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

SCOPES = ["https://www.googleapis.com/auth/drive.metadata.readonly"]  # read-only!
CLIENT_SECRET = "client_secret.json"
TOKEN_FILE = "token.json"

MIME_EXT_FALLBACK = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
    "image/heic": "heic", "image/heif": "heif", "image/gif": "gif",
    "image/bmp": "bmp", "image/tiff": "tiff", "image/avif": "avif",
    "video/mp4": "mp4", "video/quicktime": "mov", "video/x-msvideo": "avi",
    "application/pdf": "pdf",
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


def list_with_retry(service, **kwargs):
    """files().list with exponential backoff on 429/500/503. Returns the response."""
    for attempt in range(6):
        try:
            return service.files().list(**kwargs).execute()
        except HttpError as e:
            if e.resp.status in (429, 500, 503) and attempt < 5:
                wait = 2 ** attempt * 2
                print(f"  rate limited, retrying in {wait}s...", flush=True)
                time.sleep(wait)
            else:
                raise
