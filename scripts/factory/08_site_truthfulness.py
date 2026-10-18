#!/usr/bin/env python3
"""
STATIC TRUTHFULNESS GUARD for the site.

Why this exists
---------------
The site once described the corpus as "55,969 images where vision models fail".
No vision model had ever been run on this corpus. The claim was in the meta tags,
so it was what any link-preview, search result, or citation would show.

This script is the guard rail for that class of mistake. It fails loudly.

Run in CI, or before every commit:
    python scripts/factory/08_site_truthfulness.py

Exit 0 = clean. Exit 1 = something is claiming more than we have measured.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WEB_SRC = ROOT / "apps" / "web"
SITE_PKG = ROOT / "packages" / "site" / "src"
EXPLAINER_SRC = ROOT / "apps" / "explainer" / "src"

# (regex, why it is forbidden, where it is allowed to appear)
#
# "allowed" is a list of file globs. A hit inside an allowed file is reported as
# INFO rather than FAIL, because some files legitimately discuss the claim
# (e.g. the method page explaining why we do NOT say it).
# EACH PATTERN CARRIES A SAMPLE IT MUST MATCH, and the guard verifies that on every run.
#
# Why: two of these were DEAD and nobody knew. `geometrical?` reads as "geometric or
# geometrical" but actually matches "geometrica"/"geometrical" — so "geometric shape problems",
# the natural phrasing, was never caught. And `(break down|fail)` missed "fails" and "failing".
# A regex that cannot match is indistinguishable from a clean site, which is the same defect as
# a guard with no runner.
#
# Round 59 found both by planting a string for every pattern. The `sample` column is that test,
# kept permanently, so a new pattern is verified the moment it is written.
FORBIDDEN = [
    (r"where vision(-language)? models fail",
     "no model has been run on this corpus", ["method.tsx"],
     "where vision models fail"),
    (r"verified model failure",
     "we have verified no model failures", [],
     "verified model failure"),
    (r"models? (break down|fails?|failing) on (these|our|the) (images|photographs)",
     "no model has been run on this corpus", [],
     "the model fails on our photographs"),
    (r"\b44,?000\b", "stale image count (now 55,969)", [],
     "44,000"),
    (r"\b53k\b", "stale image count (now 55,969)", [],
     "53k"),
    (r"syncing hourly", "the real cadence is daily", [],
     "syncing hourly"),
    (r"geometric(al)? (shape|reasoning) problems",
     "GRIP is a separate dataset and not described here", [],
     "geometric shape problems"),
]


def patterns_are_alive() -> list[str]:
    """Every pattern must match its own sample. Returns the ones that do not.

    A forbidden-phrase list where one entry can never fire is worse than a shorter list,
    because it reads as coverage. Running this on every invocation means a dead pattern is a
    failure rather than a silence.
    """
    dead = []
    for entry in FORBIDDEN:
        pat, _why, _allowed, sample = entry
        if not re.search(pat, sample, re.I):
            dead.append(pat)
    return dead

# Numbers that must agree with data/latest.json, checked for staleness.
CURRENT = {
    "imagesUnique": None,   # filled at runtime
}


def collect() -> list[Path]:
    out: list[Path] = []
    skip = {"dist", "node_modules", ".turbo", ".vite"}
    for base in (WEB_SRC, SITE_PKG, EXPLAINER_SRC):
        if base.exists():
            out += [p for p in base.rglob("*.tsx") if p.is_file() and not (skip & set(p.parts))]
            out += [p for p in base.rglob("*.ts") if p.is_file() and not (skip & set(p.parts))]
            out += [p for p in base.rglob("*.html") if p.is_file() and not (skip & set(p.parts))]
    # The OG generator writes per-route HTML served at the apex domain, so a
    # false claim can reappear there even after index.html is fixed. It is a
    # build input, not a source file, and must be checked too.
    og = ROOT / "scripts" / "og"
    if og.exists():
        out += [p for p in og.glob("*.mjs") if p.is_file()]
    return out


def main() -> int:
    import json
    latest = ROOT / "data" / "latest.json"
    unique = None
    if latest.exists():
        unique = json.loads(latest.read_text(encoding="utf-8-sig"))["meta"]["counts"]["imagesUnique"]
    print(f"corpus unique images (from latest.json): {unique:,}" if unique
          else "latest.json not found — skipping count check")

    failures, infos = [], []

    # THE GUARD CHECKS ITSELF FIRST. A pattern that cannot match reads as coverage while
    # covering nothing, and two of them sat here for as long as this file has existed.
    dead = patterns_are_alive()
    if dead:
        print()
        print(str(len(dead)) + " FORBIDDEN PATTERN(S) THAT CANNOT MATCH THEIR OWN SAMPLE:")
        for d in dead:
            print("  " + d)
        print()
        print("A pattern that never fires is not protection. Fix the regex, or remove it.")
        return 1

    files = collect()

    for f in files:
        try:
            text = f.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        for pat, why, allowed, _sample in FORBIDDEN:
            for m in re.finditer(pat, text, re.I):
                line = text[: m.start()].count("\n") + 1
                snippet = re.sub(r"\s+", " ", text[max(0, m.start() - 50): m.end() + 50])
                rec = (f, line, why, snippet)
                if f.name in allowed:
                    infos.append(rec + ("explained on the method page",))
                else:
                    failures.append(rec)

    # stale hard-coded counts
    if unique:
        for f in files:
            try:
                text = f.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue
            for m in re.finditer(r"(\d{2,3})[, ]?(\d{3})\s+unique", text):
                n = int(m.group(1) + m.group(2))
                exempt = f.name in ("method.tsx", "start-here.md") or "contributors" in f.parts
                if abs(n - unique) > 500 and not exempt:
                    failures.append((f, text[: m.start()].count("\n") + 1,
                                     f"hard-coded count {n:,} != {unique:,}",
                                     re.sub(r"\s+", " ", text[max(0, m.start()-40):m.end()+40])))

    # ---- a claim that names a gate check must name one that EXISTS -------------
    #
    # This check exists because it was needed. The rules page told every contributor
    # "a script checks option-length spread and correct-answer position before
    # anything is frozen" — and NO SUCH CHECK EXISTED. That is the same class of error
    # as the corpus headline this file guards, and it is harder to catch: it asserts a
    # MECHANISM rather than a result, so nothing contradicts it until someone looks.
    #
    # Requiring the claim to cite a check ID makes it mechanically verifiable.
    gate = ROOT / "scripts" / "factory" / "03_verify.py"
    if gate.exists():
        gate_text = gate.read_text(encoding="utf-8", errors="ignore")
        known = set(re.findall(r'"(C\d+\.\d+[a-z]?)"', gate_text))
        for f in files:
            try:
                text = f.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue
            for m in re.finditer(r"\b(C\d+\.\d+[a-z]?)\b", text):
                cid = m.group(1)
                if cid not in known:
                    failures.append((f, text[: m.start()].count("\n") + 1,
                                     f"cites gate check {cid}, which does not exist in 03_verify.py",
                                     re.sub(r"\s+", " ", text[max(0, m.start() - 60): m.end() + 60])))

    if infos:
        print(f"\n{len(infos)} note(s) — mentioned in a context that explains it:")
        for f, ln, why, snip, note in infos:
            print(f"  INFO  {f.name}:{ln}  {why}")

    if failures:
        print(f"\n{len(failures)} UNSUPPORTED CLAIM(S):")
        for f, ln, why, snip in failures:
            print(f"  FAIL  {f.relative_to(ROOT)}:{ln}")
            print(f"        {why}")
            print(f"        …{snip}…")
        print("\nFix the wording, or add the filename to the `allowed` list with a reason.")
        return 1

    print(f"\nOK — {len(files)} source files, no unsupported claims.")
    return 0


if __name__ == "__main__":
    sys.exit(main())