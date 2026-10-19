#!/usr/bin/env python
"""Render a generation batch as one offline HTML contact sheet (read-only preview).

    python -m scripts.harness.preview_candidates --batch full-50k
    python -m scripts.harness.preview_candidates --batch pilot-40-api --out scratch/pilot.html

This is a REVIEW AID, not a site page: it renders the batch's candidates.jsonl as
image cards with every candidate, its choices, the answer, the grounding, the
taxonomy tags and any validation flags, so a human can see what the model drafted
before the review room exists. Thumbnails load from the corpus CDN.
"""

from __future__ import annotations

import argparse
import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUNS = ROOT / "runs" / "generation"
THUMB = "https://lh3.googleusercontent.com/d/{fid}=w640"


def esc(s: object) -> str:
    return html.escape(str(s), quote=True)


def render(batch: str, out: Path) -> tuple[int, int, int]:
    rows = []
    for line in (RUNS / batch / "candidates.jsonl").read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    ok = [r for r in rows if r.get("parse_ok")]

    cards = []
    for r in ok:
        fid = r["file_id"]
        cands = []
        for i, c in enumerate(r.get("candidates", []), 1):
            flags = c.get("_errors") or []
            fchips = "".join(f'<span class="flag">{esc(f)}</span>' for f in flags)
            choices = "".join(
                f'<li class="{"right" if ch == c.get("answer") else ""}">{esc(ch)}</li>'
                for ch in (c.get("choices") or [])
            )
            cands.append(
                f'<div class="cand"><div class="q"><b>{i}.</b> {esc(c.get("question", ""))}</div>'
                f'<ol class="choices">{choices}</ol>'
                f'<div class="answer">Answer: <b>{esc(c.get("answer", ""))}</b></div>'
                f'<div class="why">{esc(c.get("grounding", ""))}</div>'
                f'<div class="tags"><span>{esc(c.get("capability", ""))}</span>'
                f'<span>{esc(c.get("level", ""))}</span><span>{esc(c.get("domain", ""))}</span>'
                f'<span>{esc(c.get("difficulty", ""))}</span></div>{fchips}</div>'
            )
        cards.append(
            f'<div class="img" id="img-{esc(fid)}">'
            f'<div class="side"><img loading="lazy" src="{THUMB.format(fid=esc(fid))}" alt="">'
            f'<div class="name">{esc(r.get("name", ""))}</div>'
            f'<div class="meta">{r.get("width") or "?"}x{r.get("height") or "?"} · '
            f'{len(cands)} candidates</div></div>'
            f'<div class="cands">{"".join(cands)}</div></div>'
        )

    total_c = sum(len(r.get("candidates", [])) for r in ok)
    flagged = sum(1 for r in ok for c in r.get("candidates", []) if c.get("_errors"))
    doc = f"""<!doctype html><meta charset="utf-8"><title>Drafts - {esc(batch)}</title>
<style>
:root{{--fg:#1a1a1a;--mut:#666;--line:#e3e3e3;--bg:#fafafa;--ok:#0a7a3d;--bad:#b3261e}}
*{{box-sizing:border-box}}body{{margin:0;padding:24px;background:var(--bg);color:var(--fg);
font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}}
h1{{font-size:20px;margin:0 0 4px}}.sub{{color:var(--mut);margin-bottom:16px}}
.summary{{display:flex;gap:24px;margin:12px 0 24px;flex-wrap:wrap}}
.summary div{{background:#fff;border:1px solid var(--line);border-radius:8px;padding:10px 14px}}
.summary b{{font-size:18px;display:block}}.img{{display:grid;grid-template-columns:280px 1fr;
gap:16px;background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px;margin-bottom:14px}}
.side img{{width:280px;height:auto;border-radius:6px;background:#eee}}.name{{font-size:11px;
color:var(--mut);word-break:break-all;margin-top:6px}}.meta{{font-size:11px;color:var(--mut)}}
.cand{{border-left:3px solid var(--line);padding:2px 0 2px 12px;margin-bottom:12px}}
.q{{font-weight:500}}.choices{{margin:4px 0 4px 18px;padding:0;font-size:13px;color:#333}}
.choices .right{{color:var(--ok);font-weight:600}}.answer{{font-size:12px;color:var(--mut)}}
.why{{font-size:12px;color:var(--mut);font-style:italic;margin-top:2px}}
.tags{{margin-top:4px;display:flex;gap:6px;flex-wrap:wrap}}.tags span{{font:11px/1.6 ui-monospace,
monospace;background:#f0f0f0;border-radius:4px;padding:0 6px;color:#444}}
.flag{{font:11px/1.8 ui-monospace,monospace;background:#fdecea;color:var(--bad);border-radius:4px;
padding:0 6px;margin-left:6px}}
</style>
<h1>Generation drafts - {esc(batch)}</h1>
<div class="sub">Every parsed image in the batch, every candidate, exactly as the runner recorded it.
Flags are the runner's own validation (empty = structurally clean). This is a preview, not the
review room: nothing here is approved ground truth.</div>
<div class="summary"><div><b>{len(ok)}</b>images drafted</div><div><b>{total_c}</b>candidates</div>
<div><b>{flagged}</b>flagged candidates</div><div><b>{len(rows) - len(ok)}</b>failed rows (retry pending)</div></div>
{"".join(cards)}
"""
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(doc, encoding="utf-8")
    return len(ok), total_c, flagged


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch", required=True)
    ap.add_argument("--out", default="")
    args = ap.parse_args()
    out = Path(args.out) if args.out else ROOT / "scratch" / f"preview-{args.batch}.html"
    ok, total, flagged = render(args.batch, out)
    print(f"{ok} images, {total} candidates, {flagged} flagged -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
