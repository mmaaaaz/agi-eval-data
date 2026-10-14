#!/usr/bin/env python3
"""
STAGE 04 — TAG AND GROUND.

WHAT THIS IS
------------
The missing stage between choosing images and writing questions. Nothing downstream can
stratify, balance or ask a domain question without it, and it is why the gallery triage
quota axis is still resolution rather than domain.

WHAT IT PRODUCES
----------------
One record per image: domain labels (D1-D11), the principal objects, whether text is
present, a people band, indoor/outdoor, and the lighting. Written to
`data/factory/tagged.jsonl`, resumable, with the model recorded per row so a reviewer can
see what produced a label.

WHAT IT DELIBERATELY DOES NOT DO
--------------------------------
* **No boxes, no masks, no depth by default.** Those need Grounding DINO / SAM / Depth
  Anything, and the plan is explicit that a monocular depth model is a TRIAGE AID, never
  released ground truth (ADR-0007). Building them in silently would be the easy way to
  make this stage look complete and quietly undermine the benchmark. `--ground` opts in and
  still labels the output as an aid.
* **No domain guessing from filenames or EXIF.** A camera name is not a scene. Every label
  here comes from a model looking at pixels, and every row says which model.

COST
----
This is model inference, which is the ONE permitted spend. The prompt is one short JSON
schema per image, so the cost is dominated by the image tokens, not the output. `--dry-run`
runs entirely offline against a stub and spends nothing.

Usage:
    # offline, free, proves the pipeline
    python scripts/factory/04_tag_ground.py --dry-run

    # a real tagging pass, on your own GPU
    python scripts/factory/04_tag_ground.py --base-url http://localhost:8000/v1 --model Qwen/Qwen3.8-27B
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from scripts.harness.spend import SPEND_HELP, refuse_without_spend  # noqa: E402
from scripts.harness.backends import OpenAICompatBackend, StubBackend  # noqa: E402
from scripts.harness.fetch import make_fetcher, make_stub_fetcher  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2]
CANDIDATES = ROOT / "data" / "factory" / "candidates.json"
OUT = ROOT / "data" / "factory" / "tagged.jsonl"

# The closed domain list. A tagger that invents its own words cannot be stratified.
DOMAINS = {
    "D1": "urban streets and roads",
    "D2": "transport hubs and vehicles",
    "D3": "architecture and buildings",
    "D4": "religious and cultural sites",
    "D5": "health and medical settings",
    "D6": "engineering, tech and expos",
    "D7": "markets, food and retail",
    "D8": "indoor home and office",
    "D9": "nature and agriculture",
    "D10": "crowds and events",
    "D11": "industrial and construction",
}

PEOPLE_BANDS = ("none", "1-2", "3-10", "10-50", "50+")

PROMPT = (
    "You are labelling one photograph for a benchmark of real-world visual reasoning.\n"
    "Answer with a single JSON object and nothing else. No prose, no code fences.\n\n"
    "Schema:\n"
    "{\n"
    '  "domains": [<one or more of ' + ", ".join(sorted(DOMAINS)) + ">],\n"
    '  "objects": [<up to 6 principal objects, lower case, plain nouns>],\n'
    '  "text_present": <true|false, any legible text anywhere in the scene>,\n'
    '  "people": "<' + "|".join(PEOPLE_BANDS) + '>",\n'
    '  "indoor": <true|false>,\n'
    '  "lighting": "<daylight|overcast|shade|indoor artificial|low light|night>"\n'
    "}\n\n"
    "Domain key:\n"
    + "\n".join(k + " = " + v for k, v in sorted(DOMAINS.items()))
    + "\n\nLabel what is VISIBLE. If you cannot tell, use the closest honest option rather "
    "than inventing detail."
)


def parse_json_object(text: str) -> dict | None:
    """Models wrap JSON in prose or code fences. Take the first object and validate it."""
    if not text:
        return None
    t = text.strip()
    t = re.sub(r"^```(?:json)?", "", t).strip()
    t = re.sub(r"```$", "", t).strip()
    start = t.find("{")
    end = t.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        obj = json.loads(t[start:end + 1])
    except Exception:
        return None
    return obj if isinstance(obj, dict) else None


def clean_tag(obj: dict, model: str) -> dict:
    """Keep only what the schema allows, so a model cannot widen the taxonomy."""
    raw_domains = obj.get("domains")
    domains = []
    if isinstance(raw_domains, list):
        for d in raw_domains:
            key = str(d).strip().upper()
            if key in DOMAINS and key not in domains:
                domains.append(key)
    elif isinstance(raw_domains, str):
        key = raw_domains.strip().upper()
        if key in DOMAINS:
            domains = [key]

    raw_objects = obj.get("objects")
    objects = []
    if isinstance(raw_objects, list):
        for o in raw_objects[:6]:
            s = " ".join(str(o).strip().lower().split())
            if s and s not in objects:
                objects.append(s)

    people = str(obj.get("people", "")).strip().lower()
    if people not in PEOPLE_BANDS:
        people = ""

    lighting = " ".join(str(obj.get("lighting", "")).strip().lower().split())
    return {
        "domains": domains,
        "objects": objects,
        "text_present": bool(obj.get("text_present")) if isinstance(obj.get("text_present"), bool) else None,
        "people": people or None,
        "indoor": bool(obj.get("indoor")) if isinstance(obj.get("indoor"), bool) else None,
        "lighting": lighting or None,
        "model": model,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Stage 04: tag and (optionally) ground the chosen images.")
    ap.add_argument("--candidates", default=str(CANDIDATES))
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--model", default="tagger")
    ap.add_argument("--base-url", default=os.environ.get("VLLM_BASE_URL", ""))
    ap.add_argument("--limit", type=int, default=0, help="0 = all")
    ap.add_argument("--pixel-budget", type=int, default=1568)
    ap.add_argument("--ground", action="store_true",
                    help="also request boxes, masks and depth. These are AIDS, never released ground truth (ADR-0007)")
    ap.add_argument("--dry-run", action="store_true", help="offline stub: spends nothing")
    ap.add_argument("--spend", action="store_true", help=SPEND_HELP)
    ap.add_argument("--stub-file", default="", help="JSON map of file_id -> tag JSON, for --dry-run")
    ap.add_argument("--no-resume", action="store_true", help="re-tag images already in the output")
    args = ap.parse_args()

    src = pathlib.Path(args.candidates)
    # THE SPEND REFUSAL COMES FIRST, BEFORE ANY INPUT CHECK.
    #
    # Found in round 131 by running the smoke test on a CLEAN CHECKOUT: with data/factory/
    # absent this returned at the input guard below and **never printed the refusal**, so the
    # smoke assertion - and any caller - could not tell a missing input from an unauthorised
    # spend. The spend rule is about AUTHORISATION, so it is answered whatever the files say.
    refuse_without_spend(args, "--spend", 'domain tagging')
    if not src.exists():
        print("no candidates file: " + str(src), file=sys.stderr)
        print("run first:  python scripts/factory/01_select_images.py --target 3000", file=sys.stderr)
        return 2
    doc = json.loads(src.read_text(encoding="utf-8-sig"))
    images = [p for p in doc.get("images", []) if p.get("file_id")]
    if args.limit:
        images = images[: args.limit]
    if not images:
        print("candidates file has no images", file=sys.stderr)
        return 2

    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    done: set[str] = set()
    if out.exists() and not args.no_resume:
        for line in out.read_text(encoding="utf-8-sig").splitlines():
            if line.strip():
                try:
                    done.add(json.loads(line)["file_id"])
                except Exception:
                    continue

    todo = [p for p in images if p["file_id"] not in done]
    print("candidates : " + str(len(images)))
    print("already    : " + str(len(done)))
    print("to tag     : " + str(len(todo)))
    if args.ground:
        print("WARNING: --ground requested. Boxes, masks and depth are ANNOTATION AIDS and")
        print("         must never be released as ground truth. See ADR-0007.")

    if not todo:
        print("nothing to do")
        return 0

    if args.dry_run:
        answers = json.loads(pathlib.Path(args.stub_file).read_text(encoding="utf-8-sig")) if args.stub_file else {}
        backend = StubBackend(answers)
        fetcher = make_stub_fetcher(pixel_budget=args.pixel_budget)
        print()
        print("DRY RUN: offline stub, no network, no spend.")
    else:
        if not args.base_url:
            print("refusing to guess an endpoint: pass --base-url.", file=sys.stderr)
            return 2
        backend = OpenAICompatBackend(model=args.model, base_url=args.base_url, api_key=os.environ.get("OPENAI_API_KEY", ""))
        fetcher = make_fetcher(str(out.parent / "images"), pixel_budget=args.pixel_budget)
        print()
        print("MODEL RUN: " + args.model + " at " + args.base_url + " — this is the permitted spend.")

    tagged = unparsed = failed = 0
    t0 = time.time()
    with out.open("a", encoding="utf-8") as fh:
        for i, p in enumerate(todo, 1):
            fid = p["file_id"]
            try:
                img = fetcher(p)
                raw = backend.ask({"id": fid}, img, PROMPT)
            except Exception as e:
                failed += 1
                print("  failed " + fid[:16] + ": " + type(e).__name__ + " " + str(e)[:90], file=sys.stderr)
                continue
            obj = parse_json_object(raw)
            if obj is None:
                unparsed += 1
                # An unparseable tag is recorded as UNLABELLED rather than guessed at,
                # so a broken model cannot quietly poison the stratification.
                rec = {"file_id": fid, "domains": [], "objects": [], "text_present": None,
                       "people": None, "indoor": None, "lighting": None,
                       "model": args.model, "unparsed": True}
            else:
                rec = {"file_id": fid, **clean_tag(obj, args.model)}
                if args.ground:
                    rec["grounding_aid"] = True
            fh.write(json.dumps(rec, sort_keys=True) + "\n")
            fh.flush()
            tagged += 1
            if i % 200 == 0:
                print("  " + str(i) + "/" + str(len(todo)) + "  tagged=" + str(tagged))

    dt = time.time() - t0
    rows = [json.loads(l) for l in out.read_text(encoding="utf-8-sig").splitlines() if l.strip()]
    by_domain: dict[str, int] = {}
    for r in rows:
        for d in r.get("domains", []):
            by_domain[d] = by_domain.get(d, 0) + 1

    print()
    # TWO DIFFERENT FAILURES, and only one used to be reported.
    #
    # A REFUSAL is honest: the model declined and the record is marked unparsed.
    # An INVENTED domain that the taxonomy check dropped produces a record that PARSES
    # fine, carries no domain, and looks identical to a record that legitimately has none.
    # That is the model being CONFIDENTLY WRONG, which is worse than refusing, and at
    # release scale in the round-50 dry run it was exactly as common as the refusals —
    # 457 invented domains against 457 refusals, with only the refusals counted.
    #
    # Both are unusable for domain stratification, so both are reported.
    domainless = [r for r in rows if not r.get("domains")]
    invented = [r for r in domainless if not r.get("unparsed")]
    print("tagged     : " + str(tagged) + " new, " + str(len(rows)) + " total")
    print("unparseable: " + str(unparsed) + "  (the model refused; kept unlabelled rather than guessed)")
    if invented:
        print("INVENTED   : " + str(len(invented)) + "  (well-formed JSON, no VALID domain survived —")
        print("             the taxonomy check dropped it. This is the model being confidently")
        print("             wrong, which is worse than refusing, and it is not a refusal.)")
    usable = len(rows) - len(domainless)
    print("usable     : " + str(usable) + " of " + str(len(rows))
          + "  (" + format(100 * usable / max(len(rows), 1), ".1f") + "% carry a real domain)")
    print("failed     : " + str(failed))
    print("wall clock : " + str(round(dt, 1)) + "s")
    print("by domain  : " + json.dumps(dict(sorted(by_domain.items())), sort_keys=True))
    missing = [d for d in DOMAINS if d not in by_domain]
    if missing:
        print("EMPTY      : " + ", ".join(missing) + "  <- no image carries these yet; balanced")
        print("             domain coverage is not reachable until they do")
    print("wrote " + str(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
