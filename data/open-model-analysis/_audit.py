
import json, os, glob, re, collections, datetime

BASE = r"C:/Users/Maaz/Desktop/open-models figures"
MODELS = {
    "internvl3_5-8b": os.path.join(BASE, "InternVL3_5-8B", "internvl3_5-8b"),
    "deepseek-vl2-small": os.path.join(BASE, "deepseek-vl2-small", "deepseek-vl2-small"),
}
WORD = re.compile(r"[a-z0-9]")

def num(s):
    try: return float(s)
    except Exception: return None

def strict_text(pred, gt):
    p = pred.lower().strip(); g = gt.lower().strip()
    if p == g: return True
    start = 0
    while True:
        i = p.find(g, start)
        if i < 0: return False
        before = p[i-1] if i > 0 else ""
        after = p[i+len(g)] if i+len(g) < len(p) else ""
        if not WORD.match(before or " ") and not WORD.match(after or " "):
            return True
        start = i + 1

out = {"meta": {"generated": datetime.datetime.now().isoformat(timespec="seconds")}, "models": {}}

for model, d in MODELS.items():
    stats = {}
    suspects = []; parse_fail_samples = []
    agg = collections.Counter()
    level_as = collections.Counter(); level_as_c = collections.Counter()
    level_strict = collections.Counter(); level_strict_c = collections.Counter()
    doms = {}
    for path in sorted(glob.glob(os.path.join(d, "*.jsonl"))):
        dom = os.path.basename(path).replace(".jsonl", "")
        st = collections.Counter()
        img_idx = set()
        lt = collections.Counter(); ltc = collections.Counter(); lsc = collections.Counter()
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line: continue
                r = json.loads(line)
                st["n"] += 1
                lv = int(r["level"])
                as_ok = (r.get("correct") is True)
                if not isinstance(r.get("correct"), bool): st["non_bool_correct"] += 1
                gt = r.get("groundtruth"); pred = r.get("prediction"); raw = r.get("raw_response") or ""
                lv_ = lv
                lt[lv_] += 1
                if as_ok: ltc[lv_] += 1; st["as_correct"] += 1
                mode = r.get("score_mode") or "none"
                parse_fail = (pred is None) or (isinstance(pred, str) and (pred.strip() == "" or len(pred) > 120))
                if parse_fail: st["parse_fail"] += 1
                # strict re-score
                ok = False; reason = "unscored"
                if gt is None or pred is None:
                    ok = False; reason = "missing"
                elif mode == "numeric" or (num(str(gt)) is not None and num(str(pred)) is not None):
                    p = num(str(pred)); g = num(str(gt))
                    if p is None or g is None: ok = False; reason = "num_parse_fail"
                    else:
                        ok = abs(p-g) <= max(1e-6, 0.01*abs(g)); reason = "numeric"
                elif mode == "multi_part_exact":
                    ok = strict_text(str(pred), str(gt)); reason = "multi"
                else:
                    ok = strict_text(str(pred), str(gt)); reason = "text"
                if ok: lsc[lv_] += 1; st["strict_correct"] += 1
                # anomalies
                if as_ok and not ok and mode != "numeric":
                    st["loose_correct_strict_fail"] += 1
                    if len(suspects) < 12: suspects.append({"dom": dom, "lv": lv, "gt": str(gt)[:60], "pred": str(pred)[:110]})
                if (not as_ok) and ok and mode == "numeric":
                    st["numeric_tolerance_miss"] += 1
                if as_ok and parse_fail: st["as_correct_but_parse_fail"] += 1
                # image index
                m = re.match(r"^(.*)_(\d{4})_q(\d+)$", r.get("question_id") or "")
                if m: img_idx.add(int(m.group(2)))
        doms[dom] = dict(st)
        doms[dom]["images_seen"] = len(img_idx)
        doms[dom]["img_min"] = min(img_idx) if img_idx else None
        doms[dom]["img_max"] = max(img_idx) if img_idx else None
        doms[dom]["levels_as_correct"] = {str(k): ltc[k] for k in sorted(ltc)}
        doms[dom]["levels_as_total"] = {str(k): lt[k] for k in sorted(lt)}
        doms[dom]["levels_strict_correct"] = {str(k): lsc[k] for k in sorted(lsc)}
        for k in lt:
            level_as[k] += lt[k]; level_as_c[k] += ltc[k]; level_strict[k] += lt[k]; level_strict_c[k] += lsc[k]
        for k in st: agg[k] += st[k]
    out["models"][model] = {
        "agg": dict(agg),
        "levels": {str(k): {"total": int(level_as[k]), "as_correct": int(level_as_c[k]),
                            "strict_correct": int(level_strict_c.get(k,0))} for k in sorted(level_as)},
        "domains": doms, "suspects": suspects,
        "as_acc": agg["as_correct"]/agg["n"], "strict_acc": agg["strict_correct"]/agg["n"],
    }
    print(model, "n=", agg["n"], "as=", round(agg["as_correct"]/agg["n"],4), "strict=", round(agg["strict_correct"]/agg["n"],4),
          "loose_ok_strict_fail=", agg["loose_correct_strict_fail"], "num_tol_miss=", agg["numeric_tolerance_miss"],
          "parse_fail=", agg["parse_fail"])

with open(os.path.join(BASE, "_audit.json"), "w", encoding="utf-8") as fh:
    json.dump(out, fh)
print("written _audit.json")
