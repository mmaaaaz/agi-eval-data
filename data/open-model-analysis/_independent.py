
import json, glob, os, re, ast, collections
BASE = r"C:/Users/Maaz/Desktop/open-models figures"
DIRS = {"internvl3_5-8b":"InternVL3_5-8B/internvl3_5-8b", "deepseek-vl2-small":"deepseek-vl2-small/deepseek-vl2-small"}
NUMPAT = re.compile(r"[-+]?\d*\.?\d+")
WORD = re.compile(r"[a-z0-9]")

def to_num(s):
    try: return float(s)
    except Exception: return None
def norm(s):
    s = str(s).lower()
    s = re.sub(r"[\"'\x60{}\[\]()]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return re.sub(r"[.]+$", "", s).strip()
def bmatch(hay, part):
    if not part: return False
    if hay == part: return True
    st = 0
    while True:
        i = hay.find(part, st)
        if i < 0: return False
        b = hay[i-1] if i > 0 else ""; a = hay[i+len(part)] if i+len(part) < len(hay) else ""
        if not WORD.match(b or " ") and not WORD.match(a or " "): return True
        st = i + 1
def nums(s):
    return [v for v in (to_num(t) for t in NUMPAT.findall(str(s))) if v is not None]
def num_close(a, b): return abs(a-b) <= max(0.05, 0.01*abs(b))

# ---- ground truth -> parts, or None when not automatically gradeable ----
def gt_parts(gt):
    """Return (parts, kind). parts: list of (type,value); kind in text/numeric/ranking/ungradeable."""
    s = str(gt).strip()
    parsed = None
    if s[:1] in "{[":
        try: parsed = ast.literal_eval(s)
        except Exception: parsed = None
    if isinstance(parsed, dict):
        parts = []
        for k, v in parsed.items():
            parts.extend(flatten(v))
        return parts, "structured"
    if isinstance(parsed, list):
        return flatten(parsed), "structured"
    if ";" in s:
        return [("text", p) for p in s.split(";")], "semicolon"
    n = to_num(s)
    return ([("num", n)] if n is not None else [("text", s)]), "plain"

def flatten(v):
    out = []
    if isinstance(v, dict):
        for vv in v.values(): out.extend(flatten(vv))
    elif isinstance(v, (list, tuple)):
        for vv in v: out.extend(flatten(vv))
    elif isinstance(v, bool):
        out.append(("text", "yes" if v else "no"))
    elif isinstance(v, (int, float)):
        out.append(("num", float(v)))
    else:
        sv = str(v).strip()
        num = to_num(sv)
        if num is not None and re.fullmatch(r"[-+]?\d+(\.\d+)?", sv): out.append(("num", num))
        elif ">" in sv or "=" in sv: out.append(("ranking", sv))
        else: out.append(("text", sv))
    return out

def grade(gt, pred):
    """(all_parts_matched, fraction_matched, kind)"""
    if pred is None or str(pred).strip() == "": return (0, 0.0, "empty")
    parts, kind = gt_parts(gt)
    if not parts: return (0, 0.0, "ungradeable")
    hay = norm(pred); pn = nums(pred); hits = 0
    for typ, val in parts:
        if typ == "num":
            if any(num_close(x, val) for x in pn): hits += 1
        elif typ == "ranking":
            toks = [t for t in re.split(r"[>=,]+", norm(val)) if t.strip()]
            if toks and all(bmatch(hay, t.strip()) for t in toks): hits += 1
        else:
            if bmatch(hay, norm(val)): hits += 1
    return (1 if hits == len(parts) else 0, hits/len(parts), kind)

GRADEABLE = {"plain", "semicolon", "structured"}
out = {"models": {}}
for mid, d in DIRS.items():
    doms = {}; T = collections.Counter()
    for path in sorted(glob.glob(os.path.join(d, "*.jsonl"))):
        dom = os.path.basename(path).replace(".jsonl","")
        st = collections.Counter(); L = collections.defaultdict(collections.Counter)
        for line in open(path, encoding="utf-8", errors="replace"):
            line = line.strip()
            if not line: continue
            r = json.loads(line)
            l = int(r["level"]); gt = r.get("groundtruth"); pred = r.get("prediction")
            ok, frac, kind = grade(gt, pred)
            as_ok = r.get("correct") is True
            if kind == "ungradeable": kind = "plain"
            st["n"] += 1; st["as"] += as_ok; st["ind"] += ok
            st["partial"] += frac
            st["ungradeable"] += (kind not in GRADEABLE)
            st["inflated"] += (as_ok and not ok)     # harness credited, independent says no
            st["deflated"] += ((not as_ok) and ok)   # harness missed, independent says yes
            e = L[str(l)]; e["n"] += 1; e["as"] += as_ok; e["ind"] += ok; e["partial"] += frac
        st["levels"] = {k: dict(v) for k, v in L.items()}
        doms[dom] = {k: (v if not isinstance(v, dict) else v) for k, v in st.items()}
        for k, v in st.items():
            if isinstance(v, (int, float)) and not isinstance(v, bool): T[k] += v
    out["models"][mid] = {"domains": doms, "totals": dict(T)}
    n = T["n"]
    print(mid, "n", n, "| harness", round(T["as"]/n*100,2), "| independent re-grade", round(T["ind"]/n*100,2),
          "| partial-credit", round(T["partial"]/n*100,2))
    print("    harness credited but independent rejects:", T["inflated"],
          "| harness missed but independent accepts:", T["deflated"], "| ungradeable:", T["ungradeable"])

json.dump(out, open(os.path.join(BASE,"_independent.json"),"w",encoding="utf-8"))

# ---- headline deltas that the report text depends on ----
print("\n=== per-level (harness -> independent) ===")
for mid in DIRS:
    M = out["models"][mid]
    row = []
    for l in "12345":
        nn = sum(M["domains"][x]["levels"].get(l, {}).get("n", 0) for x in M["domains"])
        aa = sum(M["domains"][x]["levels"].get(l, {}).get("as", 0) for x in M["domains"])
        ii = sum(M["domains"][x]["levels"].get(l, {}).get("ind", 0) for x in M["domains"])
        row.append("L"+l+" "+str(round(aa/nn*100,1))+"->"+str(round(ii/nn*100,1)))
    print(mid, " ".join(row))
print("\n=== per-family (harness -> independent) ===")
FAMS = {
 'Plane Geometry':['nested_squares','nested_triangles','nested_hexagons','line_intersection','angle_estimation'],
 'Solid Geometry':['cube_net','cube_structure','combination3d','orthographic','polyhedron','depth_height'],
 'Transformational':['rotation_matching','symmetry_pattern','fold_punch','combination','embedded_figures','overlap_circles'],
 'Physical & Mechanical':['physical_stability','gear_train','fbd','projectile_motion','laser_mirror','clock_reading','gauge_reading'],
 'Topological':['surface_topology','route','hex_pathfinding'],
 'Projective':['occluded_pattern','shadow_inference'],
 'Analytic':['coordinate_geometry','compass_bearing'],
 'Optical':['optical_illusion','impossible_object'],
 'Inductive':['rpm']}
for mid in DIRS:
    M = out["models"][mid]
    for f, members in FAMS.items():
        n = a_ = i_ = 0
        for m in members:
            full = [k for k in M["domains"] if k.replace("_dataset_3000","").replace("_dataset_1000","") == m][0]
            v = M["domains"][full]; n += v["n"]; a_ += v["as"]; i_ += v["ind"]
        print("   ", mid[:6], f.ljust(22), round(a_/n*100,1), "->", round(i_/n*100,1))
print("\n=== affected levels detail ===")
for mid in DIRS:
    M = out["models"][mid]
    for dom, l in [("depth_height","3"),("fbd","4"),("fbd","3"),("projectile_motion","4"),("gauge_reading","5"),
                   ("physical_stability","5"),("gear_train","5"),("optical_illusion","5"),("hex_pathfinding","5")]:
        full = [k for k in M["domains"] if k.replace("_dataset_3000","").replace("_dataset_1000","") == dom][0]
        v = M["domains"][full]["levels"][l]
        print("   ", mid[:6], (dom+" L"+l).ljust(22), "n", v["n"], "harness", v["as"], "->", v["ind"],
              "| partial-credit", round(v["partial"]/v["n"]*100,1), "%")
print("\n=== domains the correction moves most (harness -> independent) ===")
for mid in DIRS:
    M = out["models"][mid]
    mv = sorted(M["domains"].items(), key=lambda kv: (kv[1]["ind"]-kv[1]["as"])/kv[1]["n"])
    for k, v in mv[:4] + mv[-4:]:
        print("   ", mid[:6], k.replace("_dataset_3000","").replace("_dataset_1000","").ljust(20),
              round(v["as"]/v["n"]*100,1), "->", round(v["ind"]/v["n"]*100,1),
              "| partial-credit", round(v["partial"]/v["n"]*100,1))
