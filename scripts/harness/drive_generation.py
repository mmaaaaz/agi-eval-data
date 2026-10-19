#!/usr/bin/env python
"""Drive a generation batch to completion across upstream outages.

    python -m scripts.harness.drive_generation --batch full-50k --hours 48

The upstream endpoint intermittently answers 429 "provider is temporarily
unavailable", and the machine's DNS has dropped twice mid-run. A
single `generate_vqa.py` pass cannot survive either, so this driver runs passes
in a loop:

  probe the endpoint -> if it refuses, wait and probe again
                     -> if it answers, run one generation pass (which resumes
                        from the batch's candidates.jsonl)
                     -> repeat until every image has a parsed row or --hours
                        runs out

Every pass appends to runs/generation/<batch>/driver.log; each pass's own log
lives beside it. The driver never deletes rows: generate_vqa counts only parsed
rows as done, so a pass resumes exactly where the previous one stopped.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUNS = ROOT / "runs" / "generation"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36")


def env_file(path: str = "") -> dict[str, str]:
    kv: dict[str, str] = {}
    p = Path(path) if path else ROOT / "scripts" / "harness" / "generation.env"
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                kv[k.strip()] = v.strip().strip('"').strip("'")
    return kv


def log(path: Path, msg: str) -> None:
    stamp = datetime.now(timezone.utc).strftime("%H:%M:%SZ")
    line = f"[{stamp}] {msg}"
    print(line, flush=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def probe(api_key: str, base: str, model: str, timeout: int = 40) -> tuple[bool, str]:
    body = {
        "model": model, "max_tokens": 20, "temperature": 0,
        "messages": [{"role": "user", "content": "Reply: PONG"}],
    }
    req = urllib.request.Request(
        base + "/chat/completions", data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json",
                 "Accept": "application/json", "User-Agent": UA},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            d = json.loads(r.read().decode())
        return True, str(((d.get("choices") or [{}])[0].get("message") or {}).get("content", ""))[:40]
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}: {e.read().decode()[:160]}"
    except Exception as e:
        return False, f"{type(e).__name__}: {str(e)[:160]}"


def parsed_rows(path: Path) -> set[str]:
    done: set[str] = set()
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                r = json.loads(line)
                if r.get("parse_ok"):
                    done.add(r["file_id"])
    return done


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch", required=True)
    ap.add_argument("--images", default="")
    ap.add_argument("--model", default="")
    ap.add_argument("--endpoint", default="", help="lane label, recorded on every row")
    ap.add_argument("--env-file", default="", help="KEY=VALUE file for this lane (default: generation.env)")
    ap.add_argument("--hours", type=float, default=36)
    ap.add_argument("--gap", type=int, default=300, help="seconds between passes / probes")
    ap.add_argument("--concurrency", type=int, default=8)
    ap.add_argument("--rpm", type=int, default=20)
    args = ap.parse_args()

    batch_dir = RUNS / args.batch
    batch_dir.mkdir(parents=True, exist_ok=True)
    images = Path(args.images) if args.images else batch_dir / "images.jsonl"
    rows = batch_dir / "candidates.jsonl"
    dlog = batch_dir / "driver.log"

    kv = env_file(args.env_file)
    api_key = kv.get("VQA_API_KEY", "")
    base = kv.get("VQA_API_BASE", "")
    if not args.model:
        args.model = kv.get("VQA_MODEL", "")
    if not api_key:
        print("no VQA_API_KEY in scripts/harness/generation.env", file=sys.stderr)
        return 2
    if not args.model:
        print("no --model and no VQA_MODEL in scripts/harness/generation.env", file=sys.stderr)
        return 2

    total = len([l for l in images.read_text(encoding="utf-8").splitlines() if l.strip()])
    deadline = time.time() + args.hours * 3600
    passes = 0
    log(dlog, f"driver start: {total} images, budget {args.hours}h, model {args.model}")

    while time.time() < deadline:
        done = parsed_rows(rows)
        todo = total - len(done)
        log(dlog, f"{len(done)}/{total} parsed, {todo} to draft")
        if todo <= 0:
            log(dlog, "all images drafted; driver exits")
            return 0

        ok, msg = probe(api_key, base, args.model)
        if not ok:
            log(dlog, f"upstream not ready ({msg}); sleeping {args.gap}s")
            time.sleep(args.gap)
            continue

        passes += 1
        plog = batch_dir / f"pass-{passes:02d}.log"
        cmd = [
            sys.executable, "-u", "-m", "scripts.harness.generate_vqa",
            "--batch", args.batch, "--images", str(images),
            "--model", args.model,
            "--endpoint", args.endpoint or args.batch,
            "--concurrency", str(args.concurrency), "--rpm", str(args.rpm),
            "--retry", "2", "--cooldown-429", "120",
            "--transport", "api", "--reasoning-effort", "low",
            "--raw-mode", "failures", "--spend",
        ]
        if args.env_file:
            cmd += ["--api-key-file", args.env_file]
        log(dlog, f"pass {passes} starts (log {plog.name})")
        with plog.open("a", encoding="utf-8") as fh:
            rc = subprocess.call(cmd, cwd=str(ROOT), stdout=fh, stderr=subprocess.STDOUT)
        gained = len(parsed_rows(rows)) - len(done)
        log(dlog, f"pass {passes} exited rc={rc}, +{gained} parsed images")
        if gained <= 0:
            log(dlog, f"no progress; sleeping {args.gap}s before the next probe")
            time.sleep(args.gap)

    log(dlog, f"deadline reached after {passes} passes; partial batch remains resumable")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
