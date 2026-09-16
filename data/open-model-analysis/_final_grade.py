
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
def fragment_only(hay, part):
    return (part in hay) and not bmatch(hay, part)
def num_close(a, b): return abs(a-b) <= max(0.05, 0.01*abs(b))
def nums(s):
    return [v for v in (to_num(t) for t in NUMPAT.findall(str(s))) if v is not None]
def committed_segment(pred):
    t = str(pred)
    m = list(re.finditer(r"FINAL ANSWER\s*[:\-]\s*([^\n]+)", t, re.I))
    if m: return m[-1].group(1)
    m = list(re.finditer(r"(?:the\s+)?(?:correct\s+)?(?:final\s+)?answer\s*(?:is|:)\s*([^\n]+)", t, re.I))
    if m: return m[-1].group(1)
    return t
def flatten(v, out):
    if isinstance(v, dict):
        for vv in v.values(): flatten(vv, out)
    elif isinstance(v, (list, tuple)):
        if v and all(isinstance(x, (list, tuple)) for x in v):
            out.append(("rank", [[str(y).strip() for y in g] for g in v]))
        else:
            for vv in v: flatten(vv, out)
    elif isinstance(v, bool): out.append(("text", "yes" if v else "no"))
    elif isinstance(v, (int, float)): out.append(("num", float(v)))
    else:
        sv = str(v).strip()
        if re.fullmatch(r"[-+]?\d+(\.\d+)?", sv): out.append(("num", float(sv)))
        elif ">" in sv or "=" in sv: out.append(("rank", [[x.strip() for x in re.split(r"[>=]+", sv)]]))
        else: out.append(("text", sv))
def gt_parts(gt):
    s = str(gt).strip(); parsed = None
    if s[:1] in "{[":
        try: parsed = ast.literal_eval(s)
        except Exception: parsed = None
    if isinstance(parsed, (dict, list)):
        out = []; flatten(parsed, out); return out
    if ";" in s: return [("text", p) for p in s.split(";")]
    n = to_num(s)
    return [("num", n)] if n is not None else [("text", s)]
def rank_ok(pred, groups):
    hay = norm(pred); order = []
    for g in groups:
        for tok in g:
            i = hay.find(norm(tok))
            if i < 0: return False
            order.append((i, tuple(g)))
    order.sort()
    seen = []
    for _, g in order:
        if not seen or seen[-1] != g: seen.append(g)
    return seen == [tuple(g) for g in groups]
def grade(gt, pred):
    if pred is None or str(pred).strip() == "": return (0, 0.0, "empty")
    parts = gt_parts(gt)
    if not parts: return (0, 0.0, "ungradeable")
    hay = norm(pred); seg = committed_segment(pred); seg_nums = nums(seg)
    pool = seg_nums if seg_nums else nums(pred)
    hits = 0
    for typ, val in parts:
        if typ == "num":
            if any(num_close(x, val) for x in pool): hits += 1
        elif typ == "rank":
            if rank_ok(pred, val): hits += 1
        else:
            if bmatch(hay, norm(val)): hits += 1
    return (1 if hits == len(parts) else 0, hits/len(parts), "ok")

out = {"models": {}}
for mid, d in DIRS.items():
    doms = {}; T = collections.Counter(); samples = collections.defaultdict(list)
    for path in sorted(glob.glob(os.path.join(d, "*.jsonl"))):
        dom = os.path.basename(path).replace(".jsonl","")
        st = collections.Counter(); L = collections.defaultdict(collections.Counter)
        for line in open(path, encoding="utf-8", errors="replace"):
            line = line.strip()
            if not line: continue
            r = json.loads(line)
            l = int(r["level"]); gt = r.get("groundtruth"); pred = r.get("prediction")
            as_ok = r.get("correct") is True
            ok, frac, _ = grade(gt, pred)
            st["n"] += 1; st["as"] += as_ok; st["acc"] += ok; st["partial"] += frac
            if as_ok and not ok:
                st["harness_over"] += 1
                hay = norm(pred)
                frag = any(t == "text" and fragment_only(hay, norm(v)) for t, v in gt_parts(gt))
                key = "fragment" if frag else "other"
                if len(samples["over_" + key]) < 5: samples["over_" + key].append((dom, l, str(gt)[:38], str(pred)[:64]))
            if (not as_ok) and ok:
                st["harness_under"] += 1
                structured = str(gt).strip()[:1] in "{[" or ";" in str(gt)
                key = "structured" if structured else "plain"
                if len(samples["under_" + key]) < 5: samples["under_" + key].append((dom, l, str(gt)[:38], str(pred)[:64]))
            e = L[str(l)]; e["n"] += 1; e["as"] += as_ok; e["acc"] += ok; e["partial"] += frac
        st["levels"] = {k: dict(v) for k, v in L.items()}
        doms[dom] = dict(st)
        for k, v in st.items():
            if isinstance(v, (int, float)) and not isinstance(v, bool): T[k] += v
    out["models"][mid] = {"domains": doms, "totals": dict(T), "samples": {k: v for k, v in samples.items()}}
    n = T["n"]
    print(mid, "| FINAL", round(T["acc"]/n*100,2), "| harness", round(T["as"]/n*100,2),
          "| over-credited by harness", T["harness_over"], "| under-credited", T["harness_under"],
          "| agreement", round((n - T["harness_over"] - T["harness_under"])/n*100,3), "%")
json.dump(out, open(os.path.join(BASE,"_final_grade.json"),"w",encoding="utf-8"))
print()
for mid in out["models"]:
    print("---", mid)
    for k, v in out["models"][mid]["samples"].items():
        print("  ", k)
        for s in v[:3]: print("     ", s)
