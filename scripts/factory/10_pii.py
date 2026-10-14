#!/usr/bin/env python3
"""
STAGE 10 — PII: faces and plates reviewed, GPS stripped.

THE GPS HALF IS MEASURED, AND IT IS A GUARD RATHER THAN A HOPE
--------------------------------------------------------------
Round 41 decoded 40 images from real bytes, including the 20 most likely to retain EXIF
(camera-named AND longer than 2000 px). Zero carried GPS: the 5 Sep 2026 re-encode stripped
the metadata blocks.

So the requirement is currently satisfied — as a SIDE EFFECT of the storage pipeline, which
nobody chose for that reason and nothing is watching. The originals survive as Drive
revisions, and recovering the lost resolution diversity (LIMITATIONS.md L2) would bring the
GPS back.

`--gps-check` therefore EXITS NON-ZERO the moment a coordinate reappears. It targets the
images most likely to carry one, because a uniform sample would miss a rare carrier — and
"we sampled 25 random images" is not a finding about the ones that had EXIF.

THE OTHER HALF IS HUMAN
-----------------------
Whether a face or a plate needs action is a judgement. This records the judgement and
refuses to release what has not had one.

Usage:
    python scripts/factory/10_pii.py --gps-check 20
    python scripts/factory/10_pii.py --coverage
    python scripts/factory/10_pii.py --mark <file_id> --state reviewed_clear --findings "no faces, no plates"
    python scripts/factory/10_pii.py --mark <file_id> --state flagged --findings "legible plate, left"
"""
from __future__ import annotations

import argparse
import datetime as _dt
import io
import io
import json
import os
import pathlib
import random
import re
import struct
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scripts.harness.pii import check_items, load_pii, state_for, STATES  # noqa: E402

DEFAULT_LEDGER = ROOT / "data" / "factory" / "pii.jsonl"
DEFAULT_PROV = ROOT / "data" / "factory" / "provenance.jsonl"
GPS_IFD = 0x8825
CAMERA = re.compile(r"^(IMG|DSC|PANO|SCN|DCIM|P\d)", re.I)


def build_gps_jpeg(lat=(40, 26, 0)) -> bytes:
    """A JPEG that genuinely carries a GPS IFD, for testing the detector.

    PIL cannot write nested GPS IFDs (it raises on the tuple form), so the EXIF block is
    assembled by hand: IFD0 pointing at a GPS IFD pointing at three rationals.
    """
    from PIL import Image
    gps_off, rat_off = 26, 56
    gps = struct.pack("<H", 2)
    gps += struct.pack("<HHII", 1, 2, 2, 0x0000004E)   # GPSLatitudeRef = "N\0"
    gps += struct.pack("<HHII", 2, 5, 3, rat_off)      # GPSLatitude -> 3 rationals
    gps += struct.pack("<I", 0)
    rats = b"".join(struct.pack("<II", v, 1) for v in lat)
    ifd0 = struct.pack("<H", 1) + struct.pack("<HHII", GPS_IFD, 4, 1, gps_off) + struct.pack("<I", 0)
    tiff = b"II" + struct.pack("<H", 42) + struct.pack("<I", 8) + ifd0 + gps + rats
    blob = b"Exif\x00\x00" + tiff

    plain = io.BytesIO()
    Image.new("RGB", (8, 8), (120, 120, 120)).save(plain, format="JPEG")
    body = plain.getvalue()
    app1 = b"\xff\xe1" + struct.pack(">H", len(blob) + 2) + blob
    return body[:2] + app1 + body[2:]


def detector_works() -> bool:
    """Can this script actually SEE a GPS tag? Checked before every scan.

    THE POINT OF THE ROUND. This guard has only ever reported zero, and **zero is not evidence
    when the detector has never been shown to detect anything** — the same shape as the two
    forbidden-phrase regexes that could not match, and the status regex missing re.M. A broken
    detector and a clean corpus produce identical output.

    So a JPEG carrying a real GPS IFD is built in memory and pushed through the identical read
    path. If that does not come back with tags, the scan refuses to report a result.
    """
    try:
        from PIL import Image
        with Image.open(io.BytesIO(build_gps_jpeg())) as im:
            ex = im.getexif()
            return bool(ex.get_ifd(GPS_IFD)) if ex else False
    except Exception:
        return False


def gps_check(prov: pathlib.Path, n: int, seed: int) -> int:
    """Decode the images MOST LIKELY to carry GPS. Non-zero exit if any does."""
    try:
        from PIL import Image, ExifTags
    except Exception:
        print("Pillow is required for --gps-check", file=sys.stderr)
        return 2
    if not detector_works():
        print("REFUSING TO SCAN: this script cannot detect a GPS tag it was just shown.",
              file=sys.stderr)
        print("  A broken detector and a clean corpus produce the same output — zero — so a", file=sys.stderr)
        print("  zero from this check would mean nothing. Fix the read path first.", file=sys.stderr)
        return 2

    rows = []
    for line in prov.read_text(encoding="utf-8-sig").splitlines():
        if not line.strip():
            continue
        o = json.loads(line)
        if "_schema" in o or o.get("r") != 1 or not o.get("i"):
            continue
        rows.append(o)
    if not rows:
        print("no releasable rows in " + str(prov), file=sys.stderr)
        return 2

    # TARGETED, not uniform. EXIF survives re-encodes least often, so the carriers are
    # camera-named files that were NOT shrunk.
    targets = [r for r in rows
               if CAMERA.match(str(r.get("n") or ""))
               and r.get("w") and max(r["w"], r.get("h") or 0) > 2000]
    if len(targets) < n:
        big = [r for r in rows if r.get("w") and max(r["w"], r.get("h") or 0) > 2000]
        seen = {r["i"] for r in targets}
        targets += [r for r in big if r["i"] not in seen]
    random.Random(seed).shuffle(targets)
    sample = targets[:n]

    print("targeting %d of %d images (camera-named and long edge > 2000: the likely carriers)"
          % (len(sample), len(rows)))
    print()
    with_gps, with_exif, decoded, failed = 0, 0, 0, 0
    for r in sample:
        url = "https://lh3.googleusercontent.com/d/" + r["i"] + "=s0"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "pii-audit/1.0"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = resp.read()
            with Image.open(io.BytesIO(data)) as im:
                ex = im.getexif()
                gps = ex.get_ifd(GPS_IFD) if ex else {}
                tags = len(ex) if ex else 0
        except Exception as e:
            failed += 1
            print("  %-14s FAILED %s" % (r["i"][:14], type(e).__name__))
            continue
        decoded += 1
        if tags:
            with_exif += 1
        if gps:
            with_gps += 1
            names = ",".join(sorted(ExifTags.GPSTAGS.get(k, str(k)) for k in gps))
            print("  %-14s %-24s GPS FOUND: %s" % (r["i"][:14], str(r.get("n"))[:24], names))
    print()
    print("decoded %d   carrying exif %d   carrying GPS %d   failed %d"
          % (decoded, with_exif, with_gps, failed))
    if with_gps:
        print()
        print("FAIL: coordinates are present in an image the harness would fetch with =s0.")
        print("      Strip before any release, and re-run this after any change that")
        print("      re-fetches originals from Drive revisions.")
        return 1
    if decoded == 0:
        print()
        print("NOTHING WAS CHECKED. No network, or every fetch failed. This is not a pass:")
        print("the absence of GPS has NOT been demonstrated on this run.")
        return 2
    print()
    print("PASS: no GPS in the sample most likely to carry it. The re-encode stripped the")
    print("      metadata blocks; this check is what keeps that true if originals return.")
    return 0


def coverage(ledger: pathlib.Path, prov: pathlib.Path) -> int:
    led = load_pii(ledger)
    rows = []
    for line in prov.read_text(encoding="utf-8-sig").splitlines():
        if not line.strip():
            continue
        o = json.loads(line)
        if "_schema" in o or o.get("r") != 1 or not o.get("i"):
            continue
        rows.append(o)
    if not rows:
        print("no releasable rows in " + str(prov), file=sys.stderr)
        return 2
    r = check_items([x["i"] for x in rows], led)
    print("releasable images : %d" % r["n"])
    print("  reviewed clear  : %d" % r["clear"])
    print("  flagged         : %d" % r["flagged"])
    print("  UNREVIEWED      : %d  <- not releasable" % r["unreviewed"])
    print()
    # A release needs roughly three thousand images, not forty-five thousand. The gate
    # checks the release subset, so that is the number that decides whether a release is
    # possible. Quoting the corpus made the task look impossible when it is merely large.
    print("A release of ~3,000 items needs ~3,000 reviews, not all %d." % r["n"])
    print("And the tagger can target them:  python scripts/factory/10_pii.py --queue 3000")
    print("A person still has to look. The GPS half is a script; faces and plates are not.")
    if r["flagged"]:
        print()
        print("flagged images (excluded from any release):")
        for fid, findings in r["flagged_examples"]:
            print("  %-14s %s" % (fid[:14], findings[:60]))
    return 0


# ---------------------------------------------------------------------------
# THE REVIEW QUEUE
#
# WHY THIS EXISTS
# ---------------
# "45,330 images unreviewed" is true and useless: nobody reviews 45,330 images, so the
# number produced no plan. Two facts make it tractable.
#
# 1. Only the images IN A RELEASE need review, not the whole corpus. The gate already
#    checks the release subset; the coverage report was quoting the corpus.
# 2. The tagger (stage 04) already extracts `people` and `text_present` for every image.
#    Those are exactly the PII signals: faces and licence plates. So the review can be
#    TARGETED at the images that plausibly contain them, and the rest spot-checked.
#
# This is the pipeline finally being a pipeline — stage 04's output making stage 10's human
# work small enough to actually do.
# ---------------------------------------------------------------------------

def _load_tags(path: pathlib.Path) -> dict:
    if not path.exists():
        return {}
    out = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        if not line.strip():
            continue
        try:
            r = json.loads(line)
        except Exception:
            continue
        if r.get("file_id"):
            out[str(r["file_id"])] = r
    return out


def risk_tier(tag: dict | None) -> str:
    """Which review tier an image falls in. `people` and `text` are the risk signals."""
    if not tag or tag.get("unparsed"):
        # UNTAGGED IS NOT SAFE, it is UNKNOWN. An image nobody has looked at has not been
        # shown to lack faces, so it queues ahead of one the tagger cleared.
        return "untagged"
    people = str(tag.get("people") or "").strip().lower()
    if people and people != "none":
        return "people"
    if tag.get("text_present") is True:
        return "text"
    return "clear"


TIER_ORDER = {"people": 0, "text": 1, "untagged": 2, "clear": 3}
TIER_NOTE = {
    "people": "the tagger saw people — faces to check",
    "text": "the tagger saw legible text — plates, signs, addresses",
    "untagged": "no tag record: nobody has looked, so nothing is ruled out",
    "clear": "the tagger saw no people and no text — spot-check",
}


def build_queue(prov: pathlib.Path, ledger: dict, tags: dict, limit: int) -> list[dict]:
    rows = []
    for line in prov.read_text(encoding="utf-8-sig").splitlines():
        if not line.strip():
            continue
        o = json.loads(line)
        if "_schema" in o or o.get("r") != 1 or not o.get("i"):
            continue
        fid = str(o["i"])
        if state_for(fid, ledger)[0] != "unreviewed":
            continue
        t = tags.get(fid)
        rows.append({
            "file_id": fid,
            "name": str(o.get("n") or ""),
            "owner": str(o.get("o") or ""),
            "w": o.get("w"), "h": o.get("h"),
            "tier": risk_tier(t),
            "objects": (t or {}).get("objects") or [],
        })
    rows.sort(key=lambda r: (TIER_ORDER[r["tier"]], str(r["name"])))
    return rows[:limit] if limit else rows


def write_sheet(queue: list[dict], out: pathlib.Path) -> None:
    """A contact sheet a person can actually work through, that exports the ledger.

    Client-side and dependency-free: each image gets a clear/flagged choice and a findings
    box, and the page downloads pii.jsonl in the exact shape `--mark` writes.
    """
    counts: dict[str, int] = {}
    for r in queue:
        counts[r["tier"]] = counts.get(r["tier"], 0) + 1

    cards = []
    for r in queue:
        dims = ("%sx%s" % (r.get("w"), r.get("h"))) if r.get("w") else "?"
        objs = ", ".join(r["objects"][:4])
        cards.append(
            '<figure class="card" data-id="' + r["file_id"] + '">'
            '<img loading="lazy" src="https://lh3.googleusercontent.com/d/' + r["file_id"] + '=w800" alt="">'
            '<figcaption>'
            '<code>' + r["file_id"][:14] + '</code>'
            '<span class="meta">' + dims + " · " + r["owner"][:18] + '</span>'
            '<span class="tier t-' + r["tier"] + '">' + r["tier"] + '</span>'
            + ('<span class="objs">' + objs + '</span>' if objs else '')
            + '<div class="pick">'
            '<label><input type="radio" name="s-' + r["file_id"] + '" value="reviewed_clear"> clear</label>'
            '<label><input type="radio" name="s-' + r["file_id"] + '" value="flagged"> flagged</label>'
            '</div>'
            '<input class="find" placeholder="findings: what did you look for?">'
            '</figcaption></figure>'
        )

    legend = "".join(
        '<li><b>' + t + '</b> (' + str(counts.get(t, 0)) + ') — ' + TIER_NOTE[t] + '</li>'
        for t in ["people", "text", "untagged", "clear"] if counts.get(t)
    )

    html = SHEET_TEMPLATE
    html = html.replace("__COUNT__", str(len(queue)))
    html = html.replace("__LEGEND__", legend)
    html = html.replace("__CARDS__", "".join(cards))
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")


SHEET_TEMPLATE = """<!doctype html>
<meta charset="utf-8">
<title>PII review queue</title>
<style>
 body{background:#0a0a0a;color:#ededed;font:14px/1.5 ui-sans-serif,system-ui,sans-serif;margin:0;padding:24px}
 h1{font-size:20px;margin:0 0 4px}
 p.sub{color:#a1a1a1;font-size:12px;margin:0 0 16px}
 ul{color:#a1a1a1;font-size:12px;margin:0 0 20px;padding-left:18px}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
 .card{margin:0;background:#111;border:1px solid #262626;border-radius:8px;overflow:hidden}
 .card img{display:block;width:100%;height:170px;object-fit:cover;background:#050505}
 figcaption{padding:8px;font:12px ui-monospace,monospace;color:#a1a1a1;display:flex;flex-direction:column;gap:4px}
 code{color:#ededed}
 .meta{color:#666}
 .tier{align-self:flex-start;padding:1px 6px;border-radius:99px;border:1px solid #333}
 .t-people{color:#ff6b6b;border-color:#ff6b6b55}
 .t-text{color:#f59e0b;border-color:#f59e0b55}
 .t-untagged{color:#a1a1a1}
 .t-clear{color:#0cce6b;border-color:#0cce6b55}
 .objs{color:#555}
 .pick{display:flex;gap:10px;margin-top:2px}
 .pick label{display:flex;gap:4px;align-items:center;cursor:pointer;color:#a1a1a1}
 .find{background:#050505;border:1px solid #262626;border-radius:5px;color:#ededed;padding:4px 6px;font:11px ui-monospace,monospace;width:100%;box-sizing:border-box}
 .find::placeholder{color:#444}
 .bar{position:sticky;top:0;background:#0a0a0aee;padding:10px 0;border-bottom:1px solid #262626;margin-bottom:16px;display:flex;gap:12px;align-items:center;backdrop-filter:blur(4px)}
 button{background:#fff;color:#000;border:0;border-radius:6px;padding:7px 12px;font:12px ui-monospace,monospace;font-weight:600;cursor:pointer}
 #done{color:#0cce6b;font:12px ui-monospace,monospace}
</style>
<div class="bar">
  <button id="dl">download pii.jsonl</button>
  <span id="done">0 of __COUNT__ marked</span>
</div>
<h1>PII review — __COUNT__ images</h1>
<p class="sub">Faces and plates. The GPS half is a script; this half is a person.</p>
<ul>__LEGEND__</ul>
<p class="sub">A review with no findings is refused when it is loaded, so every marked image
needs a note — even if the note is "no faces, no plates".</p>
<div class="grid">__CARDS__</div>
<script>
var cards = [].slice.call(document.querySelectorAll('.card'));
function marked() {
  return cards.map(function (c) {
    var id = c.dataset.id;
    var r = c.querySelector('input[type=radio]:checked');
    var f = c.querySelector('.find');
    return r ? { file_id: id, state: r.value, findings: (f.value || '').trim() } : null;
  }).filter(Boolean);
}
function refresh() {
  document.getElementById('done').textContent = marked().length + ' of ' + cards.length + ' marked';
}
document.addEventListener('change', refresh);
document.addEventListener('input', refresh);
document.getElementById('dl').onclick = function () {
  var rows = marked();
  var missing = rows.filter(function (r) { return !r.findings; });
  if (missing.length) {
    alert(missing.length + ' marked image(s) have no findings. A review with no findings is '
      + 'refused when loaded — write what you looked for, even if it is "no faces, no plates".');
    return;
  }
  if (!rows.length) { alert('nothing marked yet'); return; }
  var blob = new Blob([rows.map(function (r) { return JSON.stringify(r); }).join('\n') + '\n'],
                      { type: 'application/x-ndjson' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'pii.jsonl';
  a.click();
};
refresh();
</script>
"""


def main() -> int:
    ap = argparse.ArgumentParser(description="PII: record reviews, and guard the GPS requirement.")
    ap.add_argument("--ledger", default=str(DEFAULT_LEDGER))
    ap.add_argument("--provenance", default=str(DEFAULT_PROV))
    ap.add_argument("--mark", default="", metavar="FILE_ID")
    ap.add_argument("--state", default="", choices=["", *STATES])
    ap.add_argument("--findings", default="")
    ap.add_argument("--by", default=os.environ.get("USERNAME") or os.environ.get("USER") or "")
    ap.add_argument("--gps-check", type=int, default=0, metavar="N")
    ap.add_argument("--seed", type=int, default=20261013)
    ap.add_argument("--tags", default=str(ROOT / "data" / "factory" / "tagged.jsonl"),
                    help="stage 04 output; its people and text_present fields target the review")
    ap.add_argument("--queue", type=int, default=0, metavar="N",
                    help="emit a review contact sheet of the N highest-risk unreviewed images")
    ap.add_argument("--out", default=str(ROOT / "data" / "factory" / "pii_review.html"))
    ap.add_argument("--coverage", action="store_true")
    args = ap.parse_args()

    if args.gps_check:
        return gps_check(pathlib.Path(args.provenance), args.gps_check, args.seed)

    if args.queue:
        tags = _load_tags(pathlib.Path(args.tags))
        led = load_pii(pathlib.Path(args.ledger))
        q = build_queue(pathlib.Path(args.provenance), led, tags, args.queue)
        if not q:
            print("nothing unreviewed — the queue is empty")
            return 0
        out = pathlib.Path(args.out)
        write_sheet(q, out)
        # THE SHEET'S COUNTS ARE NOT THE CORPUS'S. Reporting only the sheet would let a
        # person believe they had seen everything; reporting only the corpus would hide
        # that a limit was applied. Both, and the difference stated.
        everything = build_queue(pathlib.Path(args.provenance), led, tags, 0)
        total: dict = {}
        for r in everything:
            total[r["tier"]] = total.get(r["tier"], 0) + 1
        sheet: dict = {}
        for r in q:
            sheet[r["tier"]] = sheet.get(r["tier"], 0) + 1

        print("unreviewed in the corpus : %d" % len(everything))
        print("%-9s %8s %8s   %s" % ("tier", "corpus", "sheet", "why it matters"))
        print("-" * 96)
        for t in ["people", "text", "untagged", "clear"]:
            if total.get(t):
                print("%-9s %8d %8d   %s" % (t, total[t], sheet.get(t, 0), TIER_NOTE[t]))
        print()
        need_look = total.get("people", 0) + total.get("text", 0) + total.get("untagged", 0)
        spot = total.get("clear", 0)
        print("NEEDS A CAREFUL LOOK : %d" % need_look)
        print("CLEAR BY THE TAGGER  : %d   <- spot-check a sample, do not hand-review" % spot)
        if len(q) < len(everything):
            print()
            print("this sheet covers %d of %d. Raise --queue to cover more." % (len(q), len(everything)))
        if not tags:
            print()
            print("  no tag file at %s, so nothing could be targeted." % args.tags)
            print("  every image is 'untagged' — the queue is correct but unprioritised.")
            print("  run stage 04 first:  python scripts/factory/04_tag_ground.py")
        print()
        print("wrote " + str(out) + " — open it, mark images, download pii.jsonl,")
        print("then:  python scripts/factory/10_pii.py --coverage")
        return 0

    if args.mark:
        if not args.state:
            print("--mark needs --state reviewed_clear or flagged", file=sys.stderr)
            return 2
        if not args.findings.strip():
            print("refusing to record a review with no findings.", file=sys.stderr)
            print("  'no faces, no plates' is a finding. Silence is not: the next reader has")
            print("  to know what was looked for, not just that someone clicked.", file=sys.stderr)
            return 2
        led = pathlib.Path(args.ledger)
        led.parent.mkdir(parents=True, exist_ok=True)
        rec = {"file_id": args.mark, "state": args.state, "findings": args.findings.strip(),
               "reviewed_by": args.by or "unknown",
               "reviewed_at": _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
        with led.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec, sort_keys=True) + "\n")
        print(args.state.upper() + "  " + args.mark)
        print("  findings: " + rec["findings"])

    if args.coverage or not args.mark:
        return coverage(pathlib.Path(args.ledger), pathlib.Path(args.provenance))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
