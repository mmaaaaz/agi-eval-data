"""Freeze a release from an approved export.  python -m scripts.harness.build_release

A release is the contract between authoring and measurement. After this runs, the
answers in it cannot change without producing a new release id and hash.
"""
from __future__ import annotations
import argparse
import json
import pathlib
import sys

from .consent import check_items, load_consent, load_owners
from .pii import check_items as check_pii
from .pii import load_pii
from .release import build


def read_export(path: pathlib.Path) -> list[dict]:
    rows = []
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line:
            continue
        rows.append(json.loads(line))
    return rows


def eligible(row: dict, require_classified: bool) -> bool:
    if (row.get("status") or "") != "approved":
        return False
    if row.get("deleted_at"):
        return False
    if (row.get("review_status") or "") == "rejected":
        return False
    if require_classified and (not row.get("capability") or not row.get("level")):
        return False
    if row.get("answer") in (None, ""):
        return False
    return True


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Freeze a release from an approved questions export.")
    ap.add_argument("--export", required=True, help="questions.jsonl from GET /api/questions/export.jsonl")
    ap.add_argument("--out", required=True, help="output release directory, e.g. release/v1")
    ap.add_argument("--id", required=True, help="release id, e.g. v1")
    ap.add_argument("--allow-unclassified", action="store_true",
                    help="include items with no capability/level. Off by default: the gate is the point.")
    ap.add_argument("--notes", default="")
    ap.add_argument("--consent", default=str(pathlib.Path(__file__).resolve().parents[2] / "data" / "factory" / "consent.jsonl"),
                    help="the consent ledger. An image with no recorded decision is NOT releasable.")
    ap.add_argument("--provenance", default=str(pathlib.Path(__file__).resolve().parents[2] / "data" / "factory" / "provenance.jsonl"),
                    help="maps each image to its contributor, whose consent may stand for it.")
    ap.add_argument("--pii", default=str(pathlib.Path(__file__).resolve().parents[2] / "data" / "factory" / "pii.jsonl"),
                    help="the PII review ledger. An unreviewed image is NOT releasable.")
    args = ap.parse_args(argv)

    src = pathlib.Path(args.export)
    if not src.exists():
        print("export not found: " + str(src), file=sys.stderr)
        return 2

    rows = read_export(src)
    kept = [r for r in rows if eligible(r, not args.allow_unclassified)]
    dropped = len(rows) - len(kept)
    if not kept:
        print("nothing eligible: " + str(len(rows)) + " rows read, 0 kept. "
              "Check status=approved and that items carry capability and level.", file=sys.stderr)
        return 1

    # ---- THE CONSENT GATE ----------------------------------------------------
    #
    # `release_ok` in the provenance ledger means only "the filename is not someone else's
    # dataset". It is NOT permission to publish, and stage 00 says so in its own output.
    # This is the check that turns that caveat into an actual gate.
    #
    # It FAILS CLOSED. An image with no recorded decision is unknown, and unknown is not
    # releasable — the same rule as the API's two doors, where an unset secret disables
    # the privileged path rather than opening it. A consent ledger whose default is
    # "allowed" would be decoration, and the whole point is that this cannot be forgotten.
    owners = load_owners(args.provenance)
    consent = load_consent(args.consent)
    file_ids = [r.get("file_id") or r.get("image_id") for r in kept]
    check = check_items(file_ids, owners, consent)
    print("consent    : " + str(check["granted"]) + " granted, " + str(check["denied"])
          + " denied, " + str(check["unknown"]) + " unknown, "
          + str(check["unlisted"]) + " not in the provenance ledger")
    if check["denied"] or check["unknown"] or check["unlisted"]:
        print()
        print("REFUSING TO FREEZE: " + str(check["denied"] + check["unknown"] + check["unlisted"])
              + " image(s) have no recorded right to redistribute.")
        if check["unlisted"]:
            print("  " + str(check["unlisted"]) + " are NOT IN THE PROVENANCE LEDGER at all:")
            for fid in check["unlisted_examples"]:
                print("    " + fid)
            print("  that is a data problem, not a consent one: the export and the corpus have")
            print("  drifted apart, so nothing can be said about those images' rights.")
        if check["denied"] or check["unknown"]:
            print("  contributors to resolve: " + str(len(check["blocked_owners"])))
            for o in check["blocked_owners"][:8]:
                print("    " + o)
        print()
        print("  record a decision:  python scripts/factory/09_consent.py \\")
        print("      --grant-contributor \"<name>\" --basis \"<the evidence>\"")
        print("  or read the coverage:  python scripts/factory/09_consent.py --coverage")
        print()
        print("  consent is not a filter to tune. It is seven conversations, and no amount of")
        print("  software makes them unnecessary.")
        return 1

    # ---- THE PII GATE --------------------------------------------------------
    #
    # The other half of what release_ok does not answer. GPS is measured by
    # `10_pii.py --gps-check` and was absent in round 41 — as a side effect of the
    # re-encode, which nobody chose for that reason and nothing watches. Faces and plates
    # are a judgement, and an unreviewed image is not releasable.
    pii = load_pii(args.pii)
    pc = check_pii(file_ids, pii)
    print("pii        : " + str(pc["clear"]) + " reviewed clear, " + str(pc["flagged"])
          + " flagged, " + str(pc["unreviewed"]) + " unreviewed")
    if pc["flagged"] or pc["unreviewed"]:
        print()
        print("REFUSING TO FREEZE: " + str(pc["flagged"] + pc["unreviewed"])
              + " image(s) have not been cleared for faces and plates.")
        for fid, findings in pc["flagged_examples"]:
            print("    FLAGGED   " + fid + "  " + findings)
        for fid in pc["unreviewed_examples"]:
            print("    unreviewed " + fid)
        print()
        print("  record a review:  python scripts/factory/10_pii.py --mark <file_id> \\")
        print("      --state reviewed_clear --findings \"no faces, no plates\"")
        print("  and guard the GPS half:  python scripts/factory/10_pii.py --gps-check 20")
        print()
        print("  a review with no findings is refused. Silence is not a finding: the next")
        print("  reader has to know what was looked for, not just that someone clicked.")
        return 1

    # THE DETERMINATIONS GO INTO THE ARTIFACT, not only into this process's stdout. The release
    # is what gets published and quoted; a claim that lives only in a terminal has no auditor.
    manifest = build(kept, args.out, release_id=args.id, notes=args.notes,
                     consent={"granted": check["granted"], "denied": check["denied"],
                              "unknown": check["unknown"], "n_checked": len(file_ids)},
                     pii={"clear": pc["clear"], "flagged": pc["flagged"],
                          "unreviewed": pc.get("unreviewed", 0), "n_checked": len(file_ids)})
    print("release " + manifest["release_id"] + " frozen in " + args.out)
    print("  items      : " + str(manifest["n_items"]) + "  (dropped " + str(dropped) + " of " + str(len(rows)) + ")")
    print("  images     : " + str(manifest["n_images"]))
    print("  gt hash    : " + manifest["groundtruth_hash"][:16] + "...")
    print("  capability : " + json.dumps(manifest["by_capability"], sort_keys=True))
    print("  consent    : ALL " + str(check["granted"]) + " images have a recorded right to redistribute")
    print("  pii        : ALL " + str(pc["clear"]) + " images have a recorded review, none flagged")
    unpaired = [r for r in kept if str(r.get("capability") or "").startswith("B") and not r.get("pair_id")]
    if unpaired:
        print("  WARNING    : " + str(len(unpaired)) + " bridge item(s) have no pair_id and cannot enter the 2x2 table")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
