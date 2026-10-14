#!/usr/bin/env python3
"""
STAGE 6 — THE CROPS-OUT-THE-EVIDENCE ATTACK.

THE IDEA
--------
Every item has one fixed gold answer. So progressively shrink the image and watch
two things happen at the same time:

    accuracy  (does it still answer correctly?)
    abstention (does it admit it cannot tell?)

If accuracy holds while the evidence has provably left the frame, the model is
answering without seeing — and it is doing so CONFIDENTLY. That is the single
worst failure mode for a deployed system, and it is the failure this benchmark is
positioned to measure.

WHY THIS IS THE STRONGEST EXPERIMENT IN THE PROJECT
---------------------------------------------------
1. Zero new annotation. It reuses items you already have.
2. It produces a CURVE, not a number. Curves are publishable; one accuracy
   figure is not.
3. It is self-validating: at a small enough crop the gold answer is literally
   not in the image, so the correct behaviour is provably to decline. No
   ground-truth ambiguity.
4. It needs no agreement between two humans to be meaningful.
5. It cannot be dismissed as a prompt artefact -- it varies the IMAGE, holding
   the question and the prompt byte-identical.

WHAT THE LITERATURE SAYS SHOULD HAPPEN
--------------------------------------
* ROHE (NAACL 2025): paired accuracy collapses to 9-68% while plain accuracy on
  the answerable half stays 94-100% -- "the entire failure is the unanswerable
  half."
* "Diagnosing Visual Ignorance" (arXiv:2606.06890): 20-40% of examples remain
  answerable under severe or total visual obfuscation.
* Res-Bench (arXiv:2510.16926): coarse/scene questions are resolution-IMMUNE
  (slope 0.000017x+0.7214) while OCR/fine-grained fall steeply
  (0.000372x+0.2610). So expect counting/OCR items to break and "what scene is
  this" items to survive -- that contrast IS the result.
* MoHoBench (AAAI 2026): mean refusal rate 21.3%, i.e. ~79% of unanswerable
  questions get a confident fabrication.

THIS FILE CANNOT RUN THE EXPERIMENT
-----------------------------------
Round 63 moved that to `scripts/harness/run_crop.py`, a thin wrapper over the harness — so the
ladder gets the release-hash check, resume, per-row errors, ingestion and the trace for free.
This file remains the DESIGN NOTE and the call-count calculator: `--plan` still estimates the
ladder's cost, `--demo` still shows the shape of the curve.

Keeping both is deliberate. The reasoning belongs next to the numbers it justifies; the
machinery belongs where the rest of the measurement lives.

USAGE
-----
    python -m scripts.harness.run_crop --release release/v1 --model <model> --out runs/crop.jsonl
    python scripts/factory/06_break_the_model.py --demo
    python scripts/factory/06_break_the_model.py --plan
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FACTORY = ROOT / "data" / "factory"

# ---------------------------------------------------------------------------
# The crop ladder. Fraction of each side retained, centred.
# 1.00 = the original image. 0.10 is a postage stamp.
# ---------------------------------------------------------------------------
LADDER = [1.00, 0.90, 0.80, 0.70, 0.60, 0.50, 0.40, 0.30, 0.20, 0.12]
EVIDENCE_GONE = 0.20          # at/below this we treat evidence as absent
EVIDENCE_GONE_SOFT = 0.40     # "probably absent"

P_ASK = (
    "You are answering a visual question about a photograph.\n"
    "Question: {question}\n\n"
    "Reply in EXACTLY this format and nothing else:\n"
    "ANSWER: <your short answer, or NONE if the image does not contain the information>\n"
    "CONFIDENCE: <0-100>"
)

ANSWER_RE = re.compile(r"^\s*answer\s*[:=]\s*(.+?)\s*$", re.I | re.M)
CONF_RE = re.compile(r"confidence\s*[:=]\s*(\d+(?:\.\d+)?)\s*(?:%|percent)?", re.I)
NONE_RE = re.compile(r"\b(none|n/?a|unknown|cannot|can not|not (?:sure|visible|present)|"
                     r"unable|insufficient|indeterminate|no information)\b", re.I)

NUMBER_WORDS = {
    "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5",
    "six": "6", "seven": "7", "eight": "8", "nine": "9", "ten": "10",
    "eleven": "11", "twelve": "12", "no": "0", "none": "0",
}

# Question text that depends on where things are IN the frame. Cropping changes
# the answer for these, so we refuse to use them in this attack.
FRAME_DEPENDENT = [
    r"\bleft\b", r"\bright\b", r"\btop\b", r"\bbottom\b", r"\bcorner\b",
    r"\babove\b", r"\bbelow\b", r"\bbeside\b", r"\bbehind\b", r"\bin front\b",
    r"\bcentre\b", r"\bcenter\b", r"\bedge\b", r"\bforeground\b", r"\bbackground\b",
    r"\bfull\b", r"\bentire\b", r"\bwhole\b", r"\ball\b",
]


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s)).lower().strip()
    s = re.sub(r"[^a-z0-9\.\- ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip().strip(" .-\t")
    return re.sub(r"^(the|a|an)\s+", "", s).strip(" .-\t")


def as_num(x: str) -> float | None:
    m = re.search(r"-?\d+(?:\.\d+)?", x)
    if m:
        return float(m.group(0))
    for word, digit in NUMBER_WORDS.items():
        if re.search(rf"\b{word}\b", x):
            return float(digit)
    return None


def same_answer(a: str | None, b: str | None, answer_type: str, tol: float) -> bool:
    if not a or not b:
        return False
    na, nb = norm(a), norm(b)
    if na == nb:
        return True
    if answer_type == "number":
        xa, xb = as_num(na), as_num(nb)
        if xa is not None and xb is not None:
            t = tol or 0.0
            return abs(xa - xb) <= max(t, 1e-9)
    if answer_type == "yesno":
        yn = {"yes": "yes", "true": "yes", "no": "no", "false": "no"}
        return yn.get(na) is not None and yn.get(na) == yn.get(nb)
    wa = NUMBER_WORDS.get(na)
    wb = NUMBER_WORDS.get(nb)
    if wa and wb:
        return wa == wb
    return False


def parse_response(text: str) -> tuple[str | None, float | None, bool]:
    """
    Returns (answer, confidence, abstained).

    `abstained` is True when the model refused OR signalled that it could not
    determine the answer. It is deliberately generous: we would rather
    under-count a refusal than mistake one for a confident answer.
    """
    if not text:
        return None, None, True
    ans = None
    m = ANSWER_RE.search(text)
    if m:
        ans = m.group(1).strip().rstrip(".")
    else:
        for line in text.strip().split("\n"):
            line = line.strip()
            if line and not line.lower().startswith("confidence"):
                ans = line.rstrip(".")
                break
    conf = None
    hc = CONF_RE.findall(text)
    if hc:
        v = float(hc[-1])
        conf = v / 100.0 if v > 1 else v
    abstained = bool(ans and NONE_RE.search(ans))
    if abstained or not ans:
        # A refusal has no answer. Nulling it here means no downstream scorer can
        # accidentally treat "NONE" as a claimed answer.
        ans = None
        abstained = True
    return ans, conf, abstained


def frame_dependent(question: str) -> bool:
    q = question.lower()
    return any(re.search(p, q) for p in FRAME_DEPENDENT)


def crop_box(w: int, h: int, frac: float):
    cw, ch = max(1, int(w * frac)), max(1, int(h * frac))
    x, y = (w - cw) // 2, (h - ch) // 2
    return (x, y, x + cw, y + ch)


def usable(item: dict) -> tuple[bool, str]:
    q = item.get("question", "")
    if frame_dependent(q):
        return False, "frame_dependent"
    at = item.get("answer_type", "text")
    if at not in ("number", "yesno", "choice", "text"):
        return False, "bad_answer_type"
    if not str(item.get("answer", "")).strip():
        return False, "no_answer"
    if at == "number" and item.get("tolerance") in (None, ""):
        return False, "number_without_tolerance"
    return True, ""


# ---------------------------------------------------------------------------
def score_curve(records: list[dict], answer_type: str, tol: float) -> dict:
    """
    records: [{"fraction": 1.0, "answer": str|None, "confidence": float|None,
               "abstained": bool}, ...]
    """
    by_frac = defaultdict(list)
    for r in records:
        by_frac[r["fraction"]].append(r)

    rows = []
    for frac in sorted(by_frac, reverse=True):
        rs = by_frac[frac]
        n = len(rs)
        correct = sum(1 for r in rs
                      if not r["abstained"] and same_answer(r["answer"],
                                                           r["gold"], answer_type, tol))
        abst = sum(1 for r in rs if r["abstained"])
        confs = [r["confidence"] for r in rs if r["confidence"] is not None]
        rows.append({
            "fraction": frac,
            "n": n,
            "accuracy": correct / n if n else float("nan"),
            "abstention_rate": abst / n if n else float("nan"),
            "mean_confidence": sum(confs) / len(confs) if confs else float("nan"),
            "conf_n": len(confs),
        })

    def at(frac):
        for r in rows:
            if abs(r["fraction"] - frac) < 1e-9:
                return r
        return None

    full, gone = at(1.00), at(EVIDENCE_GONE)
    result = {
        "ladder": rows,
        "accuracy_at_full": full["accuracy"] if full else None,
        "accuracy_at_evidence_gone": gone["accuracy"] if gone else None,
        "abstention_at_evidence_gone": gone["abstention_rate"] if gone else None,
    }
    if full and gone and full["accuracy"] > 0:
        result["retention_ratio"] = gone["accuracy"] / full["accuracy"]
    if gone and full:
        result["blind_confidence_excess"] = (
            (gone["mean_confidence"] - gone["accuracy"])
            if gone["mean_confidence"] == gone["mean_confidence"] else None)
    return result


def demo() -> None:
    print("=== frame-dependence gate ===")
    # (question, expected_frame_dependent)
    # Cropping only invalidates questions whose answer depends on WHERE
    # something sits in the frame, so those must be refused by this attack.
    cases = [
        ("What colour is the bus?", False),
        ("How many chairs are visible?", False),
        ("What is in the top left corner?", True),
        ("Is the cat on the left of the dog?", True),
        ("Is it raining outside?", False),
        ("How many people are in the photograph?", False),
    ]
    ok = 0
    for q, expect in cases:
        got = frame_dependent(q)
        good = got == expect
        ok += good
        print(f"  {'OK ' if good else 'FAIL'} frame_dependent={got!s:5} expect={expect!s:5} {q[:40]}")
    print(f"  {ok}/{len(cases)} passed\n")

    print("=== response parsing ===")
    rcases = [
        ("ANSWER: 3\nCONFIDENCE: 88", "3", 0.88, False),
        ("ANSWER: NONE\nCONFIDENCE: 40", None, 0.40, True),
        ("ANSWER: I cannot determine this\nCONFIDENCE: 55", None, 0.55, True),
        ("ANSWER: four\nCONFIDENCE: 70", "four", 0.70, False),
    ]
    ok = 0
    for text, ea, ec, eab in rcases:
        a, c, ab = parse_response(text)
        good = (a == ea and abs((c or 0) - ec) < 1e-6 and ab == eab)
        ok += good
        print(f"  {'OK ' if good else 'FAIL'} {text[:38]!r:42} -> ({a!r}, {c}, abstained={ab})")
    print(f"  {ok}/{len(rcases)} passed\n")

    print("=== the curve, on a synthetic model that ignores the evidence ===")
    # Accuracy stays high all the way down; abstention never rises. This is the
    # failure the experiment is built to detect.
    recs = []
    for f in LADDER:
        recs.append({"fraction": f, "answer": "3", "confidence": 0.9,
                     "abstained": False, "gold": "3"})
    r = score_curve(recs, "number", 0.0)
    print(f"  accuracy at full            : {r['accuracy_at_full']:.0%}")
    print(f"  accuracy at evidence-gone   : {r['accuracy_at_evidence_gone']:.0%}")
    print(f"  retention ratio             : {r.get('retention_ratio', float('nan')):.2f}")
    print(f"  abstention at evidence-gone : {r['abstention_at_evidence_gone']:.0%}")
    print(f"  confidence minus accuracy  : {r.get('blind_confidence_excess'):+.2f}")
    assert r["retention_ratio"] == 1.0
    print("  -> detected: accuracy fully retained, zero abstention, and confident.\n")

    print("=== contrast: a model that knows when it has lost the evidence ===")
    recs2 = []
    for f in LADDER:
        blind = f <= EVIDENCE_GONE_SOFT
        recs2.append({"fraction": f,
                      "answer": None if blind else "3",
                      "confidence": 0.2 if blind else 0.9,
                      "abstained": blind, "gold": "3"})
    r2 = score_curve(recs2, "number", 0.0)
    print(f"  retention ratio             : {r2.get('retention_ratio', float('nan')):.2f}")
    print(f"  abstention at evidence-gone : {r2['abstention_at_evidence_gone']:.0%}")
    print("\n  The two panels of Figure 1 are these two curves. Same benchmark,")
    print("  same questions -- only the model differs.")

    print("\n=== crop geometry ===")
    for frac in (1.0, 0.5, 0.2, 0.12):
        b = crop_box(4032, 3024, frac)
        w, h = b[2] - b[0], b[3] - b[1]
        print(f"  frac {frac:>4} -> {w:>5}x{h:<5} px  ({w*h/1e6:.2f} MP, "
              f"{100*frac*frac:.1f}% of the pixels)")


def plan() -> None:
    items_path = FACTORY / "questions.jsonl"
    if not items_path.exists():
        raise SystemExit(f"no items at {items_path}")
    items = [json.loads(l) for l in items_path.read_text(encoding="utf-8-sig").splitlines() if l.strip()]
    usable_items, dropped = [], Counter()
    for it in items:
        okk, why = usable(it)
        if okk:
            usable_items.append(it)
        else:
            dropped[why] += 1

    n_calls = len(usable_items) * len(LADDER)
    print(f"items in file          : {len(items)}")
    print(f"usable for this attack : {len(usable_items)}")
    for why, n in dropped.most_common():
        print(f"   dropped {why:<24} {n}")
    print(f"\nladder levels          : {len(LADDER)}  {LADDER}")
    print(f"calls per item         : {len(LADDER)}")
    print(f"total calls            : {n_calls:,}")
    print(f"per model (x12)        : {n_calls*12:,}")
    print("\nThis is the single most information-dense experiment in the project")
    print("and it needs no new human annotation at all.")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo", action="store_true")
    ap.add_argument("--plan", action="store_true")
    args = ap.parse_args()
    if args.demo:
        demo()
    elif args.plan:
        plan()
    else:
        ap.print_help()


if __name__ == "__main__":
    raise SystemExit(main())