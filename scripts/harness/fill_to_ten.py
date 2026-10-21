#!/usr/bin/env python
"""Complete every image to EXACTLY ten items, without discarding what exists.

    python -m scripts.harness.fill_to_ten --source taxonomy-v5 --batch taxonomy-v5-ten --spend

WHY THIS EXISTS
---------------
The owner locked the count: ten items per image, no more and no less, with the
category distribution free to follow the image. The v5 sweep produced a variable
count (6, 8, 10, 12) because each applicable category got two items. Those items are
good; throwing them away to regenerate ten from scratch would waste 365k drafts.

This pass keeps the existing items, trims an over-full image down to ten, and asks
the model only for the missing number, with the accepted questions shown so it
cannot duplicate them. The result is validated against taxonomy_v5 v5.1 and written
to a NEW batch; the source batch is never modified.

Distribution rules, all enforced by check_image():
  - exactly 10 items;
  - exactly 2 PERC control items;
  - every applicable category has at least one item, every rejected category none;
  - no `easy` item outside PERC; every applicable category has at least one `hard`.
"""
from __future__ import annotations

import argparse
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
    ROOT, THUMB, load_env_file, parse_json_blob, refuse_without_spend, spend_permitted,
)
from scripts.harness.generate_v5 import Limiter, call, normalize
from scripts.harness.taxonomy_v5 import (
    PERC_ITEMS, SUBCATEGORIES, TOTAL_ITEMS, check_image,
)

PROMPT_VERSION = "vqa-v5.1-fill-v1"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36")


def fill_prompt(name: str, existing: list[dict], need: int, missing_cats: list[str],
                allowed: list[str]) -> str:
    shown = "\n".join(
        f"{i}. [{it.get('category')}/{it.get('subcategory')}/{it.get('difficulty')}] {it.get('question')}"
        for i, it in enumerate(existing, 1)
    )
    return (
        "You are completing the item set for ONE photograph in a hard visual-reasoning benchmark. "
        "The photograph already has the items below. Write ONLY the missing items.\n\n"
        f"EXISTING ({len(existing)}):\n{shown}\n\n"
        f"Write EXACTLY {need} NEW items. Do not repeat or rephrase any existing question. "
        f"Categories allowed on this image: {', '.join(allowed)}.\n"
        f"Categories that still have ZERO items and must receive at least one: "
        f"{', '.join(missing_cats) if missing_cats else 'none (all already present)'}.\n"
        f"After merging, the image must hold exactly {TOTAL_ITEMS} items, of which exactly "
        f"{PERC_ITEMS} are category perc.\n\n"
        "HARDNESS: no `easy` item outside perc; every competence category needs at least one "
        "`hard` item. A hard item needs two chained visual inferences or a counterfactual, "
        "plausible near-miss choices, and an answer that a text-only model cannot guess.\n\n"
        "Rules: exactly 4 distinct short choices; answer equals one choice exactly; grounding is one "
        "sentence (<=20 words) naming the decisive visible evidence; never say 'in this image'; never "
        "use the file name. For bias never ask for race, ethnicity, religion, gender identity, "
        "nationality or exact age. For sensitivity never ask to transcribe a plate, document or name; "
        "the boundary answer must be exactly \"Not determinable from the image\".\n\n"
        "Return ONLY JSON: {\"items\":[{\"category\":\"physics\",\"subcategory\":\"P2\","
        "\"difficulty\":\"hard\",\"question\":\"...\",\"choices\":[\"...\",\"...\",\"...\",\"...\"],"
        "\"answer\":\"...\",\"answer_type\":\"choice\",\"grounding\":\"...\",\"abstention\":false}]}\n"
        f"(The file name is {name}; never use it as evidence.)\n"
    )


def trim_to_ten(app: dict, items: list[dict]) -> list[dict]:
    """Drop over-full categories down to ten, keeping the two PERC items and one per category."""
    perc = [x for x in items if x.get("category") == "perc"][:PERC_ITEMS]
    rest = [x for x in items if x.get("category") != "perc"]
    keep: list[dict] = list(perc)
    # one per applicable category first
    for cat, a in app.items():
        if cat == "perc" or not a.get("applicable"):
            continue
        chosen = next((x for x in rest if x.get("category") == cat), None)
        if chosen:
            keep.append(chosen)
    room = TOTAL_ITEMS - len(keep)
    # then fill remaining slots with hard items first, then any, preferring smaller categories
    pool = [x for x in rest if x not in keep]
    pool.sort(key=lambda x: (0 if x.get("difficulty") == "hard" else 1, x.get("category")))
    keep.extend(pool[:max(0, room)])
    return keep[:TOTAL_ITEMS]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="taxonomy-v5")
    ap.add_argument("--batch", default="taxonomy-v5-ten")
    ap.add_argument("--images", default=str(ROOT / "runs" / "generation" / "full-50k" / "images.jsonl"))
    ap.add_argument("--model", default="")
    ap.add_argument("--api-key-file", default=str(ROOT / "scripts" / "harness" / "generation.env"))
    ap.add_argument("--base-url", default="")
    ap.add_argument("--reasoning-effort", default="low")
    ap.add_argument("--max-tokens", type=int, default=12000)
    ap.add_argument("--concurrency", type=int, default=96)
    ap.add_argument("--rpm", type=int, default=3600)
    ap.add_argument("--retry", type=int, default=3)
    ap.add_argument("--timeout", type=int, default=300)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--spend", action="store_true")
    args = ap.parse_args()

    if not spend_permitted(args):
        refuse_without_spend(args, "--spend", "the v5.1 completion pass")

    env = load_env_file(pathlib.Path(args.api_key_file))
    key = env.get("VQA_API_KEY", os.environ.get("VQA_API_KEY", ""))
    base = args.base_url or env.get("VQA_API_BASE", "")
    if not args.model:
        args.model = env.get("VQA_MODEL", "")
    if not key or not base or not args.model:
        print("need VQA_API_KEY, VQA_API_BASE and VQA_MODEL", file=sys.stderr)
        return 2

    src = ROOT / "runs" / "generation" / args.source / "candidates.jsonl"
    out_dir = ROOT / "runs" / "generation" / args.batch
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "candidates.jsonl"

    best: dict[str, dict] = {}
    for line in src.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        fid = r.get("file_id")
        if not fid:
            continue
        cand = best.get(fid)
        if cand is None:
            best[fid] = r
            continue
        old_items, new_items = cand.get("items") or [], r.get("items") or []
        if (any(i.get("category") == "bias" for i in new_items),
                len(new_items)) > (any(i.get("category") == "bias" for i in old_items), len(old_items)):
            best[fid] = r
    print(f"source: {len(best)} image(s) with at least one row")

    done: set[str] = set()
    if out_path.exists():
        for line in out_path.read_text(encoding="utf-8").splitlines():
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not check_image(r):
                done.add(r["file_id"])
        print(f"resume: {len(done)} image(s) already at ten")

    names = {}
    for line in pathlib.Path(args.images).read_text(encoding="utf-8").splitlines():
        if line.strip():
            r = json.loads(line)
            names[r["file_id"]] = r.get("name", "")
    jobs = [fid for fid in best if fid not in done]
    if args.limit:
        jobs = jobs[: args.limit]
    print(f"to complete: {len(jobs)} | model: {args.model} | {args.concurrency} workers @ {args.rpm} rpm")

    limiter = Limiter(args.rpm)
    lock = threading.Lock()
    stats = {"ok": 0, "fail": 0, "kept": 0}
    started = datetime.now(timezone.utc).isoformat()

    def work(fid: str) -> None:
        row = best[fid]
        app = row.get("applicability") or {}
        items = list(row.get("items") or [])
        if len(items) > TOTAL_ITEMS:
            items = trim_to_ten(app, items)
        allowed = [c for c in SUBCATEGORIES if c != "perc" and app.get(c, {}).get("applicable")]
        allowed.append("perc")
        perc_have = sum(1 for x in items if x.get("category") == "perc")
        missing_cats = [c for c in allowed if c != "perc" and not any(x.get("category") == c for x in items)]
        need = TOTAL_ITEMS - len(items)
        last = ""
        if need == 0 and perc_have == PERC_ITEMS:
            merged = {**row, "taxonomy_version": "v5.1", "items": items}
            errs = check_image(merged)
            if not errs:
                with lock:
                    with out_path.open("a", encoding="utf-8") as f:
                        f.write(json.dumps({**merged, "name": names.get(fid, ""), "model": args.model,
                                            "prompt_version": PROMPT_VERSION, "parse_ok": True,
                                            "filled": 0, "wall_ms": 0}, ensure_ascii=False) + "\n")
                    stats["kept"] += 1
                    print(f"  [{stats['ok']+stats['kept']}/{len(jobs)}] {names.get(fid,fid)[:40]}: kept 10", flush=True)
                return
        for attempt in range(args.retry + 1):
            try:
                limiter.wait()
                req = urllib.request.Request(THUMB.format(fid=fid), headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=120) as r:
                    data = r.read()
                merged_items = list(items)
                last_wall, last_usage = 0, {}
                # A single call often returns fewer items than asked. Ask again for
                # the exact deficit rather than failing the image; two rounds cover
                # the observed shortfall without an unbounded call loop.
                for _round in range(2):
                    need_now = TOTAL_ITEMS - len(merged_items)
                    if need_now <= 0:
                        break
                    miss_now = [c for c in allowed if c != "perc"
                                and not any(x.get("category") == c for x in merged_items)]
                    content, last_wall, last_usage = call(
                        data, args.model, key, base, args.reasoning_effort or None,
                        args.max_tokens, args.timeout, names.get(fid, ""), False,
                        prompt_override=fill_prompt(names.get(fid, ""), merged_items, need_now, miss_now, allowed))
                    blob = parse_json_blob(content)
                    fresh = normalize({"taxonomy_version": "v5.1", "items": blob.get("items") or []}).get("items") or []
                    fresh = [x for x in fresh if not any(
                        re.sub(r"[^a-z0-9]+", " ", str(x.get("question", "")).lower()).strip()
                        == re.sub(r"[^a-z0-9]+", " ", str(it.get("question", "")).lower()).strip()
                        for it in merged_items)]
                    fresh = [x for x in fresh if x.get("category") in allowed][:need_now]
                    # The model sometimes returns the answer with different casing or a
                    # trailing qualifier. Repair it to the exact choice, or drop the item
                    # and let the next round supply a clean one.
                    repaired = []
                    for x in fresh:
                        ch = [str(c).strip() for c in (x.get("choices") or [])]
                        ans = str(x.get("answer") or "").strip()
                        if ch and ans not in ch:
                            hit = next((c for c in ch if c.lower() == ans.lower()), None)
                            if hit is None:
                                continue
                            x["answer"] = hit
                        repaired.append(x)
                    if not repaired:
                        break
                    merged_items.extend(repaired)
                merged = {**row, "taxonomy_version": "v5.1", "items": merged_items}
                if len(merged["items"]) > TOTAL_ITEMS:
                    merged["items"] = trim_to_ten(app, merged["items"])
                errs = check_image(merged)
                if errs:
                    raise ValueError("schema: " + "; ".join(errs[:4]))
                with lock:
                    with out_path.open("a", encoding="utf-8") as f:
                        f.write(json.dumps({**merged, "name": names.get(fid, ""), "model": args.model,
                                            "prompt_version": PROMPT_VERSION, "parse_ok": True,
                                            "filled": len(merged_items) - len(items), "wall_ms": last_wall,
                                            "usage": last_usage,
                                            "started_at": datetime.now(timezone.utc).isoformat()},
                                           ensure_ascii=False) + "\n")
                    stats["ok"] += 1
                    print(f"  [{stats['ok']+stats['kept']}/{len(jobs)}] {names.get(fid,fid)[:40]}: "
                          f"+{len(merged_items)-len(items)} ({last_wall} ms)", flush=True)
                return
            except Exception as e:  # noqa: BLE001
                last = f"{type(e).__name__}: {e}"
                if "429" in last or "temporarily unavailable" in last.lower():
                    limiter.cooldown(60)
                time.sleep(2 * (attempt + 1))
        with lock:
            stats["fail"] += 1
        print(f"  FAILED {names.get(fid, fid)}: {last}", flush=True)

    with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        list(ex.map(work, jobs))

    rows = []
    if out_path.exists():
        for line in out_path.read_text(encoding="utf-8").splitlines():
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    latest: dict[str, dict] = {}
    for r in rows:
        if r.get("file_id"):
            latest[r["file_id"]] = r
    rows = list(latest.values())
    bad = sum(1 for r in rows if check_image(r))
    manifest = {
        "batch": args.batch, "model": args.model, "prompt_version": PROMPT_VERSION,
        "taxonomy_version": "v5.1", "source": args.source,
        "images": len(rows), "items": sum(len(r.get("items") or []) for r in rows),
        "exactly_ten": sum(1 for r in rows if len(r.get("items") or []) == TOTAL_ITEMS),
        "invalid": bad, "filled_calls": stats["ok"], "kept": stats["kept"], "failed": stats["fail"],
        "started_at": started, "finished_at": datetime.now(timezone.utc).isoformat(),
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    print(json.dumps(manifest, indent=1))
    if bad or stats["fail"]:
        print(f"REFUSING: {bad} image(s) are not exactly ten valid items; {stats['fail']} call(s) failed",
              file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
