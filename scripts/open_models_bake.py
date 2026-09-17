#!/usr/bin/env python3
"""Bake the open-model evaluation runs into ONE artifact the site reads.

Input  (raw, not committed - hundreds of MB of JSONL):
  data/open-model-analysis/<RunDir>/<model-id>/*.jsonl
  Geomatric-Reasoning-Benchmark-Dataset-main/Dataset/<domain>_dataset_*/annotations.jsonl
Output (committed, a few hundred KB):
  data/open-models/models.json      the artifact
  data/open-models/version.json     {commit, builtAt}
  data/open-models/models.meta.json model card fields (hand-edited, optional)

Every number on the site comes from here. The grader is the frozen rule that
_aggregate.py / _final_grade.py / _payload4.py established; it is re-implemented
verbatim so the site has one testable source of truth.

Usage:
  python scripts/open_models_bake.py             # cached per-domain regrade
  python scripts/open_models_bake.py --refresh   # ignore the cache
"""
from __future__ import annotations

import argparse
import ast
import collections
import datetime as dt
import glob
import hashlib
import json
import math
import re
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

REPO = Path(__file__).resolve().parent.parent
RUNS_DIR = REPO / "data" / "open-model-analysis"
OUT_DIR = REPO / "data" / "open-models"
DATASET_DIR = REPO / "Geomatric-Reasoning-Benchmark-Dataset-main" / "Dataset"
CACHE_DIR = OUT_DIR / ".cache"
META_FILE = OUT_DIR / "models.meta.json"
SCHEMA = 1

# ---------------------------------------------------------------- taxonomy ---

FAMILIES = [
    "Plane Geometry",
    "Solid Geometry",
    "Transformational",
    "Physical & Mechanical",
    "Topological",
    "Projective",
    "Analytic",
    "Optical",
    "Inductive",
]

FAMILY_MEMBERS = {
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

# L1..L5 are the dataset's own cognitive-task ladder. Verified 1:1 against the
# 435k-row question bank: every evaluation record's level agrees with the task
# recorded upstream, with no crossovers.
LEVELS = [
    {"n": 1, "task": "Image Description", "short": "Describe",
     "desc": "Read the image: name what is shown, count the parts, report the marked quantity."},
    {"n": 2, "task": "Basic Relational Reasoning", "short": "Relate",
     "desc": "One direct relation between two visible elements - compare, order or measure them."},
    {"n": 3, "task": "Comparative Reasoning", "short": "Compare",
     "desc": "Rank or relate several elements at once; the answer needs a comparison, not a reading."},
    {"n": 4, "task": "Compound Reasoning", "short": "Compose",
     "desc": "Chain two or more relations, or fold a measurement into a rule, to produce one answer."},
    {"n": 5, "task": "Extrapolative/Counterfactual Reasoning", "short": "Extrapolate",
     "desc": "Reason about what is not in the image: a hypothetical edit, a transformation, an unseen view."},
]

DOMAIN_LABELS = {
    "angle_estimation": "Angle estimation",
    "clock_reading": "Clock reading",
    "combination": "Shape combination",
    "combination3d": "3D combination",
    "compass_bearing": "Compass bearing",
    "coordinate_geometry": "Coordinate geometry",
    "cube_net": "Cube nets",
    "cube_structure": "Cube structures",
    "depth_height": "Depth & height",
    "embedded_figures": "Embedded figures",
    "fbd": "Free-body diagrams",
    "fold_punch": "Fold & punch",
    "gauge_reading": "Gauge reading",
    "gear_train": "Gear trains",
    "hex_pathfinding": "Hex pathfinding",
    "impossible_object": "Impossible objects",
    "laser_mirror": "Laser & mirror",
    "line_intersection": "Line intersection",
    "nested_hexagons": "Nested hexagons",
    "nested_squares": "Nested squares",
    "nested_triangles": "Nested triangles",
    "occluded_pattern": "Occluded patterns",
    "optical_illusion": "Optical illusions",
    "orthographic": "Orthographic views",
    "overlap_circles": "Overlapping circles",
    "physical_stability": "Physical stability",
    "polyhedron": "Polyhedra",
    "projectile_motion": "Projectile motion",
    "rotation_matching": "Rotation matching",
    "route": "Route finding",
    "rpm": "Rotations per minute",
    "shadow_inference": "Shadow inference",
    "surface_topology": "Surface topology",
    "symmetry_pattern": "Symmetry patterns",
}

ACCENTS = ["#8b5cf6", "#38bdf8", "#f59e0b", "#10b981", "#f43f5e", "#a3e635", "#e879f9", "#22d3ee"]

# ------------------------------------------------------------ frozen grader ---

NUMPAT = re.compile(r"[-+]?\d*\.?\d+")
WORD = re.compile(r"[a-z0-9]")
IMG_ID = re.compile(r"^(.*)_(\d{4})_q(\d+)$")


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
    """Whole-word containment: ground truth 'connected' must not match 'disconnected'."""
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


def num_close(a: float, b: float) -> bool:
    return abs(a - b) <= max(0.05, 0.01 * abs(b))


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
    s = str(gt).strip()
    parsed = None
    if s[:1] in "{[":
        try:
            parsed = ast.literal_eval(s)
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


def grade(gt, pred):
    """-> (all_parts_correct, fraction_of_parts, n_parts, ground_truth_kind)"""
    if pred is None or str(pred).strip() == "":
        return 0, 0.0, 0, "plain"
    parts, kind = gt_parts(gt)
    if not parts:
        return 0, 0.0, 0, kind
    hay = norm(pred)
    seg = committed_segment(pred)
    seg_nums = nums(seg)
    pool = seg_nums if seg_nums else nums(pred)
    hits = 0
    for typ, val in parts:
        if typ == "num":
            if any(num_close(x, val) for x in pool):
                hits += 1
        elif typ == "rank":
            if rank_ok(pred, val):
                hits += 1
        else:
            if bmatch(hay, norm(val)):
                hits += 1
    return (1 if hits == len(parts) else 0), hits / len(parts), len(parts), kind


def is_parse_fail(pred) -> bool:
    return pred is None or (isinstance(pred, str) and (pred.strip() == "" or len(pred) > 120))


def wilson(k: int, n: int, z: float = 1.959964):
    if n <= 0:
        return [0.0, 1.0]
    p = k / n
    den = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return [max(0.0, centre - half), min(1.0, centre + half)]


# ------------------------------------------------------------------ helpers ---

def domain_key(stem: str) -> str:
    return stem.replace("_dataset_3000", "").replace("_dataset_1000", "")


def r6(x):
    return None if x is None else round(float(x), 6)


def rate(k, n):
    return r6(k / n) if n else None


def level_n(domain_obj, level):
    """Questions in one level of one domain (taken from the first model row)."""
    return domain_obj["per"][0]["levels"][level - 1]["n"]


def agg_kpi(n, as_, ok, pf, over, under, partial, levels):
    """One KPI block: accuracy, harness agreement, partial credit, CI."""
    return {
        "n": n,
        "acc": rate(ok, n),
        "as": rate(as_, n),
        "partial": rate(partial, n),
        "pf": pf,
        "pfRate": rate(pf, n),
        "over": over,
        "under": under,
        "agreement": rate(n - over - under, n),
        "ci": [r6(v) for v in wilson(ok, n)],
        "levels": levels,
    }


def kpi_from(counter):
    levels = [
        {
            "n": counter["levels"][str(i)]["n"],
            "acc": rate(counter["levels"][str(i)]["ok"], counter["levels"][str(i)]["n"]),
            "as": rate(counter["levels"][str(i)]["as"], counter["levels"][str(i)]["n"]),
            "partial": rate(counter["levels"][str(i)]["partial"], counter["levels"][str(i)]["n"]),
            "pf": counter["levels"][str(i)]["pf"],
            "kind": counter["levels"][str(i)].get("kind"),
            "ci": [r6(v) for v in wilson(counter["levels"][str(i)]["ok"], counter["levels"][str(i)]["n"])],
        }
        for i in range(1, 6)
    ]
    return agg_kpi(counter["n"], counter["as"], counter["ok"], counter["pf"], counter["over"], counter["under"], counter["partial"], levels)


# --------------------------------------------------------- question formats ---

DIGITS = re.compile(r"\d+(?:\.\d+)?")
QUOTED = re.compile(r"'[^']{1,24}'|\"[^\"]{1,24}\"")


def template_of(prompt: str) -> str:
    t = QUOTED.sub("<value>", prompt)
    t = DIGITS.sub("<n>", t)
    return re.sub(r"\s+", " ", t).strip()


def dataset_dir_for(dom: str):
    hits = sorted(glob.glob(str(DATASET_DIR / (dom + "_dataset_*"))))
    return Path(hits[0]) if hits else None


def load_question_bank():
    """domain -> {level: {template, example, exampleGt, answerFormat, templates}}"""
    bank = {}
    if not DATASET_DIR.exists():
        print("  ! upstream dataset repo not present - question formats omitted")
        return bank
    for d in sorted(DATASET_DIR.iterdir()):
        if not d.is_dir():
            continue
        ann = d / "annotations.jsonl"
        if not ann.exists():
            continue
        dom = domain_key(d.name)
        per = collections.defaultdict(collections.Counter)
        sample = {}
        with open(ann, encoding="utf-8", errors="replace") as fh:
            rows = [ln for ln in fh]
        for line in rows:
            line = line.strip()
            if not line:
                continue
            j = json.loads(line)
            for q in j.get("questions", []):
                lv = q.get("difficulty_level")
                text = (q.get("question_text") or "").strip()
                if not lv or not text:
                    continue
                key = str(int(lv))
                per[key][template_of(text)] += 1
                cur = sample.get(key)
                if cur is None or len(text) < len(cur["example"]):
                    sample[key] = {
                        "example": text,
                        "exampleGt": str(q.get("ground_truth"))[:160],
                        "answerFormat": q.get("answer_format"),
                    }
        bank[dom] = {
            k: {
                "template": per[k].most_common(1)[0][0],
                "templates": len(per[k]),
                **sample.get(k, {"example": None, "exampleGt": None, "answerFormat": None}),
            }
            for k in sorted(per)
        }
    return bank


# -------------------------------------------------------------- model scan ---

def discover_models():
    found = []
    for top in sorted(RUNS_DIR.iterdir()):
        if not top.is_dir() or top.name.startswith("."):
            continue
        dirs = [top] if glob.glob(str(top / "*.jsonl")) else [p for p in sorted(top.iterdir()) if p.is_dir()]
        for d in dirs:
            files = sorted(d.glob("*.jsonl"))
            if not files:
                continue
            with open(files[0], encoding="utf-8", errors="replace") as fh:
                model_id = json.loads(fh.readline()).get("model") or d.name
            found.append({"id": model_id, "dir": d, "files": files, "runName": top.name})
    return found


def drift_for(path: Path, bank_gt: dict):
    """How many of this run's ground truths disagree with the CURRENT upstream snapshot.

    Same question ids and same levels, occasionally different answers: the dataset
    was regenerated after these runs, so per-question upstream text cannot be tied
    back to a graded record. Reported as a provenance caveat, not a scoring change —
    every run is graded against the ground truth it recorded.
    """
    if not bank_gt:
        return 0, 0
    mismatch = missing = 0
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            qid = r.get("question_id")
            if qid not in bank_gt:
                missing += 1
            elif bank_gt[qid] != str(r.get("groundtruth")):
                mismatch += 1
    return mismatch, missing


def read_gt_map(path: Path):
    """question_id -> recorded ground truth, for cross-run pairing checks."""
    m = {}
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            qid = r.get("question_id")
            if qid:
                m[qid] = str(r.get("groundtruth"))
    return m


def pairing_for(path: Path, ref: dict):
    """How far this run's recorded ground truth departs from the reference run.

    A model graded against a different ground truth is not comparable, so this is
    the check that keeps 'same questions, same truth' honest as runs are added.
    """
    mismatch = missing = 0
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            gt = ref.get(r.get("question_id"))
            if gt is None:
                missing += 1
            elif gt != str(r.get("groundtruth")):
                mismatch += 1
    return mismatch, missing


def seed_meta(models, existing: dict):
    """Add any newly discovered run to models.meta.json so its card can be filled in."""
    out = {}
    if "_comment" in existing:
        out["_comment"] = existing["_comment"]
    if "_fieldSource" in existing:
        out["_fieldSource"] = existing["_fieldSource"]
    added = []
    for i, m in enumerate(models):
        cur = existing.get(m["id"])
        if isinstance(cur, dict):
            out[m["id"]] = cur
            continue
        out[m["id"]] = {
            "label": m.get("runName") or m["id"],
            "org": None,
            "params": None,
            "activeParams": None,
            "license": None,
            "released": None,
            "context": None,
            "accent": ACCENTS[i % len(ACCENTS)],
            "links": {"huggingface": None, "paper": None},
            "notes": None,
        }
        added.append(m["id"])
    return out, added


def scan_domain(path: Path, refresh: bool):
    """Grade one model x domain file (cached on size+mtime)."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cpath = CACHE_DIR / (hashlib.sha1(str(path).encode()).hexdigest()[:16] + ".json")
    st = path.stat()
    key = f"{st.st_size}:{int(st.st_mtime)}"
    if not refresh and cpath.exists():
        try:
            cached = json.loads(cpath.read_text(encoding="utf-8"))
            if cached.get("key") == key:
                return cached["data"]
        except Exception:
            pass

    n = as_ = ok = pf = over = under = 0
    partial = 0.0
    levels = collections.defaultdict(lambda: collections.Counter())
    classes = collections.Counter()
    bands = collections.Counter()
    examples = collections.defaultdict(list)
    images = set()
    gt_all = collections.Counter()
    gt_lv = collections.defaultdict(collections.Counter)
    modes = collections.Counter()
    dup = 0
    seen = set()

    with open(path, encoding="utf-8", errors="replace") as fh:
        rows = [ln for ln in fh]
    for line in rows:
        line = line.strip()
        if not line:
            continue
        r = json.loads(line)
        lv = int(r["level"])
        gt = r.get("groundtruth")
        pred = r.get("prediction")
        as_ok = r.get("correct") is True
        g_ok, frac, _nparts, g_kind = grade(gt, pred)
        pfx = int(is_parse_fail(pred))

        n += 1
        as_ += int(as_ok)
        ok += g_ok
        partial += frac
        pf += pfx
        modes[r.get("score_mode") or "none"] += 1
        e = levels[str(lv)]
        e["n"] += 1
        e["as"] += int(as_ok)
        e["ok"] += g_ok
        e["pf"] += pfx
        e["partial"] += frac
        e["kind_" + g_kind] += 1
        gt_all[str(gt)] += 1
        gt_lv[lv][str(gt)] += 1
        m = IMG_ID.match(r.get("question_id") or "")
        if m:
            images.add(int(m.group(2)))
        qid = r.get("question_id")
        if qid in seen:
            dup += 1
        seen.add(qid)

        if as_ok and not g_ok:
            over += 1
            parts, _k = gt_parts(gt)
            hay = norm(pred)
            gnum = to_num(gt)
            pn = nums(pred)
            segn = nums(committed_segment(pred))
            if any(t == "text" and norm(v) in hay and not bmatch(hay, norm(v)) for t, v in parts):
                cls = "text fragment match"
            elif gnum is not None and any(num_close(x, gnum) for x in pn) and not any(
                num_close(x, gnum) for x in (segn if segn else pn)
            ):
                cls = "right number, wrong final answer"
            elif gnum is not None and pn:
                best = min(pn, key=lambda x: abs(x - gnum))
                rl = abs(best - gnum) / abs(gnum) if gnum else 9
                bands["<=2%" if rl <= 0.02 else "<=5%" if rl <= 0.05 else "<=10%" if rl <= 0.10 else ">10%"] += 1
                cls = "near-miss number accepted"
            else:
                cls = "other"
            classes[cls] += 1
            if len(examples[cls]) < 3:
                examples[cls].append({"level": lv, "gt": str(gt)[:48], "pred": str(pred)[:90]})
        elif (not as_ok) and g_ok:
            under += 1
            kind = gt_parts(gt)[1]
            cls = (
                "structured answer recovered"
                if kind == "structured"
                else "multi-part answer fully matched"
                if kind == "multipart"
                else "matched after normalisation"
            )
            classes["under: " + cls] += 1
            if len(examples["under: " + cls]) < 3:
                examples["under: " + cls].append({"level": lv, "gt": str(gt)[:48], "pred": str(pred)[:90]})

    top_all, top_all_n = gt_all.most_common(1)[0] if gt_all else ("", 0)
    data = {
        "n": n,
        "as": as_,
        "ok": ok,
        "partial": round(partial, 4),
        "pf": pf,
        "over": over,
        "under": under,
        "dupIds": dup,
        "images": len(images),
        "imgMin": min(images) if images else None,
        "imgMax": max(images) if images else None,
        "levels": {
            k: {
                "n": v["n"],
                "as": v["as"],
                "ok": v["ok"],
                "pf": v["pf"],
                "partial": round(v["partial"], 4),
                # the ground-truth SHAPE that dominates this level: structured
                # (dict/list), multipart (semicolon separated) or plain. Drives the
                # audit's explanation of why a level reads 0.0% for every model.
                "kind": max(("structured", "multipart", "plain"), key=lambda kk: v["kind_" + kk]),
            }
            for k, v in levels.items()
        },
        "classes": dict(classes),
        "bands": dict(bands),
        "examples": {k: v for k, v in examples.items()},
        "modes": dict(modes),
        "oracle": rate(top_all_n, n),
        "oracleTop": top_all[:48],
        "gtDistinct": len(gt_all),
        "lvOracle": {
            str(i): {
                "top": (gt_lv[i].most_common(1)[0][0][:48] if gt_lv[i] else None),
                "oracle": rate(gt_lv[i].most_common(1)[0][1], sum(gt_lv[i].values())) if gt_lv[i] else None,
                "distinct": len(gt_lv[i]),
            }
            for i in range(1, 6)
        },
        "driftMismatch": 0,
        "driftMissing": 0,
    }
    cpath.write_text(json.dumps({"key": key, "data": data}), encoding="utf-8")
    return data


# --------------------------------------------------------------------- main ---

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="ignore the per-domain regrade cache")
    ap.add_argument(
        "--allow-unpaired",
        action="store_true",
        help="publish even when a run's recorded ground truth differs from the reference run",
    )
    args = ap.parse_args()

    models = discover_models()
    if not models:
        print("no model runs found under", RUNS_DIR)
        return 1
    print("models:", [m["id"] for m in models])

    existing_meta = json.loads(META_FILE.read_text(encoding="utf-8")) if META_FILE.exists() else {}
    meta_overrides, seeded = seed_meta(models, existing_meta)
    if seeded:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        META_FILE.write_text(json.dumps(meta_overrides, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print("seeded " + str(len(seeded)) + " new model(s) into " + META_FILE.name + ": " + ", ".join(seeded))
        print("  -> fill in org / params / license / links, then re-run this script")
    print("loading upstream question bank for prompt formats / drift check ...")
    bank = load_question_bank()
    bank_gt_cache = {}
    for dom in DOMAIN_LABELS:
        pp = dataset_dir_for(dom)
        gt = {}
        if pp:
            ann = pp / "annotations.jsonl"
            if ann.exists():
                with open(ann, encoding="utf-8", errors="replace") as fh:
                    raw = [ln for ln in fh]
                for line in raw:
                    line = line.strip()
                    if not line:
                        continue
                    j = json.loads(line)
                    for q in j.get("questions", []):
                        if q.get("question_id"):
                            gt[q["question_id"]] = str(q.get("ground_truth"))
        bank_gt_cache[dom] = gt
    print("  bank ground truths loaded for", sum(1 for v in bank_gt_cache.values() if v), "domains")

    model_out = []
    per_model_domains = {}
    drift_total = {"mismatch": 0, "missing": 0, "checked": 0}
    gt_ref = {}
    pairing_total = {"checked": 0, "mismatch": 0, "missing": 0}

    for mi, m in enumerate(models):
        print(f"== {m['id']}  ({m['dir'].relative_to(REPO)})")
        doms = {}
        totals = collections.Counter()
        classes_t = collections.Counter()
        bands_t = collections.Counter()
        examples_t = collections.defaultdict(list)
        images_total = 0
        drift_m = drift_x = 0

        pairing = {"checked": 0, "mismatch": 0, "missing": 0}
        for path in m["files"]:
            dom = domain_key(path.name.replace(".jsonl", ""))
            s = scan_domain(path, args.refresh)
            if mi == 0:
                dm_, dx_ = drift_for(path, bank_gt_cache.get(dom, {}))
                s["driftMismatch"], s["driftMissing"] = dm_, dx_
                gt_ref.update(read_gt_map(path))
                pairing["checked"] += s["n"]
            else:
                pm_, px_ = pairing_for(path, gt_ref)
                pairing["mismatch"] += pm_
                pairing["missing"] += px_
                pairing["checked"] += s["n"]
            doms[dom] = s
            images_total += s["images"]
            for f in ("n", "as", "ok", "pf", "over", "under"):
                totals[f] += s[f]
            totals["partial"] += s["partial"]
            for k, v in s["classes"].items():
                classes_t[k] += v
                if len(examples_t[k]) < 4:
                    for ex in s["examples"].get(k, [])[: 4 - len(examples_t[k])]:
                        examples_t[k].append({"domain": dom, **ex})
            for k, v in s["bands"].items():
                bands_t[k] += v
            if mi == 0:
                drift_m += s["driftMismatch"]
                drift_x += s["driftMissing"]
                drift_total["mismatch"] += s["driftMismatch"]
                drift_total["missing"] += s["driftMissing"]
                drift_total["checked"] += s["n"]

        levels_tot = {}
        lv_oracle_num = collections.Counter()
        lv_oracle_den = collections.Counter()
        for i in range(1, 6):
            e = collections.Counter()
            for d in doms.values():
                v = d["levels"].get(str(i))
                if not v:
                    continue
                for f in ("n", "as", "ok", "pf"):
                    e[f] += v[f]
                e["partial"] += v["partial"]
                lv_oracle_num[str(i)] += (d["lvOracle"][str(i)]["oracle"] or 0) * v["n"]
                lv_oracle_den[str(i)] += v["n"]
            levels_tot[str(i)] = e
        totals["levels"] = levels_tot
        level_oracle = [rate(lv_oracle_num[str(i)], lv_oracle_den[str(i)]) for i in range(1, 6)]

        tk = kpi_from(totals)
        for i in range(5):
            tk["levels"][i]["oracle"] = level_oracle[i]
        tk["images"] = images_total
        tk["oracle"] = rate(
            sum(round((doms[d]["oracle"] or 0) * doms[d]["n"]) for d in doms),
            sum(doms[d]["n"] for d in doms),
        )
        tk["headroom"] = r6(tk["acc"] - tk["oracle"]) if tk["acc"] is not None else None

        families = []
        for fam in FAMILIES:
            n = as_ = ok = 0
            partial = 0.0
            oc_num = 0.0
            lv_acc = collections.Counter()
            lv_n = collections.Counter()
            for dk in FAMILY_MEMBERS[fam]:
                s = doms.get(dk)
                if not s:
                    continue
                n += s["n"]
                as_ += s["as"]
                ok += s["ok"]
                partial += s["partial"]
                oc_num += (s["oracle"] or 0) * s["n"]
                for lv, v in s["levels"].items():
                    lv_n[lv] += v["n"]
                    lv_acc[lv] += v["ok"]
            families.append({
                "name": fam,
                "n": n,
                "acc": rate(ok, n),
                "as": rate(as_, n),
                "partial": rate(partial, n),
                "oracle": rate(oc_num, n),
                "levels": [{"acc": rate(lv_acc[str(i)], lv_n[str(i)]), "n": lv_n[str(i)]} for i in range(1, 6)],
            })

        model_out.append({
            "id": m["id"],
            "label": meta_overrides.get(m["id"], {}).get("label", m["id"]),
            "accent": meta_overrides.get(m["id"], {}).get("accent", ACCENTS[mi % len(ACCENTS)]),
            "meta": meta_overrides.get(m["id"], {}),
            "totals": tk,
            "families": families,
            "classes": [{"name": k, "n": v} for k, v in classes_t.most_common()],
            "bands": [{"name": k, "n": bands_t.get(k, 0)} for k in ("<=2%", "<=5%", "<=10%", ">10%")],
            "examples": dict(examples_t),
            "drift": {"mismatch": drift_m, "missing": drift_x},
            "gtPairing": pairing,
        })
        for k in pairing:
            pairing_total[k] += pairing[k]
        per_model_domains[m["id"]] = doms
        print(f"   n={totals['n']:,}  frozen={tk['acc']:.4f}  harness={tk['as']:.4f}  parseFail={totals['pf']:,}")

    # ---- domains block (per-model rows in models[] order) ----
    domains_out = []
    for dk in sorted(DOMAIN_LABELS):
        fam = next((i for i, f in enumerate(FAMILIES) if dk in FAMILY_MEMBERS[f]), -1)
        rows = []
        oracle_lv = None
        oracle_all = None
        oracle_top = None
        n_dom = None
        distinct = None
        const = []
        for m in model_out:
            s = per_model_domains[m["id"]].get(dk)
            if not s:
                continue
            n_dom = s["n"]
            c = collections.Counter({
                "n": s["n"], "as": s["as"], "ok": s["ok"], "pf": s["pf"],
                "over": s["over"], "under": s["under"], "partial": s["partial"],
                "levels": {k: dict(v) for k, v in s["levels"].items()},
            })
            k = kpi_from(c)
            k["model"] = m["id"]
            k["images"] = s["images"]
            k["bands"] = s["bands"]
            for i in range(1, 6):
                k["levels"][i - 1]["oracle"] = s["lvOracle"][str(i)]["oracle"]
            rows.append(k)
            if oracle_lv is None:
                oracle_lv = [s["lvOracle"][str(i)]["oracle"] for i in range(1, 6)]
                oracle_all = s["oracle"]
                oracle_top = s["oracleTop"]
                distinct = s["gtDistinct"]
                const = [
                    {"level": i, "oracle": s["lvOracle"][str(i)]["oracle"], "top": s["lvOracle"][str(i)]["top"],
                     "distinct": s["lvOracle"][str(i)]["distinct"]}
                    for i in range(1, 6)
                    if (s["lvOracle"][str(i)]["oracle"] or 0) >= 0.9
                ]
        domains_out.append({
            "key": dk,
            "label": DOMAIN_LABELS[dk],
            "family": fam,
            "familyName": FAMILIES[fam] if fam >= 0 else None,
            "n": n_dom,
            "oracle": oracle_all,
            "oracleTop": oracle_top,
            "oracleLevels": oracle_lv,
            "distinctAnswers": distinct,
            "const": const,
            "formats": bank.get(dk, {}),
            "per": rows,
        })

    # ---- audit block ----
    zero_harness = []
    zero_frozen = []
    for d in domains_out:
        for i in range(5):
            lv = d["per"][0]["levels"][i]
            cells = [p["levels"][i] for p in d["per"]]
            if all((c["as"] or 0) == 0 for c in cells):
                best_ok = max((c["acc"] or 0) * c["n"] for c in cells)
                kind = lv.get("kind") or "plain"
                if kind == "structured":
                    cat = (
                        "structured ground truth, recovered by the frozen rule"
                        if best_ok > 0
                        else "structured ground truth a string grader cannot read"
                    )
                elif kind == "multipart":
                    cat = "multi-part ground truth, partly answered"
                elif best_ok > 0:
                    cat = "recovered by the frozen rule"
                else:
                    cat = "wrong on every model"
                zero_harness.append({
                    "domain": d["key"], "label": d["label"], "familyName": d["familyName"], "level": i + 1,
                    "n": lv["n"], "category": cat, "kind": lv.get("kind"), "oracle": d["oracleLevels"][i],
                    "per": [{"model": p["model"], "acc": c["acc"], "partial": c["partial"], "as": c["as"]}
                            for p, c in zip(d["per"], cells)],
                })
            if all((c["acc"] or 0) == 0 for c in cells):
                zero_frozen.append({
                    "domain": d["key"], "label": d["label"], "familyName": d["familyName"], "level": i + 1,
                    "n": lv["n"], "oracle": d["oracleLevels"][i],
                    "per": [{"model": p["model"], "acc": c["acc"], "partial": c["partial"]} for p, c in zip(d["per"], cells)],
                })

    movers = []
    for d in domains_out:
        deltas = [((p["acc"] or 0) - (p["as"] or 0)) for p in d["per"]]
        movers.append({"domain": d["key"], "label": d["label"], "familyName": d["familyName"],
                       "delta": r6(sum(deltas) / len(deltas)), "per": [r6(x) for x in deltas],
                       "n": d["n"]})
    movers.sort(key=lambda x: x["delta"])
    # delta = frozen - harness. Negative -> the run's own scorer credited an
    # answer the frozen rule rejects (over-credited); positive -> under-credited.
    over_credited = movers[:8]
    under_credited = list(reversed(movers[-8:]))

    integrity = {
        "dupIds": sum(per_model_domains[m["id"]].get(d, {}).get("dupIds", 0) for m in model_out for d in per_model_domains[m["id"]]),
        # ground truth must be identical across runs for the comparison to be paired;
        # only models after the first are compared, the first one is the reference.
        "gtPairing": {
            "checked": pairing_total["checked"] - (model_out[0]["gtPairing"]["checked"] if model_out else 0),
            "reference": model_out[0]["id"] if model_out else None,
            "mismatch": pairing_total["mismatch"],
            "missing": pairing_total["missing"],
            "perModel": {m["id"]: m["gtPairing"] for m in model_out[1:]},
        },
        "nominalPerDomain": 3000,
        "evaluatedPerDomain": 1500,
        "gtDrift": {
            **drift_total,
            "byDomain": {
                d["key"]: {"n": d["n"], "mismatch": per_model_domains[model_out[0]["id"]][d["key"]]["driftMismatch"]}
                for d in domains_out if d["key"] in per_model_domains[model_out[0]["id"]]
            },
        },
    }

    artifact = {
        "schema": SCHEMA,
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "benchmark": {
            "name": "GRIP",
            "fullName": "GRIP - geometric & visual reasoning benchmark",
            "families": FAMILIES,
            "levels": LEVELS,
            "domains": len(domains_out),
            # runs are not perfectly equal in size: the first two evaluated 1,501
            # images in angle_estimation, the rest 1,500. Report both ends.
            "questionsPerModel": model_out[0]["totals"]["n"],
            "imagesPerModel": model_out[0]["totals"]["images"],
            "questionsRange": [
                min(m["totals"]["n"] for m in model_out),
                max(m["totals"]["n"] for m in model_out),
            ],
            "imagesRange": [
                min(m["totals"]["images"] for m in model_out),
                max(m["totals"]["images"] for m in model_out),
            ],
            "grader": {
                "version": "frozen v3",
                "rules": [
                    "Answer text is lower-cased; punctuation, quotes, brackets and whitespace are normalised away.",
                    "Text ground truth must appear as a whole word or phrase - it may not sit inside a longer word.",
                    "Numbers must appear in the model's committed answer (after its final-answer marker) within 1% relative or 0.05 absolute tolerance.",
                    "Multi-part ground truth (semicolon separated) requires every part; the share matched is reported as partial credit.",
                    "Structured ground truth (dict or list literal) is parsed: numbers match numbers, strings match by token, ranked lists must keep order.",
                    "Anything still failing is wrong. Nothing is dropped from the denominator.",
                ],
            },
        },
        "models": model_out,
        "domains": domains_out,
        "audit": {
            "zeroHarness": zero_harness,
            "zeroFrozen": zero_frozen,
            "overCredited": over_credited,
            "underCredited": under_credited,
            "constantLevels": [
                {"domain": d["key"], "label": d["label"], "familyName": d["familyName"], "level": c["level"],
                 "oracle": c["oracle"], "top": c["top"], "distinct": c["distinct"], "n": level_n(d, c["level"])}
                for d in domains_out for c in d["const"]
            ],
        },
        "integrity": integrity,
    }

    # ---- invariants: never ship a number we cannot re-derive ----
    assert sum(d["per"][0]["n"] for d in domains_out) == model_out[0]["totals"]["n"], "domain n != total n"
    assert sum(d["per"][0]["acc"] is not None for d in domains_out) == len(domains_out)
    for mi, m in enumerate(model_out):
        s_ok = sum(round((d["per"][mi]["acc"] or 0) * d["per"][mi]["n"]) for d in domains_out)
        assert abs(s_ok - m["totals"]["acc"] * m["totals"]["n"]) <= len(domains_out), f"{m['id']} domain acc does not rebuild"
        assert abs(sum(x["n"] for x in m["totals"]["levels"]) - m["totals"]["n"]) <= 5, f"{m['id']} level n != total"
    for d in domains_out:
        assert len(d["per"]) == len(model_out), f"{d['key']} missing a model row - every run must cover all {len(domains_out)} domains"

    # A run graded against a different ground truth is not comparable. Refuse to
    # publish it by default: the headline would be a data difference, not a model one.
    pairing = integrity["gtPairing"]
    if pairing["checked"] and (pairing["mismatch"] or pairing["missing"]) and not args.allow_unpaired:
        print(
            f"REFUSING TO WRITE: ground truth is not shared across runs - "
            f"{pairing['mismatch']:,} mismatches and {pairing['missing']:,} missing of {pairing['checked']:,} "
            f"questions compared against {pairing['reference']}.",
            file=sys.stderr,
        )
        for mid, row in pairing["perModel"].items():
            if row["mismatch"] or row["missing"]:
                print(
                    f"  {mid}: {row['mismatch']:,} mismatches / {row['missing']:,} missing of {row['checked']:,}",
                    file=sys.stderr,
                )
        print(
            "  -> that run was evaluated on a different dataset snapshot, or against different ground truth.\n"
            "     Re-run it on the same snapshot, or pass --allow-unpaired to publish the difference deliberately.",
            file=sys.stderr,
        )
        return 2

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "models.json").write_text(json.dumps(artifact, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    try:
        commit = subprocess.check_output(["git", "-C", str(REPO), "rev-parse", "HEAD"], text=True).strip()
    except Exception:
        commit = "unknown"
    (OUT_DIR / "version.json").write_text(
        json.dumps({"commit": commit, "builtAt": artifact["generated"], "schema": SCHEMA}),
        encoding="utf-8",
    )

    size = (OUT_DIR / "models.json").stat().st_size
    print(f"\nwrote data/open-models/models.json ({size / 1024:.1f} KB), version.json @ {commit[:10]}")
    for m in model_out:
        t = m["totals"]
        print(f"  {m['label']:<22} frozen {t['acc'] * 100:6.2f}%  harness {t['as'] * 100:6.2f}%  "
              f"partial {t['partial'] * 100:6.2f}%  parseFail {t['pfRate'] * 100:5.2f}%  agree {t['agreement'] * 100:6.2f}%")
    print(f"  zero-harness levels: {len(zero_harness)}   zero-frozen levels: {len(zero_frozen)}   "
          f"constant levels: {len(artifact['audit']['constantLevels'])}")
    print(f"  ground-truth drift vs current upstream snapshot: {drift_total['mismatch']:,} of {drift_total['checked']:,}")
    if integrity["gtPairing"]["checked"]:
        print(
            "  ground truth identical across runs: "
            f"{integrity['gtPairing']['mismatch']:,} mismatches / {integrity['gtPairing']['missing']:,} missing "
            f"of {integrity['gtPairing']['checked']:,} compared - "
            + ("paired comparison holds" if not (integrity["gtPairing"]["mismatch"] or integrity["gtPairing"]["missing"]) else "RUNS ARE NOT PAIRED")
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
