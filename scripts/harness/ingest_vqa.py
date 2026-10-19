#!/usr/bin/env python
"""Ingest a drafting batch's candidates into the review room (D1, migration 0010).

    python -m scripts.harness.ingest_vqa --batch full-50k
    python -m scripts.harness.ingest_vqa --batch full-50k --dry-run

Reads runs/generation/<batch>/candidates.jsonl, keeps only rows the runner parsed
and candidates that passed the runner's own validation (no _errors), and POSTs
them to /api/vqa/ingest behind the harness door (x-harness-code), 200 rows at a
time. The endpoint is INSERT OR IGNORE on (batch, file_id, question), so re-running
after a resumed draft inserts only what is new.

Credentials come from scripts/harness/generation.env (gitignored):
    VQA_RELAY_URL=...
    VQA_HARNESS_CODE=...
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
ENV_FILE = ROOT / "scripts" / "harness" / "generation.env"


def read_env() -> dict[str, str]:
    kv: dict[str, str] = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                kv[k.strip()] = v.strip().strip('"').strip("'")
    return kv


def pin_host(host: str, ip: str) -> None:
    """Resolve one hostname to a fixed IP for this process.

    The local network blackholes the 188.114.x Cloudflare range that workers.dev
    answers with, while other Cloudflare edges (104.18.x) serve the same Worker.
    Pinning the host at the socket layer keeps TLS SNI and the Host header on the
    real hostname, so the certificate and routing stay correct.
    """
    import socket

    original = socket.getaddrinfo

    def patched(h: object, port: object, *args: object, **kwargs: object):
        if str(h) == host:
            return original(ip, port, *args, **kwargs)  # type: ignore[arg-type]
        return original(h, port, *args, **kwargs)  # type: ignore[arg-type]

    socket.getaddrinfo = patched  # type: ignore[assignment]


def rows_from_batch(path: pathlib.Path, batch: str) -> tuple[list[dict], dict[str, int]]:
    stats = {"rows": 0, "parsed": 0, "candidates": 0, "flagged_skipped": 0, "no_candidates": 0}
    out: list[dict] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        stats["rows"] += 1
        r = json.loads(line)
        if not r.get("parse_ok"):
            continue
        stats["parsed"] += 1
        cands = r.get("candidates") or []
        if not cands:
            stats["no_candidates"] += 1
            continue
        for i, c in enumerate(cands, 1):
            if c.get("_errors"):
                stats["flagged_skipped"] += 1
                continue
            stats["candidates"] += 1
            out.append({
                "file_id": r.get("file_id", ""),
                "ordinal": i,
                "question": c.get("question", ""),
                "choices": c.get("choices", []),
                "answer": c.get("answer", ""),
                "grounding": c.get("grounding", ""),
                "capability": c.get("capability", ""),
                "level": c.get("level", ""),
                "domain": c.get("domain", ""),
                "difficulty": c.get("difficulty", ""),
                "model": r.get("model", ""),
                "endpoint": r.get("endpoint") or "",
                "prompt_version": r.get("prompt_version", ""),
                "run_id": r.get("session_id", ""),
                "image_sha256": r.get("image_sha256", ""),
            })
    return out, stats


def post(relay: str, code: str, batch: str, rows: list[dict], timeout: int = 120) -> dict:
    body = json.dumps({"batch": batch, "rows": rows}).encode()
    req = urllib.request.Request(
        relay.rstrip("/") + "/api/vqa/ingest", data=body,
        headers={
            "Content-Type": "application/json",
            "x-harness-code": code,
            # Cloudflare in front of the Worker rejects non-browser user agents
            # with 1010; this is the same gate the drafting runner hit.
            "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                           "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"),
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch", required=True)
    ap.add_argument("--file", default="")
    ap.add_argument("--relay", default="")
    ap.add_argument("--code", default="")
    ap.add_argument("--chunk", type=int, default=200)
    ap.add_argument("--full", action="store_true", help="ignore the incremental state and re-send everything")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    env = read_env()
    relay = args.relay or env.get("VQA_RELAY_URL", "")
    code = args.code or env.get("VQA_HARNESS_CODE", "")
    relay_ip = env.get("VQA_RELAY_IP", "")
    if relay_ip:
        from urllib.parse import urlparse
        pin_host(urlparse(relay).hostname or "", relay_ip)
    path = pathlib.Path(args.file) if args.file else ROOT / "runs" / "generation" / args.batch / "candidates.jsonl"
    if not path.exists():
        print(f"missing batch file: {path}", file=sys.stderr)
        return 2
    rows, stats = rows_from_batch(path, args.batch)
    print(f"{args.batch}: {stats}")

    state_path = path.parent / "ingest-state.json"
    start_at = 0
    if not args.full and state_path.exists():
        try:
            start_at = int(json.loads(state_path.read_text(encoding="utf-8")).get("candidates", 0))
        except Exception:
            start_at = 0
        start_at = min(start_at, len(rows))
    pending_rows = rows[start_at:]
    print(f"to ingest: {len(pending_rows)} new candidates ({start_at} already sent) from {stats['parsed']} parsed images")
    if args.dry_run:
        return 0
    if not relay or not code:
        print("set VQA_RELAY_URL and VQA_HARNESS_CODE in scripts/harness/generation.env", file=sys.stderr)
        return 2

    stored = 0
    for start in range(0, len(pending_rows), args.chunk):
        chunk = pending_rows[start:start + args.chunk]
        try:
            res = post(relay, code, args.batch, chunk)
        except urllib.error.HTTPError as e:
            print(f"batch {start}: HTTP {e.code} {e.read().decode()[:200]}", file=sys.stderr)
            return 1
        except Exception as e:
            print(f"batch {start}: {type(e).__name__}: {e}", file=sys.stderr)
            return 1
        stored = int(res.get("stored", stored))
        if (start // args.chunk) % 10 == 0:
            print(f"  {start + len(chunk)}/{len(pending_rows)} sent | stored for batch: {stored}")

    state_path.write_text(json.dumps({"candidates": len(rows), "stored": stored}), encoding="utf-8")
    print(f"done: {stored} candidates stored for batch {args.batch} (state {len(rows)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
