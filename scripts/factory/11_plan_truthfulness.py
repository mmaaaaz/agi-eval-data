#!/usr/bin/env python3
"""
PLAN TRUTHFULNESS — a stated total must equal the rows above it.

WHY THIS EXISTS
---------------
Six consecutive rounds found the same defect in a different document: a claim that was true
when written and false later, because the system moved and the prose did not.

The sharpest instance was `costs.md`: a table whose eight rows summed to 698 carried a
"Subtotal, build only" of **463**, and the sentence below it said the build was "comfortably
above" the team's 576 hours of capacity. With the rows, the comparison is 578 against 576 and
**the sign reverses.** Every individual row was right. The subtotal was not.

That is mechanical, so it should not need a person to notice it. This script checks every
markdown table in the plan for a total row that does not match its own rows.

THE RULE, AND WHY IT IS THIS RULE
---------------------------------
A total must equal the sum of **a contiguous run of the rows above it** — all of them, or a
prefix, because a "build only" subtotal legitimately stops before "paper writing".

The first version of this check was simpler: total == sum of everything above. That would have
**failed the corrected table**, where 578 is the sum of rows 1-7 and row 8 (paper writing) is
deliberately excluded. A guard that flags a correct document gets switched off, so the rule has
to accept the legitimate shape.

It also has to reject the wrong one. 463 happens to be *some* subset sum (208+174+25+56), which
is why "any subset" would not work. It is not a **contiguous** run, and the real subtotal is.

Usage:
    python scripts/factory/11_plan_truthfulness.py
    python scripts/factory/11_plan_truthfulness.py --json
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
PLAN = ROOT / ".scratch" / "seen-not-grasped"

TOTAL_LABEL = re.compile(r"\b(subtotal|total)\b", re.I)
# A cell is a number if, once decoration is stripped, it is only digits and separators.
_NUM = re.compile(r"^-?\d[\d,]*$")


def cell_number(cell: str) -> int | None:
    """The integer in a markdown cell, or None if it is not a number.

    Strips the decoration these tables actually use: bold markers, a leading tilde for
    "approximately", thousands separators, and footnote asterisks.
    """
    s = cell.strip().replace("**", "").replace("*", "").replace("~", "").replace(" ", "")
    s = s.replace("$", "").replace("USD", "")
    if not s or not _NUM.match(s):
        return None
    try:
        return int(s.replace(",", ""))
    except ValueError:
        return None


def parse_tables(text: str) -> list[tuple[int, list[list[str]]]]:
    """(first line number, rows) for every markdown table in the text."""
    tables: list[tuple[int, list[list[str]]]] = []
    current: list[list[str]] = []
    start = 0
    for i, line in enumerate(text.splitlines(), 1):
        if line.strip().startswith("|") and line.strip().endswith("|"):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if all(re.fullmatch(r":?-{2,}:?", c or "-") for c in cells):
                continue  # the separator row
            if not current:
                start = i
            current.append(cells)
        else:
            if current:
                tables.append((start, current))
                current = []
    if current:
        tables.append((start, current))
    return tables


def contiguous_total(row_index: int, rows: list[list[str]], width: int,
                     prior_sum: int = 0) -> tuple[bool, str]:
    """Is this total row explainable as a contiguous run of the rows above it?

    Returns (ok, description of the run that works).
    """
    if row_index == 0:
        return True, "no rows above"
    above = rows[:row_index]
    values = []
    for r in above:
        vals = [cell_number(c) for c in r]
        if all(v is None for v in vals):
            # SKIP, do not return. The first version returned True here, so the HEADER ROW
            # ("Activity | Basis | Hours" — no numbers) aborted the check and passed the
            # whole table. Planted against the known-bad 463 table, it reported OK.
            #
            # A guard that passes because it stopped reading is the same failure as a guard
            # with no signal, and it is worse here because the check LOOKS like it ran.
            continue
        values.append(vals)
    if not values:
        return True, "no numeric rows above"

    total = [cell_number(c) for c in rows[row_index]]
    cols = [i for i in range(width) if i < len(total) and total[i] is not None]
    if not cols:
        return True, "no numeric total"
    # A cell marked "~700" declares itself approximate, and 700 against a sum of 698 is
    # rounding rather than an error. Let the DOCUMENT's own marker decide: a tilde allows a
    # 1% tolerance, and anything else must be exact. The real defect this guard exists for —
    # 463 against 578 — is a 20% miss, so the tolerance does not hide it.
    approx = [("~" in (rows[row_index][c] or "")) if c < len(rows[row_index]) else False
              for c in range(width)]

    # Try the whole block, then every prefix, then every contiguous run.
    candidates: list[tuple[str, list[list[int | None]]]] = [("all rows above", values)]
    for k in range(1, len(values)):
        candidates.append(("rows 1-%d" % k, values[:k]))
        candidates.append(("rows %d-%d" % (k + 1, len(values)), values[k:]))
    # AND THE CROSS-TABLE SHAPE, which is legitimate and common in these documents: a
    # "Subtotal, build only" row in the THIRD table covers the two tables above it as well as
    # its own rows. `costs.md` is exactly this — 208 authoring + 174 review in tables one and
    # two, plus 196 of its own rows = 578. A table-local rule alone flags that as an error,
    # and a guard that flags a correct document is one somebody switches off.
    #
    # So: the sum of every number in every preceding table, plus a contiguous run here.
    # (handled in the comparison below, not as a synthetic row: a synthetic row would put
    # prior_sum in column 0 while the total's numeric column is often column 2.)
    for label, block in candidates:
        for with_prior in ((False, True) if prior_sum else (False,)):
            ok = True
            for c in cols:
                s = sum(b[c] for b in block if c < len(b) and b[c] is not None)
                if with_prior:
                    s += prior_sum
                if s == total[c]:
                    continue
                if approx[c] and abs(s - total[c]) <= max(1, abs(s) // 100):
                    continue
                ok = False
                break
            if ok:
                tag = "preceding tables + " if with_prior else ""
                return True, tag + label + (" (approx)" if any(approx[c] for c in cols) else "")
    return False, ""


def check_doc(path: pathlib.Path) -> list[dict]:
    text = path.read_text(encoding="utf-8-sig")
    problems = []
    prior_sum = 0
    for start, rows in parse_tables(text):
        for i, r in enumerate(rows):
            if not r or not TOTAL_LABEL.search(r[0] or ""):
                continue
            ok, how = contiguous_total(i, rows, len(r), prior_sum)
            if ok:
                continue
            above = rows[:i]
            stated = [cell_number(c) for c in r]
            # what the full block above actually sums to, for the message
            actual = []
            for c in range(len(r)):
                s = 0
                seen = False
                for a in above:
                    v = cell_number(a[c]) if c < len(a) else None
                    if v is not None:
                        s += v
                        seen = True
                actual.append(s if seen else None)
            try:
                shown = str(path.resolve().relative_to(ROOT))
            except ValueError:
                # --dir can point anywhere, including a scratch directory outside the repo
                # (which is exactly how this guard is tested against a planted bad table).
                shown = str(path)
            problems.append({
                "file": shown,
                "line": start + i,
                "label": (r[0] or "").strip(),
                "stated": stated,
                "sum_of_rows_above": actual,
                "n_rows": len(above),
            })
        # What this table contributes to LATER tables' totals: the emphasised ("target") row's
        # last numeric cell, and nothing else.
        #
        # Not every number. The authoring and review tables each list three scenarios
        # (1,000 / 2,500 / 5,000 images), and a subtotal built from all of them would be
        # nonsense. The document already marks which row it means — **2,500 (target)** — so the
        # guard reads the same signal a person does.
        #
        # First attempt summed every number in prior tables and got 43,800, which explained
        # nothing. Reading the emphasis is both simpler and what the tables actually express.
        for r in rows:
            if not r or "**" not in (r[0] or ""):
                continue
            for c in reversed(r):
                v = cell_number(c)
                if v is not None:
                    prior_sum += v
                    break
    return problems



# ---------------------------------------------------------------------------
# The other two classes of stale claim these rounds found. Both are mechanical.
# ---------------------------------------------------------------------------

_OPEN_BOX = re.compile(r"^\s*-\s*\[ \]", re.M)
# re.M IS LOAD-BEARING. Without it, ^ matches only the first character of the FILE, and a
# ticket's Status line is always on line 3 — so this never matched anything and the whole
# ticket check silently passed every document. Found by planting a contradictory ticket and
# getting no complaint. Third false negative in this guard, all three found by planting.
_DONE_STATUS = re.compile(r"^\*\*Status:\*\*\s*(done|in place)\b", re.I | re.M)

# number words these documents actually use
_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13,
    "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
    "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
}
_COUNT_CLAIM = re.compile(
    r"\b(\d+|" + "|".join(sorted(_WORDS, key=len, reverse=True)) + r")\s+"
    r"(?:idle\s+|working\s+)?pipeline(?:\s+and\s+harness)?\s+scripts\b", re.I)


def check_tickets(issues_dir: pathlib.Path) -> list[dict]:
    """A ticket that says DONE must have no unticked boxes, and vice versa.

    Round 52 found FIVE tickets marked done with unchecked acceptance criteria — four were
    bookkeeping and one (the frozen selection snapshot) was a genuinely missing endpoint. The
    contradiction is visible in the file without running anything, which is exactly the kind of
    thing a machine should notice.
    """
    out = []
    if not issues_dir.exists():
        return out
    for md in sorted(issues_dir.glob("*.md")):
        text = md.read_text(encoding="utf-8-sig")
        open_boxes = [l for l in text.splitlines() if _OPEN_BOX.match(l)]
        status_done = bool(_DONE_STATUS.search(text))
        if status_done and open_boxes:
            out.append({
                "file": str(md.name),
                "issue": "Status says done but " + str(len(open_boxes))
                         + " acceptance criteria are unticked",
                "first": open_boxes[0].strip()[:90],
            })
    return out



# ---------------------------------------------------------------------------
# TRIAGE LABELS
# ---------------------------------------------------------------------------

LABELS = ("needs-triage", "needs-info", "ready-for-agent", "ready-for-human", "wontfix")

# A ticket is CLOSED when its status begins with "done". Everything else is OPEN and must say
# what it is waiting for.
_CLOSED = re.compile(r"^\s*\*\*Status:\*\*\s*[`\"']?done\b", re.I | re.M)
_STATUS = re.compile(r"^\s*\*\*Status:\*\*\s*(.*)$", re.M)
_LABEL = re.compile(r"[`\"'](" + "|".join(LABELS) + r")[`\"']")


_BLOCKED = re.compile(r"^\s*\*\*Blocked by:\*\*\s*(.*)$", re.M)


def find_bad_blockers(issues_dir: pathlib.Path) -> list[dict]:
    """A "Blocked by" line whose first token is not none, external, or real ticket numbers.

    `issue-tracker.md` documented "next up: the lowest-numbered ticket whose every Blocked by is
    done". **That rule could not be followed.** The lines read `None (can start immediately)`,
    `nothing`, and `the permitted spend — it is 57,600 + 144,000 model calls` — so a parser would
    have read "the owner" as a ticket number.

    **The grammar is now `none` / `external` / ticket numbers**, and this enforces it.
    """
    out = []
    if not issues_dir.exists():
        return out
    names = {p.name[:2] for p in issues_dir.glob("*.md")}
    for p in sorted(issues_dir.glob("*.md")):
        m = _BLOCKED.search(p.read_text(encoding="utf-8-sig", errors="ignore"))
        if not m:
            out.append({"file": p.name, "why": "no Blocked by line"})
            continue
        first = m.group(1).split("\u2014")[0].split("--")[0].strip().rstrip(",").strip()
        if first in ("none", "external"):
            continue
        for ref in [x for x in re.split(r"[,\s]+", first) if x]:
            if not re.fullmatch(r"\d{2}", ref):
                out.append({"file": p.name, "why": "blocker " + repr(ref)
                            + " is not none, external, or a ticket number"})
            elif ref not in names:
                out.append({"file": p.name, "why": "blocker " + ref + " names no ticket"})
    return out


_OPTION = __import__("re").compile(r"\*\*Option [A-C]\b", __import__("re").I)


def find_decisions_without_options(issues_dir: pathlib.Path) -> list[dict]:
    """A needs-info ticket that does not lay out the options.

    A TICKET MARKED `needs-info` IS ASKING FOR A DECISION. If it describes the situation and stops,
    the owner has to DESIGN the choice before making it - which is most of the work, and the part
    an agent can do. **Naming the options with their costs turns the task from a puzzle into a
    pick.**

    Measured in round 121: four of the six decision tickets carried **no option markers at all**.
    """
    out = []
    if not issues_dir.exists():
        return out
    for p in sorted(issues_dir.glob("*.md")):
        text = p.read_text(encoding="utf-8-sig", errors="ignore")
        m = _STATUS.search(text)
        if not m or "needs-info" not in m.group(1):
            continue
        if not _OPTION.search(text):
            out.append({"file": p.name})
    return out


def find_unlabelled_tickets(issues_dir: pathlib.Path) -> list[dict]:
    """An OPEN ticket with no triage label.

    `docs/agents/triage-labels.md` stated that labels are written on the Status line of every
    ticket. On 13 October 2026 **no ticket carried one at all** — all 25 Status lines were free
    prose — so a reader following that file would have concluded every ticket was untriaged.

    **A documented convention that nobody follows is worse than no convention**, because it is
    read as a description of the current state.
    """
    out = []
    if not issues_dir.exists():
        return out
    for p in sorted(issues_dir.glob("*.md")):
        text = p.read_text(encoding="utf-8-sig", errors="ignore")
        m = _STATUS.search(text)
        if not m:
            out.append({"file": p.name, "why": "no Status line"})
            continue
        if _CLOSED.search(text):
            continue
        if not _LABEL.search(m.group(1)):
            out.append({"file": p.name, "why": "open, but no triage label"})
    return out

def check_declared_counts(docs: list[pathlib.Path], factory_dir: pathlib.Path,
                          harness_dir: pathlib.Path) -> list[dict]:
    """A sentence that names how many scripts exist must match how many there are.

    `spec.md` said "eight idle pipeline scripts" while there were 16 factory stages and 17
    harness modules. The phrase is narrow enough to check without guessing at prose.
    """
    actual = len([p for p in factory_dir.glob("*.py")
                  if p.name not in ("__init__.py", "run_pipeline.py")]) \
        + len([p for p in harness_dir.glob("*.py") if p.name != "__init__.py"])
    # PROGRESS.md IS A DATED LOG, NOT A SET OF CURRENT CLAIMS. An entry from round 56 saying
    # "33 working scripts" was TRUE then and became false when round 58 added one. Checking it
    # would mean rewriting history on every change, which is worse than the drift: the log's
    # value is that it records what was believed at the time.
    #
    # It is excluded explicitly, not silently, and the live documents — spec, costs, roadmap,
    # LIMITATIONS — are all still checked.
    docs = [d for d in docs if d.name != "PROGRESS.md"]
    out = []
    for d in docs:
        # SEARCH THE WHOLE DOCUMENT, NOT LINE BY LINE. Markdown wraps prose, and the claim
        # reads "...and **33 working\npipeline and harness scripts**" — so a line-by-line
        # search misses it and the check reports OK on a wrong number. The first version did
        # exactly that, and only planting the case revealed it.
        text = d.read_text(encoding="utf-8-sig")
        for m in _COUNT_CLAIM.finditer(text):
            # A QUOTED PHRASE IS BEING DISCUSSED, NOT ASSERTED. The correction notes say things
            # like: "Eight idle pipeline scripts" was true when this was written. Flagging that
            # is a false positive on a line whose only purpose is to record the old value.
            before = text[: m.start()].rstrip()
            if before.endswith(('"', "'", "“", "‘")):
                continue
            raw = m.group(1).lower()
            claimed = int(raw) if raw.isdigit() else _WORDS.get(raw)
            if claimed is None or claimed == actual:
                continue
            out.append({
                "file": d.name,
                "line": text[: m.start()].count("\n") + 1,
                "issue": "says " + m.group(0).strip() + " but there are " + str(actual),
            })
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="A stated total must match the rows above it.")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--dir", default=str(PLAN))
    args = ap.parse_args()

    base = pathlib.Path(args.dir)
    if not base.exists():
        # THE PLAN IS PRIVATE AND GITIGNORED, so this guard cannot run in CI — by design, not
        # by accident. The distinction that matters: a MISSING DEFAULT means "the private plan
        # is not checked out here", which is normal; a missing --dir means somebody typed a
        # path that is not there, which is an error either way.
        if args.dir != str(PLAN):
            print("no plan directory at " + str(base), file=sys.stderr)
            return 2
        print("plan documents not present at " + str(base))
        print("  (.scratch/ is gitignored and private, so this guard only runs where it")
        print("   is checked out. It is SKIPPED here, not passed — nothing was checked.)")
        return 0
    if not any(base.glob("*.md")):
        print("no markdown documents in " + str(base), file=sys.stderr)
        return 2

    docs = sorted(base.glob("*.md"))
    problems: list[dict] = []
    for d in docs:
        problems += check_doc(d)

    # the two other mechanical classes
    tickets = check_tickets(base / "issues")
    counts = check_declared_counts(docs, ROOT / "scripts" / "factory", ROOT / "scripts" / "harness")
    unlabelled = find_unlabelled_tickets(base / "issues")
    blockers = find_bad_blockers(base / "issues")
    no_opts = find_decisions_without_options(base / "issues")

    if args.json:
        print(json.dumps({"docs": len(docs), "problems": problems,
                          "ticket_contradictions": tickets, "count_claims": counts}, indent=1))
        return 1 if (problems or tickets or counts or unlabelled or blockers or no_opts) else 0

    print("checked " + str(len(docs)) + " plan documents, plus the ticket checklists, for")
    print("claims that no longer match the system:")
    print("  - totals that do not equal their own rows")
    print("  - tickets marked done with unticked acceptance criteria")
    print("  - sentences that name how many scripts exist")
    if unlabelled:
        print(str(len(unlabelled)) + " OPEN TICKET(S) WITH NO TRIAGE LABEL:")
        for x in unlabelled:
            print("  " + x["file"] + " — " + x["why"])
        print()
        print("docs/agents/triage-labels.md says a label goes on the Status line of every open")
        print("ticket. When that was first checked, NOT ONE of 25 tickets had ever carried one.")
        print()
    if blockers:
        print(str(len(blockers)) + " TICKET(S) WITH A BLOCKER THAT CANNOT BE PARSED:")
        for x in blockers:
            print("  " + x["file"] + " — " + x["why"])
        print()
        print("The grammar is none / external / ticket numbers. Without it, 'next up' is a rule")
        print("nobody can compute — including the agent issue-tracker.md is written for.")
        print()
    if no_opts:
        print(str(len(no_opts)) + " DECISION TICKET(S) WITH NO OPTIONS:")
        for x in no_opts:
            print("  " + x["file"])
        print()
        print("A ticket marked needs-info is asking for a decision. If it describes the situation and")
        print("stops, the owner has to DESIGN the choice before making it. Naming the options with")
        print("their costs turns a puzzle into a pick.")
        print()
    if not (problems or tickets or counts or unlabelled or blockers or no_opts):
        print()
        print("OK — every checkable claim still matches.")
        return 0

    print()
    print(str(len(problems)) + " TOTAL(S) THAT DO NOT MATCH:")
    for p in problems:
        print("  " + p["file"] + ":" + str(p["line"]))
        print("    " + p["label"])
        print("    stated              : " + json.dumps(p["stated"]))
        print("    sum of rows above   : " + json.dumps(p["sum_of_rows_above"])
              + "   (" + str(p["n_rows"]) + " rows)")
        print("    and no contiguous run of those rows produces the stated figure.")
    if tickets:
        print()
        print(str(len(tickets)) + " TICKET(S) THAT CONTRADICT THEMSELVES:")
        for t in tickets:
            print("  " + t["file"] + ": " + t["issue"])
            print("      " + t["first"])
    if counts:
        print()
        print(str(len(counts)) + " COUNT(S) THAT DO NOT MATCH THE CODE:")
        for c in counts:
            print("  " + c["file"] + ":" + str(c["line"]) + ": " + c["issue"])
    print()
    print("Either correct the claim, or state what it covers.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
