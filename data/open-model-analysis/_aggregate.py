
import json, os, glob, collections, datetime

BASE = r"C:/Users/Maaz/Desktop/open-models figures"
MODELS = {
    "internvl3_5-8b": os.path.join(BASE, "InternVL3_5-8B", "internvl3_5-8b"),
    "deepseek-vl2-small": os.path.join(BASE, "deepseek-vl2-small", "deepseek-vl2-small"),
}

out = {"meta": {"generated": datetime.datetime.now().isoformat(timespec="seconds"), "models": {}, "problems": []}, "models": {}}

for model, d in MODELS.items():
    domains = {}
    grand = collections.Counter()
    lvl_total = collections.Counter(); lvl_correct = collections.Counter()
    score_modes = collections.Counter()
    dupes = 0
    err_files = 0
    for path in sorted(glob.glob(os.path.join(d, "*.jsonl"))):
        fname = os.path.basename(path)
        dom = fname.replace(".jsonl", "")
        tot = cor = 0
        lt = collections.Counter(); lc = collections.Counter()
        ids = set(); errs = 0; nones = 0; missing_level = 0; extract_fail = 0
        modes = collections.Counter()
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line: continue
                try: rec = json.loads(line)
                except Exception: errs += 1; continue
                tot += 1
                if rec.get("error"): errs += 1
                qid = rec.get("question_id")
                if qid in ids: dupes += 1
                else: ids.add(qid)
                lv = rec.get("level")
                if lv is None: missing_level += 1
                else:
                    lv = int(lv); lt[lv] += 1
                pred = rec.get("prediction"); raw = rec.get("raw_response") or ""
                if pred is None or (isinstance(pred, str) and pred.strip() == ""): nones += 1
                if isinstance(pred, str) and len(pred) > 120: extract_fail += 1
                modes[rec.get("score_mode")] += 1
                if rec.get("correct") is True:
                    cor += 1
                    if lv is not None: lc[lv] += 1
        domains[dom] = {
            "total": tot, "correct": cor, "accuracy": (cor / tot if tot else None),
            "levels": {str(k): {"total": lt[k], "correct": lc.get(k, 0), "accuracy": (lc.get(k, 0)/lt[k] if lt[k] else None)} for k in sorted(lt)},
            "errors": errs, "null_pred": nones, "missing_level": missing_level,
            "extract_fail": extract_fail, "long_pred": extract_fail, "score_modes": dict(modes),
        }
        grand["total"] += tot; grand["correct"] += cor
        for k in lt: lvl_total[k] += lt[k]
        for k in lc: lvl_correct[k] += lc[k]
        for k, v in modes.items(): score_modes[k] += v
        if errs: err_files += 1
    out["models"][model] = {
        "totals": {"total": grand["total"], "correct": grand["correct"],
                   "accuracy": grand["correct"]/grand["total"] if grand["total"] else None},
        "levels": {str(k): {"total": lvl_total[k], "correct": lvl_correct.get(k,0),
                   "accuracy": lvl_correct.get(k,0)/lvl_total[k] if lvl_total[k] else None} for k in sorted(lvl_total)},
        "score_modes": dict(score_modes), "duplicate_ids": dupes,
        "domains": domains, "n_domains": len(domains),
    }
    print(model, grand["total"], grand["correct"], round(grand["correct"]/grand["total"], 4), "dupes:", dupes, "files_with_errors:", err_files)

with open(os.path.join(BASE, "_summary_raw.json"), "w", encoding="utf-8") as fh:
    json.dump(out, fh)
print("written _summary_raw.json")
