#!/usr/bin/env python
"""Top up an image to exactly five questions, without repeating what it has.

    python -m scripts.harness.top_up_vqa --batch full-50k --concurrency 32 --rpm 1200 --spend

WHY THIS EXISTS
---------------
The v2 run asked the model for five candidates and validated each one, but never
enforced the COUNT: 23,465 images came back with one to four, and the run exited
0 anyway. `generate_vqa` now refuses a short batch. This tool repairs an existing
batch: for every image with fewer than five valid questions it asks for exactly
the missing number, showing the model the questions already accepted so the new
ones are different in what they ask, merges them, and reports what is still short.

Rows are preserved; the top-up adds `topup_round`, `topup_model`,
`topup_prompt_version` and appends candidates. Nothing is overwritten.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import pathlib
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from scripts.harness.generate_vqa import (
    ROOT, THUMB, load_env_file, norm_q, parse_json_blob,
    refuse_without_spend, spend_permitted, validate,
)

TOPUP_PROMPT_VERSION = "vqa-topup-v1"
TARGET = 5
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36")


def topup_prompt(k: int, existing: list[str], name: str) -> str:
    block = "\n".join(f"  - {q}" for q in existing) or "  (none yet)"
    return (
        "You write visual questions for a benchmark about whether models truly see an image. "
        "You are given ONE photograph that already has some questions.\n\n"
        f"Write exactly {k} NEW question(s) about this photograph, different in WHAT THEY ASK from "
        "the ones already accepted below. Do not repeat or paraphrase them; cover a different "
        "aspect (a different object, region, relation, material, count, light cue or function).\n\n"
        f"Already accepted:\n{block}\n\n"
        f"Return ONLY a JSON object with exactly {k} candidate(s), no markdown, no prose:\n"
        '{"candidates":[{"question":"...","choices":["...","...","...","..."],'
        '"answer":"<exactly one of the choices>","capability":"<code>","level":"<code>",'
        '"domain":"<code>","grounding":"<one sentence naming what in the image proves the answer>"}]}\n\n'
        "Rules:\n"
        "- Answerable from the photograph alone; no outside knowledge.\n"
        "- Exactly 4 distinct, short choices (1-6 words); the answer must equal one choice exactly.\n"
        "- Prefer what a careless model gets wrong: counting under clutter, left/right, small text,\n"
        "  materials, absence of an expected object, light direction.\n"
        "- Never say 'in this image'; ask about the world in it.\n"
        "- Grounding cites visible evidence, never the file name.\n\n"
        "Choose codes by MEANING: G1 depth/occlusion, G2 size/distance, G3 shape, G4 lines/angles, "
        "G5 perspective, G6 layout, G7 symmetry, G8 fit; P1 material, P2 support, P3 contact, "
        "P4 forces, P5 dynamics, P6 light, P7 fluids/heat, P8 function; B1 tipping, B2 sun shadow, "
        "B3 rolling, B4 passage (only for geometry-plus-physics); PERC perception only. "
        "Levels: L1 perceive, L2 one judgement, L3 two steps, L4 predict, L5 multi-step + outside. "
        f"Domains: D1 urban, D2 transport, D3 architecture, D4 religious, D5 medical, D6 tech/expo, "
        f"D7 market/food, D8 home/office, D9 nature/agriculture, D10 crowds, D11 industrial.\n"
        f"- The file name is {name}; never use it as evidence.\n"
    )


class Limiter:
    def __init__(self, rpm: int):
        self.gap = 60.0 / rpm if rpm > 0 else 0.0
        self.lock = threading.Lock()
        self.next = 0.0
        self.cooldown_until = 0.0

    def wait(self) -> None:
        with self.lock:
            now = time.time()
            start = max(now, self.next, self.cooldown_until)
            self.next = start + self.gap
        if start > now:
            time.sleep(start - now)

    def cooldown(self, seconds: float) -> None:
        with self.lock:
            self.cooldown_until = max(self.cooldown_until, time.time() + seconds)


def call(image_bytes: bytes, mime: str, model: str, key: str, base: str, effort: str | None,
         max_tokens: int, timeout: int, k: int, existing: list[str], name: str) -> tuple[str, str, int, dict]:
    b64 = base64.b64encode(image_bytes).decode("ascii")
    payload: dict = {
        "model": model, "temperature": 0, "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": topup_prompt(k, existing, name)},
            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
        ]}],
    }
    if effort:
        payload["reasoning_effort"] = effort
    url = base.rstrip("/") + "/chat/completions"

    def send(p: dict) -> dict:
        req = urllib.request.Request(url, data=json.dumps(p).encode("utf-8"), headers={
            "Authorization": f"Bearer {key}", "Content-Type": "application/json",
            "Accept": "application/json", "User-Agent": UA,
        })
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))

    t0 = time.time()
    try:
        d = send(payload)
    except urllib.error.HTTPError as e:
        if effort and e.code in (400, 422):
            payload.pop("reasoning_effort", None)
            d = send(payload)
        else:
            raise
    wall = int((time.time() - t0) * 1000)
    content = ((d.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
    if isinstance(content, list):
        content = "".join(p.get("text", "") if isinstance(p, dict) else str(p) for p in content)
    return content, str(d.get("id") or ""), wall, d.get("usage") or {}


def download(fid: str, dest: pathlib.Path) -> bytes:
    with urllib.request.urlopen(THUMB.format(fid=fid), timeout=120) as r:
        data = r.read()
    dest.write_bytes(data)
    return data


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch", required=True)
    ap.add_argument("--model", default="")
    ap.add_argument("--api-key-file", default=str(ROOT / "scripts" / "harness" / "generation.env"))
    ap.add_argument("--base-url", default="")
    ap.add_argument("--reasoning-effort", default="low")
    ap.add_argument("--max-tokens", type=int, default=16000)
    ap.add_argument("--concurrency", type=int, default=24)
    ap.add_argument("--rpm", type=int, default=900)
    ap.add_argument("--retry", type=int, default=2)
    ap.add_argument("--timeout", type=int, default=300)
    ap.add_argument("--limit", type=int, default=0, help="only the first N short images (probe)")
    ap.add_argument("--spend", action="store_true")
    args = ap.parse_args()

    if not spend_permitted(args):
        refuse_without_spend(args, "--spend", "the top-up run")

    env = load_env_file(pathlib.Path(args.api_key_file))
    key = env.get("VQA_API_KEY", os.environ.get("VQA_API_KEY", ""))
    base = args.base_url or env.get("VQA_API_BASE", "")
    if not args.model:
        args.model = env.get("VQA_MODEL", "")
    if not key or not base or not args.model:
        print("need VQA_API_KEY, VQA_API_BASE and VQA_MODEL", file=sys.stderr)
        return 2

    out_dir = ROOT / "runs" / "generation" / args.batch
    rows_path = out_dir / "candidates.jsonl"
    rows = [json.loads(l) for l in rows_path.read_text(encoding="utf-8").splitlines() if l.strip()]

    # CHECKPOINTED, NOT IN-MEMORY. The first version merged only at the end, so a
    # crash at hour two would have thrown away every top-up made. Each success is
    # appended here; a restart replays the file and skips what it already has.
    results_path = out_dir / "topup-results.jsonl"
    done: dict[int, list[dict]] = {}
    if results_path.exists():
        for line in results_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            rec = json.loads(line)
            done[rec["idx"]] = rec["candidates"]
        for idx, cands in done.items():
            if 0 <= idx < len(rows):
                rows[idx].setdefault("candidates", []).extend(cands)
        print(f"checkpoint: {len(done)} image(s) already topped up")

    todo = []
    for idx, row in enumerate(rows):
        if idx in done:
            continue
        valid = [c for c in row.get("candidates") or [] if not c.get("_errors")]
        if len(valid) < TARGET:
            todo.append((idx, row, TARGET - len(valid), [c["question"] for c in valid]))
    if args.limit:
        todo = todo[: args.limit]
    print(f"images short: {len(todo)} | model: {args.model} | concurrency {args.concurrency} @ {args.rpm} rpm")

    limiter = Limiter(args.rpm)
    lock = threading.Lock()
    added = {"images": 0, "questions": 0, "failed": 0}
    started = datetime.now(timezone.utc).isoformat()
    tmp = out_dir / "topup-tmp"
    tmp.mkdir(exist_ok=True)

    def work(job: tuple[int, dict, int, list[str]]) -> None:
        idx, row, k, existing = job
        fid, name = row["file_id"], row.get("name", "")
        dest = tmp / f"{fid}.jpg"
        last_err = ""
        for attempt in range(args.retry + 1):
            try:
                limiter.wait()
                data = download(fid, dest)
                mime = "image/jpeg"
                content, rid, wall, usage = call(data, mime, args.model, key, base,
                                                 args.reasoning_effort or None, args.max_tokens,
                                                 args.timeout, k, existing, name)
                blob = parse_json_blob(content)
                cands = blob.get("candidates") or []
                seen = {__import__("hashlib").sha1(norm_q(q).encode()).hexdigest()[:12] for q in existing}
                fresh = []
                for c in cands[:k]:
                    errs = validate(c, seen)
                    if not errs:
                        fresh.append(c)
                if fresh:
                    with lock:
                        rows[idx].setdefault("candidates", []).extend(fresh)
                        rows[idx]["topup_round"] = rows[idx].get("topup_round", 0) + 1
                        rows[idx]["topup_model"] = args.model
                        rows[idx]["topup_prompt_version"] = TOPUP_PROMPT_VERSION
                        rows[idx]["count_mismatch"] = len(
                            [c for c in rows[idx]["candidates"] if not c.get("_errors")]) != TARGET
                        with results_path.open("a", encoding="utf-8") as f:
                            f.write(json.dumps({"idx": idx, "file_id": fid, "candidates": fresh,
                                                "model": args.model, "prompt_version": TOPUP_PROMPT_VERSION,
                                                "at": datetime.now(timezone.utc).isoformat()},
                                               ensure_ascii=False) + "\n")
                        added["images"] += 1
                        added["questions"] += len(fresh)
                    print(f"  +{len(fresh)}/{k} {name} ({wall} ms)", flush=True)
                else:
                    print(f"  +0/{k} {name} (no valid new candidate) {last_err}", flush=True)
                return
            except Exception as e:  # noqa: BLE001 - recorded, retried, never fatal
                last_err = f"{type(e).__name__}: {e}"
                if "429" in last_err or "temporarily unavailable" in last_err.lower():
                    limiter.cooldown(60)
                time.sleep(2 * (attempt + 1))
        with lock:
            added["failed"] += 1
        print(f"  FAILED {name}: {last_err}", flush=True)

    with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        list(ex.map(work, todo))

    # Atomic rewrite: the batch file stays valid if this process dies mid-run.
    tmp_rows = rows_path.with_suffix(".jsonl.topup")
    with tmp_rows.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    tmp_rows.replace(rows_path)

    still = sum(1 for r in rows
                if len([c for c in r.get("candidates") or [] if not c.get("_errors")]) < TARGET)
    still_empty = sum(1 for r in rows if not [c for c in r.get("candidates") or [] if not c.get("_errors")])
    manifest = {
        "batch": args.batch, "model": args.model, "prompt_version": TOPUP_PROMPT_VERSION,
        "concurrency": args.concurrency, "rpm": args.rpm,
        "images_short_at_start": len(todo), "images_gained": added["images"],
        "questions_added": added["questions"], "failed": added["failed"],
        "images_still_short": still, "images_still_empty": still_empty,
        "started_at": started, "finished_at": datetime.now(timezone.utc).isoformat(),
    }
    (out_dir / "topup-manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    print(json.dumps(manifest, indent=1))
    return 0 if still == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
