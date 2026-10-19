#!/usr/bin/env python
"""Wait for a lane's key file, then start that lane's driver immediately.

    python -m scripts.harness.watch_lane \
        --env-file scripts/harness/providers/lane2.env \
        --batch full-50k-lane2 --shard runs/generation/full-50k/shard-2.jsonl \
        --endpoint lane2 --concurrency 64 --rpm 1200 --hours 8

The owner pastes a key into the env file; this watcher polls for it, validates
that VQA_API_KEY is non-empty, and then runs drive_generation for that shard.
One-shot: after launching it exits, so a second lane is a second watcher.

It never prints the key and refuses to start if the file is missing or empty.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read_key(path: Path) -> str:
    if not path.exists():
        return ""
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith("VQA_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def read_env(path: Path) -> dict[str, str]:
    kv: dict[str, str] = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                kv[k.strip()] = v.strip().strip('"').strip("'")
    return kv


def preflight(kv: dict[str, str], model: str) -> tuple[bool, str]:
    """One tiny text call: catches a wrong key, base URL or model id before a lane starts."""
    import json
    import urllib.error
    import urllib.request

    body = {"model": model, "max_tokens": 16, "temperature": 0,
            "messages": [{"role": "user", "content": "Reply: PONG"}]}
    req = urllib.request.Request(
        kv.get("VQA_API_BASE", "").rstrip("/") + "/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {kv.get('VQA_API_KEY', '')}",
                 "Content-Type": "application/json", "Accept": "application/json",
                 "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                                "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36")},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return True, str(r.status)
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}: {e.read().decode()[:160]}"
    except Exception as e:
        return False, f"{type(e).__name__}: {str(e)[:120]}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--env-file", required=True)
    ap.add_argument("--batch", required=True)
    ap.add_argument("--shard", required=True)
    ap.add_argument("--endpoint", default="lane")
    ap.add_argument("--model", default="")
    ap.add_argument("--concurrency", type=int, default=64)
    ap.add_argument("--rpm", type=int, default=1200)
    ap.add_argument("--hours", type=float, default=8)
    ap.add_argument("--poll", type=int, default=20)
    ap.add_argument("--timeout", type=float, default=6, help="hours to wait for the key")
    args = ap.parse_args()

    env_path = Path(args.env_file)
    deadline = time.time() + args.timeout * 3600
    print(f"watching {env_path} for a key (timeout {args.timeout}h)", flush=True)

    while time.time() < deadline:
        if read_key(env_path):
            kv = read_env(env_path)
            model = args.model or kv.get("VQA_MODEL", "")
            try:
                ok, detail = preflight(kv, model)
            except Exception as e:  # a socket timeout must never kill the watcher
                ok, detail = False, f"{type(e).__name__}: {str(e)[:100]}"
            if not ok:
                stamp = datetime.now(timezone.utc).strftime("%H:%M:%SZ")
                print(f"[{stamp}] key found but preflight failed ({detail}); retrying in 60s", flush=True)
                time.sleep(60)
                continue
            stamp = datetime.now(timezone.utc).strftime("%H:%M:%SZ")
            print(f"[{stamp}] key found, preflight ok; starting lane {args.endpoint}", flush=True)
            # Re-shard first: the main lane parsed more images while we waited,
            # and a stale shard would pay for those twice.
            subprocess.call(
                [sys.executable, "-u", "-m", "scripts.harness.shard_images",
                 "--batch", "full-50k", "--lanes", "2"],
                cwd=str(ROOT),
            )
            cmd = [
                sys.executable, "-u", "-m", "scripts.harness.drive_generation",
                "--batch", args.batch, "--images", args.shard,
                "--env-file", str(env_path), "--endpoint", args.endpoint,
                "--concurrency", str(args.concurrency), "--rpm", str(args.rpm),
                "--hours", str(args.hours), "--gap", "60",
            ]
            if args.model:
                cmd += ["--model", args.model]
            return subprocess.call(cmd, cwd=str(ROOT))
        time.sleep(args.poll)

    print("timed out waiting for the key file", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
