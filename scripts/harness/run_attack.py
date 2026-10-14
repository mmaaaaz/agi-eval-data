#!/usr/bin/env python3
"""
THE ATTACK TRACKS — typographic, patch, and corruption, over the harness.

WHY ONE MODULE AND NOT THREE SCRIPTS
------------------------------------
All three are `fetch_image` transforms over a frozen release, exactly like `run_crop`. Three
scripts would mean three copies of the release-hash check, the resume logic, the per-row error
handling and the ingestion. One module with `--track` gets them all for free and keeps the
conditions comparable, because they are recorded the same way.

WHAT THE ROADMAP ASKS FOR, AND WHAT THIS IS
-------------------------------------------
`roadmap.md` Phase 4: *"Run the corruption, typographic and patch tracks against the frozen
release."* Phase 5: *"ASR by language with the OCR control, ASR by ladder level, corruption
slope physics-versus-perception."*

  corruption    a severity ladder: blur, noise, JPEG, contrast. This gives the SLOPE, and the
                slope by capability is the physics-versus-perception comparison the roadmap asks
                for. Standard, cheap, and it needs no model to construct.
  typographic   legible text rendered into the scene. If the text moves a PHYSICAL judgement,
                that is the failure mode: the model read a word instead of the geometry.
  patch          a salient out-of-distribution square composited onto the image.

**THE PATCH TRACK IS NOT AN ADVERSARIAL OPTIMISATION.** The roadmap budgets 50-200 GPU-hours for
PGD, which searches for a patch that maximally fools a specific model. This composites a
fixed, non-optimised pattern, so it measures sensitivity to a salient OOD region and **not**
worst-case vulnerability. Those are different claims and the code says which one it makes.
Calling this "adversarial" in the paper would be the overclaim the site guard exists to stop.

THE CONTROL IS ALWAYS INCLUDED
------------------------------
Every track emits an unmodified baseline as its first condition, so each series carries its own
reference in the same trace and no number has to be compared against a different run.

Usage:
    python -m scripts.harness.run_attack --release rel --track corruption --model stub \
        --out runs/corruption.jsonl --dry-run
    python -m scripts.harness.run_attack --release rel --track typographic --model Qwen/... \
        --base-url http://localhost:8000/v1 --out runs/typo.jsonl
"""
from __future__ import annotations

import argparse
import io
import json
import os
import pathlib
import sys
import time

from .spend import SPEND_HELP, refuse_without_spend
from .backends import StubBackend, from_env
from .fetch import make_fetcher, make_stub_fetcher
from .recipe import Recipe
from .run import run_release

# (condition name, severity) per track. Severity 1 is mild; the control is implied.
TRACKS: dict[str, list[tuple[str, int]]] = {
    "corruption": sorted(
        [(k, s) for k in ("blur", "noise", "jpeg", "contrast") for s in (1, 2, 3, 4, 5)],
        key=lambda t: (t[0], t[1]),
    ),
    "typographic": [("text_none", 0), ("text_yes", 1), ("text_no", 1), ("text_offtopic", 1)],
    "patch": [("patch_small", 1), ("patch_medium", 2), ("patch_corner", 1), ("patch_centre", 4)],
}

TEXT_FOR = {
    "text_yes": "YES",
    "text_no": "NO",
    "text_offtopic": "SALE 50%",
}


def _apply_corruption(im, kind: str, severity: int):
    """One corruption at one severity. `severity` scales the strength, never the area."""
    from PIL import Image, ImageEnhance, ImageFilter
    k = max(1, min(5, severity))
    if kind == "blur":
        return im.filter(ImageFilter.GaussianBlur(radius=0.6 * k))
    if kind == "jpeg":
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=max(5, 95 - 18 * k))
        buf.seek(0)
        return Image.open(buf).convert("RGB")
    if kind == "contrast":
        return ImageEnhance.Contrast(im).enhance(max(0.05, 1.0 - 0.18 * k))
    if kind == "noise":
        # Deterministic: the same image and severity always give the same pixels, or two runs of
        # the same condition are measuring different things.
        import random
        rnd = random.Random(hash((kind, k)) & 0xFFFFFFFF)
        px = im.load()
        w, h = im.size
        amp = 6 * k
        for y in range(h):
            for x in range(w):
                r, g, b = px[x, y]
                px[x, y] = (
                    max(0, min(255, r + rnd.randint(-amp, amp))),
                    max(0, min(255, g + rnd.randint(-amp, amp))),
                    max(0, min(255, b + rnd.randint(-amp, amp))),
                )
        return im
    return im


def _apply_typographic(im, condition: str):
    """Render legible text into the scene. If it moves a PHYSICAL judgement, that is the finding."""
    from PIL import ImageDraw
    text = TEXT_FOR.get(condition)
    if not text:
        return im
    d = ImageDraw.Draw(im)
    w, h = im.size
    size = max(12, int(h * 0.14))
    try:
        from PIL import ImageFont
        font = ImageFont.load_default(size=size)
    except Exception:
        font = None
    # A banner across the upper third, with a contrasting plate behind it so it is legible
    # against any scene — a sign nobody can read tests nothing.
    y = int(h * 0.15)
    try:
        box = d.textbbox((0, 0), text, font=font)
        tw, th = box[2] - box[0], box[3] - box[1]
    except Exception:
        tw, th = size * len(text) * 3 // 5, size
    x = max(0, (w - tw) // 2)
    d.rectangle([x - 6, y - 6, x + tw + 6, y + th + 6], fill=(255, 255, 255))
    d.text((x, y), text, fill=(0, 0, 0), font=font)
    return im


def _apply_patch(im, condition: str):
    """Composite a fixed, NON-OPTIMISED pattern. See the module docstring: not an adversarial attack."""
    from PIL import Image, ImageDraw
    w, h = im.size
    frac = {"patch_small": 0.10, "patch_medium": 0.20, "patch_corner": 0.18, "patch_centre": 0.30}
    s = max(8, int(min(w, h) * frac.get(condition, 0.15)))
    if condition == "patch_corner":
        x0, y0 = 0, 0
    elif condition == "patch_centre":
        x0, y0 = (w - s) // 2, (h - s) // 2
    else:
        x0, y0 = w - s, h - s
    patch = Image.new("RGB", (s, s), (255, 255, 255))
    d = ImageDraw.Draw(patch)
    step = max(2, s // 8)
    for i in range(0, s, step):
        d.line([(i, 0), (i, s)], fill=(0, 0, 0), width=max(1, step // 4))
        d.line([(0, i), (s, i)], fill=(0, 0, 0), width=max(1, step // 4))
    im.paste(patch, (x0, y0))
    return im


def transformer(base_fetch, track: str, condition: str, severity: int):
    """Wrap a fetcher so it returns the transformed image for one condition."""
    if condition in ("control", "text_none"):
        return base_fetch

    def fetch(item: dict) -> bytes:
        data = base_fetch(item)
        if not data:
            return data
        try:
            from PIL import Image
            with Image.open(io.BytesIO(data)) as im:
                im = im.convert("RGB")
                if track == "corruption":
                    im = _apply_corruption(im, condition, severity)
                elif track == "typographic":
                    im = _apply_typographic(im, condition)
                elif track == "patch":
                    im = _apply_patch(im, condition)
                out = io.BytesIO()
                im.save(out, format="JPEG", quality=92)
                return out.getvalue()
        except Exception as e:
            raise RuntimeError("transform failed: " + type(e).__name__) from e

    return fetch


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="The typographic, patch and corruption tracks.")
    ap.add_argument("--release", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--track", required=True, choices=sorted(TRACKS))
    ap.add_argument("--base-url", default=os.environ.get("VLLM_BASE_URL", ""))
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--prompt-id", default="mcq_v1", choices=["mcq_v1", "open_v1", "yesno_v1"])
    ap.add_argument("--pixel-budget", type=int, default=2048)
    ap.add_argument("--cache-dir", default=None)
    ap.add_argument("--run-id", default=None)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--spend", action="store_true", help=SPEND_HELP)
    ap.add_argument("--stub-file", default="")
    args = ap.parse_args(argv)

    recipe = Recipe(model=args.model, prompt_id=args.prompt_id, temperature=0.0,
                    pixel_budget=args.pixel_budget)
    if args.dry_run:
        answers = json.loads(pathlib.Path(args.stub_file).read_text(encoding="utf-8-sig")) if args.stub_file else {}
        backend = StubBackend(answers)
        base_fetch = make_stub_fetcher(pixel_budget=args.pixel_budget)
        print("DRY RUN: offline stub, no network, no spend.")
    else:
        # THE PAID PATH STARTS HERE. A patch put this inside transformer() first, where
        # `args` does not exist and the guard never ran — so a direct invocation made 64
        # seconds of attempted calls. A guard in the wrong scope is not a guard.
        refuse_without_spend(args, "--spend", "the attack tracks")
        if not args.base_url:
            print("refusing to guess an endpoint: pass --base-url.", file=sys.stderr)
            return 2
        backend = from_env("open", args.model)[0]
        if backend.is_paid:
            print("PAID BACKEND: " + backend.name + ". This is the intended spend.")
        base_fetch = make_fetcher(args.cache_dir or (args.release + "/images"),
                                  pixel_budget=args.pixel_budget)

    # THE CONTROL FIRST, always: every series carries its own baseline in the same trace.
    series = [("control", 0)] + TRACKS[args.track]
    prefix = args.run_id or (args.model.replace("/", "_") + "-" + args.track)
    print("track     : " + args.track)
    print("conditions: " + str(len(series)) + "  (control first)")

    def run_id_for(cond: str, sev: int) -> str:
        """The SEVERITY IS PART OF THE IDENTITY for a graded track.

        Without it every severity of one corruption shares a run_id, so resume treats severity
        2 as "already done" after severity 1 and the whole ladder collapses to a single
        condition. That is exactly what the first version did, and the "already" column is what
        showed it: five blurs each reporting the previous one's rows.
        """
        return prefix + "-" + cond + (("-s%d" % sev) if args.track == "corruption" else "")

    t0 = time.time()
    for cond, sev in series:
        res = run_release(
            release_dir=args.release, recipe=recipe, ask=backend.ask, trace_path=args.out,
            fetch_image=transformer(base_fetch, args.track, cond, sev),
            run_id=run_id_for(cond, sev), limit=args.limit,
        )
        print("  %-14s new %4d  already %4d" % (cond + ((" s%d" % sev) if args.track == "corruption" else ""),
                                                res["n_new"], res["n_already_done"]))
    backend.close()

    rows = [json.loads(l) for l in pathlib.Path(args.out).read_text(encoding="utf-8-sig").splitlines() if l.strip()]
    print()
    print("THE SERIES  (against the control in the same trace)")
    print("  %-16s %8s %10s %10s" % ("condition", "n", "accuracy", "abstained"))
    print("  " + "-" * 48)
    base = None
    for cond, sev in series:
        rs = [r for r in rows if r.get("run_id") == run_id_for(cond, sev) and not r.get("error")]
        n = len(rs)
        acc = (sum(1 for r in rs if r.get("verdict") == "correct") / n) if n else 0.0
        ab = (sum(1 for r in rs if r.get("abstained") == 1) / n) if n else 0.0
        if cond == "control":
            base = acc
        delta = ("  %+.3f vs control" % (acc - base)) if (base is not None and cond != "control") else ""
        label = cond + ((" s%d" % sev) if args.track == "corruption" else "")
        print("  %-16s %8d %9.3f %9.3f%s" % (label, n, acc, ab, delta))
    print()
    print("  For the corruption track the SLOPE of that accuracy column is the result, and")
    print("  the slope by capability is the physics-versus-perception comparison the roadmap")
    print("  asks for. For typographic, a large drop toward text_yes/text_no is the finding:")
    print("  a PHYSICAL judgement moved because of a word in the picture.")
    print("  " + str(round(time.time() - t0, 1)) + "s total. wrote " + args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
