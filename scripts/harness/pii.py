"""
THE PII LEDGER — the second gate that `release_ok` does not answer.

WHAT `release_ok` MEANS, AGAIN
-------------------------------
Only that the filename is not someone else's dataset. Stage 00 says so. Two gates stay
open, and consent is now one of them (scripts/harness/consent.py). This is the other:
**faces and plates reviewed, GPS stripped.**

WHAT WAS MEASURED, ROUND 41
---------------------------
40 images decoded from real bytes, including the 20 MOST LIKELY to retain EXIF (camera-named
AND longer than 2000 px on the long edge):

    carrying any EXIF : 20 of 20, but every one had exactly 2 tags
    carrying GPS      : 0 of 40

The 5 Sep 2026 re-encode stripped the metadata blocks. So "GPS stripped" is TRUE for what
the harness fetches today, and the requirement is currently satisfied as a side effect of
the storage pipeline rather than by anyone checking.

**That is exactly why this needs to be a standing check rather than a happy fact.** The
originals survive as Drive revisions, and LIMITATIONS.md L2 proposes recovering the lost
resolution diversity by re-fetching them. If that ever happens, the GPS comes back, and
nothing would have noticed.

FAILS CLOSED
------------
Per-image review state, default `unreviewed`, and `unreviewed` is not releasable. Same rule
as consent and as the API's two doors.
"""
from __future__ import annotations

import json
import pathlib

# reviewed_clear: a person looked and found nothing that needs action.
# flagged:        a person looked and found something (a face, a plate, an address).
# unreviewed:     the default, and NOT releasable.
STATES = ("reviewed_clear", "flagged")


def load_pii(path: str | pathlib.Path | None) -> dict:
    """file_id -> record. A missing file is an EMPTY ledger: nothing is reviewed."""
    if not path:
        return {}
    p = pathlib.Path(path)
    if not p.exists():
        return {}
    out: dict[str, dict] = {}
    for line in p.read_text(encoding="utf-8-sig").splitlines():
        if not line.strip():
            continue
        try:
            r = json.loads(line)
        except Exception:
            continue
        fid = str(r.get("file_id") or "")
        if fid and str(r.get("state") or "") in STATES:
            out[fid] = r  # the LAST record for an image wins, as with consent
    return out


def state_for(file_id: str, ledger: dict) -> tuple[str, str]:
    """(state, findings). Defaults to `unreviewed`, which is not releasable."""
    rec = ledger.get(str(file_id))
    if not rec:
        return "unreviewed", ""
    return str(rec["state"]), str(rec.get("findings") or "")


def check_items(file_ids, ledger: dict) -> dict:
    clear: list[str] = []
    flagged: list[tuple[str, str]] = []
    unreviewed: list[str] = []
    for fid in file_ids:
        s = str(fid)
        state, findings = state_for(s, ledger)
        if state == "reviewed_clear":
            clear.append(s)
        elif state == "flagged":
            flagged.append((s, findings))
        else:
            unreviewed.append(s)
    n = len(file_ids) if isinstance(file_ids, (list, set)) else len(list(file_ids))
    return {
        "n": n,
        "clear": len(clear),
        "flagged": len(flagged),
        "unreviewed": len(unreviewed),
        "flagged_examples": flagged[:5],
        "unreviewed_examples": unreviewed[:5],
    }
