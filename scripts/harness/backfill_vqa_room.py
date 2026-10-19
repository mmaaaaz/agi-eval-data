#!/usr/bin/env python
"""One-time backfill of the review room's materialised tables (migration 0011).

    python -m scripts.harness.backfill_vqa_room

The counts and images endpoints fall back to grouped scans on vqa_candidates
until vqa_meta.stats_initialised = '1'. This fills vqa_stats / vqa_dims /
vqa_images in ONE remote SQL file and sets the marker, after which a page load
costs a few dozen D1 rows read instead of ~400k.

It scans the candidate table, so it costs roughly n_candidates rows read per
GROUP BY (four scans) plus one write per image. On D1's free tier that is a
once-a-day operation: run it after the daily quota resets (00:00 UTC), ideally
right after the last ingest of the day.

Apply the schema first (migration 0011), then run this, in apps/relay:
    npx wrangler d1 migrations apply agi-eval-questions --remote
    python -m scripts.harness.backfill_vqa_room
"""

from __future__ import annotations

import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
RELAY = ROOT / "apps" / "relay"

SQL = """
DELETE FROM vqa_stats;
DELETE FROM vqa_dims;
DELETE FROM vqa_images;
INSERT INTO vqa_stats (status, n) SELECT status, COUNT(*) FROM vqa_candidates GROUP BY status;
INSERT INTO vqa_dims (kind, value, n) SELECT 'capability', capability, COUNT(*) FROM vqa_candidates GROUP BY capability;
INSERT INTO vqa_dims (kind, value, n) SELECT 'level', level, COUNT(*) FROM vqa_candidates GROUP BY level;
INSERT INTO vqa_dims (kind, value, n) SELECT 'domain', domain, COUNT(*) FROM vqa_candidates GROUP BY domain;
INSERT INTO vqa_images (file_id, n, first_id, pending)
  SELECT file_id, COUNT(*), MIN(id), SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END)
  FROM vqa_candidates GROUP BY file_id;
INSERT OR REPLACE INTO vqa_meta (k, v) VALUES ('stats_initialised', '1');
"""


def main() -> int:
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8") as f:
        f.write(SQL)
        path = f.name
    print(f"backfilling from {path}")
    cmd = ["npx", "wrangler", "d1", "execute", "agi-eval-questions", "--remote", "--file", path]
    rc = subprocess.call(cmd, cwd=str(RELAY))
    if rc != 0:
        print("backfill failed; the endpoints keep using the grouped fallback", file=sys.stderr)
        return rc
    print("done: vqa_stats / vqa_dims / vqa_images initialised, marker set")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
