#!/usr/bin/env python3
"""Grain-robustness sweep: the same benchmark questions on grain-corrupted images.

WHAT IS IN data/grain_test (verified, not assumed):
  <run>/<model-id>/*.jsonl, one file per domain, records carry the main schema
  (question_id, domain, level, model, raw_response, prediction, groundtruth,
  correct, score_mode, error) and the question_id carries the condition as a
  suffix: <domain>_<img4>_q<k>_sigma15 | _sigma25 | _sigma40.

  * three conditions per model: sigma15, sigma25, sigma40
  * 34 domains x 5 levels x 250 images = 42,500 records per condition
  * the SAME 250 images per domain in all three conditions
  * every base question id (suffix stripped) exists in the main run with
    byte-identical ground truth, so grain vs main is a paired comparison
  * Qwen3-VL-8B-Instruct sigma40 is incomplete: 187 records absent
    (laser_mirror 156, orthographic 31)

Method: for each condition, both sides are restricted to the exact same base
question ids, so the delta isolates the image condition. Two comparisons are
reported:
  all      - every stored record (a missing prediction counts as wrong)
  parsed   - only records where BOTH sides produced a usable short answer, which
             removes the extraction difference (Qwen's main run leaves 3.8% of
             answers unparsed against 0.8% under grain)
Deltas get paired image-level bootstrap CIs (images resampled within a domain,
one draw shared by every condition and both sides).
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import re
import sys
from pathlib import Path

import numpy as np

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))
from open_models_test1_reanalysis import grade  # the published comparison function, tolerance 0

RUNS = REPO / "data" / "open-model-analysis"
GRAIN = REPO / "data" / "grain_test"
OUT = REPO / "data" / "open-models" / "grain.json"
SUF = re.compile(r"^(.*_q\d+)_(sigma\d+)$")
IMG = re.compile(r"^(.*)_(\d{4})_q(\d+)$")
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


def usable(pred) -> bool:
    return bool(str(pred or "").strip()) and len(str(pred)) <= 120


def dom_of(name: str) -> str:
    return name.replace(".jsonl", "").replace("_dataset_3000", "").replace("_dataset_1000", "")


def discover():
    """grain run dir -> (label, grain_dir, main_dir)"""
    found = {}
    for top in sorted(GRAIN.iterdir()):
        if not top.is_dir():
            continue
        inner = [p for p in sorted(top.iterdir()) if p.is_dir()] if not list(top.glob("*.jsonl")) else [top]
        for d in inner:
            files = sorted(d.glob("*.jsonl"))
            if not files:
                continue
            with open(files[0], encoding="utf-8", errors="replace") as fh:
                model_id = json.loads(fh.readline()).get("model") or d.name
            main = RUNS / top.name / d.name
            if not main.exists():
                main = next((p for p in RUNS.rglob(d.name) if p.is_dir()), None)
            found[top.name] = {"label": top.name, "id": model_id, "grain_dir": d, "main_dir": main}
    return found


def read_grain(path: Path):
    """-> per condition: {(dom, level): {'n','exact','gt', 'img': {img: [n, exact, usable_n]}}}"""
    cells = collections.defaultdict(lambda: collections.defaultdict(
        lambda: {"n": 0, "exact": 0, "gt": collections.Counter(), "img": collections.defaultdict(lambda: [0, 0, 0])}))
    ids = collections.defaultdict(set)
    for f in sorted(path.glob("*.jsonl")):
        dom = dom_of(f.name)
        for line in open(f, encoding="utf-8", errors="replace"):
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            m = SUF.match(r.get("question_id") or "")
            if not m:
                continue
            base, cond = m.group(1), m.group(2)
            lv = int(r["level"])
            c = cells[cond][(dom, lv)]
            hit = grade(r.get("groundtruth"), r.get("prediction"), 0.0)
            c["n"] += 1
            c["exact"] += hit
            c["gt"][str(r.get("groundtruth"))] += 1
            im = IMG.match(base)
            if im:
                slot = c["img"][int(im.group(2))]
                slot[0] += 1
                slot[1] += hit
                slot[2] += 1 if usable(r.get("prediction")) else 0
            ids[cond].add(base)
    return cells, ids


def read_main(path: Path, keep_by_cond: dict):
    """Same shape as read_grain, restricted to the ids each condition used."""
    cells = collections.defaultdict(lambda: collections.defaultdict(
        lambda: {"n": 0, "exact": 0, "gt": collections.Counter(), "img": collections.defaultdict(lambda: [0, 0, 0])}))
    for f in sorted(path.glob("*.jsonl")):
        dom = dom_of(f.name)
        for line in open(f, encoding="utf-8", errors="replace"):
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            qid = r.get("question_id") or ""
            lv = int(r["level"])
            im = IMG.match(qid)
            for cond, keep in keep_by_cond.items():
                if qid not in keep:
                    continue
                c = cells[cond][(dom, lv)]
                hit = grade(r.get("groundtruth"), r.get("prediction"), 0.0)
                c["n"] += 1
                c["exact"] += hit
                c["gt"][str(r.get("groundtruth"))] += 1
                if im:
                    slot = c["img"][int(im.group(2))]
                    slot[0] += 1
                    slot[1] += hit
                    slot[2] += 1 if usable(r.get("prediction")) else 0
    return cells


def paired_bootstrap(grain_cells, main_cells, conds, mode, B, seed):
    """Image-level paired bootstrap of (grain - main) exact accuracy.

    mode='all' uses every record; mode='parsed' uses only images where both sides
    produced usable answers (per image, per cell, requiring full agreement).
    """
    rng = np.random.default_rng(seed)
    cells_all = sorted({c for cond in conds for c in grain_cells[cond]})
    idx_of = {c: i for i, c in enumerate(cells_all)}
    ncell = len(cells_all)
    delta = {cond: np.full(B, np.nan) for cond in conds}
    for cond in conds:
        for b0 in range(0, B, 1000):
            b1 = min(B, b0 + 1000)
            nb = b1 - b0
            num = np.zeros(nb)
            den = np.zeros(nb)
            for cell in cells_all:
                g = grain_cells[cond].get(cell)
                m = main_cells[cond].get(cell)
                if not g or not m:
                    continue
                keys = sorted(set(g["img"]) | set(m["img"]))
                if not keys:
                    continue
                gi = np.array([g["img"][k][1] if k in g["img"] else 0 for k in keys], dtype=np.float64)
                gn = np.array([g["img"][k][0] if k in g["img"] else 0 for k in keys], dtype=np.float64)
                mi = np.array([m["img"][k][1] if k in m["img"] else 0 for k in keys], dtype=np.float64)
                mn = np.array([m["img"][k][0] if k in m["img"] else 0 for k in keys], dtype=np.float64)
                if mode == "parsed":
                    gu = np.array([g["img"][k][2] if k in g["img"] else 0 for k in keys], dtype=np.float64)
                    mu = np.array([m["img"][k][2] if k in m["img"] else 0 for k in keys], dtype=np.float64)
                    ok = (gu > 0) & (mu > 0) & (gn > 0) & (mn > 0)
                    if not ok.any():
                        continue
                    keys_ok = np.array(keys)[ok]
                    gidx = {k: i for i, k in enumerate(keys)}
                    sel = np.array([gidx[k] for k in keys_ok])
                    gi, gn, mi, mn = gi[sel], gn[sel], mi[sel], mn[sel]
                else:
                    keys = np.array(keys)
                draw = rng.integers(0, len(gi), size=(nb, len(gi)))
                num += gi[draw].sum(axis=1) / np.where(gn[draw].sum(axis=1) == 0, np.nan, gn[draw].sum(axis=1)) \
                    - mi[draw].sum(axis=1) / np.where(mn[draw].sum(axis=1) == 0, np.nan, mn[draw].sum(axis=1))
                den += 1
            with np.errstate(invalid="ignore"):
                delta[cond][b0:b1] = num / np.where(den == 0, np.nan, den)
    return {c: [float(np.nanpercentile(delta[c], 2.5)), float(np.nanpercentile(delta[c], 97.5))] for c in conds}


def total(cells_by_cond, cond, keyf=lambda cell: True):
    n = c = 0
    for cell, v in cells_by_cond[cond].items():
        if keyf(cell):
            n += v["n"]
            c += v["exact"]
    return n, c


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--boot", type=int, default=10000)
    ap.add_argument("--seed", type=int, default=20260922)
    args = ap.parse_args()

    found = discover()
    out = {
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "what_it_is": {
            "conditions": ["sigma15", "sigma25", "sigma40"],
            "images_per_domain": 250,
            "records_per_condition": 42500,
            "verified": [
                "every base question id exists in the main run with byte-identical ground truth",
                "the same 250 images per domain are used in all three conditions",
                "median prediction and raw-response lengths match the main run within 4%",
                "score_mode distribution matches the main run",
            ],
            "unverifiable": [
                "the exact noise transform: the files carry only the sigma15/25/40 label, no generator config, no images",
                "whether sigma is additive Gaussian standard deviation, or any other parameterisation",
                "the run date, engine, precision and decoding parameters (absent, as for the main runs)",
            ],
        },
        "models": {},
    }

    for label, info in found.items():
        grain_cells, ids = read_grain(info["grain_dir"])
        main_cells = read_main(info["main_dir"], ids)
        conds = sorted(grain_cells)
        ci_all = paired_bootstrap(grain_cells, main_cells, conds, "all", args.boot, args.seed)
        ci_parsed = paired_bootstrap(grain_cells, main_cells, conds, "parsed", args.boot, args.seed)

        per_cond = []
        for cond in conds:
            gn, gc = total(grain_cells, cond)
            mn, mc = total(main_cells, cond)
            # parsed-only totals
            pn = pc = pmn = pmc = 0
            for cell, g in grain_cells[cond].items():
                m = main_cells[cond].get(cell)
                if not m:
                    continue
                for k, gv in g["img"].items():
                    mv = m["img"].get(k)
                    if gv[0] and gv[2] and mv and mv[0] and mv[2]:
                        pn += gv[0]; pc += gv[1]; pmn += mv[0]; pmc += mv[1]
            # macro delta: unweighted mean of the per-cell (grain - main) differences,
            # which is what the bootstrap resamples; pooled delta: difference of totals.
            macro_delta = None
            cells_used = 0
            acc = 0.0
            for cell, g in grain_cells[cond].items():
                m = main_cells[cond].get(cell)
                if not m or not g["n"] or not m["n"]:
                    continue
                acc += g["exact"] / g["n"] - m["exact"] / m["n"]
                cells_used += 1
            macro_delta = acc / cells_used if cells_used else None
            per_cond.append({
                "condition": cond,
                "n": gn,
                "cells": cells_used,
                "grain_exact": gc / gn if gn else None,
                "main_exact": mc / mn if mn else None,
                "delta_pooled": (gc / gn - mc / mn) if gn and mn else None,
                "delta_macro": macro_delta,
                "delta_ci": ci_all.get(cond),
                "n_parsed": pn,
                "grain_exact_parsed": pc / pn if pn else None,
                "main_exact_parsed": pmc / pmn if pmn else None,
                "delta_parsed_pooled": (pc / pn - pmc / pmn) if pn and pmn else None,
                "delta_parsed_ci": ci_parsed.get(cond),
                "unparsed_grain": 1 - (sum(v["img"][k][2] for v in grain_cells[cond].values() for k in v["img"]) /
                                       max(1, sum(v["img"][k][0] for v in grain_cells[cond].values() for k in v["img"]))),
                "unparsed_main": 1 - (sum(v["img"][k][2] for v in main_cells[cond].values() for k in v["img"]) /
                                      max(1, sum(v["img"][k][0] for v in main_cells[cond].values() for k in v["img"]))),
            })

        # per level / domain / family deltas
        def group(keyf):
            res = []
            for cond in conds:
                keys = sorted({keyf(cell) for cell in grain_cells[cond]})
                for k in keys:
                    gn, gc = total(grain_cells, cond, lambda c, k=k: keyf(c) == k)
                    mn = mc = 0
                    for cell, v in main_cells[cond].items():
                        if keyf(cell) == k:
                            mn += v["n"]; mc += v["exact"]
                    res.append({"key": k, "condition": cond, "n": gn, "main_n": mn,
                                "grain_exact": gc / gn if gn else None, "main_exact": mc / mn if mn else None,
                                "delta": (gc / gn - mc / mn) if gn and mn else None})
            return res

        fam_lookup = {d: f for f, ds in FAMILIES.items() for d in ds}
        out["models"][label] = {
            "id": info["id"],
            "conditions": conds,
            "per_condition": per_cond,
            "by_level": group(lambda c: c[1]),
            "by_domain": group(lambda c: c[0]),
            "by_family": group(lambda c: fam_lookup[c[0]]),
            "completeness": {
                cond: {
                    "records": total(grain_cells, cond)[0],
                    "expected": 42500,
                    "missing": 42500 - total(grain_cells, cond)[0],
                }
                for cond in conds
            },
        }
        deltas = ", ".join("%s macro %+0.4f [%+0.4f,%+0.4f] pooled %+0.4f" % (
            c["condition"], c["delta_macro"], c["delta_ci"][0], c["delta_ci"][1], c["delta_pooled"]) for c in per_cond)
        print("%-22s %s" % (label, deltas), flush=True)

    OUT.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print("\nwrote", OUT.relative_to(REPO), "%.0f KB" % (OUT.stat().st_size / 1024))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
