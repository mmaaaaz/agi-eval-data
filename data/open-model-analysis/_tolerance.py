
import json, glob, os, re, collections
BASE = r"C:/Users/Maaz/Desktop/open-models figures"
DIRS = {"internvl3_5-8b":"InternVL3_5-8B/internvl3_5-8b", "deepseek-vl2-small":"deepseek-vl2-small/deepseek-vl2-small"}
NUMPAT = re.compile(r"[-+]?\d*\.?\d+")
WORD = re.compile(r"[a-z0-9]")
def to_num(s):
    try: return float(s)
    except Exception: return None
def norm(s):
    s = str(s).lower(); s = re.sub(r"[\"'\x60{}\[\]()]", " ", s)
    s = re.sub(r"\s+", " ", s).strip(); return re.sub(r"[.]+$", "", s).strip()
def nums(s): return [v for v in (to_num(t) for t in NUMPAT.findall(str(s))) if v is not None]

# Among harness-correct / rule-wrong records: how far off was the number?
cls = collections.Counter(); diffs = collections.Counter(); tol_gain = collections.Counter()
for mid, d in DIRS.items():
    for path in sorted(glob.glob(os.path.join(d, "*.jsonl"))):
        dom = os.path.basename(path).replace(".jsonl","")
        if dom.split("_dataset")[0] != "angle_estimation": continue
        for line in open(path, encoding="utf-8", errors="replace"):
            line = line.strip()
            if not line: continue
            r = json.loads(line)
            if not (r.get("correct") is True): continue
            gt = to_num(r.get("groundtruth")); pn = nums(r.get("prediction"))
            if gt is None or not pn: continue
            p = min(pn, key=lambda x: abs(x-gt))
            if abs(p-gt) <= max(0.05, 0.01*abs(gt)): continue      # already correct under the rule
            diff = abs(p-gt); diffs[round(diff)] += 1
            if diff <= 3: tol_gain[mid] += 1
        cls[dom] += 1
print("angle_estimation: harness credits rejected by the 1% rule, by absolute degrees off:")
print("  ", dict(sorted(diffs.items())[:10]))
print("   within 3 degrees:", dict(tol_gain))

# what a +-3 degree tolerance would do to that domain and to the overall score
tot = {}
for mid, d in DIRS.items():
    n = acc = 0; ang_n = ang_acc = 0
    for path in sorted(glob.glob(os.path.join(d, "*.jsonl"))):
        dom = os.path.basename(path).replace(".jsonl","")
        for line in open(path, encoding="utf-8", errors="replace"):
            line = line.strip()
            if not line: continue
            r = json.loads(line); n += 1
            gt = to_num(r.get("groundtruth")); pn = nums(r.get("prediction"))
            ok = bool(pn) and gt is not None and any(abs(x-gt) <= max(0.05, 0.01*abs(gt)) for x in pn)
            if dom.split("_dataset")[0] == "angle_estimation":
                ang_n += 1; ang_acc += ok
            acc += ok
    tot[mid] = (n, acc, ang_n, ang_acc, tol_gain[mid])
    print(mid, "| angle_estimation rule-acc", round(ang_acc/ang_n*100,1), "-> with +-3deg tolerance",
          round((ang_acc+tol_gain[mid])/ang_n*100,1), "| overall impact",
          round(tol_gain[mid]/n*100,2), "points (", round(acc/n*100,2), "->", round((acc+tol_gain[mid])/n*100,2), ")")
