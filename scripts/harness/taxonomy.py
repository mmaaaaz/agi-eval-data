#!/usr/bin/env python3
"""
THE TAXONOMY, IN ONE PLACE.

WHY THIS EXISTS
---------------
`VALID_CAPABILITIES` and `VALID_LEVELS` lived **only inside `02_generate_questions.py`** — a
numbered stage script. So the taxonomy was enforced at GENERATION and nowhere else, and anything
else that needed it had to duplicate the lists or import a module whose name starts with a digit.

The consequence was measured in round 81: `release.build()` accepted

    capability = "NOT_A_CAPABILITY", level = "L99"

and shipped it. The paper's per-capability table would have contained that key. An item with no
capability was bucketed as `UNCLASSIFIED` and averaged into the table rather than refused.

**That is enforcement at the point of origin and not at the point of use** — the same shape as
`--spend` guarding the pipeline and not the runners, and the consent gate guarding the builder
and not the release. Generating correctly does not make the artifact correct; only checking the
artifact does.
"""
from __future__ import annotations

# G  geometry                          P  physics
# B  bridge pairs (geometry + physics on one anchor)   PERC  the perception control rung
VALID_CAPABILITIES = (
    {("G%d" % i) for i in range(1, 9)}
    | {("P%d" % i) for i in range(1, 9)}
    | {("B%d" % i) for i in range(1, 5)}
    | {"PERC"}
)
VALID_LEVELS = {("L%d" % i) for i in range(1, 6)}

# THE OTHER TWO VOCABULARIES, which were ALSO declared twice — in `02_generate_questions.py` and
# in `03_verify.py`, separately. They decide whether an item is classifiable, so two copies means
# a release can be frozen against one list and verified against another.
VALID_ANSWER_TYPES = {"number", "yesno", "choice", "text"}
VALID_RELEVANCE = {"visual_true_premise", "visual_false_premise", "non_visual"}

# `mcq` is an ALIAS the harness already accepts for `choice` (release.py normalises it), so it is
# allowed here rather than refused — being strict about a spelling the rest of the code tolerates
# would reject working items.
ANSWER_TYPE_ALIASES = {"mcq": "choice"}


def check_item(item: dict) -> str | None:
    """A reason the item is not classifiable, or None.

    Returns a REASON rather than raising, so a caller can report every bad item at once instead
    of stopping at the first. A release with 300 unclassified items should say 300, not 1.
    """
    cap = item.get("capability")
    if cap is None or str(cap).strip() == "":
        return "no capability"
    if str(cap) not in VALID_CAPABILITIES:
        return "capability not in the taxonomy: " + repr(cap)
    lvl = item.get("level")
    if lvl is None or str(lvl).strip() == "":
        return "no level"
    if str(lvl) not in VALID_LEVELS:
        return "level not in the taxonomy: " + repr(lvl)

    # ---- THE SHAPE, which 03_verify checked at GENERATION and build() did not check at all ----
    #
    # Measured in round 82: build() accepted an item with NO answer_type, one with
    # answer_type="banana", a numeric item with no tolerance or tolerance=-1, and — worst —
    # a choice item whose gold answer is NOT among its options, which CAN NEVER BE ANSWERED
    # CORRECTLY. A release of those makes every accuracy figure meaningless.
    at = ANSWER_TYPE_ALIASES.get(str(item.get("answer_type") or ""), str(item.get("answer_type") or ""))
    if at not in VALID_ANSWER_TYPES:
        return "answer_type not in the vocabulary: " + repr(item.get("answer_type"))
    rel = item.get("relevance")
    if rel is not None and str(rel) not in VALID_RELEVANCE:
        return "relevance not in the vocabulary: " + repr(rel)
    if at == "number":
        tol = item.get("tolerance")
        if tol is None or str(tol).strip() == "":
            return "a numeric item declares no tolerance"
        try:
            if float(tol) < 0:
                return "tolerance is negative: " + repr(tol)
        except (TypeError, ValueError):
            return "tolerance is not a number: " + repr(tol)
    if at == "choice":
        ch = item.get("choices")
        if isinstance(ch, str):
            try:
                import json as _json
                ch = _json.loads(ch)
            except Exception:
                return "choices is not parseable"
        if not isinstance(ch, list) or len(ch) < 2:
            return "a choice item declares fewer than two options"
        ans = str(item.get("answer") or "").strip().lower()
        opts = [str(c).strip().lower() for c in ch]
        if ans and ans not in opts:
            # A BARE LETTER REFERS TO THE OPTION BY POSITION, which is the grader's documented
            # behaviour (the selftest asserts `grade(ITEMS[0], "A")` is correct against options
            # ["A drone", ...]). So "A" is a VALID gold answer for a three-option item, and my
            # first version of this rule refused it — the rule was wrong, not the fixture.
            #
            # What is NOT valid: a letter beyond the option count, which refers to nothing.
            if len(ans) == 1 and "a" <= ans <= "z":
                if (ord(ans) - ord("a")) < len(ch):
                    return None
                return ("the gold answer is a letter beyond the options: " + repr(item.get("answer"))
                        + " for " + str(len(ch)) + " options")
            return ("the gold answer is neither an option nor an option letter: "
                    + repr(item.get("answer")) + " not in " + str(ch[:4]))
    return None
