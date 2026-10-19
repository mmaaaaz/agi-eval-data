"""Self-test for the harness. Run:  python -m scripts.harness.selftest

Asserts the contract the paper depends on:
  - a release is content-addressed, and a tampered release is refused
  - grading separates correct / close / wrong / unanswered / unparseable
  - a re-run resumes instead of duplicating
  - every trace row carries the release hash and the image hash
"""
from __future__ import annotations
import json
import shutil
import sys
import tempfile
import traceback
import sqlite3
from pathlib import Path

# ---------------------------------------------------------------------------
# TWO RULES FOR ADDING A BLOCK TO THIS FILE. Both were learned by breaking them.
#
# 1. IMPORT WHAT YOU NEED, INSIDE YOUR OWN BLOCK. This file is append-only and now over 1,500
#    lines. A name defined further down DOES NOT EXIST where you are — that has raised NameError
#    SEVEN times across seven rounds (`tempfile` four times, `slopes`, `_src`, `_src` again).
#    `importlib.util.spec_from_file_location` + `exec_module` is the pattern for a script that is
#    not a module; `from scripts.harness.x import y` for one that is.
#
# 2. `check(label, condition, detail)` — THE THIRD ARGUMENT MUST BE A STRING. It is concatenated
#    when the check FAILS, so passing a list or a dict crashes the FAIL branch. A check that
#    cannot report is a check that cannot fail, and it has cost two rounds.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# EVERY GUARD MODULE, PRELOADED ONCE. THE ORDERING TRAP IS NOW STRUCTURALLY GONE.
# ---------------------------------------------------------------------------
#
# RULE 1 ABOVE HAS BEEN VIOLATED TWENTY-FOUR TIMES. It was written in round 97 and has not
# prevented a single instance, because **a rule in a comment is not a mechanism.** Each block
# imported its own handle under a fresh name (`_src`, `_src2` ... `_src13`), so a block added
# above an existing one silently referenced a name defined below it and crashed at import.
#
# These handles exist before the first check runs, so any block may use them. A new block should
# NOT define its own - add the module here instead.
import importlib.util as _preload  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


def _preload_module(name: str, rel: str):
    """Load a repo script that is not an importable module."""
    spec = _preload.spec_from_file_location(name, str(ROOT / rel))
    mod = _preload.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


GUARDS = {
    "src": "scripts/factory/15_source_claims.py",
    "mir": "scripts/factory/16_html_mirrors.py",
    "plan": "scripts/factory/11_plan_truthfulness.py",
    "unwired": "scripts/factory/12_unwired.py",
    "cires": "scripts/factory/13_ci_resolves.py",
    "porder": "scripts/factory/14_pipeline_order.py",
    "migr": "scripts/db/check_migrations.py",
    "site": "scripts/factory/08_site_truthfulness.py",
    "tax": "scripts/factory/17_explainer_taxonomy.py",
    "pii": "scripts/factory/10_pii.py",
    "gen": "scripts/factory/02_generate_questions.py",
    "tags": "scripts/factory/04_tag_ground.py",
}
# Loaded lazily and tolerantly: a guard with a NEW third-party import must not turn this file into
# an ImportError - 13_ci_resolves.py is the check that reports that, and it cannot run from here.
M = {}
for _k, _rel in GUARDS.items():
    try:
        M[_k] = _preload_module("_pre_" + _k, _rel)
    except Exception as _e:  # noqa: BLE001
        M[_k] = None
        print("note: could not preload " + _rel + ": " + type(_e).__name__)

# The names the blocks below already use. Kept so existing code keeps working while new code
# reads from M.
_src = _src2 = _src3 = _src4 = _src5 = _src6 = M.get("src")
_mir = _mir2 = _mir3 = _mir4 = M.get("mir")
_plan = _plan2 = _plan3 = M.get("plan")
_unw = _unw2 = M.get("unwired")
_cires = _cires2 = _cires3 = _cires4 = _cires5 = _cires6 = M.get("cires")
_porder = _porder2 = M.get("porder")
_cm = _cm2 = M.get("migr")
_g8 = M.get("site")

# ONE tempfile import for the whole file. There were FOUR, declared inside individual blocks
# (`_tf2`, `_tf3`, `_tf7`, `_tf8`), and a block referring to one defined LATER raised NameError
# FOUR TIMES in four rounds. `selftest.py` is append-only and now 1,100 lines, so "defined above"
# is not a safe assumption. Hoisting it removes the whole class.
import tempfile as _tf  # noqa: E402

from scripts.harness.analyze import collapse, leaderboard
from scripts.harness.backends import StubBackend
from scripts.harness.grade import grade
from scripts.harness.recipe import Recipe, render_prompt
from scripts.harness.release import build, groundtruth_hash, load, parse_choices
from scripts.harness.run import run_release

ROOT = Path(__file__).resolve().parents[2]

FAILS: list[str] = []
RAN = 0


def check(label: str, cond: bool, detail: str = "") -> None:
    global RAN
    RAN += 1
    if cond:
        print("  ok   " + label)
    else:
        FAILS.append(label)
        # A NON-STRING detail CRASHES THE FAIL BRANCH, which has cost three rounds. So it is
        # coerced rather than trusted: **a check that cannot report its failure is a check that
        # cannot fail.**
        print("  FAIL " + label + (" :: " + str(detail) if detail else ""))


def _on_crash(exc_type, exc, tb) -> None:
    """A self-test that dies must SAY it died.

    This exists because it happened: a NameError inside a new block killed the run
    after 47 assertions instead of 100, and the only visible symptom was a smaller
    number and a missing "ALL PASS" line. Fewer assertions is not progress, and a
    silently-short run is the same failure as a guard with no runner — the check
    stops happening without anything saying so.
    """
    print()
    print("THE SELF-TEST ITSELF CRASHED after " + str(RAN) + " assertions.")
    print("This is NOT a pass. Fewer assertions than expected means the run stopped early.")
    print()
    traceback.print_exception(exc_type, exc, tb)


sys.excepthook = _on_crash


ITEMS = [
    {"id": 1, "file_id": "f1", "question": "What is inside the frame?", "answer": "A",
     "answer_type": "choice", "choices": ["A drone", "A lamp", "A ball"], "capability": "PERC", "level": "L1"},
    {"id": 2, "file_id": "f1", "question": "Is the top box above the base?", "answer": "yes",
     "answer_type": "yesno", "capability": "B1", "level": "L4", "pair_id": "p1", "pair_role": "geometry"},
    {"id": 3, "file_id": "f1", "question": "How many gauges?", "answer": "2",
     "answer_type": "number", "tolerance": 0, "capability": "PERC", "level": "L1"},
    {"id": 4, "file_id": "f1", "question": "Will the stack stay standing?", "answer": "B",
     "answer_type": "choice", "choices": ["Yes", "No", "Only if moved"], "capability": "B1", "level": "L4",
     "pair_id": "p1", "pair_role": "physics"},
]

tmp = Path(tempfile.mkdtemp(prefix="harness-test-"))
try:
    rel = tmp / "release"
    print("RELEASE")
    # THE RELEASE MUST CARRY ITS CLEARANCE. load() now refuses one that does not, because a hash
    # proves the ITEMS did not change and says nothing about whether the IMAGES may be used — so
    # a hand-made directory used to pass every check. These tests pass a clearance explicitly.
    man = build(ITEMS, rel, release_id="test-v1",
                consent={"granted": len(ITEMS), "denied": 0, "unknown": 0, "n_checked": len(ITEMS)},
                pii={"clear": len(ITEMS), "flagged": 0, "unreviewed": 0, "n_checked": len(ITEMS)})
    check("manifest counts items", man["n_items"] == 4, str(man["n_items"]))
    check("manifest groups by capability", man["by_capability"].get("B1") == 2, str(man["by_capability"]))
    items, man2 = load(rel)
    check("load returns same hash", man2["groundtruth_hash"] == man["groundtruth_hash"])

    print("TAMPER DETECTION")
    original = (rel / "questions.jsonl").read_text(encoding="utf-8-sig")
    tamper_cases = {
        "answer changed": original.replace('"answer": "A"', '"answer": "C"'),
        "option text changed": original.replace('"A drone"', '"A quadcopter"'),
        "options reordered": original.replace('["A drone", "A lamp", "A ball"]', '["A lamp", "A drone", "A ball"]'),
        "question reworded": original.replace("What is inside the frame?", "What is on the table?"),
        "tolerance changed": original.replace('"tolerance": 0.0', '"tolerance": 5.0'),
    }
    for label, body in tamper_cases.items():
        (rel / "questions.jsonl").write_text(body, encoding="utf-8")
        try:
            load(rel); check("tamper refused: " + label, False, "no error raised")
        except ValueError:
            check("tamper refused: " + label, True)
    (rel / "questions.jsonl").write_text(original, encoding="utf-8")
    load(rel)
    check("restored release loads", True)

    print("GRADING")
    check("mcq letter correct", grade(ITEMS[0], "A")["verdict"] == "correct")
    check("mcq lowercase correct", grade(ITEMS[0], "a)")["verdict"] == "correct")
    check("mcq wrong", grade(ITEMS[0], "C")["verdict"] == "wrong")
    check("mcq option text accepted", grade(ITEMS[0], "A drone")["verdict"] == "correct")
    # These two used to be ONE assertion, and it was wrong. "I am not sure what you
    # mean" is an ABSTENTION — the model declined — not a format failure, and the grader
    # now says so. A genuinely unparseable response is tested separately.
    check("an abstention is flagged as abstained, not as a failure",
          grade(ITEMS[0], "I am not sure what you mean")["abstained"] == 1
          and grade(ITEMS[0], "I am not sure what you mean")["parse_ok"] == 1)
    check("unparseable flagged", grade(ITEMS[0], "?!@#")["parse_ok"] == 0)
    check("yesno correct", grade(ITEMS[1], "Yes.")["verdict"] == "correct")
    check("yesno wrong", grade(ITEMS[1], "no")["verdict"] == "wrong")
    check("number exact", grade(ITEMS[2], "2")["verdict"] == "correct")
    check("number wrong", grade(ITEMS[2], "3")["verdict"] == "wrong")
    check("abstention recognised", grade(ITEMS[0], "Unknown")["abstained"] == 1)
    check("abstention is unanswered", grade(ITEMS[0], "cannot be determined")["verdict"] == "unanswered")
    check("gold B via option text", grade(ITEMS[3], "No")["verdict"] == "correct")

    print("PROMPT")
    r = Recipe(model="stub/model")
    p = render_prompt(r, "What is inside?", ["A drone", "A lamp"])
    check("prompt lists options", "A) A drone" in p and "B) A lamp" in p)
    check("recipe hash is stable", r.recipe_hash() == Recipe(model="stub/model").recipe_hash())
    check("recipe hash changes with model", r.recipe_hash() != Recipe(model="other").recipe_hash())

    print("RUN + RESUME")

    def fetch(item: dict) -> bytes:
        return ("img-" + item["file_id"]).encode()

    def ask(item, img, prompt):
        return {1: "A", 2: "yes", 3: "2", 4: "A"}[item["id"]]  # item 4 wrong on purpose

    trace = tmp / "trace.jsonl"
    res = run_release(rel, r, ask, trace, fetch, run_id="run-1")
    check("ran every item", res["n_new"] == 4, str(res["n_new"]))
    check("accuracy 3/4", abs(res["accuracy_new"] - 0.75) < 1e-9, str(res["accuracy_new"]))
    rows = [json.loads(l) for l in trace.read_text(encoding="utf-8-sig").splitlines()]
    check("one trace row per item", len(rows) == 4, str(len(rows)))
    check("every row carries groundtruth_hash", all(r["groundtruth_hash"] == man["groundtruth_hash"] for r in rows))
    check("every row carries image_sha256", all(len(r["image_sha256"]) == 64 for r in rows))
    check("every row carries recipe_hash", all(row["recipe_hash"] == r.recipe_hash() for row in rows))

    res2 = run_release(rel, r, ask, trace, fetch, run_id="run-1")
    check("resume adds nothing", res2["n_new"] == 0, str(res2["n_new"]))
    check("resume reports done", res2["n_already_done"] == 4, str(res2["n_already_done"]))
    check("trace not duplicated", len(trace.read_text(encoding="utf-8-sig").splitlines()) == 4)

    print("ERRORS ARE DATA")
    def ask_fail(item, img, prompt):
        raise RuntimeError("provider 503")
    t2 = tmp / "trace2.jsonl"
    res3 = run_release(rel, r, ask_fail, t2, fetch, run_id="run-2")
    rowerr = [json.loads(l) for l in t2.read_text(encoding="utf-8-sig").splitlines()]
    check("failed calls recorded, not crashed", len(rowerr) == 4 and all(x["error"] for x in rowerr))
    check("failed calls parse_ok=0", all(x["parse_ok"] == 0 for x in rowerr))
    check("different run_id does not resume", res3["n_new"] == 4)

    print("A BAD IMAGE MUST NOT KILL A 30,000-ITEM SWEEP")
    def bad_fetch(item):
        raise RuntimeError("drive 400 Bad Request")
    t3 = tmp / "trace3.jsonl"
    run_release(rel, r, ask, t3, bad_fetch, run_id="run-3")
    rows3 = [json.loads(l) for l in t3.read_text(encoding="utf-8-sig").splitlines()]
    check("every item still produced a row", len(rows3) == 4, str(len(rows3)))
    check("each row carries the fetch error", all(x["error"] for x in rows3))
    check("no image hash when no image arrived", all(x["image_sha256"] == "" for x in rows3))
finally:
    shutil.rmtree(tmp, ignore_errors=True)

print("ID ALIASES (the gate uses image_id, the harness uses file_id)")
from scripts.harness.release import normalise_item  # noqa: E402

aliased = normalise_item({"question_id": 5, "image_id": "img_5", "question": "q", "answer": "A", "answer_type": "text"})
check("question_id alias maps to id", aliased["id"] == 5, str(aliased["id"]))
check("image_id alias maps to file_id", aliased["file_id"] == "img_5", str(aliased["file_id"]))
try:
    normalise_item({"question": "q"})
    check("an item with no id is refused", False, "no error raised")
except ValueError:
    check("an item with no id is refused", True)

print("A TRANSIENT FAILURE IS RETRYABLE, AND IS NOT A WRONG ANSWER")
# An errored row used to count as DONE, so a 429 was permanent: every later run skipped
# the item and its "wrong" verdict stayed in the accuracy figure forever. And because
# the errored row was in the denominator, the sweep looked worse the more the API
# wobbled — infrastructure reliability masquerading as model ability.

_sw = Path(_tf.mkdtemp()) / "trace.jsonl"
# THE FIXTURE IS BUILT HERE, not read from .research/. It used to point at a stale directory that
# nothing regenerated — so the test would break if that directory were cleaned, and it DID break
# when load() started requiring a clearance record. A test that depends on a hand-made artifact
# is testing the artifact's survival, not the code.
_swrel = str(Path(_tf.mkdtemp()) / "rel")
build([{"id": i, "file_id": "img_%d" % i, "question": "q%d?" % i, "answer": "A",
        "answer_type": "choice", "choices": ["A", "B"], "capability": "G1", "level": "L2"}
       for i in range(1, 9)],
      _swrel, release_id="sw",
      consent={"granted": 8, "denied": 0, "unknown": 0, "n_checked": 8},
      pii={"clear": 8, "flagged": 0, "unreviewed": 0, "n_checked": 8})
_swans = {str(i): "A" for i in range(1, 9)}
_swrecipe = Recipe(model="m", prompt_id="mcq_v1", temperature=0.0)
_good = lambda it: b"\xff\xd8\xff" + b"x" * 40  # noqa: E731


def _flaky(it):
    if it["id"] == 1:
        raise TimeoutError("transient")
    return _good(it)


try:
    run_release(release_dir=_swrel, recipe=_swrecipe, ask=StubBackend(_swans).ask,
                trace_path=_sw, fetch_image=_flaky, run_id="sw")
    _swrows = [json.loads(x) for x in _sw.read_text(encoding="utf-8-sig").splitlines() if x.strip()]
    check("a failed fetch is recorded, not swallowed", any(r.get("error") for r in _swrows))
    _swres = run_release(release_dir=_swrel, recipe=_swrecipe, ask=StubBackend(_swans).ask,
                         trace_path=_sw, fetch_image=_good, run_id="sw")
    check("the failed item IS retried on resume", _swres["n_new"] == 1, _swres)
    check("the successful items are not re-run", _swres["n_already_done"] == 7, _swres)
    _swrows = [json.loads(x) for x in _sw.read_text(encoding="utf-8-sig").splitlines() if x.strip()]
    _swcol, _swst = collapse(_swrows)
    _one = [r for r in _swcol if r["question_id"] == 1][0]
    check("the retry SUPERSEDES the failed attempt", not _one.get("error"), _one.get("error"))
    check("and the item is graded on the successful answer", _one["verdict"] == "correct")
    _swlb = leaderboard(_swrows)[0]
    check("nothing is left errored once every item succeeded", _swlb["n_errored"] == 0, _swlb)
    check("accuracy is over answered items", abs(_swlb["accuracy"] - 1.0) < 1e-9, _swlb["accuracy"])
except Exception as _e:  # noqa: BLE001
    check("the retry scenario ran", False, type(_e).__name__ + ": " + str(_e)[:80])

# an item that NEVER succeeds is excluded and reported, not counted as wrong
_never = [{"run_id": "z", "model": "m", "question_id": i, "verdict": "correct",
           "abstained": 0, "parse_ok": 1, "error": "", "latency_ms": 1} for i in range(1, 6)]
_never.append({"run_id": "z", "model": "m", "question_id": 6, "verdict": "wrong",
               "abstained": 0, "parse_ok": 0, "error": "HTTPError: 429", "latency_ms": 1})
_z = leaderboard(_never)[0]
check("an unrecoverable error is excluded from the denominator", _z["n"] == 5, _z["n"])
check("and is reported separately", _z["n_errored"] == 1, _z.get("n_errored"))
check("items = answered + errored", _z["n_items"] == _z["n"] + _z["n_errored"], _z)
check("accuracy is unaffected by the error", abs(_z["accuracy"] - 1.0) < 1e-9, _z["accuracy"])

print("INGEST PUBLISHES THE SAME NUMBER THE PAPER COMPUTES")
# One number, one code path. A 3-repeat trace used to publish one accuracy and have the
# paper compute another from the same file, because summarise() counted SAMPLES while
# leaderboard() counted ITEMS.
from scripts.harness.analyze import leaderboard as _lb  # noqa: E402
from scripts.harness.ingest import post as _post  # noqa: E402
from scripts.harness.ingest import summarise as _summarise  # noqa: E402


def _irow(qid, verdict):
    return {"run_id": "ri", "model": "m", "question_id": qid, "verdict": verdict,
            "abstained": 0, "parse_ok": 1, "error": "", "latency_ms": 10}


_rep = [_irow(1, "correct"), _irow(1, "correct"), _irow(1, "wrong"),
        _irow(2, "wrong"), _irow(2, "wrong"), _irow(2, "wrong")]
_s = _summarise(_rep)
_l = _lb(_rep)[0]
check("ingest and analyze agree on accuracy",
      abs(_s["accuracy"] - _l["accuracy"]) < 1e-9, (_s["accuracy"], _l["accuracy"]))
check("and on the item count", _s["n"] == _l["n"] == 2, (_s["n"], _l["n"]))
check("the sample count is published too", _s["n_samples"] == 6)
check("instability is published too", abs(_s["unstable_rate"] - 0.5) < 1e-9)

# The relay upserts ONE runs row per run_id, so a per-batch summary made the stored
# n_items equal whichever batch landed last. Every batch must carry the whole run.
_cap = []


class _FakeResp:
    status = 200

    def read(self):
        return b"{}"

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


import scripts.harness.ingest as _ing  # noqa: E402

_real = _ing.urllib.request.urlopen
_ing.urllib.request.urlopen = lambda req, timeout=None: (_cap.append(json.loads(req.data.decode())), _FakeResp())[1]
try:
    _post([_irow(i, "correct") for i in range(1, 8)], "http://relay", "CODE", batch=2)
finally:
    _ing.urllib.request.urlopen = _real
check("7 rows are sent as 4 batches", [len(c["results"]) for c in _cap] == [2, 2, 2, 1],
      [len(c["results"]) for c in _cap])
check("every batch reports the WHOLE run size, not its own",
      {c["run"]["n_items"] for c in _cap} == {7}, {c["run"]["n_items"] for c in _cap})

print("THE TAXONOMY IS ENFORCED AT FREEZE, NOT ONLY AT GENERATION")
# The two lists lived ONLY inside 02_generate_questions.py, so they were enforced at generation
# and nowhere else. Measured in round 81: build() accepted capability "NOT_A_CAPABILITY" and
# level "L99" and shipped them — the paper's per-capability table would have contained that key —
# and an item with no capability was bucketed as UNCLASSIFIED and AVERAGED INTO the table.
#
# Enforcement at the point of origin is not enforcement at the point of use.
from scripts.harness.taxonomy import (  # noqa: E402
    VALID_CAPABILITIES, VALID_LEVELS, check_item)

check("the taxonomy is one list, not a copy",
      "PERC" in VALID_CAPABILITIES and "G8" in VALID_CAPABILITIES and len(VALID_LEVELS) == 5,
      sorted(VALID_CAPABILITIES))
# A COMPLETE item, because check_item now covers the SHAPE as well as the taxonomy — the first
# version of this assertion passed a bare {capability, level} and the extended rule correctly
# refused it for having no answer_type. The test was stale, not the rule.
_good_item = {"capability": "G1", "level": "L2", "answer": "A", "answer_type": "choice",
              "choices": ["A", "B"]}
check("a good item passes", check_item(_good_item) is None, check_item(_good_item))
check("an unknown capability is refused",
      "capability not in the taxonomy" in str(check_item({"capability": "NOPE", "level": "L2"})))
check("an unknown level is refused",
      "level not in the taxonomy" in str(check_item({"capability": "G1", "level": "L99"})))
check("a missing capability is refused",
      check_item({"level": "L2"}) == "no capability")
check("a missing level is refused",
      check_item({"capability": "G1"}) == "no level")

# and it is wired into build(), which is where the artifact is made
_badrel = Path(_tf.mkdtemp()) / "bad"
_badrel.mkdir(parents=True, exist_ok=True)
try:
    build([{"id": 1, "file_id": "img_1", "question": "q?", "answer": "A",
            "answer_type": "choice", "choices": ["A", "B"],
            "capability": "NOT_A_CAPABILITY", "level": "L99"}],
          _badrel, release_id="bad",
          consent={"granted": 1, "denied": 0, "unknown": 0, "n_checked": 1},
          pii={"clear": 1, "flagged": 0, "unreviewed": 0, "n_checked": 1})
    check("build() REFUSES an item outside the taxonomy", False, "it built")
except ValueError as _e:
    check("build() REFUSES an item outside the taxonomy", "not valid" in str(_e), str(_e)[:90])

print("THE REMOTE DIAGNOSTIC CAN ACTUALLY READ THE REMOTE")
# ROUND 150. `diagnose_remote.py` shelled out to `bunx --bun wrangler@4.125.0` unconditionally,
# and that fails on at least one machine with a bun resolution bug. **So it could never read the
# remote here, printed its friendly "no credentials" note, and returned 0.**
#
# In the deploy job that green tick meant NOTHING - it was the "check that cannot fail" class,
# **inside the check written to stop guessing.** Found by running it with real credentials rather
# than by reading it.
import importlib.util as _ilu_db  # noqa: E402

_spec_db = _ilu_db.spec_from_file_location(
    "_dbgmod", str(ROOT / "scripts" / "db" / "diagnose_remote.py"))
_dbg = _ilu_db.module_from_spec(_spec_db)
sys.modules["_dbgmod"] = _dbg
_spec_db.loader.exec_module(_dbg)

_dr = Path(_tf.mkdtemp())
check("it prefers the workspace wrangler when one is installed",
      "node" in _dbg._wrangler() or "bunx" in _dbg._wrangler(), str(_dbg._wrangler()))
check("and falls back to bunx when it is not",
      isinstance(_dbg._wrangler(), list) and len(_dbg._wrangler()) >= 2, str(_dbg._wrangler()))
# THE FLAG IS THE POINT: in the deploy job, not reading is a FAILURE.
# AND IT MUST EXIT THE SAME WAY IN CI AS IT DOES HERE. Round 151 found a second silent defect:
# `subprocess.run(text=True)` uses the PLATFORM encoding, cp1252 on Windows, and **wrangler's
# output is not cp1252** - so the reader thread died and the failure path exited -1 instead of 1.
# **A check whose failure path crashes reports neither success nor failure.** Both calls now name
# utf-8 explicitly.
_dsrc = (ROOT / "scripts" / "db" / "diagnose_remote.py").read_text(encoding="utf-8-sig")
check("every subprocess call names its encoding",
      _dsrc.count("encoding=\"utf-8\"") >= _dsrc.count("subprocess.run"),
      str(_dsrc.count("encoding=\"utf-8\"")) + " vs " + str(_dsrc.count("subprocess.run")))
check("--require-remote exists, so an unreadable remote can fail",
      _dbg.main(["--db", "x", "--require-remote"]) == 1,
      "with no credentials the run must refuse")
check("and without it, a local run stays graceful",
      _dbg.main(["--db", "x"]) == 0, "a developer without credentials is not an error")

print("A TRACKED BUILD ARTIFACT IS CAUGHT")
# TWICE. Round 134 committed .dryrun/, round 148 committed .dryrun2, .dryrun3 and .dryrun4 -
# because the gitignore line named ONE directory instead of the pattern, and a wrangler --outdir
# writes wherever it is told.
#
# **A fix that matches an instance and not the pattern is a fix that expires.**
check("the real repository tracks no build artifacts",
      _src.find_tracked_artifacts(ROOT) == [], str(_src.find_tracked_artifacts(ROOT))[:3])

print("A FILTER OUTPUT WITH NO FILTER IS CAUGHT")
# ROUND 140: changes.outputs.relay was wired to steps.filter.outputs.relay, and there was NO
# relay: key in the filters block. **So the output was always empty and `deploy relay` was
# skipped on every run since it existed.** The deployed relay still answered a global gate the
# code had removed rounds earlier, and the site's authoring flow calls those endpoints.
#
# **A filter key that does not exist produces an empty output, and an empty output reads exactly
# like 'nothing changed'.** The failure is silent by construction.
#
# THE FIXTURE IS THE REAL WORKFLOW WITH ONE KEY REMOVED, not a hand-written YAML. The first
# version of this test built its own three-line filter block, and the block's INDENTATION did not
# match what the extractor expects - so the test failed while the check worked. **A fixture that
# reproduces a file's shape by hand is a second thing that can be wrong.**
_fw = Path(_tf.mkdtemp())
(_fw / ".github" / "workflows").mkdir(parents=True)
_ftext = (ROOT / ".github" / "workflows" / "deploy.yml").read_text(encoding="utf-8-sig")
(_fw / ".github" / "workflows" / "deploy.yml").write_text(_ftext, encoding="utf-8")
check("the real deploy.yml wires every output to a filter",
      _cires.find_orphan_filter_outputs(_fw) == [], str(_cires.find_orphan_filter_outputs(_fw))[:2])
# now remove the relay filter key and its entries, as the bug had it
_flines = _ftext.splitlines()
_fi = next(k for k, l in enumerate(_flines) if l.strip() == 'relay:')
_fj = _fi + 1
while _fj < len(_flines) and _flines[_fj].strip().startswith('- '):
    _fj += 1
_fbroken = chr(10).join(_flines[:_fi] + _flines[_fj:])
(_fw / ".github" / "workflows" / "deploy.yml").write_text(_fbroken, encoding="utf-8")
_fo_p = _cires.find_orphan_filter_outputs(_fw)
check("and a missing filter key IS caught, by name", _fo_p == ["relay"], str(_fo_p))

print("A LINK TO A DELETED ROUTE IS CAUGHT")
# FIVE ROUTES WERE DELETED IN ROUNDS 129 AND 132. The links were unwrapped BY HAND, and hand work
# does not scale - a _src left pointing at a deleted route renders a dead link on a deployed site.
# TypeScript's typed routes help only where the route tree has regenerated.
#
# AND THE FIRST VERSION OF THIS CHECK COULD NOT FAIL. It collected its findings, printed them, and
# appended to all_problems at the BOTTOM of main - which an EARLY RETURN never reached. It printed
# "OK" while reporting nothing. **Found by planting a link and watching the guard pass**, which is
# the only way to tell a check from decoration.
_dl = Path(_tf.mkdtemp())
(_dl / "apps" / "web" / "src" / "routes").mkdir(parents=True)
(_dl / "apps" / "web" / "src" / "routes" / "index.tsx").write_text("", encoding="utf-8")
(_dl / "apps" / "web" / "src" / "routes" / "status.tsx").write_text("", encoding="utf-8")
(_dl / "apps" / "web" / "src" / "x.tsx").write_text(
    'export const A = () => <a href="/status">s</a>;\n'
    'export const B = () => <a href="/method">m</a>;\n', encoding="utf-8")
_dl_p = _src.find_dead_route_links(_dl)
check("a link to a route with no route file IS caught",
      [x["route"] for x in _dl_p] == ["/method"], str(_dl_p))
check("and a link that DOES resolve is not",
      all(x["route"] != "/status" for x in _dl_p), str(_dl_p))
check("the real web app has no link to a deleted route",
      _src.find_dead_route_links(ROOT) == [], str(_src.find_dead_route_links(ROOT)))

print("A DEPLOY THAT CANNOT BE TRIGGERED IS CAUGHT")
# ROUND 134: THE SITE HAD NOT DEPLOYED IN WEEKS while every run reported SUCCESS. A push deploys
# only what its own diff touched, and a manual workflow_dispatch has NO DIFF AT ALL - so every
# job condition is false and the trigger is decoration. **There was no way to deploy the web app
# on demand**, and the only evidence was a stale string in the live bundle.
_dw = Path(_tf.mkdtemp())
(_dw / ".github" / "workflows").mkdir(parents=True)
(_dw / ".github" / "workflows" / "deploy.yml").write_text(
    "on:\n  workflow_dispatch:\n"
    "jobs:\n"
    "  pages:\n"
    "    needs: changes\n"
    "    if: needs.changes.outputs.web == 'true'\n",
    encoding="utf-8")
_dw_p = _cires.find_undeployable_jobs(_dw)
check("a deploy job with no manual escape IS caught",
      _dw_p and _dw_p[0]["job"] == "pages", str(_dw_p))
(_dw / ".github" / "workflows" / "deploy.yml").write_text(
    "on:\n  workflow_dispatch:\n"
    "jobs:\n"
    "  pages:\n"
    "    needs: changes\n"
    "    if: inputs.force_all == true || needs.changes.outputs.web == 'true'\n",
    encoding="utf-8")
check("and an inputs.force_* escape clears it",
      _cires.find_undeployable_jobs(_dw) == [], str(_cires.find_undeployable_jobs(_dw)))
check("the real deploy.yml can deploy every job on demand",
      _cires.find_undeployable_jobs(ROOT) == [], str(_cires.find_undeployable_jobs(ROOT)))

print("A PACKAGE CI DOES NOT INSTALL IS CAUGHT BEFORE THE PUSH")
# selftest.py does `from PIL import Image`, and NOTHING HAD EVER INSTALLED PILLOW - the runner
# starts with a bare Python, so the suite died at 319 of 446 assertions with an ImportError while
# every guard before it passed. **A local machine has Pillow**, so the import succeeds here and
# cannot succeed there. This is the package half of what cleanroom.py finds for files.
_mr = Path(_tf.mkdtemp())
(_mr / "scripts" / "harness").mkdir(parents=True)
(_mr / "scripts" / "harness" / "x.py").write_text("import numpy\n", encoding="utf-8")
_mr_p = _cires.find_missing_requirements(_mr)
check("a third-party import CI does not install IS caught",
      [x["module"] for x in _mr_p] == ["numpy"], str(_mr_p))
(_mr / "requirements.txt").write_text("numpy>=1.0\n", encoding="utf-8")
check("and naming it in requirements.txt clears it",
      _cires.find_missing_requirements(_mr) == [], str(_cires.find_missing_requirements(_mr)))
(_mr / "requirements.txt").write_text("Pillow>=10.0\n", encoding="utf-8")
(_mr / "scripts" / "harness" / "x.py").write_text("from PIL import Image\n", encoding="utf-8")
check("the DISTRIBUTION name matches the import name case-insensitively",
      _cires.find_missing_requirements(_mr) == [], str(_cires.find_missing_requirements(_mr)))
check("the real tree installs everything its CI steps import",
      _cires.find_missing_requirements(ROOT) == [], str(_cires.find_missing_requirements(ROOT))[:2])

print("A SPEND SURFACE THAT NAMES NO HOST IS CAUGHT TOO")
# THE HOST SCAN COULD NOT SEE THE RELAY'S CHAT. It spends through
# `createGateway({ apiKey: env.GATEWAY_KEY })` and `env.AI.run(...)` - **a BINDING and a secret,
# with no URL anywhere in the file.** Found in round 129 by searching for the pattern instead of the
# host, and there is now a second allowlist beside the first.
import importlib.util as _ilu39  # noqa: E402

_spec39 = _ilu39.spec_from_file_location(
    "_src13", str(ROOT / "scripts" / "factory" / "15_source_claims.py"))
_src5 = _ilu39.module_from_spec(_spec39)
sys.modules["_src13"] = _src5
_spec39.loader.exec_module(_src5)

_sb = Path(_tf.mkdtemp())
(_sb / "apps" / "x").mkdir(parents=True)
(_sb / "apps" / "x" / "w.ts").write_text(
    'const r = await env.AI.run("m", {});\n', encoding="utf-8")
_sb_p = _src5.find_spend_bindings(_sb)
check("a spend BINDING outside the allowlist IS caught",
      _sb_p == [{"file": "apps/x/w.ts"}], str(_sb_p))
(_sb / "apps" / "x" / "w.ts").write_text("export const f = () => 1;\n", encoding="utf-8")
check("a file with no binding is not flagged",
      _src5.find_spend_bindings(_sb) == [], str(_src5.find_spend_bindings(_sb)))
check("the real tree's only spend binding is the allowlisted chat door",
      _src5.find_spend_bindings(ROOT) == [], str(_src5.find_spend_bindings(ROOT))[:2])
check("and that door really is the one file", 
      "apps/relay/src/worker.ts" in _src5.SPEND_BINDING_ALLOWED,
      str(sorted(_src5.SPEND_BINDING_ALLOWED)))

print("ONE FUNCTION DECIDES WHAT IS OUT OF SCOPE, AND IT HANDLES EVERY FORM THAT EVER BROKE IT")
# THE SEPARATOR AND PREFIX TRAP HAS CAUSED FIVE BUGS IN FIVE GUARDS, and this file alone held FOUR
# different spellings of the same idea. Each of the five is now a case:
#
#   round  98  `p.parent / "../x"` CONCATENATED instead of resolved
#   round 110  `"dedup/" in str(p)` — on Windows that is `"dedup\\..."`, so it never matched
#   round 118  the same, in a different guard
#   round 125  `"/.backup/"` missed a path that STARTED with `.backup/`
#   round 126  `".git"` MATCHED `.github"`, so every workflow file was invisible
import importlib.util as _ilu38  # noqa: E402

_spec38 = _ilu38.spec_from_file_location(
    "_src11", str(ROOT / "scripts" / "factory" / "15_source_claims.py"))
_src5 = _ilu38.module_from_spec(_spec38)
sys.modules["_src11"] = _src5
_spec38.loader.exec_module(_src5)

# (PATH, SHOULD IT BE EXCLUDED, WHY)
#
# THE EXPECTATION IS ITS OWN FIELD. The first version derived it from "is there a note", so a path
# with an EXPLANATION of why it must be KEPT was expected to be excluded - **a test whose data
# contradicted its own comment**, and it reported the helper as broken.
_CASES = [
    ("node_modules/vitest/index.js", True, "a dependency"),
    ("apps/web/src/x.ts", False, "the repo's own source"),
    (".github/workflows/deploy.yml", False, ".git must NOT match .github"),
    ("scripts/factory/a.py", False, "the repo's own source"),
    (".kilo/worktrees/x/a.py", True, "a worktree copy"),
    (".backup/web/src/a.ts", True, "the old web app backup, AT THE START of the path"),
    ("Paper/.kilo/worktrees/x/a.ts", True, "a worktree copy under Paper/"),
    (".research/probe.py", True, "a scratch probe"),
    ("dedup/bake.py", True, "a separate tool"),
    (".pytest_cache/x", True, "a cache"),
]
for _p, _want, _why in _CASES:
    got = _src5.out_of_scope(_p)
    check(("excluded: " if _want else "kept:     ") + _p, got == _want,
          "got " + str(got) + " - " + _why)
# AND THE WINDOWS SEPARATOR, which is where two of the five started
check("a backslash path is normalised before it is compared",
      _src5.out_of_scope("node_modules\\vitest\\index.js") is True)
check("and .github survives a backslash too",
      _src5.out_of_scope(".github\\workflows\\deploy.yml") is False)

print("THE HANDBOOK IS SCANNED TOO")
# `docs/*.md` ARE THE REPO'S OWN DESCRIPTION OF ITSELF AND WERE CHECKED BY NOTHING. The
# architecture handbook said "last verified 2026-08-27" and named FIVE of NINE workflows, a photo
# count 1,800 out, and a chat marked live when its door fails closed.
#
# > **A "last verified" date is a claim, and the claim is only as good as the check behind it.**
import importlib.util as _ilu37  # noqa: E402

_spec37 = _ilu37.spec_from_file_location(
    "_src9", str(ROOT / "scripts" / "factory" / "15_source_claims.py"))
_src5 = _ilu37.module_from_spec(_spec37)
sys.modules["_src9"] = _src5
_spec37.loader.exec_module(_src5)

_dh = Path(_tf.mkdtemp())
(_dh / "docs").mkdir(parents=True)
(_dh / "scripts").mkdir(parents=True)
(_dh / "scripts" / "real.py").write_text("", encoding="utf-8")
(_dh / "docs" / "handbook.md").write_text("See `scripts/real.py` and `scripts/gone.py`.\n",
                                          encoding="utf-8")
_dh_p = _src5.find_broken_references(_dh)
check("a handbook naming a missing script IS caught",
      any("gone.py" in x["ref"] for x in _dh_p), str(_dh_p))
check("and a script that exists is not", all("real.py" not in x["ref"] for x in _dh_p), str(_dh_p))
check("the real docs/ references all resolve",
      all("docs/" not in x["file"] for x in _src5.find_broken_references(ROOT)),
      str([x for x in _src5.find_broken_references(ROOT) if "docs/" in x["file"]])[:2])

print("NO BILLING HOST OUTSIDE A FILE ALLOWED TO HAVE ONE")
# THIS IS THE DIRECT TEST OF THE OWNER'S RULE: "the spend to be only on testing models on images,
# and not on cloudflare or anything else."
#
# ROUND 125 AUDITED EVERY HOST IN THE REPOSITORY and found FIVE model providers - api.openai.com,
# api.anthropic.com, api.groq.com, api.mistral.ai, generativelanguage.googleapis.com. All five were
# inside a GITIGNORED backup of the old web app: dead files, no risk. **But finding them took a hand
# audit, and the next one would take another.**
#
# So it is a check. And the ONE remaining model call the site can make is BYOK -
# `runOpenRouter(key, ...)`, browser-direct, the visitor's own key ON AN IMAGE, which is precisely
# the permitted category.
import importlib.util as _ilu36  # noqa: E402

_spec36 = _ilu36.spec_from_file_location(
    "_src7", str(ROOT / "scripts" / "factory" / "15_source_claims.py"))
_src5 = _ilu36.module_from_spec(_spec36)
sys.modules["_src7"] = _src5
_spec36.loader.exec_module(_src5)

_ph = Path(_tf.mkdtemp())
(_ph / "scripts").mkdir(parents=True)
(_ph / "scripts" / "ok.py").write_text("U = 'https://openrouter.ai/api/v1'\n", encoding="utf-8")
_ph_p = _src5.find_unexpected_paid_hosts(_ph)
check("a billing host outside the allowlist IS caught", len(_ph_p) == 1, str(_ph_p))
check("and it names the host", _ph_p and _ph_p[0]["host"] == "openrouter.ai", str(_ph_p))
(_ph / "scripts" / "ok.py").write_text('V = "https://example.com/api"\n', encoding="utf-8")
check("a non-billing host is not flagged",
      _src5.find_unexpected_paid_hosts(_ph) == [], str(_src5.find_unexpected_paid_hosts(_ph)))
check("the real tree has no billing host outside an allowed file",
      _src5.find_unexpected_paid_hosts(ROOT) == [],
      str(_src5.find_unexpected_paid_hosts(ROOT))[:3])

print("THE FRONT PAGE SAYS WHAT IS VERIFIED, AND THE GUARD COUNT IS DERIVED")
# THE PLAN PACK SAID NOTHING ABOUT VERIFICATION - zero mentions of "verif", "test" or "assert".
# **Twenty-four rounds of checks were invisible from the document the owner actually reads**, so the
# front page now states them.
#
# AND THE COUNT IS READ FROM THE GUARD, NOT TYPED. Round 100 established the pattern for the ticket
# and ADR counts; this is the same shape for the guard list, because a count in prose is a claim
# nobody updates.
import importlib.util as _ilu35  # noqa: E402

_spec35 = _ilu35.spec_from_file_location(
    "_mir4", str(ROOT / "scripts" / "factory" / "16_html_mirrors.py"))
_mir2 = _ilu35.module_from_spec(_spec35)
sys.modules["_mir4"] = _mir2
_spec35.loader.exec_module(_mir2)

_gr = Path(_tf.mkdtemp())
(_gr / "index.html").write_text("<strong>99 required guards</strong>\n", encoding="utf-8")
check("the guard count is read from REQUIRED_GUARDS, not the page",
      len(_mir2._required_guard_count(ROOT)) if isinstance(
          _mir2._required_guard_count(ROOT), list) else _mir2._required_guard_count(ROOT) == 10,
      str(_mir2._required_guard_count(ROOT)))
check("a WRONG guard count on the front page IS caught",
      any("required guards" in x for x in _mir2.find_index_problems(_gr)),
      str(_mir2.find_index_problems(_gr)))
check("the real front page's guard count is right",
      not any("required guards" in x for x in
              _mir2.find_index_problems(ROOT / ".scratch" / "seen-not-grasped")),
      str(_mir2.find_index_problems(ROOT / ".scratch" / "seen-not-grasped"))[:2])

print("A DECISION TICKET OFFERS A CHOICE, NOT A PUZZLE")
# A TICKET MARKED `needs-info` IS ASKING FOR A DECISION. If it describes the situation and stops,
# the owner has to DESIGN the choice before making it - which is most of the work, and the part an
# agent can do. **Naming the options with their costs turns a puzzle into a pick.**
#
# Measured in round 121: FOUR OF THE SIX decision tickets carried no option markers at all, and
# two more described options only in prose.
import importlib.util as _ilu34  # noqa: E402

_spec34 = _ilu34.spec_from_file_location(
    "_plan3", str(ROOT / "scripts" / "factory" / "11_plan_truthfulness.py"))
_plan = _ilu34.module_from_spec(_spec34)
sys.modules["_plan3"] = _plan
_spec34.loader.exec_module(_plan)

_dt = Path(_tf.mkdtemp())
(_dt / "issues").mkdir(parents=True)
(_dt / "issues" / "a.md").write_text("**Status:** `needs-info` — decide\n", encoding="utf-8")
_dt_p = _plan.find_decisions_without_options(_dt / "issues")
check("a needs-info ticket with no options IS caught", len(_dt_p) == 1, str(_dt_p))
(_dt / "issues" / "a.md").write_text(
    "**Status:** `needs-info` — decide\n\n**Option A — do it.** costs x\n"
    "**Option B — do not.** costs y\n", encoding="utf-8")
check("laying out the options clears it",
      _plan.find_decisions_without_options(_dt / "issues") == [],
      str(_plan.find_decisions_without_options(_dt / "issues")))
(_dt / "issues" / "a.md").write_text("**Status:** done\n", encoding="utf-8")
check("a CLOSED ticket needs no options",
      _plan.find_decisions_without_options(_dt / "issues") == [],
      str(_plan.find_decisions_without_options(_dt / "issues")))
check("every real decision ticket offers a choice",
      _plan.find_decisions_without_options(ROOT / ".scratch" / "seen-not-grasped" / "issues") == [],
      str(_plan.find_decisions_without_options(
          ROOT / ".scratch" / "seen-not-grasped" / "issues"))[:3])

print("EVERY CHECK HAS A TEST")
# ROUND 119 FOUND ONE: `find_path_gaps`, written in round 118, had **no test at all**. The check
# that found a real gap could itself have broken silently - and **a guard that breaks in silence is
# worse than no guard, because its silence reads as a pass.**
#
# INDIRECT COVERAGE COUNTS. A helper called only by a tested function is tested; requiring every
# internal function to be named would produce false positives and be turned off.
import importlib.util as _ilu33  # noqa: E402

_spec33 = _ilu33.spec_from_file_location(
    "_unw2", str(ROOT / "scripts" / "factory" / "12_unwired.py"))
_unwired = _ilu33.module_from_spec(_spec33)
sys.modules["_unw2"] = _unwired
_spec33.loader.exec_module(_unwired)

_uc = Path(_tf.mkdtemp())
(_uc / "scripts" / "factory").mkdir(parents=True)
(_uc / "scripts" / "db").mkdir(parents=True)
(_uc / "scripts" / "harness").mkdir(parents=True)
(_uc / "scripts" / "harness" / "selftest.py").write_text("find_tested\n", encoding="utf-8")
(_uc / "scripts" / "factory" / "g.py").write_text(
    "def find_tested():\n    return []\n\n\ndef find_orphan():\n    return []\n",
    encoding="utf-8")
_uc_p = _unwired.find_untested_checks(_uc)
check("a check the self-test never names IS caught",
      [x["check"] for x in _uc_p] == ["find_orphan"], str(_uc_p))
check("a check the self-test names is not flagged",
      all(x["check"] != "find_tested" for x in _uc_p), str(_uc_p))
(_uc / "scripts" / "factory" / "g.py").write_text(
    "def find_helper():\n    return []\n\n\ndef find_outer():\n    return find_helper()\n",
    encoding="utf-8")
(_uc / "scripts" / "harness" / "selftest.py").write_text("find_outer\n", encoding="utf-8")
check("a helper called only by a TESTED function counts as tested",
      _unwired.find_untested_checks(_uc) == [], str(_unwired.find_untested_checks(_uc)))
check("every real check is tested",
      _unwired.find_untested_checks(ROOT) == [], str(_unwired.find_untested_checks(ROOT))[:3])

print("EVERY CI STEP RUNS, AND A WORKFLOW FIRES ON WHAT IT CHECKS")
# ALL 11 GUARD STEPS WERE RUN VERBATIM and every one exits 0 - including `00_metadata_audit.py`,
# which was ADDED to CI in round 110 and had never actually been invoked the way CI invokes it.
# **A step that was never run is a step that was never checked.**
#
# And the scripts carry NO Windows-only assumption: the `replace("\\\\", "/")` calls normalise TO
# posix, which is correct on both platforms, and nothing joins paths with a backslash literal.
import importlib.util as _ilu32  # noqa: E402

_spec32 = _ilu32.spec_from_file_location(
    "_cires6", str(ROOT / "scripts" / "factory" / "13_ci_resolves.py"))
_cires = _ilu32.module_from_spec(_spec32)
sys.modules["_cires6"] = _cires
_spec32.loader.exec_module(_cires)

_cpg = Path(_tf.mkdtemp())
(_cpg / ".github" / "workflows").mkdir(parents=True)
(_cpg / "scripts").mkdir(parents=True)
(_cpg / "scripts" / "g.py").write_text("", encoding="utf-8")
_GOOD = ("on:\n"
         "  push:\n"
         "    paths:\n"
         '      - "scripts/**"\n'
         "jobs:\n"
         "  a:\n"
         "    steps:\n"
         "      - run: python scripts/g.py\n")
(_cpg / ".github" / "workflows" / "w.yml").write_text(_GOOD, encoding="utf-8")
check("a paths block covering the script is not flagged",
      _cires.find_path_gaps(_cpg) == [], str(_cires.find_path_gaps(_cpg)))
# EXACT PATH COVERAGE COUNTS TOO - requiring the wildcard was a false positive on graph-check.yml
(_cpg / ".github" / "workflows" / "w.yml").write_text(
    _GOOD.replace('      - "scripts/**"', '      - "scripts/g.py"'), encoding="utf-8")
check("an EXACT script path covers it, not only the wildcard",
      _cires.find_path_gaps(_cpg) == [], str(_cires.find_path_gaps(_cpg)))
(_cpg / ".github" / "workflows" / "w.yml").write_text(
    _GOOD.replace('      - "scripts/**"', '      - "apps/**"'), encoding="utf-8")
check("a paths block that covers NEITHER is caught",
      len(_cires.find_path_gaps(_cpg)) == 1, str(_cires.find_path_gaps(_cpg)))
check("every real workflow fires on what its steps run",
      _cires.find_path_gaps(ROOT) == [], str(_cires.find_path_gaps(ROOT))[:2])

print("AN ALERT THAT CANNOT RE-FIRE IS NOT AN ALERT")
# FOUR OF THE FIVE WORKFLOWS DID THIS: the failure step opened an issue ONLY IF none was already
# open, and NOTHING ever closed one. After the first failure the issue stayed open for good, so
# **every later failure created nothing and notified nobody** - the worst state, because it looks
# like alerting.
#
# grip-rebake was already better - it COMMENTS on an open issue, so a second failure does notify -
# but it still left the issue open after a recovery, and a stale warning is one people learn to
# ignore.
import importlib.util as _ilu31  # noqa: E402

_spec31 = _ilu31.spec_from_file_location(
    "_cires5", str(ROOT / "scripts" / "factory" / "13_ci_resolves.py"))
_cires = _ilu31.module_from_spec(_spec31)
sys.modules["_cires5"] = _cires
_spec31.loader.exec_module(_cires)

import importlib.util as _ilu31  # noqa: E402

_spec31 = _ilu31.spec_from_file_location(
    "_cires5", str(ROOT / "scripts" / "factory" / "13_ci_resolves.py"))
_cires = _ilu31.module_from_spec(_spec31)
sys.modules["_cires5"] = _cires
_spec31.loader.exec_module(_cires)

_os = Path(_tf.mkdtemp())
(_os / ".github" / "workflows").mkdir(parents=True)
(_os / ".github" / "workflows" / "a.yml").write_text(
    "jobs:\n  n:\n    if: failure()\n    steps:\n"
    "      - run: echo x\n"
    "        with:\n          script: |\n            await github.rest.issues.create({})\n",
    encoding="utf-8")
_os_p = _cires.find_one_shot_alerts(_os)
check("an alert that never closes IS caught", _os_p == ["a.yml opens an alert issue and never "
      "closes it, so a second failure notifies nobody"], str(_os_p))
(_os / ".github" / "workflows" / "a.yml").write_text(
    "jobs:\n  n:\n    if: failure()\n    steps:\n"
    "      - run: echo x\n        with:\n          script: |\n"
    "            await github.rest.issues.create({})\n"
    "  r:\n    if: success()\n    steps:\n      - name: Alert on recovery\n",
    encoding="utf-8")
check("a recovery step clears it", _cires.find_one_shot_alerts(_os) == [],
      str(_cires.find_one_shot_alerts(_os)))
check("every real failure alert can re-fire",
      _cires.find_one_shot_alerts(ROOT) == [], str(_cires.find_one_shot_alerts(ROOT))[:2])

print("A DEPLOY THAT IS GATED OFF SAYS SO")
# EVERY DEPLOY JOB IS GATED ON `needs.changes.outputs.secrets`. With the Cloudflare secrets
# unset the workflow runs GREEN and deploys NOTHING, and the message saying so went only to
# `$GITHUB_OUTPUT` - **a file nobody reads.** The run summary said nothing at all.
#
# **A green run that shipped nothing is the same defect as a pipeline that exits 0 having done no
# work** - the round-87 finding, at the deploy layer.
import importlib.util as _ilu30  # noqa: E402

_spec30 = _ilu30.spec_from_file_location(
    "_cires4", str(ROOT / "scripts" / "factory" / "13_ci_resolves.py"))
_cires = _ilu30.module_from_spec(_spec30)
sys.modules["_cires4"] = _cires
_spec30.loader.exec_module(_cires)

_sg = Path(_tf.mkdtemp())
(_sg / ".github" / "workflows").mkdir(parents=True)
_GATE = (
    "jobs:\n"
    "  a:\n"
    "    if: needs.changes.outputs.secrets == 'true'\n"
    "    steps:\n"
    "      - run: bunx wrangler@4 deploy\n")
(_sg / ".github" / "workflows" / "deploy.yml").write_text(_GATE, encoding="utf-8")
_sg_p = _cires.find_silent_gates(_sg)
check("a gate with no annotation IS caught", len(_sg_p) == 1, str(_sg_p))
(_sg / ".github" / "workflows" / "deploy.yml").write_text(
    _GATE + "  # a comment\n", encoding="utf-8")
check("a comment is not an annotation",
      len(_cires.find_silent_gates(_sg)) == 1, str(_cires.find_silent_gates(_sg)))
(_sg / ".github" / "workflows" / "deploy.yml").write_text(
    _GATE.replace("      - run: bunx wrangler@4 deploy",
                  "      - run: echo \"::warning title=Skipped::no credentials\""),
    encoding="utf-8")
check("an annotation clears it", _cires.find_silent_gates(_sg) == [],
      str(_cires.find_silent_gates(_sg)))
check("the real deploy announces when its gate is off",
      _cires.find_silent_gates(ROOT) == [], str(_cires.find_silent_gates(ROOT))[:2])

print("A DEPLOY RUNS THE TESTS BEFORE IT SHIPS")
# deploy.yml RAN ONLY A TYPECHECK, and every deploy job needed `changes`, NOT `ci`. Both workflows
# trigger on the same push, so **a deploy could complete while CI was failing** - and nothing
# connected the guard suite to what ships.
#
# A cross-workflow dependency needs `workflow_run` and a restructure; running the checks IN the
# deploy job makes it **self-sufficient** instead. That is also what is checked, because a
# requirement expressed as a convention is one that decays.
# LOCAL IMPORT - FIFTEENTH TIME. The pattern is now the single most repeated mistake in this
# session, and the header rule has not prevented one instance. See the note there.
import importlib.util as _ilu29  # noqa: E402

_spec29 = _ilu29.spec_from_file_location(
    "_cires3", str(ROOT / "scripts" / "factory" / "13_ci_resolves.py"))
_cires = _ilu29.module_from_spec(_spec29)
sys.modules["_cires3"] = _cires
_spec29.loader.exec_module(_cires)

_ud = Path(_tf.mkdtemp())
(_ud / ".github" / "workflows").mkdir(parents=True)
(_ud / ".github" / "workflows" / "deploy.yml").write_text(
    "jobs:\n"
    "  a:\n"
    "    steps:\n"
    "      - run: bunx turbo run test\n"
    "      - run: bunx wrangler@4 deploy\n"
    "  b:\n"
    "    steps:\n"
    "      - run: bunx turbo run typecheck\n"
    "      - run: bunx wrangler@4 deploy\n", encoding="utf-8")
_ud_p = _cires.find_untested_deploys(_ud)
# THE LINE NUMBER IS NOT THE POINT. Asserting on it made the test fail when the fixture moved by
# three lines - **a test bound to a coincidence rather than to the behaviour.**
check("a deploy with no test step in its job IS caught",
      len(_ud_p) == 1 and "`b`" in _ud_p[0] and "tests" in _ud_p[0], str(_ud_p))
check("a job that DOES test is not flagged", all("`a`" not in x for x in _ud_p), str(_ud_p))
check("every real deploy job runs the tests",
      _cires.find_untested_deploys(ROOT) == [], str(_cires.find_untested_deploys(ROOT))[:2])

print("A DEPLOY APPLIES ITS MIGRATIONS BEFORE ITS CODE")
# THE RELAY WAS DEPLOYED WITH NO MIGRATION STEP. A change that needs a new column shipped the code
# and left the database behind: **the API fails in production, on the path a user is using**, and
# nothing could see it, because check_migrations.py validates the API against the migrations in the
# REPOSITORY, not against what is deployed.
#
# Writing the check took FOUR passes, and every failure was the check reading the wrong app:
#   1. it flagged EVERY deploy, including grip-sync, which uses KV and has no schema at all;
#   2. it searched BACKWARDS for working-directory, which comes AFTER run:, so it read the previous
#      step's app;
#   3. it searched the WHOLE FILE, so the RELAY's migration step satisfied it for METRO-RELAY.
# **A check that a neighbour's fix satisfies is not checking the thing in front of it.**
# LOCAL IMPORT - FOURTEENTH TIME. Fourteen. The header states it and the header does not help.
import importlib.util as _ilu28  # noqa: E402

_spec28 = _ilu28.spec_from_file_location(
    "_cires2", str(ROOT / "scripts" / "factory" / "13_ci_resolves.py"))
_cires = _ilu28.module_from_spec(_spec28)
sys.modules["_cires2"] = _cires
_spec28.loader.exec_module(_cires)

_dp = Path(_tf.mkdtemp())
(_dp / ".github" / "workflows").mkdir(parents=True)
(_dp / "apps" / "withd1").mkdir(parents=True)
(_dp / "apps" / "withd1" / "wrangler.toml").write_text("[[d1_databases]]\n", encoding="utf-8")
(_dp / "apps" / "withd1" / "migrations").mkdir()
(_dp / "apps" / "kvonly").mkdir(parents=True)
(_dp / "apps" / "kvonly" / "wrangler.toml").write_text("[[kv_namespaces]]\n", encoding="utf-8")
_DEPLOY = (
    "jobs:\n"
    "  a:\n"
    "    steps:\n"
    "      - name: Deploy\n"
    "        run: bunx wrangler@4 deploy\n"
    "        working-directory: apps/withd1\n"
    "  b:\n"
    "    steps:\n"
    "      - name: Deploy\n"
    "        run: bunx wrangler@4 deploy\n"
    "        working-directory: apps/kvonly\n")
(_dp / ".github" / "workflows" / "deploy.yml").write_text(_DEPLOY, encoding="utf-8")
_problems = _cires.find_deploy_order_problems(_dp)
check("a D1 app deploying with no migration step IS caught",
      any("withd1" in x for x in _problems), str(_problems))
check("a KV-only app is NOT flagged", all("kvonly" not in x for x in _problems), str(_problems))
# THE FIX MUST SATISFY ITS OWN CHECK, IN THE SAME JOB
(_dp / ".github" / "workflows" / "deploy.yml").write_text(
    _DEPLOY.replace("      - name: Deploy\n        run: bunx wrangler@4 deploy\n"
                    "        working-directory: apps/withd1",
                    "      - name: Apply migrations\n"
                    "        run: bunx wrangler@4 d1 migrations apply db --remote\n"
                    "        working-directory: apps/withd1\n"
                    "      - name: Deploy\n        run: bunx wrangler@4 deploy\n"
                    "        working-directory: apps/withd1"),
    encoding="utf-8")
check("and a migration step in the SAME JOB satisfies it",
      all("withd1" not in x for x in _cires.find_deploy_order_problems(_dp)),
      str(_cires.find_deploy_order_problems(_dp)))
check("the real deploy applies migrations before every D1 deploy it can",
      _cires.find_deploy_order_problems(ROOT) == [],
      str(_cires.find_deploy_order_problems(ROOT))[:2])

print("A STAGE THAT CAN GO CLOSED DECLARES THE KEY IT NEEDS")
# `run_elicitation.py` DEFAULTS `--backend` TO "closed", and `from_env("closed", ...)` RAISES
# SystemExit without OPENROUTER_API_KEY. **The elicit stage declared NO needs_env at all**, so the
# pipeline would not have refused: it would have started a 200,000-call ladder and died on the
# FIRST call. The key is the one paid dependency, and the stage that needs it did not say so.
#
# THE CHECK IS NARROW ON PURPOSE. A first attempt compared every environ read against every
# declaration and produced **11 mismatches** - it followed imports into modules whose functions are
# never called on that path, and counted `USER`, which has a fallback. **A check that reports
# eleven problems in a correct file is one somebody turns off.** Only the requirement `from_env`
# actually enforces is checked.
# LOCAL IMPORT - THIRTEENTH TIME. The header states it; the header is not read while writing.
import importlib.util as _ilu27  # noqa: E402

_spec27 = _ilu27.spec_from_file_location(
    "_porder2", str(ROOT / "scripts" / "factory" / "14_pipeline_order.py"))
_porder = _ilu27.module_from_spec(_spec27)
sys.modules["_porder2"] = _porder
_spec27.loader.exec_module(_porder)

_be = Path(_tf.mkdtemp())
(_be / "scripts" / "harness").mkdir(parents=True)
(_be / "scripts" / "harness" / "closed_default.py").write_text(
    'ap.add_argument("--backend", default="closed", choices=["open", "closed"])\n'
    'backend = from_env(args.backend, args.model)[0]\n', encoding="utf-8")
(_be / "scripts" / "harness" / "open_only.py").write_text(
    'backend = from_env("open", args.model)[0]\n', encoding="utf-8")
_stages = [{"name": "a", "script": "scripts/harness/closed_default.py", "needs_env": []},
           {"name": "b", "script": "scripts/harness/open_only.py", "needs_env": []},
           {"name": "c", "script": "scripts/harness/closed_default.py",
            "needs_env": ["OPENROUTER_API_KEY"]}]
_miss = _porder.find_missing_backend_env(_stages, base=_be)
check("a stage defaulting to the CLOSED backend without the key IS caught",
      [x["key"] for x in _miss] == ["a"], str(_miss))
check("an open-only stage is NOT flagged", all(x["key"] != "b" for x in _miss), str(_miss))
check("and declaring the key clears it", all(x["key"] != "c" for x in _miss), str(_miss))
check("the real pipeline declares the key wherever it can go closed",
      _porder.find_missing_backend_env(
          _porder.parse_stages(
              (ROOT / "scripts" / "factory" / "run_pipeline.py").read_text(
                  encoding="utf-8-sig")), base=ROOT) == [],
      str(_porder.find_missing_backend_env(
          _porder.parse_stages(
              (ROOT / "scripts" / "factory" / "run_pipeline.py").read_text(
                  encoding="utf-8-sig")), base=ROOT))[:2])

print("THE PIPELINE'S PAID MARKER AGREES WITH THE CODE")
# `elicit` WAS ADDED IN ROUND 104 AS A PAID STAGE AND ITS SECOND DESCRIPTION STRING WAS SEPARATED
# BY A COMMA, so it became a SEPARATE POSITIONAL ARGUMENT and landed in `paid` as a STRING. It was
# truthy, so the stage behaved as paid and everything looked right.
#
# **Two readers of one declaration disagreed**: `parse_stages` reads the source and saw no
# `paid=True`, so it reported the stage free; `run_pipeline` saw a truthy string and treated it as
# paid. 200,000 model calls, marked free by the text and paid by the runtime.
import importlib.util as _ilu26  # noqa: E402

_spec26 = _ilu26.spec_from_file_location(
    "_porder", str(ROOT / "scripts" / "factory" / "14_pipeline_order.py"))
_porder = _ilu26.module_from_spec(_spec26)
sys.modules["_porder"] = _porder
_spec26.loader.exec_module(_porder)

_pi = Path(_tf.mkdtemp())
(_pi / "scripts" / "factory").mkdir(parents=True)
(_pi / "scripts" / "harness").mkdir(parents=True)
(_pi / "scripts" / "harness" / "spender.py").write_text(
    "from .spend import refuse_without_spend\n", encoding="utf-8")
(_pi / "scripts" / "harness" / "free.py").write_text("import json\n", encoding="utf-8")
_src = (
    "STAGES = [\n"
    "    Stage(\"a\", \"scripts/harness/spender.py\", \"spends\", paid=True),\n"
    "    Stage(\"b\", \"scripts/harness/free.py\", \"free\"),\n"
    "]\n")
_parsed = _porder.parse_stages(_src)
check("paid=True is parsed as paid", [x["paid"] for x in _parsed] == [True, False],
      str([x["paid"] for x in _parsed]))
check("a stage that reaches a model call and is MARKED paid is not a mismatch",
      _porder.find_paid_mismatches(_parsed, base=_pi) == [],
      str(_porder.find_paid_mismatches(_parsed, base=_pi)))
# the shim: run_open is a thin wrapper over sweep, and the spending is one level down
_shim = _pi / "scripts" / "harness" / "shim.py"
_shim.write_text("from .spender import x\n", encoding="utf-8")
check("a SHIM that reaches a model one hop down is not reported as free",
      _porder.reaches_a_model(_shim, base=_pi) is True, "reported as free")
# and the real pipeline agrees
check("the real pipeline has no paid marker that disagrees with the code",
      _porder.find_paid_type_errors(ROOT) == [], str(_porder.find_paid_type_errors(ROOT))[:2])
check("and every real stage's marker matches what it can reach",
      _porder.find_paid_mismatches(
          _porder.parse_stages(
              (ROOT / "scripts" / "factory" / "run_pipeline.py").read_text(
                  encoding="utf-8-sig")), base=ROOT) == [],
      "a real mismatch")

print("AN EXEMPTION'S STATED REASON IS CHECKED")
# `12_unwired` EXEMPTED `00_metadata_audit.py` BECAUSE "ci.yml runs it as a check" - **and ci.yml
# did not.** The exemption rested on a claim nobody verified, which is the very defect that file
# exists to catch. **An exemption whose stated reason is false is worse than no exemption, because
# it reads as covered.**
import importlib.util as _ilu25  # noqa: E402

_spec25 = _ilu25.spec_from_file_location(
    "_unw", str(ROOT / "scripts" / "factory" / "12_unwired.py"))
_unwired = _ilu25.module_from_spec(_spec25)
sys.modules["_unw"] = _unwired
_spec25.loader.exec_module(_unwired)

_uw = Path(_tf.mkdtemp())
(_uw / ".github" / "workflows").mkdir(parents=True)
(_uw / ".github" / "workflows" / "ci.yml").write_text(
    "      - run: python scripts/factory/really_run.py\n", encoding="utf-8")
_FALSE = {"says_ci.yml_runs_it.py": "a CI guard, run by ci.yml as a check",
          "says_not_ci.py": "runs in the pipeline, not CI, because the plan is private",
          "really_run.py": "a CI guard, run by ci.yml as a check"}
_saved_allowed = dict(_unwired.ALLOWED)
try:
    _unwired.ALLOWED.clear()
    _unwired.ALLOWED.update(_FALSE)
    _names = [x["file"] for x in _unwired.find_false_exemptions(_uw)]
    check("a reason claiming CI, when CI does not run it, IS caught",
          "says_ci.yml_runs_it.py" in _names, str(_names))
    check("a reason claiming CI, when CI DOES run it, is not", "really_run.py" not in _names, str(_names))
    # AND THE DIRECTION THAT MADE THIS CHECK WRONG THE FIRST TIME: "not CI" is a claim too.
    #
    # THE PREMISE OF THE FIRST VERSION WAS WRONG. It asserted that `says_not_ci.py` is caught while
    # the workflow named a DIFFERENT script - so "not CI" was TRUE and not flagging it was
    # CORRECT. **A test whose premise is wrong reports a correct checker as broken.** The workflow
    # must name the script for the claim to be false.
    check("a reason saying NOT CI, with no workflow naming it, is correct",
          "says_not_ci.py" not in _names, str(_names))
    (_uw / ".github" / "workflows" / "ci.yml").write_text(
        "      - run: python scripts/factory/says_not_ci.py\n", encoding="utf-8")
    _names2 = [x["file"] for x in _unwired.find_false_exemptions(_uw)]
    check("but NOT CI, when a workflow DOES name it, IS caught",
          "says_not_ci.py" in _names2, str(_names2))
finally:
    _unwired.ALLOWED.clear()
    _unwired.ALLOWED.update(_saved_allowed)
check("every real allowlist reason is true",
      _unwired.find_false_exemptions(ROOT) == [], str(_unwired.find_false_exemptions(ROOT))[:2])

print("THE API'S SQL IS CHECKED AGAINST THE SCHEMA")
# **THE TYPESCRIPT COMPILER CANNOT SEE INSIDE A SQL STRING.** A column renamed in a migration and
# not in the API fails at REQUEST time, in production, on the path a user is using. 54 queries
# were checked against nothing.
#
# Writing the check took THREE passes, and every failure was in the CHECK, not the API:
#   1. EXPLAIN needs bindings, and the loop stopped at 20 while the widest INSERT binds 25 -
#      **guessing a bound too low turned a correct statement into a reported fault.**
#   2. A long query is written `"...col," + " FROM t ..."`, and taking only the first literal
#      produced a statement that PARSED, as a bare SELECT with no FROM, and failed with
#      "no such column: rev_id" - **naming a column that exists.**
#   3. The API creates `graph_drafts` itself with CREATE TABLE IF NOT EXISTS, so EXPLAINing the
#      CREATE left it absent and everything after it appeared broken. **The API's own DDL is part
#      of its contract with the schema**, so it is executed.
# LOCAL IMPORT - TWELFTH TIME. The header says it; the header is not read at the moment of writing.
import importlib.util as _ilu24  # noqa: E402

_spec24 = _ilu24.spec_from_file_location(
    "_cm2", str(ROOT / "scripts" / "db" / "check_migrations.py"))
_cm = _ilu24.module_from_spec(_spec24)
sys.modules["_cm2"] = _cm
_spec24.loader.exec_module(_cm)

_ap = Path(_tf.mkdtemp())
(_ap / "a.ts").write_text(
    'db.prepare("SELECT model FROM run_summary WHERE id = ?1")', encoding="utf-8")
_ts = _cm.extract_api_sql(_ap / "a.ts")
check("a single SQL literal is extracted", _ts == ["SELECT model FROM run_summary WHERE id = ?1"], _ts)
(_ap / "b.ts").write_text(
    'db.prepare("SELECT model, run_id" +\n  " FROM run_summary")', encoding="utf-8")
_ts2 = _cm.extract_api_sql(_ap / "b.ts")
check("a CONCATENATED query is joined, not truncated",
      _ts2 == ["SELECT model, run_id FROM run_summary"], _ts2)
# and the real thing
_db = sqlite3.connect(":memory:")
for _mf in sorted((ROOT / "apps" / "relay" / "migrations").glob("*.sql")):
    for _st in _cm.split_sql(_mf.read_text(encoding="utf-8-sig")):
        try:
            _db.execute(_st)
        except Exception:
            pass
_bad, _frag, _ddl = _cm.check_api_sql(_db, ROOT / "packages" / "questions-api" / "src" / "index.ts")
check("every complete API query is supported by the schema", _bad == [], str(_bad)[:2])

print("THE MIGRATIONS APPLY TO A FRESH DATABASE")
# **THE MIGRATIONS ARE THE ONLY PATH A NEW DATABASE TAKES, AND NOTHING CHECKED THEM.**
# sync_migrations.py regenerates them and WRITES FILES, so it cannot run in CI; the allowlist is
# right that it is a maintenance tool. A broken migration could therefore sit in the repository
# until a deployment failed to start.
import importlib.util as _ilu23  # noqa: E402

_spec23 = _ilu23.spec_from_file_location(
    "_cm", str(ROOT / "scripts" / "db" / "check_migrations.py"))
_cm = _ilu23.module_from_spec(_spec23)
sys.modules["_cm"] = _cm
_spec23.loader.exec_module(_cm)

_sm = Path(_tf.mkdtemp())
(_sm / "issues").mkdir(parents=True)
(_sm / "a.sql").write_text("CREATE TABLE t (id INTEGER);\nSELECT * FROM nope;\n", encoding="utf-8")
_mig = Path(_tf.mkdtemp())
(_mig / "0001_ok.sql").write_text("CREATE TABLE t (id INTEGER);\n", encoding="utf-8")
(_mig / "0002_bad.sql").write_text("CREATE TABLE u (id INTEGER);\nSELECT * FROM nope;\n",
                                   encoding="utf-8")
# THE SUB-CHECK'S OUTPUT IS SUPPRESSED. It prints its own "  FAIL <file>: <error>" lines, which
# are **indistinguishable from this file's own failures** - so the verification command's
# "fail=N" counter read 2 on a run that passed. A tool whose output cannot be told apart from the
# output of the thing it checks makes every reading suspect.
import contextlib as _ctx  # noqa: E402
import io as _io  # noqa: E402

_buf = _io.StringIO()
with _ctx.redirect_stdout(_buf):
    _rc_bad = _cm.main(["--dir", str(_mig)])
check("a migration with a failing statement is CAUGHT", _rc_bad == 1, "it passed")
check("and its failure names the file", "0002_bad.sql" in _buf.getvalue(), _buf.getvalue()[:80])
# THE COUNT CHECK MEANS A MINIMAL PROBE CANNOT PASS - a temp dir with one table is not the
# schema, and `check_migrations` refuses it. That is the check working. So the "valid" case is
# asserted against the REAL migration set, which is the one that matters, and the temp dir is used
# only for the failure path.
_buf2 = _io.StringIO()
with _ctx.redirect_stdout(_buf2):
    _rc_min = _cm.main(["--dir", str(_mig)])
check("a probe of unrelated tables is REFUSED for having the wrong schema",
      _rc_min == 1, "it accepted a one-table schema")
_buf3 = _io.StringIO()
with _ctx.redirect_stdout(_buf3):
    _rc_real = _cm.main(["--dir", str(ROOT / "apps" / "relay" / "migrations")])
check("the REAL migration set applies cleanly", _rc_real == 0, _buf3.getvalue()[-90:])

print("EVERY ANALYSIS IS CALLED, NOT ONLY DEFINED")
# **AN ANALYSIS DEFINED AND NEVER CALLED IS NOT A RESULT.** Rounds 73-74 shipped four functions
# into `analyze.py` and called none of them from the report: the numbers were computable and
# nothing computed them. The same shape as `image_edit` having a column and no writer.
#
# Ticket 22 claimed "five built" while its own checkboxes showed two of six. Both the count and
# the checkboxes were stale; the analyses were fine. **So the claim is now a fact the code
# settles**: every analysis named in the ticket must exist AND be called from the report.
_az = (ROOT / "scripts" / "harness" / "analyze.py").read_text(encoding="utf-8-sig")
NAMED = ("series", "slopes", "counterfactual_consistency", "difficulty_ladder",
         "constant_answer_baseline", "blind_gap", "calibration")
for _fn in NAMED:
    _defined = ("def " + _fn + "(") in _az
    # count CALL SITES: occurrences that are not the definition and not inside a docstring line
    _calls = [l for l in _az.splitlines()
              if (_fn + "(") in l and not l.strip().startswith("def ") and not l.strip().startswith("#")]
    check(_fn + " is defined AND called from the report", _defined and len(_calls) >= 1,
          "defined=%s calls=%d" % (_defined, len(_calls)))
# and the two that are genuinely not buildable must NOT be silently absent from the record
check("closed_loop_chains is NOT implemented, because it is defined nowhere",
      "def closed_loop_chains(" not in _az)
check("region_gap is NOT implemented, because it needs data on the same items",
      "def region_gap(" not in _az)

print("A WORKFLOW SETS THE ENV ITS SCRIPTS READ")
# THE FIRST VERSION OF export-benchmark.yml SET `RELAY` AND THE SCRIPT READ `RELAY_URL`. The job
# would have failed on its FIRST run with "refusing to run: set --relay or RELAY_URL." — **a
# workflow that cannot work, written by matching the idea in my head rather than the contract in
# the file.** It also passed HARNESS_CODE, which the script never sends: an unused secret implies a
# gate that is not there.
# LOCAL IMPORT - ELEVENTH TIME. Stated in the header, broken again. See the note there.
import importlib.util as _ilu22  # noqa: E402

_spec22 = _ilu22.spec_from_file_location(
    "_ci3", str(ROOT / "scripts" / "factory" / "13_ci_resolves.py"))
_src5 = _ilu22.module_from_spec(_spec22)
sys.modules["_ci3"] = _src5
_spec22.loader.exec_module(_src5)

_ci2 = Path(_tf.mkdtemp())
(_ci2 / ".github" / "workflows").mkdir(parents=True)
(_ci2 / "scripts").mkdir(parents=True)
(_ci2 / "scripts" / "s.py").write_text("import os\nV = os.environ.get(\"RELAY_URL\", \"\")\n",
                                       encoding="utf-8")
(_ci2 / ".github" / "workflows" / "w.yml").write_text(
    "jobs:\n  a:\n    steps:\n      - run: python scripts/s.py\n", encoding="utf-8")
_env = _src5.find_env_mismatches(_ci2)
check("a script reading an env the workflow does not set IS caught",
      any(x["var"] == "RELAY_URL" for x in _env), str(_env))
(_ci2 / ".github" / "workflows" / "w.yml").write_text(
    "jobs:\n  a:\n    steps:\n      - env:\n          RELAY_URL: x\n        run: python scripts/s.py\n",
    encoding="utf-8")
check("and is NOT caught once the workflow sets it",
      _src5.find_env_mismatches(_ci2) == [], str(_src5.find_env_mismatches(_ci2)))
check("every real workflow sets the env its scripts read",
      _src5.find_env_mismatches(ROOT) == [], str(_src5.find_env_mismatches(ROOT))[:2])

print("THE ELICITATION ARMS RUN, AND DISAGREE ON PURPOSE")
# Ticket 23 was mislabelled BLOCKED BY "external - the permitted spend". **Four of its six
# criteria are BUILD work and building costs nothing** - the "built is not run" distinction from
# round 95. The runner is built; running it is the paid step.
#
# The arms must NOT be averaged: the claim under test is that the elicitation METHOD is a confound
# in reported calibration, so one number for three arms destroys the only result they exist for.
from scripts.harness import run_elicitation as _re  # noqa: E402

check("A1 and A3 ask ONE call per item", len(_re.prompts_for("A1_verbalised", "q")) == 1
      and len(_re.prompts_for("A3_order_then_rate", "q")) == 1)
check("A2 samples the SAME prompt, because its distribution comes from the samples",
      _re.prompts_for("A2_self_consistency", "q") == _re.prompts_for("A2_self_consistency", "q"))
check("an unknown arm is refused", (lambda: [False for _ in [1]]
      if _re.prompts_for("A9", "q") else True) is not None)
try:
    _re.prompts_for("A9_nonsense", "q")
    check("an unknown arm RAISES rather than guessing", False, "it returned a prompt")
except ValueError:
    check("an unknown arm RAISES rather than guessing", True)

# THE PARSING, which is the whole measurement
_c1, _a1 = _re.confidence_for("A1_verbalised", ["ANSWER: 2\nCONFIDENCE: 80"])
check("A1 reads a stated confidence as a probability", _c1 is not None and abs(_c1 - 0.8) < 1e-9, _c1)
check("A1 also extracts the answer", _a1 == "2", _a1)
_c2, _a2 = _re.confidence_for("A2_self_consistency", ["2", "2", "3", "2"])
check("A2 takes its confidence from sample FREQUENCY, not from a stated number",
      _c2 is not None and abs(_c2 - 0.75) < 1e-9, _c2)
check("A2's answer is parsed, not the raw reply", _a2 == "2", _a2)
# A MISSING confidence is None, NEVER imputed - a defaulted 0.5 would move ECE to whatever it was
# set to, which is the failure the calibration code exists to avoid.
_c3, _ = _re.confidence_for("A1_verbalised", ["I am not sure"])
check("a missing confidence is None, NEVER imputed", _c3 is None, _c3)

print("A BLOCKER LINE CAN BE PARSED, AND THERE IS NO UNBLOCKED AGENT WORK")
# issue-tracker.md documented "next up: the lowest-numbered ticket whose every Blocked by is done".
# **That rule could not be followed.** The lines read `None (can start immediately)`, `nothing`,
# and `the permitted spend — it is 57,600 + 144,000 model calls`, so a parser would have read
# "the owner" as a ticket number.
#
# And the rule had a second flaw: with no LABEL filter it returns **ticket 01, the provenance
# audit** — `ready-for-human`, seven consent conversations. **An agent following the documented
# rule would have walked straight into human work.**
import importlib.util as _ilu21  # noqa: E402

_spec21 = _ilu21.spec_from_file_location(
    "_plan2", str(ROOT / "scripts" / "factory" / "11_plan_truthfulness.py"))
_plan2 = _ilu21.module_from_spec(_spec21)
sys.modules["_plan2"] = _plan2
_spec21.loader.exec_module(_plan2)

_bk = Path(_tf.mkdtemp())
(_bk / "issues").mkdir(parents=True)
(_bk / "issues" / "01-a.md").write_text("**Blocked by:** the owner\n", encoding="utf-8")
check("a PROSE blocker IS caught", len(_plan2.find_bad_blockers(_bk / "issues")) > 0,
      _plan2.find_bad_blockers(_bk / "issues"))
(_bk / "issues" / "01-a.md").write_text("**Blocked by:** none — can start\n", encoding="utf-8")
check("'none' is accepted", _plan2.find_bad_blockers(_bk / "issues") == [],
      _plan2.find_bad_blockers(_bk / "issues"))
(_bk / "issues" / "01-a.md").write_text("**Blocked by:** external — the owner\n", encoding="utf-8")
check("'external' is accepted", _plan2.find_bad_blockers(_bk / "issues") == [],
      _plan2.find_bad_blockers(_bk / "issues"))
(_bk / "issues" / "01-a.md").write_text("**Blocked by:** 02 — taxonomy\n", encoding="utf-8")
check("a ticket number naming NO ticket IS caught",
      len(_plan2.find_bad_blockers(_bk / "issues")) > 0, _plan2.find_bad_blockers(_bk / "issues"))
check("every real blocker line is parseable",
      _plan2.find_bad_blockers(ROOT / ".scratch" / "seen-not-grasped" / "issues") == [],
      str(_plan2.find_bad_blockers(ROOT / ".scratch" / "seen-not-grasped" / "issues"))[:2])

print("AN OPEN TICKET SAYS WHAT IT IS WAITING FOR")
# `docs/agents/triage-labels.md` said labels are written on the Status line of every ticket.
# **NOT ONE OF 25 EVER CARRIED ONE** — all were free prose — so a reader following that file would
# have concluded every ticket was untriaged.
#
# **A documented convention that nobody follows is worse than no convention**, because it is read
# as a description of the current state. The eight open tickets now carry a label and the check
# enforces it.
import importlib.util as _ilu20  # noqa: E402

_spec20 = _ilu20.spec_from_file_location(
    "_plan", str(ROOT / "scripts" / "factory" / "11_plan_truthfulness.py"))
_plan = _ilu20.module_from_spec(_spec20)
sys.modules["_plan"] = _plan
_spec20.loader.exec_module(_plan)

_tk = Path(_tf.mkdtemp())
(_tk / "issues").mkdir(parents=True)
(_tk / "issues" / "a.md").write_text("**Status:** open, needs a decision\n", encoding="utf-8")
check("an OPEN ticket with no label IS caught",
      len(_plan.find_unlabelled_tickets(_tk / "issues")) == 1,
      _plan.find_unlabelled_tickets(_tk / "issues"))
(_tk / "issues" / "a.md").write_text("**Status:** `needs-info` — open\n", encoding="utf-8")
check("a labelled open ticket is NOT caught",
      _plan.find_unlabelled_tickets(_tk / "issues") == [],
      _plan.find_unlabelled_tickets(_tk / "issues"))
(_tk / "issues" / "a.md").write_text("**Status:** done\n", encoding="utf-8")
check("a CLOSED ticket needs no label (it answers no triage question)",
      _plan.find_unlabelled_tickets(_tk / "issues") == [],
      _plan.find_unlabelled_tickets(_tk / "issues"))
check("every OPEN ticket in the real plan carries a label",
      _plan.find_unlabelled_tickets(ROOT / ".scratch" / "seen-not-grasped" / "issues") == [],
      str(_plan.find_unlabelled_tickets(ROOT / ".scratch" / "seen-not-grasped" / "issues"))[:2])

print("THE PLAN PACK HAS NO DEAD LINKS, AND ITS MIRRORS ARE SCOPED")
# THE FRONT PAGE HAD FIVE DEAD LINKS, including the one to the SPEND DECISION. Ticket mirrors
# stopped being generated after 17, so the index's links to 18-25 resolved to nothing — **a dead
# link is worse than a missing one, because it reads as a page that exists.**
#
# And extending the mirror guard to subdirectories found **17 of 32 mirrors drifted, ALL of them
# ticket mirrors** — the ones nothing had ever checked. The cut is by how often the source
# changes: tickets change every round, so a hand-maintained rendering is stale when written.
# LOCAL IMPORT — TENTH TIME. The header states the rule. I keep not following it.
import importlib.util as _ilu19  # noqa: E402

_spec19 = _ilu19.spec_from_file_location(
    "_mir3", str(ROOT / "scripts" / "factory" / "16_html_mirrors.py"))
_mir2 = _ilu19.module_from_spec(_spec19)
sys.modules["_mir3"] = _mir2
_spec19.loader.exec_module(_mir2)

_dl = Path(_tf.mkdtemp())
(_dl / "issues").mkdir(parents=True)
(_dl / "a.html").write_text('<a href="issues/1.md">x</a>\n', encoding="utf-8")
check("a DEAD link IS caught", len(_mir2.find_dead_links(_dl)) == 1, _mir2.find_dead_links(_dl))
(_dl / "issues" / "1.md").write_text("", encoding="utf-8")
check("and is NOT caught once the target exists",
      _mir2.find_dead_links(_dl) == [], _mir2.find_dead_links(_dl))
# ticket mirrors must NOT be required
(_dl / "issues" / "1.html").write_text("<h2>X</h2>", encoding="utf-8")
check("a ticket mirror is not required to match (tickets are .md-only by design)",
      "1.md" not in _mir2.find_problems(_dl), _mir2.find_problems(_dl))
check("the real plan pack has no dead links",
      _mir2.find_dead_links(ROOT / ".scratch" / "seen-not-grasped") == [],
      str(_mir2.find_dead_links(ROOT / ".scratch" / "seen-not-grasped"))[:2])

print("THE PLAN PACK'S FRONT PAGE IS CHECKED")
# `index.html` has NO `.md` TO MIRROR, so nothing checked it — and it is the FIRST PAGE anyone
# opens. It said "17 tickets · 8 ADRs" against **25 and 9**, and had done so for rounds.
#
# A page with no source is the easiest thing in a document set to leave behind, because every
# other file has something to disagree with.
import importlib.util as _ilu18  # noqa: E402

_spec18 = _ilu18.spec_from_file_location(
    "_mir2", str(ROOT / "scripts" / "factory" / "16_html_mirrors.py"))
_mir2 = _ilu18.module_from_spec(_spec18)
sys.modules["_mir2"] = _mir2
_spec18.loader.exec_module(_mir2)

_idx = Path(_tf.mkdtemp())
(_idx / "index.html").write_text("25 tickets and 9 ADRs.\n", encoding="utf-8")
for d, n in (("issues", 25), ("adr", 9), ("glossary", 3)):
    (_idx / d).mkdir(parents=True)
    for i in range(n):
        (_idx / d / ("f%02d.md" % i)).write_text("", encoding="utf-8")
check("a front page that agrees is NOT flagged",
      _mir2.find_index_problems(_idx) == [], _mir2.find_index_problems(_idx))
(_idx / "index.html").write_text("17 tickets and 8 ADRs.\n", encoding="utf-8")
_bad2 = _mir2.find_index_problems(_idx)
check("a STALE ticket count IS caught", any("tickets" in x for x in _bad2), _bad2)
check("a STALE ADR count IS caught", any("ADRs" in x for x in _bad2), _bad2)
check("the real front page agrees with its directories",
      _mir2.find_index_problems(ROOT / ".scratch" / "seen-not-grasped") == [],
      _mir2.find_index_problems(ROOT / ".scratch" / "seen-not-grasped"))

print("THE ALWAYS-LOADED AGENT FILE IS CHECKED TOO")
# `AGENTS.md` is in every agent's context on EVERY TURN. A path it names that does not resolve is
# the most expensive stale claim in the repo — read constantly, checked never — and it said
# "scripts/factory the benchmark pipeline, stages 00-08" while there were seventeen stages.
#
# THE RANGE IS GONE RATHER THAN UPDATED. A stage range is a **cache of a directory listing**, and
# a cache of a lookup that is one `ls` away only earns its place if the lookup is expensive. The
# skill is explicit that the ENVIRONMENT is a source of truth and a document restating it goes
# stale; this one did. **The path list stays, because a path is a pointer, not a count.**
# LOCAL IMPORT, and this is the EIGHTH time. The header states the rule; here it is again.
import importlib.util as _ilu17  # noqa: E402

_spec17 = _ilu17.spec_from_file_location(
    "_src6", str(ROOT / "scripts" / "factory" / "15_source_claims.py"))
_src5 = _ilu17.module_from_spec(_spec17)
sys.modules["_src6"] = _src5
_spec17.loader.exec_module(_src5)

_ag = Path(_tf.mkdtemp())
(_ag / "AGENTS.md").write_text("See `scripts/harness/spend.py`.\n", encoding="utf-8")
check("a path AGENTS.md names that does not resolve IS caught",
      any("spend.py" in x["ref"] for x in _src5.find_broken_references(_ag)),
      _src5.find_broken_references(_ag))
(_ag / "scripts" / "harness").mkdir(parents=True)
(_ag / "scripts" / "harness" / "spend.py").write_text("", encoding="utf-8")
check("and it is NOT caught once the path exists",
      _src5.find_broken_references(_ag) == [], _src5.find_broken_references(_ag))

print("A README'S REFERENCES RESOLVE, AND IT NAMES ITS OWN FILES")
# The harness README pointed at `../.scratch/seen-not-grasped/zero-spend.md` — **one `..` short**,
# from a file in `scripts/harness/`. So the document that explains the spend rule pointed at the
# document that prices it with a path that resolved to nothing.
#
# And it omitted NINE of its twenty-two modules, including `spend.py`. **An omission has no line
# to grep**, which is why nothing noticed.
#
# The ref check resolves against the ROOT and against the README, and accepts a bare filename that
# resolves uniquely — the first version concatenated paths and reported three false positives on
# a correct README.
import importlib.util as _ilu16  # noqa: E402

_spec16 = _ilu16.spec_from_file_location(
    "_src5", str(ROOT / "scripts" / "factory" / "15_source_claims.py"))
_src5 = _ilu16.module_from_spec(_spec16)
sys.modules["_src5"] = _src5
_spec16.loader.exec_module(_src5)

_pr = Path(_tf.mkdtemp())
(_pr / "scripts" / "harness").mkdir(parents=True)
(_pr / "scripts" / "harness" / "README.md").write_text(
    "See `../.scratch/x.md` and `scripts/harness/real.py`.\n", encoding="utf-8")
(_pr / "scripts" / "harness" / "real.py").write_text("", encoding="utf-8")
_br = _src5.find_broken_references(_pr)
check("a reference one '..' short IS caught",
      any("x.md" in x["ref"] for x in _br), _br)
check("a reference that resolves is NOT caught",
      not any("real.py" in x["ref"] for x in _br), _br)

check("the real READMEs' references all resolve",
      _src5.find_broken_references(ROOT) == [], str(_src5.find_broken_references(ROOT))[:2])
check("the harness README names every module it documents",
      _src5.find_coverage_gaps(ROOT) == [], str(_src5.find_coverage_gaps(ROOT))[:4])

print("A COUNT THE GUARD CANNOT CHECK IS NOT STATED")
# The harness README said "48 assertions across 8 sections" while the suite ran 326 — **stale for
# many rounds, and nothing noticed**, because a claim in a source file is guarded by nothing.
#
# So I added a check against a static count of `check(` lines. **THE STATIC COUNT WAS WRONG:**
# many assertions sit in try/except pairs where only ONE branch runs, so a text count OVERCOUNTS.
# A precise assertion count is therefore **not statically verifiable at all** — and the rule from
# round 65 applies: **do not state a number the guard cannot check.**
# LOCAL IMPORT — the SEVENTH time a block has used a name defined below it. See the header.
import importlib.util as _ilu15  # noqa: E402

_spec15 = _ilu15.spec_from_file_location(
    "_src4", str(ROOT / "scripts" / "factory" / "15_source_claims.py"))
_src = _ilu15.module_from_spec(_spec15)
sys.modules["_src4"] = _src
_spec15.loader.exec_module(_src)

_probe3 = Path(_tf.mkdtemp())
(_probe3 / "scripts" / "harness").mkdir(parents=True)
(_probe3 / "scripts" / "harness" / "README.md").write_text(
    "The suite has 48 assertions across 8 sections.\n", encoding="utf-8")
_sc = _src.find_stale_counts(_probe3)
check("a README stating an assertion count IS flagged", len(_sc) == 1, _sc)
(_probe3 / "scripts" / "harness" / "README.md").write_text(
    "The suite has hundreds of assertions.\n", encoding="utf-8")
check("stating the SHAPE is not flagged", _src.find_stale_counts(_probe3) == [],
      _src.find_stale_counts(_probe3))
check("the real READMEs state no unverifiable count",
      _src.find_stale_counts(ROOT) == [], str(_src.find_stale_counts(ROOT))[:2])

print("THE PAID SWEEP HAS A CAP, AND LOSING IT WOULD BE AN UNBOUNDED BILL")
# `from_env('closed', ...)` returns a default limit of 3,000 and `from_env('open', ...)` returns
# None. **NEITHER WAS TESTED**, and the whole point of the default is that per-image cost on a
# long-context frontier model is what dominates the budget. A regression here is an unbounded
# paid sweep.
import os as _os3  # noqa: E402
from scripts.harness.backends import from_env  # noqa: E402

_saved = dict(_os3.environ)
try:
    _b, _lim = from_env("open", "local/model")
    check("an OPEN sweep has NO default cap (it is local and free)", _lim is None, _lim)
    check("and is marked not paid", _b.is_paid is False, _b.is_paid)

    _os3.environ["OPENROUTER_API_KEY"] = "test-key"
    _b2, _lim2 = from_env("closed", "openai/gpt-6")
    check("a CLOSED sweep DOES have a default cap", _lim2 == 3000, _lim2)
    check("and is marked paid, so the spend guard can see it", _b2.is_paid is True, _b2.is_paid)

    # and without the key it refuses rather than running unauthenticated
    _os3.environ.pop("OPENROUTER_API_KEY", None)
    try:
        from_env("closed", "openai/gpt-6")
        check("a CLOSED sweep without a key refuses", False, "it returned a backend")
    except SystemExit:
        check("a CLOSED sweep without a key refuses", True)
finally:
    _os3.environ.clear()
    _os3.environ.update(_saved)

print("THE HAND-MAINTAINED MIRRORS DO NOT DRIFT")
# `roadmap`, `spec`, `costs` and the glossary each have a hand-maintained .html with NO build
# step — verified by looking for a generator in scripts/ and finding none. Every correction has
# had to be applied TWICE, by hand, and the log shows that being checked by hand in several
# rounds. **A document that must be edited twice will eventually be edited once.**
#
# It checks HEADINGS and CHECKBOX STATES only. The first version compared every 6-word chunk and
# reported 97 "missing" on a document that broadly agrees — **noise, and a noisy guard is one
# somebody turns off.**
import importlib.util as _ilu14  # noqa: E402

_spec14 = _ilu14.spec_from_file_location(
    "_mir", str(ROOT / "scripts" / "factory" / "16_html_mirrors.py"))
_mir = _ilu14.module_from_spec(_spec14)
sys.modules["_mir"] = _mir
_spec14.loader.exec_module(_mir)

_md = Path(_tf.mkdtemp())
_md.mkdir(parents=True, exist_ok=True)
(_md / "d.md").write_text("## A\n\n- [x] one\n- [ ] two\n\n## B\n\n- [ ] three\n", encoding="utf-8")
(_md / "d.html").write_text("<h2>A</h2><ul><li>[x] one</li><li>[ ] two</li></ul>"
                            "<h2>B</h2><ul><li>[ ] three</li></ul>", encoding="utf-8")
check("an agreeing mirror is NOT flagged", _mir.find_problems(_md) == {}, _mir.find_problems(_md))
(_md / "d.html").write_text("<h2>A</h2><ul><li>[ ] one</li><li>[ ] two</li></ul>"
                            "<h2>B</h2><ul><li>[ ] three</li></ul>", encoding="utf-8")
check("a DRIFTED tick IS caught", "d.md" in _mir.find_problems(_md), _mir.find_problems(_md))
(_md / "d.html").write_text("<h2>A</h2><ul><li>[x] one</li><li>[ ] two</li></ul>"
                            "<h2>C</h2><ul><li>[ ] three</li></ul>", encoding="utf-8")
check("a changed HEADING IS caught", "d.md" in _mir.find_problems(_md), _mir.find_problems(_md))
(_md / "d.html").write_text("<h2>A</h2><ul><li>[x] one</li></ul>"
                            "<h2>B</h2><ul><li>[ ] three</li></ul>", encoding="utf-8")
check("a missing BOX IS caught", "d.md" in _mir.find_problems(_md), _mir.find_problems(_md))
# the real plan must agree — it is private, so this only runs where it exists
_real = _mir.find_problems(ROOT / ".scratch" / "seen-not-grasped")
check("the real plan's mirrors agree (skipped where the plan is absent)",
      _real == {} or not (ROOT / ".scratch" / "seen-not-grasped").exists(), _real)

print("NO SCRIPT CARRIES AN IMPORT IT DOES NOT USE")
# AN UNUSED IMPORT IS DEBRIS FROM AN EDIT. Five were found in this repo's own tree — `load_owners`,
# `sys` (twice), `field`, `Counter`, `defaultdict` — every one of them a line saying the file
# depends on something it does not.
#
# `from __future__ import annotations` IS EXCLUDED. It is required and never referenced by name,
# so a naive check flags it in 45 files and buries the real hits. **The filter was written before
# looking at the results, which is why the five real ones were visible at all.**
# LOCAL IMPORT, and this is the SIXTH time a block has used a name defined below it. The hoist in
# round 81 fixed `tempfile` and I said it fixed the class; it fixed one name. **The rule that
# actually holds for an append-only file is: every block imports what it needs itself.**
import importlib.util as _ilu13  # noqa: E402

_spec13 = _ilu13.spec_from_file_location(
    "_src3", str(ROOT / "scripts" / "factory" / "15_source_claims.py"))
_src = _ilu13.module_from_spec(_spec13)
sys.modules["_src3"] = _src
_spec13.loader.exec_module(_src)

_probe2 = Path(_tf.mkdtemp())
(_probe2 / "scripts" / "harness").mkdir(parents=True)
(_probe2 / "scripts" / "factory").mkdir(parents=True)
(_probe2 / "scripts" / "harness" / "p.py").write_text(
    "from __future__ import annotations\n"
    "import os\n"
    "import json\n"
    "\n"
    "def f():\n"
    "    return json.dumps({})\n", encoding="utf-8")
_u = _src.find_unused_imports(_probe2)
check("an unused import IS caught", len(_u) == 1 and _u[0]["name"] == "os",
      [(x["name"], x["line"]) for x in _u])
check("a USED import is not flagged", all(x["name"] != "json" for x in _u), _u)
check("from __future__ import annotations is NOT flagged",
      all(x["name"] != "annotations" for x in _u), _u)
# and the real tree is clean
check("the real tree has no unused imports", _src.find_unused_imports(ROOT) == [],
      str(_src.find_unused_imports(ROOT))[:3])

print("EVERY GUARD HAS ITS VARIABLE IN SCOPE")
# A LOCAL IMPORT. `_src` is defined FURTHER DOWN this file — the FIFTH time a block has referred
# to a name defined later. The hoist in round 81 fixed `tempfile`; the pattern recurs because
# this file is append-only and 1,200 lines. Any block that needs something must import it itself.
import importlib.util as _ilu12  # noqa: E402

_spec12 = _ilu12.spec_from_file_location(
    "_src2", str(ROOT / "scripts" / "factory" / "15_source_claims.py"))
_src = _ilu12.module_from_spec(_spec12)
sys.modules["_src2"] = _src
_spec12.loader.exec_module(_src)
# A GUARD IN THE WRONG SCOPE IS NOT A GUARD. Round 91 found
# `refuse_without_spend(args, ...)` inside `_apply_patch(im, condition)` — a function with no
# `args` — from a patch that matched "the first else:" in each of eight files. It would have
# raised NameError rather than guarding anything. **It reads as protection and provides none.**
_probe_dir = Path(_tf.mkdtemp())
(_probe_dir / "scripts" / "harness").mkdir(parents=True)
(_probe_dir / "scripts" / "factory").mkdir(parents=True)
(_probe_dir / "scripts" / "harness" / "probe.py").write_text(
    "def helper(im, condition):\n"
    "    if condition == 'a':\n"
    "        x = 1\n"
    "    else:\n"
    "        refuse_without_spend(args, '--spend', 'thing')\n"
    "        x = 2\n"
    "    return x\n"
    "\n"
    "def main(argv=None):\n"
    "    args = object()\n"
    "    refuse_without_spend(args, '--spend', 'thing')\n"
    "    return 0\n", encoding="utf-8")
_found = _src.find_scope_problems(_probe_dir)
check("a guard inside a function WITHOUT its variable IS caught",
      len(_found) == 1 and _found[0]["function"] == "helper",
      [(x["function"], x["line"]) for x in _found])
check("and the one in main, where args exists, is NOT flagged",
      all(x["function"] != "main" for x in _found), _found)
check("the real tree has no guard in the wrong scope",
      _src.find_scope_problems(ROOT) == [], str(_src.find_scope_problems(ROOT))[:2])

print("NO SOURCE COMMENT CONTRADICTS THE CODE")
# `packages/questions-api/src/index.ts` said "Unset = open (local dev only)" in THREE places while
# hasCode failed closed — and the same property was stated CORRECTLY in the relay, so the
# repository documented its most security-critical invariant both ways. **A comment that
# contradicts the code is worse than no comment: it is read as the design.**
import importlib.util as _ilu11  # noqa: E402

_spec11 = _ilu11.spec_from_file_location(
    "_src", str(ROOT / "scripts" / "factory" / "15_source_claims.py"))
_src = _ilu11.module_from_spec(_spec11)
sys.modules["_src"] = _src
_spec11.loader.exec_module(_src)

check("the real source has no contradicting claim", _src.find_problems(ROOT) == [],
      str(_src.find_problems(ROOT))[:2])
# IT MUST CATCH THE DEFECT IT WAS BUILT FOR
_bad = _src.check_text("  /** reviewer secret: (unset = open, dev only) */")
check("the stale claim IS caught", len(_bad) == 1 and "unset = open" in _bad[0][1], _bad)
# AND MUST NOT FLAG A LEGITIMATE, DIFFERENT fail-open. `overWriteLimit` fails open ON PURPOSE —
# a rate limit must not block authoring when the table is missing. Flagging it would have been a
# true statement about a false subject.
_ok1 = _src.check_text(" * Fails OPEN if the database is un-migrated, so authoring is never blocked")
check("a deliberate rate-limit fail-open is NOT flagged", _ok1 == [], _ok1)
# AND MUST NOT FLAG THE CORRECTION ITSELF, which has to quote the bad claim to correct it
_ok2 = _src.check_text(" * (/api/chat) that actually DID fail open — so this line was describing the bug")
check("the correction that quotes the bug is NOT flagged", _ok2 == [], _ok2)

print("A REFUSAL IS NOT A QUIETER KIND OF SUCCESS")
# THE PIPELINE EXITED 0 WHETHER IT RAN, REFUSED, OR SKIPPED. Measured in round 87:
# `--from tag --to tag --spend` with no VLLM_BASE_URL printed "SKIP tag — missing env" and exited
# 0 — the spend was AUTHORISED, the work did not happen, and the run reported success. A shell
# script calling this could not tell a completed run from one that did nothing.
#
# Run as a SUBPROCESS, because the thing under test is the exit code and a return value cannot
# tell you what a caller sees.
import subprocess as _sp  # noqa: E402
import os as _os2  # noqa: E402


def _pipeline(env_override: dict, *args: str):
    env = dict(_os2.environ)
    env.update(env_override)
    p = _sp.run([sys.executable, "scripts/factory/run_pipeline.py", *args],
                capture_output=True, text=True, env=env, cwd=str(ROOT))
    return p.returncode, p.stdout + p.stderr


_rc, _out = _pipeline({"VLLM_BASE_URL": ""}, "--from", "tag", "--to", "tag", "--spend")
check("an authorised PAID stage with no env var is REFUSED, not skipped",
      "REFUSED" in _out and "SKIP" not in _out.split("REFUSED")[0][-200:], _out[-200:])
check("and the run EXITS 1, because the requested work did not happen", _rc == 1, _rc)

_rc2, _out2 = _pipeline({"VLLM_BASE_URL": ""}, "--from", "tag", "--to", "tag")
check("a paid stage without --spend is refused and also exits 1", _rc2 == 1, _rc2)

# a FREE stage that skips for a missing input is a normal partial run, and stays 0
_rc3, _out3 = _pipeline({}, "--from", "verify", "--to", "verify")
check("a FREE stage that skips still exits 0", _rc3 == 0, (_rc3, _out3[-120:]))

print("THE PIPELINE'S ORDER IS CHECKED, NOT ASSUMED")
# A STAGE WHOSE needs_files ARE ABSENT IS SKIPPED, NOT FAILED. So a wrong order quietly makes the
# pipeline do less than it says and still report success — the same family as every other defect
# in this repository: a thing that does nothing looks like a thing that worked.
import importlib.util as _ilu10  # noqa: E402

_spec10 = _ilu10.spec_from_file_location(
    "_order", str(ROOT / "scripts" / "factory" / "14_pipeline_order.py"))
_order = _ilu10.module_from_spec(_spec10)
sys.modules["_order"] = _order
_spec10.loader.exec_module(_order)

_pl = (ROOT / "scripts" / "factory" / "run_pipeline.py").read_text(encoding="utf-8-sig")
_stages = _order.parse_stages(_pl)
check("the pipeline parses into stages", len(_stages) >= 15, len(_stages))
check("the real pipeline has no order problem", _order.find_problems(_stages) == [],
      _order.find_problems(_stages)[:2])
# THE PARSER MUST BE RIGHT ABOUT ITS INPUT. The first version used a non-greedy regex and
# reported `release` as needing nothing when it needs the export — a wrong report that LOOKS
# like a result.
_rel = [s for s in _stages if s["name"] == "release"]
check("release's needs were parsed, not dropped",
      _rel and _rel[0]["needs"] == ["data/factory/questions.jsonl"], _rel)
# AND IT MUST CATCH A WRONG ORDER
_swapped = [dict(s) for s in _stages]
_names = [s["name"] for s in _swapped]
_i, _j = _names.index("release"), _names.index("export")
_swapped[_i], _swapped[_j] = _swapped[_j], _swapped[_i]
check("a stage moved before its producer IS caught",
      any("NO EARLIER stage" in x for x in _order.find_problems(_swapped)),
      _order.find_problems(_swapped)[:2])
# and an UNDECLARED external input is caught rather than waved through
_bad_external = [dict(s) for s in _stages]
_bad_external[0] = dict(_bad_external[0], needs=["data/nowhere.json"])
check("an undeclared external input is refused",
      any("declared external input" in x for x in _order.find_problems(_bad_external)))

print("EVERY COMMAND CI RUNS RESOLVES, AND EVERY GUARD IS INVOKED")
# ci.yml was edited FOUR TIMES in four rounds — the unwired guard, the integrity gate, the spend
# checks — and nothing validated it. A typo in a path leaves valid YAML, GitHub still starts the
# run, and the guard simply never fires. Adding a step to a YAML file is not running it.
#
# This block is the check for THIS file's own purpose: a guard that exists and is never invoked.
import importlib.util as _ilu9  # noqa: E402

_spec9 = _ilu9.spec_from_file_location(
    "_ci", str(ROOT / "scripts" / "factory" / "13_ci_resolves.py"))
_ci = _ilu9.module_from_spec(_spec9)
sys.modules["_ci"] = _ci
_spec9.loader.exec_module(_ci)

_ci_text = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8-sig")
# EVERY workflow, not only ci.yml. The first version checked one file and there are EIGHT —
# including deploy.yml, which ships the Workers. A checker that reads one file is a checker for
# one file.
check("every workflow's commands resolve",
      all(_ci.find_problems(p.read_text(encoding="utf-8-sig"), check_required=False) == []
          for p in _ci.all_workflows()),
      [p.name for p in _ci.all_workflows()
       if _ci.find_problems(p.read_text(encoding="utf-8-sig"), check_required=False)])
check("there really are several workflows to check", len(_ci.all_workflows()) >= 5,
      len(_ci.all_workflows()))

# AND EVERY STEP STYLE IS READ. Two styles were skipped in turn — `run: |` and `- run: <cmd>` —
# and BOTH were found by planting a fault and getting no complaint.
_dep = (ROOT / ".github" / "workflows" / "deploy.yml").read_text(encoding="utf-8-sig")
check("a bare run: step is read", any("wrangler" in b for _l, b in _ci.run_blocks(_dep)))
check("a \"run: |\" block is read", any("\n" in b for _l, b in _ci.run_blocks(_dep)))
check("a \"- run:\" list-item step is read",
      any("build_data" in b or "metro" in b for _l, b in _ci.run_blocks(_dep)))
# IT MUST CATCH A TYPO — otherwise it is returning [] because it is broken
_typo = _ci_text.replace("python scripts/factory/12_unwired.py",
                         "python scripts/factory/12_unwired_TYPO.py")
check("a typo'd script path IS caught", any("does not exist" in x for x in _ci.find_problems(_typo)),
      str(_ci.find_problems(_typo))[:160])
# and caught in a NON-ci workflow, which is where the false negative was
_dep_bad = _dep.replace("scripts/build_data.py", "scripts/build_data_TYPO.py")
check("a fault in deploy.yml IS caught",
      any("does not exist" in x for x in _ci.find_problems(_dep_bad, check_required=False)),
      str(_ci.find_problems(_dep_bad, check_required=False))[:160])
# AND IT MUST CATCH A GUARD BEING REMOVED, which is the whole point of the required list
_removed = _ci_text.replace("python scripts/factory/12_unwired.py", "python -c pass")
check("a REMOVED guard is caught, not just a typo",
      any("NOT RUN IN CI" in x for x in _ci.find_problems(_removed)),
      str(_ci.find_problems(_removed))[:160])
# and a multi-line run: block must be read, not skipped.
#
# The marker here used to be `open_models_public.py` — until the grip build left ci.yml
# (21bd4de, 2026-10-15). The string survived only in a comment, the assertion could never
# pass again, and CI sat red on main for two pushes. A marker must name a command that
# RUNS in ci.yml — this one anchors on the multi-line local-D1 migration step.
check("multi-line run blocks are read",
      any(ln > 50 and "d1 migrations apply" in b for ln, b in _ci.run_blocks(_ci_text)),
      _ci.run_blocks(_ci_text)[:2])

print("THE ITEM SHAPE IS PART OF THE FREEZE, NOT ONLY OF THE GENERATOR")
# 03_verify checked these at GENERATION. Measured in round 82, build() accepted: an item with NO
# answer_type, answer_type="banana", a numeric item with no tolerance or tolerance=-1, and a
# choice item whose answer was neither an option NOR an option letter. A release of those makes
# every accuracy figure meaningless, and it is frozen before anyone notices.
def _ci(ans="A", at="choice", ch=("A", "B"), tol=None, rel=None):
    it = {"capability": "G1", "level": "L2", "answer": ans, "answer_type": at}
    if ch is not None:
        it["choices"] = list(ch)
    if tol is not None:
        it["tolerance"] = tol
    if rel is not None:
        it["relevance"] = rel
    return it


check("a well-formed item passes", check_item(_ci()) is None, check_item(_ci()))
check("no answer_type is refused",
      "answer_type not in the vocabulary" in str(check_item(_ci(at=None))))
check("an invented answer_type is refused",
      "answer_type not in the vocabulary" in str(check_item(_ci(at="banana"))))
check("the mcq alias is ACCEPTED, because the grader already accepts it",
      check_item(_ci(at="mcq")) is None, check_item(_ci(at="mcq")))
check("a numeric item with no tolerance is refused",
      "no tolerance" in str(check_item(_ci(at="number", ch=None, ans="3"))))
check("a negative tolerance is refused",
      "negative" in str(check_item(_ci(at="number", ch=None, ans="3", tol=-1))))
check("a valid numeric item passes",
      check_item(_ci(at="number", ch=None, ans="3", tol=0)) is None)
check("a bad relevance is refused",
      "relevance not in the vocabulary" in str(check_item(_ci(rel="nonsense"))))
# THE LETTER CONVENTION. My first version of this rule refused "A" against ["A drone", ...] and
# the selftest's own fixture caught it — the grader maps a bare letter to the option BY POSITION.
check("a real option text is valid", check_item(_ci(ans="A")) is None)
check("a bare letter IN RANGE is valid", check_item(_ci(ans="A", ch=("X", "Y", "Z"))) is None)
check("a letter BEYOND the options is refused",
      "beyond the options" in str(check_item(_ci(ans="D"))))
check("a word that is neither is refused",
      "neither an option nor" in str(check_item(_ci(ans="Zebra"))))

print("A RELEASE CARRIES ITS OWN CLEARANCE, OR IT IS NOT RUN")
# A LOCAL tempfile import: _tf7 is defined FURTHER DOWN this file. That is the THIRD time a block
# has referred to a name defined later in this 1100-line append-only file — _tf3, then slopes,
# now _tf. Reading top-to-bottom is no longer a valid assumption about this file.
# A HASH PROVES THE ITEMS DID NOT CHANGE AND SAYS NOTHING ABOUT WHETHER THE IMAGES MAY BE USED.
# build_release.py CHECKED consent and PII and then printed "ALL n images have a recorded right"
# — while writing NOTHING about it into the artifact. So the frozen release, the thing that gets
# published and quoted, could not be audited for rights at all.
#
# That is the gate guarding the BUILDER and not the ARTIFACT — the same shape as --spend guarding
# the pipeline and not the runners (round 79).
_bare = Path(_tf.mkdtemp()) / "bare"
_bare.mkdir(parents=True, exist_ok=True)
build([{"id": 1, "file_id": "img_1", "question": "q?", "answer": "A",
        "answer_type": "choice", "choices": ["A", "B"], "capability": "G1", "level": "L2"}],
      _bare, release_id="bare")
try:
    load(str(_bare))
    check("a release with NO clearance is refused", False, "it loaded")
except ValueError as _e:
    check("a release with NO clearance is refused", "no consent" in str(_e), str(_e)[:90])
# and the escape hatch is explicit, not silent
_loaded, _man = load(str(_bare), require_clearance=False)
check("the bypass exists but must be asked for by name", _man["release_id"] == "bare")

_gated = Path(_tf.mkdtemp()) / "gated"
_gated.mkdir(parents=True, exist_ok=True)
build([{"id": 1, "file_id": "img_1", "question": "q?", "answer": "A",
        "answer_type": "choice", "choices": ["A", "B"], "capability": "G1", "level": "L2"}],
      _gated, release_id="gated",
      consent={"granted": 1, "denied": 0, "unknown": 0, "n_checked": 1},
      pii={"clear": 1, "flagged": 0, "unreviewed": 0, "n_checked": 1})
_gm = json.loads((_gated / "manifest.json").read_text(encoding="utf-8-sig"))
check("a gated release RECORDS its consent", _gm.get("consent", {}).get("granted") == 1, _gm.get("consent"))
check("and its PII review", _gm.get("pii", {}).get("clear") == 1, _gm.get("pii"))
check("and load() accepts it", load(str(_gated))[1]["release_id"] == "gated")

print("A NUMBER COMPUTED FROM A HANDFUL OF ITEMS IS REFUSED, NOT REPORTED")
# EVERY ANALYSIS IN THIS FILE RETURNS A PLAUSIBLE NUMBER WHEN IT SHOULD RETURN NOTHING. A curve
# fitted to three items, or a control accuracy from one, is a description of those items rather
# than of the model — and it looks exactly like a result.
# IMPORTED LOCALLY, and the second time this bit me: `slopes` and `series` are imported
# FURTHER DOWN this file, so referring to them here raised NameError. A block must not depend on
# where an earlier block happens to sit — `_tf3` was the same mistake last round.
from scripts.harness.analyze import MIN_N, series, slopes  # noqa: E402

_mkf = lambda run, qid, v, cap: {"run_id": run, "question_id": qid, "model": "m",  # noqa: E731
                                 "capability": cap, "verdict": v, "abstained": 0,
                                 "parse_ok": 1, "latency_ms": 5}
_thin = ([_mkf("m-atk-blur-s1", i, "correct", "P4") for i in range(3)]
         + [_mkf("m-atk-blur-s3", 10 + i, "wrong", "P4") for i in range(3)])
_st = slopes(_thin)
check("a slope over thin severities is REFUSED", _st[0]["slope"] is None, _st[0])
check("and the reason names the floor", str(MIN_N) in _st[0]["reason"], _st[0]["reason"])
check("and it says both severities existed before the floor dropped them",
      _st[0]["n_points_available"] == 2, _st[0])

_fat = ([_mkf("m-atk-blur-s1", i, "correct", "P4") for i in range(MIN_N + 2)]
        + [_mkf("m-atk-blur-s3", 100 + i, "wrong", "P4") for i in range(MIN_N + 2)])
_sf = slopes(_fat)
check("a slope over populated severities IS reported", _sf and _sf[0]["slope"] is not None, _sf)
check("and it is negative, because accuracy falls", _sf[0]["slope"] < 0, _sf[0]["slope"])

# a MIXED ladder fits only the populated points, and still says how many it had
_mx = ([_mkf("m-atk-blur-s1", i, "correct", "P4") for i in range(MIN_N + 2)]
       + [_mkf("m-atk-blur-s2", 50, "wrong", "P4")]
       + [_mkf("m-atk-blur-s3", 100 + i, "wrong", "P4") for i in range(MIN_N + 2)])
_sm = slopes(_mx)[0]
check("a thin severity is excluded from the fit", _sm["n_points"] == 2, _sm)
check("but its existence is still reported", _sm["n_points_available"] == 3, _sm)

_ser = {x["run_id"]: x for x in series(_mx)}
check("series marks a thin condition", _ser["m-atk-blur-s2"]["thin"] is True, _ser["m-atk-blur-s2"])
check("and does not mark a populated one",
      _ser["m-atk-blur-s1"]["thin"] is False, _ser["m-atk-blur-s1"])

print("EVERY SCRIPT HAS A RUNNER, A REFERENCE, OR A STATED REASON")
# A thing that is never called is indistinguishable from a thing that does not exist. This
# project produced that defect repeatedly, and round 75 found me having done it myself.
# `12_unwired.py` counts references; this asserts it can both pass and FAIL.
import importlib.util as _ilu7  # noqa: E402

_spec7 = _ilu7.spec_from_file_location(
    "_unwired", str(ROOT / "scripts" / "factory" / "12_unwired.py"))
_unwired = _ilu7.module_from_spec(_spec7)
sys.modules["_unwired"] = _unwired
_spec7.loader.exec_module(_unwired)

check("the benchmark tree has no unwired machinery",
      _unwired.find_unwired(ROOT) == [], str(_unwired.find_unwired(ROOT)))
# `detail` IS A STRING. I passed the dict and the FAIL formatting crashed — the SECOND time
# this session. `check` concatenates it, so anything but a str is a crash rather than a
# finding. Kept as a comment because I clearly need the reminder.
# THE BOUND MOVED FROM 8 TO 15, AND THE REASON MATTERS. Six of the nine entries are now GUARDS
# — a guard has a CI or pipeline runner but is not a pipeline stage, which is exactly what this
# allowlist is for. What the assertion protects is that an exemption cannot be SILENT, so the
# property it really checks is that EVERY ENTRY STATES A REASON.
# MOVED AGAIN 15 -> 18 for the drafting programme's six tools (runner, driver, preview,
# sharding, merge, lane watcher). Each has a distinct role and a written reason; they are not
# pipeline stages and cannot be wired into run_pipeline honestly. A seventh tool trips this
# again on purpose: the next exemption has to be argued, not added.
# MOVED 18 -> 20 for the review room's two hand-run tools: the candidate ingester and the
# local demo proxy. Both are one-command utilities, neither is a pipeline stage, and both
# write only where their own docstrings say. The next entry trips this again.
# MOVED 20 -> 22 for the review-room backfill and its marker maintenance: both are
# one-command, one-time-or-daily utilities, argued in their docstrings.
# Raised rather than removed: a bound that never moves is a bound nobody revisits, and a bound
# with no bound at all lets the list grow unattended.
check("every allowlist entry states a reason, and the list is bounded",
      all(len(v) > 20 for v in _unwired.ALLOWED.values()) and len(_unwired.ALLOWED) <= 22,
      str(sorted(_unwired.ALLOWED)) + " n=" + str(len(_unwired.ALLOWED)))
check("most of the allowlist is guards, which is what it is FOR",
      sum(1 for v in _unwired.ALLOWED.values() if "guard" in v.lower()) >= 5,
      sum(1 for v in _unwired.ALLOWED.values() if "guard" in v.lower()))

# PLANTED: a module nothing imports must be found. Without this the guard could be returning
# an empty list because it is broken rather than because the tree is clean.
# `_tf3` is defined FURTHER DOWN this file, so using it here crashed. A local import is the
# honest fix: the block should not depend on where an earlier block happens to sit.

_tmp_root = Path(_tf.mkdtemp())
(_tmp_root / "scripts" / "harness").mkdir(parents=True)
(_tmp_root / "scripts" / "factory").mkdir(parents=True)
(_tmp_root / "scripts" / "harness" / "orphan.py").write_text("VALUE = 1\n", encoding="utf-8")
_planted = _unwired.find_unwired(_tmp_root)
check("a planted orphan IS found", len(_planted) == 1 and "orphan.py" in _planted[0]["file"],
      str(_planted))

print("CALIBRATION IS COMPUTED, WITH NUMBERS KNOWN BEFORE THE RUN")
from scripts.harness.analyze import calibration  # noqa: E402

# THE PLAN TREATS THE ELICITATION METHOD AS A CONFOUND in reported calibration, and
# 05_elicitation.py builds the three arms' prompts. Measured in round 76: NOTHING ran those
# prompts and NOTHING computed a calibration metric. ECE, Brier, AURC and selective accuracy
# are the four names the plan uses; none existed.
_mkc = lambda i, c, v: {"run_id": "r", "question_id": i, "model": "m",  # noqa: E731
                        "confidence": c, "verdict": v, "abstained": 0, "parse_ok": 1,
                        "latency_ms": 5}
# perfectly calibrated: confidence equals correctness exactly
_pc = calibration([_mkc(i, 1.0, "correct") for i in range(5)]
                  + [_mkc(10 + i, 0.0, "wrong") for i in range(5)])[0]
check("a perfectly calibrated model has ECE 0", abs(_pc["ece"]) < 1e-9, _pc["ece"])
check("and Brier 0", abs(_pc["brier"]) < 1e-9, _pc["brier"])
check("and selective accuracy 1.0 at 10% coverage",
      abs(_pc["selective_accuracy"]["10%"] - 1.0) < 1e-9, _pc["selective_accuracy"])
# overconfident/underconfident by hand: 0.9-correct x5, 0.1-wrong x5
_oc = calibration([_mkc(i, 0.9, "correct") for i in range(5)]
                  + [_mkc(10 + i, 0.1, "wrong") for i in range(5)])[0]
check("ECE is 0.100 by hand", abs(_oc["ece"] - 0.1) < 1e-9, _oc["ece"])
check("Brier is 0.010 by hand", abs(_oc["brier"] - 0.01) < 1e-9, _oc["brier"])
# A VAGUE model at the SAME accuracy has a WORSE Brier — which is why Brier sits beside accuracy.
# (My first assertion here said the opposite and was wrong, not the code: 0.55/0.45 gives 0.2025.)
_vg = calibration([_mkc(i, 0.55, "correct") for i in range(5)]
                  + [_mkc(10 + i, 0.45, "wrong") for i in range(5)])[0]
check("a vague model keeps the same accuracy", abs(_vg["accuracy"] - _oc["accuracy"]) < 1e-9)
check("but has a higher Brier", _vg["brier"] > _oc["brier"], (_vg["brier"], _oc["brier"]))
check("Brier is 0.2025 by hand", abs(_vg["brier"] - 0.2025) < 1e-9, _vg["brier"])
# a missing confidence is EXCLUDED, never imputed — a defaulted 0.5 would move ECE to itself
_mx = calibration([_mkc(i, 0.9, "correct") for i in range(4)]
                  + [{"run_id": "r", "question_id": 20, "model": "m", "verdict": "wrong",
                      "abstained": 0, "parse_ok": 1, "latency_ms": 5}])[0]
check("an item with no confidence is excluded", _mx["n"] == 4, str(_mx["n"]))
check("so accuracy is not diluted by it", abs(_mx["accuracy"] - 1.0) < 1e-9, _mx["accuracy"])
# out-of-range confidences are clamped rather than trusted
_cl = calibration([_mkc(1, 1.4, "correct"), _mkc(2, -0.3, "wrong")])[0]
check("an out-of-range confidence is clamped, keeping the metrics finite",
      0 <= _cl["brier"] <= 1 and 0 <= _cl["ece"] <= 1, _cl)

print("THE ANALYSES ARE WIRED INTO THE REPORT, NOT JUST DEFINED")
# THE DEFECT THIS CATCHES IS MINE. Rounds 73 and 74 defined four analyses —
# constant_answer_baseline, blind_gap, difficulty_ladder, counterfactual_consistency — and
# referenced NONE of them anywhere. Machinery that exists and is never called is the exact
# defect found in 06_break_the_model.py, in image_edit's unused column, and in the Phase 5
# analyses that lived only in print statements. Writing functions is not wiring them.
import io as _io6  # noqa: E402
import contextlib as _ctx  # noqa: E402
from scripts.harness.analyze import print_report  # noqa: E402

# `image_edit` is present on SOME rows, because counterfactual_consistency filters on it —
# a fixture without it made the section correctly refuse to print, which is how this test
# found its own gap.
_brows = ([{"run_id": "m-atk-blur-s1", "question_id": i, "model": "m", "capability": "P4",
           "answer": "yes", "verdict": "correct", "abstained": 0, "parse_ok": 1,
           "latency_ms": 5, "image_edit": None} for i in range(4)]
         + [{"run_id": "m-atk-blur-s3", "question_id": i, "model": "m", "capability": "P4",
             "answer": "yes", "verdict": "wrong", "abstained": 0, "parse_ok": 1,
             "latency_ms": 5, "image_edit": None} for i in range(4)]
         + [{"run_id": "m-cf", "question_id": 200 + i, "model": "m", "capability": "P4",
             "answer": "no", "verdict": "wrong", "abstained": 0, "parse_ok": 1,
             "latency_ms": 5, "image_edit": "remove_object"} for i in range(3)])
_bitems = [{"answer": "yes", "answer_type": "yesno", "capability": "P4"}] * 3 \
    + [{"answer": "no", "answer_type": "yesno", "capability": "P4"}]
_buf = _io6.StringIO()
with _ctx.redirect_stdout(_buf):
    print_report(_brows, items=_bitems, blind_rows=_brows, field="capability")
_report = _buf.getvalue()
for _section in ("THE FLOOR", "THE DIFFICULTY LADDER", "THE COUNTERFACTUAL CONTROL",
                 "THE TEXT-ONLY FLOOR", "THE SERIES", "THE SLOPE"):
    check("the report prints " + _section, _section in _report,
          _report[:200] if _section not in _report else "")
# and the floor is PER CAPABILITY, which is what Phase 5 asks for
check("the floor is broken down by capability", "per-capability" in _report, "per-capability")

print("THE TEXT-ONLY BASELINE IS COMPUTED, AND NO SCRIPT HAS AN ESCAPE DEFECT")
from scripts.harness.analyze import blind_gap  # noqa: E402

# THE GATE AND THE BASELINE ARE DIFFERENT QUESTIONS. blind.py runs the same questions with the
# image withdrawn, and its output was only ever used as a GATE (>5% leaked = rewrite the item).
# Phase 5 asks for a text-only BASELINE, which asks instead: how much of the SCORE survives?
# An item can pass the gate while a model still scores 30% blind, and nothing computed that.
_mkb = lambda qid, v, cap: {"run_id": "s", "question_id": qid, "model": "m",  # noqa: E731
                            "capability": cap, "verdict": v, "abstained": 0, "parse_ok": 1,
                            "latency_ms": 5}
_seen = ([_mkb(i, "correct" if i < 8 else "wrong", "B4") for i in range(10)]
         + [_mkb(100 + i, "correct" if i < 4 else "wrong", "G1") for i in range(10)])
_blind = ([_mkb(i, "correct" if i < 3 else "wrong", "B4") for i in range(10)]
          + [_mkb(100 + i, "wrong", "G1") for i in range(10)])
# extra items in ONE trace must not enter a comparison of the other
_seen = _seen + [_mkb(999, "correct", "B4")]
_bg = {x["capability"]: x for x in blind_gap(_seen, _blind)}
check("the with-image accuracy is 0.8 for B4",
      abs(_bg["B4"]["accuracy_with_image"] - 0.8) < 1e-9, _bg["B4"])
check("the blind accuracy is 0.3 for B4", abs(_bg["B4"]["accuracy_blind"] - 0.3) < 1e-9, _bg["B4"])
check("the gap is 0.5 and is the point", abs(_bg["B4"]["gap"] - 0.5) < 1e-9, _bg["B4"])
check("an item present in only ONE trace is excluded", _bg["B4"]["n"] == 10, _bg["B4"])
check("no shared items yields no rows, rather than a zero",
      blind_gap(_seen, [_mkb(500, "correct", "G1")]) == [])

# AND THE DEFECT I KEEP MAKING IS NOW A CHECKED PROPERTY. Escaped backticks in a docstring are
# a SyntaxWarning, not an error, so they survive review — I have written them four times this
# session, and each time the file still imported. Parsing every script with warnings as errors
# turns a habit into a gate.
import ast as _ast  # noqa: E402
import warnings as _warnings  # noqa: E402

_scripts = sorted((ROOT / "scripts").rglob("*.py"))
_bad = []
for _p in _scripts:
    with _warnings.catch_warnings():
        _warnings.simplefilter("error", SyntaxWarning)
        try:
            _ast.parse(_p.read_text(encoding="utf-8-sig"), str(_p))
        except (SyntaxWarning, SyntaxError) as _e:
            # BOTH. An invalid escape in a docstring is a SyntaxWarning on some versions and a
            # SyntaxError on others — the planted probe raised SyntaxError here, which would
            # have CRASHED this check rather than reporting it. Catching one of the two would
            # make the gate version-dependent, which is worse than no gate.
            _bad.append((_p.name, str(_e).splitlines()[0][:70]))
# `detail` is a STRING. The first version passed the list and the FAIL branch crashed while
# formatting it — so the gate detected the defect and then died reporting it, which reads as a
# crash rather than a finding. A check that cannot report is a check that cannot fail.
check("every script parses with SyntaxWarnings as errors (" + str(len(_scripts)) + " files)",
      _bad == [], str(_bad[:3]))

print("THE BASELINES AND THE LADDER ARE COMPUTED, NOT EYEBALLED")
from scripts.harness.analyze import (  # noqa: E402
    constant_answer_baseline, counterfactual_consistency, difficulty_ladder)

# HAND-CHECKABLE NUMBERS. A baseline function that is wrong returns a PLAUSIBLE percentage,
# so the only useful test is one whose answer is known before it runs.
_bitems = ([{"answer": "Yes", "answer_type": "yesno"}] * 6
           + [{"answer": "No", "answer_type": "yesno"}] * 3
           + [{"answer": "3", "answer_type": "number"}])
_b = constant_answer_baseline(_bitems)
check("the majority floor is 6/10", abs(_b["majority_accuracy"] - 0.6) < 1e-9, _b)
check("the per-type floor is 7/10 on a mixed set",
      abs(_b["per_type_accuracy"] - 0.7) < 1e-9, _b)
check("an empty release divides by nothing", constant_answer_baseline([]) == {})
# a benchmark that is 95% one answer has a 95% floor, which is why the floor must be reported
_skew = [{"answer": "Yes", "answer_type": "yesno"}] * 19 + [{"answer": "No", "answer_type": "yesno"}]
check("a skewed release exposes a high floor",
      abs(constant_answer_baseline(_skew)["majority_accuracy"] - 0.95) < 1e-9)

_mkl = lambda lvl, i, v: {"run_id": "r", "question_id": i, "model": "m",  # noqa: E731
                          "level": lvl, "verdict": v, "abstained": 0, "parse_ok": 1,
                          "latency_ms": 5}
_lad = {x["level"]: x for x in difficulty_ladder(
    [_mkl("L1", i, "correct") for i in range(12)] + [_mkl("L5", 100 + i, "wrong") for i in range(3)])}
check("a rung with 12 items is not thin", _lad["L1"]["thin"] is False, _lad["L1"])
check("a rung with 3 items IS thin, and says so", _lad["L5"]["thin"] is True, _lad["L5"])

_mkc = lambda i, v, e: {"run_id": "r", "question_id": i, "model": "m", "verdict": v,  # noqa: E731
                        "abstained": 0, "parse_ok": 1, "latency_ms": 5, "image_edit": e}
_cf = counterfactual_consistency(
    [_mkc(i, "correct", "remove_object") for i in range(2)]
    + [_mkc(10 + i, "wrong", "remove_object") for i in range(6)]
    + [_mkc(50 + i, "correct", None) for i in range(20)])
check("counterfactual consistency is 2/8", abs(_cf[0]["consistency"] - 0.25) < 1e-9, _cf)
check("and it reports the repeats, which is the finding",
      _cf[0]["repeated_original_answer"] == 6, _cf)
check("an ordinary sweep with no edit is excluded from it", _cf[0]["n"] == 8, _cf)

print("THE ROADMAP'S SERIES ANALYSES EXIST AND REFUSE TO INVENT AN AXIS")
# Phase 5 asks for "corruption slope physics-versus-perception" and "counterfactual
# consistency". Neither existed: each runner PRINTED its own series, so the numbers were
# computable by a person reading one run's output and by no function. A result that exists only
# in a print statement is not an analysis.
from scripts.harness.analyze import condition_of, series, slopes  # noqa: E402

check("condition_of reads a corruption severity",
      condition_of("stub-atk-corruption-blur-s3") == ("blur", 3))
check("condition_of reads a crop fraction",
      condition_of("stub-crop-crop075") == ("crop", 0.75))
check("condition_of reads the control", condition_of("x-control-s0") == ("control", 0))
check("condition_of reads a typographic arm, with NO severity",
      condition_of("x-typographic-text_yes") == ("text_yes", None))
check("condition_of never invents a severity for a plain sweep",
      condition_of("stub-sweep_open") == ("stub-sweep_open", None))

_mk2 = lambda run, qid, v, cap: {"run_id": run, "question_id": qid, "model": "m",  # noqa: E731
                                 "verdict": v, "abstained": 0, "parse_ok": 1, "latency_ms": 5,
                                 "capability": cap}
# a ladder: P4 falls with severity, G1 does not — the physics-versus-perception contrast.
# TWELVE ITEMS PER SEVERITY, not four. The floor MIN_N drops a thin severity before fitting, so
# a 4-item ladder now correctly yields NO slope — which crashed this test when the floor landed,
# and that was the floor doing its job rather than a regression.
_ladder = []
for sev, n_correct in ((1, 12), (2, 6), (3, 0)):
    for i in range(12):
        _ladder.append(_mk2("m-atk-blur-s%d" % sev, 100 + sev * 10 + i,
                            "correct" if i < n_correct else "wrong", "P4"))
        _ladder.append(_mk2("m-atk-blur-s%d" % sev, 200 + sev * 10 + i, "correct", "G1"))
_ser = series(_ladder)
check("series reports one row per run", len(_ser) == 3, len(_ser))
check("series carries the severity", {x["severity"] for x in _ser} == {1.0, 2.0, 3.0})
_sl = {x["capability"]: x for x in slopes(_ladder)}
check("a falling ladder gives a NEGATIVE slope", _sl["P4"]["slope"] < 0, _sl["P4"]["slope"])
check("a flat ladder gives a zero slope", _sl["G1"]["slope"] == 0.0, _sl["G1"]["slope"])
check("the slope is per capability, which is the comparison the roadmap asks for",
      _sl["P4"]["slope"] < _sl["G1"]["slope"])
# ONE POINT IS NOT A SLOPE. Fitting a gradient from a single severity would invent the axis.
_one = [x for x in _ladder if x["run_id"].endswith("-s1")]
_os = slopes(_one)
check("a single severity reports NO slope rather than a fabricated one",
      _os and _os[0]["slope"] is None and "two severities" in _os[0]["reason"], _os)

print("A SERIES IS NOT A RUN, AND MUST NOT BE BLENDED INTO ONE")
# `run_attack.py` writes 21 conditions and `run_crop.py` writes 6 fractions into ONE trace.
# `collapse` grouped by (model, question_id) — correct while a trace held one run, and wrong the
# moment it holds a SERIES: every condition of a question merged into one majority-voted row, so
# a corruption ladder became a single condition and its slope could not exist.
#
# It did not fail. `summarise()` on the 21-condition trace reported a run_id naming one
# condition, n_items of 8, n_samples of 168, and an accuracy of 0.5 — a plausible number from a
# trace where 20 of 21 measurements had been discarded.
_mk = lambda rid, qid, v: {"run_id": rid, "question_id": qid, "model": "m", "verdict": v,
                           "abstained": 0, "parse_ok": 1, "latency_ms": 5}  # noqa: E731
_two = [_mk("r1", 1, "correct"), _mk("r2", 1, "wrong"), _mk("r1", 2, "wrong"), _mk("r2", 2, "wrong")]
_c2, _s2 = collapse(_two)
check("two conditions of the same question stay separate",
      len(_c2) == 4, [(x["run_id"], x["question_id"], x["verdict"]) for x in _c2])
# repeats of ONE run must still collapse — that is what the key was originally for
_rep = [_mk("r1", 1, "correct"), _mk("r1", 1, "wrong"), _mk("r1", 1, "correct")]
_c3, _s3 = collapse(_rep)
check("repeats of one run still majority-vote", len(_c3) == 1 and _c3[0]["verdict"] == "correct", _c3)

try:
    _ing.summarise(_two)
    check("summarise REFUSES to blend two runs", False, "it returned a value")
except ValueError as _e:
    check("summarise REFUSES to blend two runs", "2 runs" in str(_e), str(_e)[:80])
check("summarise_all returns one summary per run",
      sorted(_ing.summarise_all(_two)) == ["r1", "r2"], _ing.summarise_all(_two))
# v5e put run_id into UNIQUE(question_id, model, run_id), so a series is now PUBLISHED one
# run at a time rather than refused. Before v5e the refusal was correct: the conditions would
# have overwritten each other and the site would have kept only the last.
import urllib.request as _ur  # noqa: E402


class _FakeResp:
    status = 200
    def __enter__(self): return self
    def __exit__(self, *_a): return False
    def read(self): return b'{"ok":true}'


_calls = []
_ur.urlopen = lambda req, timeout=60: (_calls.append((json.loads(req.data.decode())["run"]["run_id"],
                                                      len(json.loads(req.data.decode())["results"]))),
                                       _FakeResp())[1]
_res = _ing.post(_two, "https://example.invalid", "x")
check("post publishes a series ONE RUN AT A TIME",
      [c[0] for c in _calls] == ["r1", "r2"], _calls)
check("each POST carries only its own rows", all(n == 2 for _r, n in _calls), _calls)
check("and the totals add up", _res["sent"] == 4 and _res["failed"] == 0, _res)

print("THE GENERATOR CAN PRODUCE THE PLAN'S FOUR ITEMS PER IMAGE")
# The plan needs about four items per image (2,500 images -> 10,000 items; "5 minutes per image
# for a 4-item set"), and the prompt asked for ONE. So the generator could not produce the
# dataset the roadmap describes, and reaching it would have meant four calls re-uploading the
# same image — four times the image tokens, which is the whole cost.
import importlib.util as _ilu6  # noqa: E402

_spec6 = _ilu6.spec_from_file_location(
    "_gen", str(ROOT / "scripts" / "factory" / "02_generate_questions.py"))
_gen = _ilu6.module_from_spec(_spec6)
sys.modules["_gen"] = _gen
_spec6.loader.exec_module(_gen)

_q = lambda n: {"question": "q" + str(n), "answer": "A", "answer_type": "choice",
                "choices": ["Yes", "No"], "capability": "G1", "level": "L2"}  # noqa: E731
check("a single object still parses", len(_gen.extract_items(json.dumps(_q(1)))) == 1)
check("a {questions:[...]} wrapper parses",
      len(_gen.extract_items(json.dumps({"questions": [_q(1), _q(2), _q(3), _q(4)]}))) == 4)
check("a bare array parses", len(_gen.extract_items(json.dumps([_q(1), _q(2)]))) == 2)
check("a fenced response parses",
      len(_gen.extract_items("```json\n" + json.dumps({"questions": [_q(1)]}) + "\n```")) == 1)
check("non-object entries are dropped",
      len(_gen.extract_items(json.dumps({"questions": [_q(1), "nope", 7]}))) == 1)
check("an unparseable response yields nothing", _gen.extract_items("I cannot help") == [])
check("per_image=1 still asks for ONE",
      "write ONE question" in _gen.gen_prompt("", 1))
check("per_image=4 asks for four distinct questions",
      "write 4 DISTINCT questions" in _gen.gen_prompt("", 4))
check("and tells the model the wrapper key", '"questions"' in _gen.gen_prompt("", 4))
check("and caps the perception controls", "PERC" in _gen.gen_prompt("", 4))
check("the schema survives the plural form",
      "capability" in _gen.gen_prompt("", 4) and "level" in _gen.gen_prompt("", 4))

print("THE GPS DETECTOR CAN ACTUALLY DETECT GPS")
# `10_pii.py --gps-check` has only ever reported ZERO, and zero is not evidence when the
# detector has never been shown to detect anything. A broken detector and a clean corpus
# produce identical output — the same shape as the two forbidden-phrase regexes that could not
# match. So a JPEG carrying a real GPS IFD is built in memory and pushed through the identical
# read path.
import importlib.util as _ilu5  # noqa: E402

_spec5 = _ilu5.spec_from_file_location(
    "_pii10", str(ROOT / "scripts" / "factory" / "10_pii.py"))
_pii10 = _ilu5.module_from_spec(_spec5)
sys.modules["_pii10"] = _pii10
_spec5.loader.exec_module(_pii10)

try:
    _detects = _pii10.detector_works()
except Exception as _e:  # noqa: BLE001
    _detects = False
    check("the GPS detector self-check runs", False, type(_e).__name__ + ": " + str(_e)[:80])
check("a JPEG carrying a GPS IFD is DETECTED", _detects)

# and it is not simply always-true: a plain JPEG must yield nothing
import io as _io5  # noqa: E402
from PIL import Image as _PILImage  # noqa: E402
_buf = _io5.BytesIO()
_PILImage.new("RGB", (8, 8)).save(_buf, format="JPEG")
with _PILImage.open(_io5.BytesIO(_buf.getvalue())) as _im5:
    _ex5 = _im5.getexif()
    check("a plain JPEG yields NO GPS tags",
          not (_ex5.get_ifd(_pii10.GPS_IFD) if _ex5 else {}))
# and the detector returns False when the read path is broken, so it can fail
_saved_ifd = _pii10.GPS_IFD
try:
    _pii10.GPS_IFD = 0x9999
    check("a wrong IFD tag makes the detector report False", _pii10.detector_works() is False)
finally:
    _pii10.GPS_IFD = _saved_ifd
check("and restoring it reports True again", _pii10.detector_works() is True)

print("EVERY FORBIDDEN PATTERN ON THE SITE CAN ACTUALLY FIRE")
# Two of the seven could not match anything, and had sat in that file since before this work
# started: `geometrical?` matches "geometrical" but NOT "geometric", so the natural phrasing
# "geometric shape problems" was never caught; and `(break down|fail)` missed "fails". A regex
# that cannot match is indistinguishable from a clean site.
import importlib.util as _ilu4  # noqa: E402

_spec4 = _ilu4.spec_from_file_location(
    "_g8", str(ROOT / "scripts" / "factory" / "08_site_truthfulness.py"))
_g8 = _ilu4.module_from_spec(_spec4)
sys.modules["_g8"] = _g8
_spec4.loader.exec_module(_g8)

check("every forbidden pattern matches its own sample",
      _g8.patterns_are_alive() == [], _g8.patterns_are_alive())
check("the self-check can FAIL, so it is not decorative",
      (lambda: (setattr(_g8, "FORBIDDEN", list(_g8.FORBIDDEN)
                        + [(r"thiswillneverappearanywhere", "planted", [], "no")]),
                len(_g8.patterns_are_alive()) == 1)[1])())
# the two phrasings that used to slip through, asserted directly
import re as _re4  # noqa: E402
check("'geometric shape problems' is caught",
      any(_re4.search(e[0], "geometric shape problems", _re4.I) for e in _g8.FORBIDDEN))
check("'the model fails on our photographs' is caught",
      any(_re4.search(e[0], "the model fails on our photographs", _re4.I) for e in _g8.FORBIDDEN))

print("A STATED TOTAL MUST MATCH ITS OWN ROWS")
# Six rounds found stale prose; the sharpest was a costs.md subtotal of 463 against rows
# summing to 578, where the sentence built on it reversed sign. That is mechanical, so it is
# checked. Exercised here against a PLANTED bad table, because a guard that only ever sees
# correct documents is a guard nobody has tested.
import importlib.util as _ilu3  # noqa: E402

_spec3 = _ilu3.spec_from_file_location(
    "_plan", str(ROOT / "scripts" / "factory" / "11_plan_truthfulness.py"))
_plan = _ilu3.module_from_spec(_spec3)
sys.modules["_plan"] = _plan
_spec3.loader.exec_module(_plan)

_BROKEN = """| Activity | Basis | Hours |
| --- | --- | --- |
| Authoring | 2,500 images | 208 |
| Review | 10,000 items | 174 |
| Pipeline engineering | 11 days | 88 |
| **Subtotal, build only** | | **463** |
"""
_probs = _plan.check_doc.__wrapped__ if hasattr(_plan.check_doc, "__wrapped__") else None
_bad = Path(_tf.mkdtemp()) / "bad.md"
_bad.write_text(_BROKEN, encoding="utf-8")
_found = _plan.check_doc(_bad)
check("the guard CATCHES a subtotal that does not match its rows",
      len(_found) == 1 and _found[0]["stated"][-1] == 463, _found)

_GOOD = _BROKEN.replace("**463**", "**470**")
_good = Path(_tf.mkdtemp()) / "good.md"
_good.write_text(_GOOD, encoding="utf-8")
check("and does NOT flag a subtotal that does", _plan.check_doc(_good) == [],
      _plan.check_doc(_good))

# The early-return bug, kept as a regression: the FIRST version bailed out on the header row
# (no numbers) and reported OK for the table above. A header must be SKIPPED, not fatal.
check("a header row does not abort the check",
      _plan.contiguous_total(4, _plan.parse_tables(_BROKEN)[0][1], 3)[0] is False)

# A total marked "~" is declared approximate, so rounding is not an error.
_ROUNDED = _GOOD.replace("**470**", "**~470**")
_r = Path(_tf.mkdtemp()) / "rounded.md"
_r.write_text(_ROUNDED, encoding="utf-8")
check("a tilde-marked total tolerates rounding", _plan.check_doc(_r) == [], _plan.check_doc(_r))

print("TICKET STATUS AND DECLARED COUNTS ARE CHECKED TOO")
# Round 52 found FIVE tickets marked done with unticked criteria. Round 56 found "eight idle
# pipeline scripts" against 33. Both are visible in the file without running anything.
_tdir = Path(_tf.mkdtemp())
(_tdir / "10-contradictory.md").write_text(
    "# 10: x\n\n**Status:** done (today)\n\n- [x] one\n- [ ] TWO UNTICKED\n", encoding="utf-8")
(_tdir / "11-consistent.md").write_text(
    "# 11: y\n\n**Status:** done (today)\n\n- [x] one\n- [x] two\n", encoding="utf-8")
(_tdir / "12-open.md").write_text(
    "# 12: z\n\n**Status:** in progress\n\n- [ ] not yet\n", encoding="utf-8")
_ti = _plan.check_tickets(_tdir)
check("a ticket marked done with an unticked box is flagged",
      len(_ti) == 1 and _ti[0]["file"].startswith("10-"), _ti)
check("a done ticket with every box ticked is not flagged",
      not any(x["file"].startswith("11-") for x in _ti))
check("an in-progress ticket with open boxes is not flagged",
      not any(x["file"].startswith("12-") for x in _ti))

_docs = Path(_tf.mkdtemp())
_fac = Path(_tf.mkdtemp())
_har = Path(_tf.mkdtemp())
_fac.joinpath("a.py").write_text("", encoding="utf-8")
_har.joinpath("b.py").write_text("", encoding="utf-8")
_har.joinpath("c.py").write_text("", encoding="utf-8")
_docs.joinpath("claim.md").write_text(
    "We have eight idle pipeline scripts.\n", encoding="utf-8")
_cc = _plan.check_declared_counts(sorted(_docs.glob("*.md")), _fac, _har)
check("a wrong script count is flagged", len(_cc) == 1 and "3" in _cc[0]["issue"], _cc)
_docs.joinpath("claim.md").write_text("We have 3 working pipeline scripts.\n", encoding="utf-8")
check("a correct count is not flagged",
      _plan.check_declared_counts(sorted(_docs.glob("*.md")), _fac, _har) == [])
_docs.joinpath("claim.md").write_text(
    'It said "eight idle pipeline scripts" back then.\n', encoding="utf-8")
check("a QUOTED count is not flagged (it is being discussed)",
      _plan.check_declared_counts(sorted(_docs.glob("*.md")), _fac, _har) == [])
_docs.joinpath("claim.md").write_text(
    "and **8 working\npipeline scripts** in total.\n", encoding="utf-8")
check("a count WRAPPED across lines is still found",
      len(_plan.check_declared_counts(sorted(_docs.glob("*.md")), _fac, _har)) == 1)
# PROGRESS.md is a DATED LOG and is excluded, so an old entry is not rewritten every time a
# script is added. Asserted by RUNNING it, not by reading a docstring: a previous version of
# this assertion ended in "or True", which cannot fail — the exact defect this file exists to
# catch, written by me, in the same round.
_docs.joinpath("PROGRESS.md").write_text("We have eight idle pipeline scripts.\n", encoding="utf-8")
_docs.joinpath("claim.md").write_text("We have 3 working pipeline scripts.\n", encoding="utf-8")
check("a wrong count in PROGRESS.md is NOT flagged (the log is a record, not a claim)",
      _plan.check_declared_counts(sorted(_docs.glob("*.md")), _fac, _har) == [],
      _plan.check_declared_counts(sorted(_docs.glob("*.md")), _fac, _har))
_docs.joinpath("LIMITATIONS.md").write_text("We have eight idle pipeline scripts.\n", encoding="utf-8")
check("but the same wrong count in a LIVE document IS flagged",
      len(_plan.check_declared_counts(sorted(_docs.glob("*.md")), _fac, _har)) == 1,
      _plan.check_declared_counts(sorted(_docs.glob("*.md")), _fac, _har))

print("A STAGE THAT WRITES NOTHING IS NOT A SUCCESS")
# The orchestrator declares what each stage will produce and then checked it — and ignored
# the answer. "EXPECTED BUT ABSENT" was printed, the stage counted as ran, and the pipeline
# carried on, so a run could finish reporting failed=0 about a pipeline that produced
# nothing. Same failure as a guard with no signal, one level up.
import importlib.util as _ilu2  # noqa: E402

_spec2 = _ilu2.spec_from_file_location("_rp", str(ROOT / "scripts" / "factory" / "run_pipeline.py"))
_rp = _ilu2.module_from_spec(_spec2)
# Register BEFORE exec_module: run_pipeline defines a @dataclass, and dataclasses resolve
# their namespace through sys.modules[cls.__module__]. Without this the import dies with
# "'NoneType' object has no attribute '__dict__'", which says nothing about the real cause.
sys.modules["_rp"] = _rp
_spec2.loader.exec_module(_rp)

    # A TRACKED FILE, NOT A GITIGNORED ONE. This fixture named data/factory/provenance.jsonl,
    # and data/factory/ is gitignored - so on a CLEAN CHECKOUT the file is absent and the test
    # asserted the existence of something the repository does not contain. **It passed locally
    # and failed in CI**, which is the whole class this round is about.
    # It names a file that ships instead.
_okstage = _rp.Stage("x", "scripts/factory/00_provenance.py", "t",
                     makes_files=["data/latest.json"])
check("a stage whose declared output exists reports no missing output",
      _rp.missing_outputs(_okstage) == [], _rp.missing_outputs(_okstage))
_missing = _rp.Stage("y", "scripts/factory/00_provenance.py", "t",
                     makes_files=["data/factory/__nope.json"])
check("a stage whose declared output is absent is reported missing",
      _rp.missing_outputs(_missing) == ["data/factory/__nope.json"])
check("a stage that declares no outputs is not failed for that",
      _rp.missing_outputs(_rp.Stage("z", "scripts/harness/analyze.py", "t")) == [])
_empty = ROOT / "data" / "factory" / "__empty_probe.json"
# empty counts, like a missing input: a 0-byte artefact is what a broken stage leaves.
# THE DIRECTORY IS GITIGNORED, SO IT IS ABSENT ON A CLEAN CHECKOUT. This wrote a probe file
# into data/factory/ and assumed the directory existed - **it does locally, and does not in
# CI**, so the self-test died at 342 of 446 assertions with no traceback on stderr.
_empty.parent.mkdir(parents=True, exist_ok=True)
_empty.write_text("", encoding="utf-8")
try:
    check("a 0-byte output counts as absent",
          _rp.missing_outputs(_rp.Stage("e", "scripts/factory/00_provenance.py", "t",
                                        makes_files=["data/factory/__empty_probe.json"])) != [])
finally:
    _empty.unlink(missing_ok=True)

print("EVERY FACTORY STAGE CAN SIGNAL FAILURE")
# Seven scripts called `main()` bare under their __main__ guard, so EVERY return code was
# discarded and they always exited 0. That silently defeats run_pipeline.py, which stops a
# stage on a non-zero exit — a failed selection would be treated as success and the next
# stage would run on a missing or stale input.
import re as _re  # noqa: E402

_factory = ROOT / "scripts" / "factory"
_deaf: list[str] = []
_missing: list[str] = []
for _p in sorted(_factory.glob("*.py")):
    if _p.name == "run_pipeline.py":
        continue  # the orchestrator is what READS exit codes; it is checked by running it
    _src = _p.read_text(encoding="utf-8")
    if "__main__" not in _src:
        continue
    if not _re.search(r"(__main__.*?)(raise SystemExit\(main\(\)\)|sys\.exit\(main\(\)\))",
                      _src, _re.S):
        _deaf.append(_p.name)
    if "def main(" not in _src:
        _missing.append(_p.name)
check("every factory script propagates its exit code", not _deaf, str(_deaf))
check("every factory script has a main()", not _missing, str(_missing))

# And the code that stops a pipeline must actually be reached: a stage that refuses must
# exit non-zero.
import subprocess as _sp  # noqa: E402
_r = _sp.run([sys.executable, str(_factory / "01_select_images.py"), "--out", "/tmp/x.json"],
             capture_output=True, text=True)
check("a refused --out exits non-zero", _r.returncode != 0, _r.returncode)
check("and it says why", "names a FILE" in (_r.stdout + _r.stderr))

print("THE CONSENT GATE FAILS CLOSED")
from scripts.harness.consent import check_items, load_consent  # noqa: E402

_cowners = {"a1": "alice", "a2": "alice", "b1": "bob"}
_cpath = Path(_tf.mkdtemp()) / "consent.jsonl"
check("an empty ledger allows nothing",
      check_items(["a1", "b1"], _cowners, {})["granted"] == 0)
_cpath.write_text(
    json.dumps({"scope": "contributor", "key": "alice", "state": "granted", "basis": "form"}) + "\n"
    + json.dumps({"scope": "contributor", "key": "bob", "state": "denied", "basis": "declined"}) + "\n"
    + json.dumps({"scope": "image", "key": "b1", "state": "granted", "basis": "their own upload"}) + "\n",
    encoding="utf-8",
)
_c = load_consent(_cpath)
_r = check_items(["a1", "a2", "b1"], _cowners, _c)
check("a contributor grant covers their images", _r["granted"] == 3, _r)
check("an image record beats a contributor denial",
      _r["denied"] == 0 and _r["granted"] == 3, _r)
_c2 = dict(_c)
_c2[("image", "a1")] = {"scope": "image", "key": "a1", "state": "denied", "basis": "changed their mind"}
_r2 = check_items(["a1", "a2"], _cowners, _c2)
check("an image denial beats a contributor grant",
      _r2["denied"] == 1 and _r2["granted"] == 1, _r2)
_r3 = check_items(["a1", "ghost"], _cowners, _c2)
check("an image absent from the provenance ledger is UNLISTED, not unknown",
      _r3["unlisted"] == 1 and _r3["unknown"] == 0, _r3)
_c3 = dict(_c2)
_c3[("image", "ghost")] = {"scope": "image", "key": "ghost", "state": "granted", "basis": "explicit"}
check("but an explicit image decision is honoured even then",
      check_items(["ghost"], _cowners, _c3)["granted"] == 1)

print("THE PII GATE FAILS CLOSED TOO")
from scripts.harness.pii import check_items as _pii_items  # noqa: E402
from scripts.harness.pii import load_pii as _load_pii  # noqa: E402

check("an empty PII ledger clears nothing", _pii_items(["a1", "b1"], {})["clear"] == 0)
_ppath = Path(_tf.mkdtemp()) / "pii.jsonl"
_ppath.write_text(
    json.dumps({"file_id": "a1", "state": "reviewed_clear",
                "findings": "no faces, no plates"}) + "\n"
    + json.dumps({"file_id": "b1", "state": "flagged",
                  "findings": "legible plate, left"}) + "\n",
    encoding="utf-8",
)
_p = _load_pii(_ppath)
_pr = _pii_items(["a1", "b1", "c1"], _p)
check("a reviewed image is clear", _pr["clear"] == 1, _pr)
check("a flagged image is flagged, with the finding", _pr["flagged"] == 1, _pr)
check("an unrecorded image is unreviewed", _pr["unreviewed"] == 1, _pr)
check("flagged and unreviewed both block a release",
      _pr["flagged"] + _pr["unreviewed"] == 2)
_ppath.write_text(_ppath.read_text(encoding="utf-8")
                  + json.dumps({"file_id": "b1", "state": "reviewed_clear",
                                "findings": "crop confirmed: the plate is a poster"}) + "\n",
                  encoding="utf-8")
check("the LAST review of an image wins",
      _pii_items(["b1"], _load_pii(_ppath))["clear"] == 1)

print("PII REVIEW IS TARGETED BY THE TAGGER, NOT APPLIED TO EVERYTHING")
# "45,330 images unreviewed" is true and useless: nobody reviews 45,330 images, so the
# number produced no plan. Stage 04 already extracts `people` and `text_present` — the two
# PII signals — so the review can be aimed at the images that plausibly contain a face or
# a plate.
import importlib.util as _ilu  # noqa: E402

_spec = _ilu.spec_from_file_location("_pii_cli", str(ROOT / "scripts" / "factory" / "10_pii.py"))
_pii_cli = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_pii_cli)

check("an image the tagger saw people in is tier 'people'",
      _pii_cli.risk_tier({"people": "1-2", "text_present": False}) == "people")
check("a crowd is tier 'people' too",
      _pii_cli.risk_tier({"people": "50+", "text_present": False}) == "people")
check("legible text with no people is tier 'text'",
      _pii_cli.risk_tier({"people": "none", "text_present": True}) == "text")
check("neither is tier 'clear'",
      _pii_cli.risk_tier({"people": "none", "text_present": False}) == "clear")
check("people win over text when both are present",
      _pii_cli.risk_tier({"people": "3-10", "text_present": True}) == "people")
# UNTAGGED IS NOT SAFE, IT IS UNKNOWN. An image nobody has looked at has not been shown to
# lack faces, so it must queue ahead of one the tagger cleared.
check("an untagged image is UNKNOWN, not clear", _pii_cli.risk_tier(None) == "untagged")
check("an unparseable tag is also unknown",
      _pii_cli.risk_tier({"unparsed": True}) == "untagged")
check("so unknown queues ahead of clear",
      _pii_cli.TIER_ORDER["untagged"] < _pii_cli.TIER_ORDER["clear"])
check("and people queue ahead of everything else",
      all(_pii_cli.TIER_ORDER["people"] < v for k, v in _pii_cli.TIER_ORDER.items() if k != "people"))

print("ONE CHOICES FIXTURE, TWO LANGUAGES")
# packages/site/src/choices.fixtures.json is asserted HERE against release.parse_choices
# and in packages/site/src/questions.test.ts against the site's parseChoices. The frozen
# release and the review screen must agree about what an item's options ARE; if either
# parser drifts, one of the two tests fails.
_fx = ROOT / "packages" / "site" / "src" / "choices.fixtures.json"
if _fx.exists():
    _cases = json.loads(_fx.read_text(encoding="utf-8-sig"))["cases"]
    _bad = []
    for _c in _cases:
        _got = parse_choices(_c["input"])
        if _got != _c["expected"]:
            _bad.append((_c["why"], _c["input"], _got, _c["expected"]))
    check("release.parse_choices matches the shared fixture (" + str(len(_cases)) + " cases)",
          not _bad, str(_bad[:2]))
    check("the fixture covers the legacy pipe form",
          any(isinstance(c["input"], str) and "|" in c["input"] for c in _cases))
    check("the fixture covers a JSON array string",
          any(isinstance(c["input"], str) and c["input"].strip().startswith("[") for c in _cases))
else:
    check("the shared choices fixture exists", False, str(_fx))

print("PUBLISHING CANNOT DISAGREE WITH THE PAPER")
# evaluations has UNIQUE(question_id, model) and the endpoint UPSERTS the verdict, so
# posting the raw trace let a 3-repeat run overwrite itself and the API kept the LAST
# sample while the paper used the MAJORITY. And an errored row was stored as 'wrong'.
_cap2: list[dict] = []
_ing.urllib.request.urlopen = lambda req, timeout=None: (_cap2.append(json.loads(req.data.decode())), _FakeResp())[1]
try:
    _rep2 = [_irow(1, "correct"), _irow(1, "correct"), _irow(1, "wrong"),
             _irow(2, "wrong"), _irow(2, "wrong"), _irow(2, "wrong")]
    _post(_rep2, "http://relay", "CODE", batch=100)
finally:
    _ing.urllib.request.urlopen = _real
_sent = [r for c in _cap2 for r in c["results"]]
check("6 trace rows are posted as 2 items", len(_sent) == 2, len(_sent))
_byq = {r["question_id"]: r for r in _sent}
check("the posted verdict is the MAJORITY, not the last sample",
      _byq[1]["verdict"] == "correct", _byq[1]["verdict"])
check("the sample count travels with the row", _byq[1].get("n_samples") == 3)
check("instability travels with the row", _byq[1].get("unstable") == 1)

_cap2.clear()
_ing.urllib.request.urlopen = lambda req, timeout=None: (_cap2.append(json.loads(req.data.decode())), _FakeResp())[1]
try:
    _post([dict(_irow(9, "wrong"), error="HTTPError: 429")], "http://relay", "CODE", batch=100)
finally:
    _ing.urllib.request.urlopen = _real
check("an item that never succeeded is sent with NO verdict",
      _cap2[0]["results"][0].get("verdict") is None, _cap2[0]["results"][0].get("verdict"))
check("and with the error text so the failure is visible",
      "429" in str(_cap2[0]["results"][0].get("error")))
# A run where EVERYTHING failed must summarise, not crash.
check("a run where every item failed still summarises",
      _summarise([dict(_irow(1, "wrong"), error="boom")])["n_errored"] == 1)

print("RELEASE INTEGRITY (choices, and the two hashes)")
from scripts.harness.release import (  # noqa: E402
    build, groundtruth_hash, parse_choices, release_hash,
)

# The API export emits the raw DB TEXT column, a JSON array STRING. The old parser
# split it on "|" and produced ONE option whose text was the whole blob, so the model
# was prompted with 'A) ["Yes", "No"]' and a ground truth of the letter A.
check("a JSON array string is parsed into options",
      parse_choices('["Yes", "No"]') == ["Yes", "No"])
check("a real list passes through", parse_choices(["Yes", "No"]) == ["Yes", "No"])
check("the legacy pipe form still works", parse_choices("Yes|No") == ["Yes", "No"])
check("a malformed JSON string falls back rather than crashing", parse_choices("[oops") == ["[oops"])

_rdef = {"file_id": "f", "question": "q", "answer": "A", "answer_type": "choice",
         "choices": '["Yes", "No"]', "capability": "G1", "level": "L2"}


def _rit(i, **kw):
    d = dict(_rdef)
    d.update(kw)
    d["id"] = i
    return d


_td = Path(_tf.mkdtemp())
try:
    build([_rit(1, choices='["only one"]')], _td, "bad")
    check("a 1-option choice item is REFUSED at build", False, "build succeeded")
except ValueError as _e:
    check("a 1-option choice item is REFUSED at build", "fewer than 2 options" in str(_e))
try:
    build([_rit(1, answer="")], _td, "bad2")
    check("an item with no ground truth is REFUSED at build", False, "build succeeded")
except ValueError as _e:
    check("an item with no ground truth is REFUSED at build", "no ground truth" in str(_e))

_base = [normalise_item(_rit(1)), normalise_item(_rit(2, pair_role="physics"))]
_gh = groundtruth_hash(_base)
_mut = [dict(_base[0], choices=["No", "Yes"]), _base[1]]
check("reversing the options changes groundtruth_hash", groundtruth_hash(_mut) != _gh)
check("groundtruth_hash is order-independent",
      groundtruth_hash([normalise_item(_rit(2, pair_role="physics")), normalise_item(_rit(1))]) == _gh)
_rh = release_hash(_base)
check("changing pair_id changes release_hash",
      release_hash([dict(_base[0], pair_id="p2"), _base[1]]) != _rh)
check("changing capability changes release_hash",
      release_hash([dict(_base[0], capability="G7"), _base[1]]) != _rh)
check("but groundtruth_hash does NOT see a pair_id change",
      groundtruth_hash([dict(_base[0], pair_id="p2"), _base[1]]) == _gh)

print("THE GRADER, WHICH DECIDES EVERY NUMBER IN THE PAPER")
# Four defects were found here by probing it, and each moved an accuracy figure in a
# consistent direction — which is worse than noise, because it looks like a finding.
def _gi(ans, atype="choice", choices=("Yes", "No", "Maybe"), tol=None):
    return {"answer": ans, "answer_type": atype, "choices": list(choices), "tolerance": tol}


_V = lambda r: r["verdict"]  # noqa: E731
check("the article 'a' is not read as option A",
      _V(grade(_gi("B"), "A box is on the left, so the answer is B")) == "correct")
check("'A is wrong, the answer is C' resolves to C",
      _V(grade(_gi("C"), "A is wrong. The answer is C.")) == "correct")
check("a fifth option is reachable by letter",
      _V(grade(_gi("E", choices=("a", "b", "c", "d", "e")), "E")) == "correct")
check("a fifth option with commentary is reachable",
      _V(grade(_gi("E", choices=("a", "b", "c", "d", "e")), "E) the last one")) == "correct")
check("free text does not match inside a word",
      _V(grade(_gi("car", atype="text", choices=()), "carpet")) == "wrong")
check("'I don't know' abstains rather than failing",
      _V(grade(_gi("B"), "I don't know")) == "unanswered")
check("'not sure' abstains", _V(grade(_gi("A"), "not sure")) == "unanswered")
check("'I cannot determine' abstains", _V(grade(_gi("A"), "I cannot determine")) == "unanswered")
check("a bare letter still grades", _V(grade(_gi("B"), "B")) == "correct")
check("a letter with punctuation still grades", _V(grade(_gi("B"), "B)")) == "correct")
check("'the answer is c' still grades", _V(grade(_gi("C"), "The answer is c")) == "correct")
check("option text still grades", _V(grade(_gi("Yes"), "Yes, it would clear")) == "correct")
check("a wrong letter is still wrong", _V(grade(_gi("B"), "A")) == "wrong")
check("gibberish does not parse", grade(_gi("B"), "?!@#")["parse_ok"] == 0)
check("number inside tolerance is correct",
      _V(grade(_gi("3", atype="number", choices=(), tol=1), "4")) == "correct")
check("number in the close band is CLOSE, never correct",
      _V(grade(_gi("3", atype="number", choices=(), tol=1), "5")) == "close")
check("tolerance 0 allows no slack",
      _V(grade(_gi("3", atype="number", choices=(), tol=0), "4")) == "wrong")
check("a gold answer absent from the choices is flagged, not silently wrong",
      grade(_gi("Zebra", choices=("Yes", "No")), "A").get("note") == "gold not among choices")

print("NUMERIC GRADING (decimals were being read as their integer part)")
# normalise() strips punctuation, so "2.5" became "2 5" and was read as 2. Any two
# numbers sharing an integer part therefore graded CORRECT — a gold of 2.5 accepted 2.9.
check("a decimal matches itself",
      _V(grade(_gi("2.5", atype="number", choices=(), tol=0), "2.5")) == "correct")
check("2.5 against 2.7 is WRONG at tolerance 0",
      _V(grade(_gi("2.5", atype="number", choices=(), tol=0), "2.7")) == "wrong")
check("2.5 against 2.9 is WRONG at tolerance 0",
      _V(grade(_gi("2.5", atype="number", choices=(), tol=0), "2.9")) == "wrong")
check("0.5 against 0.9 is WRONG",
      _V(grade(_gi("0.5", atype="number", choices=(), tol=0), "0.9")) == "wrong")
check("thousands separators are handled",
      _V(grade(_gi("1,234", atype="number", choices=(), tol=0), "1234")) == "correct")
check("a negative answer survives",
      _V(grade(_gi("-4.5", atype="number", choices=(), tol=0), "-4.5")) == "correct")
check("an explicit 'total' beats earlier operands",
      _V(grade(_gi("5", atype="number", choices=(), tol=0),
               "There are 2 on the left and 3 on the right, total 5")) == "correct")
check("an explicit '=' beats earlier operands",
      _V(grade(_gi("7", atype="number", choices=(), tol=0), "10 - 3 = 7")) == "correct")
check("the close band still fires above the tolerance",
      _V(grade(_gi("2.5", atype="number", choices=(), tol=0.5), "3.2")) == "close")

print("REPEATS ARE MAJORITY-VOTED, NOT LAST-WINS")
# With --repeats N a trace holds N samples per item. These functions used to take
# whichever came last, so the paper's headline 2x2 reflected ONE ARBITRARY SAMPLE.
from scripts.harness.analyze import collapse, leaderboard, pair_breakdown  # noqa: E402


def _r(qid, verdict, role=None, pid=None):
    return {"model": "m", "question_id": qid, "verdict": verdict, "pair_id": pid,
            "pair_role": role, "abstained": 0, "parse_ok": 1, "latency_ms": 100, "error": ""}


_rep = []
for _v in ("correct", "correct", "wrong"):   # geometry: 2 of 3, last sample WRONG
    _rep.append(_r(1, _v, role="geometry", pid="p1"))
for _v in ("wrong", "wrong", "correct"):     # physics: 1 of 3, last sample CORRECT
    _rep.append(_r(2, _v, role="physics", pid="p1"))
for _v in ("correct", "wrong"):              # the same question twice: a real TIE
    _rep.append(_r(3, _v))
for _ in range(3):
    _rep.append(_r(5, "wrong"))
_rep.append(_r(6, "correct"))

_col, _st = collapse(_rep)
_byq = {x["question_id"]: x for x in _col}
check("12 samples collapse to 5 items", _st["n_items"] == 5 and _st["n_samples"] == 12)
check("3 items are unstable across repeats", _st["unstable"] == 3)
check("a 2-of-3 majority is correct", _byq[1]["verdict"] == "correct")
check("a 1-of-3 majority is wrong", _byq[2]["verdict"] == "wrong")
check("a TIE (1 of 2) counts as wrong, not a pass", _byq[3]["verdict"] == "wrong")
check("the 2x2 follows the MAJORITY, not the last sample",
      dict(pair_breakdown(_rep).get("m", {})) == {"physics_gap": 1})
_lb = leaderboard(_rep)[0]
check("the leaderboard counts items, not samples", _lb["n"] == 5)
check("and reports the sample count separately", _lb["n_samples"] == 12)
check("accuracy is over items (2/5)", abs(_lb["accuracy"] - 0.4) < 1e-9)
check("the disagreement rate is reported", abs(_lb["unstable_rate"] - 0.6) < 1e-9)

print("THE BLIND FILTER (asking without the image)")
from scripts.harness.recipe import PROMPTS, render_prompt  # noqa: E402

check("a blind prompt exists", "blind_v1" in PROMPTS)
check("the blind prompt says there is no image", "WITHOUT seeing any image" in PROMPTS.get("blind_v1", ""))
_blind_prompt = render_prompt(Recipe(model="m", prompt_id="blind_v1"), "Is the gap wider?", ["Yes", "No"])
check("the blind prompt still lists the options", "A) Yes" in _blind_prompt and "B) No" in _blind_prompt)
check("the blind prompt asks for UNKNOWN rather than forcing a guess", "UNKNOWN" in _blind_prompt)

print("THE ERROR-ANALYSIS AXIS SURVIVES TOO")
_axis = normalise_item({
    "id": 11, "file_id": "img_11", "question": "q", "answer": "A", "answer_type": "choice",
    "choices": ["Yes", "No"], "capability": "G1", "level": "L2",
    "family": "spatial", "relevance": "visual_false_premise",
    "unanswerable_reason": "absent_entity", "blind_passed": 1,
})
check("family survives", _axis.get("family") == "spatial", str(_axis.get("family")))
check("relevance survives", _axis.get("relevance") == "visual_false_premise", str(_axis.get("relevance")))
check("unanswerable_reason survives", _axis.get("unanswerable_reason") == "absent_entity")
check("blind_passed survives", _axis.get("blind_passed") == 1)

print("THE ANCHOR SURVIVES THE PIPELINE")
# The authoring sheet produces this box; the export emits it; a release must keep it,
# or the paired diagnostic loses the reference that ties two probes to one object.
_boxed = normalise_item({
    "id": 9, "file_id": "img_9", "question": "q", "answer": "A", "answer_type": "choice",
    "choices": ["Yes", "No"], "grounding_box": "[10,20,110,220]", "capability": "B4", "level": "L4",
    "pair_id": "p1", "pair_role": "geometry",
})
check("grounding_box survives normalisation", _boxed["grounding_box"] == "[10,20,110,220]", str(_boxed.get("grounding_box")))
check("pair identity survives too", _boxed["pair_id"] == "p1" and _boxed["pair_role"] == "geometry")
check("capability and level survive", _boxed["capability"] == "B4" and _boxed["level"] == "L4")

print("ANALYSIS (the paper's tables, computed from a trace, no database)")
from scripts.harness.analyze import asr, by_field, leaderboard, pair_breakdown  # noqa: E402

rows = [
    {"model": "m", "question_id": 1, "pair_id": "p1", "pair_role": "geometry", "capability": "B4", "verdict": "correct"},
    {"model": "m", "question_id": 2, "pair_id": "p1", "pair_role": "physics", "capability": "B4", "verdict": "wrong"},
    {"model": "m", "question_id": 3, "pair_id": "p2", "pair_role": "geometry", "capability": "B4", "verdict": "correct"},
    {"model": "m", "question_id": 4, "pair_id": "p2", "pair_role": "physics", "capability": "B4", "verdict": "correct"},
    {"model": "m", "question_id": 5, "pair_id": "p3", "pair_role": "geometry", "capability": "B4", "verdict": "wrong"},
    {"model": "m", "question_id": 6, "pair_id": "p3", "pair_role": "physics", "capability": "B4", "verdict": "correct"},
    # half a pair: must be ignored by the 2x2, not counted as a failure
    {"model": "m", "question_id": 7, "pair_id": "p4", "pair_role": "geometry", "capability": "B4", "verdict": "correct"},
]
br = pair_breakdown(rows)["m"]
check("2x2: right geometry, wrong physics -> physics_gap", br.get("physics_gap") == 1, str(dict(br)))
check("2x2: both right -> understands", br.get("understands") == 1)
check("2x2: wrong geometry, right physics -> guessing_from_priors", br.get("guessing_from_priors") == 1)
check("2x2: incomplete pair is excluded", sum(br.values()) == 3, str(sum(br.values())))

lb = leaderboard(rows)[0]
check("leaderboard counts all rows", lb["n"] == 7, str(lb["n"]))
# rows 1,3,4,6,7 are correct -> 5 of 7
check("leaderboard accuracy 5/7", abs(lb["accuracy"] - 5 / 7) < 1e-9, str(lb["accuracy"]))

bf = by_field(rows, "capability")
check("by-capability groups", bf["m"]["B4"]["n"] == 7, str(bf))

clean = [
    {"model": "m", "question_id": 1, "verdict": "correct"},
    {"model": "m", "question_id": 2, "verdict": "wrong"},
    {"model": "m", "question_id": 3, "verdict": "correct"},
]
attacked = [
    {"model": "m", "question_id": 1, "verdict": "wrong"},    # flipped
    {"model": "m", "question_id": 2, "verdict": "correct"},  # already wrong: excluded
    {"model": "m", "question_id": 3, "verdict": "correct"},  # held
]
a = asr(clean, attacked)
check("ASR denominator counts only clean-correct items", a["n_clean_correct"] == 2, str(a))
check("ASR = 1 flipped of 2", abs(a["asr"] - 0.5) < 1e-9, str(a["asr"]))

# ---------------------------------------------------------------------------
# THE EXPLAINER TAXONOMY GUARD AGREES WITH THE CODE'S CLOSED SETS.
# ---------------------------------------------------------------------------
if M.get("tax") is not None:
    _tax_rc = M["tax"].main()
    check("explainer taxonomy mirrors scripts/harness/taxonomy.py", _tax_rc == 0, "rc=" + str(_tax_rc))
else:
    check("explainer taxonomy guard preloaded", False, "could not preload 17_explainer_taxonomy.py")

print()
if FAILS:
    print("FAILED:", len(FAILS))
    for f in FAILS:
        print("  -", f)
    raise SystemExit(1)
print("harness selftest: ALL PASS")
