"""
THE CONSENT LEDGER — the gate that makes "releasable" mean something.

WHY THIS EXISTS
---------------
`release_ok` in the provenance ledger means ONE thing: the filename does not mark the file
as someone else's dataset. Stage 00 says so in its own output, and the number it produces
is an UPPER BOUND. Two gates stay open, and neither is software:

    1. CONSENT   a recorded right to redistribute, per image
    2. PII       faces and plates reviewed; GPS stripped

This module is the machinery for gate 1. It does not obtain consent — only a person can do
that — but it makes consent a RECORD that a release can be checked against, instead of an
assumption everyone forgets to revisit.

IT FAILS CLOSED, DELIBERATELY
-----------------------------
An image with no recorded decision is `unknown`, and `unknown` is NOT releasable. The
same rule as the two doors in the API: an unset secret disables the privileged path rather
than opening it. A consent ledger whose default is "allowed" is decoration.

THE SHAPE
---------
    data/factory/consent.jsonl, one record per line:
      {"scope": "contributor"|"image", "key": "...", "state": "granted"|"denied",
       "basis": "why", "recorded_by": "who", "recorded_at": "when"}

An image-specific record beats a contributor record. `basis` is required and is the
evidence: "they said yes in the group chat" is a different kind of claim from a signed
form, and the ledger should make the difference visible rather than flatten it.
"""
from __future__ import annotations

import json
import pathlib

STATES = ("granted", "denied")


def load_consent(path: str | pathlib.Path | None) -> dict:
    """Read the ledger. A missing file is an EMPTY ledger, which means nothing is allowed."""
    if not path:
        return {}
    p = pathlib.Path(path)
    if not p.exists():
        return {}
    out: dict[tuple[str, str], dict] = {}
    for line in p.read_text(encoding="utf-8-sig").splitlines():
        if not line.strip():
            continue
        try:
            r = json.loads(line)
        except Exception:
            continue
        scope = str(r.get("scope") or "")
        key = str(r.get("key") or "")
        state = str(r.get("state") or "")
        if scope in ("contributor", "image") and key and state in STATES:
            out[(scope, key)] = r
    return out


def load_owners(provenance_path: str | pathlib.Path | None) -> dict:
    """file_id -> contributor, from the provenance ledger."""
    if not provenance_path:
        return {}
    p = pathlib.Path(provenance_path)
    if not p.exists():
        return {}
    out: dict[str, str] = {}
    for line in p.read_text(encoding="utf-8-sig").splitlines():
        if not line.strip():
            continue
        try:
            r = json.loads(line)
        except Exception:
            continue
        if "_schema" in r:
            continue
        fid, owner = r.get("i"), r.get("o")
        if fid:
            out[str(fid)] = str(owner or "")
    return out


def decision_for(file_id: str, owners: dict, consent: dict) -> tuple[str, str]:
    """(state, basis) for one image. Defaults to `unknown`, which is not releasable."""
    rec = consent.get(("image", file_id))
    if rec:
        return str(rec["state"]), str(rec.get("basis") or "")
    owner = owners.get(file_id)
    if owner:
        rec = consent.get(("contributor", owner))
        if rec:
            return str(rec["state"]), str(rec.get("basis") or "")
    return "unknown", ""


def check_items(file_ids, owners: dict, consent: dict) -> dict:
    """Split a set of images by consent state, with the reasons.

    Returns counts and the blocking keys, so a caller can either refuse or report
    coverage without re-deriving anything.
    """
    granted, denied, unknown = [], [], []
    # An image that is NOT IN THE PROVENANCE LEDGER is a different problem from a
    # contributor who has not been asked: the first means the export and the corpus have
    # drifted apart, the second needs a conversation. Reporting them as one "?" hides a
    # real defect behind a social task, so they are counted separately.
    unlisted = []
    for fid in file_ids:
        s = str(fid)
        # An EXPLICIT per-image decision is the strongest evidence there is, so it is
        # honoured even when the provenance ledger has never heard of the file. Checking
        # "is it in the corpus ledger" first would discard a signed permission because of
        # a bookkeeping gap, which is the wrong way round.
        own = consent.get(("image", s))
        if own is None and s not in owners:
            unlisted.append(s)
            continue
        state, basis = decision_for(s, owners, consent)
        owner = owners.get(s, "")
        if state == "granted":
            granted.append(s)
        elif state == "denied":
            denied.append((s, owner, basis))
        else:
            unknown.append((s, owner))
    n = len(file_ids) if isinstance(file_ids, (list, set)) else len(list(file_ids))
    return {
        "n": n,
        "granted": len(granted),
        "denied": len(denied),
        "unknown": len(unknown),
        "unlisted": len(unlisted),
        # denied holds (file_id, owner, basis); unknown holds (file_id, owner).
        "blocked_owners": sorted({o for _f, o, _b in denied} | {o for _f, o in unknown if o}),
        "denied_examples": denied[:5],
        "unknown_examples": unknown[:5],
        "unlisted_examples": unlisted[:5],
    }
