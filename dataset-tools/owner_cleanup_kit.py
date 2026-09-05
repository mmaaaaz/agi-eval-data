#!/usr/bin/env python3
"""
owner_cleanup_kit.py — per-owner duplicate deletion helper (Maaz-approved).

Drive does not let a writer trash others' files, and Drive has no
"filter by md5" view — so we generate one static HTML per owner listing
ONLY that owner's duplicate copies (from delete_plan.csv x manifest),
each row deeplinking straight to the file in Drive:
  https://drive.google.com/file/d/<id>/view   (open -> select -> delete)
plus a folder-level deeplink. Owner deletes in their own Drive; trash is
recoverable 30 days. The site's duplicates page links to these kits.

Output: apps/web/public/data/cleanup/<owner-slug>.html
"""
import csv
import json
import os
from collections import defaultdict
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data", "latest.pre-cutover.json")  # pre-cutover truth: dups intact
PLAN = os.path.join(ROOT, "dataset-tools", "dedup", "delete_plan.csv")
OUT = os.path.join(ROOT, "apps", "web", "public", "data", "cleanup")


def main():
    manifest = json.load(open(SRC, encoding="utf-8"))
    rows = {r[0]: r for r in manifest["files"]}
    plan = list(csv.DictReader(open(PLAN, encoding="utf-8")))
    print(f"delete_plan rows: {len(plan)}")

    by_owner = defaultdict(list)
    for p in plan:
        r = rows.get(p["file_id"])
        if not r:
            continue  # trashed/absent already
        by_owner[r[5]].append({"id": p["file_id"], "name": r[1], "size": int(r[3]),
                               "md5": p["md5"], "kept_id": p["kept_id"]})

    os.makedirs(OUT, exist_ok=True)
    css = ("<style>body{background:#111;color:#ddd;font:14px/1.5 sans-serif;max-width:1100px;"
           "margin:24px auto;padding:0 16px}h1{font-size:20px}h2{font-size:15px;color:#9f9}"
           "table{border-collapse:collapse;width:100%}td,th{border:1px solid #333;padding:6px 8px;"
           "text-align:left}img{width:64px;height:48px;object-fit:cover;display:block}"
           "a{color:#7ab7ff}code{font-size:11px;color:#888}.s{color:#8f8}.n{color:#fa0}"
           ".btn{display:inline-block;padding:2px 10px;border:1px solid #456;border-radius:4px;"
           "text-decoration:none;margin:1px}</style>")

    index_rows = []
    owners_json = []
    for owner, items in sorted(by_owner.items(), key=lambda kv: -sum(i["size"] for i in kv[1])):
        total = sum(i["size"] for i in items)
        slug = owner.replace("@", "-at-").replace(".", "-")
        # JSON kit — the site's /gallery/optimization/$owner route renders this
        kit = {
            "owner": owner,
            "copies": len(items),
            "gib": round(total / 2**30, 3),
            "note": ("Exact-duplicate copies (same md5) of a file that survives. "
                     "Verify against the keep-twin, then trash in your own Drive."),
            "items": sorted(items, key=lambda x: -x["size"]),
        }
        json.dump(kit, open(os.path.join(OUT, f"{slug}.json"), "w", encoding="utf-8"), indent=1)
        owners_json.append({"owner": owner, "copies": len(items),
                            "gib": round(total / 2**30, 3), "slug": slug})
        # legacy standalone HTML kit (shareable link, no JS needed)
        rows_html = []
        for i in sorted(items, key=lambda x: -x["size"]):
            furl = f"https://drive.google.com/file/d/{i['id']}/view"
            kurl = f"https://drive.google.com/file/d/{i['kept_id']}/view"
            thumb = f"https://lh3.googleusercontent.com/d/{i['id']}=w220"
            rows_html.append(
                f"<tr><td><img src=\"{thumb}\" loading=\"lazy\"></td>"
                f"<td>{i['name'][:44]}<br><code>{i['id'][:18]}…</code></td>"
                f"<td>{i['size']/2**20:.1f} MB</td>"
                f"<td><a class=\"btn\" href=\"{furl}\" target=\"_blank\">open ↗</a> "
                f"<a class=\"btn\" href=\"{kurl}\" target=\"_blank\">keep-copy ↗</a></td></tr>")
        html = ("<!doctype html><meta charset=utf-8><title>Duplicate cleanup — "
                f"{owner}</title>" + css +
                f"<h1>Duplicate cleanup kit — {owner}</h1>"
                f"<h2>{len(items)} duplicate copies · {total/2**30:.2f} GiB reclaimable</h2>"
                "<p>These files are <b>exact duplicates</b> (same md5) of another file that stays. "
                "This page is a <b>worklist only</b> — nothing is deleted automatically. "
                "Open each file in Drive (button), then <b>Move to trash</b>. Trash keeps them "
                "recoverable for 30 days. The 'keep-copy' button opens the surviving twin so you "
                "can confirm they are the same picture before deleting.</p>"
                "<p>Tip: Drive web supports multi-select — open a file, use the folder breadcrumb, "
                "and select several before trashing.</p>"
                "<table><tr><th>thumb</th><th>file</th><th>size</th><th>actions</th></tr>"
                + "".join(rows_html) + "</table>")
        path = os.path.join(OUT, f"{slug}.html")
        open(path, "w", encoding="utf-8").write(html)
        index_rows.append(f"<tr><td>{owner}</td><td>{len(items)}</td>"
                          f"<td>{total/2**30:.2f} GiB</td>"
                          f"<td><a href=\"cleanup/{slug}.html\">open kit ↗</a></td></tr>")
        print(f"  {owner}: {len(items)} copies, {total/2**30:.2f} GiB -> {slug}.html")

    idx = ("<!doctype html><meta charset=utf-8><title>Owner cleanup kits</title>" + css +
           "<h1>Duplicate cleanup kits (per owner)</h1>"
           "<p>Per-owner worklists of exact-duplicate copies with direct Drive deeplinks. "
           "Deletion is owner-side only; this site never deletes.</p>"
           "<table><tr><th>owner</th><th>copies</th><th>reclaimable</th><th>kit</th></tr>"
           + "".join(index_rows) + "</table>")
    open(os.path.join(OUT, "index.html"), "w", encoding="utf-8").write(idx)
    idx_json = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "total_copies": sum(o["copies"] for o in owners_json),
        "total_gib": round(sum(o["gib"] for o in owners_json), 3),
        "note": "Physical duplicate copies remain in Drive; deletion is owner-side only.",
        "owners": owners_json,
    }
    json.dump(idx_json, open(os.path.join(OUT, "index.json"), "w", encoding="utf-8"), indent=1)
    print(f"wrote index for {len(by_owner)} owners (+index.json)")


if __name__ == "__main__":
    main()
