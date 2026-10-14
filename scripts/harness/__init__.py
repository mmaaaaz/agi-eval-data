"""Local evaluation harness. The ONLY actor permitted to write measurements.

Design contract (see .scratch/seen-not-grasped/spec.md and ADR-0004):
  1. reads a FROZEN release, never the live database
  2. hashes the exact image bytes it sent, per item
  3. records an unparseable answer separately from a wrong one
  4. stamps every row with the release groundtruth_hash and a run_id
  5. is idempotent on (run_id, question_id): re-running resumes, never duplicates
"""