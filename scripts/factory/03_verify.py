#!/usr/bin/env python3
"""
STAGE 3 — Integrity gate. Run this before anything is written into a paper.

This is the script that protects you. Every check exits non-zero on failure so
it can run in CI. It reads only committed data — it never calls a model.

Six checks:
  C1  corpus integrity   — the selected pool is deduped, correctly formed
  C2  item integrity     — every item is structurally valid and typed
  C3  leakage            — no image appears in two splits; no near-dup clusters straddle
  C4  blind-guessability — a text-only model must NOT be able to answer from text alone
  C5  agreement          — if double-annotated, agreement is reported per stratum
  C6  grade coverage     — the constant-answer and majority-class baselines exist

Usage:
    python scripts/factory/03_verify.py
    python scripts/factory/03_verify.py --questions data/factory/questions.jsonl --strict
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# THE TICKS AND CROSSES CRASH ON A WINDOWS CONSOLE. This script prints ✔/✗, and a cp1252 stdout
# raises UnicodeEncodeError — so a gate that was PASSING would report a crash on the machine of
# anyone who ran it locally. GitHub Actions is UTF-8, which is exactly why it went unnoticed.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
FACTORY = os.path.join(ROOT, "data", "factory")

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from scripts.harness.taxonomy import VALID_ANSWER_TYPES, VALID_RELEVANCE  # noqa: E402
VALID_VERDICTS = {"correct", "close", "wrong", "unanswered"}

GREEN, RED, YEL, DIM, RST = "\033[92m", "\033[91m", "\033[93m", "\033[90m", "\033[0m"


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s)).lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", s)).strip()


class Gate:
    def __init__(self) -> None:
        self.failed: list[str] = []
        self.warnings: list[str] = []

    def check(self, cid: str, name: str, ok: bool, detail: str = "", warn_only: bool = False) -> None:
        if ok:
            print(f"  {GREEN}PASS{RST} {cid} {name}" + (f"  {DIM}{detail}{RST}" if detail else ""))
        else:
            mark = f"{YEL}WARN{RST}" if warn_only else f"{RED}FAIL{RST}"
            print(f"  {mark} {cid} {name}  {detail}")
            (self.warnings if warn_only else self.failed).append(f"{cid} {name}: {detail}")


def load_json(p: str, default=None):
    if not os.path.exists(p):
        return default
    with open(p, encoding="utf-8") as fh:
        return json.load(fh)


def load_jsonl(p: str) -> list[dict]:
    if not os.path.exists(p):
        return []
    rows = []
    with open(p, encoding="utf-8") as fh:
        for line in fh:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", default=os.path.join(FACTORY, "candidates.json"))
    ap.add_argument("--questions", default=os.path.join(FACTORY, "questions.jsonl"))
    ap.add_argument("--split", default=os.path.join(FACTORY, "splits.json"))
    ap.add_argument("--grades", default=os.path.join(FACTORY, "grades.jsonl"))
    ap.add_argument("--blind", default=os.path.join(FACTORY, "blind_answers.jsonl"),
                    help="text-only-model results, for the non-visual-solvability screen")
    ap.add_argument("--strict", action="store_true", help="treat warnings as failures")
    args = ap.parse_args()

    g = Gate()
    cand = load_json(args.candidates, {"images": []})
    items = load_jsonl(args.questions)
    splits = load_json(args.split)
    grades = load_jsonl(args.grades)

    print(f"\n{DIM}corpus pool : {len(cand.get('images', []))}{RST}")
    print(f"{DIM}items       : {len(items)}{RST}")
    print(f"{DIM}grades      : {len(grades)}{RST}\n")

    # ---- C1 corpus integrity -----------------------------------------
    print("C1 corpus integrity")
    ids = [c["file_id"] for c in cand.get("images", [])]
    g.check("C1.1", "no duplicate file_id in pool", len(ids) == len(set(ids)),
            f"{len(ids)} rows, {len(set(ids))} unique")
    md5s = [c.get("md5") for c in cand.get("images", []) if c.get("md5")]
    g.check("C1.2", "no duplicate md5 in pool", len(md5s) == len(set(md5s)),
            f"{len(md5s)} checked")
    bad_geo = [c for c in cand.get("images", []) if c.get("w", 0) < 256 or c.get("h", 0) < 256]
    g.check("C1.3", "every image is >=256px on both axes", not bad_geo, f"{len(bad_geo)} violations")
    g.check("C1.4", "selection seed is recorded",
            "seed" in cand, f"seed={cand.get('seed')}")

    # ---- C2 item integrity -------------------------------------------
    print("\nC2 item integrity")
    if not items:
        # AN ABSENT DATASET IS NOT A CORRUPT ONE. This was a FAILURE, so the gate reported
        # CLOSED and exited 1 whenever no items exist — the state before any authoring — which
        # made the gate impossible to run in CI. Whether there is a dataset yet is a fact about
        # PROGRESS; every other check is a fact about INTEGRITY. So it warns, and the CLOSED
        # decision rests on real violations.
        g.check("C2.0", "no items yet — nothing to verify, and no result may be quoted",
                False, "no items found", warn_only=True)
    else:
        no_img = [i for i, it in enumerate(items) if not it.get("image_id")]
        g.check("C2.1", "every item names an image", not no_img, f"{len(no_img)} missing")
        bad_at = [i for i, it in enumerate(items) if it.get("answer_type") not in VALID_ANSWER_TYPES]
        g.check("C2.2", "answer_type is always valid", not bad_at,
                f"{len(bad_at)} invalid: {dict(Counter(i.get('answer_type') for i in bad_at))}")
        bad_rel = [i for i, it in enumerate(items) if it.get("relevance") not in VALID_RELEVANCE]
        g.check("C2.3", "relevance is always valid", not bad_rel, f"{len(bad_rel)} invalid")
        no_ans = [i for i, it in enumerate(items) if not str(it.get("answer", "")).strip()]
        g.check("C2.4", "every item has a non-empty answer", not no_ans, f"{len(no_ans)} empty")
        no_tol = [it for it in items
                  if it.get("answer_type") == "number" and it.get("tolerance") in (None, "")]
        g.check("C2.5", "numeric items declare a tolerance", not no_tol, f"{len(no_tol)} missing")
        no_ch = [it for it in items if it.get("answer_type") == "choice" and not it.get("choices")]
        g.check("C2.6", "choice items declare options", not no_ch, f"{len(no_ch)} missing")

        # near-duplicate questions (exact normalised match, not Jaccard)
        seen: dict[str, int] = {}
        dupes = 0
        for it in items:
            k = norm(it.get("question", ""))
            if k in seen:
                dupes += 1
            seen[k] = 1
        g.check("C2.7", "no exactly-duplicate questions", dupes == 0, f"{dupes} duplicates")

        types = Counter(it.get("answer_type") for it in items)
        yesno = types.get("yesno", 0) / max(len(items), 1)
        g.check("C2.8", "yes/no share is <= 35%", yesno <= 0.35,
                f"{yesno:.1%} — yes/no inflates accuracy and flattens calibration headroom",
                warn_only=True)

        unans = sum(1 for it in items if it.get("unanswerable_reason"))
        share = unans / max(len(items), 1)
        g.check("C2.9", "unanswerable share is 20-40%", 0.20 <= share <= 0.40,
                f"{share:.1%} ({unans} items)", warn_only=True)

        # ---- the two-axis taxonomy: the reporting axis must be complete ----
        # This mirrors the database trigger and the release builder. Three
        # independent places enforce it, because an item with no capability is
        # invisible in every results table and nobody notices until the paper.
        caps = {f"G{i}" for i in range(1, 9)} | {f"P{i}" for i in range(1, 9)} \
            | {f"B{i}" for i in range(1, 5)} | {"PERC"}
        no_cap = [it for it in items if (it.get("capability") or "") not in caps]
        g.check("C2.10", "every item declares a capability", not no_cap,
                f"{len(no_cap)} missing or invalid — the leaderboard is grouped by this")

        levels = {f"L{i}" for i in range(1, 6)}
        no_lvl = [it for it in items if (it.get("level") or "") not in levels]
        g.check("C2.11", "every item declares a level", not no_lvl,
                f"{len(no_lvl)} missing or invalid")

        bridge = [it for it in items if str(it.get("capability") or "").startswith("B")]
        unpaired = [it for it in bridge
                    if not it.get("pair_id") or not it.get("pair_role")]
        g.check("C2.12", "every bridge item is one member of a pair", not unpaired,
                f"{len(unpaired)} of {len(bridge)} bridge items have no pair — "
                "an unpaired bridge item cannot enter the 2x2 table, which is the headline")

        # Each pair must eventually carry a geometry probe and a physics probe.
        roles: dict[str, set] = defaultdict(set)
        for it in bridge:
            if it.get("pair_id"):
                roles[it["pair_id"]].add(it.get("pair_role"))
        incomplete = [p for p, r in roles.items() if not {"geometry", "physics"} <= r]
        complete = len(roles) - len(incomplete)
        g.check("C2.13", "every pair has a geometry and a physics probe",
                not incomplete,
                f"{len(incomplete)} of {len(roles)} pairs incomplete "
                "(a perception probe may be added, but these two are required)",
                warn_only=True)

        # THE RATIO, stated as a ratio. The checks above report counts, which is enough to
        # fail the gate but not enough to answer the question the paper asks: how much of
        # the set is actually paired? A 2x2 drawn from a handful of complete pairs is a
        # different claim from one drawn from most of them, and the count alone hides that.
        if bridge:
            both = len(bridge) - len(unpaired)
            g.check("C2.12b", "paired share of bridge items is reported", True,
                    f"{both}/{len(bridge)} bridge items are in a pair "
                    f"({100 * both / len(bridge):.1f}%), "
                    f"{complete}/{len(roles)} pairs complete "
                    f"({100 * complete / max(len(roles), 1):.1f}%)" if roles else
                    f"{both}/{len(bridge)} bridge items are in a pair")
        else:
            g.check("C2.12b", "the set contains bridge items to pair", False,
                    "no bridge items at all — the paired diagnostic, which is the paper's "
                    "headline, has nothing to run on",
                    warn_only=True)

        # ---- distractor and answer-position balance -----------------------
        # The rules page tells contributors this is checked before anything is
        # frozen. It was NOT, which made that line a false claim in contributor-
        # facing text. These three checks are what it was describing.
        #
        # The failure mode is real and easy to miss: a generator that puts the
        # correct option first, or writes it noticeably longer than the distractors,
        # produces a benchmark a model can beat by pattern rather than by seeing.
        LETTERS = "ABCDEF"
        correct_pos: Counter = Counter()
        correct_longest = 0
        wild_spread = 0
        choice_items = 0
        for it in items:
            if it.get("answer_type") != "choice":
                continue
            ch = it.get("choices")
            if isinstance(ch, str):
                try:
                    ch = json.loads(ch)
                except Exception:
                    continue
            if not isinstance(ch, list) or len(ch) < 2:
                continue
            choice_items += 1
            ans = str(it.get("answer") or "").strip()
            idx = None
            if len(ans) == 1 and ans.upper() in LETTERS[: len(ch)]:
                idx = LETTERS.index(ans.upper())
            else:
                for i, c in enumerate(ch):
                    if norm(str(c)) == norm(ans):
                        idx = i
                        break
            if idx is None or idx >= len(ch):
                continue
            correct_pos[LETTERS[idx]] += 1
            lengths = [len(str(c)) for c in ch]
            if lengths[idx] == max(lengths) and lengths.count(max(lengths)) == 1:
                correct_longest += 1
            shortest = min(l for l in lengths if l > 0) if any(l > 0 for l in lengths) else 0
            if shortest and max(lengths) / shortest > 4:
                wild_spread += 1

        if choice_items == 0:
            g.check("C2.14", "choice items exist to balance", False,
                    "no choice items yet", warn_only=True)
        else:
            top_letter, top_n = correct_pos.most_common(1)[0]
            share = top_n / choice_items
            g.check("C2.14", "correct-answer position is not biased",
                    share <= 0.50,
                    f"'{top_letter}' is the correct option in {top_n}/{choice_items} "
                    f"({share:.0%}) — above 50% a model can beat this by always picking "
                    "'" + top_letter + "'",
                    warn_only=(share <= 0.50))
            if share > 0.35:
                g.check("C2.14b", "correct-answer position is well spread", False,
                        f"'{top_letter}' at {share:.0%} — above 35% is worth shuffling",
                        warn_only=True)

            lg = correct_longest / choice_items
            g.check("C2.15", "the correct option is not systematically the longest",
                    lg <= 0.60,
                    f"the correct option is uniquely longest in {correct_longest}/{choice_items} "
                    f"({lg:.0%}) — length is then a giveaway",
                    warn_only=(lg <= 0.60))
            if lg > 0.40:
                g.check("C2.15b", "the correct option is not usually the longest", False,
                        f"{lg:.0%} — above 40% is a weak but real signal",
                        warn_only=True)

            ws = wild_spread / choice_items
            g.check("C2.16", "option lengths are comparable within an item",
                    ws <= 0.20,
                    f"{wild_spread}/{choice_items} items have a >4x length spread "
                    "(the long option is usually the answer)",
                    warn_only=True)

    # ---- C3 leakage ---------------------------------------------------
    print("\nC3 leakage")
    if splits:
        by_split = defaultdict(set)
        for im in splits.get("assignments", []):
            by_split[im["split"]].add(im["file_id"])
        names = list(by_split)
        overlap = 0
        for i in range(len(names)):
            for j in range(i + 1, len(names)):
                inter = by_split[names[i]] & by_split[names[j]]
                if inter:
                    overlap += len(inter)
        g.check("C3.1", "no image appears in two splits", overlap == 0,
                f"{overlap} overlapping images")
        g.check("C3.2", "all splits are non-empty", all(by_split.values()),
                {k: len(v) for k, v in by_split.items()})
    else:
        g.check("C3.0", "splits.json exists", False,
                "no splits yet — leakage cannot be ruled out", warn_only=True)

    if items and not splits:
        per_img = Counter(it.get("image_id") for it in items)
        g.check("C3.3", "items per image <= 5", max(per_img.values(), default=0) <= 5,
                f"max {max(per_img.values(), default=0)} on one image")

    # ---- C4 blind guessability ----------------------------------------
    print("\nC4 blind guessability (the non-visual-solvability screen)")
    blind = load_jsonl(args.blind)
    if not blind:
        g.check("C4.0", "blind-pass results present", False,
                "run a text-only model with the image removed; anything it answers "
                "correctly is not vision-dependent", warn_only=True)
    else:
        leaked = [b for b in blind if b.get("correct")]
        rate = len(leaked) / max(len(blind), 1)
        g.check("C4.1", "blind-solvable rate <= 5%", rate <= 0.05,
                f"{rate:.1%} ({len(leaked)}/{len(blind)}) — these must be rewritten or dropped")

    # ---- C5 agreement -------------------------------------------------
    print("\nC5 annotator agreement")
    dbl = [it for it in items if it.get("annotator_2")]
    if not dbl:
        g.check("C5.0", "double-annotated subset exists", False,
                "no annotator_2 recorded; grader reliability is unmeasured", warn_only=True)
    else:
        agree = [it for it in dbl if norm(str(it.get("answer"))) == norm(str(it.get("annotator_2")))]
        rate = len(agree) / len(dbl)
        g.check("C5.1", "double-annotated share >= 15%",
                len(dbl) / max(len(items), 1) >= 0.15,
                f"{len(dbl)}/{len(items)} = {len(dbl)/max(len(items),1):.1%}")
        g.check("C5.2", "raw agreement is reported", True, f"{rate:.1%}")
        g.check("C5.3", "agreement >= 70% (warn if lower)", rate >= 0.70,
                f"{rate:.1%} — below this, report per-stratum agreement", warn_only=True)

    # ---- C6 grade coverage --------------------------------------------
    print("\nC6 grade coverage and baselines")
    if not grades:
        g.check("C6.0", "graded responses present", False,
                "no grades yet — no accuracy number may be quoted", warn_only=True)
    else:
        bad_v = [gr for gr in grades if gr.get("verdict") not in VALID_VERDICTS]
        g.check("C6.1", "every verdict is one of the four", not bad_v,
                f"{len(bad_v)} invalid")
        if items:
            qids = {it.get("question_id") or norm(it.get("question", "")) for it in items}
            orphan = [gr for gr in grades
                      if (gr.get("question_id") or norm(gr.get("question", ""))) not in qids]
            g.check("C6.2", "no grades for unknown questions", not orphan, f"{len(orphan)} orphans")
        for key, val in sorted(grades[0].items()):
            if key.startswith("model"):
                pass
        models = Counter(gr.get("model") for gr in grades)
        g.check("C6.3", "at least 2 models graded", len(models) >= 2, f"{len(models)} models")

    # ---- verdict ------------------------------------------------------
    print()
    if g.failed:
        print(f"{RED}{RST}{len(g.failed)} blocking failure(s):")
        for f in g.failed:
            print(f"  {RED}✗{RST} {f}")
    if g.warnings:
        print(f"{YEL}{RST}{len(g.warnings)} warning(s):")
        for w in g.warnings:
            print(f"  {YEL}!{RST} {w}")

    hard_fail = bool(g.failed) or (args.strict and bool(g.warnings))
    if hard_fail:
        print(f"\n{RED}GATE CLOSED{RST} — do not write results into a paper yet.")
        return 1
    if g.warnings:
        print(f"\n{YEL}GATE OPEN WITH WARNINGS{RST} — state each one in the limitations.")
        return 0
    print(f"\n{GREEN}GATE OPEN{RST} — every blocking check passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
