#!/usr/bin/env python3
"""
run_queue_pool.py — sliding-window batch pool (improvement on wave waiting).

Maintains N in-flight CI runs; the moment one completes: pull its ledger,
verify GREEN, immediately dispatch the next queued batch into the free slot.
--adopt run_id:batch pairs let a restarted pool adopt already-in-flight runs.

Halt-on-failure: no NEW dispatches after any failure; in-flight runs drain
for evidence; exit 3 with a summary.

Usage:
  python dataset-tools/run_queue_pool.py [--width 4] \
      [--adopt batch_0004:33974523391] batch_0006 batch_0007 ...
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
             "--limit", "5", "--json", "databaseId,status",
             "--jq", '[.[] | select(.status=="in_progress")][0].databaseId')
    return out


def status(run_id):
    c = json.loads(sh("gh", "run", "view", str(run_id), "-R", REPO,
                      "--json", "status,conclusion", "--jq", '{status, conclusion}'))
    return c


def verdict_of(batch_id):
    try:
        v = json.load(open(f"dataset-tools/runs/{batch_id}/verification.json",
                           encoding="utf-8"))
        return v.get("verdict", "?")
    except Exception:  # noqa: BLE001
        return "?"


def main():
    args = sys.argv[1:]
    width = 4
    adopted = {}
    if args and args[0] == "--width":
        width = int(args[1]); args = args[2:]
    while args and args[0] == "--adopt":
        k, v = args[1].split(":")
        adopted[k] = v
        args = args[2:]
    queue = list(args)

    in_flight = dict(adopted)  # batch -> run_id
    results = {}
    print(f"POOL: width={width}, adopted={adopted or '{}'}, queued={len(queue)}",
          flush=True)

    # fill free slots
    def fill():
        while len(in_flight) < width and queue and not any(
                v.startswith(("failure", "DISPATCH")) for v in results.values()):
            b = queue.pop(0)
            try:
                rid = dispatch(b)
                in_flight[b] = rid
                print(f"  + dispatch {b} -> run {rid} "
                      f"({len(in_flight)} in flight, {len(queue)} queued)", flush=True)
            except Exception as e:  # noqa: BLE001
                print(f"HALT: dispatch {b}: {e}", flush=True)
                results[b] = "DISPATCH_ERROR"
                return

    fill()
    while in_flight:
        time.sleep(30)
        for b in list(in_flight):
            rid = in_flight[b]
            try:
                c = status(rid)
            except Exception as e:  # noqa: BLE001
                print(f"  warn: status {b}: {str(e)[:80]}", flush=True)
                continue
            if c["status"] != "completed":
                continue
            del in_flight[b]
            concl = c["conclusion"]
            # pull the ledger commit (other slots may push concurrently)
            try:
                sh("git", "pull", "--rebase", "origin", "main")
                v = verdict_of(b)
            except Exception as e:  # noqa: BLE001
                print(f"HALT: git pull after {b}: {str(e)[:120]}", flush=True)
                results[b] = f"{concl}/GIT_ERROR"
                continue
            ok = concl == "success" and v == "GREEN"
            results[b] = "OK" if ok else f"{concl}/{v}"
            print(f"  - {b}: {concl} verdict={v} -> "
                  f"{'OK' if ok else 'FAILED'} ({len(in_flight)} still in flight)",
                  flush=True)
            if not ok:
                print(f"HALT: {b} failed — no new dispatches; draining in-flight",
                      flush=True)
            else:
                fill()

    print(f"\nPOOL SUMMARY: {json.dumps(results, indent=1)}", flush=True)
    done = sum(1 for v in results.values() if v == "OK")
    print(f"POOL {'COMPLETE' if done == len(results) and not queue else 'STOPPED'}: "
          f"{done}/{len(results)} green, {len(queue)} never dispatched", flush=True)
    sys.exit(0 if done == len(results) and not queue else 3)


if __name__ == "__main__":
    main()
