#!/usr/bin/env python3
"""Render docs/open-models-grain-sweep.md from data/open-models/grain.json."""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "data" / "open-models" / "grain.json"
OUT = REPO / "docs" / "open-models-grain-sweep.md"
SHORT = {"InternVL3_5-8B": "InternVL3.5-8B", "Molmo2-8B": "Molmo2-8B", "Qwen3-VL-8B-Instruct": "Qwen3-VL-8B-Instruct"}
COND = ["sigma15", "sigma25", "sigma40"]


def f4(x):
    return "-" if x is None else "%+.4f" % x


def f3(x):
    return "-" if x is None else "%.4f" % x


def ci(x):
    return "-" if not x else "[%+.4f, %+.4f]" % (x[0], x[1])


def main() -> int:
    g = json.loads(DATA.read_text(encoding="utf-8"))
    M = g["models"]
    labels = sorted(M)
    L = []
    a = L.append

    a("# Grain-robustness sweep: the same questions on corrupted images")
    a("")
    a("Computed %s from the stored response files only - no API calls, no re-runs." % g["generated"])
    a("Engine `scripts/open_models_grain.py`; artifact `data/open-models/grain.json`; this document is")
    a("rendered from that artifact by `scripts/open_models_grain_report.py`.")
    a("")
    a("These runs are **not** part of the main leaderboard. They are a different image condition, a")
    a("subset of the benchmark, and only %d of the runs. They are reported here, and on" % len(labels))
    a("`/open-models/grain`, as a separate robustness result.")
    a("")

    a("## 1. What is in the grain set (verified)")
    a("")
    for k in g["what_it_is"]["verified"]:
        a("- %s" % k)
    a("- conditions: %s; %d images per domain; %s records per condition"
      % (", ".join(g["what_it_is"]["conditions"]), g["what_it_is"]["images_per_domain"], format(g["what_it_is"]["records_per_condition"], ",")))
    a("")
    a("Not verifiable from disk - stated as unknown, not guessed:")
    a("")
    for k in g["what_it_is"]["unverifiable"]:
        a("- %s" % k)
    a("")

    a("## 2. Method")
    a("")
    a("For each condition, **both sides** (grain and the main run of the same model) are restricted to the")
    a("exact base question ids that condition contains, scored with the published comparison function at")
    a("tolerance zero. The delta therefore isolates the image condition, not the sample.")
    a("")
    a("Two comparisons are reported for every cell:")
    a("")
    a("- **all** - every stored record; a missing or unreadable prediction counts as wrong.")
    a("- **parsed** - only records where *both* sides produced a usable short answer. This removes the")
    a("  extraction difference between the two runs (see the confound in section 5).")
    a("")
    a("Every delta carries a paired **image-level** bootstrap CI (10,000 resamples, one shared draw per")
    a("replicate across conditions and both sides, baselines untouched). Absolute accuracies per side are")
    a("printed alongside the deltas in every table.")
    a("")

    a("## 3. Results")
    a("")
    a("| model | condition | n | grain accuracy | matched main accuracy | delta (pooled) | delta 95% CI | delta, parsed only | unparsed grain / main |")
    a("|---|---|---|---|---|---|---|---|---|")
    for lab in labels:
        for c in M[lab]["per_condition"]:
            a("| %s | %s | %s | %s | %s | %s | %s | %s | %.2f%% / %.2f%% |" % (
                lab, c["condition"], format(c["n"], ","), f3(c["grain_exact"]), f3(c["main_exact"]),
                f4(c["delta_pooled"]), ci(c["delta_ci"]), f4(c["delta_parsed_pooled"]),
                c["unparsed_grain"] * 100, c["unparsed_main"] * 100))
    a("")
    a("Reading: with extraction held equal, **every model degrades as the condition label rises**, but the")
    a("effect is small - the largest single-condition drop is about two accuracy points. InternVL3.5-8B and")
    a("Molmo2-8B show the same picture with and without the parseable-only restriction, so for those two the")
    a("raw numbers already isolate the condition.")
    a("")

    a("## 4. Where the loss sits")
    a("")
    a("### 4.1 By level (delta, pooled within the level)")
    a("")
    a("| model | condition | L1 | L2 | L3 | L4 | L5 |")
    a("|---|---|---|---|---|---|---|")
    for lab in labels:
        for cond in COND:
            row = [x for x in M[lab]["by_level"] if x["condition"] == cond]
            by = {x["key"]: x["delta"] for x in row}
            a("| %s | %s | %s | %s | %s | %s | %s |" % (lab, cond, f4(by.get(1)), f4(by.get(2)), f4(by.get(3)), f4(by.get(4)), f4(by.get(5))))
    a("")
    a("### 4.2 By reasoning family at the strongest condition (sigma40)")
    a("")
    a("| model | family | n | delta |")
    a("|---|---|---|---|")
    for lab in labels:
        rows = [x for x in M[lab]["by_family"] if x["condition"] == "sigma40"]
        for x in sorted(rows, key=lambda r: r["delta"] if r["delta"] is not None else 0):
            a("| %s | %s | %s | %s |" % (lab, x["key"], format(x["n"], ","), f4(x["delta"])))
    a("")

    a("## 5. Three things a reader must not misread")
    a("")
    a("**1. Projective reasoning is where the damage concentrates.** `shadow_inference` falls monotonically")
    a("with the condition label in *all three* models, which is the one pattern in this sweep that looks like a")
    a("genuine robustness effect:")
    a("")
    a("| model | sigma15 | sigma25 | sigma40 |")
    a("|---|---|---|---|")
    for lab in labels:
        rows = {x["condition"]: x["delta"] for x in M[lab]["by_domain"] if x["key"] == "shadow_inference"}
        a("| %s | %s | %s | %s |" % (lab, f4(rows.get("sigma15")), f4(rows.get("sigma25")), f4(rows.get("sigma40"))))
    a("")
    a("**2. The `physical_stability` gain is not a robustness effect.** Qwen3-VL-8B-Instruct appears to gain")
    a("roughly 48 points on that domain under every condition:")
    a("")
    a("| model | sigma15 | sigma25 | sigma40 |")
    a("|---|---|---|---|")
    for lab in labels:
        rows = {x["condition"]: x["delta"] for x in M[lab]["by_domain"] if x["key"] == "physical_stability"}
        a("| %s | %s | %s | %s |" % (lab, f4(rows.get("sigma15")), f4(rows.get("sigma25")), f4(rows.get("sigma40"))))
    a("")
    a("A gain that is flat across three conditions cannot be caused by the condition: it is a difference")
    a("between the two *runs*, not between the images. Something in Qwen's main run is degraded on those 250")
    a("images. Treat every Qwen delta for this domain as uninterpretable until the main run is repeated.")
    a("")
    a("**3. Qwen's raw numbers are confounded by answer extraction.** Its main run leaves 3.76% of answers")
    a("unparsed against 0.7-0.8% in the grain runs, which flatters the grain side by roughly one point. The")
    a("`parsed only` column is the one to quote for this model.")
    a("")

    a("## 6. Completeness")
    a("")
    a("| model | condition | records | expected | missing |")
    a("|---|---|---|---|---|")
    for lab in labels:
        for cond in COND:
            c = M[lab]["completeness"][cond]
            a("| %s | %s | %s | %s | %s |" % (lab, cond, format(c["records"], ","), format(c["expected"], ","), format(c["missing"], ",")))
    a("")
    a("Qwen3-VL-8B-Instruct's sigma40 condition is short by 187 records (`laser_mirror` 156, `orthographic` 31).")
    a("Its sigma40 row is therefore computed over slightly fewer items; both sides of that comparison are")
    a("restricted to the ids that exist, so the delta stays paired.")
    a("")

    a("## 7. What this sweep does not settle")
    a("")
    a("- The noise transform itself: only the labels `sigma15/25/40` are stored. If sigma is additive Gaussian")
    a("  standard deviation, these are mild corruptions; the results are consistent with that, but the files")
    a("  cannot prove it.")
    a("- Serving configuration for the grain runs (engine, precision, decoding, date): absent, as for the main")
    a("  runs. The response statistics match the main run closely (median prediction length 3, median response")
    a("  length within 4%, identical `score_mode` mix, identical FINAL-ANSWER rate), which is evidence that the")
    a("  configuration matched, but it is evidence, not a record.")
    a("- Whether other models or the frontier tier behave the same way. Three of the seven open-weight runs are")
    a("  covered here.")
    a("")
    a("To settle the physical_stability anomaly and the noise transform, the image generator configuration and a")
    a("repeat of Qwen3-VL-8B-Instruct's main run on the same 250 images would be enough.")
    a("")

    a("## 8. Deliverables")
    a("")
    a("- This document: `docs/open-models-grain-sweep.md`")
    a("- Artifact: `data/open-models/grain.json`")
    a("- Engine: `scripts/open_models_grain.py` (`--boot`, `--seed`) · renderer: `scripts/open_models_grain_report.py`")
    a("- Site: `/open-models/grain`")
    a("")

    OUT.write_text("\n".join(L) + "\n", encoding="utf-8")
    print("wrote %s  %.0f KB  %d lines" % (OUT.relative_to(REPO), OUT.stat().st_size / 1024, len(L)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
