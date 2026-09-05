#!/usr/bin/env python3
"""
run_queue.py — unattended batch queue (plan v6 Task 4.5, Maaz-approved 2026-09-05).

For each batch: dispatch CI (mode=apply) -> watch -> verify GREEN -> pull ledger
-> next. ANY failure (run red, verdict RED, git conflict) HALTS the queue with
a clear marker — human restart required. Progress lines print per batch.

Usage: python dataset-tools/run_queue.py batch_0001 batch_0002 ... batch_0027
"""
import json
import subprocess
import sys
import time

REPO = "mmaaaaz/agi-eval-data"


def sh(*args, check=True):
    r = subprocess.run(args, capture_output=True, text=True)
    if check and r.returncode != 0:
        raise RuntimeError(f"{' '.join(args)} -> {r.returncode}\n{r.stdout[-400:]}\n{r.stderr[-400:]}")
    return r.stdout.strip()


def dispatch(batch_id):
    sh("gh", "workflow", "run", "optimize-batch", "-R", REPO,
       "-f", f"batch_id={batch_id}", "-f", "mode=apply")
    time.sleep(10)  # GitHub registration lag
    out = sh("gh", "run", "list", "-R", REPO, "--workflow=optimize-batch",
             "--limit", "1", "--json", "databaseId,status",
             "--jq", '.[0].databaseId')
    return out


def watch(run_id):
    for attempt in range(3):
        r = subprocess.run(
            ["gh", "run", "watch", str(run_id), "-R", REPO, "--exit-status",
             "--interval", "60"],
            capture_output=True, text=True)
        if r.returncode == 0:
            return "success"
        # distinguish failure vs transient watch hiccup: ask the API
        concl = sh("gh", "run", "view", str(run_id), "-R", REPO, "--json",
                   "status,conclusion", "--jq", '{status, conclusion}')
        c = json.loads(concl)
        if c["status"] == "completed":
            return c["conclusion"]  # success / failure / cancelled
        time.sleep(30)  # watch died mid-run; retry
    raise RuntimeError(f"watch kept dying for run {run_id}")


def main():
    batches = sys.argv[1:]
    if not batches:
        print("no batches given"); sys.exit(2)
    print(f"QUEUE START: {len(batches)} batches: {batches}", flush=True)
    results = {}
    for i, b in enumerate(batches, 1):
        t0 = time.time()
        print(f"\n[{i}/{len(batches)}] dispatching {b} (mode=apply)…", flush=True)
        try:
            run_id = dispatch(b)
            print(f"  run {run_id} — watching…", flush=True)
            concl = watch(run_id)
        except Exception as e:  # noqa: BLE001
            print(f"HALT: dispatch/watch error on {b}: {e}", flush=True)
            results[b] = "DISPATCH_ERROR"
            break
        if concl != "success":
            print(f"HALT: {b} (run {run_id}) concluded {concl} — "
                  "queue stopped, human review required", flush=True)
            results[b] = concl
            break
        # pull CI's ledger commit
        try:
            sh("git", "pull", "--rebase", "origin", "main")
        except Exception as e:  # noqa: BLE001
            print(f"HALT: git pull failed after {b}: {e} — resolve manually", flush=True)
            results[b] = "GIT_ERROR"
            break
        # read verdict from the pulled ledger
        try:
            v = json.load(open(f"dataset-tools/runs/{b}/verification.json", encoding="utf-8"))
            verdict = v.get("verdict")
        except Exception:  # noqa: BLE001
            verdict = "UNKNOWN(no-ledger)"
        mins = (time.time() - t0) / 60
        print(f"  {b}: {concl} / verdict={verdict} / {mins:.0f} min", flush=True)
        if verdict != "GREEN":
            print(f"HALT: {b} battery verdict {verdict} — queue stopped", flush=True)
            results[b] = verdict
            break
        results[b] = "OK"
    print(f"\nQUEUE SUMMARY: {json.dumps(results, indent=1)}", flush=True)
    done = sum(1 for v in results.values() if v == "OK")
    print(f"QUEUE {'COMPLETE' if done == len(batches) else 'HALTED'}: "
          f"{done}/{len(batches)} batches green", flush=True)
    sys.exit(0 if done == len(batches) else 3)


if __name__ == "__main__":
    main()
