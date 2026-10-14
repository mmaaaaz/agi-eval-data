#!/usr/bin/env python3
"""
THE PIPELINE'S ORDER, CHECKED RATHER THAN ASSUMED.

WHY THIS EXISTS
---------------
A stage whose `needs_files` do not exist is **SKIPPED, not failed**. So a wrong order, or a
mis-typed path, quietly makes the pipeline do less than it says it does — and the run still
reports success.

That is the same family as everything else this repository has produced: **a thing that does
nothing is indistinguishable from a thing that worked.**

WHAT IT CHECKS
--------------
  1. every `needs_files` is made by an EARLIER stage, or is a declared external input
  2. every `makes_files` path is under a directory the pipeline owns
  3. no two stages write the same file without an explicit reason

An external input is one the pipeline does NOT produce — the corpus ledger from dataset-tools,
for instance. They are listed explicitly, because "not produced by any stage" and "produced by a
stage that runs later" are the same thing to a file check and completely different in meaning.

Usage:
    python scripts/factory/14_pipeline_order.py
"""
from __future__ import annotations

import argparse
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
PIPELINE = ROOT / "scripts" / "factory" / "run_pipeline.py"

# Produced OUTSIDE the pipeline. Listed so a genuine ordering bug cannot hide behind them.
EXTERNAL_INPUTS = {
    "data/latest.json": "the corpus ledger, written by dataset-tools, not by a stage",
}


def parse_stages(text: str) -> list[dict]:
    """Every Stage(...) with its keyword lists.

    PARSED BY BRACKET BALANCE, not by regex. The first version used a non-greedy pattern and
    silently mis-read four stages — reporting `release` as needing nothing when it needs the
    export. A parser that is wrong about its input is worse than no parser, because the report
    looks like a result.
    """
    stages = []
    for m in re.finditer(r"Stage\(", text):
        i = m.end()
        depth = 1
        while i < len(text) and depth:
            if text[i] == "(":
                depth += 1
            elif text[i] == ")":
                depth -= 1
            i += 1
        body = text[m.end():i - 1]
        name = re.match(r'\s*"([^"]+)"', body)
        script = re.match(r'\s*"[^"]+",\s*"([^"]+)"', body)
        if not name or not script:
            continue
        makes = []
        needs = []
        envs = []
        em = re.search(r"needs_env=\[(.*?)\]", body, re.S)
        if em:
            envs.extend(re.findall(r'"([^"]+)"', em.group(1)))
        for key, sink in (("makes_files", makes), ("needs_files", needs)):
            km = re.search(key + r"=\[(.*?)\]", body, re.S)
            if km:
                sink.extend(re.findall(r'"([^"]+)"', km.group(1)))
        # `paid` IS PART OF THE DECLARATION AND WAS NOT PARSED. Without it the order guard could
        # not see which stages spend, so nothing could check that the marker agrees with the code.
        stages.append({"name": name.group(1), "script": script.group(1),
                       "makes": makes, "needs": needs,
                       "paid": "paid=True" in body, "needs_env": envs})
    return stages


def find_problems(stages: list[dict]) -> list[str]:
    problems: list[str] = []
    if not stages:
        return ["no stages parsed — the pipeline file changed shape"]
    produced: dict[str, str] = {}
    writers: dict[str, list[str]] = {}
    for st in stages:
        for need in st["needs"]:
            if need not in produced and need not in EXTERNAL_INPUTS:
                problems.append(st["name"] + " needs " + need
                                + ", which NO EARLIER stage makes and which is not a declared "
                                  "external input")
        for mk in st["makes"]:
            if mk in writers and st["name"] not in writers[mk]:
                problems.append(st["name"] + " and " + writers[mk][0]
                                + " both write " + mk)
            writers.setdefault(mk, []).append(st["name"])
            produced[mk] = st["name"]
    for st in stages:
        for mk in st["makes"]:
            if not mk.startswith("data/"):
                problems.append(st["name"] + " writes outside data/: " + mk)
    return problems


# ---------------------------------------------------------------------------
# THE PAID MARKER, AGAINST WHAT THE STAGE CAN REACH
# ---------------------------------------------------------------------------

MODEL_CALLS = ("refuse_without_spend", "backend.ask", "from_env(")
_IMPORT = __import__("re").compile(
    r"from \.([a-z_]+) import|from scripts\.harness\.([a-z_]+) import|import \{?\s*([a-z_]+)")


def reaches_a_model(path, seen=None, base=None) -> bool:
    """Does this stage, or what it imports from the harness, reach a model call?

    A SHIM IS NOT AN EXEMPTION. `run_open.py` and `run_closed.py` are thin wrappers over
    `sweep.main(kind)` - the spending is one level down. A check that reads only the declared path
    reports them as free and the PAID marker as wrong, which is what the first version did.

    Each runner ALSO calls `refuse_without_spend` itself, so a mis-marked stage is still refused -
    **defence in depth, not a reason for the marker to be wrong.** The marker decides whether the
    pipeline demands `--spend` up front, and a stage that spends without it would run the whole
    ladder before anything asked.
    """
    import pathlib as _pl

    seen = seen if seen is not None else set()
    p = _pl.Path(path)
    # RELATIVE TO \`base\`, NOT TO THE WORKING DIRECTORY. A stage's path is written relative to the
    # repository root, so resolving it against the CWD works only when the CWD happens to be the
    # root - and a probe in a temp directory then looks for the file in the real tree.
    if base is not None and not p.is_absolute():
        p = _pl.Path(base) / p
    if str(p) in seen or not p.exists():
        return False
    seen.add(str(p))
    src = p.read_text(encoding="utf-8-sig")
    if any(m in src for m in MODEL_CALLS):
        return True
    for m in _IMPORT.finditer(src):
        name = m.group(1) or m.group(2) or m.group(3)
        if not name:
            continue
        cand = p.parent / (name + ".py")
        if cand.exists() and reaches_a_model(cand, seen, base):
            return True
        cand2 = (_pl.Path(base) if base is not None else _pl.Path(".")) / "scripts" / "harness" \
            / (name + ".py")
        if cand2.exists() and reaches_a_model(cand2, seen, base):
            return True
    return False


def find_paid_type_errors(root=None) -> list[dict]:
    """A Stage whose `paid` is not a bool.

    THE STAGE HAD TWO ADJACENT DESCRIPTION STRINGS SEPARATED BY A COMMA, so the second was a
    SEPARATE POSITIONAL ARGUMENT and landed in `paid` as a STRING. It was TRUTHY, so the stage
    behaved as paid and everything looked right — **until the marker was read as a value rather than
    as a truthiness test**, and then it disagreed with itself.

    `parse_stages` reads the source text, so it saw no `paid=True` and reported the stage as free,
    while `run_pipeline` saw a truthy string and treated it as paid. **Two readers of one
    declaration disagreeing is the definition of an ambiguous declaration.**
    """
    import importlib.util as _ilu
    import pathlib as _pl
    import sys as _sys

    if root is None:
        root = _pl.Path(__file__).resolve().parents[2]
    rp = _pl.Path(root) / "scripts" / "factory" / "run_pipeline.py"
    if not rp.exists():
        return []
    out = []
    try:
        spec = _ilu.spec_from_file_location("_rp_check", str(rp))
        mod = _ilu.module_from_spec(spec)
        _sys.modules["_rp_check"] = mod
        spec.loader.exec_module(mod)
    except Exception as e:
        return [{"key": "(the module did not import)", "why": type(e).__name__ + ": " + str(e)}]
    for st in getattr(mod, "STAGES", []):
        if not isinstance(st.paid, bool):
            out.append({"key": st.key, "why": "paid is " + type(st.paid).__name__
                        + ", not a bool — a description string probably landed in it"})
    return out


# `from_env` DEMANDS EXACTLY ONE THING, and it is derivable from its source:
#   kind="closed" -> OPENROUTER_API_KEY, and it RAISES without it
#   kind="open"   -> VLLM_BASE_URL, which has a default, so nothing is required
_CLOSED_SELECTORS = (
    re.compile(r'from_env\(\s*"closed"'),
    re.compile(r'default\s*=\s*"closed"'),
)


def find_missing_backend_env(stages, base=None) -> list[dict]:
    """A stage that can select the closed backend without declaring OPENROUTER_API_KEY.

    `from_env("closed", ...)` raises SystemExit when the key is absent. The pipeline checks
    `needs_env` BEFORE a paid stage runs, so a stage that can go closed and does not declare the
    key **starts the ladder and dies on the first call** instead of being refused up front.

    THIS IS NARROW ON PURPOSE. A first attempt compared every `environ` read against every
    declaration and produced **11 mismatches** - because it followed imports into modules whose
    functions are never called on that path, and counted `USER`, which has a fallback. **A check
    that reports eleven problems in a correct file is one somebody turns off.** Only the one
    requirement `from_env` actually enforces is checked.
    """
    import pathlib as _pl

    out = []
    root = _pl.Path(base) if base is not None else _pl.Path(".")
    for st in stages:
        script = st.get("script") or st.get("path") or ""
        src_path = root / script
        if not src_path.exists():
            continue
        src = src_path.read_text(encoding="utf-8-sig")
        if not any(p.search(src) for p in _CLOSED_SELECTORS):
            continue
        declared = st.get("needs_env") or []
        if "OPENROUTER_API_KEY" not in declared:
            out.append({"key": st.get("name"), "script": script})
    return out


def find_paid_mismatches(stages, base=None) -> list[dict]:
    out = []
    # parse_stages RETURNS DICTS, NOT OBJECTS. The first version used attribute access and
    # crashed with "got 'WindowsPath'" - a TypeError from the regex, three frames from the
    # actual mistake.
    for st in stages:
        hits = reaches_a_model(st.get("script") or st.get("path") or "", base=base)
        if st.get("paid") and not hits:
            out.append({"key": st.get("key") or st.get("name"),
                        "why": "marked PAID but reaches no model call"})
        elif (not st.get("paid")) and hits:
            out.append({"key": st.get("key") or st.get("name"),
                        "why": "NOT marked paid but reaches a model call"})
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Check the pipeline's stage order.")
    ap.add_argument("--file", default=str(PIPELINE))
    args = ap.parse_args(argv)
    p = pathlib.Path(args.file)
    if not p.exists():
        print("no pipeline at " + str(p), file=sys.stderr)
        return 2
    stages = parse_stages(p.read_text(encoding="utf-8-sig"))
    problems = find_problems(stages)
    print("parsed " + str(len(stages)) + " stage(s) from " + p.name)
    print()
    print("%-14s %-34s %s" % ("stage", "makes", "needs"))
    print("-" * 80)
    for st in stages:
        print("%-14s %-34s %s" % (st["name"], ",".join(st["makes"])[:33], ",".join(st["needs"])[:40]))
    print()
    paid_bad = (find_paid_mismatches(stages) + find_paid_type_errors()
                + find_missing_backend_env(stages))
    if paid_bad:
        print(str(len(paid_bad)) + " STAGE(S) WHOSE PAID MARKER DISAGREES WITH THE CODE:")
        for x in paid_bad:
            print("  " + str(x["key"]) + " — " + x["why"])
        print()
        print("The marker decides whether the pipeline demands --spend up front. Each runner")
        print("refuses on its own as well, so a mis-marked stage is still stopped — **defence in")
        print("depth, not a reason for the marker to be wrong.** `elicit` was added in round 104")
        print("as a PAID stage and shipped WITHOUT paid=True: 200,000 calls, marked free.")
        print()
        return 1
    if not problems:
        print("OK — every need has an earlier producer or is a declared external input.")
        return 0
    print(str(len(problems)) + " PROBLEM(S):")
    for x in problems:
        print("  " + x)
    print()
    print("A stage whose needs are absent is SKIPPED, not failed — so this would run and")
    print("report success while doing less than it says.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
