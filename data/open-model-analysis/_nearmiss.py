
import json, glob, os, re, ast, collections
BASE = r"C:/Users/Maaz/Desktop/open-models figures"
DIRS = {"internvl3_5-8b":"InternVL3_5-8B/internvl3_5-8b", "deepseek-vl2-small":"deepseek-vl2-small/deepseek-vl2-small"}
NUMPAT = re.compile(r"[-+]?\d*\.?\d+"); WORD = re.compile(r"[a-z0-9]")
def to_num(s):
    try: return float(s)
    except Exception: return None
def norm(s):
    s = str(s).lower(); s = re.sub(r"[\"'\x60{}\[\]()]", " ", s); s = re.sub(r"\s+", " ", s).strip()
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
        st = i+1
def nums(s): return [v for v in (to_num(t) for t in NUMPAT.findall(str(s))) if v is not None]
def num_close(a,b): return abs(a-b) <= max(0.05, 0.01*abs(b))
def committed(pred):
    t=str(pred)
    m=list(re.finditer(r"FINAL ANSWER\s*[:\-]\s*([^\n]+)", t, re.I))
    if m: return m[-1].group(1)
    m=list(re.finditer(r"(?:the\s+)?(?:correct\s+)?(?:final\s+)?answer\s*(?:is|:)\s*([^\n]+)", t, re.I))
    if m: return m[-1].group(1)
    return t
for mid, d in DIRS.items():
    near = collections.Counter(); rel = collections.Counter(); ex = []
    for path in sorted(glob.glob(os.path.join(d, "*.jsonl"))):
        dom = os.path.basename(path).replace(".jsonl","").replace("_dataset_3000","").replace("_dataset_1000","")
        for line in open(path, encoding="utf-8", errors="replace"):
            line=line.strip()
            if not line: continue
            r=json.loads(line)
            if not (r.get("correct") is True): continue
            gt=r.get("groundtruth"); pred=r.get("prediction"); g=to_num(gt)
            if g is None: continue
            pn=nums(pred); segn=nums(committed(pred))
            if any(num_close(x,g) for x in (segn if segn else pn)): continue   # rule agrees
            if any(num_close(x,g) for x in pn): continue                      # right number, wrong commitment
            # harness credited a number that is not within 1%
            if not pn: continue
            best=min(pn, key=lambda x: abs(x-g)); diff=abs(best-g); rl=diff/abs(g) if g else 9
            near[dom]+=1; rel["<=2%" if rl<=0.02 else "<=5%" if rl<=0.05 else "<=10%" if rl<=0.10 else ">10%"]+=1
            if len(ex)<6: ex.append((dom, str(gt)[:26], str(pred)[:48], round(best,3), round(rl*100,1)))
    print("\n===", mid, "| harness accepted a number outside 1% tolerance:", sum(near.values()))
    print("   relative error bands:", dict(rel))
    print("   by domain:", near.most_common(6))
    for e in ex: print("      ", e)
