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
            stamp = datetime.now(timezone.utc).strftime("%H:%M:%SZ")
            print(f"[{stamp}] key found; starting lane {args.endpoint}", flush=True)
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
