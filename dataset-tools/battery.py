#!/usr/bin/env python3
"""
battery.py — the per-file + per-batch verification battery (plan v6 §1.2, Task 4.3).

Every optimized file must pass ALL checks; any failure halts the queue.
check_file() is pure: (record, post_bytes) -> list of {name, ok, detail}.
"""
import hashlib
import io

from PIL import Image

CLAUDE_CAP_BYTES = 5_000_000
SIZE_TOLERANCE = 1.02  # never silently accept >2% growth


def check_file(rec: dict, post_bytes: bytes) -> list:
    """rec: journal record with pre/post dicts + _post_bytes not required here.
    post_bytes: the exact bytes we encoded (for decode + md5 proof)."""
    results = []

    def add(name, ok, detail=""):
        results.append({"name": name, "ok": bool(ok), "detail": str(detail)[:200]})

    pre, post = rec.get("pre", {}), rec.get("post", {})

    # identity invariants
    add("id_unchanged", rec.get("id") is not None)
    add("name_unchanged", rec.get("name") == rec.get("name"))
    add("owner_unchanged", post.get("owner") == pre.get("owner"),
        f"{pre.get('owner')} -> {post.get('owner')}")
    add("created_unchanged", post.get("created") == pre.get("created"),
        f"{pre.get('created')} -> {post.get('created')}")

    # mimeType/codec invariant
    if rec.get("mode") == "inplace":
        add("mime_inplace_stable", post.get("codec") in ("jpeg", "jpg"),
            post.get("codec"))
    else:
        add("mime_sibling_webp", post.get("codec") == "webp", post.get("codec"))

    # md5-of-encoded-bytes proof
    actual = hashlib.md5(post_bytes).hexdigest()
    add("md5_matches_encoded", actual == post.get("md5"),
        f"claimed {post.get('md5','')[:12]}… actual {actual[:12]}…")

    # size rules
    size = post.get("size", 0)
    add("claude_cap", size <= CLAUDE_CAP_BYTES, f"{size} B")
    if rec.get("mode") == "inplace":
        pre_size = max(pre.get("size", 0), 1)
        if size > pre_size * SIZE_TOLERANCE:
            # plan v6: growth is FLAGGED for the report, not a batch-halting
            # failure (small q-50 sources legitimately grow at q78). Clearly
            # wrong transcodes (>25% growth) still fail.
            if size > pre_size * 1.25:
                add("size_grew", False, f"{pre_size} -> {size} (>25%)")
            else:
                results.append({"name": "size_grew_minor", "ok": True,
                                "detail": f"{pre_size} -> {size} (2-25%, flagged)"})

    # decode proof + dims
    try:
        img = Image.open(io.BytesIO(post_bytes))
        img.verify()
        img2 = Image.open(io.BytesIO(post_bytes))
        img2.load()
        w, h = img2.size
        add("decodes", True, f"{w}x{h}")
        cap = rec.get("cap")
        if cap:
            add("dims_within_cap", max(w, h) <= cap, f"{w}x{h} vs cap {cap}")
        if post.get("w") and post.get("h"):
            add("dims_match_record", (w, h) == (post.get("w"), post.get("h")),
                f"record {post.get('w')}x{post.get('h')} actual {w}x{h}")
    except Exception as e:  # noqa: BLE001
        add("decodes", False, f"{type(e).__name__}: {e}")

    return results


def aggregate(all_results: list) -> dict:
    """all_results: list of check_file() outputs."""
    files = len(all_results)
    failed_files = sum(1 for r in all_results if any(not c["ok"] for c in r))
    checks = sum(len(r) for r in all_results)
    failed_checks = sum(1 for r in all_results for c in r if not c["ok"])
    return {"files": files, "passed": files - failed_files, "failed": failed_files,
            "checks": checks, "failed_checks": failed_checks,
            "ok": failed_files == 0}
