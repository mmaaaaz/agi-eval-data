#!/usr/bin/env python3
"""
dedup_plan.py — exact-duplicate keep-rule planner (plan v6, Phase 2 / Task 2.1).

Pure: manifest rows in -> drop plan out. Never executes anything.
Keep rule: oldest createdTime wins; tie-break on file-id (deterministic).
"""
from collections import defaultdict


def build_dedup_plan(rows: list, keep_rule: str = "oldest") -> list:
    """rows: [{id, created, size, md5, name}, ...]
    Returns one entry per md5 group with >1 member:
      [{md5, kept_id, drops: [{id, name, size}], wasted}]
    A single-member group is never planned (never drops the last copy).
    """
    if keep_rule != "oldest":
        raise ValueError(f"unsupported keep_rule: {keep_rule}")
    groups = defaultdict(list)
    for r in rows:
        if r.get("md5"):
            groups[r["md5"]].append(r)

    plan = []
    for md5, members in groups.items():
        if len(members) < 2:
            continue
        # oldest createdTime wins; tie-break on id for determinism
        ranked = sorted(members, key=lambda r: (r.get("created") or "9999", r["id"]))
        kept = ranked[0]
        drops = [{"id": r["id"], "name": r.get("name", ""), "size": int(r.get("size") or 0)}
                 for r in ranked[1:]]
        plan.append({"md5": md5, "kept_id": kept["id"], "drops": drops,
                     "wasted": sum(d["size"] for d in drops)})
    plan.sort(key=lambda g: -g["wasted"])
    return plan


def plan_from_manifest(manifest: dict) -> tuple:
    """Convenience: build plan from data/latest.json shape.
    Returns (plan, expected_total_bytes)."""
    files = manifest.get("files", [])
    rows = [{"id": r[0], "name": r[1], "ext": r[2], "size": r[3],
             "created": r[4] + "T00:00:00Z" if len(str(r[4])) == 10 else r[4],
             "owner": r[5], "md5": r[6], "kind": r[7]}
            for r in files if r[7] == "i"]
    plan = build_dedup_plan(rows, keep_rule="oldest")
    total = sum(g["wasted"] for g in plan)
    return plan, total
