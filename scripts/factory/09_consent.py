#!/usr/bin/env python3
"""
STAGE 09 — CONSENT.

Record who has granted the right to redistribute their photographs, and report how much of
the corpus that covers.

WHAT THIS IS NOT
----------------
It cannot obtain consent. Only a person can do that, and the ledger will not invent it. What
it does is make the answer a RECORD that a release is checked against, so "we think everyone
was fine with it" cannot quietly become "releasable".

The default is `unknown`, and `unknown` is not releasable. A ledger whose default is
"allowed" is decoration.

Usage:
    python scripts/factory/09_consent.py --coverage
    python scripts/factory/09_consent.py --grant-contributor "M Maaz" --basis "written consent, 2026-10-14"
    python scripts/factory/09_consent.py --deny-contributor "someone" --basis "asked; declined"
    python scripts/factory/09_consent.py --grant-image "<file_id>" --basis "their own upload, CC-BY"
    python scripts/factory/09_consent.py --list
"""
from __future__ import annotations

import argparse
import collections
import datetime as _dt
import json
import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scripts.harness.consent import decision_for, load_consent, load_owners  # noqa: E402

DEFAULT_LEDGER = ROOT / "data" / "factory" / "consent.jsonl"
DEFAULT_PROV = ROOT / "data" / "factory" / "provenance.jsonl"


def append(ledger: pathlib.Path, scope: str, key: str, state: str, basis: str, who: str) -> None:
    ledger.parent.mkdir(parents=True, exist_ok=True)
    rec = {
        "scope": scope, "key": key, "state": state, "basis": basis,
        "recorded_by": who or "unknown",
        "recorded_at": _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    with ledger.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec, sort_keys=True) + "\n")
    print(("GRANTED  " if state == "granted" else "DENIED   ") + scope + " '" + key + "'")
    print("  basis: " + basis)
    print("  the LAST record for a key wins, so re-running with a new basis supersedes this.")


def coverage(ledger: pathlib.Path, prov: pathlib.Path) -> int:
    owners = load_owners(prov)
    consent = load_consent(ledger)
    if not owners:
        print("no provenance ledger at " + str(prov), file=sys.stderr)
        print("run first:  python scripts/factory/00_provenance.py", file=sys.stderr)
        return 2
    # newest record wins, so a later decision supersedes an earlier one
    latest: dict = {}
    for line in ledger.read_text(encoding="utf-8-sig").splitlines() if ledger.exists() else []:
        if not line.strip():
            continue
        try:
            r = json.loads(line)
        except Exception:
            continue
        if r.get("scope") in ("contributor", "image") and r.get("key"):
            latest[(r["scope"], r["key"])] = r

    per_owner: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    for fid, owner in owners.items():
        state, _ = decision_for(fid, owners, latest)
        per_owner[owner or "(none)"][state] += 1

    tot = collections.Counter()
    print("%-24s %8s %9s %8s %9s" % ("contributor", "images", "granted", "denied", "unknown"))
    print("-" * 64)
    for owner in sorted(per_owner, key=lambda o: -sum(per_owner[o].values())):
        c = per_owner[owner]
        n = sum(c.values())
        tot.update(c)
        print("%-24s %8d %9d %8d %9d" % (owner[:24], n, c["granted"], c["denied"], c["unknown"]))
    n = sum(tot.values())
    print("-" * 64)
    print("%-24s %8d %9d %8d %9d" % ("TOTAL", n, tot["granted"], tot["denied"], tot["unknown"]))
    print()
    print("release-ready by consent: %d of %d (%.1f%%)" % (tot["granted"], n, 100 * tot["granted"] / max(n, 1)))
    blocking = [o for o in per_owner if per_owner[o]["unknown"] or per_owner[o]["denied"]]
    print("contributors to resolve       : %d" % len(blocking))
    if len(blocking) <= 6:
        for o in sorted(blocking):
            c = per_owner[o]
            print("    %-22s %d unknown, %d denied" % (o[:22], c["unknown"], c["denied"]))
    print()
    print("Consent is a CONVERSATION, not a filter. The count above is the number of people")
    print("to ask, and it is the number that decides whether a release is possible at all.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="The consent ledger: record rights, report coverage.")
    ap.add_argument("--ledger", default=str(DEFAULT_LEDGER))
    ap.add_argument("--provenance", default=str(DEFAULT_PROV))
    ap.add_argument("--grant-contributor", default="", metavar="NAME")
    ap.add_argument("--deny-contributor", default="", metavar="NAME")
    ap.add_argument("--grant-image", default="", metavar="FILE_ID")
    ap.add_argument("--deny-image", default="", metavar="FILE_ID")
    ap.add_argument("--basis", default="", help="WHY. Required for any decision, and it is the evidence.")
    ap.add_argument("--by", default=os.environ.get("USERNAME") or os.environ.get("USER") or "",
                    help="who recorded this decision")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--coverage", action="store_true")
    args = ap.parse_args()

    ledger = pathlib.Path(args.ledger)
    decisions = [
        ("contributor", args.grant_contributor, "granted"),
        ("contributor", args.deny_contributor, "denied"),
        ("image", args.grant_image, "granted"),
        ("image", args.deny_image, "denied"),
    ]
    wanted = [(s, k, st) for s, k, st in decisions if k]

    if wanted:
        if not args.basis.strip():
            print("refusing to record a decision with no basis.", file=sys.stderr)
            print("  the basis IS the evidence. \"they said yes\" is a different claim from a")
            print("  signed form, and the ledger must let a reader tell them apart.", file=sys.stderr)
            return 2
        for scope, key, state in wanted:
            append(ledger, scope, key, state, args.basis.strip(), args.by)

    if args.list:
        if not ledger.exists():
            print("no ledger yet at " + str(ledger))
        else:
            print("%-12s %-24s %-9s %s" % ("scope", "key", "state", "basis"))
            print("-" * 88)
            for line in ledger.read_text(encoding="utf-8-sig").splitlines():
                if not line.strip():
                    continue
                r = json.loads(line)
                print("%-12s %-24s %-9s %s" % (str(r.get("scope"))[:12], str(r.get("key"))[:24],
                                               str(r.get("state")), str(r.get("basis"))[:40]))

    if args.coverage or not wanted:
        return coverage(ledger, pathlib.Path(args.provenance))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
