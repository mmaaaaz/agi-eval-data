#!/usr/bin/env python3
"""
STAGE 5 — Confidence elicitation from a closed text-only API.

THE PROBLEM THIS SOLVES
-----------------------
Every calibration metric (ECE, Brier, AURC, selective accuracy) needs a
per-item probability. Frontier APIs give you TEXT and nothing else: no logprobs,
and we deliberately send the grader no image. So the confidence has to be
elicited, and the choice of elicitation method changes the result.

THE THREE ARMS, and why all three
---------------------------------
A1  VERBALISED      ask the model to state a confidence. Cheapest, k=1, and the
                     literature's consistent finding is that it is the weakest.
A2  SELF-CONSISTENCY sample k answers at T>0 and treat answer-frequency as the
                     distribution. This is the standard strong baseline
                     (semantic-entropy family: Kuhn et al., Nature 2024).
A3  ORDER-THEN-RATE answer FIRST, then ask for confidence. The prior-art
                     failure mode is asking for confidence BEFORE seeing the
                     question, where the model commits before it has reasoned.

We implement all three because the paper's claim is precisely that the
elicitation METHOD is a confound in reported calibration. Running only one arm
and calling it "the model's confidence" would be the exact mistake we are
criticising.

COST
----
A1+A3 = 2 calls/item/model. A2 = k calls/item/model. At 2,400 items × 12 models:
  A1+A3 : 57,600 calls     A2 at k=5: 144,000 calls
Worth it — the whole frontier sweep is $2.76, so this is still single-digit dollars.

Usage:
    python scripts/factory/05_elicitation.py --demo     # no API, shows parsing
    python scripts/factory/05_elicitation.py --items data/factory/questions.jsonl --dry-run
"""
from __future__ import annotations

import argparse
import json
import os.path
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FACTORY = ROOT / "data" / "factory"

# --------------------------------------------------------------------------
# Prompts. Kept verbatim and versioned: these ARE the experimental apparatus
# and must be published in the appendix so the run is reproducible.
# --------------------------------------------------------------------------
P_ANSWER = (
    "You are answering a visual question about a photograph.\n"
    "Question: {question}\n\n"
    "Answer directly and concisely."
)

P_VERBALISED = (
    "You are answering a visual question about a photograph.\n"
    "Question: {question}\n\n"
    "Answer, then on a new final line output exactly:\n"
    "CONFIDENCE: <number between 0 and 100>\n"
    "Use your true belief in your own correctness. A wrong answer you are sure "
    "about is worth 100, not 0."
)

P_ORDER_THEN_RATE = (
    "You are answering a visual question about a photograph.\n"
    "Question: {question}\n\n"
    "First give your answer on one line, in the form:\n"
    "ANSWER: <your short answer>\n"
    "Then on a separate final line output exactly:\n"
    "CONFIDENCE: <number between 0 and 100>\n"
    "Rate the answer you just gave, not the question."
)

CONF_RE = re.compile(
    r"confidence\s*[:=]\s*(\d+(?:\.\d+)?)\s*(?:%|percent)?", re.I)

# Answer extraction, ordered by specificity.
ANS_PATTERNS = [
    re.compile(r"^\s*answer\s*[:=]\s*(.+?)\s*$", re.I | re.M),
    re.compile(r"^\s*(?:the\s+)?answer\s+is\s*:?\s*(.+?)\s*$", re.I | re.M),
    re.compile(r"^\s*final answer\s*[:=]\s*(.+?)\s*$", re.I | re.M),
]


def parse_confidence(text: str) -> float | None:
    """Pull a 0-1 confidence out of a response. None if absent or unusable."""
    if not text:
        return None
    hits = CONF_RE.findall(text)
    if not hits:
        # last resort: a bare percentage on its own line
        m = re.findall(r"^\s*(\d{1,3})\s*%\s*$", text, re.M)
        if m:
            v = int(m[-1])
            return v / 100.0 if v <= 100 else None
        return None
    v = float(hits[-1])
    if v > 1.0:          # given as 0-100
        v /= 100.0
    if not (0.0 <= v <= 1.0):
        return None
    return v


def parse_answer(text: str, answer_type: str = "text") -> str | None:
    """Extract the short answer. Strip the confidence line first."""
    if not text:
        return None
    body = CONF_RE.sub("", text)
    for pat in ANS_PATTERNS:
        m = pat.search(body)
        if m:
            return m.group(1).strip().rstrip(".")
    # number questions: first number anywhere
    if answer_type == "number":
        m = re.search(r"-?\d+(?:\.\d+)?", body)
        return m.group(0) if m else None
    if answer_type == "yesno":
        m = re.search(r"\b(yes|no)\b", body, re.I)
        return m.group(1).lower() if m else None
    # otherwise: first non-empty line
    for line in body.strip().split("\n"):
        line = line.strip()
        if line and not line.lower().startswith(("confidence", "answer:")):
            return line.rstrip(".")
    return None


# --------------------------------------------------------------------------
# A4 VERBALISED TOP-K, and A5 AVG-CONF
# --------------------------------------------------------------------------
# Verbalised Top-K is remarkable: k=1 call, ECE 0.050 on TriviaQA (GPT-3.5) and
# 0.025 on GPT-4 -- Tian et al., EMNLP 2023, Tables 1-2.
P_TOPK = (
    "You are answering a visual question about a photograph.\n"
    "Question: {question}\n\n"
    "Provide your 2 best guesses and the probability that each is correct "
    "(0.0 to 1.0). Give ONLY the guesses and probabilities, no other words.\n"
    "Format:\nG1: <guess>\nP1: <probability>\nG2: <guess>\nP2: <probability>"
)

TOPK_RE = re.compile(r"P\s*\d\s*[:=]\s*(\d*\.?\d+)", re.I)
GUESS_RE = re.compile(r"G\s*\d\s*[:=]\s*(.+)", re.I)


def parse_topk(text: str) -> tuple[list[str], list[float]] | None:
    """Parse the G1/P1/G2/P2 format. Returns (guesses, probs) or None."""
    if not text:
        return None
    guesses = [g.strip().rstrip(".") for g in GUESS_RE.findall(text)]
    probs_raw = TOPK_RE.findall(text)
    probs = []
    for p in probs_raw:
        v = float(p)
        probs.append(v if v <= 1.0 else v / 100.0)
    if not guesses or len(guesses) != len(probs):
        return None
    return guesses, probs


def avg_conf_distribution(answers: list[str | None],
                          confidences: list[float | None]) -> dict[str, float]:
    """
    Avg-Conf (Xiong et al., ICLR 2024, Eq. 2):

        C = sum_i 1{yhat_i == yhat} * C_i  /  sum_i C_i

    i.e. the modal answer's confidence is the sample-frequency-weighted mean of
    the self-reported confidences of the samples that agreed with it.

    Reported at M=5: ECE 14.8 / AUROC 74.5, versus 18.7 / 73.0 for plain
    consistency and 24.6 / 65.9 for verbalised Top-K at M=1 (Xiong Table 13).
    This is the arm we run at k=5.
    """
    buckets: dict[str, list[float]] = {}
    for a, c in zip(answers, confidences):
        if not a:
            continue
        buckets.setdefault(a.strip().lower(), []).append(
            0.5 if c is None else float(c))
    if not buckets:
        return {}
    total = sum(sum(v) for v in buckets.values()) or 1.0
    return {k: sum(v) / total for k, v in buckets.items()}


# --------------------------------------------------------------------------
# Aggregation
# --------------------------------------------------------------------------
def frequency_distribution(answers: list[str | None], n_slots: int | None = None) -> dict[str, float]:
    """Arm A2: empirical answer distribution over k samples."""
    answers = [a for a in answers if a]
    if not answers:
        return {}
    counts = Counter(a.strip().lower() for a in answers)
    total = sum(counts.values())
    dist = {k: v / total for k, v in counts.items()}
    if n_slots:
        for i in range(n_slots):
            dist.setdefault(str(i), 0.0)
    return dist


def top_probability(dist: dict[str, float]) -> float:
    """Self-consistency confidence = the mass on the modal answer."""
    return max(dist.values()) if dist else 0.0


def margin_probability(dist: dict[str, float]) -> float:
    """
    A stricter consistency measure: top mass MINUS runner-up mass.
    Range 0..1, and it penalises a 50/50 split much harder than frequency does.
    """
    if not dist:
        return 0.0
    vals = sorted(dist.values(), reverse=True)
    if len(vals) == 1:
        return vals[0]
    return max(0.0, vals[0] - vals[1])


def agreement_count(answers: list[str | None]) -> int:
    """How many distinct answers across k samples (0 if unusable)."""
    ans = [a.strip().lower() for a in answers if a]
    return len(set(ans))


# --------------------------------------------------------------------------
# Metrics
# --------------------------------------------------------------------------
def expected_calibration_error(pairs: list[tuple[float, int]], n_bins: int = 15) -> float:
    """pairs: [(confidence, correct 0/1)]"""
    if not pairs:
        return float("nan")
    bins = [[] for _ in range(n_bins)]
    for c, y in pairs:
        idx = min(int(c * n_bins), n_bins - 1)
        bins[idx].append((c, y))
    ece = 0.0
    for b in bins:
        if not b:
            continue
        conf = sum(c for c, _ in b) / len(b)
        acc = sum(y for _, y in b) / len(b)
        ece += (len(b) / len(pairs)) * abs(conf - acc)
    return ece


def brier_score(pairs: list[tuple[float, int]]) -> float:
    if not pairs:
        return float("nan")
    return sum((c - y) ** 2 for c, y in pairs) / len(pairs)


def parse_fail_rate(records: list[dict]) -> float:
    n = len(records)
    return sum(1 for r in records if not r.get("confidence")) / n if n else float("nan")


# --------------------------------------------------------------------------
def demo() -> None:
    print("=== confidence parsing ===")
    cases = [
        ("ANSWER: 3\nCONFIDENCE: 85", 0.85),
        ("I think it is three.\nConfidence: 60%", 0.60),
        ("CONFIDENCE = 0.72", 0.72),
        ("42%", 0.42),
        ("no confidence stated", None),
        ("CONFIDENCE: 150", None),
    ]
    ok = 0
    for text, expect in cases:
        got = parse_confidence(text)
        good = (got is None and expect is None) or (
            got is not None and expect is not None and abs(got - expect) < 1e-6)
        ok += good
        print(f"  {'OK ' if good else 'FAIL'} {text[:38]!r:42} -> {got}")
    print(f"  {ok}/{len(cases)} passed\n")

    print("=== answer parsing ===")
    acases = [
        ("ANSWER: 3\nCONFIDENCE: 85", "number", "3"),
        ("The answer is: blue.\nCONFIDENCE: 70", "text", "blue"),
        ("There are 4 chairs visible.", "number", "4"),
        ("Yes.", "yesno", "yes"),
        ("I cannot determine this.", "text", "I cannot determine this"),
    ]
    ok = 0
    for text, t, expect in acases:
        got = parse_answer(text, t)
        good = got == expect
        ok += good
        print(f"  {'OK ' if good else 'FAIL'} {t:<7} {text[:38]!r:42} -> {got!r}")
    print(f"  {ok}/{len(acases)} passed\n")

    print("=== self-consistency over k=5 samples ===")
    for dist_desc, answers in [
        ("all agree",          ["3", "3", "3", "3", "3"]),
        ("4/5 agree",          ["3", "3", "3", "3", "four"]),
        ("split 3/2",          ["3", "3", "3", "no", "no"]),
        ("uniformly split",    ["a", "b", "c", "d", "e"]),
        ("two answers only",   ["yes", "no", "yes", "no", "yes"]),
    ]:
        d = frequency_distribution(answers)
        print(f"  {dist_desc:<16} top={top_probability(d):.2f} "
              f"margin={margin_probability(d):.2f} distinct={agreement_count(answers)}")
    print()

    print("=== metrics on a synthetic set ===")
    # An OVERCONFIDENT model: says 0.9 on everything, is right 70% of the time.
    over = [(0.9, 1)] * 70 + [(0.9, 0)] * 30
    print(f"  overconfident (says .9, right 70%)  ECE = {expected_calibration_error(over):.3f}  "
          f"Brier = {brier_score(over):.3f}")
    # A GENUINELY CALIBRATED model: among items it rates 0.7, it is right 70%.
    good = [(0.7, 1)] * 70 + [(0.7, 0)] * 30 + [(0.3, 1)] * 9 + [(0.3, 0)] * 21
    # (0.7 bin is 70% correct; 0.3 bin is 30% correct -- both match, so ECE ~ 0)
    print(f"  calibrated   (says .7, right 70%)  ECE = {expected_calibration_error(good):.3f}  "
          f"Brier = {brier_score(good):.3f}")
    assert expected_calibration_error(good) < 0.01, "calibrated set must score ~0"
    assert expected_calibration_error(over) > 0.15, "overconfident set must score high"
    print("  -> ECE separates a calibrated model from an overconfident one. That is the metric.")
    print()
    print("=== prompt templates (published verbatim) ===")
    for name, p in [("A1_VERBALISED", P_VERBALISED),
                    ("A3_ORDER_THEN_RATE", P_ORDER_THEN_RATE)]:
        print(f"\n--- {name} ---\n{p}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo", action="store_true")
    ap.add_argument("--items", default=str(FACTORY / "questions.jsonl"))
    ap.add_argument("--k", type=int, default=5, help="samples for arm A2")
    ap.add_argument("--out", default=str(FACTORY / "elicitation_prompts.jsonl"))
    ap.add_argument("--dry-run", action="store_true",
                    help="emit the prompt plan without calling any API")
    args = ap.parse_args()

    if args.demo:
        demo()
        return

    if not Path(args.items).exists():
        raise SystemExit(f"no items at {args.items}")
    items = [json.loads(l) for l in open(args.items, encoding="utf-8") if l.strip()]
    if not items:
        raise SystemExit("items file is empty — author items first")

    FACTORY.mkdir(parents=True, exist_ok=True)
    n_calls = 0
    with open(args.out, "w", encoding="utf-8") as fh:
        for it in items:
            q = it["question"]
            arms = {
                # k=1 each. Verbalised Top-K is the strongest single-call method.
                "A4_topk": {"prompt": P_TOPK.format(question=q), "temperature": 0.0,
                            "expected": "G1/P1/G2/P2"},
                "A1_verbatim": {"prompt": P_VERBALISED.format(question=q), "temperature": 0.0},
                "A3_order_then_rate": {"prompt": P_ORDER_THEN_RATE.format(question=q),
                                       "temperature": 0.0},
                # the workhorse: k samples at T=1
                "A5_avg_conf": {"prompt": P_ANSWER.format(question=q), "temperature": 1.0,
                                "n": args.k,
                                "note": "answer at T=1 then self-rate; combine with avg_conf_distribution"},
            }
            n_calls += 3 + args.k
            fh.write(json.dumps({
                "item_key": it.get("question_id") or it["question"][:60],
                "image_id": it.get("image_id"),
                "answer_type": it.get("answer_type", "text"),
                "gold": it.get("answer"),
                "arms": arms,
            }, ensure_ascii=False) + "\n")

    print(f"items      : {len(items)}")
    print(f"calls/item : {args.k + 3}  (A4 + A1 + A3 + k x A5)")
    print(f"total calls: {n_calls:,}")
    print(f"written    : {args.out}")
    if args.dry_run:
        print("\n--dry-run: prompt plan written, no API called.")


if __name__ == "__main__":
    raise SystemExit(main())