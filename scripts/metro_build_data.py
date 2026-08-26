#!/usr/bin/env python3
"""
Bake the metro sync feed: apps/metro-web/public/data/version.json from data/metro.json.
The SyncChip polls this tiny file to show the next-sync countdown + refresh button.
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data", "metro.json")
OUT_DIR = os.path.join(ROOT, "apps", "metro-web", "public", "data")

def main():
    d = json.load(open(SRC, encoding="utf-8"))
    version = {
        "scannedAt": d["meta"]["scannedAt"],
        "cron": "0 * * * *",
        "counts": d["meta"]["counts"],
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, "version.json"), "w", encoding="utf-8") as f:
        json.dump(version, f, separators=(",", ":"))
    print(f"version.json written: scannedAt={version['scannedAt']}")


if __name__ == "__main__":
    main()
