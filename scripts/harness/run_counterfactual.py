#!/usr/bin/env python3
"""
THE COUNTERFACTUAL CONTROL — does the model change its answer when the answer changes?

WHY THIS EXISTS
---------------
The surviving novelty claim includes *"counterfactual minimal-edit controls proving the model is
looking at the image at all"*, and `costs.md` budgets 50-400 USD for it. **No stage produced a
counterfactual image.** `image_edit`'s own schema comment enumerates what it expects
(`NULL | typographic_en | patch | cor...`) and nothing wrote the column.

THE DESIGN, AND WHY IT NEEDS NO NEW ANNOTATION
----------------------------------------------
A REMOVAL edit on an EXISTENCE question is answer-changing **by construction**:

    "is there a forklift?"  +  remove the forklift  ->  the correct answer is provably "no".

So the edited answer is known without a human, and the `grounding_box` says WHERE to remove.
That is what ticket 13 was for.

This matters because it is the difference between the three tests the project already has:

   04_perturb    semantics-PRESERVING  -> the answer should NOT change  (stability)
   run_crop      evidence-REMOVING     -> the answer becomes UNKNOWABLE (does it decline?)
   THIS          semantics-CHANGING    -> the answer MUST change        (is it looking?)
```
Having the first two does not give you the third.

HOW IT RUNS
-----------
It builds a **flipped release** — the same items with each selected answer inverted and
`counterfactual_of` / `image_edit` set — and runs the ordinary harness against it with a
`fetch_image` that applies the edit. So the whole thing inherits the release hash, resume,
per-row errors, grading and ingestion. Accuracy on that release is the number of interest:

    high  -> the model noticed the object was gone
    low   -> it repeated the answer it would have given anyway, which is the finding

THE EDITOR IS PLUGGABLE, AND THE OFFLINE ONE IS NOT AN INPAINT
-------------------------------------------------------------
`--editor box` (the default offline) fills the grounding box with a neutral patch. That removes
the pixels and exercises the whole path, and it is **not** what the released dataset should use:
filling a box leaves an obvious rectangle, and a model may react to the rectangle rather than to
the absence. A real run needs a diffusion inpaint (`--editor http --edit-url ...`), which is
model inference on images and therefore the permitted spend.

Usage:
    python -m scripts.harness.run_counterfactual --release rel --model stub --out runs/cf.jsonl --dry-run
    python -m scripts.harness.run_counterfactual --release rel --model Qwen/... \
        --base-url http://localhost:8000/v1 --edit-url http://localhost:8001/inpaint --out runs/cf.jsonl
"""
from __future__ import annotations

import argparse
import io
import json
import os
import pathlib
import sys
import tempfile
import time

from .spend import SPEND_HELP, refuse_without_spend
from .backends import StubBackend, from_env
from .fetch import make_fetcher, make_stub_fetcher
from .recipe import Recipe
from .release import build as build_release
from .run import run_release

NEUTRAL = (127, 127, 127)


def parse_box(raw) -> tuple[int, int, int, int] | None:
    """[x1,y1,x2,y2] in original pixels, or None. Never guesses."""
    if isinstance(raw, (list, tuple)) and len(raw) == 4:
        v = raw
    else:
        try:
            v = json.loads(raw)
        except Exception:
            return None
    try:
        x1, y1, x2, y2 = (int(n) for n in v)
    except Exception:
        return None
    if x2 <= x1 or y2 <= y1:
        return None
    return x1, y1, x2, y2


def is_existence_item(item: dict) -> bool:
    """Only questions whose truth flips when the referent is removed.

    An existence question is a yes/no, or a two-option choice whose options are yes/no. An
    OPEN question does not qualify: removing the reference object may make it unanswerable
    rather than false, and then the flipped gold would be a fabrication.
    """
    at = str(item.get("answer_type") or "").lower()
    if at == "yesno":
        return True
    if at in ("choice", "mcq"):
        ch = item.get("choices") or []
        if isinstance(ch, str):
            try:
                ch = json.loads(ch)
            except Exception:
                return False
        low = [str(c).strip().lower() for c in ch] if isinstance(ch, list) else []
        return len(low) == 2 and set(low) == {"yes", "no"}
    return False


def flip(answer: str) -> str | None:
    a = str(answer or "").strip().lower()
    if a in ("yes", "y"):
        return "no"
    if a in ("no", "n"):
        return "yes"
    return None


def box_editor(base_fetch):
    """Fill the grounding box with a neutral patch. SEE THE MODULE DOCSTRING: not an inpaint."""
    def fetch(item: dict) -> bytes:
        data = base_fetch(item)
        box = parse_box(item.get("grounding_box"))
        if not data or not box:
            return data
        from PIL import Image, ImageDraw
        with Image.open(io.BytesIO(data)) as im:
            im = im.convert("RGB")
            x1, y1, x2, y2 = box
            ImageDraw.Draw(im).rectangle([x1, y1, x2, y2], fill=NEUTRAL)
            out = io.BytesIO()
            im.save(out, format="JPEG", quality=90)
            return out.getvalue()
    return fetch


def http_editor(base_fetch, url: str, timeout: int = 120):
    """POST the image and a removal instruction to a diffusion inpaint endpoint."""
    import base64
    import urllib.request

    def fetch(item: dict) -> bytes:
        data = base_fetch(item)
        box = parse_box(item.get("grounding_box"))
        if not data or not box:
            return data
        body = json.dumps({
            "image": base64.b64encode(data).decode("ascii"),
            "box": list(box),
            "instruction": "remove the object inside the box, fill it in plausibly",
        }).encode("utf-8")
        req = urllib.request.Request(url, data=body, method="POST",
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        b64 = payload.get("image") or payload.get("b64_json") or ""
        if not b64:
            raise ValueError("the edit endpoint returned no image")
        return base64.b64decode(b64)
    return fetch


def build_flipped(items: list[dict]) -> tuple[list[dict], list[dict]]:
    """(flipped items, the ones that could not be flipped), with the reasons."""
    out, skipped = [], []
    for it in items:
        if not is_existence_item(it):
            skipped.append((it.get("id"), "not an existence question"))
            continue
        if parse_box(it.get("grounding_box")) is None:
            skipped.append((it.get("id"), "no usable grounding_box — nothing to remove"))
            continue
        f = flip(it.get("answer"))
        if f is None:
            skipped.append((it.get("id"), "the gold answer is not yes/no"))
            continue
        new = dict(it)
        new["answer"] = f
        # the field names the schema already had, finally with a writer
        new["counterfactual_of"] = it.get("id")
        new["image_edit"] = "remove_object"
        out.append(new)
    return out, skipped


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="The counterfactual control: remove the object, does the answer change?")
    ap.add_argument("--release", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--base-url", default=os.environ.get("VLLM_BASE_URL", ""))
    ap.add_argument("--edit-url", default="", help="a diffusion inpaint endpoint; omitted = the box editor")
    ap.add_argument("--editor", default="box", choices=["box", "http"])
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--prompt-id", default="yesno_v1", choices=["mcq_v1", "open_v1", "yesno_v1"])
    ap.add_argument("--pixel-budget", type=int, default=2048)
    ap.add_argument("--cache-dir", default=None)
    ap.add_argument("--run-id", default=None)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--spend", action="store_true", help=SPEND_HELP)
    ap.add_argument("--stub-file", default="")
    args = ap.parse_args(argv)

    # THE SPEND CHECK COMES FIRST, before the release is even evaluated. A guard placed after
    # a release check never runs on a release that fails the check, so an operator sees a
    # data problem when the real answer is that they are not allowed to spend.
    refuse_without_spend(args, "--spend", "the counterfactual control")

    src = pathlib.Path(args.release)
    # THE SOURCE'S CLEARANCE CARRIES FORWARD. The counterfactual release uses THE SAME IMAGES,
    # so it has exactly the same rights — and inheriting them is what lets load() require a
    # clearance from every release, including the ones this script builds internally.
    src_manifest = json.loads((src / "manifest.json").read_text(encoding="utf-8-sig"))
    items = [json.loads(l) for l in (src / "questions.jsonl").read_text(encoding="utf-8-sig").splitlines() if l.strip()]
    flipped, skipped = build_flipped(items)
    print("items in the release : " + str(len(items)))
    print("flippable            : " + str(len(flipped)))
    print("skipped              : " + str(len(skipped)))
    reasons: dict[str, int] = {}
    for _i, why in skipped:
        reasons[why] = reasons.get(why, 0) + 1
    for why, n in sorted(reasons.items()):
        print("    %4d  %s" % (n, why))
    # THE INVERSION, printed. A counterfactual whose gold did not actually flip is not a
    # counterfactual, and a caller has to be able to check that rather than take it on faith.
    by_id = {it["id"]: it for it in items}
    for it in flipped[:5]:
        was = str((by_id.get(it.get("counterfactual_of")) or {}).get("answer") or "?")
        print("    flip  %-4s %s -> %s   %s" % (it["id"], was, it["answer"], str(it["question"])[:36]))
    # A FLOOR, NOT A FORMALITY. One flippable item produces a "CONTROL ACCURACY" of 0.000 or
    # 1.000 and neither is a measurement — it is a description of one item. The stage refuses
    # below the floor so a pipeline run cannot report a counterfactual result from a handful of
    # questions, which is the failure mode a benchmark is most exposed to.
    MIN_ITEMS = 10
    if 0 < len(flipped) < MIN_ITEMS:
        print()
        print("REFUSING: only " + str(len(flipped)) + " flippable item(s), and a control needs at")
        print("  least " + str(MIN_ITEMS) + ". Below that the accuracy is a description of those items,")
        print("  not of the model. Add existence questions with grounding boxes (ticket 13).")
        return 1
    if not flipped:
        print()
        print("NOTHING TO TEST. A counterfactual needs an existence question AND a grounding box:")
        print("  the box says what to remove, and the question's truth flips by construction.")
        print("  Items without a box are skipped rather than guessed at.")
        return 1

    recipe = Recipe(model=args.model, prompt_id=args.prompt_id, temperature=0.0,
                    pixel_budget=args.pixel_budget)
    if args.dry_run:
        answers = json.loads(pathlib.Path(args.stub_file).read_text(encoding="utf-8-sig")) if args.stub_file else {}
        backend = StubBackend(answers)
        base_fetch = make_stub_fetcher(pixel_budget=args.pixel_budget)
        editor = box_editor(base_fetch)
        print()
        print("DRY RUN: offline stub + the BOX editor. The box fill is not an inpaint and no")
        print("released dataset should use it; it proves the path spends nothing.")
    else:
        # THE PAID PATH STARTS HERE.
        if not args.base_url:
            print("refusing to guess an endpoint: pass --base-url.", file=sys.stderr)
            return 2
        backend = from_env("open", args.model)[0]
        if args.edit_url and args.editor == "box":
            args.editor = "http"
        base_fetch = make_fetcher(args.cache_dir or (args.release + "/images"),
                                  pixel_budget=args.pixel_budget)
        if args.editor == "http":
            if not args.edit_url:
                print("--editor http needs --edit-url", file=sys.stderr)
                return 2
            editor = http_editor(base_fetch, args.edit_url)
            print("EDITOR: a diffusion inpaint at " + args.edit_url + ". This is the permitted spend.")
        else:
            editor = box_editor(base_fetch)
            print("EDITOR: box fill. WARNING — not an inpaint, and a real run should use --edit-url.")

    # THE FLIPPED RELEASE IS A REAL RELEASE: hashed, auditable, and the run is refused if the
    # labels drift, exactly like any other.
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="cf-release-"))
    manifest = build_release(
        flipped, tmp,
        release_id=(args.run_id or args.model.replace("/", "_")) + "-cf",
        notes="counterfactual: every answer inverted by removing the grounded object",
        consent=src_manifest.get("consent"), pii=src_manifest.get("pii"))
    print("flipped release      : " + manifest["groundtruth_hash"][:16] + "... ("
          + str(manifest["n_items"]) + " items)")

    t0 = time.time()
    res = run_release(release_dir=tmp, recipe=recipe, ask=backend.ask, trace_path=args.out,
                      fetch_image=editor, run_id=args.run_id or (args.model.replace("/", "_") + "-cf"),
                      limit=args.limit)
    backend.close()

    rows = [json.loads(l) for l in pathlib.Path(args.out).read_text(encoding="utf-8-sig").splitlines() if l.strip()]
    rs = [r for r in rows if not r.get("error")]
    n = len(rs)
    correct = sum(1 for r in rs if r.get("verdict") == "correct")
    print()
    print("THE CONTROL  (accuracy is 'the model changed its answer when the answer changed')")
    print("  tested            : " + str(n))
    print("  changed correctly : " + str(correct))
    if n:
        print("  CONTROL ACCURACY  : " + format(correct / n, ".3f"))
    print("  wall clock        : " + str(round(time.time() - t0, 1)) + "s")
    print()
    print("  A LOW figure is the finding: the object is provably gone from the frame and the")
    print("  model gave the answer it would have given anyway, so it was not reading the image.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
