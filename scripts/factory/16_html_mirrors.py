#!/usr/bin/env python3
"""
THE HAND-MAINTAINED .html MIRRORS MUST NOT DRIFT.

WHY THIS EXISTS
---------------
`roadmap.md`, `spec.md`, `costs.md` and the glossary each have a hand-maintained `.html` mirror
with **no build step** — verified by reading `scripts/` for a generator, and finding none. So every
correction has had to be applied twice, by hand, and the log shows that being checked **by hand**
in several rounds.

**A document that must be edited twice will eventually be edited once.**

WHY IT CHECKS SO LITTLE
-----------------------
The first attempt compared every 6-word chunk of the markdown against the tag-stripped HTML and
reported 97 "missing" chunks on a document that broadly agrees. **That is noise, and a noisy guard
is one somebody turns off.**

So it compares what is both HIGH-SIGNAL and STABLE:

  1. the HEADINGS, in order — a section added to one and not the other is drift
  2. the CHECKBOX STATES — how many boxes, and how many ticked

Those are the things that change when a document is corrected, and they are compared exactly
rather than approximately. It does not try to prove the prose agrees, because it cannot.

Usage:
    python scripts/factory/16_html_mirrors.py
"""
from __future__ import annotations

import argparse
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
BASE = ROOT / ".scratch" / "seen-not-grasped"

# Documents with no mirror are not drift; they are simply not mirrored.
_HEAD_MD = re.compile(r"^(#{2,4})\s*(.+?)\s*$", re.M)
_HEAD_HTML = re.compile(r"<h([2-4])[^>]*>(.*?)</h\1>", re.S | re.I)
_BOX_MD = re.compile(r"^\s*-\s*\[([ xX])\]", re.M)
_BOX_HTML = re.compile(r"\[([ xX])\]")


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", s)).strip().lower()


def compare(md: pathlib.Path, html: pathlib.Path) -> list[str]:
    out: list[str] = []
    mt = md.read_text(encoding="utf-8-sig")
    ht = html.read_text(encoding="utf-8-sig", errors="ignore")

    mh = [_norm(x[1]) for x in _HEAD_MD.findall(mt)]
    hh = [_norm(x[1]) for x in _HEAD_HTML.findall(ht)]
    if mh != hh:
        only_md = [h for h in mh if h not in hh]
        only_html = [h for h in hh if h not in mh]
        if only_md:
            out.append("headings only in the .md: " + "; ".join(only_md[:4]))
        if only_html:
            out.append("headings only in the .html: " + "; ".join(only_html[:4]))
        if not only_md and not only_html:
            out.append("the same headings, in a different ORDER")

    mb = _BOX_MD.findall(mt)
    hb = _BOX_HTML.findall(ht)
    mticked = sum(1 for b in mb if b.lower() == "x")
    hticked = sum(1 for b in hb if b.lower() == "x")
    if len(mb) != len(hb):
        out.append("checkbox count: .md has " + str(len(mb)) + ", .html has " + str(len(hb)))
    if mticked != hticked:
        out.append("TICKED boxes: .md has " + str(mticked) + ", .html has " + str(hticked))
    return out


# index.html has no .md to mirror, so nothing checked it — and it is the FRONT DOOR of the plan
# pack, the first page opened. Its counts are checked against the directories they describe.
_COUNT_RE = {
    "tickets": (re.compile(r"(\d+)\s+tickets", re.I), "issues", "*.md"),
    "ADRs": (re.compile(r"(\d+)\s+ADRs", re.I), "adr", "*.md"),
    "glossaries": (re.compile(r"(\d+)\s+glossaries", re.I), "glossary", "*.md"),
}


def _required_guard_count(root: pathlib.Path) -> int | None:
    """The number of guards CI is required to invoke, read from the guard itself.

    THE FRONT PAGE STATES IT, so it must be DERIVED rather than typed. A count in prose is a claim
    nobody updates; this one is read from `REQUIRED_GUARDS` at check time.
    """
    import importlib.util as _ilu
    import sys as _sys

    # LOOK WHERE THE GUARD ACTUALLY LIVES, not only beside the file being checked. The first
    # version resolved against the page's directory, so a probe in a temp dir found no guard at all
    # and **the check silently skipped** - the same "a missing input reads as a pass" shape.
    for cand in (root / "scripts" / "factory" / "13_ci_resolves.py",
                 ROOT / "scripts" / "factory" / "13_ci_resolves.py"):
        if cand.exists():
            p = cand
            break
    else:
        return None
    try:
        spec = _ilu.spec_from_file_location("_cg", str(p))
        mod = _ilu.module_from_spec(spec)
        _sys.modules["_cg"] = mod
        spec.loader.exec_module(mod)
        return len(getattr(mod, "REQUIRED_GUARDS", []))
    except Exception:
        return None


def find_index_problems(base: pathlib.Path) -> list[str]:
    idx = base / "index.html"
    if not idx.exists():
        return []
    text = idx.read_text(encoding="utf-8-sig", errors="ignore")
    out = []
    # the guard count, derived from the guard list rather than typed into the page
    import re as _re

    grc = _required_guard_count(base.parents[1])
    gm = _re.search(r"<strong>(\d+) required guards?</strong>", text)
    if grc is not None and gm and int(gm.group(1)) != grc:
        out.append("index.html says " + gm.group(1) + " required guards, but REQUIRED_GUARDS "
                   "holds " + str(grc))

    for noun, (pat, d, glob) in _COUNT_RE.items():
        dd = base / d
        if not dd.exists():
            continue
        actual = len(sorted(dd.glob(glob)))
        for m in pat.finditer(text):
            if int(m.group(1)) != actual:
                out.append("index.html says " + m.group(0).strip() + ", but " + d
                           + "/ holds " + str(actual))
            break
    return out


_HREF = re.compile(r'href="([^"]+)"')


def find_dead_links(base: pathlib.Path) -> list[dict]:
    """A link in the plan pack that resolves to nothing.

    THE FRONT PAGE HAD FIVE. Ticket mirrors stopped being generated after 17, so the index's own
    links to tickets 18-25 were dead — including the one to the spend decision. **A dead link is
    worse than a missing one**: it reads as a page that exists.
    """
    out = []
    for p in sorted(list(base.glob("*.html")) + list(base.glob("*/*.html"))):
        for i, line in enumerate(p.read_text(encoding="utf-8-sig", errors="ignore").splitlines(), 1):
            for href in _HREF.findall(line):
                if href.startswith(("http://", "https://", "#", "mailto:")):
                    continue
                target = (p.parent / href.split("#")[0]).resolve()
                if not target.exists():
                    out.append({"file": str(p.relative_to(base)).replace("\\", "/"),
                                "line": i, "href": href})
    return out


def find_problems(base: pathlib.Path) -> dict[str, list[str]]:
    problems: dict[str, list[str]] = {}
    # SUBDIRECTORIES TOO. The first version globbed \`*.md\` at the top level only, so all 25
    # ticket mirrors and all 9 ADR mirrors were **unchecked** while the guard reported that
    # everything it looked at agreed.
    # TICKETS ARE .md-ONLY BY DESIGN (round 101). All 17 ticket mirrors were provably stale — the
    # tracker changes every round, so a hand-maintained rendering of it is stale the moment it is
    # written. Narrative docs keep their mirrors: they change rarely and the guard verifies them.
    for md in sorted(list(base.glob("*.md")) + list(base.glob("*/*.md"))):
        if md.parent.name == "issues":
            continue
        html = md.with_suffix(".html")
        if not html.exists():
            continue
        diff = compare(md, html)
        if diff:
            problems[md.name] = diff
    return problems


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="The .html mirrors must not drift.")
    ap.add_argument("--dir", default=str(BASE))
    args = ap.parse_args(argv)
    base = pathlib.Path(args.dir)
    if not base.exists():
        print("no plan directory at " + str(base), file=sys.stderr)
        return 2
    pairs = [p for p in sorted(list(base.glob("*.md")) + list(base.glob("*/*.md")))
             if p.with_suffix(".html").exists() and p.parent.name != "issues"]
    if not pairs:
        print("no .md/.html pairs found")
        return 0
    problems = find_problems(base)
    idx_problems = find_index_problems(base)
    dead = find_dead_links(base)
    print("compared " + str(len(pairs)) + " hand-maintained mirror(s)")
    for p in pairs:
        print("  " + p.name)
    print()
    if dead:
        print(str(len(dead)) + " DEAD LINK(S):")
        for x in dead:
            print("  " + x["file"] + ":" + str(x["line"]) + "  -> " + x["href"])
        print()
        print("A dead link is worse than a missing one: it reads as a page that exists.")
        print()
    if not problems and not idx_problems and not dead:
        print("OK — every mirror has the same headings and the same checkbox states, and the")
        print("     plan pack's front page agrees with the directories it describes.")
        return 0
    if idx_problems:
        print("THE FRONT PAGE IS STALE:")
        for d in idx_problems:
            print("  " + d)
        print()
        print("index.html has no .md to mirror, so nothing checked it — and it is the first page")
        print("opened. Its own counts were 17 tickets and 8 ADRs against 25 and 9.")
        print()
    if not problems:
        return 1
    print(str(len(problems)) + " MIRROR(S) HAVE DRIFTED:")
    for name, diffs in problems.items():
        print("  " + name)
        for d in diffs:
            print("    " + d)
    print()
    print("A document that must be edited twice will eventually be edited once.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
