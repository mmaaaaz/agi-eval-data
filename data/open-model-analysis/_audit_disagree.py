
import json, glob, os, re, ast, collections
BASE = r"C:/Users/Maaz/Desktop/open-models figures"
DIRS = {"internvl3_5-8b":"InternVL3_5-8B/internvl3_5-8b", "deepseek-vl2-small":"deepseek-vl2-small/deepseek-vl2-small"}
NUMPAT = re.compile(r"[-+]?\d*\.?\d+"); WORD = re.compile(r"[a-z0-9]")
def to_num(s):
    try: return float(s)
    except Exception: return None
def norm(s):
    s = str(s).lower(); s = re.sub(r"[\"'\x60{}\[\]()]", " ", s)
    s = re.sub(r"\s+", " ", s).strip(); return re.sub(r"[.]+$", "", s).strip()
def bmatch(hay, part):
    if not part: return False
    if hay == part: return True
    st = 0
    while True:
        i = hay.find(part, st)
        if i < 0: return False
        b = hay[i-1] if i > 0 else ""; a = hay[i+len(part)] if i+len(part) < len(hay) else ""
        if not WORD.match(b or " ") and not WORD.match(a or " "): return True
        st = i+1
def nums(s): return [v for v in (to_num(t) for t in NUMPAT.findall(str(s))) if v is not None]
def num_close(a,b): return abs(a-b) <= max(0.05, 0.01*abs(b))
def committed(pred):
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
        if v and all(isinstance(x, (list, tuple)) for x in v): out.append(("rank", [[str(y).strip() for y in g] for g in v]))
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
        o = []; flatten(parsed, o); return o, "structured"
    if ";" in s: return [("text", p) for p in s.split(";")], "multipart"
    n = to_num(s)
    return ([("num", n)] if n is not None else [("text", s)]), "plain"
def rank_ok(pred, groups):
    hay = norm(pred); order = []
    for g in groups:
        for tok in g:
            i = hay.find(norm(tok))
            if i < 0: return False
            order.append((i, tuple(g)))
    order.sort(); seen = []
    for _, g in order:
        if not seen or seen[-1] != g: seen.append(g)
    return seen == [tuple(g) for g in groups]
def grade(gt, pred):
    if pred is None or str(pred).strip() == "": return 0, 0.0
    parts, kind = gt_parts(gt)
    if not parts: return 0, 0.0        # ungradeable (e.g. empty list/dict ground truth)
    hay = norm(pred); seg = committed(pred); sn = nums(seg)
    pool = sn if sn else nums(pred)
    hits = 0
    for typ, val in parts:
        if typ == "num":
            if any(num_close(x, val) for x in pool): hits += 1
        elif typ == "rank":
            if rank_ok(pred, val): hits += 1
        else:
            if bmatch(hay, norm(val)): hits += 1
    return (1 if hits == len(parts) else 0), hits/len(parts)

res = {}
for mid, d in DIRS.items():
    C = collections.Counter(); ex = collections.defaultdict(list)
    for path in sorted(glob.glob(os.path.join(d, "*.jsonl"))):
        dom = os.path.basename(path).replace(".jsonl","")
        for line in open(path, encoding="utf-8", errors="replace"):
            line = line.strip()
            if not line: continue
            r = json.loads(line)
            gt = r.get("groundtruth"); pred = r.get("prediction"); as_ok = r.get("correct") is True
            ok, frac = grade(gt, pred)
            if as_ok and not ok:
                parts, kind = gt_parts(gt); hay = norm(pred); seg = committed(pred)
                pn, sn = nums(pred), nums(seg)
                if any(t == "text" and (norm(v) in hay) and not bmatch(hay, norm(v)) for t, v in parts):
                    c = "text fragment match (harness loophole)"
                elif kind == "plain" and any(t == "num" for t, _ in parts) and any(num_close(x, v) for t, v in parts if t == "num" for x in pn) and not any(num_close(x, v) for t, v in parts if t == "num" for x in sn):
                    c = "right number, wrong committed answer"
                elif kind in ("multipart", "structured"):
                    c = "multi-part / structured answer partially matched"
                else:
                    c = "other"
                C[c] += 1
                if len(ex[c]) < 3: ex[c].append((dom.replace("_dataset_3000","").replace("_dataset_1000",""), int(r["level"]), str(gt)[:34], str(pred)[:56]))
            elif (not as_ok) and ok:
                parts, kind = gt_parts(gt)
                c = {"structured":"structured ground truth recovered",
                     "multipart":"multi-part answer fully matched",
                     "plain":"text/number matched after normalisation"}[kind]
                C["under: " + c] += 1
                if len(ex["under: " + c]) < 3: ex["under: " + c].append((dom.replace("_dataset_3000","").replace("_dataset_1000",""), int(r["level"]), str(gt)[:34], str(pred)[:56]))
    res[mid] = {"counts": dict(C), "examples": {k: v for k, v in ex.items()}}
    print("\n===", mid)
    for k, v in sorted(C.items(), key=lambda x: -x[1]): print("   ", v, k)
    for k in C:
        for s in ex[k][:1]: print("        eg", k, "->", s)
json.dump(res, open(os.path.join(BASE,"_disagreement_audit.json"),"w",encoding="utf-8"))
