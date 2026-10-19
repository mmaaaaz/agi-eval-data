#!/usr/bin/env python3
"""Generate apps/explainer/src/content/runs.ts from the committed demo traces.

Why this exists
---------------
The explainer site's /experiments page must show the REAL first runs: every
item, every model answer, every verdict. Hand-copying trace numbers into TS is
how stale numbers get shipped, so the page data is GENERATED from the same
committed artifacts the harness wrote:

    runs/demo/*.jsonl                      (per-item traces, 4 files)
    runs/demo/summary.json                 (aggregates, cross-checked)
    release/demo-samples-v1/questions.jsonl (item text, choices, answers)

The generator ASSERTS its computed aggregates against summary.json; a mismatch
exits non-zero instead of emitting numbers that disagree with the traces.

Also prints the capability/level codes the demo items actually used per image,
so sample taxonomy tags on the site can be copied from data rather than taste.

Run:  python scripts/harness/make_explainer_runs.py
"""
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEMO = ROOT / "runs" / "demo"
RELEASE = ROOT / "release" / "demo-samples-v1"
OUT = ROOT / "apps" / "explainer" / "src" / "content" / "runs.ts"

# file id -> readable sample name (the 15 curated sample photographs)
SAMPLE_NAMES = {
    "1tS0yaqG-wTlcmVgOn5bDjsc6OViS5PNj": "black_clock_decor_0112.jpg",
    "1yV7IsX1FQ7ZISiE_mUGa_YOouHFkFVWZ": "colorful_toy_train_0055.jpg",
    "1yqc-Bt8wJSqDgM2OxtD2f882ktvu-G1t": "colorful_educational_toy_0305.jpg",
    "1z6e6ZwHTyddx76RrISAsrFHpkALGsrz9": "large_passenger_bus_0050.jpg",
    "1yu8m8xeg4bRh-aR9KHW-sprulkKD08r_": "blue_mountain_bicycle_0391.jpg",
    "1ypNERjZ9A6NTGE0EeoD287u2SGOvSkP3": "large_stadium_structure_1841.jpg",
    "1zE8yp_UQxpqk9RabJqxZ8eGbPbQtfFOs": "modern_school_building_1021.jpg",
    "1ygRKV_hQ_6mzu0TytvYO2lkv4OMjqPPy": "black_coffee_machine_0439.jpg",
    "1z535AFjwX-o86EFq0npf5vdmC-pjLNzB": "multiple_monitor_setup_0118.jpg",
    "1zeo6vjQvhPyLGkuHyr7LDFY-MwIDY1fb": "3186_1787455721326_3341.jpg",
    "1nchrh-Nr_SyP_iV3k1uJNeixoXSwUPNH": "traditional_domed_mosque_1706.jpg",
    "1tuKj_xzS-ddDV_8IdAqhLmdKtHrgnz2e": "large_hospital_building_1124.jpg",
    "1wfaJCDu57jcxTrP9N2NbNNkEKRBrCmv5": "industrial_factory_building_1720.jpg",
    "1yj1ld7HB8iaGexvyDGVMIIJhXLdlfi4C": "colorful_board_game_0405.jpg",
    "1zBFV0cF-RLqvUvf_Z2h6MFBLQO7Uq8rk": "black_planter_decor_0111.jpg",
}

RUN_FILES = {
    "deepseek": ("deepseek-v41f1017.jsonl", "DeepSeek-V4.1-Flash-1017, image attached"),
    "nemotron": ("nemotron.jsonl", "Nemotron-3.5-Super-VL-120B, image attached"),
    "blind": ("blind-deepseek.jsonl", "DeepSeek-V4.1-Flash-1017, no image at all"),
}
RUN_MODEL = {
    "deepseek": {
        "modelId": "deepseek-ai/DeepSeek-V4.1-Flash-1017",
        "modelsJsonId": "deepseek/deepseek-v4.1-flash-1017",
    },
    "nemotron": {
        "modelId": "nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-NVFP4",
        "modelsJsonId": "nvidia/nemotron-3.5-super-vl",
    },
    "blind": {
        "modelId": "deepseek-ai/DeepSeek-V4.1-Flash-1017",
        "modelsJsonId": "deepseek/deepseek-v4.1-flash-1017",
    },
}


def fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


def ts(value: object, indent: int = 0) -> str:
    """JSON-compatible TypeScript literal, stable order."""
    return json.dumps(value, ensure_ascii=False, separators=(", ", ": "))


def main() -> int:
    questions = {}
    order_by_img: dict[str, list[int]] = defaultdict(list)
    for line in (RELEASE / "questions.jsonl").read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        q = json.loads(line)
        questions[(q["file_id"], q["id"])] = q
        order_by_img[q["file_id"]].append(q["id"])
    if len(questions) != 30:
        fail(f"expected 30 questions in the release, found {len(questions)}")

    summary = json.loads((DEMO / "summary.json").read_text(encoding="utf-8"))

    out_runs = []
    for key, (fname, label) in RUN_FILES.items():
        rows = [json.loads(l) for l in (DEMO / fname).read_text(encoding="utf-8").splitlines() if l.strip()]
        if len(rows) != 30:
            fail(f"{fname}: expected 30 rows, found {len(rows)}")
        verdicts = Counter(r.get("verdict") for r in rows)
        print(f"{key}: verdicts {dict(verdicts)}")

        correct = sum(1 for r in rows if r.get("verdict") == "correct")
        abstained = sum(1 for r in rows if r.get("abstained") and r.get("verdict") != "correct")
        # parse_fail = an answer came back that does not name a choice letter.
        # Wrong-but-parseable answers are plain misses, NOT parse failures.
        def parseable(r: dict) -> bool:
            return (r.get("response") or "").strip()[:1].upper() in ("A", "B", "C", "D")
        parse_fail = sum(
            1 for r in rows
            if r.get("verdict") != "correct" and not r.get("abstained") and not parseable(r)
        )

        # cross-check against summary.json
        smodel = {
            "deepseek": "deepseek-ai/DeepSeek-V4.1-Flash-1017",
            "nemotron": "nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-NVFP4",
            "blind": "blind_no_image_deepseek",
        }[key]
        sm = summary["models"][smodel]
        if (sm["correct"], sm["abstained"], sm["parse_fail"]) != (correct, abstained, parse_fail):
            fail(f"{key}: computed (correct={correct}, abstained={abstained}, parse_fail={parse_fail}) "
                 f"!= summary {sm}")

        items = []
        for r in rows:
            q = questions[(r["file_id"], r["question_id"])]
            # response letter -> the choice text it names
            resp = (r.get("response") or "").strip()
            letter_ix = {"A": 0, "B": 1, "C": 2, "D": 3}.get(resp[:1].upper())
            resp_text = q["choices"][letter_ix] if letter_ix is not None and letter_ix < len(q["choices"]) else None
            verdict = r.get("verdict")
            if r.get("abstained") and verdict != "correct":
                verdict_out = "abstained"
            elif verdict == "correct":
                verdict_out = "correct"
            else:
                verdict_out = "wrong" if resp_text is not None else "parse_fail"
            items.append({
                "qid": r["question_id"],
                "fileId": r["file_id"],
                "sample": SAMPLE_NAMES.get(r["file_id"], r["file_id"]),
                "question": q["question"],
                "choices": q["choices"],
                "answer": q["answer"],
                "response": resp,
                "responseText": resp_text,
                "verdict": verdict_out,
                "capability": q.get("capability") or r.get("capability"),
                "level": q.get("level") or r.get("level"),
                "latencyMs": r.get("latency_ms"),
            })
        lat = sorted(i["latencyMs"] for i in items if i["latencyMs"])
        latency = {
            "mean": round(sum(lat) / len(lat)) if lat else 0,
            "p50": lat[len(lat) // 2] if lat else 0,
            "max": lat[-1] if lat else 0,
        }
        out_runs.append({
            "id": key,
            "label": label,
            "modelId": RUN_MODEL[key]["modelId"],
            "modelsJsonId": RUN_MODEL[key]["modelsJsonId"],
            "gateway": summary["gateway"],
            "temperature": rows[0].get("temperature"),
            "pixelBudget": rows[0].get("pixel_budget"),
            "n": len(rows),
            "correct": correct,
            "parseFail": parse_fail,
            "abstained": abstained,
            "accuracy": round(correct / len(rows), 3),
            "latency": latency,
            "items": items,
        })

    # typographic track straight from summary.json (5 groups of 8)
    tg = summary["models"]["typographic_deepseek_n8"]
    typo = {
        "n": 8,
        "groups": [
            {"id": "control", "label": "control, no banner",
             "correct": v["correct"], "n": v["n"], "accuracy": v["accuracy"]}
            for k, v in [("control", tg["control"])]  # control first
        ],
    }
    for name, v in tg.items():
        if name == "control":
            continue
        raw = name.split("-typographic-text_")[-1]
        pretty = {
            "yes": "banner says yes",
            "no": "banner says no",
            "none": "banner says none",
            "offtopic": "off-topic banner",
        }.get(raw, raw)
        typo["groups"].append({
            "id": raw, "label": pretty,
            "correct": v["correct"], "n": v["n"], "accuracy": v["accuracy"],
        })

    # what codes the demo actually used per image (for samples.ts tags)
    codes_by_img: dict[str, Counter] = defaultdict(Counter)
    levels_by_img: dict[str, Counter] = defaultdict(Counter)
    for (fid, _qid), q in questions.items():
        cap = q.get("capability") or "?"
        codes_by_img[fid][cap] += 1
        levels_by_img[fid][q.get("level") or "?"] += 1
    print("\n== per-image codes used by the 30 demo items ==")
    for fid, name in SAMPLE_NAMES.items():
        caps = dict(codes_by_img.get(fid, {}))
        lv = dict(levels_by_img.get(fid, {}))
        print(f"  {name}: caps={caps} levels={lv}" if caps else f"  {name}: (no demo items)")

    unreleased_answer = [i for r in out_runs if r["id"] == "blind" for i in r["items"] if i["verdict"] == "correct"]
    if unreleased_answer:
        print("\nblind run's single hit:", unreleased_answer[0]["question"][:80])

    header = (
        "/* GENERATED FILE - do not edit by hand.\n"
        " * Source: runs/demo/*.jsonl + runs/demo/summary.json + release/demo-samples-v1/questions.jsonl\n"
        " * Regenerate: python scripts/harness/make_explainer_runs.py\n"
        " * Aggregates are asserted against summary.json by the generator. */\n\n"
    )
    body = []
    body.append("export interface RunItem {\n"
                "  qid: number;\n  fileId: string;\n  sample: string;\n  question: string;\n  choices: string[];\n"
                "  answer: string;\n  response: string;\n  responseText: string | null;\n"
                "  verdict: \"correct\" | \"wrong\" | \"parse_fail\" | \"abstained\";\n"
                "  capability: string;\n  level: string;\n  latencyMs: number;\n}\n")
    body.append("export interface Run {\n"
                "  id: string;\n  label: string;\n  modelId: string;\n  modelsJsonId: string;\n"
                "  gateway: string;\n  temperature: number;\n  pixelBudget: number;\n"
                "  n: number;\n  correct: number;\n  parseFail: number;\n  abstained: number;\n  accuracy: number;\n"
                "  latency: { mean: number; p50: number; max: number };\n  items: RunItem[];\n}\n")
    body.append("export const RUNS: Run[] = " + ts(out_runs) + ";\n")
    body.append("export const TYPOGRAPHIC = " + ts(typo) + ";\n")
    body.append(
        "export const RUNS_CAVEAT =\n"
        '  "A demonstration, not a result. The items were hand-drafted for this run, the set is ten "\n'
        '  + "images, and every trace is committed under runs/demo/. The full panel runs against the "\n'
        '  + "frozen benchmark release, not this demo.";\n'
    )
    body.append(
        "export const runForModel = (modelsJsonId: string) =>\n"
        '  RUNS.find((r) => r.modelsJsonId === modelsJsonId && r.id !== "blind") ?? null;\n'
    )
    OUT.write_text(header + "\n".join(body), encoding="utf-8")
    print(f"\nwrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
