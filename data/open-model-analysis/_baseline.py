
import json, glob, os, collections

BASE = r"C:/Users/Maaz/Desktop/open-models figures"
DIRS = {"ivl": os.path.join(BASE,"InternVL3_5-8B","internvl3_5-8b"), "ds": os.path.join(BASE,"deepseek-vl2-small","deepseek-vl2-small")}
out = {"domains": {}, "gt_mismatch": [], "notes": {}}
gtc = {"ivl": {}, "ds": {}}
for tag, d in DIRS.items():
    for path in sorted(glob.glob(os.path.join(d, "*.jsonl"))):
        dom = os.path.basename(path).replace(".jsonl","")
        allc = collections.Counter(); lv = collections.defaultdict(collections.Counter)
        for line in open(path, encoding="utf-8", errors="replace"):
            line = line.strip()
            if not line: continue
            r = json.loads(line)
            g = str(r.get("groundtruth"))
            allc[g] += 1; lv[int(r["level"])][g] += 1
        gtc[tag][dom] = (allc, lv)

dom_cmp = json.dumps
for dom in gtc["ivl"]:
    a, la = gtc["ivl"][dom]; b, lb = gtc["ds"][dom]
    if a != b or {k: dict(v) for k,v in la.items()} != {k: dict(v) for k,v in lb.items()}:
        out["gt_mismatch"].append(dom)

for dom in gtc["ivl"]:
    allc, lv = gtc["ivl"][dom]
    n = sum(allc.values())
    ent = {"n": n, "base_overall": max(allc.values())/n, "top_overall": allc.most_common(1)[0][0][:40], "levels": []}
    for l in range(1,6):
        c = lv[l]; tot = sum(c.values()) or 1
        top, cnt = c.most_common(1)[0]
        ent["levels"].append({"n": tot, "base": cnt/tot, "top": str(top)[:40], "distinct": len(c)})
    out["domains"][dom] = ent

# summary of degenerate levels
deg = []
for dom, e in out["domains"].items():
    for i, l in enumerate(e["levels"]):
        if l["base"] >= 0.9: deg.append((dom, i+1, round(l["base"],3), l["top"]))
print("domains with a level >=90% single answer:", len(deg))
for x in sorted(deg, key=lambda y:-y[2])[:14]: print("   ", x)

print("\ngt identical across models for all domains:", not out["gt_mismatch"], out["gt_mismatch"][:5])

# how well does a majority-class oracle do overall?
tot_n = sum(e["n"] for e in out["domains"].values())
tot_c = sum(e["base_overall"]*e["n"] for e in out["domains"].values())
print("majority-class oracle overall:", round(tot_c/tot_n*100,2), "% over", tot_n, "questions")
json.dump(out, open(os.path.join(BASE,"_baseline.json"),"w",encoding="utf-8"))
