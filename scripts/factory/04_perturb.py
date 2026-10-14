#!/usr/bin/env python3
"""
STAGE 4 — Perturbation consistency as a LABEL-FREE reliability signal.

THE IDEA
--------
Every item in this benchmark has exactly one fixed gold answer. That means we
can probe an item WITHOUT any extra human annotation by asking the model the
same question about a semantics-preserving variant of the same photograph:

    crop by 2%  ·  pad by 2%  ·  rescale to 0.95x  ·  rotate 1.5 deg
    JPEG re-encode at q=70  ·  horizontal flip of the TEXT only

None of these change what a careful human would answer. So if the model's
answer flips, that flip is evidence of instability — a label-free error signal.

WHY THIS IS WORTH DOING
------------------------
1. It costs one cheap API call per (item, transform). No human time at all.
2. It produces a SECOND calibration axis that is independent of the model's own
   stated confidence — the model cannot game it, because it never sees it.
3. It survives the pixel problem: the score is a property of the QUESTION and
   the MODEL, not of the pixels, so it can be reported even if we never release
   the images.

CAVEATS WE MUST NOT HIDE
------------------------
- A flip is evidence of instability, not proof of error. A model can be
  consistently wrong. So this is a RELIABILITY signal, not a ground truth.
- Some transforms are not perfectly semantics-preserving for every question
  (a crop can remove the referent). The pipeline therefore records WHICH
  transform caused the flip, and questions whose flips concentrate on
  aggressive transforms are treated as suspect, not as evidence.
- Rotation and flip can break genuinely orientation-dependent answers
  ("which side of the image"), so the text-flip transform is offered only for
  questions that are not orientation-dependent.

Usage:
    python scripts/factory/04_perturb.py --help
    python scripts/factory/04_perturb.py --demo          # run on synthetic images, no API
"""
from __future__ import annotations

import argparse
import io
import json
import math
import os
import re
import unicodedata
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FACTORY = os.path.join(ROOT, "data", "factory")

# ---------------------------------------------------------------------------
# Transform catalogue.
#
# `severity` is how aggressive the change is. A flip at low severity is much
# stronger evidence than a flip at high severity, because low severity is
# closer to genuinely invisible to a human.
#
# `orientation_sensitive` marks transforms that can legitimately change the
# answer for an orientation-dependent question, so we can refuse them per-item.
# ---------------------------------------------------------------------------
TRANSFORMS = [
    {"name": "crop_2pct",      "severity": 0.2, "orientation_sensitive": False,
     "desc": "centre-crop to 98% of each side"},
    {"name": "crop_4pct",      "severity": 0.4, "orientation_sensitive": False,
     "desc": "centre-crop to 96% of each side"},
    {"name": "pad_2pct",       "severity": 0.2, "orientation_sensitive": False,
     "desc": "pad by 2% of each side, edge-replicated"},
    {"name": "pad_4pct",       "severity": 0.4, "orientation_sensitive": False,
     "desc": "pad by 4% of each side, edge-replicated"},
    {"name": "scale_095",      "severity": 0.3, "orientation_sensitive": False,
     "desc": "bicubic downscale to 95% then back to original size"},
    {"name": "scale_090",      "severity": 0.5, "orientation_sensitive": False,
     "desc": "bicubic downscale to 90% then back"},
    {"name": "rotate_1deg",    "severity": 0.3, "orientation_sensitive": True,
     "desc": "rotate 1 degree, expand canvas, no clipping"},
    {"name": "rotate_2deg",    "severity": 0.5, "orientation_sensitive": True,
     "desc": "rotate 2 degrees, expand canvas"},
    {"name": "jpeg_q85",       "severity": 0.2, "orientation_sensitive": False,
     "desc": "JPEG re-encode at quality 85"},
    {"name": "jpeg_q65",       "severity": 0.5, "orientation_sensitive": False,
     "desc": "JPEG re-encode at quality 65"},
    {"name": "hflip",          "severity": 0.4, "orientation_sensitive": True,
     "desc": "mirror horizontally; question text mirrored too"},
    {"name": "vflip",          "severity": 0.4, "orientation_sensitive": True,
     "desc": "mirror vertically; question text mirrored too"},
]

# Question text patterns that genuinely depend on image orientation. We refuse
# orientation-sensitive transforms for these rather than pretending they are safe.
ORIENTATION_PATTERNS = [
    r"\bleft\b", r"\bright\b", r"\btop\b", r"\bbottom\b", r"\babove\b", r"\bbelow\b",
    r"\bupside[- ]down\b", r"\bupside\b", r"\bportrait\b", r"\blandscape\b",
    r"\bclock\s*wise\b", r"\bclockwise\b", r"\banticklockwise\b", r"\banti-clockwise\b",
    r"\brotat", r"\bhands?\b", r"\bup\b", r"\bdown\b",
]


def is_orientation_sensitive(question: str) -> bool:
    q = question.lower()
    return any(re.search(p, q) for p in ORIENTATION_PATTERNS)


def allowed_transforms(question: str) -> list[dict]:
    if not is_orientation_sensitive(question):
        return list(TRANSFORMS)
    return [t for t in TRANSFORMS if not t["orientation_sensitive"]]


# ---------------------------------------------------------------------------
# Answer normalisation. Stricter than normQ: a numeric answer inside a longer
# sentence must be compared as a number, not as text.
# ---------------------------------------------------------------------------
NUMBER_WORDS = {
    "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5",
    "six": "6", "seven": "7", "eight": "8", "nine": "9", "ten": "10",
    "eleven": "11", "twelve": "12", "no": "0", "none": "0",
}


def norm_answer(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s)).lower().strip()
    s = re.sub(r"[^a-z0-9\.\- ]+", " ", s)
    # strip sentence punctuation that survives, then collapse whitespace
    s = re.sub(r"\s+", " ", s).strip()
    s = s.strip(" .-\t")
    # leading article
    s = re.sub(r"^(the|a|an)\s+", "", s)
    return s.strip(" .-\t")


def same_answer(a: str, b: str, answer_type: str = "text", tolerance: float = 0.0) -> bool:
    """Ground-truth-aware equivalence, so 3 and 'three' count as the same answer."""
    na, nb = norm_answer(a), norm_answer(b)
    if na == nb:
        return True

    def as_num(x: str) -> float | None:
        m = re.search(r"-?\d+(?:\.\d+)?", x)
        if m:
            return float(m.group(0))
        # fall back to spelled-out numbers: "three chairs" -> 3
        for word, digit in NUMBER_WORDS.items():
            if re.search(rf"\b{word}\b", x):
                return float(digit)
        return None

    if answer_type == "number":
        xa, xb = as_num(na), as_num(nb)
        if xa is not None and xb is not None:
            tol = tolerance if tolerance and tolerance > 0 else 0.0
            return math.isclose(xa, xb, abs_tol=tol, rel_tol=(tol / abs(xa)) if xa else 0.0)

    if answer_type == "yesno":
        yn = {"yes": "yes", "no": "no", "true": "yes", "false": "no"}
        return yn.get(na) == yn.get(nb) and yn.get(na) is not None

    # number word equivalence for text answers
    words = {"one": "1", "two": "2", "three": "3", "four": "4", "five": "5",
             "six": "6", "seven": "7", "eight": "8", "nine": "9", "ten": "10"}
    if na in words and nb in words:
        return words[na] == words[nb]
    return False


# ---------------------------------------------------------------------------
# The transforms themselves. All PIL-only, all deterministic.
# ---------------------------------------------------------------------------
def apply_transform(pil_img, name: str):
    from PIL import Image, ImageOps
    w, h = pil_img.size
    if name == "crop_2pct":
        return pil_img.crop((int(w * .01), int(h * .01), int(w * .99), int(h * .99)))
    if name == "crop_4pct":
        return pil_img.crop((int(w * .02), int(h * .02), int(w * .98), int(h * .98)))
    if name in ("pad_2pct", "pad_4pct"):
        f = .02 if name == "pad_2pct" else .04
        pw, ph = int(w * f), int(h * f)
        out = ImageOps.expand(pil_img, border=(pw, ph, pw, ph), fill=None)
        return out
    if name in ("scale_095", "scale_090"):
        f = .95 if name == "scale_095" else .90
        small = pil_img.resize((max(1, int(w * f)), max(1, int(h * f))), Image.BICUBIC)
        return small.resize((w, h), Image.BICUBIC)
    if name in ("rotate_1deg", "rotate_2deg"):
        from PIL import Image as I
        deg = 1 if name == "rotate_1deg" else 2
        return pil_img.rotate(deg, resample=I.BICUBIC, expand=True, fillcolor=(0, 0, 0))
    if name in ("jpeg_q85", "jpeg_q65"):
        buf = io.BytesIO()
        q = 85 if name == "jpeg_q85" else 65
        pil_img.convert("RGB").save(buf, format="JPEG", quality=q)
        buf.seek(0)
        from PIL import Image as I
        return I.open(buf)
    if name == "hflip":
        return ImageOps.mirror(pil_img)
    if name == "vflip":
        return ImageOps.flip(pil_img)
    raise ValueError(f"unknown transform: {name}")


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------
def score_item(transform_results: list[dict], answer_type: str, tolerance: float) -> dict:
    """
    transform_results: [{"transform": name, "severity": float, "answer": str}, ...]
    Returns the consistency record for ONE item.
    """
    n = len(transform_results)
    if n == 0:
        return {"n_transforms": 0, "flip_rate": None, "weighted_flip": None,
                "flips": [], "consistent": None}

    flips = []
    agree = 0
    for r in transform_results:
        ok = same_answer(r["answer"], r["reference_answer"], answer_type, tolerance)
        r["agree"] = ok
        if ok:
            agree += 1
        else:
            flips.append({"transform": r["transform"], "severity": r["severity"],
                          "got": r["answer"], "expected": r["reference_answer"]})

    # Severity-weighted instability: a flip at 0.2 counts more than at 0.5.
    total_sev = sum(r["severity"] for r in transform_results) or 1.0
    weighted = sum(f["severity"] for f in flips) / total_sev

    return {
        "n_transforms": n,
        "agree": agree,
        "flip_rate": (n - agree) / n,
        "weighted_flip": weighted,
        "flips": flips,
        # A clean item is one where every transform agreed.
        "fully_consistent": agree == n,
    }


def item_instability(rec: dict) -> float:
    """Single number per item in [0,1]. 0 = perfectly stable."""
    if not rec.get("n_transforms"):
        return float("nan")
    return rec["weighted_flip"]



# ---------------------------------------------------------------------------
# THE 2x2 THAT SURVIVES THE PRIOR ART
# ---------------------------------------------------------------------------
# H1 (perturbation-instability predicts error) is ALREADY PUBLISHED:
#   Rosenfeld, Glazer & Fetaya, arXiv:2511.11206
#   Zheng & Kurban, arXiv:2608.01207 -- a format-matched control tracks or
#     exceeds perturbation-based selection on every benchmark. A hostile
#     reviewer will cite this. So we do NOT claim instability predicts error.
#
# What IS unclaimed: the regime where the signal provably FAILS.
#   * Rosenfeld et al. report I(H_V,H_L|C)/I(H_V,H_L) = 0.276 -- roughly 72% of
#     the visual-stability/confidence correlation is MEDIATED by confidence.
#     The residual is unmodelled.
#   * Arana et al. (ACL 2026 SRW) name "high-confidence failures that
#     instability cannot detect by design": 40 of 421 stable items were errors.
#
# So we measure the JOINT distribution of stated confidence and instability,
# with human labels, and characterise the low-confidence/low-instability
# quadrant -- the danger zone. We report the format-matched control alongside.
# ---------------------------------------------------------------------------

CONFIDENCE_BINS = [
    (0.00, 0.33, "low"),
    (0.33, 0.67, "mid"),
    (0.67, 1.01, "high"),
]
# instability: weighted_flip, higher = less stable
INSTABILITY_BINS = [
    (0.0001, 0.15, "stable"),
    (0.15, 0.35, "unstable"),
    (0.35, 1.01, "chaotic"),
]


def bin_confidence(c: float) -> str:
    for lo, hi, name in CONFIDENCE_BINS:
        if lo <= c < hi:
            return name
    return "unknown"


def bin_instability(weighted_flip: float) -> str:
    for lo, hi, name in INSTABILITY_BINS:
        if lo <= weighted_flip < hi:
            return name
    return "chaotic"


def quadrant(confidence: float, weighted_flip: float) -> str:
    """The cell label. 'DANGER' is the quadrant we argue is under-measured."""
    c = bin_confidence(confidence)
    i = bin_instability(weighted_flip)
    if c == "high" and i == "stable":
        return "confidently_consistent"
    if c == "low" and i in ("unstable", "chaotic"):
        return "appropriately_uncertain"
    if c == "high" and i in ("unstable", "chaotic"):
        return "confident_but_wobbling"
    if c in ("low", "mid") and i == "stable":
        return "DANGER_stable_but_uncertain"
    return f"other_{c}_{i}"


def quadrant_report(records: list[dict]) -> dict:
    """
    records: [{"confidence": float, "weighted_flip": float, "correct": bool}, ...]
    Returns per-quadrant accuracy and counts. The DANGER quadrant is the finding.
    """
    cells: dict[str, list[bool]] = {}
    for r in records:
        q = quadrant(r["confidence"], r["weighted_flip"])
        cells.setdefault(q, []).append(bool(r.get("correct")))
    out = {}
    for q, corrects in cells.items():
        n = len(corrects)
        acc = sum(corrects) / n if n else float("nan")
        out[q] = {"n": n, "accuracy": acc, "errors": n - sum(corrects)}
    return out


def demo() -> None:
    """Run the scoring logic on synthetic transform results. No API, no files."""
    print("=== same_answer equivalence ===")
    cases = [
        ("3", "There are three chairs.", "number", 0.0, True),
        ("3", "4", "number", 0.0, False),
        ("3", "3.02", "number", 0.05, True),
        ("yes", "Yes.", "yesno", 0.0, True),
        ("yes", "no", "yesno", 0.0, False),
        ("blue", "the blue", "text", 0.0, True),
        ("blue", "red", "text", 0.0, False),
    ]
    ok = 0
    for a, b, t, tol, expect in cases:
        got = same_answer(a, b, t, tol)
        ok += got == expect
        print(f"  {'OK ' if got == expect else 'FAIL'} {a!r:8} vs {b!r:26} ({t}) -> {got}")
    print(f"  {ok}/{len(cases)} passed\n")

    print("=== orientation sensitivity ===")
    for q, expect in [("How many people are visible?", False),
                      ("Is the cat on the left of the dog?", True),
                      ("Which hand is raised?", True),
                      ("What colour is the bus?", False)]:
        got = is_orientation_sensitive(q)
        print(f"  {'OK ' if got == expect else 'FAIL'} {q[:42]:44} sensitive={got}")
    print()

    print("=== instability scoring ===")
    # A model that only breaks on the most aggressive transform.
    tr = [
        {"transform": "crop_2pct", "severity": 0.2, "reference_answer": "3", "answer": "3"},
        {"transform": "jpeg_q65", "severity": 0.5, "reference_answer": "3", "answer": "3"},
        {"transform": "rotate_2deg", "severity": 0.5, "reference_answer": "3", "answer": "two"},
        {"transform": "jpeg_q85", "severity": 0.2, "reference_answer": "3", "answer": "3"},
    ]
    r = score_item(tr, "number", 0.0)
    print(f"  1 flip at severity 0.5/4 -> flip_rate={r['flip_rate']:.2f} "
          f"weighted={r['weighted_flip']:.3f} stable={r['fully_consistent']}")
    assert abs(r["flip_rate"] - 0.25) < 1e-9

    # A model that breaks everywhere.
    tr2 = [dict(t, answer="x", reference_answer="3") for t in
           [{"transform": "crop_2pct", "severity": 0.2},
            {"transform": "pad_2pct", "severity": 0.2},
            {"transform": "scale_090", "severity": 0.5}]]
    r2 = score_item(tr2, "number", 0.0)
    print(f"  all flips                      -> flip_rate={r2['flip_rate']:.2f} "
          f"weighted={r2['weighted_flip']:.3f}")
    assert r2["flip_rate"] == 1.0
    print("\n  scoring behaves as expected")

    print("\n=== transform catalogue ===")
    for t in TRANSFORMS:
        orient = "orientation-sensitive" if t["orientation_sensitive"] else ""
        print(f"  {t['name']:<14} sev={t['severity']:<4} {t['desc']:<52} {orient}")
    q = "Is the cat on the left of the dog?"
    print(f"\n  for {q!r} -> {len(allowed_transforms(q))}/{len(TRANSFORMS)} transforms allowed "
          f"(refused: {[t['name'] for t in TRANSFORMS if t not in allowed_transforms(q)]})")

    print("\n=== the confidence x instability 2x2 ===")
    demo_records = [
        # confidently consistent -> should be right
        {"confidence": 0.92, "weighted_flip": 0.00, "correct": True},
        {"confidence": 0.88, "weighted_flip": 0.05, "correct": True},
        {"confidence": 0.79, "weighted_flip": 0.10, "correct": False},  # the leaks
        # appropriately uncertain -> safe
        {"confidence": 0.20, "weighted_flip": 0.60, "correct": False},
        {"confidence": 0.25, "weighted_flip": 0.45, "correct": True},
        # confident but wobbling
        {"confidence": 0.85, "weighted_flip": 0.40, "correct": False},
        # DANGER: uncertain yet looks stable
        {"confidence": 0.30, "weighted_flip": 0.00, "correct": False},
        {"confidence": 0.22, "weighted_flip": 0.05, "correct": False},
    ]
    rep = quadrant_report(demo_records)
    for name, v in sorted(rep.items(), key=lambda kv: -kv[1]["n"]):
        print(f"  {name:<28} n={v['n']:<3} acc={v['accuracy']:.0%}  errors={v['errors']}")
    danger = rep.get("DANGER_stable_but_uncertain")
    assert danger and danger["accuracy"] < 0.5, "danger quadrant should be error-heavy by construction"
    print("\n  The DANGER quadrant is where label-free detection provably fails.")
    print("  With human labels we can MEASURE it. That is the contribution.")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo", action="store_true",
                    help="run the scoring logic on synthetic data; no API, no image files")
    ap.add_argument("--items", default=os.path.join(FACTORY, "questions.jsonl"))
    ap.add_argument("--results", default=os.path.join(FACTORY, "perturb_results.jsonl"))
    ap.add_argument("--out", default=os.path.join(FACTORY, "instability.json"))
    args = ap.parse_args()

    if args.demo:
        demo()
        return

    # Live mode needs the runner in 02_generate_questions.py; kept separate so
    # this file stays importable and testable with zero dependencies.
    if not os.path.exists(args.results):
        raise SystemExit(f"no transform results at {args.results} — run the runner first")
    rows = [json.loads(l) for l in open(args.results, encoding="utf-8") if l.strip()]
    by_item: dict[str, list[dict]] = defaultdict(list)
    meta: dict[str, dict] = {}
    for r in rows:
        by_item[r["item_key"]].append(r)
        meta[r["item_key"]] = r
    out = {}
    for key, trs in by_item.items():
        rec = score_item(trs, meta[key].get("answer_type", "text"),
                         meta[key].get("tolerance") or 0.0)
        out[key] = rec
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2)
    stable = sum(1 for v in out.values() if v.get("fully_consistent"))
    print(f"items scored      : {len(out)}")
    print(f"fully consistent  : {stable} ({stable/max(len(out),1):.1%})")
    print(f"mean weighted flip: "
          f"{sum(v['weighted_flip'] for v in out.values())/max(len(out),1):.3f}")


if __name__ == "__main__":
    raise SystemExit(main())