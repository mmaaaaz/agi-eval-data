#!/usr/bin/env python3
"""GUARD: the explainer site's taxonomy mirror matches the code's closed sets.

The site ships its own copy of the taxonomy as TypeScript so the build can read it.
Two copies of a taxonomy is two taxonomies — 02_generate_questions.py and 03_verify.py
already shipped divergent lists once (round 81). This guard fails CI whenever
apps/explainer/src/content/taxonomy.ts and scripts/harness/taxonomy.py / 04_tag_ground.py
disagree, in either direction.

Run:  python scripts/factory/17_explainer_taxonomy.py
Exit 0 = the two agree. Exit 1 = drift.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def python_sets() -> tuple[set[str], set[str], set[str], set[str], set[str]]:
    sys.path.insert(0, str(ROOT))
    from scripts.harness.taxonomy import (  # noqa: E402
        VALID_BIAS_AXES,
        VALID_CAPABILITIES,
        VALID_LEVELS,
        VALID_SENSITIVITY,
    )
    src = (ROOT / "scripts" / "factory" / "04_tag_ground.py").read_text(encoding="utf-8")
    domains = set(re.findall(r'"(D\d+)"\s*:', src))
    return (set(VALID_CAPABILITIES), set(VALID_LEVELS), domains,
            set(VALID_BIAS_AXES), set(VALID_SENSITIVITY))


def site_sets() -> tuple[set[str], set[str], set[str], set[str], set[str]]:
    src = (ROOT / "apps" / "explainer" / "src" / "content" / "taxonomy.ts").read_text(encoding="utf-8")
    caps = set(re.findall(r'id:\s*"((?:G|P|B)\d+|PERC)"', src))
    levels = set(re.findall(r'id:\s*"(L\d+)"', src))
    domains = set(re.findall(r'id:\s*"(D\d+)"', src))
    bias = set(re.findall(r'id:\s*"(F\d+)"', src))
    sens = set(re.findall(r'id:\s*"(S\d+)"', src))
    return caps, levels, domains, bias, sens


def compare(name: str, py: set[str], site: set[str]) -> list[str]:
    out = []
    missing = py - site
    extra = site - py
    if missing:
        out.append(name + " in the code but MISSING from taxonomy.ts: " + ", ".join(sorted(missing)))
    if extra:
        out.append(name + " in taxonomy.ts but NOT in the code: " + ", ".join(sorted(extra)))
    return out


def main() -> int:
    pc, pl, pd, pb, ps = python_sets()
    sc, sl, sd, sb, ss = site_sets()
    problems = (compare("capabilities", pc, sc) + compare("levels", pl, sl)
                + compare("domains", pd, sd) + compare("bias axes", pb, sb)
                + compare("sensitivity codes", ps, ss))
    if problems:
        print(str(len(problems)) + " TAXONOMY DRIFT PROBLEM(S):")
        for p in problems:
            print("  FAIL  " + p)
        print()
        print("The site and the pipeline must speak one taxonomy. Fix the side that is wrong.")
        return 1
    print("OK - taxonomy mirror agrees: " + str(len(pc)) + " capabilities, "
          + str(len(pl)) + " levels, " + str(len(pd)) + " domains, "
          + str(len(pb)) + " bias axes, " + str(len(ps)) + " sensitivity codes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
