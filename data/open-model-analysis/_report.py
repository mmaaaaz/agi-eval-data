
import json, os, glob, re, collections, datetime

BASE = r"C:/Users/Maaz/Desktop/open-models figures"
MODELS = {
    "internvl3_5-8b": os.path.join(BASE, "InternVL3_5-8B", "internvl3_5-8b"),
    "deepseek-vl2-small": os.path.join(BASE, "deepseek-vl2-small", "deepseek-vl2-small"),
}
WORD = re.compile(r"[a-z0-9]")
NUMPAT = re.compile(r"[-+]?\d*\.?\d+")

def to_num(s):
    try: return float(s)
    except Exception: return None

def strict_text(pred, gt):
    p = pred.lower().strip(); g = gt.lower().strip()
    if not g: return False
    if p == g: return True
    start = 0
    while True:
        i = p.find(g, start)
        if i < 0: return False
        before = p[i-1] if i > 0 else ""
        after = p[i+len(g)] if i+len(g) < len(p) else ""
        if not WORD.match(before or " ") and not WORD.match(after or " "): return True
        start = i + 1

def score_candidate(cand, gt):
    """Score an extracted candidate string against groundtruth."""
    if cand is None: return False
    cand = cand.strip().strip('.:,;').strip()
    if not cand: return False
    g = to_num(str(gt))
    if g is not None:
        for tok in NUMPAT.findall(cand):
            v = to_num(tok)
            if v is not None and abs(v-g) <= max(1e-6, 0.01*abs(g)): return True
        return False
    if strict_text(cand, str(gt)): return True
    if len(str(gt)) <= 2 and re.search(r"(?<![a-z0-9])" + re.escape(str(gt)) + r"(?![a-z0-9])", cand, re.I): return True
    return False

def extract(raw, gt):
    """Recover an answer from an unparsed (verbose) response. Returns None if not recoverable."""
    t = raw or ""
    if not t.strip(): return None
    m = re.findall(r"FINAL ANSWER\s*[:\-]\s*(.+)", t, re.I)
    if m: return m[-1].strip().split("\n")[0]
    m = re.findall(r"(?:the\s+)?(?:correct\s+)?(?:final\s+)?answer\s*(?:is|:)\s*([^\n\.]{1,60})", t, re.I)
    if m: return m[-1].strip()
    if len(str(gt)) <= 3 and re.fullmatch(r"[A-Za-z]+", str(gt)):
        m = re.findall(r"(?:option|choice|answer)\s*\(?([A-Za-z])\)?", t, re.I)
        if m: return m[-1]
    m = re.findall(r"\{([^{}]{1,40})\}", t)
    if m: return m[-1]
    return None

report = {"meta": {"generated": datetime.datetime.now().isoformat(timespec="seconds"),
                   "note": "as = harness score, strict = word-boundary/numeric re-score, recovered = re-score with answer extraction on unparsed responses"},
          "models": {}}

for model, d in MODELS.items():
    doms = {}
    T = collections.Counter()
    lvT = collections.Counter(); lvA = collections.Counter(); lvS = collections.Counter(); lvR = collections.Counter()
    for path in sorted(glob.glob(os.path.join(d, "*.jsonl"))):
        dom = os.path.basename(path).replace(".jsonl", "")
        st = collections.Counter()
        lv = {}
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line: continue
                r = json.loads(line)
                gt = r.get("groundtruth"); pred = r.get("prediction"); raw = r.get("raw_response") or ""
                l = int(r["level"])
                st["n"] += 1
                a = 1 if r.get("correct") is True else 0
                st["as"] += a
                parse_fail = (pred is None) or (pred if isinstance(pred, str) else "") == "" or (isinstance(pred, str) and len(pred) > 120)
                # strict
                mode = r.get("score_mode") or "none"
                if mode == "numeric" or (to_num(str(gt)) is not None and to_num(str(pred)) is not None):
                    p = to_num(str(pred)); g = to_num(str(gt))
                    s = 1 if (p is not None and g is not None and abs(p-g) <= max(1e-6, 0.01*abs(g))) else 0
                else:
                    s = 1 if strict_text(str(pred), str(gt)) else 0
                st["strict"] += s
                if parse_fail:
                    st["parseFail"] += 1
                    cand = extract(raw, gt)
                    rec = 1 if score_candidate(cand, gt) else 0
                    if rec: st["recovered_from_parsefail"] += 1
                else:
                    rec = s
                st["recovered"] += rec
                if a and not s: st["loose"] += 1
                k = str(l)
                e = lv.setdefault(k, {"n":0,"as":0,"strict":0,"recovered":0})
                e["n"] += 1; e["as"] += a; e["strict"] += s; e["recovered"] += rec
                lvT[l] += 1; lvA[l] += a; lvS[l] += s; lvR[l] += rec
        st["levels"] = lv
        doms[dom] = dict(st)
        for k, v in st.items():
            if isinstance(v, int): T[k] += v
    report["models"][model] = {"domains": doms, "totals": dict(T),
        "levels": {str(k): {"n": int(lvT[k]), "as": int(lvA[k]), "strict": int(lvS[k]), "recovered": int(lvR[k])} for k in sorted(lvT)}}
    n = T["n"]
    print(model, "n", n, "as", round(T["as"]/n,4), "strict", round(T["strict"]/n,4), "recovered", round(T["recovered"]/n,4),
          "parseFail", T["parseFail"], "recovered_from_pf", T["recovered_from_parsefail"])

with open(os.path.join(BASE, "_report_data.json"), "w", encoding="utf-8") as fh:
    json.dump(report, fh)
print("written _report_data.json")
