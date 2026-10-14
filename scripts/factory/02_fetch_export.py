#!/usr/bin/env python3
"""
FETCH THE CANONICAL EXPORT — the bridge from the live store to the gate and a release.

WHY THIS EXISTS
---------------
`scripts/factory/03_verify.py` reads `data/factory/questions.jsonl`, and NOTHING WAS
PRODUCING IT. The API serves `GET /api/questions/export.jsonl`; the gate reads a local file.
This is the missing arrow between them, and without it the gate can only ever report "no
items found".

Reads are on the OPEN door, so no secret is needed — the answers come from an endpoint that
is meant to be readable. Writing a release is a separate, deliberate act
(`scripts/harness/build_release.py`), and it freezes what this fetched.

Usage:
    RELAY_URL=https://... python scripts/factory/02_fetch_export.py
    python scripts/factory/02_fetch_export.py --relay http://localhost:8787 --out /tmp/q.jsonl
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

DEFAULT_OUT = pathlib.Path("data/factory/questions.jsonl")


def main() -> int:
    ap = argparse.ArgumentParser(description="Download the canonical questions export.")
    ap.add_argument("--relay", default=os.environ.get("RELAY_URL", ""))
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--timeout", type=int, default=120)
    args = ap.parse_args()

    if not args.relay:
        print("refusing to run: set --relay or RELAY_URL.", file=sys.stderr)
        return 2

    url = args.relay.rstrip("/") + "/api/questions/export.jsonl"
    req = urllib.request.Request(url, headers={"User-Agent": "benchmark-export/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=args.timeout) as resp:
            body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        print("export failed: HTTP " + str(e.code) + " " + e.read().decode("utf-8", "replace")[:200], file=sys.stderr)
        return 1
    except urllib.error.URLError as e:
        print("export failed: " + str(e.reason), file=sys.stderr)
        return 1

    lines = [l for l in body.splitlines() if l.strip()]
    if not lines:
        print("the export is empty — refusing to overwrite a good file with nothing.", file=sys.stderr)
        return 1

    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")

    # What the gate is about to see, so a surprise is visible here rather than there.
    status = collections.Counter()
    classified = second = blind = pairing = 0
    for line in lines:
        try:
            r = json.loads(line)
        except Exception:
            continue
        status[str(r.get("status") or "?")] += 1
        if r.get("capability") and r.get("level"):
            classified += 1
        if r.get("annotator_2"):
            second += 1
        if r.get("blind_passed") == 1:
            blind += 1
        if r.get("pair_id"):
            pairing += 1

    n = len(lines)
    print("fetched " + str(n) + " items -> " + str(out))
    print("  by status      : " + json.dumps(dict(sorted(status.items()))))
    print("  classified     : " + str(classified) + "  (" + format(100 * classified / n, ".1f") + "%)")
    print("  paired items   : " + str(pairing))
    print("  second-annotated: " + str(second) + "  (" + format(100 * second / n, ".1f") + "%, gate wants >= 15% of a double-annotated subset)")
    print("  blind-flagged  : " + str(blind) + "  (these measure priors, not vision)")
    print()
    print("next:  python scripts/factory/03_verify.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
