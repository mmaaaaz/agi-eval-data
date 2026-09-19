#!/usr/bin/env python3
"""Test-1 reanalysis of the six open-weight runs: L5 check, constant-answer
baselines on the evaluated sample, the adjusted transform, and bootstrap CIs.

Reads only what is on disk:
  data/open-model-analysis/<run>/<model-id>/*.jsonl   stored responses
  data/open-models/models.json                        published frozen-rule scores

Writes:
  data/open-models/reanalysis.json                    every table below, for the site
  (stdout: the tables, Markdown-ready)

Definitions, fixed here so the numbers are reproducible:
  raw_exact       accuracy using the published comparison function with the
                  numeric tolerance set to zero (everything else identical:
                  normalisation, whole-word text matching, multi-part all-parts,
                  structured ground truth parsed). This is the transform input.
  raw_published   the frozen-rule accuracy already published on the site
                  (1% / 0.05 tolerance) — reported alongside, never replaced.
  baseline[d][l]  max over distinct ground-truth values of (count == v) / n,
                  computed from the model's OWN stored response set.
  adjusted        (accuracy - baseline) / (1 - baseline); baseline == 1.0 is
                  structurally constant -> excluded from every aggregate.
  MACRO           unweighted mean of per-cell adjusted over non-constant cells.
  POOLED          sum(correct) and sum(baseline*n) over non-constant cells,
                  transformed once.
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import re
import sys
import math
from pathlib import Path

import numpy as np

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

REPO = Path(__file__).resolve().parent.parent
RUNS = REPO / "data" / "open-model-analysis"
OUT = REPO / "data" / "open-models" / "reanalysis.json"

RUNS_BY_LABEL = {
    "Qwen3-VL-8B-Instruct": "Qwen3-VL-8B-Instruct/qwen3-vl-8b-instruct",
    "Qwen3-VL-8B-Thinking": "Qwen3-VL-8B-Thinking/qwen3-vl-8b-thinking",
    "Molmo2-8B": "Molmo2-8B/molmo2-8b",
    "InternVL3.5-8B": "InternVL3_5-8B/internvl3_5-8b",
    "Kimi-VL-A3B-Thinking": "Kimi-VL-A3B-Thinking/kimi-vl-a3b-thinking",
    "DeepSeek-VL2-Small": "deepseek-vl2-small/deepseek-vl2-small",
}
FAMILIES = {
    "Plane Geometry": ["nested_squares", "nested_triangles", "nested_hexagons", "line_intersection", "angle_estimation"],
    "Solid Geometry": ["cube_net", "cube_structure", "combination3d", "orthographic", "polyhedron", "depth_height"],
    "Transformational": ["rotation_matching", "symmetry_pattern", "fold_punch", "combination", "embedded_figures", "overlap_circles"],
    "Physical & Mechanical": ["physical_stability", "gear_train", "fbd", "projectile_motion", "laser_mirror", "clock_reading", "gauge_reading"],
    "Topological": ["surface_topology", "route", "hex_pathfinding"],
    "Projective": ["occluded_pattern", "shadow_inference"],
    "Analytic": ["coordinate_geometry", "compass_bearing"],
    "Optical": ["optical_illusion", "impossible_object"],
    "Inductive": ["rpm"],
}
IMG = re.compile(r"^(.*)_(\d{4})_q(\d+)$")

# ---------------------------------------------------------------- scoring ---

NUMPAT = re.compile(r"[-+]?\d*\.?\d+")
WORD = re.compile(r"[a-z0-9]")


def to_num(s):
    try:
        return float(s)
    except Exception:
        return None


def norm(s) -> str:
    s = str(s).lower()
    s = re.sub(r"[\"'\x60{}\[\]()]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return re.sub(r"[.]+$", "", s).strip()


def bmatch(hay: str, part: str) -> bool:
    if not part:
        return False
    if hay == part:
        return True
    start = 0
    while True:
        i = hay.find(part, start)
        if i < 0:
            return False
        before = hay[i - 1] if i > 0 else ""
        after = hay[i + len(part)] if i + len(part) < len(hay) else ""
        if not WORD.match(before or " ") and not WORD.match(after or " "):
            return True
        start = i + 1


def nums(s):
    return [v for v in (to_num(t) for t in NUMPAT.findall(str(s))) if v is not None]


def committed_segment(pred):
    t = str(pred)
    m = list(re.finditer(r"FINAL ANSWER\s*[:\-]\s*([^\n]+)", t, re.I))
    if m:
        return m[-1].group(1)
    m = list(re.finditer(r"(?:the\s+)?(?:correct\s+)?(?:final\s+)?answer\s*(?:is|:)\s*([^\n]+)", t, re.I))
    if m:
        return m[-1].group(1)
    return t


def flatten(v, out):
    import ast as _ast  # noqa: F401  (kept local to mirror the published rule)

    if isinstance(v, dict):
        for vv in v.values():
            flatten(vv, out)
    elif isinstance(v, (list, tuple)):
        if v and all(isinstance(x, (list, tuple)) for x in v):
            out.append(("rank", [[str(y).strip() for y in g] for g in v]))
        else:
            for vv in v:
                flatten(vv, out)
    elif isinstance(v, bool):
        out.append(("text", "yes" if v else "no"))
    elif isinstance(v, (int, float)):
        out.append(("num", float(v)))
    else:
        sv = str(v).strip()
        if re.fullmatch(r"[-+]?\d+(\.\d+)?", sv):
            out.append(("num", float(sv)))
        elif ">" in sv or "=" in sv:
            out.append(("rank", [[x.strip() for x in re.split(r"[>=]+", sv)]]))
        else:
            out.append(("text", sv))


def gt_parts(gt):
    import ast as _ast

    s = str(gt).strip()
    parsed = None
    if s[:1] in "{[":
        try:
            parsed = _ast.literal_eval(s)
        except Exception:
            parsed = None
    if isinstance(parsed, (dict, list)):
        out = []
        flatten(parsed, out)
        return out, "structured"
    if ";" in s:
        return [("text", p) for p in s.split(";")], "multipart"
    n = to_num(s)
    return ([("num", n)] if n is not None else [("text", s)]), "plain"


def rank_ok(pred, groups) -> bool:
    hay = norm(pred)
    order = []
    for g in groups:
        for tok in g:
            i = hay.find(norm(tok))
            if i < 0:
                return False
            order.append((i, tuple(g)))
    order.sort()
    seen = []
    for _, g in order:
        if not seen or seen[-1] != g:
            seen.append(g)
    return seen == [tuple(g) for g in groups]


def grade(gt, pred, tolerance: float):
    """The published comparison function. tolerance=0.0 -> exact numeric match."""
    if pred is None or str(pred).strip() == "":
        return 0
    parts, _kind = gt_parts(gt)
    if not parts:
        return 0
    hay = norm(pred)
    seg = committed_segment(pred)
    seg_nums = nums(seg)
    pool = seg_nums if seg_nums else nums(pred)
    for typ, val in parts:
        if typ == "num":
            hit = any(abs(x - val) <= tolerance for x in pool)
        elif typ == "rank":
            hit = rank_ok(pred, val)
        else:
            hit = bmatch(hay, norm(val))
        if not hit:
            return 0
    return 1


# ------------------------------------------------------------------- data ---

def load_run(dirname: str, tolerance: float):
    """Read one run. Returns per-(domain, level) counts plus per-image arrays.

    The per-image arrays are what the bootstrap resamples; they are built here so
    the raw records never have to be held in memory twice.
    """
    base = RUNS / dirname
    cells = collections.defaultdict(lambda: {"n": 0, "exact": 0, "gt": collections.Counter()})
    per_img = collections.defaultdict(lambda: collections.defaultdict(lambda: [0, 0]))
    levels = collections.Counter()
    modes = collections.Counter()
    model_ids = collections.Counter()
    for f in sorted(base.glob("*.jsonl")):
        dom = f.name.replace(".jsonl", "").replace("_dataset_3000", "").replace("_dataset_1000", "")
        for line in open(f, encoding="utf-8", errors="replace"):
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            lv = int(r["level"])
            gt, pred = r.get("groundtruth"), r.get("prediction")
            hit = grade(gt, pred, tolerance)
            c = cells[(dom, lv)]
            c["n"] += 1
            c["exact"] += hit
            c["gt"][str(gt)] += 1
            levels[lv] += 1
            modes[r.get("score_mode") or "none"] += 1
            model_ids[r.get("model")] += 1
            m = IMG.match(r.get("question_id") or "")
            if m:
                slot = per_img[(dom, lv)][int(m.group(2))]
                slot[0] += 1
                slot[1] += hit
    arrays = {}
    for cell, imgs in per_img.items():
        keys = np.array(sorted(imgs), dtype=np.int64)
        arrays[cell] = (keys,
                        np.array([imgs[k][0] for k in keys], dtype=np.float64),
                        np.array([imgs[k][1] for k in keys], dtype=np.float64))
    return cells, arrays, levels, modes, model_ids


def baseline_of(counter: collections.Counter, n: int):
    if not n:
        return None, None
    v, k = counter.most_common(1)[0]
    return k / n, v


def adjusted(acc, base):
    if base is None or base >= 1.0:
        return None
    return (acc - base) / (1.0 - base)


def cell_rows(cells, pub_cell, model_id):
    rows = []
    for (dom, lv), c in sorted(cells.items()):
        base, modal = baseline_of(c["gt"], c["n"])
        acc = c["exact"] / c["n"]
        rows.append({
            "domain": dom,
            "level": lv,
            "n": c["n"],
            "baseline": base,
            "modal_gt": modal,
            "raw_exact": acc,
            "raw_published": pub_cell.get((model_id, dom, lv)),
            "exact_n": c["exact"],
            "adjusted": adjusted(acc, base),
            "n_lt_10": c["n"] < 10,
        })
    return rows


def aggregate(rows):
    ok = [r for r in rows if r["adjusted"] is not None]
    const = [r for r in rows if r["baseline"] is not None and r["baseline"] >= 1.0]
    n_sum = sum(r["n"] for r in ok)
    c_sum = sum(r["exact_n"] for r in ok)
    b_sum = sum(r["baseline"] * r["n"] for r in ok)
    acc = c_sum / n_sum if n_sum else None
    base = b_sum / n_sum if n_sum else None
    pooled = ((c_sum - b_sum) / (n_sum - b_sum)) if (n_sum - b_sum) > 0 else None
    return {
        "macro": float(np.mean([r["adjusted"] for r in ok])) if ok else None,
        "pooled": pooled,
        "adjusted": pooled,
        "n": n_sum,
        "correct": c_sum,
        "baseline_expected": b_sum,
        "raw_exact": acc,
        "baseline": base,
        "cells": len(rows),
        "cells_used": len(ok),
        "cells_constant": len(const),
        "n_lt_10": sum(1 for r in ok if r["n"] < 10),
    }


def grouped(rows, keyfn):
    g = collections.defaultdict(list)
    for r in rows:
        g[keyfn(r)].append(r)
    out = []
    for k, rs in sorted(g.items(), key=lambda kv: (str(kv[0]))):
        a = aggregate(rs)
        a["key"] = k
        out.append(a)
    return out


def boot_all(arrays, cell_order, B, seed, base_map, chunk=500):
    """Image-level bootstrap, one shared draw per (replicate, domain).

    The same draw feeds all five levels and every model, so replicate r of each
    returned matrix is the same sample of images — which is what makes the paired
    model-vs-model family differences valid. Baselines held fixed.
    """
    rng = np.random.default_rng(seed)
    labels = list(arrays)
    n_cells = len(cell_order)
    base_vec = np.array([base_map.get(c, np.nan) if base_map.get(c) is not None else np.nan for c in cell_order])
    use = ~np.isnan(base_vec) & (base_vec < 1.0)
    inv = np.where(use, 1.0 / np.where(use, 1.0 - base_vec, 1.0), np.nan)
    adj = {lab: np.full((B, n_cells), np.nan) for lab in labels}
    pooled = {lab: np.full(B, np.nan) for lab in labels}

    for b0 in range(0, B, chunk):
        b1 = min(B, b0 + chunk)
        nb = b1 - b0
        acc = {lab: np.zeros((nb, n_cells)) for lab in labels}
        nmat = {lab: np.zeros((nb, n_cells)) for lab in labels}
        idx_cache: dict = {}
        for j, cell in enumerate(cell_order):
            dom = cell[0]
            if dom not in idx_cache:
                ref = arrays[labels[0]][cell][0]
                idx_cache[dom] = rng.integers(0, len(ref), size=(nb, len(ref)))
            idx = idx_cache[dom]
            for lab in labels:
                _keys, n_arr, c_arr = arrays[lab][cell]
                nmat[lab][:, j] = n_arr[idx].sum(axis=1)
                acc[lab][:, j] = c_arr[idx].sum(axis=1)
        for lab in labels:
            with np.errstate(invalid="ignore", divide="ignore"):
                a = acc[lab] / nmat[lab]
            adj[lab][b0:b1] = (a - base_vec) * inv
            num = np.nansum((acc[lab] - base_vec * nmat[lab]) * use, axis=1)
            den = np.nansum((nmat[lab] - base_vec * nmat[lab]) * use, axis=1)
            with np.errstate(invalid="ignore", divide="ignore"):
                pooled[lab][b0:b1] = num / den
    return adj, pooled


def pct_ci(x, lo=2.5, hi=97.5):
    x = np.asarray(x, dtype=np.float64)
    x = x[~np.isnan(x)]
    if not len(x):
        return None
    return [float(np.percentile(x, lo)), float(np.percentile(x, hi))]


def macro_series(adj_mat, cell_order, base_map, keys=None):
    cols = [j for j, c in enumerate(cell_order)
            if base_map.get(c) is not None and base_map[c] < 1.0 and (keys is None or c[0] in keys)]
    if not cols:
        return None
    return np.nanmean(adj_mat[:, cols], axis=1)


# --------------------------------------------------------------- serving ----

def serving_audit(model_ids, modes, runs):
    return {
        "recoverable": {
            "model_identifier": dict(model_ids),
            "score_mode_distribution": dict(modes),
            "run_directory": runs,
        },
        "not_recoverable": [
            "checkpoint revision / commit hash",
            "numeric precision (fp16 / bf16 / int8 / int4)",
            "inference engine and version",
            "decoding parameters (temperature, top_p, max_tokens, seed)",
            "served locally vs through a hosted provider",
            "run date range (file timestamps are copy times, see evidence)",
        ],
        "evidence": (
            "Every run directory contains exactly 34 .jsonl files and nothing else; all 204 files "
            "share one identical 10-field schema (question_id, domain, level, model, raw_response, "
            "prediction, groundtruth, correct, score_mode, error). No launch script, config, log, "
            "manifest or run metadata exists anywhere in the repository or on this machine's project "
            "tree (searched by name and by content for vllm / sglang / lmdeploy / temperature / "
            "max_tokens / fp16 / bf16 / int4 / quantization)."
        ),
    }
# ------------------------------------------------------------------- main ---

MODEL_ID = {
    "Qwen3-VL-8B-Instruct": "qwen3-vl-8b-instruct",
    "Qwen3-VL-8B-Thinking": "qwen3-vl-8b-thinking",
    "Molmo2-8B": "molmo2-8b",
    "InternVL3.5-8B": "internvl3_5-8b",
    "Kimi-VL-A3B-Thinking": "kimi-vl-a3b-thinking",
    "DeepSeek-VL2-Small": "deepseek-vl2-small",
}


def load_manifest(path: Path):
    """Question ids of a frontier manifest. Accepts json / jsonl / csv."""
    ids = set()
    text = path.read_text(encoding="utf-8", errors="replace")
    if path.suffix == ".jsonl":
        for line in text.splitlines():
            line = line.strip()
            if line:
                j = json.loads(line)
                qid = j.get("question_id") or j.get("id")
                if qid:
                    ids.add(str(qid))
        return ids
    if path.suffix == ".csv":
        import csv
        import io

        rd = csv.DictReader(io.StringIO(text))
        col = next((c for c in (rd.fieldnames or []) if c and "question" in c.lower()), "question_id")
        for row in rd:
            if row.get(col):
                ids.add(str(row[col]))
        return ids
    j = json.loads(text)
    rows = j.get("rows") if isinstance(j, dict) else j
    for r in rows or []:
        qid = r if isinstance(r, str) else (r.get("question_id") or r.get("id"))
        if qid:
            ids.add(str(qid))
    return ids


def run_pass(keep=None):
    """One pass over every run. keep = optional set of question ids to keep."""
    cells_by_model, arrays, levels_by_model = {}, {}, {}
    modes_by_model, ids_by_model = {}, {}
    for label, dirname in RUNS_BY_LABEL.items():
        base = RUNS / dirname
        cells = collections.defaultdict(lambda: {"n": 0, "exact": 0, "gt": collections.Counter()})
        per_img = collections.defaultdict(lambda: collections.defaultdict(lambda: [0, 0]))
        levels, modes, mids = collections.Counter(), collections.Counter(), collections.Counter()
        for f in sorted(base.glob("*.jsonl")):
            dom = f.name.replace(".jsonl", "").replace("_dataset_3000", "").replace("_dataset_1000", "")
            for line in open(f, encoding="utf-8", errors="replace"):
                line = line.strip()
                if not line:
                    continue
                r = json.loads(line)
                qid = str(r.get("question_id") or "")
                if keep is not None and qid not in keep:
                    continue
                lv = int(r["level"])
                gt, pred = r.get("groundtruth"), r.get("prediction")
                hit = grade(gt, pred, 0.0)
                c = cells[(dom, lv)]
                c["n"] += 1
                c["exact"] += hit
                c["gt"][str(gt)] += 1
                levels[lv] += 1
                modes[r.get("score_mode") or "none"] += 1
                mids[r.get("model")] += 1
                m = IMG.match(qid)
                if m:
                    slot = per_img[(dom, lv)][int(m.group(2))]
                    slot[0] += 1
                    slot[1] += hit
        arr = {}
        for cell, imgs in per_img.items():
            keys = np.array(sorted(imgs), dtype=np.int64)
            arr[cell] = (keys,
                         np.array([imgs[k][0] for k in keys], dtype=np.float64),
                         np.array([imgs[k][1] for k in keys], dtype=np.float64))
        cells_by_model[label] = cells
        arrays[label] = arr
        levels_by_model[label] = levels
        modes_by_model[label] = modes
        ids_by_model[label] = mids
    return cells_by_model, arrays, levels_by_model, modes_by_model, ids_by_model


def align(arrays, cell_order):
    """Re-index every model's per-image arrays onto one union key list per cell, so
    resampling draws land on the same images for every model."""
    for cell in cell_order:
        union = np.array(sorted({int(k) for lab in arrays for k in arrays[lab].get(cell, ([], [], []))[0]}), dtype=np.int64)
        for lab in arrays:
            if cell not in arrays[lab]:
                arrays[lab][cell] = (union, np.zeros(len(union)), np.zeros(len(union)))
                continue
            keys, n_arr, c_arr = arrays[lab][cell]
            pos = np.searchsorted(union, keys)
            nn, cc = np.zeros(len(union)), np.zeros(len(union))
            nn[pos] = n_arr
            cc[pos] = c_arr
            arrays[lab][cell] = (union, nn, cc)
    return arrays


def analyse(cells_by_model, arrays, pub_cell, base_map, B, seed, tag):
    cell_order = sorted(cells_by_model[next(iter(cells_by_model))])
    align(arrays, cell_order)
    adj, pooled = boot_all(arrays, cell_order, B, seed, base_map)
    fam_cells = {f: [c for c in cell_order if c[0] in ds] for f, ds in FAMILIES.items()}
    out = {"tag": tag, "cells": len(cell_order), "models": {}}
    for label in cells_by_model:
        rows = cell_rows(cells_by_model[label], pub_cell, MODEL_ID[label])
        overall = aggregate(rows)
        overall["macro_ci"] = pct_ci(macro_series(adj[label], cell_order, base_map))
        overall["pooled_ci"] = pct_ci(pooled[label])
        small = [r for r in rows if not r["n_lt_10"]]
        out["models"][label] = {
            "overall": overall,
            "supplementary_no_small_cells": {
                "macro": aggregate(small)["macro"],
                "cells_dropped": sum(1 for r in rows if r["n_lt_10"]),
                "note": "primary aggregates keep n<10 cells; this is the same mean with them removed",
            },
            "levels": [],
            "domains": [],
            "families": [],
            "cells": rows,
            "constant_cells": [r for r in rows if r["baseline"] is not None and r["baseline"] >= 1.0],
        }
        for grp, keyfn in (
            ("levels", lambda r: r["level"]),
            ("domains", lambda r: r["domain"]),
            ("families", lambda r: next(f for f, ds in FAMILIES.items() if r["domain"] in ds)),
        ):
            for entry in grouped(rows, keyfn):
                keys = set(entry.pop("_") if False else [])
                subset = [r for r in rows if keyfn(r) == entry["key"]]
                cols = [j for j, c in enumerate(cell_order)
                        if base_map.get(c) is not None and base_map[c] < 1.0 and keyfn({"domain": c[0], "level": c[1]}) == entry["key"]]
                if cols:
                    entry["macro_ci"] = pct_ci(np.nanmean(adj[label][:, cols], axis=1))
                entry["n_used"] = sum(r["n"] for r in subset if r["adjusted"] is not None)
                out["models"][label][grp].append(entry)
    # paired cross-check: same weights, reasoning mode toggled
    a_lab, b_lab = "Qwen3-VL-8B-Instruct", "Qwen3-VL-8B-Thinking"
    if a_lab in cells_by_model and b_lab in cells_by_model:
        d = adj[a_lab] - adj[b_lab]
        rows_a = {r["domain"]: r for r in out["models"][a_lab]["cells"]}
        rows_b = {r["domain"]: r for r in out["models"][b_lab]["cells"]}
        fam = []
        for f, ds in FAMILIES.items():
            cols = [j for j, c in enumerate(cell_order) if c[0] in ds and base_map.get(c) is not None and base_map[c] < 1.0]
            if not cols:
                continue
            ca = [r for r in out["models"][a_lab]["cells"] if r["domain"] in ds and r["adjusted"] is not None]
            cb = [r for r in out["models"][b_lab]["cells"] if r["domain"] in ds and r["adjusted"] is not None]
            point = float(np.mean([r["adjusted"] for r in ca])) - float(np.mean([r["adjusted"] for r in cb])) if ca and cb else None
            fam.append({
                "family": f,
                "instruct_macro": float(np.mean([r["adjusted"] for r in ca])) if ca else None,
                "thinking_macro": float(np.mean([r["adjusted"] for r in cb])) if cb else None,
                "difference": point,
                "difference_ci": pct_ci(np.nanmean(d[:, cols], axis=1)),
                "cells": len(cols),
            })
        out["qwen_pair"] = {
            "a": a_lab, "b": b_lab, "difference_definition": "adjusted MACRO (Instruct) - adjusted MACRO (Thinking), paired image-level bootstrap",
            "families": fam,
        }
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--boot", type=int, default=10000)
    ap.add_argument("--seed", type=int, default=20260918)
    ap.add_argument("--manifest", type=str, default=None, help="frontier manifest of question ids (8,500 rows)")
    args = ap.parse_args()

    published = json.loads((REPO / "data" / "open-models" / "models.json").read_text(encoding="utf-8"))
    pub_cell = {}
    for model in published["models"]:
        for d in published["domains"]:
            row = next((p for p in d["per"] if p["model"] == model["id"]), None)
            if row:
                for i, lvl in enumerate(row["levels"]):
                    pub_cell[(model["id"], d["key"], i + 1)] = lvl["acc"]

    cells6, arrays6, levels6, modes6, ids6 = run_pass(None)
    ref = next(iter(cells6))
    base_map = {(dom, lv): baseline_of(c["gt"], c["n"])[0] for (dom, lv), c in cells6[ref].items()}

    # ---- 1. L5 check + invariants ----
    level_counts, verdicts, violations = {}, {}, []
    for label in cells6:
        lc = {str(k): levels6[label][k] for k in range(1, 6)}
        level_counts[label] = lc
        missing = [k for k in range(1, 6) if lc[str(k)] == 0]
        verdicts[label] = {
            "verdict": "a" if not missing else "b",
            "l5_present": lc["5"] > 0,
            "l5_responses": lc["5"],
            "missing_levels": missing,
            "note": "L5 responses are stored, scored and already published on the site (the published report shows L1-L5).",
        }
        for (dom, lv), c in cells6[label].items():
            keys, n_arr, c_arr = arrays6[label][(dom, lv)]
            if int(n_arr.sum()) != c["n"] or int((n_arr > 0).sum()) != c["n"]:
                violations.append({"model": label, "domain": dom, "level": lv,
                                   "records": c["n"], "images": int((n_arr > 0).sum())})

    gt_mismatch = []
    for label in cells6:
        if label == ref:
            continue
        for cell, c in cells6[label].items():
            if cell in cells6[ref] and c["gt"] != cells6[ref][cell]["gt"]:
                gt_mismatch.append({"model": label, "cell": list(cell),
                                    "n_model": c["n"], "n_ref": cells6[ref][cell]["n"]})

    full = analyse(cells6, arrays6, pub_cell, base_map, args.boot, args.seed, "full-sample")
    full["level_counts"] = level_counts
    full["l5_verdicts"] = verdicts
    full["invariants"] = {
        "one_question_per_image_per_level": {"violations": violations, "checked_cells": sum(len(v) for v in cells6.values())},
        "ground_truth_identical_across_models": {
            "cells_compared": sum(len(c) for c in cells6.values()) - len(cells6[ref]),
            "cells_differing": gt_mismatch,
            "note": "differences are limited to cells whose evaluated sample size differs between runs (angle_estimation 1,501 vs 1,500 images; projectile_motion 1,000 vs 1,500)",
        },
    }
    full["serving_configuration"] = {
        "recoverable": {
            "model_identifier_stored_per_record": {lab: dict(ids6[lab]) for lab in ids6},
            "score_mode_distribution": {lab: dict(modes6[lab]) for lab in modes6},
            "run_directories": {lab: str((RUNS / d).relative_to(REPO)) for lab, d in RUNS_BY_LABEL.items()},
        },
        "not_recoverable": [
            "checkpoint revision or commit hash", "numeric precision (fp16 / bf16 / int8 / int4)",
            "inference engine and version", "decoding parameters (temperature, top_p, max_tokens, seed)",
            "served locally or through a hosted provider", "run date range beyond file timestamps",
        ],
        "evidence": ("Each run directory holds exactly 34 .jsonl files and nothing else; all 204 files share one "
                     "identical 10-field schema. No launch script, config, log or run metadata exists in the "
                     "repository or the project tree (searched by filename and by content for vllm / sglang / "
                     "lmdeploy / temperature / top_p / max_tokens / fp16 / bf16 / int4 / quantization)."),
    }

    # ---- 4. tier-comparison subset ----
    if args.manifest:
        mpath = Path(args.manifest)
        if not mpath.exists():
            full["subset_8500"] = {"status": "blocked", "reason": f"manifest not found: {mpath}"}
        else:
            ids = load_manifest(mpath)
            cells_s, arrays_s, levels_s, _m, _i = run_pass(ids)
            base_s = {(dom, lv): baseline_of(c["gt"], c["n"])[0] for (dom, lv), c in cells_s[ref].items()}
            sub = analyse(cells_s, arrays_s, pub_cell, base_s, args.boot, args.seed, "subset-8500")
            sub["manifest"] = {"path": str(mpath), "rows": len(ids)}
            matched = {}
            for label in cells_s:
                have = sum(c["n"] for c in cells_s[label].values())
                matched[label] = {"stored_responses": have, "rows": len(ids), "missing_rows": len(ids) - have}
            sub["coverage"] = matched
            full["subset_8500"] = sub
    else:
        full["subset_8500"] = {
            "status": "blocked",
            "reason": ("no frontier manifest on disk: the 8,500-row id list this section joins on does not exist in the "
                       "repository or the project tree. Searched for *frontier*, *manifest*, *8500* by name (project tree and "
                       "D: to depth 4) and for 'frontier' by content, and inspected the only candidate directories."),
            "missing_input": "a file with the 8,500 question ids the frontier tier was evaluated on (json / jsonl / csv with a question_id column) — pass it with --manifest",
            "ready": "the whole subset pipeline is implemented: with --manifest it re-runs baselines on the subset, joins per model, reports coverage and missing rows, and emits the subset tables and CIs",
        }
    full["frontier_comparison"] = {
        "status": "blocked",
        "reason": ("the frontier tier's own results are not on disk either, so the 16-model combined table and the "
                   "'16 of 16 below baseline' check cannot be reproduced or verified locally"),
        "missing_input": "frontier per-cell correct counts and baselines (or their stored responses) for the same manifest rows",
    }

    full["generated"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    full["definitions"] = {
        "raw_exact": "the published comparison function with the numeric tolerance set to zero (normalisation, whole-word text matching, multi-part all-parts and structured ground truth parsing unchanged)",
        "raw_published": "the frozen-rule accuracy already published on the site (1% / 0.05 tolerance)",
        "baseline": "max over distinct stored ground-truth values of (count == v) / n, per (domain, level), computed from the model's own evaluated response set",
        "adjusted": "(accuracy - baseline) / (1 - baseline); baseline == 1.0 is excluded from all aggregates",
        "macro": "unweighted mean of per-cell adjusted scores over non-constant cells",
        "pooled": "sum(correct) and sum(baseline*n) over non-constant cells, transformed once",
        "bootstrap": f"image-level resampling, {args.boot} resamples, one shared draw per replicate across levels and models, baselines held fixed",
    }
    OUT.write_text(json.dumps(full, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT.relative_to(REPO)}  {OUT.stat().st_size/1024:.0f} KB")
    print("\n%-24s %10s %22s %10s %22s" % ("model", "MACRO", "MACRO 95% CI", "POOLED", "POOLED 95% CI"))
    for label, m in sorted(full["models"].items(), key=lambda kv: -(kv[1]["overall"]["macro"] or -9)):
        o = m["overall"]
        print("%-24s %10.4f  [%7.4f, %7.4f] %10.4f  [%7.4f, %7.4f]" % (
            label, o["macro"], o["macro_ci"][0], o["macro_ci"][1], o["pooled"], o["pooled_ci"][0], o["pooled_ci"][1]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
