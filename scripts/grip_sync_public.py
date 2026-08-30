#!/usr/bin/env python3
"""Copy data/grip/* into apps/grip-web/public/data/ for Vite static serving.

Windows-safe plain copy (no symlinks). Run after grip_scan.py.
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from grip_common import OUT_DIR, PUBLIC_DIR


def main() -> int:
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    n = 0
    for src in sorted(OUT_DIR.glob("*.json")):
        shutil.copy2(src, PUBLIC_DIR / src.name)
        n += 1
    print(f"grip_sync_public: copied {n} files -> {PUBLIC_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
