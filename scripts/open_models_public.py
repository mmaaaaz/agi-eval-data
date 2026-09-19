#!/usr/bin/env python3
"""Copy the open-model evaluation artifact into apps/grip-web/public/data/.

Public layout mirrors the repo layout:
  data/open-models/models.json -> apps/grip-web/public/data/open-models.json

The client prefers this same-origin copy (guaranteed to match the deployed
bundle) and falls back to raw.githubusercontent / jsDelivr. Run after
open_models_bake.py. Windows-safe plain copy.
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SRC = REPO / "data" / "open-models" / "models.json"
REANALYSIS = REPO / "data" / "open-models" / "reanalysis.json"
DEST_DIR = REPO / "apps" / "grip-web" / "public" / "data"
DEST = DEST_DIR / "open-models.json"
DEST_REANALYSIS = DEST_DIR / "open-models-reanalysis.json"


def main() -> int:
    if not SRC.exists():
        print(f"missing {SRC} - run scripts/open_models_bake.py first", file=sys.stderr)
        return 1
    DEST_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SRC, DEST)
    print(f"open_models_public: {SRC.relative_to(REPO)} -> {DEST.relative_to(REPO)} ({DEST.stat().st_size / 1024:.1f} KB)")
    if REANALYSIS.exists():
        shutil.copy2(REANALYSIS, DEST_REANALYSIS)
        print(f"open_models_public: {REANALYSIS.relative_to(REPO)} -> {DEST_REANALYSIS.relative_to(REPO)} ({DEST_REANALYSIS.stat().st_size / 1024:.1f} KB)")
    else:
        print("open_models_public: reanalysis.json not found - run scripts/open_models_test1_reanalysis.py", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
