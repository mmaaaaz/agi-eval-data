"""Offline unit tests for grip_fetch helpers. Run: python -m unittest scripts.test_grip_fetch -v"""
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent))
from grip_fetch import (
    parse_ls_remote, cache_path_for, needs_rebake,
    annotations_from_listing, overrides_from_listing, last_baked_sha,
)


class ParseTests(unittest.TestCase):
    def test_parse_ls_remote(self):
        out = "7c817d6abed20452204ecc7decc3ea4035d68a82\tHEAD\n"
        self.assertEqual(parse_ls_remote(out), "7c817d6abed20452204ecc7decc3ea4035d68a82")

    def test_parse_ls_remote_multiple_refs(self):
        out = ("aaa111\trefs/heads/main\n"
               "7c817d6abed20452204ecc7decc3ea4035d68a82\tHEAD\n")
        self.assertEqual(parse_ls_remote(out), "7c817d6abed20452204ecc7decc3ea4035d68a82")

    def test_parse_ls_remote_no_head(self):
        with self.assertRaises(ValueError):
            parse_ls_remote("aaa\trefs/heads/dev\n")


class CachePathTests(unittest.TestCase):
    def test_cache_paths_are_repo_relative(self):
        p = cache_path_for(Path("/x/.grip-cache"), "Dataset/route_dataset_3000/annotations.jsonl")
        self.assertEqual(p.as_posix(), "/x/.grip-cache/Dataset/route_dataset_3000/annotations.jsonl")


class NeedsRebakeTests(unittest.TestCase):
    def test_differs(self):
        self.assertTrue(needs_rebake("aaa", "bbb"))

    def test_same(self):
        self.assertFalse(needs_rebake("aaa", "aaa"))

    def test_no_marker(self):
        self.assertTrue(needs_rebake("aaa", None))

    def test_empty_marker(self):
        self.assertTrue(needs_rebake("aaa", ""))


class ListingFilterTests(unittest.TestCase):
    # per-category recursive listings carry BARE filenames (no folder prefix)
    CAT_LISTING = [
        {"path": "annotations.jsonl", "type": "blob"},
        {"path": "images/route_puzzle_0001.png", "type": "blob"},
        {"path": "sample_test/annotations.jsonl", "type": "blob"},
        {"path": "README.md", "type": "blob"},
    ]

    def test_annotations_with_prefix(self):
        got = annotations_from_listing(self.CAT_LISTING, "Dataset/route_dataset_3000")
        self.assertEqual(got, [
            "Dataset/route_dataset_3000/annotations.jsonl",
            "Dataset/route_dataset_3000/sample_test/annotations.jsonl",
        ])

    def test_overrides_from_subtree_listing(self):
        listing = [
            {"path": "angle_estimation/angle_estimation_0002.json", "type": "blob"},
            {"path": "route/x.json", "type": "blob"},
            {"path": "notes.md", "type": "blob"},
        ]
        got = overrides_from_listing(listing)
        self.assertEqual(got, [
            "data/overrides/angle_estimation/angle_estimation_0002.json",
            "data/overrides/route/x.json",
        ])

    def test_empty_listing(self):
        self.assertEqual(annotations_from_listing([], "Dataset/x"), [])


class LastBakedShaTests(unittest.TestCase):
    def test_missing_file(self):
        self.assertIsNone(last_baked_sha(Path("Z:/definitely/not/here/tree.json")))

    def test_reads_marker(self):
        import json, tempfile
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "tree.json"
            p.write_text(json.dumps({"bakedFromCommit": "abc123"}), encoding="utf-8")
            self.assertEqual(last_baked_sha(p), "abc123")

    def test_bad_json(self):
        import tempfile
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "tree.json"
            p.write_text("{not json", encoding="utf-8")
            self.assertIsNone(last_baked_sha(p))


if __name__ == "__main__":
    unittest.main()
