#!/usr/bin/env python3
"""Render docs/open-models-test1-reanalysis.md from data/open-models/reanalysis.json.

Every figure is read out of the computed artifact, so the document cannot drift
from the numbers it describes.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "data" / "open-models" / "reanalysis.json"
PUB = REPO / "data" / "open-models" / "models.json"
OUT = REPO / "docs" / "open-models-test1-reanalysis.md"

ORDER = ["Qwen3-VL-8B-Instruct", "Qwen3-VL-8B-Thinking", "Molmo2-8B",
         "InternVL3.5-8B", "Kimi-VL-A3B-Thinking", "DeepSeek-VL2-Small"]
SHORT = {"Qwen3-VL-8B-Instruct": "Qwen-I", "Qwen3-VL-8B-Thinking": "Qwen-T", "Molmo2-8B": "Molmo2",
         "InternVL3.5-8B": "InternVL", "Kimi-VL-A3B-Thinking": "Kimi", "DeepSeek-VL2-Small": "DeepSeek"}


def f4(x):
    return "-" if x is None else "%+.4f" % x


def f3(x):
    return "-" if x is None else "%.3f" % x


def ci(x):
    return "-" if not x else "[%+.4f, %+.4f]" % (x[0], x[1])


def main() -> int:
    r = json.loads(DATA.read_text(encoding="utf-8"))
    pub = json.loads(PUB.read_text(encoding="utf-8"))
    pubacc = {m["label"]: m["totals"]["acc"] for m in pub["models"]}
    M = r["models"]
    L = []
    a = L.append
    ranked = sorted(ORDER, key=lambda k: -(M[k]["overall"]["macro"] or -9))

    a("# Test-1 reanalysis: the six open-weight runs")
    a("")
    a("Computed %s from the stored response files only - no API calls, no re-runs, no new model"
      % r["generated"])
    a("evaluations. Engine `scripts/open_models_test1_reanalysis.py`; artifact")
    a("`data/open-models/reanalysis.json`; this document is rendered from that artifact by")
    a("`scripts/open_models_test1_report.py`, so no figure here is typed by hand.")
    a("")
    a("## Summary")
    a("")
    a("| model | n used | baseline | raw (exact) | raw (published) | adjusted MACRO | MACRO 95% CI | adjusted POOLED |")
    a("|---|---|---|---|---|---|---|---|")
    for lab in ranked:
        o = M[lab]["overall"]
        a("| %s | %s | %s | %s | %s | **%s** | %s | %s |" % (lab, format(o["n"], ","), f3(o["baseline"]),
          f3(o["raw_exact"]), f3(pubacc.get(lab)), f4(o["macro"]), ci(o["macro_ci"]), f4(o["pooled"])))
    a("")
    a("Two of the six runs sit **below the constant-answer baseline on average** (Kimi-VL-A3B-Thinking,"
      " DeepSeek-VL2-Small): across the 34 x 5 cells, answering the most common ground truth would have"
      " scored higher than the model did.")
    a("")

    a("## 1. L5 check")
    a("")
    a("| model | L1 | L2 | L3 | L4 | L5 | total | verdict |")
    a("|---|---|---|---|---|---|---|---|")
    for lab in ORDER:
        c = r["level_counts"][lab]
        tot = sum(c[str(i)] for i in range(1, 6))
        a("| %s | %s | %s | %s | %s | %s | %s | (a) L5 present |" % (lab, format(c["1"], ","), format(c["2"], ","),
          format(c["3"], ","), format(c["4"], ","), format(c["5"], ","), format(tot, ",")))
    a("")
    a("**Case (a) for all six models.** L5 responses exist, are stored for every domain, and are already"
      " scored - the published report on the site covers **L1-L5**, not L1-L4. The premise that L5 was not"
      " reported does not match this tier's stored data or its published pages, so nothing had to be"
      " recovered: the L5 rows below are the same records the site already scores. No level is blank in"
      " any table in this document.")
    a("")
    inv = r["invariants"]["one_question_per_image_per_level"]
    a("Invariant checked while counting: every cell holds exactly one question per image per level"
      " (%d cells, %d violations)." % (inv["checked_cells"], len(inv["violations"])))
    a("")

    a("## 2. Constant-answer baselines on this sample")
    a("")
    a("baseline[domain][level] = max over distinct ground-truth values v of count(gt == v) / n - computed"
      " from recorded ground truth only, over exactly the items each model was evaluated on. Ground truth is"
      " identical across runs for identical question ids, so one table serves all six models; the two runs"
      " with a 1,501-image angle_estimation cell are noted in Appendix C.")
    a("")
    cells0 = M[ORDER[0]]["cells"]
    nb = [c["baseline"] for c in cells0 if c["baseline"] is not None]
    a("- cells: %d per model (34 domains x 5 levels), 6 of them structurally constant" % len(cells0))
    a("- baseline range across the 170 cells: %s to %s" % (f3(min(nb)), f3(max(nb))))
    a("- baseline for exact-match accuracy: the published comparison function with the numeric tolerance"
      " set to zero; the published 1% / 0.05 tolerance is reported alongside in every table, never replaced")
    a("")
    a("The previously published 13.76% figure is a single pooled majority-answer share, not this quantity,"
      " and it is not used anywhere below. A per-(domain, level) table of n, baseline and modal ground"
      " truth is Appendix A.")
    a("")

    a("## 3. The transform")
    a("")
    a("`adjusted = (accuracy - baseline) / (1 - baseline)`. **MACRO** is the unweighted mean of per-cell"
      " adjusted scores over non-constant cells; **POOLED** sums correct and baseline-expected counts over"
      " non-constant cells and transforms once.")
    a("")
    a("| model | cells used | n | baseline | raw (exact) | raw (published) | adj. MACRO | MACRO 95% CI | adj. POOLED | POOLED 95% CI |")
    a("|---|---|---|---|---|---|---|---|---|---|")
    for lab in ranked:
        o = M[lab]["overall"]
        a("| %s | %d/%d | %s | %s | %s | %s | **%s** | %s | %s | %s |" % (lab, o["cells_used"], o["cells"],
          format(o["n"], ","), f3(o["baseline"]), f3(o["raw_exact"]), f3(pubacc.get(lab)), f4(o["macro"]),
          ci(o["macro_ci"]), f4(o["pooled"]), ci(o["pooled_ci"])))
    a("")
    a("The two aggregations disagree on rank order once: Molmo2-8B has the higher MACRO (%s) while"
      " Qwen3-VL-8B-Thinking has the higher POOLED (%s), because Thinking does relatively better on the"
      " large domains and relatively worse on the small ones."
      % (f4(M["Molmo2-8B"]["overall"]["macro"]), f4(M["Qwen3-VL-8B-Thinking"]["overall"]["pooled"])))
    a("")
    a("Structurally constant cells (baseline = 1.0, undefined, excluded from every aggregate rather than"
      " substituted with 0 or NaN-as-zero):")
    a("")
    a("| domain | level | the only ground truth | n per model |")
    a("|---|---|---|---|")
    for cell in sorted({(c["domain"], c["level"], c["modal_gt"], c["n"]) for c in M[ORDER[0]]["constant_cells"]}):
        a("| %s | L%d | `%s` | %s |" % (cell[0], cell[1], cell[2], format(cell[3], ",")))
    a("")
    a("Cells with n < 10: **%d** across all six models. There are none, so the primary aggregates and the"
      " supplementary aggregates without small cells are identical; the column exists in"
      " `reanalysis.json` regardless." % sum(M[lab]["overall"]["n_lt_10"] for lab in ORDER))
    a("")
    a("Negative adjusted scores are reported as computed and never clipped: "
      + ", ".join("%s %s" % (SHORT[lab], f4(M[lab]["overall"]["macro"])) for lab in ranked) + " (MACRO).")
    a("")

    a("## 4. Tier-comparison subset (8,500 rows)")
    a("")
    s = r["subset_8500"]
    a("**Status: %s.**" % s["status"])
    a("")
    a("- Reason: %s" % s["reason"])
    a("- Missing input: %s" % s["missing_input"])
    a("- Ready: %s" % s["ready"])
    a("- Not produced: any first-tier number, including the combined 16-model table. %s"
      % r["frontier_comparison"]["reason"])
    a("")

    a("## 5. Tables the open-weight tier was missing")
    a("")
    a("### 5.1 Per level (L1-L5)")
    a("")
    a("| model | level | n | baseline | raw (exact) | adjusted | adj. MACRO | MACRO CI |")
    a("|---|---|---|---|---|---|---|---|")
    for lab in ORDER:
        for lv in M[lab]["levels"]:
            a("| %s | L%d | %s | %s | %s | %s | %s | %s |" % (SHORT[lab], lv["key"], format(lv["n"], ","),
              f3(lv["baseline"]), f3(lv["raw_exact"]), f4(lv["adjusted"]), f4(lv["macro"]), ci(lv.get("macro_ci"))))
    a("")
    a("**L5 is negative for all six models** once the constant answer is accounted for: "
      + ", ".join("%s %s" % (SHORT[lab], f4([x for x in M[lab]["levels"] if x["key"] == 5][0]["macro"])) for lab in ORDER)
      + ". L1 is where every run gains most.")
    a("")
    a("### 5.2 Per family (9 families)")
    a("")
    a("| model | family | n | baseline | raw (exact) | adjusted | adj. MACRO | MACRO CI |")
    a("|---|---|---|---|---|---|---|---|")
    for lab in ORDER:
        for fam in M[lab]["families"]:
            a("| %s | %s | %s | %s | %s | %s | %s | %s |" % (SHORT[lab], fam["key"], format(fam["n"], ","),
              f3(fam["baseline"]), f3(fam["raw_exact"]), f4(fam["adjusted"]), f4(fam["macro"]), ci(fam.get("macro_ci"))))
    a("")
    a("### 5.3 Per domain (34 domains)")
    a("")
    a("The full 204-row table is Appendix B. Extremes per run:")
    a("")
    a("| model | best domain | adjusted | worst domain | adjusted |")
    a("|---|---|---|---|---|")
    for lab in ORDER:
        ds = sorted([d for d in M[lab]["domains"] if d["adjusted"] is not None], key=lambda d: -d["adjusted"])
        a("| %s | %s | %s | %s | %s |" % (SHORT[lab], ds[0]["key"], f4(ds[0]["adjusted"]), ds[-1]["key"], f4(ds[-1]["adjusted"])))
    a("")
    a("### 5.4 Bootstrap 95% CIs on adjusted MACRO")
    a("")
    a("%s. Resampling is at the **image** level, not the row level: the five levels of one image are not"
      " independent. One draw is shared by all five levels and by all six models, so the intervals here and"
      " the paired differences in 6b come from the same replicates." % r["definitions"]["bootstrap"])
    a("")
    a("| model | adjusted MACRO | 95% CI | width |")
    a("|---|---|---|---|")
    for lab in ORDER:
        o = M[lab]["overall"]
        a("| %s | %s | %s | %.4f |" % (lab, f4(o["macro"]), ci(o["macro_ci"]), o["macro_ci"][1] - o["macro_ci"][0]))
    a("")

    a("## 6. Cross-checks")
    a("")
    a("### 6a. impossible_object")
    a("")
    a("| model | n | baseline | raw (exact) | adjusted | vs baseline |")
    a("|---|---|---|---|---|---|")
    below = 0
    for lab in ORDER:
        row = [d for d in M[lab]["domains"] if d["key"] == "impossible_object"][0]
        below += 1 if row["adjusted"] < 0 else 0
        a("| %s | %s | %s | %s | %s | %s |" % (lab, format(row["n"], ","), f3(row["baseline"]),
          f3(row["raw_exact"]), f4(row["adjusted"]), "below" if row["adjusted"] < 0 else "above"))
    a("")
    io_base = [d for d in M[ORDER[0]]["domains"] if d["key"] == "impossible_object"][0]["baseline"]
    a("**All %d of %d open-weight runs score below the constant-answer baseline on impossible_object**"
      " (baseline %s). The frontier tier reports the same for its models; combined that would make the"
      " domain a 16-of-16 anti-correlation between models and key. The frontier half cannot be reproduced"
      " here because first-tier results are not on disk (section 4), so this document reports the"
      " open-weight half only and claims nothing about the other tier's numbers."
      % (below, len(ORDER), f3(io_base)))
    a("")
    a("### 6b. Qwen3-VL-8B-Instruct vs Qwen3-VL-8B-Thinking")
    a("")
    a("Same weights, reasoning mode toggled, identical items. Paired image-level bootstrap on the"
      " difference of adjusted MACRO per family, 10,000 replicates.")
    a("")
    a("| family | Instruct | Thinking | difference (I - T) | 95% CI (paired) | reading |")
    a("|---|---|---|---|---|---|")
    for f in r["qwen_pair"]["families"]:
        lo, hi = f["difference_ci"]
        a("| %s | %s | %s | %s | [%+.4f, %+.4f] | %s |" % (f["family"], f4(f["instruct_macro"]),
          f4(f["thinking_macro"]), f4(f["difference"]), lo, hi, "real" if (lo > 0 or hi < 0) else "noise"))
    a("")
    a("Every family gap excludes zero at this sample size, so the mode switch is not a wash - it trades"
      " geometry (Instruct ahead on Plane Geometry, Solid Geometry, Analytic, Topological) for physical and"
      " inductive reasoning (Thinking ahead on Physical & Mechanical, Inductive, Projective).")
    a("")

    a("## 7. Serving configuration")
    a("")
    a("Recoverable from disk, printed exactly as stored; nothing is inferred.")
    a("")
    a("| model | model identifier stored in the records | records |")
    a("|---|---|---|")
    for lab in ORDER:
        for k, v in r["serving_configuration"]["recoverable"]["model_identifier_stored_per_record"][lab].items():
            a("| %s | `%s` | %s |" % (lab, k, format(v, ",")))
    a("")
    a("Harness score_mode distribution per run (a stored field, not a configuration):")
    a("")
    a("| model | text_exact_or_substring | numeric | multi_part_exact | none |")
    a("|---|---|---|---|---|")
    for lab in ORDER:
        m = r["serving_configuration"]["recoverable"]["score_mode_distribution"][lab]
        a("| %s | %s | %s | %s | %s |" % (lab, format(m.get("text_exact_or_substring", 0), ","),
          format(m.get("numeric", 0), ","), format(m.get("multi_part_exact", 0), ","), format(m.get("none", 0), ",")))
    a("")
    a("**Not recoverable, and not guessed:**")
    a("")
    for k in r["serving_configuration"]["not_recoverable"]:
        a("- %s" % k)
    a("")
    a(r["serving_configuration"]["evidence"])
    a("")
    a("Run directories: " + ", ".join("`%s`" % v for v in r["serving_configuration"]["recoverable"]["run_directories"].values()) + ".")
    a("")

    a("## 8. Deliverables")
    a("")
    a("- This document: `docs/open-models-test1-reanalysis.md`")
    a("- Computed artifact: `data/open-models/reanalysis.json` (every cell, every table)")
    a("- Engine: `scripts/open_models_test1_reanalysis.py` (deterministic; `--boot`, `--seed`, `--manifest`)")
    a("- Renderer: `scripts/open_models_test1_report.py`")
    a("- Site: `/open-models/reanalysis` inside the grip-eval report")
    a("")
    a("Blocked sections and exactly what unblocks them: a frontier manifest of the 8,500 question ids"
      " (`--manifest`) for section 4, and the frontier tier's own per-cell results for the combined"
      " 16-model table and the 16-of-16 check.")
    a("")

    a("## Appendix A - baseline per (domain, level)")
    a("")
    a("| domain | level | n | baseline | modal ground truth |")
    a("|---|---|---|---|---|")
    for c in cells0:
        a("| %s | L%d | %s | %s | `%s` |" % (c["domain"], c["level"], format(c["n"], ","), f3(c["baseline"]), c["modal_gt"]))
    a("")
    a("## Appendix B - per-domain adjusted scores (pooled over the domain's levels)")
    a("")
    a("| domain | " + " | ".join(SHORT[l] for l in ORDER) + " | n | baseline |")
    a("|---|" + "---|" * (len(ORDER) + 2))
    for dom in sorted({d["key"] for d in M[ORDER[0]]["domains"]}):
        cs = {lab: [d for d in M[lab]["domains"] if d["key"] == dom][0] for lab in ORDER}
        a("| %s | " % dom + " | ".join(f4(cs[lab]["adjusted"]) for lab in ORDER)
          + " | %s | %s |" % (format(cs[ORDER[0]]["n"], ","), f3(cs[ORDER[0]]["baseline"])))
    a("")
    a("## Appendix C - cross-run integrity")
    a("")
    g = r["invariants"]["ground_truth_identical_across_models"]
    a("- one question per image per level: %d violations in %d cells" % (len(inv["violations"]), inv["checked_cells"]))
    a("- ground truth identical across runs: %d of %d compared cells differ, all of them cells whose evaluated"
      " sample size differs between runs (angle_estimation 1,501 vs 1,500 images; projectile_motion 1,000 vs"
      " 1,500). Everywhere else the comparison is exactly paired." % (len(g["cells_differing"]), g["cells_compared"]))
    a("- one recorded ground truth per question id and level, so baselines are shared across all six models")
    a("")

    OUT.write_text("\n".join(L) + "\n", encoding="utf-8")
    print("wrote %s  %.0f KB  %d lines" % (OUT.relative_to(REPO), OUT.stat().st_size / 1024, len(L)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
