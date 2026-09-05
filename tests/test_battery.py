"""TDD tests for dataset-tools/battery.py — the per-file verification battery."""
import hashlib
import io
import sys
from pathlib import Path

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "dataset-tools"))
import battery as B


def jpeg_bytes(w, h, quality=90):
    img = Image.new("RGB", (w, h), (120, 60, 30))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


def rec(id="f1", name="a.jpg", ext="jpg", mode="inplace", pre_size=100000,
        pre_owner="theyellowdog123@gmail.com", pre_created="2025-01-01",
        post_size=40000, post_md5=None, post_w=1568, post_h=1047, codec="jpeg",
        post_owner=None, post_created=None, cap=1568):
    return {
        "id": id, "name": name, "ext": ext, "mode": mode, "cap": cap,
        "pre": {"size": pre_size, "owner": pre_owner, "created": pre_created},
        "post": {
            "size": post_size,
            "md5": post_md5 or hashlib.md5(jpeg_bytes(post_w, post_h)).hexdigest(),
            "w": post_w, "h": post_h, "codec": codec,
            "owner": post_owner or pre_owner,
            "created": post_created or pre_created,
        },
        "_post_bytes": jpeg_bytes(post_w, post_h, quality=75),
    }


class TestInvariants:
    def test_all_pass_on_good_record(self):
        r = rec(post_md5=hashlib.md5(rec()["_post_bytes"]).hexdigest())
        results = B.check_file(r, r["_post_bytes"])
        assert all(x["ok"] for x in results), [x for x in results if not x["ok"]]

    def test_owner_changed_fails(self):
        r = rec()
        r["_post_bytes"] = jpeg_bytes(r["post"]["w"], r["post"]["h"])
        r["post"]["md5"] = hashlib.md5(r["_post_bytes"]).hexdigest()
        r["post"]["owner"] = "someoneelse@gmail.com"
        results = B.check_file(r, r["_post_bytes"])
        assert any(not x["ok"] and "owner" in x["name"] for x in results)

    def test_created_time_changed_fails(self):
        r = rec()
        r["post"]["created"] = "2026-09-05"
        results = B.check_file(r, r["_post_bytes"])
        assert any(not x["ok"] and "created" in x["name"] for x in results)

    def test_grew_beyond_tolerance_fails(self):
        r = rec(pre_size=100000, post_size=150000)
        r["_post_bytes"] = jpeg_bytes(r["post"]["w"], r["post"]["h"])
        r["post"]["md5"] = hashlib.md5(r["_post_bytes"]).hexdigest()
        results = B.check_file(r, r["_post_bytes"])
        assert any(not x["ok"] and "size_grew" in x["name"] for x in results)

    def test_minor_growth_flagged_but_passes(self):
        # 2-25% growth: legitimate re-encode outcome, recorded not fatal
        r = rec(pre_size=100000, post_size=110000)
        r["_post_bytes"] = jpeg_bytes(r["post"]["w"], r["post"]["h"])
        r["post"]["md5"] = hashlib.md5(r["_post_bytes"]).hexdigest()
        results = B.check_file(r, r["_post_bytes"])
        assert any(x["ok"] and x["name"] == "size_grew_minor" for x in results)

    def test_over_claude_cap_fails(self):
        r = rec(post_size=6_000_000)
        r["_post_bytes"] = b"x" * 6_000_000
        r["post"]["md5"] = hashlib.md5(r["_post_bytes"]).hexdigest()
        results = B.check_file(r, r["_post_bytes"])
        assert any(not x["ok"] and "claude" in x["name"] for x in results)

    def test_md5_mismatch_fails(self):
        r = rec()
        r["_post_bytes"] = jpeg_bytes(1000, 800)  # different bytes than md5 says
        results = B.check_file(r, r["_post_bytes"])
        assert any(not x["ok"] and "md5" in x["name"] for x in results)

    def test_mimeType_changed_inplace_fails(self):
        r = rec(codec="webp")  # in-place must stay jpeg
        r["_post_bytes"] = jpeg_bytes(r["post"]["w"], r["post"]["h"])
        r["post"]["md5"] = hashlib.md5(r["_post_bytes"]).hexdigest()
        results = B.check_file(r, r["_post_bytes"])
        assert any(not x["ok"] and "mime" in x["name"] for x in results)


class TestDecode:
    def test_undecodable_fails(self):
        r = rec()
        r["_post_bytes"] = b"garbage bytes"
        results = B.check_file(r, r["_post_bytes"])
        assert any(not x["ok"] and "decode" in x["name"] for x in results)

    def test_dims_over_cap_fail(self):
        r = rec(post_w=2000, post_h=1500)
        r["_post_bytes"] = jpeg_bytes(2000, 1500)
        r["post"]["md5"] = hashlib.md5(r["_post_bytes"]).hexdigest()
        results = B.check_file(r, r["_post_bytes"])
        assert any(not x["ok"] and "cap" in x["name"] for x in results)


class TestAggregates:
    def test_batch_aggregate_counts(self):
        rs = [rec(id=f"f{i}", post_md5=hashlib.md5(rec()["_post_bytes"]).hexdigest()) for i in range(5)]
        agg = B.aggregate([B.check_file(r, r["_post_bytes"]) for r in rs])
        assert agg["files"] == 5 and agg["passed"] == 5 and agg["failed"] == 0

    def test_batch_aggregate_flags_failure(self):
        good = rec(id="f1", post_md5=hashlib.md5(rec()["_post_bytes"]).hexdigest())
        bad = rec(id="f2")
        bad["_post_bytes"] = b"garbage"
        agg = B.aggregate([B.check_file(good, good["_post_bytes"]), B.check_file(bad, b"garbage")])
        assert agg["failed"] == 1 and agg["ok"] is False
