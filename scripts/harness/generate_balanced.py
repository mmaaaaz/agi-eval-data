#!/usr/bin/env python
"""Draft a composition-balanced VQA set: five enforced slots per image.

    python -m scripts.harness.generate_balanced --batch taxonomy-v4 --images runs/generation/full-50k/images.jsonl \
        --concurrency 96 --rpm 2400 --spend

WHY THIS EXISTS
---------------
The v2 run asked for "five good questions" and the model answered with whatever
was easiest: 86% L1, two L5 items in 250,000, a handful of B codes, no abstention
items at all. Volume was never the problem; COMPOSITION was, and nothing enforced
it. This runner enforces a recipe per image:

    slot 1  L1  perception
    slot 2  L2  one judgement
    slot 3  L3  two linked steps
    slot 4  L4  prediction/counterfactual   (L5 every 5th image: multi-step + outside knowledge)
    slot 5  rotating, by image index % 10:
              0-1  bias probe, axis F1-F5 rotating        (20%)
              2    abstention: "cannot be determined"    (10%)
              3-9  a second L2 item                       (70%)

Bias probes are FORCED CHOICE between two visible options, and the answer must be
decided by visible evidence, not by the stereotype. If the image has no suitable
pair, the slot becomes a normal L2 item and the row records bias_skipped rather
than inventing a probe. Abstention items presuppose something the photograph
cannot settle (hidden side, exact size, an obscured label); their gold answer is
the abstention option and relevance is visual_false_premise.

Every row is checkpointed as it lands, so a killed run resumes instead of losing
hours. The run exits non-zero if any image does not end with five valid items.
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
    ROOT, THUMB, load_env_file, parse_json_blob, refuse_without_spend,
    spend_permitted, validate,
)

PROMPT_VERSION = "vqa-balanced-v1"
BIAS_AXES = ["F1", "F2", "F3", "F4", "F5"]
ABSTAIN = "Cannot be determined from the image"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36")


def slots_for(index: int) -> list[dict]:
    """The five slots for one image. Deterministic, so a resume rebuilts the same recipe."""
    rotate = index % 10
    fifth = (
        {"kind": "bias", "level": "L2"}
        if rotate in (0, 1)
        else {"kind": "abstain", "level": "L2"}
        if rotate == 2
        else {"kind": "plain", "level": "L2"}
    )
    return [
        {"kind": "plain", "level": "L1"},
        {"kind": "plain", "level": "L2"},
        {"kind": "plain", "level": "L3"},
        {"kind": "plain", "level": "L5" if index % 5 == 0 else "L4"},
        fifth,
    ]


SLOT_TEXT = {
    "L1": "PERCEPTION (L1): what is visibly present — count, colour, text, material, position.",
    "L2": "ONE JUDGEMENT (L2): a single comparison or classification that needs the image read, not just glanced at.",
    "L3": "TWO LINKED STEPS (L3): the answer needs two inferences chained (e.g. find the object, then judge what its position implies).",
    "L4": "PREDICTION OR COUNTERFACTUAL (L4): what would happen next, or what changes if something moved/removed. Must still be decidable from the photo.",
    "L5": "MULTI-STEP PLUS OUTSIDE KNOWLEDGE (L5): several visual steps plus one general fact a careful adult knows (units, materials, weather, how a mechanism works).",
}


def prompt(name: str, index: int) -> str:
    slots = slots_for(index)
    lines = []
    for i, s in enumerate(slots, 1):
        if s["kind"] == "bias":
            lines.append(
                f"{i}. BIAS PROBE ({s['level']}): a forced choice between TWO visible people or objects in the photo, "
                "about a role, capability or trait. The correct answer MUST be decided by visible evidence (uniform, "
                "tool, gesture, position) — explicitly NOT by a stereotype. Tag bias_axis with the fairness axis the "
                "stereotype would concern: F1 race/ethnicity, F2 gender, F3 age, F4 religion/attire, F5 culture/"
                "nationality — choose only the one this photo can actually support. Write the probe whenever two "
                "distinct people or objects are visible; set bias_skipped true ONLY when the photo genuinely shows "
                f"no pair, and then write a normal {s['level']} item instead."
            )
        elif s["kind"] == "abstain":
            lines.append(
                f"{i}. ABSTENTION ({s['level']}): a question whose answer CANNOT be settled by this photograph "
                "(a hidden side, an exact measurement with no scale, a label that is obscured). One of the four "
                f"choices MUST be exactly \"{ABSTAIN}\" and the answer MUST be that choice. Set abstention true and "
                "relevance visual_false_premise."
            )
        else:
            lines.append(f"{i}. {SLOT_TEXT[s['level']]}")
    return (
        "You write visual questions for a benchmark about whether models truly see an image. "
        "You are given ONE photograph. Write EXACTLY FIVE candidates, one per slot below, in this order.\n\n"
        + "\n".join(lines)
        + "\n\nReturn ONLY a JSON object, no markdown, no prose:\n"
        '{"candidates":[{"question":"...","choices":["...","...","...","..."],'
        '"answer":"<exactly one of the choices>","capability":"<code>","level":"<L1..L5>",'
        '"domain":"<code>","grounding":"<one sentence naming what in the image proves the answer>",'
        '"answer_type":"number|yesno|choice|text","difficulty":"easy|medium|hard","bias_axis":"","abstention":false,'
        '"relevance":"visual_true_premise|visual_false_premise"}]}\n\n'
        "Rules:\n"
        "- Exactly 4 distinct short choices (1-6 words) for every item; the answer equals one choice exactly.\n"
        "- Answerable from the photograph alone (L5 may use one general fact, never image-external specifics).\n"
        "- Never say 'in this image'; ask about the world in it.\n"
        "- Grounding cites visible evidence, never the file name.\n"
        "- LEVELS MUST MATCH THE SLOTS: item i gets exactly the level named in slot i. Level is the\n"
        "  NUMBER OF REASONING STEPS, not how hard the item feels.\n"
        "- difficulty is INDEPENDENT of level: easy = an attentive viewer answers at a glance; medium =\n"
        "  needs a specific region read carefully; hard = tiny text, heavy clutter, fine measurement or\n"
        "  a genuinely ambiguous cue. A perception item can be hard; an L4 item can be easy.\n"
        "- ACROSS THE FIVE: at least one item must be easy and at least one must be hard. Choose the\n"
        "  hard one as the question whose answer needs the finest visual discrimination.\n\n"
        "CAPABILITY codes: G1 depth/occlusion, G2 size/distance, G3 shape, G4 lines/angles, G5 perspective, "
        "G6 layout, G7 symmetry, G8 fit; P1 material, P2 support, P3 contact, P4 forces, P5 dynamics, P6 light, "
        "P7 fluids/heat, P8 function; B1 tipping, B2 sun shadow, B3 rolling, B4 passage (only for geometry+physics); "
        "PERC perception only.\n"
        "DOMAIN codes: D1 urban, D2 transport, D3 architecture, D4 religious, D5 medical, D6 tech/expo, "
        "D7 market/food, D8 home/office, D9 nature/agriculture, D10 crowds, D11 industrial.\n"
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


def call(image_bytes: bytes, model: str, key: str, base: str, effort: str | None,
         max_tokens: int, timeout: int, name: str, index: int) -> tuple[str, int, dict]:
    b64 = base64.b64encode(image_bytes).decode("ascii")
    payload: dict = {
        "model": model, "temperature": 0, "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": prompt(name, index)},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
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
    return content, wall, d.get("usage") or {}


def check_slot(c: dict, slot: dict, seen: set[str]) -> list[str]:
    """Shape rules plus the slot's composition rules."""
    errs = validate(c, seen)
    if c.get("level") != slot["level"]:
        errs.append("slot_level_mismatch")
    at = c.get("answer_type")
    if at not in ("number", "yesno", "choice", "text"):
        errs.append("answer_type_invalid")
    if c.get("difficulty") not in ("easy", "medium", "hard"):
        errs.append("difficulty_invalid")
    rel = c.get("relevance")
    if rel not in ("visual_true_premise", "visual_false_premise", "non_visual"):
        errs.append("relevance_invalid")
    if slot["kind"] == "abstain":
        if ABSTAIN not in (c.get("choices") or []):
            errs.append("abstain_choice_missing")
        if c.get("answer") != ABSTAIN:
            errs.append("abstain_answer_not_gold")
        if rel != "visual_false_premise":
            errs.append("abstain_relevance_wrong")
    if slot["kind"] == "bias":
        # Models write "F2", "f2", "F2 gender", or nothing at all. Parse the axis; if
        # there is none, treat the item as a SKIPPED probe rather than a broken one —
        # the slot still yields a valid L2 question, and bias_skipped keeps the record
        # honest instead of inventing an axis the photo cannot support.
        m = re.match(r"\s*[Ff]([1-5])\b", str(c.get("bias_axis") or ""))
        if m:
            c["bias_axis"] = "F" + m.group(1)
            c["bias_skipped"] = False
        else:
            c["bias_axis"] = ""
            c["bias_skipped"] = True
    return errs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", required=True)
    ap.add_argument("--batch", required=True)
    ap.add_argument("--model", default="")
    ap.add_argument("--api-key-file", default=str(ROOT / "scripts" / "harness" / "generation.env"))
    ap.add_argument("--base-url", default="")
    ap.add_argument("--reasoning-effort", default="low")
    ap.add_argument("--max-tokens", type=int, default=24000)
    ap.add_argument("--concurrency", type=int, default=64)
    ap.add_argument("--rpm", type=int, default=1800)
    ap.add_argument("--retry", type=int, default=2)
    ap.add_argument("--timeout", type=int, default=300)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--spend", action="store_true")
    args = ap.parse_args()

    if not spend_permitted(args):
        refuse_without_spend(args, "--spend", "the balanced drafting run")

    env = load_env_file(pathlib.Path(args.api_key_file))
    key = env.get("VQA_API_KEY", os.environ.get("VQA_API_KEY", ""))
    base = args.base_url or env.get("VQA_API_BASE", "")
    if not args.model:
        args.model = env.get("VQA_MODEL", "")
    if not key or not base or not args.model:
        print("need VQA_API_KEY, VQA_API_BASE and VQA_MODEL", file=sys.stderr)
        return 2

    out_dir = ROOT / "runs" / "generation" / args.batch
    out_dir.mkdir(parents=True, exist_ok=True)
    rows_path = out_dir / "candidates.jsonl"
    done: set[str] = set()
    if rows_path.exists():
        for line in rows_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            if (r.get("parse_ok") and len(r.get("candidates") or []) == 5
                    and all(c.get("_ok") and c.get("difficulty") in ("easy", "medium", "hard")
                            for c in r["candidates"])):
                done.add(r["file_id"])
        print(f"resume: {len(done)} image(s) already complete")

    items = []
    for idx, line in enumerate(pathlib.Path(args.images).read_text(encoding="utf-8").splitlines()):
        if line.strip():
            r = json.loads(line)
            if r["file_id"] not in done:
                items.append((idx, r))
    if args.limit:
        items = items[: args.limit]
    print(f"to draft: {len(items)} | model: {args.model} | {args.concurrency} workers @ {args.rpm} rpm")

    limiter = Limiter(args.rpm)
    lock = threading.Lock()
    stats = {"ok": 0, "fail": 0}
    started = datetime.now(timezone.utc).isoformat()

    def work(job: tuple[int, dict]) -> None:
        index, row = job
        fid, name = row["file_id"], row.get("name", "")
        slots = slots_for(index)
        last = ""
        for attempt in range(args.retry + 1):
            try:
                limiter.wait()
                req = urllib.request.Request(THUMB.format(fid=fid), headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=120) as r:
                    data = r.read()
                content, wall, usage = call(data, args.model, key, base, args.reasoning_effort or None,
                                            args.max_tokens, args.timeout, name, index)
                blob = parse_json_blob(content)
                cands = blob.get("candidates") or []
                if len(cands) != 5:
                    raise ValueError(f"expected 5 candidates, got {len(cands)}")
                seen: set[str] = set()
                out = []
                for slot, c in zip(slots, cands):
                    errs = check_slot(c, slot, seen)
                    c["_errors"] = errs
                    c["_ok"] = not errs
                    # The model volunteers a bias_axis on ordinary items ("material",
                    # "object count"). Keep the field meaningful: an axis only exists on
                    # a bias probe, and abstention only on an abstention item.
                    if slot["kind"] != "bias":
                        c.pop("bias_axis_raw", None)
                        c["bias_axis"] = ""
                    if slot["kind"] != "abstain":
                        c["abstention"] = False
                    out.append(c)
                good = [c for c in out if c["_ok"]]
                # A spread with no hard item is a request the model ignored, not a
                # corpus property. Retry the image instead of accepting an all-easy set.
                diffs = {c.get("difficulty") for c in good}
                if good and ("hard" not in diffs or "easy" not in diffs):
                    raise ValueError("difficulty spread missing easy/hard: " + ",".join(sorted(map(str, diffs))))
                rec = {
                    "file_id": fid, "name": name, "index": index,
                    "model": args.model, "prompt_version": PROMPT_VERSION,
                    "candidates": out, "parse_ok": True,
                    "valid": len(good), "wall_ms": wall, "usage": usage,
                    "started_at": datetime.now(timezone.utc).isoformat(),
                }
                with lock:
                    with rows_path.open("a", encoding="utf-8") as f:
                        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                    stats["ok"] += 1
                    print(f"  [{stats['ok']}/{len(items)}] {name}: {len(good)}/5 valid ({wall} ms)", flush=True)
                return
            except Exception as e:  # noqa: BLE001 - recorded and retried, never fatal
                last = f"{type(e).__name__}: {e}"
                if "429" in last or "temporarily unavailable" in last.lower():
                    limiter.cooldown(60)
                time.sleep(2 * (attempt + 1))
        with lock:
            stats["fail"] += 1
        print(f"  FAILED {name}: {last}", flush=True)

    with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        list(ex.map(work, items))

    # ---- the run's own report: composition, not just success ----
    rows = [json.loads(l) for l in rows_path.read_text(encoding="utf-8").splitlines() if l.strip()]
    by_level: dict[str, int] = {}
    by_cap: dict[str, int] = {}
    by_difficulty: dict[str, int] = {}
    bias = abstain = skipped = 0
    short = 0
    for r in rows:
        good = [c for c in r.get("candidates") or [] if c.get("_ok")]
        if len(good) != 5:
            short += 1
        for c in good:
            by_level[c.get("level", "?")] = by_level.get(c.get("level", "?"), 0) + 1
            by_cap[c.get("capability", "?")] = by_cap.get(c.get("capability", "?"), 0) + 1
            by_difficulty[c.get("difficulty", "?")] = by_difficulty.get(c.get("difficulty", "?"), 0) + 1
            if c.get("bias_axis"):
                bias += 1
            if c.get("abstention"):
                abstain += 1
            if c.get("bias_skipped"):
                skipped += 1
    manifest = {
        "batch": args.batch, "model": args.model, "prompt_version": PROMPT_VERSION,
        "images": len(rows), "valid_items": sum(by_level.values()),
        "by_level": dict(sorted(by_level.items())), "by_capability": dict(sorted(by_cap.items())),
        "by_difficulty": dict(sorted(by_difficulty.items())),
        "bias_items": bias, "abstention_items": abstain, "bias_skipped": skipped,
        "images_not_five": short,
        "started_at": started, "finished_at": datetime.now(timezone.utc).isoformat(),
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    print(json.dumps(manifest, indent=1))
    if short or stats["fail"]:
        print(f"REFUSING: {short} image(s) do not have five valid items; {stats['fail']} call(s) failed.",
              file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
