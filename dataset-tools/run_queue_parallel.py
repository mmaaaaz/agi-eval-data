#!/usr/bin/env python3
"""
run_queue_parallel.py — N-wide batch queue (default 4), rate-limit safe.

Parallel design:
  - batches dispatched in waves of N; each CI run is independent
    (per-batch concurrency group; ledger pushes use a rebase-retry loop)
  - Drive API load: ~4 x 530 QPM ~ 2.1k QPM aggregate vs 12k cap (18%)
  - ANY failure in a wave: HALT everything (no new wave), report, exit 3.
    In-flight runs of the failed wave are waited out for evidence, but
    nothing new starts until a human re-dispatches.

Usage: python dataset-tools/run_queue_parallel.py [--width 4] b1 b2 ...
"""
import json
import subprocess
import sys
import time

REPO = "mmaaaaz/agi-eval-data"


def sh(*args, check=True):
    r = subprocess.run(args, capture_output=True, text=True)
    if check and r.returncode != 0:
        raise RuntimeError(f"{' '.join(args)} -> {r.returncode}\n{r.stdout[-300:]}\n{r.stderr[-300:]}")
    return r.stdout.strip()


def dispatch(batch_id):
    sh("gh", "workflow", "run", "optimize-batch", "-R", REPO,
       "-f", f"batch_id={batch_id}", "-f", "mode=apply")
    time.sleep(10)
    out = sh("gh", "run", "list", "-R", REPO, "--workflow=optimize-batch",
             "--limit", "3", "--json", "databaseId,headBranch,status",
             "--jq", f'[.[] | select(.headBranch=="main")][0].databaseId')
    return out


def watch(run_id):
    for attempt in range(3):
        subprocess.run(["gh", "run", "watch", str(run_id), "-R", REPO,
                        "--exit-status", "--interval", "60"],
                       capture_output=True, text=True)
        c = json.loads(sh("gh", "run", "view", str(run_id), "-R", REPO,
                          "--json", "status,conclusion",
                          "--jq", '{status, conclusion}'))
        if c["status"] == "completed":
            return c["conclusion"]
        time.sleep(30)
    raise RuntimeError(f"watch kept dying for run {run_id}")


def main():
    args = sys.argv[1:]
    width = 4
    if args and args[0] == "--width":
        width = int(args[1]); args = args[2:]
    batches = args
    if not batches:
        print("no batches given"); sys.exit(2)

    print(f"PARALLEL QUEUE: {len(batches)} batches, width {width}", flush=True)
    results, queue = {}, list(batches)
    halt = None

    while queue and not halt:
        wave, queue = queue[:width], queue[width:]
        t0 = time.time()
        print(f"\n=== WAVE: {wave} ({len(queue)} batches still queued) ===", flush=True)
        # dispatch all, staggered 20s to spread the initial metadata burst
        runs = {}
        for b in wave:
            try:
                runs[b] = dispatch(b)
                print(f"  {b} -> run {runs[b]}", flush=True)
            except Exception as e:  # noqa: BLE001
                print(f"HALT: dispatch error {b}: {e}", flush=True)
                halt = b; results[b] = "DISPATCH_ERROR"; break
            time.sleep(20)
        if halt:
            break
        # wait out the whole wave regardless (evidence lands even on red)
        wave_results = {}
        for b in wave:
            try:
                wave_results[b] = watch(runs[b])
            except Exception as e:  # noqa: BLE001
                wave_results[b] = f"WATCH_ERROR({str(e)[:80]})"
        # pull all ledgers once, then judge
        try:
            sh("git", "pull", "--rebase", "origin", "main")
        except Exception as e:  # noqa: BLE001
            print(f"HALT: git pull after wave failed: {e} — resolve manually", flush=True)
            halt = wave[0]; break
        for b in wave:
            concl = wave_results[b]
            verdict = "?"
            try:
                v = json.load(open(f"dataset-tools/runs/{b}/verification.json",
                                   encoding="utf-8"))
                verdict = v.get("verdict")
            except Exception:  # noqa: BLE001
                pass
            mins = (time.time() - t0) / 60
            print(f"  {b}: {concl} / verdict={verdict} / wave {mins:.0f} min", flush=True)
            results[b] = "OK" if (concl == "success" and verdict == "GREEN") else (
                f"{concl}/{verdict}")
            if results[b] != "OK" and not halt:
                halt = b  # let the rest of the wave finish reporting, then stop

    print(f"\nQUEUE SUMMARY: {json.dumps(results, indent=1)}", flush=True)
    done = sum(1 for v in results.values() if v == "OK")
    print(f"QUEUE {'COMPLETE' if done == len(batches) and not halt else 'HALTED'}: "
          f"{done}/{len(batches)} green" + (f" (halted at {halt})" if halt else ""),
          flush=True)
    sys.exit(0 if done == len(batches) and not halt else 3)


if __name__ == "__main__":
    main()
