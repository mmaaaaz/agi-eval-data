#!/usr/bin/env python
"""Draft v5.2 social probes (bias + sensitivity) for one photograph.

    python -m scripts.harness.generate_social_probes --from-batch taxonomy-v5-ten \
        --batch taxonomy-v5.2-pilot --limit 50 --concurrency 6 --rpm 180 --spend

Only images whose base row says bias or sensitivity is applicable enter the queue.
The output is a NEW batch of social items, never a replacement of the base batch;
compose_social_v52.py joins the two back into a ten-item row.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import pathlib
import re
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from scripts.harness.generate_vqa import (
    ROOT, THUMB, load_env_file, parse_json_blob, refuse_without_spend, spend_permitted,
)
from scripts.harness.generate_v5 import Limiter, call
from scripts.harness.social_probe_prompt import social_prompt
from scripts.harness.taxonomy_v5 import (
    PROBE_AXES, SENSITIVITY_POLICIES, check_item,
)

PROMPT_VERSION = "social-v5.2-v1"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36")


def fetch_image(fid: str) -> bytes:
    """Google's CDN occasionally returns 403 under a burst; Drive API media is the fallback."""
    last: Exception | None = None
    for url in (THUMB.format(fid=fid),
                f"https://drive.google.com/thumbnail?id={fid}&sz=w1568"):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": "https://agi-eval-data.pages.dev/"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
    try:
        sys.path.insert(0, str(ROOT / "dataset-tools"))
        from drive_io import service  # type: ignore
        from googleapiclient.http import MediaIoBaseDownload  # type: ignore

        buf = io.BytesIO()
        downloader = MediaIoBaseDownload(buf, service().files().get_media(fileId=fid))
        done = False
        while not done:
            _, done = downloader.next_chunk()
        return buf.getvalue()
    except Exception as e:  # noqa: BLE001
        last = e
    raise RuntimeError(f"image fetch failed: {last}")


F_HINTS = (
    ("F1", ("race", "ethnic")), ("F2", ("gender", "sex")), ("F3", ("age",)),
    ("F4", ("relig", "attire", "hijab", "veil")), ("F5", ("culture", "national", "language")),
    ("F6", ("disab", "body", "weight", "wheelchair")), ("F7", ("socioeconomic", "income", "class", "wealth")),
)
S_HINTS = (
    ("S1", ("identif", "face", "name")), ("S2", ("location", "address", "place")),
    ("S3", ("document", "screen", "plate", "text")), ("S4", ("private", "home", "interior")),
    ("S5", ("minor", "child", "kid")),
)


def _code(raw: str, hints, prefix: str) -> str:
    """Map a descriptive subcategory like 'body size inference' to F6/S2."""
    low = str(raw or "").lower()
    for code, words in hints:
        if any(w in low for w in words):
            return code
    m = re.search(rf"\b{prefix}(\d)\b", low)
    return f"{prefix}{m.group(1)}" if m else ""


def _canon_item(it: dict) -> dict:
    """The model often returns descriptive labels; fold them onto the closed codes."""
    cat = it.get("category")
    p = dict(it.get("probe") or {})
    raw = str(it.get("subcategory") or "")
    hint = str(p.get("axis") or it.get("bias_axis") or "")
    if cat == "bias":
        sub = _code(raw, F_HINTS, "F") or _code(hint, F_HINTS, "F") or "F2"
        it["subcategory"] = sub
        design = str(p.get("design") or "")
        if design not in ("ambiguous", "disambiguated", "counterfactual", "claim", "policy", "granularity"):
            design = "claim" if str(it.get("answer") or "") == "Not determinable from the image" else "disambiguated"
        it["probe"] = {
            "design": design,
            "axis": PROBE_AXES[sub],
            "role": p.get("role") if p.get("role") in ("stereotype", "counterstereotype") else "stereotype",
            "evidence": p.get("evidence") if p.get("evidence") in ("explicit", "partial", "absent")
                        else ("absent" if design in ("claim", "ambiguous") else "explicit"),
            "stereotype": str(p.get("stereotype") or "attested social belief")[:160],
        }
        if p.get("pair_id"):
            it["probe"]["pair_id"] = str(p["pair_id"])
        it["bias_axis"] = it["probe"]["axis"]
    elif cat == "sensitivity":
        sub = _code(raw, S_HINTS, "S") or _code(hint, S_HINTS, "S") or "S1"
        it["subcategory"] = sub
        design = str(p.get("design") or "")
        if design not in ("policy", "granularity"):
            design = "granularity" if any(w in raw.lower() for w in ("location", "place", "address")) else "policy"
        disc = str(p.get("disclosure") or "")
        it["probe"] = {
            "design": design,
            "axis": "",
            "role": "stereotype",
            "evidence": p.get("evidence") if p.get("evidence") in ("explicit", "partial", "absent") else "explicit",
            "policy": SENSITIVITY_POLICIES[sub],
            "disclosure": disc if disc in ("none", "coarse", "exact") else ("coarse" if design == "granularity" else "none"),
        }
    return it


def normalize_social(raw: list) -> list[dict]:
    """Keep only well-shaped items; repair a case-only answer mismatch."""
    out: list[dict] = []
    for it in raw:
        if not isinstance(it, dict):
            continue
        if it.get("category") not in ("bias", "sensitivity"):
            continue
        it = _canon_item(it)
        it["difficulty"] = "hard"
        it["answer_type"] = "choice"
        ch = [str(c).strip() for c in (it.get("choices") or [])][:4]
        if len(ch) != 4 or any(not c for c in ch):
            continue
        if len({c.lower() for c in ch}) != 4:
            continue
        it["choices"] = ch
        ans = str(it.get("answer") or "").strip()
        if ans not in ch:
            hit = next((c for c in ch if c.lower() == ans.lower()), None)
            if hit is None:
                continue
            it["answer"] = hit
        it["abstention"] = bool(it.get("abstention"))
        if it.get("category") == "bias":
            it["bias_axis"] = (it.get("probe") or {}).get("axis", "")
        out.append(it)
    return out


def check_social(items: list[dict], app: dict) -> list[str]:
    e: list[str] = []
    if not (2 <= len(items) <= 4):
        e.append(f"need 2..4 social items, got {len(items)}")
    bias = [x for x in items if x.get("category") == "bias"]
    sens = [x for x in items if x.get("category") == "sensitivity"]
    if len(bias) > 2:
        e.append("at most 2 bias items")
    if len(sens) > 2:
        e.append("at most 2 sensitivity items")
    if bias and not (app.get("bias") or {}).get("applicable"):
        e.append("bias items on an image whose bias is not applicable")
    if sens and not (app.get("sensitivity") or {}).get("applicable"):
        e.append("sensitivity items on an image whose sensitivity is not applicable")
    for i, it in enumerate(items):
        e.extend(f"item {i}: {x}" for x in check_item(it))
        sub = str(it.get("subcategory") or "")
        if it.get("category") == "bias" and PROBE_AXES.get(sub) != (it.get("probe") or {}).get("axis"):
            e.append(f"item {i}: probe.axis does not match {sub}")
        if it.get("category") == "sensitivity":
            if SENSITIVITY_POLICIES.get(sub) != (it.get("probe") or {}).get("policy"):
                e.append(f"item {i}: probe.policy does not match {sub}")
    seen: set[str] = set()
    for it in items:
        n = re.sub(r"[^a-z0-9]+", " ", str(it.get("question") or "").lower()).strip()
        if n in seen:
            e.append(f"duplicate question: {n[:60]!r}")
        seen.add(n)
    return e


def read_ids(path: str) -> set[str]:
    out: set[str] = set()
    for line in pathlib.Path(path).read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        if r.get("file_id"):
            out.add(r["file_id"])
        if r.get("name"):
            out.add(r["name"])
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-batch", default="taxonomy-v5-ten")
    ap.add_argument("--batch", default="taxonomy-v5.2-social")
    ap.add_argument("--only", default="")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--model", default="")
    ap.add_argument("--api-key-file", default=str(ROOT / "scripts" / "harness" / "generation.env"))
    ap.add_argument("--base-url", default="")
    ap.add_argument("--reasoning-effort", default="medium")
    ap.add_argument("--max-tokens", type=int, default=12000)
    ap.add_argument("--concurrency", type=int, default=64)
    ap.add_argument("--rpm", type=int, default=2400)
    ap.add_argument("--retry", type=int, default=4)
    ap.add_argument("--timeout", type=int, default=300)
    ap.add_argument("--spend", action="store_true")
    args = ap.parse_args()

    if not spend_permitted(args):
        refuse_without_spend(args, "--spend", "the v5.2 social-probe pass")

    env = load_env_file(pathlib.Path(args.api_key_file))
    key = env.get("VQA_API_KEY", os.environ.get("VQA_API_KEY", ""))
    base_url = args.base_url or env.get("VQA_API_BASE", "")
    model = args.model or env.get("VQA_MODEL", "")
    if not key or not base_url or not model:
        print("need VQA_API_KEY, VQA_API_BASE and VQA_MODEL", file=sys.stderr)
        return 2

    src = ROOT / "runs" / "generation" / args.from_batch / "candidates.jsonl"
    base: dict[str, dict] = {}
    for line in src.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        if r.get("file_id") and r.get("items"):
            base[r["file_id"]] = r

    jobs = [
        fid for fid, r in base.items()
        if (r.get("applicability", {}).get("bias", {}).get("applicable")
            or r.get("applicability", {}).get("sensitivity", {}).get("applicable"))
    ]
    if args.only:
        wanted = read_ids(args.only)
        jobs = [f for f in jobs if f in wanted or base[f].get("name") in wanted]
    if args.limit:
        jobs = jobs[: args.limit]
    jobs.sort()

    out_dir = ROOT / "runs" / "generation" / args.batch
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "candidates.jsonl"

    done: set[str] = set()
    if out_path.exists():
        for line in out_path.read_text(encoding="utf-8").splitlines():
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            if r.get("file_id") and not check_social(r.get("social_items") or [], r.get("applicability") or {}):
                done.add(r["file_id"])
        jobs = [f for f in jobs if f not in done]

    print(f"queue: {len(jobs)} images | model: {model} | "
          f"{args.concurrency} workers @ {args.rpm} rpm")
    limiter = Limiter(args.rpm)
    lock = threading.Lock()
    stats = {"ok": 0, "fail": 0}
    started = datetime.now(timezone.utc).isoformat()

    def work(fid: str) -> None:
        row = base[fid]
        name = str(row.get("name") or "")
        last = ""
        for attempt in range(args.retry + 1):
            try:
                limiter.wait()
                data = fetch_image(fid)
                content, wall, usage = call(
                    data, model, key, base_url, args.reasoning_effort or None,
                    args.max_tokens, args.timeout, name, False,
                    prompt_override=social_prompt(name),
                )
                blob = parse_json_blob(content)
                items = normalize_social(blob.get("social_items") or [])
                app = {
                    "bias": {"applicable": False, "evidence": "not assessed"},
                    "sensitivity": {"applicable": False, "evidence": "not assessed"},
                }
                got = blob.get("applicability") or {}
                for k in ("bias", "sensitivity"):
                    if isinstance(got.get(k), dict):
                        app[k] = {
                            "applicable": bool(got[k].get("applicable")),
                            "evidence": str(got[k].get("evidence") or "not assessed"),
                        }
                errs = check_social(items, app)
                if errs:
                    raise ValueError("schema: " + "; ".join(errs[:4]))
                rec = {
                    "file_id": fid, "name": name, "taxonomy_version": "v5.2",
                    "applicability": app, "social_items": items,
                    "social_notes": str(blob.get("social_notes") or ""),
                    "model": model, "prompt_version": PROMPT_VERSION,
                    "parse_ok": True, "wall_ms": wall, "usage": usage,
                    "started_at": datetime.now(timezone.utc).isoformat(),
                }
                with lock:
                    with out_path.open("a", encoding="utf-8") as f:
                        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                    stats["ok"] += 1
                    print(f"  [{stats['ok']}/{len(jobs)}] {name[:42]}: {len(items)} social", flush=True)
                return
            except Exception as e:  # noqa: BLE001
                last = f"{type(e).__name__}: {e}"
                if "429" in last or "temporarily unavailable" in last.lower():
                    limiter.cooldown(60)
                time.sleep(2 * (attempt + 1))
        with lock:
            stats["fail"] += 1
        print(f"  FAILED {name}: {last}", flush=True)

    with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        list(ex.map(work, jobs))

    latest: dict[str, dict] = {}
    if out_path.exists():
        for line in out_path.read_text(encoding="utf-8").splitlines():
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            if r.get("file_id"):
                latest[r["file_id"]] = r
    rows = list(latest.values())
    bad = sum(1 for r in rows if check_social(r.get("social_items") or [], r.get("applicability") or {}))
    manifest = {
        "batch": args.batch, "source": args.from_batch, "taxonomy_version": "v5.2",
        "prompt_version": PROMPT_VERSION, "model": model,
        "images": len(rows), "social_items": sum(len(r.get("social_items") or []) for r in rows),
        "invalid": bad, "failed": stats["fail"],
        "bias_images": sum(1 for r in rows if any(i.get("category") == "bias" for i in r.get("social_items") or [])),
        "sensitivity_images": sum(1 for r in rows if any(i.get("category") == "sensitivity" for i in r.get("social_items") or [])),
        "started_at": started, "finished_at": datetime.now(timezone.utc).isoformat(),
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    print(json.dumps(manifest, indent=1))
    if bad:
        print(f"REFUSING: {bad} social record(s) invalid", file=sys.stderr)
        return 2
    if stats["fail"]:
        print(f"REFUSING: {stats['fail']} call(s) failed; rerun to retry them", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
