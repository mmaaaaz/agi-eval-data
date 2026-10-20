#!/usr/bin/env python3
"""Generate VQA candidates across the ledger with a vision model, one image per call.

WHY THIS EXISTS
---------------
The dataset plan (kept privately, outside this repository) is
model-drafted questions, human-reviewed picks, everything recorded. This runner is
the drafting half: it walks a list of ledger images, asks the model for candidates
in a strict JSON contract, validates every candidate against the closed taxonomy
sets, and writes an append-only, resumable record of exactly what happened.

Every row keeps the raw response, the parsed JSON, the model id, the prompt
version, the image hash, per-candidate validation errors and flags. Nothing is
silently dropped; a failed call is a recorded row with an error.

SPEND
-----
Every entry point that calls a model refuses to run without --spend (house rule).
A :free model id bills nothing, but the gate still applies so nobody can point this
at a paid model by accident.

RUN
---
    python scripts/harness/generate_vqa.py --batch pilot-40 \
        --images runs/generation/pilot-40/images.jsonl \
        --model <vision-model-id> \
        --base-url <openai-compatible-base> --concurrency 4 --spend

Transport note: the call goes through `hermes chat` with the provider's stored
credential; this runner never handles an API key.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

try:
    from .spend import refuse_without_spend, spend_permitted
except ImportError:  # direct script execution
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from spend import refuse_without_spend, spend_permitted

ROOT = Path(__file__).resolve().parents[2]
PROMPT_VERSION = "vqa-draft-v2"

# The key lives in scripts/harness/generation.env (gitignored), format KEY=VALUE.
DEFAULT_ENV = Path(__file__).resolve().parent / "generation.env"


def load_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out

CAPS = [
    "G1 depth and occlusion", "G2 relative size and distance", "G3 shape and structure",
    "G4 lines and angles", "G5 perspective and viewpoint", "G6 spatial layout",
    "G7 symmetry and pattern", "G8 fit and clearance",
    "P1 material properties", "P2 support and stability", "P3 contact and containment",
    "P4 forces and load paths", "P5 dynamics and prediction", "P6 light and shadow",
    "P7 fluids, air and heat", "P8 function and affordance",
    "B1 tipping and balance", "B2 shadows as a sun cue", "B3 rolling and sliding",
    "B4 passage and collision", "PERC perception only",
]
LEVELS = [
    "L1 perception only", "L2 one judgement", "L3 two linked steps",
    "L4 prediction or counterfactual", "L5 multi-step plus outside knowledge",
]
DOMAINS = [
    "D1 urban streets and roads", "D2 transport hubs and vehicles", "D3 architecture and buildings",
    "D4 religious and cultural sites", "D5 health and medical settings",
    "D6 engineering, tech and expos", "D7 markets, food and retail",
    "D8 indoor home and office", "D9 nature and agriculture", "D10 crowds and events",
    "D11 industrial and construction",
]
VALID_CAPS = {c.split()[0] for c in CAPS}
VALID_LEVELS = {c.split()[0] for c in LEVELS}
VALID_DOMAINS = {c.split()[0] for c in DOMAINS}

THUMB = "https://lh3.googleusercontent.com/d/{fid}=w1568"


def prompt(n: int, name: str) -> str:
    return (
        "You write visual questions for a benchmark about whether models truly see "
        "an image. You are given ONE photograph.\n\n"
        f"Return ONLY a JSON object with exactly {n} candidates, no markdown, no prose:\n"
        '{"candidates":[{"question":"...","choices":["...","...","...","..."],'
        '"answer":"<exactly one of the choices>","capability":"<code>","level":"<code>",'
        '"domain":"<code>","grounding":"<one sentence naming what in the image proves the answer>"}]}\n\n'
        "Rules:\n"
        "- The question must be answerable from the photograph alone. No outside knowledge.\n"
        "- Exactly 4 distinct, short choices (each 1-6 words). The answer must equal one choice\n"
        "  exactly, character for character.\n"
        "- Prefer questions a careless model would get wrong: counting under clutter, left/right,\n"
        "  small text, materials, absence of an expected object, light direction.\n"
        "- Do not mention the photograph itself ('in this image'); ask about the world in it.\n"
        "- The grounding sentence must cite visible evidence, not the file name.\n\n"
        "Choose codes by their MEANING, not by habit:\n"
        "CAPABILITY (use the one the question actually demands):\n"
        "  G1 depth and occlusion (what is in front of what); G2 relative size and distance;\n"
        "  G3 shape and structure; G4 lines and angles; G5 perspective and viewpoint;\n"
        "  G6 spatial layout (left/right/above/below/inside); G7 symmetry and pattern;\n"
        "  G8 fit and clearance.\n"
        "  P1 material properties; P2 support and stability; P3 contact and containment;\n"
        "  P4 forces and load paths; P5 dynamics and prediction; P6 light and shadow;\n"
        "  P7 fluids, air and heat; P8 function and affordance.\n"
        "  B1 tipping and balance; B2 shadows as a sun cue; B3 rolling and sliding;\n"
        "  B4 passage and collision. Use a B code ONLY when the question is really about that\n"
        "  geometry-plus-physics pair; otherwise prefer G, P or PERC.\n"
        "  PERC perception only (what is present, counting, reading text, colours).\n"
        "  Most questions should be PERC, G or P. Never use B for simple counting.\n"
        "LEVEL (the reasoning depth the question demands):\n"
        "  L1 perception only; L2 one judgement; L3 two linked steps;\n"
        "  L4 prediction or counterfactual; L5 multi-step plus outside knowledge.\n"
        "DOMAIN (the scene):\n"
        "  D1 urban streets and roads; D2 transport hubs and vehicles; D3 architecture and\n"
        "  buildings; D4 religious and cultural sites; D5 health and medical settings;\n"
        "  D6 engineering, tech and expos; D7 markets, food and retail; D8 indoor home and\n"
        "  office; D9 nature and agriculture; D10 crowds and events; D11 industrial and construction.\n"
        f"- The file name is {name}; do not use it as evidence.\n"
    )


def parse_json_blob(text: str) -> dict:
    """Balanced-brace scan for the first top-level JSON object."""
    start = text.find("{")
    if start < 0:
        raise ValueError("no JSON object in response")
    depth, in_str, esc = 0, False, False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return json.loads(text[start : i + 1])
    raise ValueError("unbalanced JSON braces")


def norm_q(q: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", "", q.lower())).strip()


def validate(cand: dict, seen_hashes: set[str]) -> list[str]:
    errs = []
    q = (cand.get("question") or "").strip()
    ch = cand.get("choices")
    if not (10 <= len(q) <= 220):
        errs.append("question_length")
    if not (isinstance(ch, list) and len(ch) == 4 and all(isinstance(x, str) and x.strip() for x in ch)):
        errs.append("choices_shape")
    elif len({c.strip().lower() for c in ch}) != 4:
        errs.append("choices_duplicate")
    else:
        ans = cand.get("answer")
        if not (isinstance(ans, str) and ans in [c for c in ch]):
            errs.append("answer_not_in_choices")
    if cand.get("capability") not in VALID_CAPS:
        errs.append("capability_invalid")
    if cand.get("level") not in VALID_LEVELS:
        errs.append("level_invalid")
    if cand.get("domain") not in VALID_DOMAINS:
        errs.append("domain_invalid")
    if len((cand.get("grounding") or "").strip()) < 20:
        errs.append("grounding_short")
    h = hashlib.sha1(norm_q(q).encode()).hexdigest()[:12]
    if h in seen_hashes:
        errs.append("duplicate_question")
    seen_hashes.add(h)
    return errs


def download(fid: str, dest: Path) -> tuple[int, int]:
    import socket
    import urllib.error
    import urllib.request

    last: Exception | None = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(THUMB.format(fid=fid), timeout=120) as r:
                data = r.read()
            dest.write_bytes(data)
            w = h = 0
            try:
                from PIL import Image

                with Image.open(io.BytesIO(data)) as im:
                    w, h = im.size
            except Exception:
                pass
            return len(data), w, h
        except Exception as e:  # DNS, 5xx, truncation: all retryable
            last = e
            wait = (20, 45, 90)[min(attempt, 2)]
            print(f"  retry download {fid[:12]} in {wait}s: {type(e).__name__}: {str(e)[:80]}")
            time.sleep(wait)
    raise last  # type: ignore[misc]


_pace_lock = threading.Lock()
_next_slot = [0.0]
_cool_lock = threading.Lock()
_cooldown_until = [0.0]


def pace(rpm: int) -> None:
    """Global request pacing shared by all workers (token bucket, one slot at a time)."""
    if rpm <= 0:
        return
    with _pace_lock:
        now = time.time()
        slot = max(now, _next_slot[0])
        _next_slot[0] = slot + 60.0 / rpm
    delay = slot - time.time()
    if delay > 0:
        time.sleep(delay)


def cooldown_wait() -> None:
    """After an upstream 429, every worker pauses together instead of hammering."""
    with _cool_lock:
        delay = _cooldown_until[0] - time.time()
    if delay > 0:
        time.sleep(delay)


def set_cooldown(seconds: float) -> None:
    with _cool_lock:
        _cooldown_until[0] = max(_cooldown_until[0], time.time() + seconds)


def compact_rows(path: Path) -> tuple[int, int]:
    """Keep the last row per file_id; failed rows re-run, successes win. Returns (kept, dropped)."""
    if not path.exists():
        return (0, 0)
    lines = [l for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
    if not lines:
        return (0, 0)
    order: list[str] = []
    latest: dict[str, str] = {}
    for line in lines:
        fid = json.loads(line)["file_id"]
        if fid not in latest:
            order.append(fid)
        latest[fid] = line
    if len(order) == len(lines):
        return (len(order), 0)
    path.write_text("\n".join(latest[f] for f in order) + "\n", encoding="utf-8")
    return (len(order), len(lines) - len(order))


def call_model(image_path: Path, model: str, provider: str, n: int, name: str, timeout: int) -> tuple[str, str, int]:
    cmd = [
        "hermes", "--provider", provider, "-m", model, "--ignore-rules", "chat",
        "-Q", "-q", prompt(n, name), "--image", str(image_path),
    ]
    t0 = time.time()
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, encoding="utf-8", errors="replace")
    wall = int((time.time() - t0) * 1000)
    session = ""
    m = re.search(r"session_id:\s*(\S+)", proc.stderr or "")
    if m:
        session = m.group(1)
    return proc.stdout or "", session, wall


def call_api(
    image_bytes: bytes,
    mime: str,
    model: str,
    api_key: str,
    base_url: str,
    effort: str | None,
    max_tokens: int,
    timeout: int,
    n: int,
    name: str,
) -> tuple[str, str, int, dict]:
    """Direct OpenAI-compatible call: no Hermes session, no agent prompt."""
    import base64
    import urllib.error
    import urllib.request

    b64 = base64.b64encode(image_bytes).decode("ascii")
    payload: dict = {
        "model": model,
        "temperature": 0,
        "max_tokens": max_tokens,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt(n, name)},
                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
                ],
            }
        ],
    }
    if effort:
        payload["reasoning_effort"] = effort

    url = base_url.rstrip("/") + "/chat/completions"

    def send(p: dict) -> dict:
        req = urllib.request.Request(
            url,
            data=json.dumps(p).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
                # Some gateways reject non-browser user agents.
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
                ),
            },
        )
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))

    t0 = time.time()
    try:
        d = send(payload)
    except urllib.error.HTTPError as e:
        # Some gateways accept the OpenAI `reasoning_effort` only on newer builds;
        # if it is refused, retry once without it and keep the row honest about it.
        if effort and e.code in (400, 422):
            payload.pop("reasoning_effort", None)
            d = send(payload)
        else:
            raise
    wall = int((time.time() - t0) * 1000)
    content = ((d.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
    if isinstance(content, list):
        content = "".join(part.get("text", "") if isinstance(part, dict) else str(part) for part in content)
    return content, str(d.get("id") or ""), wall, d.get("usage") or {}


def main() -> int:
    ap = argparse.ArgumentParser(description="Draft VQA candidates for ledger images.")
    ap.add_argument("--images", required=True, help="JSONL rows: {file_id, name}")
    ap.add_argument("--batch", required=True, help="batch name; output goes to runs/generation/<batch>/")
    ap.add_argument("--model", default="")
    ap.add_argument("--endpoint", default="", help="label recorded on every row, e.g. the lane name")
    ap.add_argument("--provider", default="")
    ap.add_argument("--transport", choices=["auto", "api", "cli"], default="auto",
                    help="api = direct OpenAI-compatible HTTP (fast); cli = hermes chat; auto picks api when a key is found")
    ap.add_argument("--api-key-file", default=str(DEFAULT_ENV), help="KEY=VALUE file, gitignored")
    ap.add_argument("--base-url", default="")
    ap.add_argument("--reasoning-effort", default="low",
                    help="low|medium|high|max; pass an empty string to omit the parameter")
    ap.add_argument("--max-tokens", type=int, default=32000)
    ap.add_argument("--candidates", type=int, default=5, help="candidates to request per image")
    ap.add_argument("--raw-mode", choices=["all", "failures", "none"], default="all",
                    help="store raw responses: all, only failures, or none (preview is always kept)")
    ap.add_argument("--concurrency", type=int, default=4)
    ap.add_argument("--rpm", type=int, default=30,
                    help="global model requests per minute across workers (0 = unlimited)")
    ap.add_argument("--cooldown-429", type=float, default=180,
                    help="seconds ALL workers pause after an upstream 429 / 'temporarily unavailable'")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--retry", type=int, default=2, help="extra attempts per image")
    ap.add_argument("--timeout", type=int, default=900, help="per-call seconds")
    ap.add_argument("--dry-run", action="store_true", help="assemble prompts only, no calls")
    ap.add_argument("--allow-short", action="store_true",
                    help="do not fail when an image ends with fewer than --candidates valid questions; "
                         "off by default, because a short image is a broken image")
    ap.add_argument("--spend", action="store_true", help="required by house rule even for zero-priced models")
    args = ap.parse_args()

    if not args.dry_run and not spend_permitted(args):
        refuse_without_spend(args, "--spend", f"the {args.model} drafting run")

    env = load_env_file(Path(args.api_key_file))
    api_key = env.get("VQA_API_KEY", os.environ.get("VQA_API_KEY", ""))
    base_url = args.base_url or env.get("VQA_API_BASE", os.environ.get("VQA_API_BASE", ""))
    if not args.model:
        args.model = env.get("VQA_MODEL", os.environ.get("VQA_MODEL", ""))
    if not args.model:
        print("set --model or VQA_MODEL in the env file", file=sys.stderr)
        return 2
    transport = args.transport
    if transport == "auto":
        transport = "api" if api_key else "cli"
    if transport == "api" and not api_key:
        raise SystemExit(
            f"--transport api needs a key: put VQA_API_KEY=... in {args.api_key_file}"
        )
    print(f"transport: {transport} | model: {args.model} | effort: {args.reasoning_effort or 'default'}")

    out_dir = ROOT / "runs" / "generation" / args.batch
    raw_dir = out_dir / "raw"
    if not args.dry_run:
        raw_dir.mkdir(parents=True, exist_ok=True)
    rows_path = out_dir / "candidates.jsonl"

    items = [json.loads(l) for l in Path(args.images).read_text(encoding="utf-8").splitlines() if l.strip()]
    if args.limit:
        items = items[: args.limit]

    done: set[str] = set()
    seen_hashes: set[str] = set()
    if rows_path.exists():
        for line in rows_path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                row = json.loads(line)
                # Only a PARSED row counts as done: a failed attempt must be retried
                # on the next run, or the corpus silently loses those images.
                if row.get("parse_ok"):
                    done.add(row["file_id"])
                for c in row.get("candidates", []):
                    seen_hashes.add(hashlib.sha1(norm_q(c.get("question", "")).encode()).hexdigest()[:12])
    todo = [it for it in items if it["file_id"] not in done]
    print(f"batch {args.batch}: {len(items)} images, {len(done)} done, {len(todo)} to draft")
    if args.dry_run:
        print(prompt(args.candidates, todo[0]["name"]) if todo else "(nothing to do)")
        return 0
    if not todo:
        return 0

    lock = threading.Lock()
    counters = {"ok": 0, "fail": 0}
    started = datetime.now(timezone.utc).isoformat()

    def work(it: dict) -> None:
        fid, name = it["file_id"], it["name"]
        row = {
            "file_id": fid, "name": name,
            "model": args.model, "provider": args.provider, "endpoint": args.endpoint or None,
            "prompt_version": PROMPT_VERSION,
            "transport": transport, "reasoning_effort": args.reasoning_effort or None,
            "requested_candidates": args.candidates,
            "started_at": datetime.now(timezone.utc).isoformat(),
        }
        with tempfile.TemporaryDirectory() as td:
            img = Path(td) / "img.jpg"
            try:
                nbytes, w, h = download(fid, img)
                row.update(image_bytes=nbytes, width=w, height=h,
                           image_sha256=hashlib.sha256(img.read_bytes()).hexdigest())
            except Exception as e:
                row.update(error=f"download: {e}", candidates=[], parse_ok=False)
                with lock:
                    counters["fail"] += 1
                    with rows_path.open("a", encoding="utf-8") as f:
                        f.write(json.dumps(row, ensure_ascii=False) + "\n")
                return

            attempts = 1 + max(0, args.retry)
            for attempt in range(attempts):
                try:
                    pace(args.rpm)
                    cooldown_wait()
                    if transport == "api":
                        out, rid, wall, usage = call_api(
                            img.read_bytes(), "image/jpeg", args.model, api_key, base_url,
                            args.reasoning_effort or None, args.max_tokens, args.timeout,
                            args.candidates, name,
                        )
                        row.update(wall_ms=wall, session_id=rid, usage=usage, attempt=attempt + 1)
                    else:
                        out, session, wall = call_model(
                            img, args.model, args.provider, args.candidates, name, args.timeout
                        )
                        row.update(wall_ms=wall, session_id=session, attempt=attempt + 1)
                    parsed = parse_json_blob(out)
                    cands = parsed.get("candidates", [])
                    row.update(
                        parse_ok=True,
                        response_sha256=hashlib.sha256(out.encode("utf-8")).hexdigest(),
                        response_preview=(out or "")[:400],
                    )
                    if args.raw_mode == "all":
                        raw_path = raw_dir / f"{fid}.txt"
                        raw_path.write_text(out, encoding="utf-8")
                        row["raw_path"] = str(raw_path.relative_to(ROOT))
                    break
                except Exception as e:
                    row.update(parse_ok=False, error=f"{type(e).__name__}: {e}", attempt=attempt + 1)
                    if attempt + 1 == attempts:
                        cands = []
                        if args.raw_mode in ("all", "failures") and "out" in locals() and out:
                            raw_path = raw_dir / f"{fid}.failed.txt"
                            raw_path.write_text(out, encoding="utf-8")
                            row["raw_path"] = str(raw_path.relative_to(ROOT))
                    else:
                        # Back off by failure type: rate limits need far more room than
                        # a transient socket error.
                        msg = str(e)
                        if "429" in msg or "temporarily unavailable" in msg.lower():
                            set_cooldown(args.cooldown_429)
                            wait = 5
                        elif "getaddrinfo" in msg or "URLError" in type(e).__name__:
                            wait = 20
                        else:
                            wait = 5 * (2 ** attempt)
                        time.sleep(wait)
            for c in cands:
                errs = validate(c, seen_hashes)
                c["_errors"] = errs
                c["_ok"] = not errs
            row["candidates"] = cands
            row["count_mismatch"] = len(cands) != args.candidates
            with lock:
                counters["ok" if row.get("parse_ok") else "fail"] += 1
                with rows_path.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(row, ensure_ascii=False) + "\n")
                print(f"  [{counters['ok'] + counters['fail']}/{len(todo)}] {name}: "
                      f"{len(cands)} cands, parse_ok={row.get('parse_ok')}, {row.get('wall_ms', 0)} ms")

    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        list(ex.map(work, todo))

    kept, dropped = compact_rows(rows_path)
    # THE COUNT IS PART OF THE SCHEMA. v2 asked for five and validated each
    # candidate, but never the count, so 23,465 images shipped short and the run
    # still exited 0. A short image now fails the run unless --allow-short is
    # given explicitly, which makes the gap impossible to miss.
    short = empty = 0
    for line in rows_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        valid = [c for c in row.get("candidates") or [] if not c.get("_errors")]
        if len(valid) < args.candidates:
            short += 1
        if not valid:
            empty += 1
    manifest = {
        "batch": args.batch, "model": args.model, "provider": args.provider,
        "transport": transport, "base_url": (base_url if transport == "api" else "hermes-cli"),
        "reasoning_effort": args.reasoning_effort or None, "max_tokens": args.max_tokens,
        "rpm": args.rpm, "rows_kept": kept, "rows_compacted_away": dropped,
        "prompt_version": PROMPT_VERSION, "requested_candidates": args.candidates,
        "images": len(items), "drafted": len(done) + len(todo),
        "ok": counters["ok"], "failed": counters["fail"],
        "images_short": short, "images_empty": empty,
        "exact_count_enforced": not args.allow_short,
        "started_at": started, "finished_at": datetime.now(timezone.utc).isoformat(),
        "rows": str(rows_path.relative_to(ROOT)),
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    print(json.dumps(manifest, indent=1))
    if counters["fail"]:
        return 1
    if short and not args.allow_short:
        print(f"REFUSING: {short} image(s) have fewer than {args.candidates} valid questions "
              f"({empty} with none). Top them up or pass --allow-short.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
