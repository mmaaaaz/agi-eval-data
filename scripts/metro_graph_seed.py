#!/usr/bin/env python3
"""
Bootstrap data/metro-graph.json skeletons for every image row in data/metro.json.
Idempotent: existing graphs are preserved; only missing file_ids are added.
City derived via cityName logic mirroring apps/metro-web/src/lib/data.ts;
country via folders[1].strip(); branch via folders[0].
"""

import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent.parent
SRC = ROOT / "data" / "metro.json"
OUT = ROOT / "data" / "metro-graph.json"
SCHEMA_REF = "data/metro-graph.schema.json"  # for reference only

CITY_RE_TOKENS = re.compile(
    r"\b(Metro|MetroRail|Metrorail|Railway|Rail|Map|Route|Network|Transit)\b", re.I
)
V_RE = re.compile(r"\b(v1|v2)\b", re.I)


def city_name(filename: str) -> str:
    base = re.sub(r"\.[a-z0-9]+$", "", filename, flags=re.I)
    base = CITY_RE_TOKENS.sub("", base)
    base = V_RE.sub("", base)
    base = re.sub(r"[-_]+", " ", base)
    base = re.sub(r"\s{2,}", " ", base)
    return base.strip() or filename.replace(".", " ").strip()


def main() -> None:
    data = json.loads(SRC.read_text(encoding="utf-8"))
    files = data.get("files", [])
    image_rows = [r for r in files if len(r) >= 9 and r[7] == "i"]

    existing = {}
    if OUT.exists():
        try:
            prev = json.loads(OUT.read_text(encoding="utf-8"))
            existing = prev.get("graphs", {})
        except Exception:
            existing = {}

    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    graphs = {}
    for row in image_rows:
        file_id = row[0]
        name = row[1]
        folders = row[8] if len(row) > 8 and isinstance(row[8], list) else []
        branch = (folders[0].strip() if len(folders) > 0 and isinstance(folders[0], str) else "ours") or "ours"
        country = (folders[1].strip() if len(folders) > 1 and isinstance(folders[1], str) else "") or ""
        # Guard: empty country should be flagged by validator; seed with placeholder if needed
        if not country:
            country = "__unknown__"
        city = city_name(name) or country or file_id

        if file_id in existing:
            g = existing[file_id]
            # Backfill city/country/branch if empty but do not overwrite stations/edges
            g.setdefault("fileId", file_id)
            if not g.get("city"):
                g["city"] = city
            if not g.get("country"):
                g["country"] = country
            if not g.get("branch"):
                g["branch"] = branch
            graphs[file_id] = g
        else:
            graphs[file_id] = {
                "fileId": file_id,
                "city": city,
                "country": country,
                "branch": branch,
                "stations": [],
                "edges": [],
                "lines": {},
                "provenance": {
                    "annotatedBy": "seed",
                    "annotatedAt": now[:10],
                    "tool": "metro_graph_seed.py v1",
                },
            }

    counts = {
        "graphs": len(graphs),
        "stations": sum(len(g.get("stations", [])) for g in graphs.values()),
        "edges": sum(len(g.get("edges", [])) for g in graphs.values()),
    }
    out_doc = {
        "version": 1,
        "generatedAt": now,
        "source": "data/metro.json#v4",
        "counts": counts,
        "graphs": graphs,
    }
    OUT.write_text(json.dumps(out_doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"seeded {len(graphs)} graphs -> {OUT} (stations={counts['stations']} edges={counts['edges']})")


if __name__ == "__main__":
    main()
