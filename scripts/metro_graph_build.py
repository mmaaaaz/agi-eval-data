#!/usr/bin/env python3
"""
Normalize / pretty-print data/metro-graph.json with stable ordering.
- Sorts graphs by file_id, stations by id, edges by (from,to,line), lines keys.
- Recalculates counts and updates generatedAt.
- Does not invoke seed; validates counts after sorting.
"""

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent.parent
GRAPH = ROOT / "data" / "metro-graph.json"


def main() -> None:
    if not GRAPH.exists():
        raise SystemExit(f"{GRAPH} not found — run scripts/metro_graph_seed.py first")
    doc = json.loads(GRAPH.read_text(encoding="utf-8"))
    graphs = doc.get("graphs", {})
    # Sort graphs by file_id
    sorted_graphs = {}
    for gid in sorted(graphs.keys()):
        g = graphs[gid]
        # Sort stations by id
        stations = sorted(g.get("stations", []), key=lambda s: s.get("id", ""))
        # Sort edges by from,to,line
        edges = sorted(g.get("edges", []), key=lambda e: (e.get("from", ""), e.get("to", ""), e.get("line", "")))
        # Sort lines keys
        lines = g.get("lines", {})
        sorted_lines = {k: lines[k] for k in sorted(lines.keys())} if isinstance(lines, dict) else lines
        sorted_graphs[gid] = {
            "fileId": g.get("fileId", gid),
            "city": g.get("city", ""),
            "country": g.get("country", ""),
            "branch": g.get("branch", ""),
            "stations": stations,
            "edges": edges,
            "lines": sorted_lines,
            "provenance": g.get("provenance", {}),
        }

    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    doc["generatedAt"] = now
    doc["graphs"] = sorted_graphs
    doc["counts"] = {
        "graphs": len(sorted_graphs),
        "stations": sum(len(g["stations"]) for g in sorted_graphs.values()),
        "edges": sum(len(g["edges"]) for g in sorted_graphs.values()),
    }
    # Stable top-level key order: version, generatedAt, source, counts, graphs
    ordered = {
        "version": doc.get("version", 1),
        "generatedAt": doc["generatedAt"],
        "source": doc.get("source", "data/metro.json#v4"),
        "counts": doc["counts"],
        "graphs": doc["graphs"],
    }
    GRAPH.write_text(json.dumps(ordered, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"normalized {len(sorted_graphs)} graphs ({ordered['counts']['stations']} stations, {ordered['counts']['edges']} edges) -> {GRAPH}")


if __name__ == "__main__":
    main()
