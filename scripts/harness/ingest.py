"""Send a completed trace to the relay, behind the harness door.

The site can read results but never write them; only this does, and only with
x-harness-code. Batched, because D1 bills rows written.
"""
from __future__ import annotations
import json
import pathlib
import urllib.error
import urllib.request

from .analyze import collapse


def read_trace(trace_path: str | pathlib.Path) -> list[dict]:
    p = pathlib.Path(trace_path)
    return [json.loads(l) for l in p.read_text(encoding="utf-8-sig").splitlines() if l.strip()]


def _rate(numerator: int, denominator: int) -> float:
    """A ratio that is 0.0 rather than a ZeroDivisionError when nothing was measured."""
    return (numerator / denominator) if denominator else 0.0


def summarise(rows: list[dict]) -> dict:
    """The numbers the paper quotes, computed from the trace, not from the site.

    Repeats are collapsed FIRST, through the same function analyze.py uses. This is not
    a detail: before this, a 3-repeat trace published one accuracy and had the paper
    compute another from the same file, because this function counted SAMPLES while the
    leaderboard counted ITEMS. Two code paths for one number is one code path too many,
    and a reader has no way to tell which one they are looking at.
    """
    if not rows:
        return {}
    # ONE SUMMARY IS ONE RUN. A trace holding a SERIES must not be blended into a single
    # number, and it must not silently succeed either.
    #
    # `run_attack.py` writes 21 conditions and `run_crop.py` writes 6 fractions into one file.
    # Blending them reports a run_id naming ONE condition, an n_items of that condition, and an
    # accuracy averaged across all of them — a plausible number from a trace where most of the
    # measurements were discarded. The old grouping produced exactly that.
    runs = {str(r.get("run_id")) for r in rows}
    if len(runs) > 1:
        raise ValueError(
            "this trace holds " + str(len(runs)) + " runs and summarise() describes ONE. "
            "Blending them would report a single accuracy for " + str(len(runs))
            + " different measurements. Call it per run_id, or use summarise_all(). "
            "First few: " + ", ".join(sorted(runs)[:3]))
    collapsed, stats = collapse(rows)
    answered = [r for r in collapsed if not r.get("error")]
    n = len(answered)
    correct = sum(1 for r in answered if r.get("verdict") == "correct")
    close = sum(1 for r in answered if r.get("verdict") == "close")
    abstained = sum(1 for r in answered if r.get("abstained") == 1)
    unparsed = sum(1 for r in answered if r.get("parse_ok") == 0)
    errored = len(collapsed) - len(answered)
    return {
        "run_id": rows[0].get("run_id"),
        "model": rows[0].get("model"),
        "prompt_arm": rows[0].get("prompt_id"),
        "temperature": rows[0].get("temperature"),
        "groundtruth_hash": rows[0].get("groundtruth_hash"),
        "recipe_hash": rows[0].get("recipe_hash"),
        "n": n,
        "n_items": n,
        "n_answered": n,
        "n_errored": errored,
        "n_samples": stats["n_samples"],
        "unstable_rate": _rate(stats["unstable"], n),
        # _rate, not a bare division. A run where EVERY item failed — a wrong endpoint, a
        # dead key — has n = 0, and dividing by it crashed the ingest instead of
        # reporting "0 answered, N errored". The one case where a summary must never
        # throw is the one where nothing worked.
        "accuracy": _rate(correct, n),
        "close_rate": _rate(close, n),
        "abstention_rate": _rate(abstained, n),
        "parse_fail_rate": _rate(unparsed, n),
        "error_rate": _rate(errored, len(collapsed)),
    }


def summarise_all(rows: list[dict]) -> dict[str, dict]:
    """One summary per run_id. The correct entry point for a multi-condition trace."""
    by_run: dict[str, list[dict]] = {}
    for r in rows:
        by_run.setdefault(str(r.get("run_id")), []).append(r)
    return {rid: summarise(rs) for rid, rs in by_run.items()}


def post(rows: list[dict], relay: str, harness_code: str, batch: int = 200, timeout: int = 60) -> dict:
    """POST /api/runs in batches. Returns a per-batch status summary.

    REFUSES A MULTI-RUN TRACE, and the refusal is the point.
    ```
    `evaluations` is UNIQUE(question_id, model) — the run_id is NOT in the key — so posting 21
    conditions of the same 8 questions would have the conditions OVERWRITE each other and the
    site would store 8 items while the trace held 168. That is the same defect as the
    round-30 "site and paper publish different accuracies from one trace", and it fails the
    same way: silently, with a number that looks fine.
    ```
    Rather than store one condition and call it a result, this stops. The schema needs run_id in
    the uniqueness key before a ladder can be published; until then a series is analysed from
    its trace, which is the only place all of it exists.
    """
    runs = {str(r.get("run_id")) for r in rows}
    if len(runs) > 1:
        # A SERIES IS PUBLISHED ONE RUN AT A TIME, which is what `evaluations`' key now allows:
        # v5e put run_id into UNIQUE(question_id, model, run_id), so two conditions of one
        # question are two rows rather than one overwriting the other. Each run goes as its own
        # POST with its own summary, because one summary describes one run.
        #
        # Before v5e this raised instead — correctly, because the conditions would have
        # overwritten each other and the site would have kept only the last. The refusal is kept
        # for the case it still protects: a caller that has not applied v5e.
        out = {"sent": 0, "failed": 0, "n": 0, "n_trace_rows": len(rows), "runs": {}}
        for rid in sorted(runs):
            sub = [r for r in rows if str(r.get("run_id")) == rid]
            res = post(sub, relay, harness_code, batch=batch, timeout=timeout)
            out["sent"] += res["sent"]
            out["failed"] += res["failed"]
            out["n"] += res["n"]
            out["runs"][rid] = {"sent": res["sent"], "failed": res["failed"]}
        return out
    url = relay.rstrip("/") + "/api/runs"
    # The WHOLE-run summary, sent with every batch. The relay upserts one row per
    # run_id, so a per-batch summary meant the stored n_items was whatever the last
    # batch happened to contain — 100 for a 500-item run.
    summary = summarise(rows)

    # ONE ROW PER ITEM, matching what the paper computes.
    #
    # `evaluations` has UNIQUE(question_id, model) and this endpoint UPSERTS the verdict,
    # so posting the raw trace meant a 3-repeat run overwrote itself three times and the
    # API kept the LAST sample's verdict — while analyze.py used the MAJORITY. The site
    # and the paper published different accuracies from the same trace.
    #
    # An item that never succeeded goes with NO verdict and the error text. It is missing
    # data: previously it was stored as 'wrong' (run.py sets that on failure), so a
    # rate-limited request counted against the model forever and the site's accuracy fell
    # every time the API wobbled.
    collapsed, _stats = collapse(rows)
    results: list[dict] = []
    for r in collapsed:
        if r.get("error"):
            results.append(dict(r, verdict=None, abstained=0))
        else:
            results.append(r)

    sent = failed = 0
    chunks = list(range(0, len(results), batch))
    for pos, i in enumerate(chunks):
        chunk = results[i:i + batch]
        # THE LAST BATCH DECLARES ITSELF, so the relay rebuilds its summaries ONCE for this run.
        #
        # Without this the relay recomputed per batch, and each recompute scanned the run's rows
        # again: measured on a real campaign (29 runs x 6 models x 2,500 items, batch 200),
        # 2,262 POSTs x a growing scan = **6,298,800 rows read, 1.3x the 5,000,000/day read
        # allowance.** The fix for the leaderboard's scan had moved that cost into the ingest.
        #
        # `final` is only true on a real last batch. A retried batch that happens to be last
        # declares it again, which is harmless because the relay recomputes rather than
        # increments — replaying it converges on the same numbers.
        run_body = dict(summary)
        run_body["final"] = (pos == len(chunks) - 1)
        body = json.dumps({"run": run_body, "results": chunk}).encode("utf-8")
        req = urllib.request.Request(
            url, data=body, method="POST",
            headers={"Content-Type": "application/json", "x-harness-code": harness_code},
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                if 200 <= resp.status < 300:
                    sent += len(chunk)
                else:
                    failed += len(chunk)
        except urllib.error.URLError:
            failed += len(chunk)
    return {"sent": sent, "failed": failed, "n": len(results), "n_trace_rows": len(rows)}

def main(argv: list[str] | None = None) -> int:
    """CLI: publish one or more traces to the relay behind the harness door.

        export HARNESS_CODE=...
        python -m scripts.harness.ingest --trace runs/qwen.jsonl --relay https://relay.example
    """
    import argparse
    import os
    import sys

    ap = argparse.ArgumentParser(description="Publish harness traces to the relay (harness door only).")
    ap.add_argument("--trace", nargs="+", required=True, help="one or more trace jsonl files")
    ap.add_argument("--relay", default=os.environ.get("RELAY_URL", ""), help="relay base URL, or set RELAY_URL")
    ap.add_argument("--code", default=os.environ.get("HARNESS_CODE", ""), help="harness secret, or set HARNESS_CODE")
    ap.add_argument("--batch", type=int, default=200)
    ap.add_argument("--dry-run", action="store_true", help="print the summary and one payload, send nothing")
    args = ap.parse_args(argv)

    rows: list[dict] = []
    for t in args.trace:
        rows.extend(read_trace(t))
    if not rows:
        print("no rows in " + ", ".join(args.trace), file=sys.stderr)
        return 1

    s = summarise(rows)
    print("run_id        : " + str(s.get("run_id")))
    print("model         : " + str(s.get("model")))
    print("items         : " + str(s.get("n_items")) + "  (from " + str(s.get("n_samples")) + " samples)")
    print("accuracy      : " + format(s.get("accuracy", 0.0), ".3f")
          + "   over items, repeats by majority — the same figure analyze.py reports")
    if s.get("unstable_rate"):
        print("unstable      : " + format(s.get("unstable_rate", 0.0), ".3f"))
    print("abstention    : " + format(s.get("abstention_rate", 0.0), ".3f"))
    print("parse fail    : " + format(s.get("parse_fail_rate", 0.0), ".3f"))
    print("errors        : " + format(s.get("error_rate", 0.0), ".3f"))
    print("groundtruth   : " + str(s.get("groundtruth_hash"))[:16] + "...")
    print("recipe hash   : " + str(s.get("recipe_hash"))[:16] + "...")

    if args.dry_run:
        print()
        print("DRY RUN — one payload of " + str(min(args.batch, len(rows))) + " results, nothing sent:")
        print(json.dumps({"run": s, "results": rows[:1]}, indent=1, sort_keys=True)[:700])
        return 0

    if not args.relay or not args.code:
        print()
        print("refusing to send: set --relay and --code, or RELAY_URL and HARNESS_CODE.", file=sys.stderr)
        print("the harness door fails closed, so an unset secret cannot write.", file=sys.stderr)
        return 2

    res = post(rows, args.relay, args.code, args.batch)
    print()
    print("sent " + str(res["sent"]) + " of " + str(res["n"]) + " results ("
          + str(res["failed"]) + " failed)")
    if res["n_trace_rows"] != res["n"]:
        print("     " + str(res["n_trace_rows"]) + " trace rows reduced to " + str(res["n"])
              + " items, repeats by majority — the same rule analyze.py applies, so the")
        print("     site and the paper cannot disagree.")
    return 0 if res["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
