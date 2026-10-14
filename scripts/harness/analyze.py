"""Local analysis: the paper's tables, computed from trace files.

Deliberately database-free. A result must be recomputable from a trace file plus its
release, by anyone, months later. This is what makes a headline number checkable.

    python -m scripts.harness.analyze runs/open.jsonl runs/closed.jsonl
"""
from __future__ import annotations
import argparse
import collections
import json
import pathlib
import re
import sys

CELLS = ["understands", "physics_gap", "geometry_or_perception_gap", "guessing_from_priors"]


def load(*paths: str) -> list[dict]:
    rows: list[dict] = []
    for p in paths:
        for line in pathlib.Path(p).read_text(encoding="utf-8-sig").splitlines():
            if line.strip():
                rows.append(json.loads(line))
    return rows


def collapse(rows: list[dict]) -> tuple[list[dict], dict]:
    """ONE VERDICT PER (model, question). Repeats are MAJORITY-VOTED, not last-wins.

    WHY THIS EXISTS
    ---------------
    `--repeats N` puts N samples per item in a trace. Every function below used to take
    whichever sample happened to come last — for `pair_breakdown` that meant the paper's
    headline 2x2 reflected ONE ARBITRARY SAMPLE of N, and a reader had no way to see it.
    The leaderboard was less wrong (accuracy over all samples is a mean) but reported
    samples as `n`, so two models run with different repeat counts looked comparable when
    they were not.

    A TIE COUNTS AS WRONG. With two samples, one correct is not a pass; the conservative
    reading is the honest one for a benchmark.

    The disagreement rate is returned, not hidden: whether a model answers the same
    question the same way twice is a property worth reporting.
    """
    # THE KEY CARRIES run_id, AND THAT IS NOT A DETAIL.
    #
    # It used to be (model, question_id), which was right while a trace held ONE run: the only
    # repeats were `--repeats N` samples of the same measurement, and those SHOULD collapse.
    #
    # It is wrong the moment a trace holds a SERIES. `run_attack.py` writes 21 conditions of the
    # same 8 items into one file, and `run_crop.py` writes 6 crop fractions. Under the old key
    # every condition of a question merged into a single majority-voted row, so a corruption
    # ladder became one condition and **the slope the roadmap asks for could not exist**.
    #
    # Worst of all it did not fail: `summarise()` on the 21-condition corruption trace reports a
    # run_id naming one condition, n_items of 8, n_samples of 168, and an accuracy of 0.5. A
    # plausible number, from a trace where 20 of 21 measurements had been discarded.
    #
    # A measurement is identified by the run it belongs to, so run_id is part of its identity —
    # the same reason it is part of the resume key.
    groups: dict[tuple, list[dict]] = {}
    for r in rows:
        groups.setdefault((str(r.get("model")), str(r.get("run_id")), r.get("question_id")), []).append(r)

    out: list[dict] = []
    stats = {"n_items": 0, "n_samples": len(rows), "unstable": 0, "n_errored": 0}
    for _key, rs in groups.items():
        stats["n_items"] += 1
        # A RETRY SUPERSEDES A FAILURE. A transient 429 writes an errored row; the next
        # run must be able to retry it, which appends a SECOND row for the same item. If
        # the failed attempt won, the retry would be invisible.
        ok = [r for r in rs if not r.get("error")]
        if ok:
            rs = ok
        else:
            stats["n_errored"] += 1
        n = len(rs)
        n_ok = sum(1 for r in rs if r.get("verdict") == "correct")
        n_ab = sum(1 for r in rs if r.get("abstained") == 1)
        n_pf = sum(1 for r in rs if r.get("parse_ok") == 0)
        if len({r.get("verdict") for r in rs}) > 1:
            stats["unstable"] += 1
        base = dict(rs[0])
        base["verdict"] = "correct" if n_ok * 2 > n else "wrong"
        base["abstained"] = 1 if n_ab * 2 > n else 0
        base["parse_ok"] = 1 if n_pf * 2 < n else 0
        base["n_samples"] = n
        base["n_correct_samples"] = n_ok
        base["unstable"] = 1 if len({r.get("verdict") for r in rs}) > 1 else 0
        base["latency_ms"] = sum(r.get("latency_ms") or 0 for r in rs) / n
        out.append(base)
    return out, stats


def _acc(rows: list[dict]) -> tuple[int, float]:
    """Accuracy over items that produced an ANSWER.

    An errored item is missing data, not a wrong answer. Counting it as wrong conflates
    the model's ability with the infrastructure's reliability: a rate-limited request
    and a reasoning failure become the same number, and the sweep looks worse the more
    the API wobbles. The error count is reported beside this, never hidden inside it.
    """
    answered = [r for r in rows if not r.get("error")]
    n = len(answered)
    if not n:
        return 0, 0.0
    return n, sum(1 for r in answered if r.get("verdict") == "correct") / n


def leaderboard(rows: list[dict]) -> list[dict]:
    # Collapsed first, so a repeated run reports ITEMS and an honest accuracy rather
    # than counting one item N times.
    rows, stats = collapse(rows)
    groups: dict[str, list[dict]] = {}
    for r in rows:
        groups.setdefault(str(r.get("model")), []).append(r)
    out = []
    for model in sorted(groups):
        rs = groups[model]
        n, acc = _acc(rs)
        n_err = sum(1 for r in rs if r.get("error"))
        out.append({
            "model": model,
            "n": n,
            "n_errored": n_err,
            "n_items": n + n_err,
            "n_samples": sum(int(r.get("n_samples") or 1) for r in rs),
            "unstable_rate": (sum(1 for r in rs if r.get("unstable") == 1) / n) if n else 0.0,
            "accuracy": acc,
            "abstention_rate": sum(1 for r in rs if r.get("abstained") == 1) / n,
            "parse_fail_rate": sum(1 for r in rs if r.get("parse_ok") == 0) / n,
            "error_rate": sum(1 for r in rs if r.get("error")) / n,
            "mean_latency_ms": sum(r.get("latency_ms") or 0 for r in rs) / n,
        })
    return out


def pair_breakdown(rows: list[dict]) -> dict:
    """THE HEADLINE TABLE: the 2x2 over pairs of probes on the same anchor.

    A pair is scored per model: geometry probe correct? physics probe correct?

    Repeats are collapsed to one verdict per item FIRST. Before that, this table took
    whichever sample came last, so a 3-repeat run produced a headline table drawn from
    one sample per probe without saying so.
    """
    rows, _ = collapse(rows)
    per_pair: dict[tuple[str, str], dict] = {}
    for r in rows:
        pid = r.get("pair_id")
        role = r.get("pair_role")
        if not pid or role not in ("geometry", "physics", "perception"):
            continue
        key = (r["model"], str(pid))
        cell = per_pair.setdefault(key, {"geometry": None, "physics": None, "perception": None})
        cell[role] = 1 if r.get("verdict") == "correct" else 0

    table: dict[str, collections.Counter] = {}
    for (model, _pid), c in per_pair.items():
        if c["geometry"] is None or c["physics"] is None:
            continue
        g, p = c["geometry"], c["physics"]
        if g and p:
            name = "understands"
        elif g and not p:
            name = "physics_gap"
        elif not g and not p:
            name = "geometry_or_perception_gap"
        else:
            name = "guessing_from_priors"
        table.setdefault(model, collections.Counter())[name] += 1
    return table


# ---------------------------------------------------------------------------
# THE SERIES ANALYSES THE ROADMAP ASKS FOR
#
# Phase 5 asks for "corruption slope physics-versus-perception" and "counterfactual
# consistency". Neither existed here: each runner PRINTS its own series, so the numbers were
# computable by a person reading one run's output and not by any function. A result that only
# exists in a print statement is not an analysis.
#
# The condition lives in the run_id, because that is what makes resume correct — a run is
# identified by everything that distinguishes it. These functions read it back.
# ---------------------------------------------------------------------------

_CONDITION_RES = [
    # run_crop: <prefix>-crop<crop x100>, e.g. ...-crop075
    (re.compile(r"-crop(\d{3})$"), lambda m: ("crop", int(m.group(1)) / 100.0)),
    # run_attack corruption ladder: <prefix>-<corruption>-s<severity>
    (re.compile(r"-(blur|noise|jpeg|contrast)-s(\d+)$"), lambda m: (m.group(1), int(m.group(2)))),
    # the control condition every attack track emits first
    (re.compile(r"-(control)(?:-s(\d+))?$"), lambda m: ("control", int(m.group(2) or 0))),
]
_TYPOGRAPHIC = ("text_none", "text_yes", "text_no", "text_offtopic")

# THE REPORTING FLOOR. Not a statistical test, and it does not pretend to be one: it is the
# point below which a percentage moves double digits on ONE item, so a number computed under it
# is a description of the items rather than of the model.
#
# This constant is what stops a curve fitted to three items being reported as a finding, which
# is the failure mode a benchmark is most exposed to — **every analysis here returns a plausible
# number when it should return nothing.**
MIN_N = 10


def condition_of(run_id) -> tuple[str, float | None]:
    """(condition, severity) read back out of a run_id. Falls back to the id itself.

    Never guesses a severity. A condition with no severity — a typographic arm, a plain sweep —
    returns None, and the slope functions skip it rather than inventing a position on an axis
    it does not sit on.
    """
    rid = str(run_id or "")
    for pat, fn in _CONDITION_RES:
        m = pat.search(rid)
        if m:
            return fn(m)
    for c in _TYPOGRAPHIC:
        if rid.endswith("-" + c) or rid == c:
            return (c, None)
    return (rid or "(none)", None)


def series(rows: list[dict]) -> list[dict]:
    """One row per (model, run): what each condition measured.

    This is the table every runner printed for itself. Having it here means a series can be
    analysed after the fact, from the trace, without re-running the sweep.
    """
    collapsed, _ = collapse(rows)
    groups: dict[tuple, list[dict]] = {}
    for r in collapsed:
        groups.setdefault((str(r.get("model")), str(r.get("run_id"))), []).append(r)
    out = []
    for (model, run), rs in groups.items():
        cond, sev = condition_of(run)
        answered = [r for r in rs if not r.get("error")]
        n = len(answered)
        correct = sum(1 for r in answered if r.get("verdict") == "correct")
        out.append({
            "model": model,
            "run_id": run,
            "condition": cond,
            "severity": sev,
            "n": n,
            "accuracy": (correct / n) if n else 0.0,
            "abstention_rate": (sum(1 for r in answered if r.get("abstained") == 1) / n) if n else 0.0,
            "n_errored": len(rs) - n,
            # Flagged, not hidden: a condition measured on a handful of items is labelled so
            # nobody reads a difference between two thin points as a finding.
            "thin": n < MIN_N,
        })
    return sorted(out, key=lambda x: (x["model"], x["condition"], x["severity"] if x["severity"] is not None else -1))


def slopes(rows: list[dict], field: str = "capability") -> list[dict]:
    """Accuracy against severity, per (model, field). THE ROADMAP'S corruption slope.

    A slope is fitted over the graded severities of each corruption, pooling them, because the
    question the roadmap asks is "does this kind of item degrade faster than that kind" — and
    that is a comparison of gradients, not of any single severity.

    Items are attributed to the field value of the QUESTION, so a slope over `capability`
    compares P* (perception) with G* (geometry) on the same ladder.
    """
    collapsed, _ = collapse(rows)
    # group by (model, corruption, field value, severity)
    cells: dict[tuple, list[dict]] = {}
    for r in collapsed:
        cond, sev = condition_of(r.get("run_id"))
        if sev is None or cond == "control":
            continue
        key = (str(r.get("model")), cond, str(r.get(field) or "(unset)"), float(sev))
        cells.setdefault(key, []).append(r)

    # accuracy per (model, corruption, field, severity)
    points: dict[tuple, list[tuple[float, float, int]]] = {}
    for (model, cond, val, sev), rs in cells.items():
        answered = [r for r in rs if not r.get("error")]
        n = len(answered)
        if not n:
            continue
        acc = sum(1 for r in answered if r.get("verdict") == "correct") / n
        points.setdefault((model, cond, val), []).append((sev, acc, n))

    out = []
    for (model, cond, val), pts in points.items():
        pts.sort()
        # DROP THE THIN POINTS BEFORE FITTING. A severity measured on three items contributes
        # almost entirely noise to a gradient, and a fitted slope over such points is a
        # description of those three items. They are excluded and the count is reported.
        kept = [p for p in pts if p[2] >= MIN_N]
        if len(kept) < 2:
            # ONE SEVERITY IS NOT A SLOPE, and neither is two thin ones. Reporting a gradient
            # from a single point would be inventing the axis; reporting one from three items
            # is inventing precision. Both are refused, and the reason says which it is.
            out.append({"model": model, "corruption": cond, field: val,
                        "slope": None, "n_points": len(kept), "n_points_available": len(pts),
                        "reason": ("needs at least two severities with >= " + str(MIN_N)
                                   + " items each (had " + str(len(pts)) + ", kept "
                                   + str(len(kept)) + ")")})
            continue
        pts = kept
        sevs = [p[0] for p in pts]
        accs = [p[1] for p in pts]
        # ordinary least squares on (severity, accuracy)
        n_pts = len(sevs)
        mx = sum(sevs) / n_pts
        my = sum(accs) / n_pts
        denom = sum((x - mx) ** 2 for x in sevs)
        slope = (sum((x - mx) * (y - my) for x, y in zip(sevs, accs)) / denom) if denom else None
        out.append({
            "model": model, "corruption": cond, field: val,
            "slope": slope, "n_points": n_pts,
            # HOW MANY WERE AVAILABLE BEFORE THE FLOOR DROPPED ANY. Reported so a slope fitted
            # over two of five severities is visible as that, rather than looking like a ladder
            # that only had two rungs.
            "n_points_available": len(points[(model, cond, val)]),
            "accuracy_at_lowest": accs[0], "accuracy_at_highest": accs[-1],
            "severity_lowest": sevs[0], "severity_highest": sevs[-1],
            "n": sum(p[2] for p in pts),
        })
    return sorted(out, key=lambda x: (x["model"], x["corruption"], str(x.get(field))))


# ---------------------------------------------------------------------------
# CALIBRATION
#
# The plan treats the elicitation METHOD as a confound in reported calibration, and
# \`05_elicitation.py\` builds the three arms' prompts. Measured in round 76: **nothing runs those
# prompts, and nothing here computed a single calibration metric.** ECE, Brier, AURC and
# selective accuracy are the four names the plan uses; none existed.
#
# The traces already carry \`confidence\` (the v4 column, written by run.py), so the metrics are
# computable from a sweep that elicited it. Confidences are clamped to [0, 1] and a missing one
# is EXCLUDED rather than imputed: a defaulted 0.5 would move ECE toward whatever it was set to.
# ---------------------------------------------------------------------------

def _conf(r: dict) -> float | None:
    """A usable probability, or None. Never imputes one."""
    c = r.get("confidence")
    if c is None:
        return None
    try:
        v = float(c)
    except (TypeError, ValueError):
        return None
    if v != v:                       # NaN
        return None
    return 0.0 if v < 0 else (1.0 if v > 1 else v)


def _correct(r: dict) -> int:
    return 1 if r.get("verdict") == "correct" else 0


def calibration(rows: list[dict], bins: int = 10) -> list[dict]:
    """ECE, Brier, AURC and selective accuracy, per model.

    ECE is reported WITH the bin population, because a bin containing two items produces an
    ECE contribution that is noise and looks like signal.

    AURC (area under the risk-coverage curve) and selective accuracy answer the question the
    benchmark actually cares about: **if the model is allowed to answer only the items it is
    most confident about, how accurate is it, and how much does it have to refuse?**
    """
    collapsed, _ = collapse(rows)
    # GROUPED BY MODEL **AND ARM**. The plan's claim is that the elicitation METHOD is a confound
    # in reported calibration — so averaging the three arms into one number would destroy the only
    # result the elicitation exists to produce. `arm` is empty for an ordinary sweep, and a
    # (model, "") group is exactly the old behaviour.
    by_model: dict[tuple[str, str], list[dict]] = {}
    for r in collapsed:
        if r.get("error") or _conf(r) is None:
            continue
        by_model.setdefault((str(r.get("model")), str(r.get("arm") or "")), []).append(r)

    out = []
    for (model, arm), rs in sorted(by_model.items()):
        n = len(rs)
        confs = [_conf(r) for r in rs]
        corr = [_correct(r) for r in rs]

        # BRIER — mean squared error of the probability. Lower is better.
        brier = sum((c - y) ** 2 for c, y in zip(confs, corr)) / n

        # ECE — weighted mean of |accuracy - mean confidence| over equal-width bins.
        width = 1.0 / bins
        ece = 0.0
        binned = []
        for b in range(bins):
            lo, hi = b * width, (b + 1) * width
            # the last bin includes 1.0
            idx = [i for i, c in enumerate(confs) if (lo < c <= hi) or (b == 0 and c == 0.0)]
            if not idx:
                binned.append({"lo": lo, "hi": hi, "n": 0, "accuracy": None, "mean_confidence": None})
                continue
            acc = sum(corr[i] for i in idx) / len(idx)
            mc = sum(confs[i] for i in idx) / len(idx)
            ece += (len(idx) / n) * abs(acc - mc)
            binned.append({"lo": lo, "hi": hi, "n": len(idx), "accuracy": acc,
                           "mean_confidence": mc})

        # AURC / SELECTIVE — sort by confidence descending and walk the coverage curve.
        order = sorted(range(n), key=lambda i: confs[i], reverse=True)
        risk_sum = 0.0
        cum_correct = 0
        sel_by_coverage = {}
        for rank, i in enumerate(order, 1):
            cum_correct += corr[i]
            risk_sum += 1.0 - (cum_correct / rank)
            if rank in (max(1, n // 10), max(1, n // 4), max(1, n // 2)):
                sel_by_coverage[rank / n] = cum_correct / rank
        out.append({
            "arm": arm,
            "model": model,
            "n": n,
            "brier": brier,
            "ece": ece,
            "bins": binned,
            "mean_confidence": sum(confs) / n,
            "accuracy": sum(corr) / n,
            # AURC normalised by n so runs of different size are comparable
            "aurc": risk_sum / n,
            # selective accuracy at 10%, 25% and 50% coverage
            "selective_accuracy": {"%.0f%%" % (k * 100): v for k, v in sorted(sel_by_coverage.items())},
        })
    return out


def counterfactual_consistency(rows: list[dict]) -> list[dict]:
    """THE FLIP RATE. Does the model change its answer when the answer changes?

    `run_counterfactual` builds a release whose gold is INVERTED by removing the grounded object,
    so accuracy on those rows is exactly "how often did the model notice". It printed that number
    and nothing else could compute it.

    Restricted to rows carrying an `image_edit`, because a counterfactual trace mixed with an
    ordinary sweep would average the control into the result.
    """
    collapsed, _ = collapse(rows)
    groups: dict[tuple, list[dict]] = {}
    for r in collapsed:
        edit = r.get("image_edit")
        if not edit:
            continue
        groups.setdefault((str(r.get("model")), str(edit)), []).append(r)
    out = []
    for (model, edit), rs in groups.items():
        answered = [r for r in rs if not r.get("error")]
        n = len(answered)
        correct = sum(1 for r in answered if r.get("verdict") == "correct")
        out.append({
            "model": model,
            "image_edit": edit,
            "n": n,
            # "consistency" is the share that followed the inverted gold. LOW is the finding:
            # the object is provably gone and the model gave the answer it would have given
            # anyway, so it was not reading the image.
            "consistency": (correct / n) if n else 0.0,
            "repeated_original_answer": n - correct,
            "n_errored": len(rs) - n,
        })
    return sorted(out, key=lambda x: (x["model"], x["image_edit"]))


# A LEVEL WITH FEWER THAN THIS MANY ANSWERED ITEMS IS REPORTED AS THIN. 10 is not a
# statistical threshold and does not pretend to be one — it is the point below which a
# percentage moves double digits on one item, and a reader deserves to know that before
# comparing two bars.
THIN_LEVEL = 10


def difficulty_ladder(rows: list[dict]) -> list[dict]:
    """Accuracy by LEVEL, with the per-level n visible. THE ROADMAP'S difficulty ladder.

    `by_field(rows, "level")` already grouped this, and grouping is not the problem: the
    problem is that a level with three items and one with three hundred printed identically.
    A ladder whose rungs are different sizes shows a trend that is mostly sampling noise.
    """
    collapsed, _ = collapse(rows)
    out = []
    for model, cells in sorted(by_field(collapsed, "level").items()):
        for level, v in sorted(cells.items()):
            out.append({
                "model": model,
                "level": level,
                "n": v["n"],
                "accuracy": v["accuracy"],
                # REPORTED, not hidden: a rung below the threshold is labelled so nobody
                # reads a difference between two thin rungs as a finding.
                "thin": v["n"] < THIN_LEVEL,
            })
    return out


def blind_gap(rows: list[dict], blind_rows: list[dict], field: str = "capability") -> list[dict]:
    """THE TEXT-ONLY BASELINE: what survives when the image is withdrawn.

    Phase 5 asks the leaderboard to carry a *"text-only ... baseline"*. **The machinery already
    existed** — `blind.py` runs the same questions through `run_release` with `fetch_image`
    returning nothing — but its output was only ever used as a **GATE** (>5% leaked = rewrite
    the item), never as a **REPORTED BASELINE**.

    They are different questions about the same run:

        the gate asks      "is any SINGLE item answerable from the words alone?"
        the baseline asks  "how much of the SCORE survives when the image is gone?"

    An item can pass the gate and a model can still score 30% blind, because the answer
    distribution leaks even when no individual question does. That 30% is the floor the
    with-image number has to be read against, and nothing computed it.

    Matched on (model, question_id) over items present in BOTH traces, because an unmatched
    item would make the two accuracies describe different sets.
    """
    with_img, _ = collapse(rows)
    blind, _ = collapse(blind_rows)

    def index(rs):
        out: dict[tuple, dict] = {}
        for r in rs:
            if r.get("error"):
                continue
            out[(str(r.get("model")), r.get("question_id"))] = r
        return out

    a, b = index(with_img), index(blind)
    shared = set(a) & set(b)

    cells: dict[tuple, dict] = {}
    for key in shared:
        ra, rb = a[key], b[key]
        val = str(ra.get(field) or rb.get(field) or "(unset)")
        c = cells.setdefault((str(ra.get("model")), val), {"seen": [], "blind": []})
        c["seen"].append(1 if ra.get("verdict") == "correct" else 0)
        c["blind"].append(1 if rb.get("verdict") == "correct" else 0)

    out = []
    for (model, val), c in cells.items():
        n = len(c["seen"])
        if not n:
            continue
        seen_acc = sum(c["seen"]) / n
        blind_acc = sum(c["blind"]) / n
        out.append({
            "model": model, field: val, "n": n,
            "accuracy_with_image": seen_acc,
            "accuracy_blind": blind_acc,
            # THE GAP IS THE POINT. A small gap means the item is largely answerable from the
            # words, whatever the gate said about individual items.
            "gap": seen_acc - blind_acc,
            "text_only_share": (blind_acc / seen_acc) if seen_acc else None,
        })
    return sorted(out, key=lambda x: (x["model"], str(x.get(field))))


def constant_answer_baseline(items: list[dict]) -> dict:
    """The floor every accuracy must beat: always guess the most common answer.

    A benchmark whose models score 40% is only meaningful against the number you get by
    answering ONE thing forever. This is a property of the RELEASE, not of any run, which is
    why it takes items rather than rows.

    Two variants, because they are different floors:
      majority     the most common gold answer, for every item
      per_type     the most common gold answer WITHIN each answer_type
    The second is the honest one for a mixed benchmark: a set that is 80% "yes/no" would give
    the majority rule a huge edge on that half and none on the rest.
    """
    if not items:
        return {}
    counts: dict[str, int] = {}
    by_type: dict[str, dict[str, int]] = {}
    # PER CAPABILITY, which is what Phase 5 actually asks for: "constant-answer, text-only and
    # human-ceiling baselines PER CAPABILITY". A capability that is 90% "yes" has a far higher
    # floor than a balanced one, so a single overall floor hides exactly the comparison the
    # leaderboard is for.
    by_cap: dict[str, dict[str, int]] = {}
    for it in items:
        a = str(it.get("answer") or "").strip().lower()
        if not a:
            continue
        counts[a] = counts.get(a, 0) + 1
        at = str(it.get("answer_type") or "(unset)")
        by_type.setdefault(at, {})
        by_type[at][a] = by_type[at].get(a, 0) + 1
        cap = str(it.get("capability") or "(unset)")
        by_cap.setdefault(cap, {})
        by_cap[cap][a] = by_cap[cap].get(a, 0) + 1
    total = sum(counts.values())
    if not total:
        return {}
    majority, majority_n = max(counts.items(), key=lambda kv: kv[1])
    per_type = {}
    per_type_correct = 0
    for at, c in by_type.items():
        best, bn = max(c.items(), key=lambda kv: kv[1])
        per_type[at] = {"answer": best, "n": sum(c.values()), "accuracy": bn / sum(c.values())}
        per_type_correct += bn
    per_cap = {}
    per_cap_correct = 0
    for cap, c in by_cap.items():
        best, bn = max(c.items(), key=lambda kv: kv[1])
        n_cap = sum(c.values())
        per_cap[cap] = {"answer": best, "n": n_cap, "accuracy": bn / n_cap}
        per_cap_correct += bn
    return {
        "n_items": total,
        "majority_answer": majority,
        "majority_accuracy": majority_n / total,
        "per_type": per_type,
        "per_type_accuracy": per_type_correct / total,
        "per_capability": per_cap,
        "per_capability_accuracy": per_cap_correct / total,
        "distinct_answers": len(counts),
    }


def by_field(rows: list[dict], field: str) -> dict:
    rows, _ = collapse(rows)
    groups: dict[tuple[str, str], list[dict]] = {}
    for r in rows:
        groups.setdefault((str(r.get("model")), str(r.get(field))), []).append(r)
    out: dict[str, dict[str, dict]] = {}
    for key in sorted(groups):
        model, val = key
        n, acc = _acc(groups[key])
        out.setdefault(model, {})[val] = {"n": n, "accuracy": acc}
    return out


def asr(clean: list[dict], attacked: list[dict]) -> dict:
    """Attack success rate.

    Denominator: items the model answered CORRECTLY on the clean image. Items it
    already got wrong are excluded, so this measures robustness, not ability.
    """
    clean, _ = collapse(clean)
    attacked, _ = collapse(attacked)
    gold = {(r["model"], r["question_id"]): r for r in clean}
    flip = denom = 0
    per_model: dict[str, list[int]] = {}
    for r in attacked:
        base = gold.get((r["model"], r["question_id"]))
        if base is None or base.get("verdict") != "correct":
            continue
        denom += 1
        bad = r.get("verdict") != "correct" or r.get("abstained") == 1
        per_model.setdefault(r["model"], [0, 0])[0] += 1
        if bad:
            flip += 1
            per_model[r["model"]][1] += 1
    return {
        "asr": (flip / denom) if denom else None,
        "n_flipped": flip,
        "n_clean_correct": denom,
        "per_model": {m: {"asr": (v[1] / v[0]) if v[0] else None, "n": v[0]} for m, v in per_model.items()},
    }


def print_report(rows: list[dict], items: list[dict] | None = None,
                 blind_rows: list[dict] | None = None, field: str = "capability") -> None:
    print("LEADERBOARD")
    print("  " + "model".ljust(30) + "items".rjust(7) + "samples".rjust(9) + "acc".rjust(8)
          + "abst".rjust(8) + "parse".rjust(8) + "err".rjust(7) + "unstable".rjust(10))
    for m in leaderboard(rows):
        print("  " + m["model"][:30].ljust(30) + str(m["n"]).rjust(7)
              + str(m["n_samples"]).rjust(9)
              + format(m["accuracy"], ".3f").rjust(8)
              + format(m["abstention_rate"], ".3f").rjust(8)
              + format(m["parse_fail_rate"], ".3f").rjust(8)
              + format(m["error_rate"], ".3f").rjust(7)
              + format(m["unstable_rate"], ".3f").rjust(10))
    _, stats = collapse(rows)
    if stats["n_samples"] > stats["n_items"]:
        print()
        print("  " + str(stats["n_samples"]) + " samples over " + str(stats["n_items"])
              + " items. Each item is reduced to ONE verdict by majority (a tie counts as")
        print("  wrong), and " + str(stats["unstable"]) + " item(s) disagreed across repeats"
              + " — that is the unstable column above.")

    print()
    print("PAIRED DIAGNOSTIC (the headline table)")
    table = pair_breakdown(rows)
    if not table:
        print("  no complete pairs in these traces")
    for model, counts in sorted(table.items()):
        total = sum(counts.values())
        print("  " + model[:34])
        for c in CELLS:
            n = counts.get(c, 0)
            if n:
                print("      " + c.ljust(30) + str(n).rjust(5) + "  " + format(n / total, ".1%"))

    print()
    print("BY CAPABILITY")
    for model, cells in sorted(by_field(rows, "capability").items()):
        parts = [k + "=" + format(v["accuracy"], ".2f") + "(n" + str(v["n"]) + ")" for k, v in sorted(cells.items())]
        print("  " + model[:30].ljust(30) + "  " + " ".join(parts))

    # ONLY PRINTED WHEN THERE IS A SERIES. A single-run trace has one condition, and a
    # one-row "series" table is noise — the same reason `slopes` refuses to fit one point.
    ser = series(rows)
    if len(ser) > 1:
        print()
        print("THE SERIES  (one row per condition; the control is the baseline)")
        print("  " + "model".ljust(22) + "condition".ljust(14) + "sev".rjust(6)
              + "n".rjust(6) + "accuracy".rjust(10) + "abstained".rjust(11))
        for x in ser:
            print("  " + x["model"][:21].ljust(22) + x["condition"][:13].ljust(14)
                  + (format(x["severity"], "g") if x["severity"] is not None else "-").rjust(6)
                  + str(x["n"]).rjust(6) + format(x["accuracy"], ".3f").rjust(10)
                  + format(x["abstention_rate"], ".3f").rjust(11))

        # THE FLOORS, without which an accuracy is unreadable. The constant-answer floor comes
        # from the RELEASE (a trace does not carry the gold answer); the text-only floor from a
        # blind trace. Each is printed only when its input was supplied, rather than as a zero
        # that would read as a measurement.
        if items:
            cb = constant_answer_baseline(items)
            if cb:
                print()
                print("THE FLOOR  (a model must beat this by answering ONE thing forever)")
                print("  majority answer " + repr(cb["majority_answer"])
                      + " scores " + format(cb["majority_accuracy"], ".3f")
                      + "   per-answer-type " + format(cb["per_type_accuracy"], ".3f")
                      + "   per-capability " + format(cb["per_capability_accuracy"], ".3f"))
                print("  " + "capability".ljust(14) + "n".rjust(6) + "floor".rjust(9)
                      + "   always")
                for cap, v in sorted(cb["per_capability"].items()):
                    print("  " + cap[:13].ljust(14) + str(v["n"]).rjust(6)
                          + format(v["accuracy"], ".3f").rjust(9) + "   " + repr(v["answer"]))

        cal = calibration(rows)
        if cal:
            print()
            print("CALIBRATION  (does confidence mean anything?)")
            print("  " + "model".ljust(24) + "n".rjust(6) + "ECE".rjust(9) + "Brier".rjust(9)
                  + "acc".rjust(8) + "mean conf".rjust(11) + "AURC".rjust(9))
            for x in cal:
                print("  " + x["model"][:23].ljust(24) + str(x["n"]).rjust(6)
                      + format(x["ece"], ".3f").rjust(9) + format(x["brier"], ".3f").rjust(9)
                      + format(x["accuracy"], ".3f").rjust(8)
                      + format(x["mean_confidence"], ".3f").rjust(11)
                      + format(x["aurc"], ".3f").rjust(9))
            for x in cal:
                sel = "  ".join(k + "=" + format(v, ".3f") for k, v in x["selective_accuracy"].items())
                print("    " + x["model"][:28].ljust(30) + "selective accuracy  " + sel)
                # A BIN WITH TWO ITEMS IS NOISE THAT LOOKS LIKE SIGNAL, so the population is
                # printed beside the gap and a thin bin is labelled.
                thin = [b for b in x["bins"] if b["n"] and b["n"] < 10]
                if thin:
                    print("    " + " " * 30 + str(len(thin)) + " bin(s) hold fewer than 10 items"
                          + " — their ECE contribution is noise")

        cf = counterfactual_consistency(rows)
        if cf:
            print()
            print("THE COUNTERFACTUAL CONTROL  (the object is gone; did the answer change?)")
            for x in cf:
                print("  " + x["model"][:24].ljust(26) + x["image_edit"][:14].ljust(16)
                      + "n=" + str(x["n"]).ljust(6)
                      + "consistency=" + format(x["consistency"], ".3f")
                      + "   repeated=" + str(x["repeated_original_answer"]))

        lad = difficulty_ladder(rows)
        if lad:
            print()
            print("THE DIFFICULTY LADDER  (a thin rung is labelled, not averaged in)")
            for x in lad:
                print("  " + x["model"][:22].ljust(24) + x["level"][:10].ljust(12)
                      + "n=" + str(x["n"]).ljust(6) + format(x["accuracy"], ".3f").ljust(8)
                      + ("  THIN" if x["thin"] else ""))

        if blind_rows:
            bg = blind_gap(rows, blind_rows, field)
            if bg:
                print()
                print("THE TEXT-ONLY FLOOR  (the image is withdrawn; how much survives?)")
                print("  " + "model".ljust(22) + field[:12].ljust(14) + "n".rjust(6)
                      + "with image".rjust(12) + "blind".rjust(9) + "gap".rjust(9))
                for x in bg:
                    print("  " + x["model"][:21].ljust(22) + str(x.get(field))[:13].ljust(14)
                          + str(x["n"]).rjust(6)
                          + format(x["accuracy_with_image"], ".3f").rjust(12)
                          + format(x["accuracy_blind"], ".3f").rjust(9)
                          + format(x["gap"], ".3f").rjust(9))

        sl = slopes(rows)
        if sl:
            print()
            print("THE SLOPE  (accuracy against severity — the roadmap's corruption slope)")
            print("  the comparison that matters is physics-versus-perception: a steeper fall")
            print("  for P* than for G* means perception degrades faster than geometry.")
            print("  " + "model".ljust(22) + "corruption".ljust(12) + "capability".ljust(12)
                  + "slope".rjust(9) + "low->high".rjust(14) + "points".rjust(8))
            for x in sl:
                if x["slope"] is None:
                    print("  " + x["model"][:21].ljust(22) + x["corruption"][:11].ljust(12)
                          + str(x.get("capability"))[:11].ljust(12)
                          + "n/a".rjust(9) + "".rjust(14) + str(x["n_points"]).rjust(8)
                          + "   " + x.get("reason", ""))
                    continue
                span = format(x["accuracy_at_lowest"], ".2f") + "->" + format(x["accuracy_at_highest"], ".2f")
                print("  " + x["model"][:21].ljust(22) + x["corruption"][:11].ljust(12)
                      + str(x.get("capability"))[:11].ljust(12)
                      + format(x["slope"], "+.4f").rjust(9) + span.rjust(14)
                      + str(x["n_points"]).rjust(8))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Analyse harness traces locally.")
    ap.add_argument("traces", nargs="+", help="one or more trace jsonl files")
    ap.add_argument("--clean", default=None, help="clean trace, for ASR")
    ap.add_argument("--attacked", default=None, help="attacked trace, for ASR")
    # The constant-answer floor is a property of the RELEASE, not of any run — a trace records
    # verdicts, not gold answers — so it needs the release directory.
    ap.add_argument("--release", default=None,
                    help="a release directory, for the constant-answer floor")
    ap.add_argument("--blind", default=None,
                    help="a blind trace (the same items with no image), for the text-only floor")
    ap.add_argument("--field", default="capability",
                    help="the axis to break the floors and slopes down by")
    args = ap.parse_args(argv)

    rows = load(*args.traces)
    if not rows:
        print("no rows", file=sys.stderr)
        return 1
    items = None
    if args.release:
        import json as _json
        qpath = pathlib.Path(args.release) / "questions.jsonl"
        if qpath.exists():
            items = [_json.loads(l) for l in qpath.read_text(encoding="utf-8-sig").splitlines() if l.strip()]
        else:
            print("no questions.jsonl in " + args.release + " — the floor needs the release")
    blind_rows = None
    if args.blind:
        blind_rows = load(args.blind)

    print_report(rows, items=items, blind_rows=blind_rows, field=args.field)

    if args.clean and args.attacked:
        print()
        print("ATTACK SUCCESS RATE (denominator: items correct on the clean image)")
        print("  " + json.dumps(asr(load(args.clean), load(args.attacked)), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
