#!/usr/bin/env python3
"""
END-TO-END SMOKE TEST.

Runs the WHOLE harness path through the real CLIs, in a temporary directory, with no
network and no model calls. It answers one question the unit tests cannot: *does the
pipeline work when the pieces are wired together?*

Every defect found in the harness during rounds 28-35 was found by running it, not by
reading it — so this runs it, on every change.

    python -m scripts.harness.smoke

Exit 0 = the full path works. Exit 1 = something in the chain is broken.
"""
from __future__ import annotations

import json
import pathlib
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
FAILS: list[str] = []
STEPS = 0


def check(label: str, cond: bool, detail: str = "") -> None:
    global STEPS
    STEPS += 1
    if cond:
        print("  ok   " + label)
    else:
        FAILS.append(label)
        print("  FAIL " + label + (" :: " + detail if detail else ""))


def run(args: list[str], cwd: pathlib.Path | None = None) -> tuple[int, str]:
    r = subprocess.run([sys.executable] + args, cwd=str(cwd or ROOT),
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def main() -> int:
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="harness-smoke-"))
    try:
        # A REALISTIC export: choices is a JSON STRING, as the API actually emits it.
        # The release used to read that as ONE option whose text was the whole blob, so
        # the model was prompted 'A) ["Yes", "No"]'. This fixture would have caught it.
        export = tmp / "export.jsonl"
        items = [
            {"id": 1, "file_id": "img_A", "question": "Is the guard lower than the edge?",
             "answer": "A", "answer_type": "choice", "choices": '["Yes, it clears", "No, it hits"]',
             "capability": "B4", "level": "L4", "pair_id": "pA", "pair_role": "geometry",
             "family": "spatial", "relevance": "visual_true_premise", "status": "approved"},
            {"id": 2, "file_id": "img_A", "question": "Would it hit the roof?",
             "answer": "B", "answer_type": "choice", "choices": '["Yes, it clears", "No, it hits"]',
             "capability": "B4", "level": "L4", "pair_id": "pA", "pair_role": "physics",
             "family": "spatial", "relevance": "visual_true_premise", "status": "approved"},
            {"id": 3, "file_id": "img_B", "question": "How many gauges?",
             "answer": "3", "answer_type": "number", "choices": "", "tolerance": 0,
             "capability": "PERC", "level": "L1", "family": "counting",
             "relevance": "visual_true_premise", "status": "approved"},
            {"id": 4, "file_id": "img_C", "question": "What colour is the ladder?",
             "answer": "red", "answer_type": "text", "choices": "",
             "capability": "G6", "level": "L1", "family": "attribute_binding",
             "relevance": "visual_true_premise", "status": "approved"},
        ]
        export.write_text("\n".join(json.dumps(i) for i in items) + "\n", encoding="utf-8")

        # CONSENT. The release gate fails closed, so the fixture must record rights for its
        # images — exactly as a real release would have to. Defined before its first use;
        # the first version of this sat below it and the smoke test caught the NameError.
        # THE COUNTERFACTUAL FIXTURE NEEDS ELEVEN FLIPPABLE IMAGES, so the consent and PII
        # ledgers must cover them. Listed once so the two ledgers cannot drift apart.
        cf_ids = ["img_A", "img_B", "img_C"] + ["img_%d" % i for i in range(11)] + ["img_90"]

        consent = tmp / "consent.jsonl"
        consent.write_text(
            "\n".join(json.dumps({"scope": "image", "key": k, "state": "granted",
                                   "basis": "smoke fixture"})
                      for k in tuple(cf_ids)) + "\n",
            encoding="utf-8",
        )

        # PII. The second gate, and it also fails closed.
        pii = tmp / "pii.jsonl"
        pii.write_text(
            "\n".join(json.dumps({"file_id": k, "state": "reviewed_clear",
                                   "findings": "smoke fixture: no faces, no plates"})
                      for k in tuple(cf_ids)) + "\n",
            encoding="utf-8",
        )

        print("1. FREEZE A RELEASE FROM A REALISTIC EXPORT")
        rel = tmp / "rel"
        rc, out = run(["-m", "scripts.harness.build_release", "--export", str(export),
                       "--out", str(rel), "--id", "smoke",
                       "--consent", str(consent),
                       "--pii", str(pii),
                       "--provenance", str(tmp / "empty_prov.jsonl")])
        check("build_release exits 0 with consent and PII recorded", rc == 0, out[-400:])
        check("it reports consent coverage", "consent    :" in out, out[-400:])
        check("it reports PII coverage", "pii        :" in out, out[-400:])
        check("the release has 4 items", (rel / "questions.jsonl").exists()
              and len((rel / "questions.jsonl").read_text(encoding="utf-8-sig").strip().splitlines()) == 4)
        frozen = [json.loads(x) for x in (rel / "questions.jsonl").read_text(encoding="utf-8-sig").splitlines() if x.strip()]
        check("choices are parsed into real options, not one JSON blob",
              frozen[0]["choices"] == ["Yes, it clears", "No, it hits"], frozen[0]["choices"])
        manifest = json.loads((rel / "manifest.json").read_text(encoding="utf-8-sig"))
        check("the manifest carries a groundtruth_hash", bool(manifest.get("groundtruth_hash")))
        check("the manifest carries a release_hash over the analysis fields",
              bool(manifest.get("release_hash")))

        print()
        print("1b. THE CONSENT GATE REFUSES A RELEASE WITH NO RECORDED RIGHTS")
        rc, out = run(["-m", "scripts.harness.build_release", "--export", str(export),
                       "--out", str(tmp / "rel_noconsent"), "--id", "gated",
                       "--consent", str(tmp / "empty_consent.jsonl"),
                       "--provenance", str(tmp / "empty_prov.jsonl")])
        check("a release with no consent is REFUSED", rc == 1, rc)
        check("and it says what to do about it",
              "REFUSING TO FREEZE" in out and "09_consent.py" in out, out[-400:])

        print()
        print("1c. THE PII GATE REFUSES A RELEASE THAT HAS NOT BEEN REVIEWED")
        rc, out = run(["-m", "scripts.harness.build_release", "--export", str(export),
                       "--out", str(tmp / "rel_nopii"), "--id", "gated",
                       "--consent", str(consent),
                       "--pii", str(tmp / "empty_pii.jsonl"),
                       "--provenance", str(tmp / "empty_prov.jsonl")])
        check("a release with no PII review is REFUSED", rc == 1, rc)
        check("and it says what to do about it",
              "10_pii.py" in out and "Silence is not a finding" in out, out[-400:])

        stub = tmp / "stub.json"
        stub.write_text(json.dumps({"1": "A", "2": "B", "3": "3", "4": "red"}), encoding="utf-8")

        print()
        print("2. A DRY-RUN SWEEP (no network, no model, no spend)")
        trace = tmp / "trace.jsonl"
        rc, out = run(["-m", "scripts.harness.run_open", "--release", str(rel),
                       "--model", "stub/smoke", "--out", str(trace),
                       "--dry-run", "--stub-file", str(stub)])
        check("the sweep exits 0", rc == 0, out[-200:])
        check("it wrote one row per item", trace.exists()
              and len(trace.read_text(encoding="utf-8-sig").strip().splitlines()) == 4)
        rows = [json.loads(x) for x in trace.read_text(encoding="utf-8-sig").splitlines() if x.strip()]
        check("every row carries the groundtruth hash", all(r.get("groundtruth_hash") for r in rows))
        check("every row carries the recipe hash", all(r.get("recipe_hash") for r in rows))
        check("every row carries the pixel budget", all(r.get("pixel_budget") is not None for r in rows))
        check("every row carries what the model saw", all("image_w" in r and "image_h" in r for r in rows))
        check("a correct stub scores 4/4", sum(1 for r in rows if r.get("verdict") == "correct") == 4)

        print()
        print("3. A STUB FILE WITH A BOM (what PowerShell writes)")
        bom = tmp / "stub_bom.json"
        bom.write_text("\ufeff" + json.dumps({"1": "A", "2": "B", "3": "3", "4": "red"}), encoding="utf-8")
        trace_bom = tmp / "trace_bom.jsonl"
        rc, out = run(["-m", "scripts.harness.run_open", "--release", str(rel),
                       "--model", "stub/smoke", "--out", str(trace_bom),
                       "--dry-run", "--stub-file", str(bom)])
        check("a BOM is tolerated rather than crashing", rc == 0, out[-200:])

        print()
        print("4. ANALYZE (the paper's tables, from the trace, no database)")
        rc, out = run(["-m", "scripts.harness.analyze", str(trace)])
        check("analyze exits 0", rc == 0, out[-200:])
        check("the leaderboard reports the model", "stub/smoke" in out)
        check("the paired diagnostic renders", "PAIRED DIAGNOSTIC" in out)
        check("the bridge pair scores as 'understands'", "understands" in out)
        check("the by-capability table renders", "BY CAPABILITY" in out)

        print()
        print("4b. THE TAGGER SEPARATES A REFUSAL FROM AN INVENTED DOMAIN")
        # Both leave a record with no usable domain, but they are different failures: a
        # refusal is honest, and a well-formed answer with a domain the taxonomy does not
        # contain is the model being CONFIDENTLY WRONG. Only the refusal used to be
        # reported, and at scale the invented ones were exactly as common.
        tagcand = tmp / "tagcand.json"
        tagcand.write_text(json.dumps({"images": [{"file_id": "t1"}, {"file_id": "t2"}]}), encoding="utf-8")
        tagstub = tmp / "tagstub.json"
        tagstub.write_text(json.dumps({
            "t1": "I cannot determine the domain from this image.",
            "t2": json.dumps({"domains": ["D99"], "objects": [], "text_present": None, "people": "nobody"}),
        }), encoding="utf-8")
        tagout = tmp / "tagged.jsonl"
        rc, out = run(["scripts/factory/04_tag_ground.py", "--candidates", str(tagcand),
                       "--out", str(tagout), "--dry-run", "--stub-file", str(tagstub)])
        check("the tagger exits 0", rc == 0, out[-200:])
        check("a refusal is reported as unparseable", "unparseable: 1" in out, out[-400:])
        check("an invented domain is reported SEPARATELY", "INVENTED   : 1" in out, out[-400:])
        check("and the usable count excludes both", "usable     : 0 of 2" in out, out[-400:])
        _tagged = [json.loads(x) for x in tagout.read_text(encoding="utf-8-sig").splitlines() if x.strip()]
        check("the refusal is marked unparsed", _tagged[0].get("unparsed") is True)
        check("the invented domain is NOT marked unparsed, because it parsed",
              not _tagged[1].get("unparsed") and _tagged[1]["domains"] == [])

        print()
        print("4c. THE CROPS-OUT-THE-EVIDENCE ATTACK RUNS")
        # \`06_break_the_model.py\` DESIGNS this experiment, calls it "the strongest in the
        # project", and CANNOT RUN: its main() handles only --demo and --plan. This is a thin
        # wrapper over the harness, so the ladder inherits the release hash, resume, per-row
        # errors and ingestion.
        crop = tmp / "crop.jsonl"
        rc, out = run(["-m", "scripts.harness.run_crop", "--release", str(rel),
                       "--model", "stub/smoke", "--out", str(crop),
                       "--ladder", "1.0,0.5,0.25", "--dry-run", "--stub-file", str(stub)])
        check("the crop attack exits 0", rc == 0, out[-300:])
        check("it prints a curve", "THE CURVE" in out and "crop" in out)
        _crows = [json.loads(x) for x in crop.read_text(encoding="utf-8-sig").splitlines() if x.strip()]
        check("one row per (item, fraction)", len(_crows) == 12, len(_crows))
        # THE CROP ACTUALLY CROPPED. Measured dimensions, not an assertion about intent —
        # this is what the synthetic stub fetcher could never have shown, because its bytes
        # were not an image and every cropped row errored.
        _by_frac: dict[str, list[int]] = {}
        for r in _crows:
            _by_frac.setdefault(r["run_id"][-6:], []).append(r.get("image_w") or 0)
        check("every fraction produced rows with real dimensions",
              all(v and all(v) for v in _by_frac.values()), _by_frac)
        _ctrl = max(max(v) for k, v in _by_frac.items() if k.endswith("100"))
        _small = max(max(v) for k, v in _by_frac.items() if k.endswith("025"))
        check("the 0.25 crop is measurably smaller than the control", _small < _ctrl,
              (_ctrl, _small))
        check("every cropped row is hashed, so the crop is auditable",
              all(len(str(r.get("image_sha256"))) == 64 for r in _crows))

        print()
        print("4d. THE COUNTERFACTUAL CONTROL RUNS, AND FLIPS THE ANSWER BY CONSTRUCTION")
        # A removal edit on an existence question is answer-changing BY CONSTRUCTION: "is there
        # a forklift?" + remove the forklift -> the correct answer is provably "no". So the
        # flipped gold needs no new annotation, and the grounding_box says where to remove.
        #
        # This is the third of the three tests the project needs, and the only one that is
        # semantics-CHANGING: 04_perturb keeps the answer, run_crop makes it unknowable.
        cfix = tmp / "cf_export.jsonl"
        # ELEVEN FLIPPABLE ITEMS, because the control now REFUSES below ten: a "CONTROL
        # ACCURACY" computed from one item is a description of that item, not of the model.
        # The floor broke this fixture, which is the floor working.
        cfix.write_text("\n".join(json.dumps(x) for x in (
            [{"id": i, "file_id": "img_%d" % i, "question": "Is there object %d?" % i,
              "answer": "Yes", "answer_type": "yesno", "capability": "PERC", "level": "L1",
              "relevance": "visual_true_premise", "grounding_box": "[10,10,60,60]",
              "status": "approved"} for i in range(11)]
            + [{"id": 90, "file_id": "img_90", "question": "Is the gate open?",
                "answer": "No", "answer_type": "yesno", "capability": "PERC", "level": "L1",
                "relevance": "visual_true_premise", "status": "approved"}]
        )) + "\n", encoding="utf-8")
        crel = tmp / "cfrel"
        rc, out = run(["-m", "scripts.harness.build_release", "--export", str(cfix),
                       "--out", str(crel), "--id", "cf",
                       "--consent", str(consent), "--pii", str(pii),
                       "--provenance", str(tmp / "empty_prov.jsonl")])
        check("the fixture release freezes", rc == 0, out[-300:])
        ctr = tmp / "cf.jsonl"
        rc, out = run(["-m", "scripts.harness.run_counterfactual", "--release", str(crel),
                       "--model", "stub/smoke", "--out", str(ctr), "--dry-run",
                       "--stub-file", str(stub)])
        check("the counterfactual control exits 0", rc == 0, out[-300:])
        check("eleven items are flippable and one is skipped, with reasons",
              "flippable            : 11" in out and "no usable grounding_box" in out, out[-400:])
        check("it reports the control", "THE CONTROL" in out)
        _crows = [json.loads(x) for x in ctr.read_text(encoding="utf-8-sig").splitlines() if x.strip()]
        check("every row names the edit applied",
              all(r.get("image_edit") == "remove_object" for r in _crows), _crows[:1])
        # THE INVERSION IS PRINTED, because a counterfactual whose gold did not flip is not a
        # counterfactual. (An earlier version of this assertion opened the ORIGINAL release —
        # the flipped one is built in a temp directory — and naturally found the old answer.)
        check("the gold was inverted by construction", "Yes -> no" in out, out[-400:])

        print()
        print("4e. THE TYPOGRAPHIC, PATCH AND CORRUPTION TRACKS RUN")
        for _track, _expect in (("typographic", "text_yes"), ("patch", "patch_centre"),
                                ("corruption", "blur")):
            _tr = tmp / (_track + ".jsonl")
            rc, out = run(["-m", "scripts.harness.run_attack", "--release", str(rel),
                           "--model", "stub/smoke", "--track", _track, "--out", str(_tr),
                           "--dry-run", "--stub-file", str(stub)])
            check("the " + _track + " track exits 0", rc == 0, out[-200:])
            check("the " + _track + " track reports its series", "THE SERIES" in out)
            check("the " + _track + " track includes a control first",
                  "control" in out and "control s0" not in out.split("THE SERIES")[0].split("conditions:")[0])
            _arows = [json.loads(x) for x in _tr.read_text(encoding="utf-8-sig").splitlines() if x.strip()]
            check("the " + _track + " track wrote rows for its conditions",
                  len(_arows) > 0 and any(_expect in str(r.get("run_id")) for r in _arows),
                  _expect)
        # THE CORRUPTION LADDER MUST NOT COLLAPSE. Its first version gave all five severities
        # one run_id, so resume treated severity 2 as already done and the ladder became a
        # single condition — five blurs each reporting the previous one's rows.
        _crow = [json.loads(x) for x in (tmp / "corruption.jsonl").read_text(encoding="utf-8-sig").splitlines() if x.strip()]
        _sevs = {r["run_id"] for r in _crow if "blur" in r["run_id"]}
        check("each corruption severity is its own run", len(_sevs) == 5, sorted(_sevs))

        print()
        print("4f. EVERY MODEL-CALLING ENTRY POINT REFUSES WITHOUT --spend")
        # THE OWNER'S RULE: inference on images is the ONLY permitted spend. `--spend` was
        # implemented in run_pipeline.py AND NOWHERE ELSE, so the pipeline refused a paid stage
        # while every runner did not — measured in round 79, a direct run_crop call ran the whole
        # six-condition ladder against a paid endpoint with no flag at all.
        #
        # The pipeline guarded the pipeline, not the tools. This asserts the tools, and it names
        # every entry point rather than sampling one.
        #
        # run_open takes no --base-url (it serves a LOCAL vLLM), and passing one made argparse
        # exit 2 — which this check originally read as a refusal. A false pass, caught by reading
        # the message rather than the exit code.
        _paid = [
            (["-m", "scripts.harness.run_open", "--release", str(rel), "--model", "local/m",
              "--out", str(tmp / "spend.jsonl")], "run_open"),
            (["-m", "scripts.harness.run_closed", "--release", str(rel), "--model", "paid/m",
              "--out", str(tmp / "spend.jsonl")], "run_closed"),
            (["-m", "scripts.harness.run_crop", "--release", str(rel), "--model", "paid/m",
              "--out", str(tmp / "spend.jsonl"), "--ladder", "1.0", "--base-url", "http://127.0.0.1:1/v1"], "run_crop"),
            (["-m", "scripts.harness.run_attack", "--release", str(rel), "--track", "typographic",
              "--model", "paid/m", "--out", str(tmp / "spend.jsonl"), "--base-url", "http://127.0.0.1:1/v1"], "run_attack"),
            (["-m", "scripts.harness.blind", "--release", str(rel), "--model", "paid/m",
              "--out", str(tmp / "spend.jsonl"), "--base-url", "http://127.0.0.1:1/v1"], "blind"),
            (["scripts/factory/04_tag_ground.py", "--out", str(tmp / "spend.jsonl"),
              "--base-url", "http://127.0.0.1:1/v1"], "04_tag_ground"),
            (["scripts/factory/02_generate_questions.py", "--out", str(tmp / "spend.jsonl"),
              "--n", "1"], "02_generate_questions"),
        ]
        for _args, _name in _paid:
            _rc, _out2 = run(_args)
            # THE MESSAGE, not the exit code. An argparse error also exits 2.
            check(_name + " refuses to spend without --spend",
                  "REFUSING TO SPEND" in _out2, _out2[-120:])

        print()
        print("5. THE BLIND FILTER (asking without the image)")
        blind = tmp / "blind.jsonl"
        rc, out = run(["-m", "scripts.harness.blind", "--release", str(rel),
                       "--model", "stub/smoke", "--out", str(blind),
                       "--dry-run", "--stub-file", str(stub)])
        check("blind exits 0", rc == 0, out[-200:])
        check("it reports a blind-solvable rate", "BLIND-SOLVABLE" in out)
        # The stub answers from the answer key without seeing anything, so by construction
        # every item IS blind-solvable. 100% here means the filter is working, not failing.
        check("a key-answering stub is detected as fully blind-solvable", "100.0%" in out, out[-160:])

        print()
        print("6. INGEST, DRY RUN (nothing is sent)")
        rc, out = run(["-m", "scripts.harness.ingest", "--trace", str(trace), "--dry-run"])
        check("ingest exits 0", rc == 0, out[-200:])
        check("it reports items, not samples", "items         : 4  (from 4 samples)" in out, out[-260:])
        check("it agrees with analyze on accuracy", "accuracy      : 1.000" in out)
        check("the relay write is refused without a secret",
              run(["-m", "scripts.harness.ingest", "--trace", str(trace)])[0] == 2)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print()
    print("steps: " + str(STEPS) + "   failures: " + str(len(FAILS)))
    if FAILS:
        for f in FAILS:
            print("  - " + f)
        return 1
    print("harness smoke: the full path works end to end, offline.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
