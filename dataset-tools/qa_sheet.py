#!/usr/bin/env python3
"""
qa_sheet.py — Gate P-500 evidence: side-by-side original (pre-optimization
revision, pulled live from Drive) vs optimized (current live bytes) for a
random sample of in-place-optimized files, plus byte counts.
Output: dataset-tools/runs/pilot-500/qa_sheet.html
"""
import hashlib
import io
import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import netfix  # noqa: E402
netfix.apply()
import drive_io as DIO  # noqa: E402
from googleapiclient.http import MediaIoBaseDownload  # noqa: E402

LEDGER = os.path.join(HERE, "runs", "pilot-500", "results.jsonl")
OUT = os.path.join(HERE, "runs", "pilot-500", "qa_sheet.html")
N = 12


def revision_bytes(fid):
    revs = DIO.with_retry(DIO.service().revisions().list, fileId=fid,
                          fields="revisions(id, modifiedTime)")["revisions"]
    oldest = sorted(revs, key=lambda r: r.get("modifiedTime", ""))[0]
    buf = io.BytesIO()
    dl = MediaIoBaseDownload(buf, DIO.service().revisions().get_media(
        fileId=fid, revisionId=oldest["id"]))
    done = False
    while not done:
        _, done = dl.next_chunk(num_retries=3)
    return buf.getvalue()


def live_bytes(fid):
    return DIO.download(fid)


def main():
    recs = [json.loads(l) for l in open(LEDGER, encoding="utf-8") if l.strip()]
    inplace_ok = [r for r in recs
                  if r.get("run_mode") == "apply" and r["status"] == "ok"
                  and r.get("mode") == "inplace"]
    random.seed(7)
    sample = random.sample(inplace_ok, min(N, len(inplace_ok)))
    print(f"QA sample: {len(sample)} of {len(inplace_ok)} in-place files")

    rows = []
    for r in sample:
        fid = r["id"]
        orig = revision_bytes(fid)
        opt = live_bytes(fid)
        live_md5 = hashlib.md5(opt).hexdigest()
        md5_ok = live_md5 == r["post"]["md5"]
        rows.append(f"""
<tr><td>{r['name'][:34]}<br><small>pre {r['pre']['size']:,} B → post {r['post']['size']:,} B
 ({r['post']['size']/max(1,r['pre']['size']):.1%}) · {r['post']['w']}×{r['post']['h']} ·
 live-md5 {'✓' if md5_ok else '✗'}</small></td>
<td><img src="data:image/jpeg;base64,__ORIG__"></td>
<td><img src="data:image/webp;base64,__OPT__"></td></tr>"""
            .replace("__ORIG__", io.BytesIO(orig).getvalue().hex() and
                     __import__("base64").b64encode(orig).decode())
            .replace("__OPT__", __import__("base64").b64encode(opt).decode()))
        print(f"  {r['name'][:38]:40s} {r['pre']['size']:>9,} -> {r['post']['size']:>8,} B")

    css = ("<style>body{background:#111;color:#ddd;font:13px/1.5 sans-serif}"
           "table{border-collapse:collapse}td{border:1px solid #333;padding:8px;"
           "vertical-align:top}img{max-width:380px;max-height:280px;display:block}"
           "h1{font-size:18px}small{color:#888}</style>")
    html = ("<!doctype html><meta charset=utf-8><title>QA sheet — pilot-500</title>"
            + css +
            f"<h1>Pilot-500 QA — {len(sample)} random in-place pairs: "
            "original (from revision) vs optimized (live)</h1>"
            "<table>" + "".join(rows) + "</table>")
    open(OUT, "w", encoding="utf-8").write(html)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
