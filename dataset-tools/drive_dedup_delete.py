#!/usr/bin/env python3
"""
drive_dedup_delete.py — Phase 2 executor (gated; plan v6 §5 Phase 2).

Default: build delete_plan.csv + contact sheets (no Drive writes).
--execute: batched writer-trash of planned copies, with idempotent log.

Safety:
  - refuses to run if verify_manifest parity fails (re-check here)
  - hard assert: group count == manifest dupGroups count; Σ wasted matches
  - trash, never delete; delete_log.jsonl makes re-runs skip completed ids
  - --execute requires explicit --yes after the plan has been reviewed
"""
import argparse
import csv
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import netfix  # noqa: E402
netfix.apply()

import drive_io as DIO  # noqa: E402
import dedup_plan as DP  # noqa: E402

DEDUP_DIR = os.path.join(HERE, "dedup")
LOG_PATH = os.path.join(DEDUP_DIR, "delete_log.jsonl")


def build_and_write_plan():
    manifest = json.load(open(os.path.join(ROOT, "data", "latest.json"), encoding="utf-8"))
    plan, total = DP.plan_from_manifest(manifest)
    groups_manifest = len(manifest.get("dupGroups", []))

    # hard asserts (plan v6 Task 2.2)
    assert len(plan) == groups_manifest, \
        f"plan groups {len(plan)} != manifest dupGroups {groups_manifest} — manifest drift, abort"
    expected = sum(g["size"] * (g["count"] - 1) for g in manifest["dupGroups"])
    assert total == expected, f"Σ wasted {total} != dupGroups-derived {expected} — abort"
    print(f"plan: {len(plan)} groups, {sum(len(g['drops']) for g in plan)} drops, "
          f"Σ {total:,} B ({total/2**30:.2f} GiB) — asserts OK")

    os.makedirs(DEDUP_DIR, exist_ok=True)
    csv_path = os.path.join(DEDUP_DIR, "delete_plan.csv")
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["file_id", "name", "md5", "size", "kept_id", "reason"])
        for g in plan:
            for d in g["drops"]:
                w.writerow([d["id"], d["name"], g["md5"], d["size"], g["kept_id"],
                            "exact-md5-duplicate"])
    print(f"wrote {csv_path}")

    # contact sheets: 40 groups per page, thumbnails via lh3
    page, per = 1, 40
    for i in range(0, len(plan), per):
        chunk = plan[i:i + per]
        rows_html = []
        for g in chunk:
            members = [g["kept_id"]] + [d["id"] for d in g["drops"]]
            cells = "".join(
                f'<td><img src="https://lh3.googleusercontent.com/d/{m}=w220" '
                f'loading="lazy"><br><code>{m[:10]}…</code> '
                f'{"KEEP" if m == g["kept_id"] else "drop"}</td>'
                for m in members)
            rows_html.append(f"<tr><td>{g['md5'][:12]}…<br>{sum(d['size'] for d in g['drops'])/2**20:.1f} MB</td>{cells}</tr>")
        css = ("<style>body{background:#111;color:#ddd;font:13px/1.4 sans-serif}"
               "table{border-collapse:collapse}td{border:1px solid #333;padding:6px;"
               "vertical-align:top;text-align:center}img{max-width:220px}code{font-size:10px}"
               "</style>")
        html = ("<!doctype html><meta charset=utf-8><title>dedup contact sheet "
                f"{page}</title>" + css +
                f"<h1>Dedup contact sheet {page} — groups {i+1}–{min(i+per, len(plan))} "
                f"of {len(plan)}</h1><table>" + "".join(rows_html) + "</table>")
        out = os.path.join(DEDUP_DIR, f"contact_sheet_{page:02d}.html")
        open(out, "w", encoding="utf-8").write(html)
        page += 1
    print(f"wrote {page-1} contact sheets in {DEDUP_DIR}")
    return plan, total


def execute(plan):
    if not os.path.exists(LOG_PATH):
        open(LOG_PATH, "a").close()
    done = set()
    for line in open(LOG_PATH, encoding="utf-8"):
        if line.strip():
            done.add(json.loads(line)["id"])
    drops = [(d["id"], d["name"], g["md5"])
             for g in plan for d in g["drops"] if d["id"] not in done]
    print(f"execute: {len(drops)} to trash ({len(done)} already done)")
    errors = []
    for i, (fid, name, md5) in enumerate(drops, 1):
        try:
            DIO.with_retry(DIO.service().files().update, fileId=fid,
                           body={"trashed": True}, fields="id, trashed")
            with open(LOG_PATH, "a", encoding="utf-8") as lf:
                lf.write(json.dumps({"id": fid, "name": name, "md5": md5,
                                     "ts": time.time()}) + "\n")
        except Exception as e:  # noqa: BLE001
            errors.append((fid, str(e)[:120]))
        if i % 100 == 0:
            print(f"  {i}/{len(drops)} trashed, {len(errors)} errors", flush=True)
    print(f"DONE: {len(drops)-len(errors)} trashed, {len(errors)} errors")
    for fid, err in errors[:10]:
        print(f"  ERR {fid}: {err}")
    return 0 if not errors else 4


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--execute", action="store_true")
    ap.add_argument("--yes", action="store_true",
                    help="required with --execute (gate acknowledgment)")
    args = ap.parse_args()
    plan, total = build_and_write_plan()
    if args.execute:
        if not args.yes:
            print("REFUSING: --execute requires --yes (human gate #1 must have passed)")
            sys.exit(5)
        sys.exit(execute(plan))


if __name__ == "__main__":
    main()
