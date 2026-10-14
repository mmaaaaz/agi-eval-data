#!/usr/bin/env python3
"""
Build a local, zero-dependency image review queue for the authoring team.

Reads data/factory/candidates.json and emits Paper/IMAGE-QUEUE.html.

WHY THIS EXISTS
---------------
The corpus lives in Google Drive and the scanner holds metadata.readonly scope,
so nothing can be downloaded. But Drive link-sharing plus the public CDN means
any browser can display an image directly:

    https://lh3.googleusercontent.com/d/<FILE_ID>=w800

That is the same URL the existing site already uses. So annotation needs no new
infrastructure at all -- open a page, look, write down the question.

ONE PREREQUISITE
-----------------
Files must be link-shared with "anyone: reader" or the CDN returns nothing.
scripts/share_sync.py does this and runs in CI every 30 minutes. If images come
up blank, run it manually:

    python scripts/share_sync.py --limit 4000

Usage:
    python scripts/factory/07_build_queue.py
    python scripts/factory/07_build_queue.py --target 2000 --assign 15
"""
from __future__ import annotations

import argparse
import html
import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FACTORY = ROOT / "data" / "factory"
OUT = ROOT / "Paper" / "IMAGE-QUEUE.html"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", type=int, default=2000, help="images in the queue")
    ap.add_argument("--assign", type=int, default=15, help="annotators, for the per-person split")
    ap.add_argument("--seed", type=int, default=20261006)
    args = ap.parse_args()

    src = FACTORY / "candidates.json"
    if not src.exists():
        raise SystemExit(f"missing {src} -- run 01_select_images.py first")

    data = json.loads(src.read_text(encoding="utf-8-sig"))
    pool = data["images"]

    rng = random.Random(args.seed)
    shuffled = list(pool)
    rng.shuffle(shuffled)
    chosen = shuffled[: args.target]
    for i, im in enumerate(chosen):
        im["q"] = i

    per_person = (len(chosen) + args.assign - 1) // args.assign
    doc = build_html(chosen, per_person, args)
    OUT.write_text(doc, encoding="utf-8")
    print(f"images in queue : {len(chosen)}")
    print(f"annotators      : {args.assign}")
    print(f"per person      : ~{per_person} images x 5 questions = ~{per_person*5} questions")
    print(f"written         : {OUT}")


def build_html(images, per_person, args) -> str:
    owners = sorted({im["owner"] for im in images})
    # Build a real JSON ARRAY for JS. Emitting a comma-joined string would make
    # IMGS a str, and IMGS.filter() would throw -- so serialise the list.
    records = [
        {"id": im["file_id"], "i": im["q"], "o": im["owner"],
         "c": im["camera"] or "-", "b": im["band"], "mp": im["mp"]}
        for im in images
    ]
    rows_js = json.dumps(records, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")

    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Image review queue &mdash; real-world benchmark</title>
<style>
:root{{--bg:#0a0a0b;--p:#141416;--l:#2a2a30;--f:#e9e9ec;--m:#9a9aa4;--d:#6b6b76;
--acc:#38bdf8;--warn:#f59e0b}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--bg);color:var(--f);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}}
header{{padding:13px 18px;border-bottom:1px solid var(--l);display:flex;gap:16px;align-items:baseline;flex-wrap:wrap;position:sticky;top:0;background:var(--bg);z-index:5}}
h1{{font-size:15px;margin:0;font-weight:650}}
.meta{{font:11px/1.5 ui-monospace,monospace;color:var(--d)}}
.meta b{{color:var(--acc)}}
.bar{{display:flex;gap:6px;align-items:center;margin-left:auto}}
button,select{{background:#1c1c20;color:var(--f);border:1px solid var(--l);border-radius:6px;
padding:6px 11px;font:12px ui-monospace,monospace;cursor:pointer}}
button:hover,select:hover{{border-color:#3a3a42}}
.wrap{{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px;padding:14px}}
.card{{background:var(--p);border:1px solid var(--l);border-radius:9px;overflow:hidden}}
.thumb{{position:relative;aspect-ratio:4/3;background:#0e0e10;display:flex;align-items:center;justify-content:center;overflow:hidden}}
.thumb img{{width:100%;height:100%;object-fit:contain}}
.num{{position:absolute;top:5px;left:5px;background:rgba(0,0,0,.72);border-radius:4px;
padding:2px 6px;font:11px ui-monospace,monospace;color:#fff}}
.blank{{color:var(--warn);font-size:11px;text-align:center;padding:10px;line-height:1.7}}
.info{{padding:7px 9px;font:11px/1.5 ui-monospace,monospace;color:var(--m);border-top:1px solid var(--l);
display:flex;justify-content:space-between;gap:6px;flex-wrap:wrap}}
.owner{{color:var(--acc)}}
footer{{padding:16px 18px;border-top:1px solid var(--l);color:var(--d);font:11px/1.7 ui-monospace,monospace}}
</style></head><body>

<header>
  <h1>Image review queue</h1>
  <span class="meta">{len(images)} images &middot; {args.assign} annotators &middot; ~{per_person} each &times; 5 = <b>~{per_person*5} questions per person</b></span>
  <div class="bar">
    <select id="ow" onchange="flt()">
      <option value="">all contributors</option>
      {"".join(f'<option value="{html.escape(o)}">{html.escape(o)}</option>' for o in owners)}
    </select>
    <button onclick="sh('owner')">by contributor</button>
    <button onclick="sh('camera')">by camera</button>
    <button onclick="sh('natural')">natural order</button>
    <button onclick="window.print()">print</button>
  </div>
</header>

<div class="wrap" id="g"></div>

<footer>
  Shuffled deliberately &mdash; you should <b>not</b> be able to guess the question type from an image's
  resolution or aspect ratio. That is why the corpus is not sorted into strata for authoring.<br>
  <b>Blank images?</b> The files are not link-shared yet. Run
  <code>python scripts/share_sync.py --limit 4000</code>, wait a minute, reload.<br>
  Do not write questions about anything sensitive &mdash; flag it and move on. ANNOTATION-GUIDE.md &sect;1 R7.
</footer>

<script>
const IMGS={rows_js};
const url=(id,w)=>`https://lh3.googleusercontent.com/d/${{id}}=w${{w}}`;

function card(im){{
  return `<div class="card" data-owner="${{im.o}}">
    <div class="thumb">
      <img loading="lazy" src="${{url(im.id,800)}}"
           onerror="this.style.display='none';this.parentNode.innerHTML='<div class=\\'blank\\'>not link-shared<br><small>run share_sync.py</small></div>'">
      <span class="num">#${{im.i}}</span>
    </div>
    <div class="info">
      <span class="owner">${{im.o}}</span>
      <span>${{im.mp}}MP &middot; ${{im.b}}</span>
      <span>${{im.c}}</span>
    </div></div>`;
}}

function render(){{
  const own=document.getElementById('ow').value;
  document.getElementById('g').innerHTML=
    IMGS.filter(x=>!own||x.o===own).map(card).join('');
}}

function sh(mode){{
  if(mode==='owner') IMGS.sort((a,b)=>(a.o+a.i).localeCompare(b.o+b.i));
  else if(mode==='camera') IMGS.sort((a,b)=>(a.c+a.i).localeCompare(b.c+b.i));
  else IMGS.sort((a,b)=>a.i-b.i);
  render();
}}
function flt(){{render();}}
render();
</script>
</body></html>"""


if __name__ == "__main__":
    raise SystemExit(main())