"""The frozen grading rule.

Correct / close / wrong / unanswered, plus an explicit parse_ok flag so an
instruction-following failure is never counted as a knowledge failure.

WHY THE EXTRACTION IS THIS CAREFUL
----------------------------------
Four defects were found here by probing it, and every one of them silently moved an
accuracy number:

1. The FIRST standalone letter a-d was taken as the chosen option. So
   "A box is on the left, so the answer is B" was graded as choosing A — the indefinite
   article was read as an answer. Every such response was marked wrong.
2. Only a-d were recognised, so a fifth option was unreachable by letter.
3. Free-text matching used substring containment, so a gold answer of "no" matched
   "I don't know" ("know" contains "no") and was graded CORRECT.
4. Abstention matched a short fixed list, so "not sure", "cannot say" and "I cannot
   determine" were graded as knowledge failures rather than abstentions.

A grader that is wrong by a few percent in a consistent direction is worse than a noisy
one, because it looks like a finding.
"""
from __future__ import annotations

import re
import string
import unicodedata

_ANSWER_MARKERS = ("answer", "option", "choice", "ans", "correct", "pick", "select")


def normalise(text: str) -> str:
    t = unicodedata.normalize("NFKC", text or "").strip().lower()
    t = re.sub(r"[^a-z0-9 ]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


# Phrases that mean "I am not answering". Matched as whole phrases, never as bare
# substrings, or "unsure" would fire inside unrelated words.
#
# Built THROUGH normalise(), so the list can never drift from the text it is matched
# against. An earlier version stored "i don't know" verbatim, and normalise() strips the
# apostrophe — so the most common abstention in English could never match anything, and
# a model that said it was scored as a knowledge failure.
_RAW_ABSTAIN = (
    "unknown", "unanswerable", "unsure", "not sure", "uncertain", "indeterminate",
    "cannot be determined", "can't be determined", "cannot determine", "can't determine",
    "unable to determine", "cannot tell", "can't tell", "i cannot tell", "i can't tell",
    "cannot say", "can't say", "not enough information", "insufficient information",
    "not enough detail", "no idea", "no clue", "impossible to tell", "hard to tell",
    "i don't know", "i dont know", "don't know", "dont know", "do not know",
    "i have no idea", "cannot answer", "can't answer", "unable to answer",
)

ABSTAIN = tuple(sorted({normalise(a) for a in _RAW_ABSTAIN if normalise(a)}))


def _is_abstention(norm: str) -> bool:
    if not norm:
        return False
    for a in ABSTAIN:
        if norm == a or norm.startswith(a):
            return True
        # A multi-word phrase is unambiguous wherever it appears; a single word is not,
        # so it is only honoured at the start or as the whole response.
        if " " in a and re.search(r"\b" + re.escape(a) + r"\b", norm):
            return True
    return False


def _letters(n_options: int) -> str:
    """The option letters this item actually has, not a hard-coded a-d."""
    return string.ascii_lowercase[: max(1, min(26, n_options))]


def _letter_from(text: str, n_options: int) -> str | None:
    """Which option letter the response chose, or None.

    Ordered from unambiguous to merely plausible. The first standalone letter is the
    LAST resort, because it is the one that reads the indefinite article "a" as an
    answer, and "A is wrong, the answer is C" as A.
    """
    if not text:
        return None
    letters = _letters(n_options)
    t = text.strip().lower()

    # 1. nothing but a letter, possibly with punctuation: "b", "(B)", "b."
    m = re.fullmatch(r"\W*([" + letters + r"])\W*", t)
    if m:
        return m.group(1)

    # 2. an explicit marker at the start: "b)", "b.", "b:", "b -", "b,"
    m = re.match(r"\W*([" + letters + r"])\s*[\).:,;\-]\s*", t)
    if m:
        return m.group(1)

    # 3. an answer word followed by a letter: "the answer is b", "option: c"
    for marker in _ANSWER_MARKERS:
        m = re.search(r"\b" + marker + r"\b\W{0,4}([" + letters + r"])\b", t)
        if m:
            return m.group(1)
    m = re.search(r"\b(?:is|was|would be)\b\W{0,3}([" + letters + r"])\b", t)
    if m:
        return m.group(1)

    # 4. last resort: the first standalone letter that is not the indefinite article.
    candidates = re.findall(r"\b([" + letters + r"])\b", t)
    for c in candidates:
        if c != "a":
            return c
    return candidates[0] if candidates else None


_NUM_RE = re.compile(r"-?\d+(?:\.\d+)?")


def _strip_thousands(text: str) -> str:
    """\"1,234\" -> \"1234\", without touching a comma that is not between digits."""
    return re.sub(r"(?<=\d),(?=\d)", "", text or "")


def pick_number(text: str) -> float | None:
    """The number a response is answering with.

    Extraction runs on the RAW text, never on the normalised form. normalise() replaces
    every non-alphanumeric with a space, so \"2.5\" became \"2 5\" and was read as 2 — which
    meant ANY two numbers sharing an integer part graded CORRECT: a gold of 2.5 accepted a
    response of 2.9. It also destroyed thousands separators and minus signs.

    An explicit marker ("the answer is 3", "total: 12", "= 7") wins over a bare number,
    because a response that does arithmetic often contains the operands first.
    """
    if not text:
        return None
    t = _strip_thousands(text)
    m = re.search(r"(?:answer|total|count|sum)\s*(?:is|:|=)?\s*(-?\d+(?:\.\d+)?)", t, re.I)
    if m:
        return float(m.group(1))
    m = re.search(r"=\s*(-?\d+(?:\.\d+)?)", t)
    if m:
        return float(m.group(1))
    nums = _NUM_RE.findall(t)
    return float(nums[0]) if nums else None


def _option_from_text(norm: str, choices: list) -> str | None:
    """A response that quotes the option text instead of its letter.

    Word-bounded, so a short choice cannot match inside a longer word.
    """
    for i, c in enumerate(choices):
        nc = normalise(str(c))
        if nc and re.search(r"\b" + re.escape(nc) + r"\b", norm):
            return chr(97 + i)
    return None


def grade(item: dict, response: str) -> dict:
    """Return verdict, parse_ok and abstained for one response."""
    raw = (response or "").strip()
    norm = normalise(raw)
    if _is_abstention(norm):
        return {"verdict": "unanswered", "parse_ok": 1, "abstained": 1}

    gold = item.get("answer")
    if gold is None or str(gold) == "":
        return {"verdict": "wrong", "parse_ok": 0, "abstained": 0, "note": "no ground truth"}

    atype = (item.get("answer_type") or "text").lower()
    choices = item.get("choices") or []
    gold_n = normalise(str(gold))

    if atype in ("choice", "mcq") and choices:
        want = None
        if len(gold_n) == 1 and gold_n.isalpha():
            want = gold_n
        else:
            for i, c in enumerate(choices):
                if normalise(str(c)) == gold_n:
                    want = chr(97 + i)
                    break
        got = _letter_from(raw, len(choices))
        if got is None:
            got = _option_from_text(norm, choices)
        if got is None:
            return {"verdict": "wrong", "parse_ok": 0, "abstained": 0}
        if want is None:
            return {"verdict": "wrong", "parse_ok": 0, "abstained": 0, "note": "gold not among choices"}
        return {"verdict": "correct" if got == want else "wrong", "parse_ok": 1, "abstained": 0}

    if atype == "yesno":
        if re.match(r"^(yes|y)\b", norm) or norm == "y":
            got = "yes"
        elif re.match(r"^(no|n)\b", norm) or norm == "n":
            got = "no"
        else:
            return {"verdict": "wrong", "parse_ok": 0, "abstained": 0}
        return {"verdict": "correct" if got == gold_n else "wrong", "parse_ok": 1, "abstained": 0}

    if atype == "number":
        # RAW text on both sides. Parsing the normalised form collapsed decimals.
        got = pick_number(raw)
        if got is None:
            return {"verdict": "wrong", "parse_ok": 0, "abstained": 0}
        want = pick_number(str(gold))
        if want is None:
            return {"verdict": "wrong", "parse_ok": 0, "abstained": 0, "note": "gold is not a number"}
        tol = item.get("tolerance")
        tol = float(tol) if tol is not None else 0.0
        if got == want or (tol > 0 and abs(got - want) <= tol):
            return {"verdict": "correct", "parse_ok": 1, "abstained": 0}
        if tol > 0 and abs(got - want) <= 2 * tol:
            return {"verdict": "close", "parse_ok": 1, "abstained": 0}
        return {"verdict": "wrong", "parse_ok": 1, "abstained": 0}

    # free text: whole-word containment, never a substring. A gold answer of "no" must
    # not match "I don't know".
    if norm == gold_n:
        return {"verdict": "correct", "parse_ok": 1, "abstained": 0}
    if gold_n and re.search(r"\b" + re.escape(gold_n) + r"\b", norm):
        return {"verdict": "correct", "parse_ok": 1, "abstained": 0}
    return {"verdict": "wrong", "parse_ok": 1 if norm else 0, "abstained": 0}
