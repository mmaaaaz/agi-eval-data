
import pathlib, sqlite3, sys

# RELATIVE, NOT ABSOLUTE. This was \`pathlib.Path(r"D:\\Deep learning Project\\apps\\relay")\` — a
# hardcoded path to one machine. It worked here and **would have failed on any other clone or on
# CI**, silently generating nothing or raising, depending on the call.
base = pathlib.Path(__file__).resolve().parents[2] / "apps" / "relay"
mig = base / "migrations"
mig.mkdir(exist_ok=True)

plan = [
    ("schema.sql",             "0001_core.sql",          "Core tables: questions, evaluations, tags, excluded."),
    ("schema_v4.sql",          "0002_v4_epistemic.sql",  "v4: tolerance, answer basis, second annotator, provenance, runs, human ceiling, views."),
    ("schema_v5.sql",          "0003_v5_pairing.sql",    "v5: capability/level/pairing, revisions, selections, change cursor, paired 2x2 views. Fixes the broken v_confidence_x_instability."),
    ("schema_v5b_guards.sql",  "0004_v5b_guards.sql",    "v5b: triggers making change-logging, immutable revisions and classification guarantees structural."),
    ("schema_v5c_item_axis.sql", "0005_v5c_item_axis.sql", "v5c: the error-analysis axis (family, relevance) that the form collected and the API discarded."),
    ("schema_v5d_eval_truth.sql", "0006_v5d_eval_truth.sql", "v5d: errors, sample counts and instability on an evaluation, so the site cannot publish a different number than the paper."),
    ("schema_v5f_run_summary.sql", "0008_v5f_run_summary.sql", "v5f: the leaderboard reads a summary row instead of scanning every evaluation — 445,000 rows per page load against a 5M/day allowance was 11 page loads."),
    ("schema_v5e_run_key.sql", "0007_v5e_run_key.sql", "v5e: the run is part of the identity of a measurement, so a ladder can be published without its conditions overwriting each other."),
    ("schema_v5g_selection_votes.sql", "0009_v5g_selection_votes.sql", "v5g: two distinct votes promote a nomination to chosen, and retracting below two undoes only a vote-promotion (promoted_by), never a human's own pick."),
    ("schema_v6_vqa_review.sql", "0010_v6_vqa_review.sql", "v6: the review room for model-drafted VQA candidates — candidates land pending, every decision is an appended review row, ingest is idempotent on (batch, file_id, question)."),
    ("schema_v6b_vqa_stats.sql", "0011_v6b_vqa_stats.sql", "v6b: materialised images/stats/dims so the review room costs a constant handful of D1 reads instead of a full scan per page load (the free tier is 5M rows read/day)."),
    ("schema_v6c_vqa_decisions.sql", "0012_v6c_vqa_decisions.sql", "v6c: the review room's read path moves to static Pages JSON; D1 keeps only human decisions keyed by a stable candidate id, which is constant-cost and free at any traffic."),
]
head = ("-- CANONICAL MIGRATION. Apply with:  npx wrangler d1 migrations apply agi-eval-questions --remote\n"
        "-- Source of truth for this file is apps/relay/{src}; edit there, then re-run scripts/db/sync_migrations.py.\n"
        "-- {desc}\n\n")
for src, dst, desc in plan:
    body = (base / src).read_text(encoding="utf-8-sig")
    (mig / dst).write_text(head.format(src=src, desc=desc) + body, encoding="utf-8")
    print("wrote migrations/" + dst, len(body), "bytes")

# prove the ordered sequence applies cleanly from the migrations dir
def split_sql(t):
    stmts, buf = [], ""
    for ln in t.splitlines():
        i = ln.find("--")
        buf += (ln[:i] if i >= 0 else ln) + "\n"
        if sqlite3.complete_statement(buf):
            stmts.append(buf.strip()); buf = ""
    if buf.strip(): stmts.append(buf.strip())
    return stmts

db = sqlite3.connect(":memory:")
print()
total_fail = 0
for f in sorted(mig.glob("*.sql")):
    ok = fail = 0
    for st in split_sql(f.read_text(encoding="utf-8-sig")):
        try: db.execute(st); ok += 1
        except Exception as e:
            fail += 1; print("  FAIL", f.name, e)
    total_fail += fail
    print("%-28s %3d ok  %d failed" % (f.name, ok, fail))
print("TOTAL FAILURES:", total_fail)
print("tables:", len(list(db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"))))
print("views :", len(list(db.execute("SELECT name FROM sqlite_master WHERE type='view'"))))
print("triggers:", len(list(db.execute("SELECT name FROM sqlite_master WHERE type='trigger'"))))


# A FAILURE COUNT THAT IS ONLY PRINTED IS NOT A RESULT. The script computed `total_fail`, printed
# it, and exited 0 either way — so a caller could not tell a clean regeneration from a broken one,
# and the same "a check that cannot fail" shape applied to the tool that GENERATES the migrations.
if total_fail:
    print()
    print("REFUSING: " + str(total_fail) + " statement(s) failed. The migrations on disk do not")
    print("apply cleanly to a fresh database, so a new deployment would fail to start.")
    sys.exit(1)