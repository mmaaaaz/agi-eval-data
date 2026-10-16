import { describe, expect, it } from "vitest";
import { createQuestionsApi, type QuestionsApiDeps } from "./index";
import { hasCode } from "./index";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * The two-door contract, tested through the HTTP surface only.
 *
 * These are the assertions that keep the benchmark credible: an open door may
 * write drafts, but it must never be able to change ground truth or inject a
 * measurement.
 */

interface FakeDb {
  seen: string[];
  /** Every bind() call, so a test can assert on the VALUE written and not only the SQL. */
  binds: { sql: string; args: unknown[] }[];
}

function makeDb(
  first?: (sql: string) => unknown,
  allRows?: (sql: string) => unknown[],
  runChanges: (sql: string) => number = () => 1,
) {
  const seen: string[] = [];
  // Bind values are recorded too. Asserting on the SQL alone cannot tell 500 from 2,
  // and "which number did it actually write" is the question that matters for a count.
  const binds: { sql: string; args: unknown[] }[] = [];
  const mk = (sql: string): any => ({
    sql,
    bind: (...a: unknown[]) => { binds.push({ sql, args: a }); return mk(sql); },
    first: async () => { seen.push(sql); return first ? first(sql) : null; },
    all: async () => { seen.push(sql); return { results: allRows ? allRows(sql) : [] }; },
    run: async () => {
    seen.push(sql);
    // D1 reports how many rows the statement actually changed. The conditional UPDATE
    // relies on it: changes = 0 means another writer got there first.
    return { success: true, meta: { last_row_id: 1, changes: runChanges(sql) } };
  },
  });
  const db = {
    seen,
    binds,
    // Recorded at prepare time, so statements that only ever reach db.batch()
    // (the insert path) are visible to assertions too.
    prepare: (sql: string) => { seen.push(sql); return mk(sql); },
    batch: async (stmts: unknown[]) => {
      for (const st of stmts) {
        const sql = (st as { sql?: string }).sql;
        if (sql) seen.push(sql);
      }
      return stmts.map(() => ({ meta: { last_row_id: 7 } }));
    },
  };
  return db as unknown as D1Database & FakeDb;
}

function api(db: D1Database, extra: Partial<QuestionsApiDeps> = {}) {
  return createQuestionsApi({
    db,
    normQ: (q: string) => q.toLowerCase().trim(),
    normTags: (raw: string) => raw.split(",").map((s) => s.trim()).filter(Boolean),
    ...extra,
  });
}

async function call(
  a: ReturnType<typeof createQuestionsApi>,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: any }> {
  const req = new Request("http://local" + path, init);
  const res = await a.handle(req, new URL(req.url));
  if (!res) return { status: 0, body: null };
  return { status: res.status, body: await res.json().catch(() => null) };
}

const DRAFT_ITEM = {
  file_id: "img_1",
  question: "Is the guard lower than the edge?",
  answer_type: "choice",
  answer: "A",
  choices: JSON.stringify(["Yes", "No"]),
  capability: "B4",
  level: "L4",
  pair_id: "p1",
  pair_role: "geometry",
};

describe("the open door writes drafts only", () => {
  it("creates a draft when no reviewer code is presented", async () => {
    const a = api(makeDb());
    const r = await call(a, "/api/questions", { method: "POST", body: JSON.stringify(DRAFT_ITEM) });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("draft");
    expect(r.body.id).toBe(7);
  });

  it("refuses to create an APPROVED item with no capability or level", async () => {
    const a = api(makeDb(), { questionsCode: "REV" });
    const r = await call(a, "/api/questions", {
      method: "POST",
      headers: { "x-questions-code": "REV" },
      body: JSON.stringify({ ...DRAFT_ITEM, capability: "", level: "" }),
    });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/capability and a level/);
  });

  it("lets a reviewer create a fully classified item as approved", async () => {
    const a = api(makeDb(), { questionsCode: "REV" });
    const r = await call(a, "/api/questions", {
      method: "POST",
      headers: { "x-questions-code": "REV", "x-actor": "actor-1", "x-actor-name": "Ali" },
      body: JSON.stringify(DRAFT_ITEM),
    });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("approved");
  });

  it("records the actor on the insert, so every item is attributable", async () => {
    const db = makeDb();
    await call(api(db), "/api/questions", {
      method: "POST",
      headers: { "x-actor": "actor-1", "x-actor-name": "Ali" },
      body: JSON.stringify(DRAFT_ITEM),
    });
    const sql = db.seen.join(" ");
    expect(sql).toContain("actor_id");
    expect(sql).toContain("actor_name");
  });

  it("rejects a write from an actor over the rate limit", async () => {
    const a = api(makeDb((sql) => (sql.includes("question_revisions") ? { n: 999 } : null)));
    const r = await call(a, "/api/questions", {
      method: "POST",
      headers: { "x-actor": "spammer" },
      body: JSON.stringify(DRAFT_ITEM),
    });
    expect(r.status).toBe(429);
  });

  it("validates the item before writing it", async () => {
    const a = api(makeDb());
    const r = await call(a, "/api/questions", { method: "POST", body: JSON.stringify({ file_id: "", question: "" }) });
    expect(r.status).toBe(400);
  });
});

describe("approval is a separate, gated door", () => {
  it("refuses review without the reviewer code", async () => {
    const a = api(makeDb(), { questionsCode: "REV" });
    const r = await call(a, "/api/questions/5/review", { method: "POST", body: JSON.stringify({ decision: "accept" }) });
    expect(r.status).toBe(401);
  });

  it("refuses review with the WRONG code", async () => {
    const a = api(makeDb(), { questionsCode: "REV" });
    const r = await call(a, "/api/questions/5/review", {
      method: "POST",
      headers: { "x-questions-code": "guess" },
      body: JSON.stringify({ decision: "accept" }),
    });
    expect(r.status).toBe(401);
  });

  it("refuses to approve an unclassified item even with the code", async () => {
    const a = api(makeDb(() => ({ id: 5, capability: null, level: null })), { questionsCode: "REV" });
    const r = await call(a, "/api/questions/5/review", {
      method: "POST",
      headers: { "x-questions-code": "REV" },
      body: JSON.stringify({ decision: "accept" }),
    });
    expect(r.status).toBe(400);
  });

  it("approves a classified item with the code", async () => {
    const a = api(makeDb(() => ({ id: 5, capability: "B4", level: "L4" })), { questionsCode: "REV" });
    const r = await call(a, "/api/questions/5/review", {
      method: "POST",
      headers: { "x-questions-code": "REV" },
      body: JSON.stringify({ decision: "accept", reason: "one defensible answer" }),
    });
    expect(r.status).toBe(200);
    expect(r.body.review_status).toBe("accepted");
    expect(r.body.status).toBe("approved");
  });

  it("rejects an unknown decision", async () => {
    const a = api(makeDb(() => ({ id: 5, capability: "B4", level: "L4" })), { questionsCode: "REV" });
    const r = await call(a, "/api/questions/5/review", {
      method: "POST",
      headers: { "x-questions-code": "REV" },
      body: JSON.stringify({ decision: "maybe" }),
    });
    expect(r.status).toBe(400);
  });
});

describe("measurement is a separate, gated door", () => {
  it("refuses ingestion without the harness code", async () => {
    const a = api(makeDb(), { harnessCode: "HARN" });
    const r = await call(a, "/api/runs", { method: "POST", body: JSON.stringify({ run: { run_id: "r1" }, results: [{ question_id: 1 }] }) });
    expect(r.status).toBe(401);
  });

  it("refuses ingestion with the reviewer code but not the harness code", async () => {
    const a = api(makeDb(), { questionsCode: "REV", harnessCode: "HARN" });
    const r = await call(a, "/api/runs", {
      method: "POST",
      headers: { "x-questions-code": "REV" },
      body: JSON.stringify({ run: { run_id: "r1" }, results: [{ question_id: 1 }] }),
    });
    expect(r.status).toBe(401);
  });

  it("accepts ingestion with the harness code", async () => {
    const a = api(makeDb(), { harnessCode: "HARN" });
    const r = await call(a, "/api/runs", {
      method: "POST",
      headers: { "x-harness-code": "HARN" },
      body: JSON.stringify({
        run: { run_id: "r1", model: "m", temperature: 0 },
        results: [{ question_id: 1, model: "m", verdict: "correct", parse_ok: 1 }],
      }),
    });
    expect(r.status).toBe(200);
    expect(r.body.run_id).toBe("r1");
    expect(r.body.n_results).toBe(1);
  });

  it("refuses an ingestion with no run id", async () => {
    const a = api(makeDb(), { harnessCode: "HARN" });
    const r = await call(a, "/api/runs", {
      method: "POST",
      headers: { "x-harness-code": "HARN" },
      body: JSON.stringify({ results: [{ question_id: 1 }] }),
    });
    expect(r.status).toBe(400);
  });
});

describe("the list endpoint composes filters", () => {
  it("builds a WHERE clause from the filters it is given", async () => {
    const db = makeDb();
    await call(api(db), "/api/questions?status=draft&review_status=pending&capability=B4&limit=10");
    const sql = db.seen.join(" | ");
    expect(sql).toContain("status = ?");
    expect(sql).toContain("review_status = ?");
    expect(sql).toContain("capability = ?");
    expect(sql).toContain("WHERE");
    expect(sql).toContain("LIMIT");
  });

  it("filters by contributor, which is how an author sees their own items", async () => {
    const db = makeDb();
    await call(api(db), "/api/questions?contributor=Ali&status=draft");
    expect(db.seen.join(" ")).toContain("contributor = ?");
  });

  it("still lists everything when given no filters", async () => {
    const db = makeDb();
    const r = await call(api(db), "/api/questions");
    expect(r.status).toBe(200);
    expect(db.seen.join(" ")).not.toContain("WHERE");
  });

  it("caps the limit so a client cannot ask for the whole table", async () => {
    const db = makeDb();
    await call(api(db), "/api/questions?limit=99999");
    // the cap is applied before binding; the query must still be bounded
    expect(db.seen.join(" ")).toContain("LIMIT");
  });
});

describe("the blind filter result", () => {
  it("refuses to record a blind result without the harness code", async () => {
    // A blind result is a measurement, not an opinion. If the open door could set
    // it, anyone could mark their own item clean.
    const r = await call(api(makeDb(), { harnessCode: "HARN" }), "/api/blind", {
      method: "POST",
      body: JSON.stringify({ results: [{ question_id: 1, correct: 1 }] }),
    });
    expect(r.status).toBe(401);
  });

  it("records a blind result per item and reports how many leaked", async () => {
    const db = makeDb();
    const r = await call(api(db, { harnessCode: "HARN" }), "/api/blind", {
      method: "POST",
      headers: { "x-harness-code": "HARN" },
      body: JSON.stringify({ results: [{ question_id: 1, correct: 1 }, { question_id: 2, correct: 0 }] }),
    });
    expect(r.status).toBe(200);
    expect(r.body.n).toBe(2);
    expect(r.body.blind_passed).toBe(1);
    expect(db.seen.join(" ")).toContain("blind_passed");
  });

  it("does NOT bump rev, so ingesting cannot invalidate an author mid-edit", async () => {
    const db = makeDb();
    await call(api(db, { harnessCode: "HARN" }), "/api/blind", {
      method: "POST",
      headers: { "x-harness-code": "HARN" },
      body: JSON.stringify({ results: [{ question_id: 1, correct: 1 }] }),
    });
    const update = db.seen.filter((x) => x.includes("blind_passed")).join(" ");
    expect(update).not.toContain("rev = rev + 1");
  });

  it("refuses an empty result set", async () => {
    const r = await call(api(makeDb(), { harnessCode: "HARN" }), "/api/blind", {
      method: "POST",
      headers: { "x-harness-code": "HARN" },
      body: JSON.stringify({ results: [] }),
    });
    expect(r.status).toBe(400);
  });
});

describe("the Python harness can actually ingest", () => {
  it("accepts the exact payload scripts/harness/ingest.py sends", async () => {
    // Shape copied from scripts/harness/ingest.py -> post(). This is the seam
    // between the Python harness and this endpoint; if either drifts, results
    // silently fail to land, so it is asserted rather than assumed.
    const payload = {
      run: {
        run_id: "qwen3_8-27b-ab12cd34",
        model: "Qwen/Qwen3.8-27B",
        prompt_arm: "mcq_v1",
        temperature: 0,
        groundtruth_hash: "a".repeat(64),
        recipe_hash: "b".repeat(64),
        n: 1,
        accuracy: 1,
        abstention_rate: 0,
        parse_fail_rate: 0,
        error_rate: 0,
      },
      results: [
        {
          run_id: "qwen3_8-27b-ab12cd34",
          question_id: 42,
          file_id: "img_1",
          model: "Qwen/Qwen3.8-27B",
          prompt_id: "mcq_v1",
          temperature: 0,
          groundtruth_hash: "a".repeat(64),
          recipe_hash: "b".repeat(64),
          image_sha256: "c".repeat(64),
          response: "A",
          verdict: "correct",
          parse_ok: 1,
          abstained: 0,
          latency_ms: 812,
          error: "",
        },
      ],
    };
    const a = api(makeDb(), { harnessCode: "HARN" });
    const r = await call(a, "/api/runs", {
      method: "POST",
      headers: { "x-harness-code": "HARN" },
      body: JSON.stringify(payload),
    });
    expect(r.status).toBe(200);
    expect(r.body.n_results).toBe(1);
    expect(r.body.run_id).toBe("qwen3_8-27b-ab12cd34");
  });
});

describe("open reads and sync", () => {
  it("serves the change cursor to anyone", async () => {
    const a = api(makeDb(() => ({ seq: 42 })));
    const r = await call(a, "/api/changes/cursor");
    expect(r.status).toBe(200);
    expect(r.body.seq).toBe(42);
  });

  it("reads the cursor from an aggregate, never a table scan", async () => {
    const db = makeDb(() => ({ seq: 1 }));
    await call(api(db), "/api/changes/cursor");
    expect(db.seen.some((s) => s.includes("MAX(seq)"))).toBe(true);
  });

  it("returns NOTHING when the cursor has not moved — an idle tab costs one row", async () => {
    // This is the property the whole sync design rests on: a poll that finds no
    // change must return empty and leave the cursor where it was.
    const a = api(makeDb());
    const r = await call(a, "/api/changes?since=42");
    expect(r.status).toBe(200);
    expect(r.body.cursor).toBe(42);
    expect(r.body.questions).toEqual([]);
    expect(r.body.n_changes).toBe(0);
  });

  it("needs no code, because reading is on the open door", async () => {
    const a = api(makeDb(), { questionsCode: "REV", harnessCode: "HARN" });
    expect((await call(a, "/api/changes?since=0")).status).toBe(200);
    expect((await call(a, "/api/changes/cursor")).status).toBe(200);
  });

  it("returns a delta for a since value", async () => {
    const a = api(makeDb());
    const r = await call(a, "/api/changes?since=0");
    expect(r.status).toBe(200);
    expect(r.body.cursor).toBe(0);
  });
});

describe("optimistic concurrency", () => {
  it("refuses a stale write and returns the current row", async () => {
    const a = api(makeDb(() => ({ id: 3, rev: 5, question: "theirs" })));
    const r = await call(a, "/api/questions/3", {
      method: "PATCH",
      headers: { "if-match": "4" },
      body: JSON.stringify({ question: "mine" }),
    });
    expect(r.status).toBe(409);
    expect(r.body.expected_rev).toBe(5);
    expect(r.body.current.question).toBe("theirs");
  });

  it("applies a write when the revision matches", async () => {
    const a = api(makeDb(() => ({ id: 3, rev: 5 })));
    const r = await call(a, "/api/questions/3", {
      method: "PATCH",
      headers: { "if-match": "5" },
      body: JSON.stringify({ question: "mine" }),
    });
    expect(r.status).toBe(200);
    expect(r.body.rev).toBe(6);
  });

  it("refuses a patch that changes nothing", async () => {
    const a = api(makeDb(() => ({ id: 3, rev: 1 })));
    const r = await call(a, "/api/questions/3", {
      method: "PATCH",
      headers: { "if-match": "1" },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(400);
  });

  it("REQUIRES If-Match, rather than overwriting blindly", async () => {
    // It used to be optional, so omitting the header meant "overwrite whatever is
    // there" and the protection was opt-in. The failure mode was the silent loss of
    // someone else's edit, which is the one thing this exists to prevent.
    const a = api(makeDb(() => ({ id: 3, rev: 7 })));
    const r = await call(a, "/api/questions/3", {
      method: "PATCH",
      body: JSON.stringify({ question: "changed" }),
    });
    expect(r.status).toBe(428);
    expect(String(r.body.error)).toMatch(/If-Match/);
    expect(r.body.expected_rev).toBe(7);
  });

  it("is ATOMIC: a writer who lost the race is refused, not silently applied", async () => {
    // Two writers both read revision 1 and both pass the JavaScript comparison. The
    // UPDATE must carry the revision in its WHERE clause, or the second silently
    // overwrites the first — a check-then-act race that optimistic concurrency exists
    // to close. Here the database reports that zero rows changed, as it would for the
    // loser of that race.
    const db = makeDb(() => ({ id: 3, rev: 1 }), undefined, () => 0);
    const r = await call(api(db), "/api/questions/3", {
      method: "PATCH",
      headers: { "if-match": "1" },
      body: JSON.stringify({ question: "changed" }),
    });
    expect(r.status).toBe(409);
    expect(String(r.body.error)).toBe("conflict");
    expect(db.seen.some((q) => q.includes("AND rev ="))).toBe(true);
  });

  it("wins the race when the row is still at that revision", async () => {
    const db = makeDb(() => ({ id: 3, rev: 1 }), undefined, () => 1);
    const r = await call(api(db), "/api/questions/3", {
      method: "PATCH",
      headers: { "if-match": "1" },
      body: JSON.stringify({ question: "changed" }),
    });
    expect(r.status).toBe(200);
    expect(r.body.rev).toBe(2);
  });
});

describe("deleting an item", () => {
  it("lets anyone delete their own DRAFT", async () => {
    const db = makeDb(() => ({ status: "draft", tags: "" }));
    const r = await call(api(db, { questionsCode: "REV" }), "/api/questions?id=3", { method: "DELETE" });
    expect(r.status).toBe(200);
  });

  it("requires the reviewer code to delete an APPROVED item, because that removes ground truth", async () => {
    const db = makeDb(() => ({ status: "approved", tags: "" }));
    const denied = await call(api(db, { questionsCode: "REV" }), "/api/questions?id=3", { method: "DELETE" });
    expect(denied.status).toBe(401);
    const allowed = await call(api(db, { questionsCode: "REV" }), "/api/questions?id=3", {
      method: "DELETE",
      headers: { "x-questions-code": "REV" },
    });
    expect(allowed.status).toBe(200);
  });
});

describe("the error-analysis axis is actually stored", () => {
  it("writes family, relevance and unanswerable_reason on create", async () => {
    // Before this, the form collected all three and the API discarded them: C2.3 and
    // C2.9 could never pass, and an author's stated reason for an unanswerable item
    // was silently thrown away.
    const db = makeDb();
    const r = await call(api(db), "/api/questions", {
      method: "POST",
      body: JSON.stringify({
        ...DRAFT_ITEM,
        family: "spatial",
        relevance: "visual_false_premise",
        unanswerable_reason: "absent_entity",
      }),
    });
    expect(r.status).toBe(200);
    const sql = db.seen.join(" ");
    expect(sql).toContain("family");
    expect(sql).toContain("relevance");
    expect(sql).toContain("unanswerable_reason");
  });

  it("defaults relevance when the client omits it", async () => {
    const db = makeDb();
    const r = await call(api(db), "/api/questions", { method: "POST", body: JSON.stringify(DRAFT_ITEM) });
    expect(r.status).toBe(200);
  });

  it("refuses an unanswerable item with no stated reason", async () => {
    const r = await call(api(makeDb()), "/api/questions", {
      method: "POST",
      body: JSON.stringify({ ...DRAFT_ITEM, relevance: "non_visual", unanswerable_reason: "" }),
    });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/not answerable/);
  });

  it("accepts an unanswerable item once the reason is given", async () => {
    const r = await call(api(makeDb()), "/api/questions", {
      method: "POST",
      body: JSON.stringify({ ...DRAFT_ITEM, relevance: "non_visual", unanswerable_reason: "requires_world_knowledge" }),
    });
    expect(r.status).toBe(200);
  });

  it("allows the axis to be corrected later", async () => {
    const db = makeDb(() => ({ id: 3, rev: 1 }));
    const r = await call(api(db), "/api/questions/3", {
      method: "PATCH",
      headers: { "if-match": "1" },
      body: JSON.stringify({ family: "counting", relevance: "visual_true_premise" }),
    });
    expect(r.status).toBe(200);
    expect(db.seen.join(" ")).toContain("family");
  });
});

describe("the second opinion", () => {
  it("refuses without the reviewer code", async () => {
    const r = await call(api(makeDb(), { questionsCode: "REV" }), "/api/questions/3/second", {
      method: "POST",
      body: JSON.stringify({ answer: "B" }),
    });
    expect(r.status).toBe(401);
  });

  it("records a second answer and a stable id, never an email", async () => {
    const db = makeDb(() => ({ id: 3 }));
    const r = await call(api(db, { questionsCode: "REV" }), "/api/questions/3/second", {
      method: "POST",
      headers: { "x-questions-code": "REV", "x-actor": "actor-9", "x-actor-name": "Sam" },
      body: JSON.stringify({ answer: "B" }),
    });
    expect(r.status).toBe(200);
    expect(r.body.annotator_2).toBe("B");
    const sql = db.seen.join(" ");
    expect(sql).toContain("annotator_2");
    expect(sql).toContain("annotator_2_id");
  });

  it("refuses an empty second answer", async () => {
    const r = await call(api(makeDb(() => ({ id: 3 })), { questionsCode: "REV" }), "/api/questions/3/second", {
      method: "POST",
      headers: { "x-questions-code": "REV" },
      body: JSON.stringify({ answer: "   " }),
    });
    expect(r.status).toBe(400);
  });

  it("404s an unknown item", async () => {
    const r = await call(api(makeDb(() => null), { questionsCode: "REV" }), "/api/questions/3/second", {
      method: "POST",
      headers: { "x-questions-code": "REV" },
      body: JSON.stringify({ answer: "B" }),
    });
    expect(r.status).toBe(404);
  });
});

describe("revision history and restore", () => {
  it("lists revisions and parses each patch", async () => {
    const a = api(makeDb());
    const r = await call(a, "/api/questions/3/revisions");
    expect(r.status).toBe(200);
    expect(r.body.question_id).toBe(3);
    expect(Array.isArray(r.body.revisions)).toBe(true);
  });

  it("refuses a restore with no rev_id", async () => {
    const a = api(makeDb());
    const r = await call(a, "/api/questions/3/restore", { method: "POST", body: JSON.stringify({}) });
    expect(r.status).toBe(400);
  });

  it("lets anyone restore a DRAFT — that is an author undoing their own work", async () => {
    const db = makeDb((sql) =>
      sql.includes("SELECT id, status FROM questions")
        ? { id: 3, status: "draft" }
        : { patch: JSON.stringify({ question: "older text", answer: "B" }) },
    );
    const r = await call(api(db), "/api/questions/3/restore", {
      method: "POST",
      body: JSON.stringify({ rev_id: 7 }),
    });
    expect(r.status).toBe(200);
    expect(r.body.restored_from).toBe(7);
    const sql = db.seen.join(" ");
    expect(sql).toContain("UPDATE questions SET");
    expect(sql).toContain("rev = rev + 1");
  });

  it("requires the reviewer code to restore an APPROVED item, because that rewrites ground truth", async () => {
    const db = makeDb((sql) =>
      sql.includes("SELECT id, status FROM questions")
        ? { id: 3, status: "approved" }
        : { patch: JSON.stringify({ answer: "B" }) },
    );
    const out = await call(api(db, { questionsCode: "REV" }), "/api/questions/3/restore", {
      method: "POST",
      body: JSON.stringify({ rev_id: 7 }),
    });
    expect(out.status).toBe(401);
    const ok = await call(api(db, { questionsCode: "REV" }), "/api/questions/3/restore", {
      method: "POST",
      headers: { "x-questions-code": "REV" },
      body: JSON.stringify({ rev_id: 7 }),
    });
    expect(ok.status).toBe(200);
  });

  it("refuses a revision with nothing restorable", async () => {
    const db = makeDb((sql) =>
      sql.includes("SELECT id, status FROM questions")
        ? { id: 3, status: "draft" }
        : { patch: JSON.stringify({ something_else: 1 }) },
    );
    const r = await call(api(db), "/api/questions/3/restore", {
      method: "POST",
      body: JSON.stringify({ rev_id: 7 }),
    });
    expect(r.status).toBe(400);
  });

  it("404s an unknown revision", async () => {
    const db = makeDb((sql) => (sql.includes("SELECT id, status FROM questions") ? { id: 3, status: "draft" } : null));
    const r = await call(api(db), "/api/questions/3/restore", {
      method: "POST",
      body: JSON.stringify({ rev_id: 999 }),
    });
    expect(r.status).toBe(404);
  });

  it("never writes a column outside the restorable whitelist", async () => {
    // The patch is data from the past; it must not be able to set arbitrary columns.
    const db = makeDb((sql) =>
      sql.includes("SELECT id, status FROM questions")
        ? { id: 3, status: "draft" }
        : { patch: JSON.stringify({ answer: "B", status: "approved", rev: 9999, actor_id: "hacker" }) },
    );
    await call(api(db), "/api/questions/3/restore", { method: "POST", body: JSON.stringify({ rev_id: 7 }) });
    const update = db.seen.filter((x) => x.includes("UPDATE questions SET")).join(" ");
    expect(update).toContain("answer = ?");
    expect(update).not.toContain("status = ?");
    expect(update).not.toContain("actor_id = ?");
  });
});

describe("selections", () => {
  it("requires a reason to exclude an image", async () => {
    const a = api(makeDb());
    const r = await call(a, "/api/selections", {
      method: "POST",
      body: JSON.stringify({ file_id: "img_9", state: "excluded" }),
    });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/reason/);
  });

  it("accepts an exclusion with a reason", async () => {
    const a = api(makeDb());
    const r = await call(a, "/api/selections", {
      method: "POST",
      body: JSON.stringify({ file_id: "img_9", state: "excluded", reason: "private moment" }),
    });
    expect(r.status).toBe(200);
    expect(r.body.state).toBe("excluded");
  });

  it("a machine proposal cannot overwrite a human decision", async () => {
    // The guard lives in the SQL (WHERE selections.state = 'proposed'), so it is
    // atomic: re-running the seeder cannot undo a morning of triage.
    const db = makeDb();
    await call(api(db), "/api/selections", {
      method: "POST",
      body: JSON.stringify({ file_id: "img_1", state: "proposed", stratum: "1-4 MP" }),
    });
    const sql = db.seen.join(" ");
    expect(sql).toContain("WHERE selections.state = 'proposed'");
  });

  it("a human decision is written unconditionally, so a person can change their mind", async () => {
    const db = makeDb();
    await call(api(db), "/api/selections", {
      method: "POST",
      body: JSON.stringify({ file_id: "img_1", state: "chosen" }),
    });
    expect(db.seen.join(" ")).not.toContain("WHERE selections.state");
  });

  it("undo deletes the row, because undecided is the absence of one", async () => {
    const db = makeDb();
    const r = await call(api(db), "/api/selections?file_id=img_9", { method: "DELETE" });
    expect(r.status).toBe(200);
    expect(r.body.state).toBeNull();
    expect(db.seen.join(" ")).toContain("DELETE FROM selections");
  });

  it("undo requires a file_id", async () => {
    const r = await call(api(makeDb()), "/api/selections", { method: "DELETE" });
    expect(r.status).toBe(400);
  });

  it("rejects an unknown selection state", async () => {
    const a = api(makeDb());
    const r = await call(a, "/api/selections", { method: "POST", body: JSON.stringify({ file_id: "x", state: "maybe" }) });
    expect(r.status).toBe(400);
  });
});

describe("nomination votes: two distinct votes promote, retraction reverses", () => {
  const selRow = (state: string, actorId = "nominator-id", promotedBy: string | null = null) => (sql: string) => {
    if (sql.includes("FROM selections WHERE file_id")) {
      return { file_id: "img_1", state, actor_id: actorId, promoted_by: promotedBy };
    }
    if (sql.includes("COUNT(*) AS n FROM selection_votes")) return { n: 1 };
    return null;
  };

  it("refuses a vote with no identity", async () => {
    const r = await call(api(makeDb()), "/api/selections/votes", {
      method: "POST",
      body: JSON.stringify({ file_id: "img_1" }),
    });
    expect(r.status).toBe(400);
  });

  it("the nominator cannot vote for their own nomination", async () => {
    const a = api(makeDb(selRow("nominated")));
    const r = await call(a, "/api/selections/votes", {
      method: "POST",
      headers: { "x-actor": "nominator-id", "x-actor-name": "Bilal" },
      body: JSON.stringify({ file_id: "img_1" }),
    });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/nominator/);
  });

  it("records the vote against the server-forwarded actor", async () => {
    const db = makeDb(selRow("nominated"));
    const r = await call(api(db), "/api/selections/votes", {
      method: "POST",
      headers: { "x-actor": "voter-1", "x-actor-name": "Ana" },
      body: JSON.stringify({ file_id: "img_1" }),
    });
    expect(r.status).toBe(200);
    expect(r.body.votes).toBe(1);
    expect(db.binds.some((b) => b.sql.includes("INSERT INTO selection_votes") && b.args[1] === "voter-1")).toBe(true);
  });

  it("ONE vote is not enough — the image stays nominated", async () => {
    const db = makeDb(selRow("nominated"));
    const r = await call(api(db), "/api/selections/votes", {
      method: "POST",
      headers: { "x-actor": "voter-1", "x-actor-name": "Ana" },
      body: JSON.stringify({ file_id: "img_1" }),
    });
    expect(r.body.state).toBe("nominated");
    expect(db.seen.join(" ")).not.toContain("promoted_by = 'votes'");
  });

  it("TWO votes promote the nomination to chosen, and record WHY", async () => {
    const db = makeDb((sql) => {
      if (sql.includes("FROM selections WHERE file_id")) {
        return { file_id: "img_1", state: "nominated", actor_id: "nominator-id", promoted_by: null };
      }
      if (sql.includes("COUNT(*) AS n FROM selection_votes")) return { n: 2 };
      return null;
    });
    const r = await call(api(db), "/api/selections/votes", {
      method: "POST",
      headers: { "x-actor": "voter-2", "x-actor-name": "Sara" },
      body: JSON.stringify({ file_id: "img_1" }),
    });
    expect(r.status).toBe(200);
    expect(r.body.state).toBe("chosen");
    expect(db.seen.join(" ")).toContain("promoted_by = 'votes'");
  });

  it("a vote on a non-votable state is refused", async () => {
    const a = api(makeDb(selRow("excluded", "someone")));
    const r = await call(a, "/api/selections/votes", {
      method: "POST",
      headers: { "x-actor": "voter-1" },
      body: JSON.stringify({ file_id: "img_1" }),
    });
    expect(r.status).toBe(409);
  });

  it("retracting below two undoes a vote-promotion", async () => {
    const db = makeDb((sql) => {
      if (sql.includes("COUNT(*) AS n FROM selection_votes")) return { n: 1 };
      if (sql.includes("SELECT state, promoted_by")) return { state: "chosen", promoted_by: "votes" };
      return null;
    });
    const r = await call(api(db), "/api/selections/votes?file_id=img_1", {
      method: "DELETE",
      headers: { "x-actor": "voter-1", "x-actor-name": "Ana" },
    });
    expect(r.status).toBe(200);
    expect(r.body.state).toBe("nominated");
    expect(db.seen.join(" ")).toContain("state = 'nominated', promoted_by = NULL");
  });

  it("retracting NEVER demotes a human's own pick", async () => {
    const db = makeDb((sql) => {
      if (sql.includes("COUNT(*) AS n FROM selection_votes")) return { n: 0 };
      if (sql.includes("SELECT state, promoted_by")) return { state: "chosen", promoted_by: null };
      return null;
    });
    const r = await call(api(db), "/api/selections/votes?file_id=img_1", {
      method: "DELETE",
      headers: { "x-actor": "voter-1" },
    });
    expect(r.body.state).toBe("chosen");
    expect(db.seen.join(" ")).not.toContain("state = 'nominated'");
  });

  it("serves the vote ledger", async () => {
    const db = makeDb(undefined, (sql) =>
      sql.includes("FROM selection_votes")
        ? [{ file_id: "img_1", actor_id: "voter-1", actor_name: "Ana", created_at: "2026-10-16 12:00:00" }]
        : [],
    );
    const r = await call(api(db), "/api/selections/votes");
    expect(r.status).toBe(200);
    expect((r.body.votes as unknown[]).length).toBe(1);
    expect(r.body.threshold).toBe(2);
  });
});

describe("the Python seeder can actually propose", () => {
  it("accepts the exact payload scripts/factory/00b_seed_selections.py sends", async () => {
    // Shape copied from the seeder. This is the seam between the stratified
    // proposer and the selection store; if either drifts, a shortlist silently
    // fails to seed and triage opens on the raw corpus.
    const payload = {
      file_id: "1eeqkIdVgOAnXaRKdfTzXAj0EFPP_Eizg",
      state: "proposed",
      stratum: "4-12 MP",
    };
    const a = api(makeDb());
    const r = await call(a, "/api/selections", { method: "POST", body: JSON.stringify(payload) });
    expect(r.status).toBe(200);
    expect(r.body.state).toBe("proposed");
    expect(r.body.file_id).toBe(payload.file_id);
  });
});

describe("the Python candidate importer can actually land items", () => {
  it("accepts the exact payload scripts/factory/05_import_candidates.py sends", async () => {
    // Shape copied from the importer's to_payload(). This is the last seam in the
    // pipeline: if it drifts, generated candidates never reach a human and the
    // generator's output is silently discarded.
    const payload = {
      file_id: "img_C",
      contributor: "gen",
      question: "Which is closer to the camera?",
      answer_type: "choice",
      answer: "A",
      choices: JSON.stringify(["The forklift", "The SUV"]),
      difficulty: "medium",
      tags: "spatial, depth",
      capability: "G1",
      level: "L2",
      pair_id: "",
      pair_role: "",
      tolerance: null,
      generator: "gen-model",
      verifier: "ver-model",
      family: "spatial",
      relevance: "visual_true_premise",
      unanswerable_reason: "",
    };
    const db = makeDb();
    const r = await call(api(db), "/api/questions", { method: "POST", body: JSON.stringify(payload) });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("draft");
    const sql = db.seen.join(" ");
    for (const col of ["capability", "level", "pair_id", "generator", "verifier", "family", "relevance"]) {
      expect(sql).toContain(col);
    }
  });

  it("accepts a paired bridge item carrying its shared pair_id", async () => {
    const payload = {
      file_id: "img_A",
      question: "Would the forklift pass under?",
      answer_type: "choice",
      answer: "Yes",
      choices: JSON.stringify(["Yes", "No"]),
      difficulty: "medium",
      tags: "spatial",
      capability: "B4",
      level: "L4",
      pair_id: "pair_558563f367d8",
      pair_role: "physics",
      relevance: "visual_true_premise",
    };
    const r = await call(api(makeDb()), "/api/questions", { method: "POST", body: JSON.stringify(payload) });
    expect(r.status).toBe(200);
  });

  it("a re-import is a no-op, not an error", async () => {
    // The API returns 409 on UNIQUE(file_id, qnorm), which the importer counts as
    // ALREADY THERE. A correct no-op must never look like a failure.
    const base = makeDb() as unknown as Record<string, unknown>;
    const db = {
      ...base,
      batch: async () => {
        throw new Error("UNIQUE constraint failed: questions.file_id, questions.qnorm");
      },
    } as unknown as D1Database;
    const r = await call(api(db), "/api/questions", {
      method: "POST",
      body: JSON.stringify({ file_id: "f", question: "q", answer_type: "text" }),
    });
    expect(r.status).toBe(409);
    expect(String(r.body.error)).toMatch(/duplicate/);
  });
});

describe("a batched trace stores the RUN size, not the batch size", () => {
  it("uses run.n_items when the client supplies it", async () => {
    // A 500-item trace arrives as several batches and this row is upserted per batch.
    // Binding the batch length made the stored n_items equal whichever batch landed
    // last — 100 for a 500-item run — so the published size was simply wrong.
    const db = makeDb();
    const r = await call(api(db, { harnessCode: "HARN" }), "/api/runs", {
      method: "POST",
      headers: { "x-harness-code": "HARN" },
      body: JSON.stringify({
        run: { run_id: "r1", model: "m", n_items: 500 },
        results: [{ question_id: 1, verdict: "correct" }, { question_id: 2, verdict: "wrong" }],
      }),
    });
    expect(r.status).toBe(200);
    const runInsert = db.binds.find((b) => b.sql.includes("INSERT INTO runs"));
    expect(runInsert).toBeDefined();
    expect(runInsert!.args).toContain(500);
    expect(runInsert!.args).not.toContain(2);
  });

  it("falls back to the batch length when the client omits it", async () => {
    const db = makeDb();
    await call(api(db, { harnessCode: "HARN" }), "/api/runs", {
      method: "POST",
      headers: { "x-harness-code": "HARN" },
      body: JSON.stringify({
        run: { run_id: "r2", model: "m" },
        results: [{ question_id: 1 }, { question_id: 2 }, { question_id: 3 }],
      }),
    });
    const runInsert = db.binds.find((b) => b.sql.includes("INSERT INTO runs"));
    expect(runInsert!.args).toContain(3);
  });
});

describe("an errored run row is stored, but is not a wrong answer", () => {
  it("keeps the error text and does not store a verdict", async () => {
    // run.py sets verdict 'wrong' when a call fails, and there was nowhere to record the
    // error — so a rate-limited request was stored as a wrong answer and the site's
    // accuracy fell every time the API wobbled.
    const db = makeDb();
    const r = await call(api(db, { harnessCode: "HARN" }), "/api/runs", {
      method: "POST",
      headers: { "x-harness-code": "HARN" },
      body: JSON.stringify({
        run: { run_id: "r1", model: "m", n_items: 1 },
        results: [{ question_id: 7, verdict: null, error: "HTTPError: 429", n_samples: 3, unstable: 1 }],
      }),
    });
    expect(r.status).toBe(200);
    const ins = db.binds.find((b) => b.sql.includes("INSERT INTO evaluations"));
    expect(ins).toBeDefined();
    expect(ins!.args).toContain("HTTPError: 429");
    expect(ins!.args).toContain(3);
    expect(ins!.args).toContain(1);
  });

  it("groups the leaderboard by RUN, so a ladder is not averaged into one number", async () => {
    // The board grouped by model alone. run_attack writes 21 conditions, so a model's
    // corruption ladder would collapse into ONE accuracy on the page while the slope — the
    // result the roadmap asks for — sat invisible in the trace. Same defect as collapse() and
    // the pre-v5e evaluations key, at the layer a reader actually sees.
    const db = makeDb(() => ({ n: 0 }), () => []);
    await call(api(db, {}), "/api/insights", { method: "GET" });
    //
    // AND IT MUST NOT SCAN. The board aggregated \`evaluations\` directly: for a realistic campaign
    // (29 runs x 6 models x 2,500 items = 435,000 evaluations) EXPLAIN QUERY PLAN said
    // "SCAN evaluations USING INDEX idx_ev_model", reading ~445,000 rows per PAGE LOAD against a
    // D1 free allowance of 5,000,000 rows read per DAY — about 11 page loads before the database
    // refuses everyone until midnight UTC. A free-tier overrun, in a project whose whole premise
    // is that nothing but model inference costs money.
    const q = db.binds.map((b) => b.sql).find((s) => s.includes("FROM run_summary"));
    expect(q).toBeDefined();
    expect(q).toContain("run_id");
    expect(q).toContain("FROM run_summary");
    // THE COST PROPERTY, asserted directly: the endpoint never reads the evaluations table.
    expect(db.binds.some((b) => b.sql.includes("FROM evaluations"))).toBe(false);
  });

  it("selects one condition when ?run_id= is given, and echoes which", async () => {
    const db = makeDb(() => ({ n: 0 }), () => []);
    const r = await call(api(db, {}), "/api/insights?run_id=atk-blur-s3", { method: "GET" });
    expect(r.status).toBe(200);
    expect((r.body as { run_id?: string | null }).run_id).toBe("atk-blur-s3");
    const q = db.binds.find((b) => b.sql.includes("FROM run_summary"));
    // the filter is BOUND, never interpolated — a run id is caller-supplied text
    expect(q!.args).toContain("atk-blur-s3");
    expect(q!.sql).toContain("?1 IS NULL OR run_id = ?1");
  });

  it("FAILS CLOSED when the secret is unset — the rule all three doors depend on", () => {
    // THIS HAD NO TEST. `hasCode` is the function that decides whether a privileged door opens,
    // and its documented rule is: an unset secret DISABLES the door; it never opens it.
    //
    // Round 88 found a THIRD door (`/api/chat`) that failed OPEN, unnoticed because it is not a
    // questions door. So the property is now asserted directly rather than assumed from the two
    // callers being correct.
    expect(hasCode(null, undefined)).toBe(false);        // no secret configured
    expect(hasCode("anything", undefined)).toBe(false);  // a caller cannot open an unconfigured door
    expect(hasCode(null, "")).toBe(false);               // an empty secret is not a secret
    expect(hasCode("", "s3cret")).toBe(false);           // a missing header is not the secret
    expect(hasCode("s3cret", "s3cret")).toBe(true);      // and the real one opens it
    expect(hasCode("wrong", "s3cret")).toBe(false);
  });

  it("the questions door is closed when QUESTIONS_CODE is unset", async () => {
    // The END-TO-END statement of the same rule, through the API rather than the helper.
    const db = makeDb(() => ({ n: 0 }), () => []);
    const r = await call(api(db, {}), "/api/questions/1/review", {
      method: "POST",
      headers: { "x-questions-code": "guess" },
      body: JSON.stringify({ decision: "accept" }),
    });
    expect(r.status).toBe(401);
  });

  it("keys an evaluation by its RUN, so a ladder's conditions do not overwrite each other", async () => {
    // `evaluations` was UNIQUE(question_id, model). `run_crop` writes 6 conditions and
    // `run_attack` writes 21 into ONE trace, so posting a series had each condition overwrite
    // the previous one on (question_id, model): the site kept only the last and showed 8 items
    // while the trace held 168. The same defect as the v5d repeat-collapse, and just as silent.
    //
    // Asserted on the SQL because that is where the identity lives: the bindings are identical
    // for two conditions of one question, so only the conflict target distinguishes them.
    const db = makeDb();
    const r = await call(api(db, { harnessCode: "HARN" }), "/api/runs", {
      method: "POST",
      headers: { "x-harness-code": "HARN" },
      body: JSON.stringify({
        run: { run_id: "atk-blur-s1", model: "m", n_items: 1 },
        results: [{ question_id: 7, verdict: "correct", run_id: "atk-blur-s1" }],
      }),
    });
    expect(r.status).toBe(200);
    const ins = db.binds.find((b) => b.sql.includes("INSERT INTO evaluations"));
    expect(ins).toBeDefined();
    expect(ins!.sql).toContain("ON CONFLICT(question_id, model, run_id)");
    expect(ins!.sql).not.toContain("ON CONFLICT(question_id, model) DO");
    // and the run id actually travels with the row
    expect(ins!.args).toContain("atk-blur-s1");
  });

  it("reports a not_answered count so errors are visible, not folded into wrong", async () => {
    const db = makeDb(() => ({ n: 0 }), () => []);
    const r = await call(api(db), "/api/insights");
    expect(r.status).toBe(200);
    expect(db.seen.some((q) => q.includes("not_answered"))).toBe(true);
  });

  it("excludes errored rows from the per-tag breakdown", async () => {
    // The exclusion MOVED. byTag used to read every evaluation and filter with
    // `e.error IS NULL` at READ time; it now reads `tag_summary`, which applies that filter at
    // WRITE time when the summary is built. The property is the same — an item whose call
    // failed is missing data, not a model failure — so this asserts it where it now lives,
    // rather than asserting a clause that no longer exists on the read path.
    const read = makeDb(() => ({ n: 0 }), () => []);
    await call(api(read), "/api/insights");
    expect(read.seen.some((q) => q.includes("FROM tag_summary"))).toBe(true);

    const write = makeDb();
    await call(api(write, { harnessCode: "HARN" }), "/api/runs", {
      method: "POST",
      headers: { "x-harness-code": "HARN" },
      body: JSON.stringify({
        // `final` is required for the summary to be rebuilt at all — see the cost test below.
        run: { run_id: "r1", model: "m", n_items: 1, final: true },
        results: [{ question_id: 7, verdict: "correct" }],
      }),
    });
    const tagStmt = write.binds.map((b) => b.sql).find((s) => s.includes("INTO tag_summary"));
    expect(tagStmt).toBeDefined();
    expect(tagStmt).toContain("e.error IS NULL");
  });

  it("rebuilds the summaries ONCE per run, not on every batch", async () => {
    // Round 69 added the recompute to every batch, so each one scanned the run's rows again.
    // Measured on a real campaign (29 runs x 6 models x 2,500 items, batch 200): 2,262 POSTs x
    // a growing scan = **6,298,800 rows read, 1.3x the 5,000,000/day allowance.** The fix for
    // the leaderboard's read scan had MOVED that cost into the ingest.
    //
    // The client declares its last batch, so a 13-batch run recomputes once.
    const post = async (final: boolean) => {
      const db = makeDb();
      await call(api(db, { harnessCode: "HARN" }), "/api/runs", {
        method: "POST",
        headers: { "x-harness-code": "HARN" },
        body: JSON.stringify({
          run: { run_id: "r1", model: "m", n_items: 2500, final },
          results: [{ question_id: 7, verdict: "correct" }],
        }),
      });
      return db.binds.filter((b) => b.sql.includes("INTO run_summary") || b.sql.includes("INTO tag_summary")).length;
    };
    expect(await post(false)).toBe(0);
    expect(await post(true)).toBe(2);   // run_summary + tag_summary, once each
  });
});

describe("the frozen selection snapshot", () => {
  it("returns the ids and a hash over them", async () => {
    // The chosen set is a live query: people change their minds over weeks. Without a frozen
    // snapshot the claim "the benchmark was built from these images" is unfalsifiable.
    const db = makeDb(() => null, () => [{ file_id: "b" }, { file_id: "a" }]);
    const r = await call(api(db), "/api/selections/snapshot");
    expect(r.status).toBe(200);
    expect(r.body.n).toBe(2);
    expect(r.body.file_ids).toEqual(["a", "b"]);
    expect(String(r.body.hash)).toHaveLength(64);
  });

  it("hashes the SORTED ids, so insertion order does not change it", async () => {
    const one = await call(api(makeDb(() => null, () => [{ file_id: "b" }, { file_id: "a" }])), "/api/selections/snapshot");
    const two = await call(api(makeDb(() => null, () => [{ file_id: "a" }, { file_id: "b" }])), "/api/selections/snapshot");
    expect(one.body.hash).toBe(two.body.hash);
  });

  it("gives a different hash for a different set", async () => {
    const one = await call(api(makeDb(() => null, () => [{ file_id: "a" }])), "/api/selections/snapshot");
    const two = await call(api(makeDb(() => null, () => [{ file_id: "a" }, { file_id: "b" }])), "/api/selections/snapshot");
    expect(one.body.hash).not.toBe(two.body.hash);
  });

  it("defaults to the chosen set and refuses an unknown state", async () => {
    const db = makeDb(() => null, () => []);
    const ok = await call(api(db), "/api/selections/snapshot");
    expect(ok.status).toBe(200);
    expect(ok.body.state).toBe("chosen");
    const bad = await call(api(makeDb()), "/api/selections/snapshot?state=maybe");
    expect(bad.status).toBe(400);
  });

  it("handles an empty set without erroring", async () => {
    const r = await call(api(makeDb(() => null, () => [])), "/api/selections/snapshot");
    expect(r.status).toBe(200);
    expect(r.body.n).toBe(0);
    expect(String(r.body.hash)).toHaveLength(64);
  });
});

describe("the paired diagnostic is reachable", () => {
  it("pivots the 2x2 per model and computes the headline rate", async () => {
    // v_pair_breakdown existed since v5 with no reader, so the benchmark's central
    // claim could not be displayed anywhere. This is its reader.
    const rows = [
      { model: "m1", cell: "understands", n: 6 },
      { model: "m1", cell: "physics_gap", n: 2 },
      { model: "m1", cell: "geometry_or_perception_gap", n: 1 },
      { model: "m1", cell: "guessing_from_priors", n: 1 },
    ];
    const db = makeDb(() => ({ n: 3 }), (sql) => (sql.includes("v_pair_breakdown") ? rows : []));
    const r = await call(api(db), "/api/insights/pairs");
    expect(r.status).toBe(200);
    expect(r.body.models).toHaveLength(1);
    const m = r.body.models[0];
    expect(m.model).toBe("m1");
    expect(m.pairs).toBe(10);
    expect(m.understands).toBe(6);
    expect(m.physics_gap).toBe(2);
    // of the 8 pairs where geometry was right, 2 got the physics wrong
    expect(m.physics_gap_rate).toBeCloseTo(0.25, 6);
    expect(r.body.unpaired_bridge).toBe(3);
  });

  it("reports a null rate rather than dividing by zero when there are no pairs", async () => {
    const db = makeDb(() => ({ n: 0 }), (sql) => (sql.includes("v_pair_breakdown") ? [{ model: "m", cell: "guessing_from_priors", n: 2 }] : []));
    const r = await call(api(db), "/api/insights/pairs");
    expect(r.body.models[0].physics_gap_rate).toBeNull();
  });

  it("survives an un-migrated database instead of 500ing", async () => {
    // The views are created by a migration. An older database must degrade to zero,
    // not break the page.
    const base = makeDb() as unknown as Record<string, unknown>;
    const db = {
      ...base,
      prepare: () => { throw new Error("no such table: v_pair_breakdown"); },
    } as unknown as D1Database;
    const r = await call(api(db), "/api/insights/pairs");
    expect(r.status).toBe(200);
    expect(r.body.models).toEqual([]);
  });

  it("exposes the release state by capability", async () => {
    const db = makeDb(() => ({ n: 12 }), (sql) => (sql.includes("v_release_items") ? [{ capability: "B4", n: 12 }] : []));
    const r = await call(api(db), "/api/insights/release");
    expect(r.status).toBe(200);
    expect(r.body.releasable_items).toBe(12);
  });
});

describe("dispatch", () => {
  it("returns null for paths this API does not own", async () => {
    const a = api(makeDb());
    const res = await a.handle(new Request("http://local/api/health"), new URL("http://local/api/health"));
    expect(res).toBeNull();
  });

  it("404s an unknown route under a prefix it owns", async () => {
    const a = api(makeDb());
    const r = await call(a, "/api/questions/abc/unknown");
    expect(r.status).toBe(404);
  });

  it("503s when the database binding is missing", async () => {
    const a = createQuestionsApi({ normQ: (q) => q, normTags: () => [] });
    const r = await call(a, "/api/changes/cursor");
    expect(r.status).toBe(503);
  });
});
