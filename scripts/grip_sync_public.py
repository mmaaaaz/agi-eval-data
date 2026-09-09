#!/usr/bin/env python3
"""Copy data/grip/* into apps/grip-web/public/data/grip/ for Vite static serving.

Public layout mirrors the repo layout:
  data/grip/tree.json          -> public/data/grip/tree.json
  data/grip/{slug}.json.gz     -> public/data/grip/{slug}.json.gz
Windows-safe plain copy (no symlinks). Run after grip_scan.py.
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from grip_common import OUT_DIR, PUBLIC_DIR


def main() -> int:
    dest = PUBLIC_DIR / "grip"
    dest.mkdir(parents=True, exist_ok=True)
    n = 0
    for src in sorted(OUT_DIR.glob("*.json.gz")):
        shutil.copy2(src, dest / src.name)
        n += 1
    tree = OUT_DIR / "tree.json"
    shutil.copy2(tree, dest / tree.name)
    n += 1
    # version.json: the client's fresh probe target. It pins artifact URLs to
    # this bake (jsDelivr @<commit> is immutable; raw gets ?v=<commit>) so the
    # 12h-edge/7-day-browser cache of jsDelivr @main can never serve a stale
    # fallback. MUST live in data/grip/ (committed by grip-rebake).
    t = json.loads(tree.read_text(encoding="utf-8"))
    commit = t.get("bakedFromCommit")
    if not commit:
        print("grip_sync_public: WARNING — tree.json has no bakedFromCommit; version.json skipped")
    else:
        version = {"commit": commit, "builtAt": t.get("builtAt")}
        (OUT_DIR / "version.json").write_text(json.dumps(version), encoding="utf-8")
        (dest / "version.json").write_text(json.dumps(version), encoding="utf-8")
        n += 1
    print(f"grip_sync_public: copied {n} files -> {dest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
