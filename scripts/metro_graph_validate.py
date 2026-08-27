#!/usr/bin/env python3
"""
Validate data/metro-graph.json against data/metro-graph.schema.json +
graph invariants for CI (exit 0 pass, 1 fail).

Checks:
 - JSON Schema (if jsonschema available, else minimal structural checks)
 - Counts accuracy
 - Duplicate station.id within each graph
 - Dangling edge endpoint (from/to not in stations)
 - Isolated station degree 0 (warn, not fail unless --strict)
 - Missing graph for any kind=="i" row
 - Empty label (warn)
 - Orphan branch/country inconsistency vs data/metro.json
 - Empty lines.stations references
"""

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).parent.parent
SRC = ROOT / "data" / "metro.json"
GRAPH = ROOT / "data" / "metro-graph.json"
SCHEMA = ROOT / "data" / "metro-graph.schema.json"


def load_json(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def validate_schema(doc) -> list[str]:
    errs: list[str] = []
    # Prefer jsonschema if installed
    try:
        import jsonschema  # type: ignore

        schema = load_json(SCHEMA)
        # jsonschema 4.x uses Draft202012Validator
        try:
            validator = jsonschema.Draft202012Validator(schema)
        except AttributeError:
            validator = jsonschema.validators.validator_for(schema)(schema)  # type: ignore
        for e in sorted(validator.iter_errors(doc), key=lambda x: list(x.path)):
            loc = "/".join(str(p) for p in e.path) or "(root)"
            errs.append(f"schema:{loc}: {e.message}")
        return errs
    except ImportError:
        pass

    # Minimal fallback without jsonschema
    if doc.get("version") != 1:
        errs.append("schema: version must be 1")
    if doc.get("source") != "data/metro.json#v4":
        errs.append("schema: source must be 'data/metro.json#v4'")
    if not isinstance(doc.get("generatedAt"), str):
        errs.append("schema: generatedAt must be string")
    counts = doc.get("counts")
    if not isinstance(counts, dict) or not all(k in counts for k in ("graphs", "stations", "edges")):
        errs.append("schema: counts must have graphs/stations/edges")
    graphs = doc.get("graphs")
    if not isinstance(graphs, dict):
        errs.append("schema: graphs must be object")
    else:
        for gid, g in graphs.items():
            if not isinstance(g, dict):
                errs.append(f"schema: graphs/{gid} must be object")
                continue
            for req in ("fileId", "city", "country", "branch", "stations", "edges", "lines", "provenance"):
                if req not in g:
                    errs.append(f"schema: graphs/{gid} missing {req}")
            if g.get("fileId") != gid:
                errs.append(f"schema: graphs/{gid} fileId mismatch ({g.get('fileId')})")
            stations = g.get("stations", [])
            edges = g.get("edges", [])
            if not isinstance(stations, list):
                errs.append(f"schema: graphs/{gid}/stations must be array")
            if not isinstance(edges, list):
                errs.append(f"schema: graphs/{gid}/edges must be array")
    return errs


def main() -> int:
    ap = argparse.ArgumentParser(description="Validate metro-graph sidecar")
    ap.add_argument("--strict", action="store_true", help="Treat isolated/empty-label as errors")
    ap.add_argument("--schema-only", action="store_true", help="Only schema check")
    args = ap.parse_args()

    if not GRAPH.exists():
        print(f"ERROR: {GRAPH} not found (run scripts/metro_graph_seed.py)", file=sys.stderr)
        return 1
    if not SRC.exists():
        print(f"ERROR: {SRC} not found", file=sys.stderr)
        return 1

    doc = load_json(GRAPH)
    data = load_json(SRC)
    files = data.get("files", [])
    image_ids = {r[0] for r in files if len(r) >= 9 and r[7] == "i"}

    errors: list[str] = []
    warns: list[str] = []

    schema_errs = validate_schema(doc)
    errors.extend(schema_errs)
    if args.schema_only:
        for e in errors:
            print(f"ERROR {e}", file=sys.stderr)
        return 1 if errors else 0

    graphs = doc.get("graphs", {}) if isinstance(doc.get("graphs"), dict) else {}
    counts = doc.get("counts", {})

    # Missing graph for any image row
    missing = sorted(image_ids - set(graphs.keys()))
    for mid in missing:
        errors.append(f"missing graph for image file_id {mid}")

    # Extra graphs not in dataset (warn)
    extra = sorted(set(graphs.keys()) - image_ids)
    for eid in extra:
        warns.append(f"extra graph {eid} not in data/metro.json image rows")

    # Counts accuracy
    actual_graphs = len(graphs)
    actual_stations = sum(len(g.get("stations", [])) for g in graphs.values() if isinstance(g, dict))
    actual_edges = sum(len(g.get("edges", [])) for g in graphs.values() if isinstance(g, dict))
    if counts.get("graphs") != actual_graphs:
        errors.append(f"counts.graphs {counts.get('graphs')} != actual {actual_graphs}")
    if counts.get("stations") != actual_stations:
        errors.append(f"counts.stations {counts.get('stations')} != actual {actual_stations}")
    if counts.get("edges") != actual_edges:
        errors.append(f"counts.edges {counts.get('edges')} != actual {actual_edges}")

    # Per-graph invariants
    # Build map from file_id to dataset row for branch/country consistency
    row_by_id = {r[0]: r for r in files}

    for gid, g in graphs.items():
        if not isinstance(g, dict):
            continue
        stations = g.get("stations", [])
        edges = g.get("edges", [])
        lines = g.get("lines", {})

        # Duplicate station.id
        ids = [s.get("id") for s in stations if isinstance(s, dict)]
        dup = [k for k, c in Counter(ids).items() if c > 1]
        for d in dup:
            errors.append(f"{gid}: duplicate station.id '{d}'")

        # Empty label warn
        for s in stations:
            if isinstance(s, dict) and not (s.get("label") or "").strip():
                msg = f"{gid}: station '{s.get('id')}' has empty label"
                (errors if args.strict else warns).append(msg)

        # Dangling edge endpoints + orphan lines
        id_set = set(ids)
        for idx, e in enumerate(edges):
            if not isinstance(e, dict):
                errors.append(f"{gid}: edge[{idx}] not an object")
                continue
            fr = e.get("from")
            to = e.get("to")
            if fr not in id_set:
                errors.append(f"{gid}: edge[{idx}] from '{fr}' not in stations")
            if to not in id_set:
                errors.append(f"{gid}: edge[{idx}] to '{to}' not in stations")
            if not e.get("line"):
                errors.append(f"{gid}: edge[{idx}] missing line")
            w = e.get("weight")
            if not isinstance(w, (int, float)) or w <= 0:
                errors.append(f"{gid}: edge[{idx}] weight must be >0, got {w!r}")

        # Isolated station (degree 0) — warn (or error in strict)
        if stations and edges:
            degree = Counter()
            for e in edges:
                if isinstance(e, dict):
                    # undirected degree counts both ends unless self-loop
                    fr = e.get("from")
                    to = e.get("to")
                    if fr in id_set:
                        degree[fr] += 1
                    if to in id_set and to != fr:
                        degree[to] += 1
                    # bidirectional already counted as one edge; degree counts edge presence
            for s in stations:
                sid = s.get("id") if isinstance(s, dict) else None
                if sid and degree.get(sid, 0) == 0:
                    msg = f"{gid}: isolated station '{sid}' degree 0"
                    (errors if args.strict else warns).append(msg)

        # lines.stations must reference existing stations
        if isinstance(lines, dict):
            for line_id, line in lines.items():
                if not isinstance(line, dict):
                    errors.append(f"{gid}: lines.{line_id} not an object")
                    continue
                for sid in line.get("stations", []):
                    if sid not in id_set:
                        errors.append(f"{gid}: lines.{line_id} references unknown station '{sid}'")
                color = line.get("color", "")
                if color and not isinstance(color, str):
                    errors.append(f"{gid}: lines.{line_id} color must be string")

        # Branch/country consistency vs dataset (strip branch/country)
        row = row_by_id.get(gid)
        if row is not None and len(row) > 8 and isinstance(row[8], list):
            folders = row[8]
            exp_branch = (folders[0].strip() if len(folders) > 0 and isinstance(folders[0], str) else "ours") or "ours"
            exp_country = (folders[1].strip() if len(folders) > 1 and isinstance(folders[1], str) else "") or ""
            # Seed uses __unknown__ placeholder for empty; validator should flag it
            if g.get("branch") != exp_branch:
                warns.append(f"{gid}: branch '{g.get('branch')}' != dataset '{exp_branch}'")
            # Only warn if dataset has a real country and graph country mismatches stripped value
            if exp_country and g.get("country") != exp_country:
                # Allow case where graph country was placeholder
                if g.get("country") != "__unknown__":
                    warns.append(f"{gid}: country '{g.get('country')}' != dataset '{exp_country}'")

    for w in warns:
        print(f"WARN {w}")
    for e in errors:
        print(f"ERROR {e}", file=sys.stderr)

    if errors:
        print(f"\nFAILED: {len(errors)} error(s), {len(warns)} warning(s)", file=sys.stderr)
        return 1
    print(f"OK: {actual_graphs} graphs, {actual_stations} stations, {actual_edges} edges — {len(warns)} warning(s)")
    if missing:
        print(f"  missing image graphs: {len(missing)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
