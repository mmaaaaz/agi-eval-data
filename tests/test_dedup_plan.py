"""TDD tests for dataset-tools/dedup_plan.py — exact-dup keep-rule planning."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "dataset-tools"))
import dedup_plan as D


def rows(*specs):
    """specs: (id, created, size) or (id, created, size, md5). Default md5 'M1'
    so plain specs group together; pass distinct md5 for separate groups."""
    out = []
    for spec in specs:
        fid, created, size = spec[0], spec[1], spec[2]
        md5 = spec[3] if len(spec) > 3 else "M1"
        out.append({"id": fid, "created": created, "size": size, "md5": md5, "name": fid + ".jpg"})
    return out


class TestKeepRule:
    def test_keep_oldest_wins(self):
        plan = D.build_dedup_plan(rows(("b", "2025-06-01T00:00:00Z", 10), ("a", "2024-01-01T00:00:00Z", 10)))
        assert len(plan) == 1
        assert plan[0]["kept_id"] == "a" and plan[0]["drops"][0]["id"] == "b"

    def test_tie_breaks_on_file_id(self):
        plan = D.build_dedup_plan(rows(("b2", "2025-01-01T00:00:00Z", 10), ("a2", "2025-01-01T00:00:00Z", 10)))
        assert plan[0]["kept_id"] == "a2"

    def test_three_copies_drops_two(self):
        plan = D.build_dedup_plan(rows(
            ("c", "2025-03-01T00:00:00Z", 10), ("a", "2024-01-01T00:00:00Z", 10), ("b", "2024-06-01T00:00:00Z", 10)))
        assert [d["id"] for d in plan[0]["drops"]] == ["b", "c"]

    def test_never_drops_last_copy(self):
        plan = D.build_dedup_plan(rows(("only", "2025-01-01T00:00:00Z", 10)))
        assert plan == []

    def test_distinct_md5s_dont_mix(self):
        plan = D.build_dedup_plan(rows(
            ("a1", "2025-01-01T00:00:00Z", 10, "MA"), ("a2", "2024-01-01T00:00:00Z", 10, "MA"),
            ("b1", "2025-01-01T00:00:00Z", 10, "MB"), ("b2", "2024-01-01T00:00:00Z", 10, "MB")))
        assert len(plan) == 2
        kept = {g["kept_id"] for g in plan}
        assert kept == {"a2", "b2"}  # each group kept its own oldest, never mixed

    def test_drop_records_carry_size_for_sum_assert(self):
        plan = D.build_dedup_plan(rows(("b", "2025-01-01T00:00:00Z", 777), ("a", "2024-01-01T00:00:00Z", 10)))
        assert plan[0]["drops"][0]["size"] == 777
