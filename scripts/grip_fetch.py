#!/usr/bin/env python3
"""Fetch annotations + overrides from the upstream repo into .grip-cache/.

Upstream is the single source of truth (docs/grip.md). We never clone the
suite (PNGs are LFS, ~2.3GB); annotations.jsonl files are plain git blobs,
fetched per-file from raw.githubusercontent. Override patches come from
data/overrides/** on upstream — the ONE durable home for site edits.

Tree discovery: the whole-repo recursive listing is truncated (100k+ files),
so we walk by SHA — root tree → Dataset tree → one listing per category
folder. Subsuite annotations (sample_test etc.) sit one level deeper, so
category walks are recursive-by-sha as well (per-folder: small).

Usage:
  python scripts/grip_fetch.py            # fetch only when upstream HEAD changed
  python scripts/grip_fetch.py --force    # fetch even if HEAD matches the marker
Exit 0 = fetched or up-to-date; exit 1 = fetch/parse failure.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.request
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from grip_common import OUT_DIR, UPSTREAM_REPO

CACHE = Path(".grip-cache")
RAW = f"https://raw.githubusercontent.com/{UPSTREAM_REPO}/main"
UA = {"User-Agent": "grip-fetch/2", "Accept": "*/*"}


def _api_headers() -> dict:
    """Raise the 60 req/hr anonymous API cap when a token is available
    (GITHUB_TOKEN env or the gh CLI keyring)."""
    h = dict(UA)
    tok = os.environ.get("GITHUB_TOKEN")
    if not tok:
        try:
            gh = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, timeout=30)
            if gh.returncode == 0:
                tok = gh.stdout.strip()
        except (OSError, subprocess.SubprocessError):
            pass
    if tok:
        h["Authorization"] = f"Bearer {tok}"
    return h


# ---------- pure helpers (unit-tested) ----------

def parse_ls_remote(out: str) -> str:
    for line in out.splitlines():
        if line.endswith("\tHEAD"):
            return line.split("\t")[0].strip()
    raise ValueError("no HEAD in ls-remote output")


def cache_path_for(cache: Path, repo_rel: str) -> Path:
    return cache / repo_rel


def needs_rebake(head: str, baked: str | None) -> bool:
    return baked != head


def last_baked_sha(tree_path: Path) -> str | None:
    if not tree_path.exists():
        return None
    try:
        return json.loads(tree_path.read_text(encoding="utf-8")).get("bakedFromCommit")
    except (json.JSONDecodeError, OSError):
        return None


def annotations_from_listing(tree: list[dict], parent: str) -> list[str]:
    """Blobs ending in annotations.jsonl under a known parent folder."""
    return sorted(
        f"{parent}/{t['path']}" for t in tree
        if t.get("type") == "blob" and t["path"].endswith("annotations.jsonl")
    )


def overrides_from_listing(tree: list[dict]) -> list[str]:
    return sorted(
        f"data/overrides/{t['path']}" for t in tree
        if t.get("type") == "blob" and t["path"].endswith(".json")
    )


# ---------- network / git ----------

def upstream_head() -> str:
    r = subprocess.run(
        ["git", "ls-remote", f"https://github.com/{UPSTREAM_REPO}.git", "HEAD"],
        capture_output=True, text=True, check=True, timeout=60,
    )
    return parse_ls_remote(r.stdout)


def _tree_by_sha(sha: str, label: str) -> dict:
    url = f"https://api.github.com/repos/{UPSTREAM_REPO}/git/trees/{sha}"
    req = urllib.request.Request(url, headers=_api_headers())
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.load(r)
    if data.get("truncated"):
        raise RuntimeError(f"tree listing for '{label}' truncated")
    return data


def discover_annotation_paths() -> tuple[list[str], dict]:
    """Returns (Dataset-relative annotation paths, per-category index).

    The index maps folder -> [relative annotation paths] so the scanner can
    derive subsuites without touching image bytes (which stay LFS upstream).
    """
    root = _tree_by_sha("main", "main")["tree"]
    ds = next((t for t in root if t["path"] == "Dataset" and t["type"] == "tree"), None)
    if ds is None:
        raise RuntimeError("upstream has no Dataset/ folder")
    dataset_tree = _tree_by_sha(ds["sha"], "Dataset")["tree"]
    out: list[str] = []
    index: dict[str, list[str]] = {}
    for cat in dataset_tree:
        if cat.get("type") != "tree":
            continue
        # recursive listing per category (~6k entries) covers its subsuites
        cat_rec = _tree_by_sha(f"{cat['sha']}?recursive=1", cat["path"])["tree"]
        rels = annotations_from_listing(cat_rec, cat["path"])
        out.extend(rels)
        index[cat["path"]] = rels
    return out, index


def discover_override_paths() -> list[str]:
    """data/overrides/** blobs; the dir 404s until the first sync — fine."""
    root = _tree_by_sha("main", "main")["tree"]
    ov = next((t for t in root if t["path"] == "data/overrides" and t["type"] == "tree"), None)
    if ov is None:
        print("  no data/overrides on upstream yet (fine)")
        return []
    sub = _tree_by_sha(ov["sha"], "data/overrides")["tree"]
    return overrides_from_listing(sub)


def fetch_file(repo_rel: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(f"{RAW}/{repo_rel}", headers=UA)
    with urllib.request.urlopen(req, timeout=300) as r, open(dest, "wb") as f:
        f.write(r.read())


# ---------- main ----------

def main() -> int:
    from grip_common import CATEGORIES

    head = upstream_head()
    baked = last_baked_sha(OUT_DIR / "tree.json")
    force = "--force" in sys.argv
    if not force and not needs_rebake(head, baked):
        print(f"up-to-date: bakedFromCommit == {head[:12]}")
        return 0
    print(f"upstream {head[:12]} vs baked '{baked}' — fetching")

    ann_paths, ann_index = discover_annotation_paths()
    ann_paths = [f"Dataset/{p}" for p in ann_paths]  # discovery returns Dataset-relative
    # safety: every category must be represented
    have = {p.split("/")[1] for p in ann_paths}
    missing = [c[0] for c in CATEGORIES.values() if c[0] not in have]
    if missing:
        raise RuntimeError(f"upstream missing annotations for: {missing}")
    ov_paths = discover_override_paths()
    ov_paths = [f"data/overrides/{p}" for p in ov_paths]  # same, for overrides

    fetched = 0
    for rel in ann_paths + ov_paths:
        dest = cache_path_for(CACHE, rel)
        fetch_file(rel, dest)
        fetched += 1
        print(f"  fetched {rel}")

    (CACHE / "manifest.json").write_text(
        json.dumps({"head": head, "fetched": fetched,
                    "annotation_count": len(ann_paths),
                    "override_count": len(ov_paths),
                    "files": ann_paths + ov_paths}, indent=1),
        encoding="utf-8")
    (CACHE / "annotations_index.json").write_text(
        json.dumps(ann_index, indent=1), encoding="utf-8")
    print(f"fetched {fetched} files @ {head[:12]} "
          f"({len(ann_paths)} annotations, {len(ov_paths)} overrides)")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, urllib.error.URLError, subprocess.CalledProcessError, ValueError) as e:
        print(f"grip_fetch FAILED: {e}", file=sys.stderr)
        raise SystemExit(1)
