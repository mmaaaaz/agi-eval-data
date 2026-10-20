/**
 * Questions + evaluations API factory (D1-backed).
 *
 * Routes (all under /api/questions, /api/evaluations, /api/graphs):
 *   GET  /api/questions/counts              → { counts: {fileId: n}, images: n }
 *   GET  /api/questions/check?file_id&q     → { matches: [{id, question}] }
 *   GET  /api/questions?file_id=|search=&limit= → { questions: [...] }
 *   POST /api/questions                     → { id }            (409 on duplicate)
 *   DELETE /api/questions?id=               → { ok: true }
 *   GET  /api/questions/tags                → { tags: [[tag, count]] }
 *   GET  /api/questions/export.jsonl        → text/jsonl stream
 *   GET  /api/evaluations?question_id=|model=&limit= → { evaluations: [...] }
 *   POST /api/evaluations                   → { id }            (upsert on question+model)
 *   GET  /api/insights                      → { leaderboard: [...], byTag: [...] }
 *
 * Gate: an UNSET secret DISABLES the privileged door; it never opens it. This docstring
 * said "Unset = open (local dev only)" for as long as it existed, which the code has not
 * done since hasCode was written to fail closed. Round 89 found a THIRD door in the relay
 * (/api/chat) that actually DID fail open — so this line was describing the bug, not the
 * design, and it is the kind of stale claim this project guards against on its own site.
 *
 */
import type { D1Database, D1PreparedStatement, D1Result } from "@cloudflare/workers-types";

type PreparedStatement = D1PreparedStatement;

interface QuestionRow {
  id: number;
  file_id: string;
  contributor: string;
  question: string;
  qnorm: string;
  answer_type: string;
  answer: string | null;
  choices: string | null;
  difficulty: string;
  tags: string;
  status: string;
  created_at: string;
}

interface EvalRow {
  id: number;
  question_id: number;
  model: string;
  response: string;
  verdict: string | null;
  source: string;
  graded_by: string;
  created_at: string;
}

export interface QuestionsApiDeps {
  /** the D1 binding (optional — handle() 503s when missing) */
  db?: D1Database;
  /** reviewer secret: the only door allowed to approve ground truth (UNSET = the door is DISABLED; it never opens) */
  questionsCode?: string;
  /** harness secret: the only door allowed to write measurements (UNSET = the door is DISABLED; it never opens) */
  harnessCode?: string;
  normQ: (q: string) => string;
  normTags: (raw: string) => string[];
}

/** Canonical HTTP constants + helpers for the questions API — single source of CORS. */
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
    // EVERY HEADER THE CLIENT ACTUALLY SENDS, OR THE BROWSER REFUSES THE REQUEST.
    //
    // **THIS IS THE SECOND "SINGLE SOURCE OF CORS" IN THIS REPOSITORY.**
    // `apps/relay/src/http.ts` says the same thing about itself, and it was fixed first -
    // while the deployed preflight kept returning THIS list. Two files, each believing it is
    // the one, and the one that serves the API is this one.
    //
    // Found in round 152 from the owner's report that /choose showed
    // "NetworkError when attempting to fetch resource": `call()` attaches `x-actor` and
    // `x-actor-name` to every request, and neither was allowed.
    "Access-Control-Allow-Headers":
      "Content-Type, X-Access-Code, X-Questions-Code, X-Harness-Code, X-Actor, X-Actor-Name",
  "Access-Control-Max-Age": "86400",
};

export function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

/** Stable key material for rows that belong to an image rather than a candidate.
 *  Same image + batch always hashes to the same id, so approving, then editing and
 *  approving again updates one row instead of accumulating duplicates. */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * One API, two doors.
 *
 *   read / draft -> open. Anyone may read, and anyone may write a DRAFT.
 *   approve      -> x-questions-code. Only a reviewer may change ground truth.
 *   measure      -> x-harness-code.  Only the local harness may write results.
 *
 * Ground truth is safe precisely because openness stops at the draft boundary.
 * See .scratch/seen-not-grasped/adr/0002-two-doors.md.
 *
 * An unset secret means "not configured", which is open and is for local
 * development only. The worker logs a warning in that state.
 */
export function hasCode(provided: string | null, expected?: string): boolean {
  // FAIL CLOSED. An unconfigured secret disables the privileged door; it never
  // opens it. This matters: if a deployment forgot to set QUESTIONS_CODE and the
  // unset case meant "open", the open authoring door would silently auto-approve
  // every item, which is exactly the failure this design exists to prevent.
  if (!expected) return false;
  return provided === expected;
}

export function canApprove(request: Request, deps: QuestionsApiDeps): boolean {
  return hasCode(request.headers.get("x-questions-code"), deps.questionsCode);
}

export function canMeasure(request: Request, deps: QuestionsApiDeps): boolean {
  return hasCode(request.headers.get("x-harness-code"), deps.harnessCode);
}

const APPROVE_ERROR = () => jsonResponse({ error: "reviewer code required (x-questions-code)" }, 401);
const MEASURE_ERROR = () => jsonResponse({ error: "harness code required (x-harness-code)" }, 401);

// THE REVIEW ROOM IS READ-HEAVY AND D1'S FREE TIER BILLS ROWS READ. Counting the
// candidate table costs one full scan per dimension (status, capability, level,
// domain) plus a DISTINCT file_id — roughly 400k reads per page load at 80k
// candidates. Ten page loads exhausted the daily 5M allowance in testing. The
// cache below is the difference between a demo that works and a 500.
const VQA_COUNTS_TTL_MS = 60_000;
let vqaCountsCache: { at: number; payload: string } | null = null;
const vqaImagesCache = new Map<string, { at: number; payload: string }>();
const VQA_IMAGES_TTL_MS = 30_000;

function invalidateVqaCaches(): void {
  vqaCountsCache = null;
  vqaImagesCache.clear();
}

/** Actor identity from headers. Not authentication: a stable id plus a display name. */
function actorOf(request: Request): { id: string; name: string } {
  return {
    id: (request.headers.get("x-actor") ?? "").trim().slice(0, 64),
    name: (request.headers.get("x-actor-name") ?? "").trim().slice(0, 64),
  };
}

/**
 * Open-write rate limit, derived from the revision table this benchmark already
 * writes. Costs a few rows read and needs no paid binding. Fails OPEN if the
 * database is un-migrated, so authoring is never blocked by a missing table.
 */
async function overWriteLimit(db: D1Database, actorId: string, limit = 60): Promise<boolean> {
  if (!actorId) return false;
  try {
    const row = await db.prepare(
      "SELECT COUNT(*) AS n FROM question_revisions WHERE actor_id = ?1 AND created_at > datetime('now','-1 minute')",
    ).bind(actorId).first<{ n: number }>();
    return Number(row?.n ?? 0) >= limit;
  } catch {
    return false;
  }
}

/** Two distinct votes promote a nomination; one below that demotes it again. */
const VOTES_TO_PROMOTE = 2;

async function voteCount(db: D1Database, fileId: string): Promise<number> {
  const row = await db.prepare(
    "SELECT COUNT(*) AS n FROM selection_votes WHERE file_id = ?1",
  ).bind(fileId).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

async function readBody<T>(request: Request): Promise<T> {
  return await request.json() as T;
}

function validateRawGraph(graph: unknown): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!graph || typeof graph !== "object") { errors.push("graph must be an object"); return { errors, warnings }; }
  const g = graph as Record<string, unknown>;
  const requireStr = (k: string) => {
    const v = g[k];
    if (typeof v !== "string" || (v as string).trim() === "") errors.push(k + " is required");
  };
  requireStr("fileId"); requireStr("city"); requireStr("country"); requireStr("branch");
  const stations = g.stations;
  const edges = g.edges;
  const lines = g.lines;
  const provenance = g.provenance;
  if (!Array.isArray(stations)) errors.push("stations must be an array");
  if (!Array.isArray(edges)) errors.push("edges must be an array");
  if (!lines || typeof lines !== "object" || Array.isArray(lines)) errors.push("lines must be an object");
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) errors.push("provenance is required");
  else {
    const pr = provenance as Record<string, unknown>;
    if (typeof pr.annotatedBy !== "string" || pr.annotatedBy.trim() === "") errors.push("provenance.annotatedBy is required");
    if (typeof pr.annotatedAt !== "string" || pr.annotatedAt.trim() === "") errors.push("provenance.annotatedAt is required");
    if (typeof pr.tool !== "string" || pr.tool.trim() === "") errors.push("provenance.tool is required");
  }
  if (errors.length) return { errors, warnings };
  const sArr = stations as Array<Record<string, unknown>>;
  const eArr = edges as Array<Record<string, unknown>>;
  const lObj = lines as Record<string, Record<string, unknown>>;
  const ids = sArr.map((x) => String(x.id ?? ""));
  const seenIds: Record<string, true> = {};
  for (const id of ids) {
    if (!id) errors.push("station.id is required");
    else if (seenIds[id]) errors.push("duplicate station.id '" + id + "'");
    else seenIds[id] = true;
  }
  const idSet: Record<string, true> = {};
  for (const id of ids) if (id) idSet[id] = true;
  for (let i = 0; i < sArr.length; i++) {
    const st = sArr[i];
    if (typeof st.id !== "string" || st.id.trim() === "") errors.push("stations[" + i + "].id is required");
    if (typeof st.label !== "string" || st.label.trim() === "") warnings.push("station '" + String(st.id) + "' has empty label");
    if (!Array.isArray(st.lines)) errors.push("stations[" + i + "].lines must be an array");
    if (typeof st.interchange !== "boolean") errors.push("stations[" + i + "].interchange must be boolean");
    if (st.x !== null && st.x !== undefined) {
      const xv = st.x as number;
      if (typeof xv !== "number" || xv < 0 || xv > 1) errors.push("stations[" + i + "].x must be null or number in [0,1]");
    }
    if (st.y !== null && st.y !== undefined) {
      const yv = st.y as number;
      if (typeof yv !== "number" || yv < 0 || yv > 1) errors.push("stations[" + i + "].y must be null or number in [0,1]");
    }
  }
  const hexRe = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  for (const lineId of Object.keys(lObj)) {
    const line = lObj[lineId];
    if (!/^[A-Za-z0-9_-]+$/.test(lineId)) errors.push("line id '" + lineId + "' invalid");
    if (!line || typeof line !== "object") { errors.push("lines." + lineId + " must be an object"); continue; }
    const ll = line as Record<string, unknown>;
    if (typeof ll.color !== "string" || !hexRe.test(ll.color as string)) errors.push("lines." + lineId + ".color must be hex like #ff0000");
    if (typeof ll.label !== "string") errors.push("lines." + lineId + ".label must be string");
    const ls = ll.stations;
    if (!Array.isArray(ls)) errors.push("lines." + lineId + ".stations must be an array");
    else for (const sid of ls as unknown[]) {
      if (typeof sid !== "string" || !idSet[sid as string]) errors.push("lines." + lineId + " references unknown station '" + String(sid) + "'");
    }
  }
  for (let i = 0; i < eArr.length; i++) {
    const e = eArr[i];
    const fr = e.from; const to = e.to;
    if (typeof fr !== "string" || (fr as string).trim() === "") errors.push("edges[" + i + "].from is required");
    if (typeof to !== "string" || (to as string).trim() === "") errors.push("edges[" + i + "].to is required");
    if (typeof e.line !== "string" || (e.line as string).trim() === "") errors.push("edges[" + i + "].line is required");
    if (typeof e.bidirectional !== "boolean") errors.push("edges[" + i + "].bidirectional must be boolean");
    const w = e.weight as number;
    if (typeof w !== "number" || !(w > 0)) errors.push("edges[" + i + "].weight must be >0");
    if (typeof fr === "string" && (fr as string).trim() !== "" && !idSet[fr as string]) errors.push("edges[" + i + "].from '" + String(fr) + "' not in stations");
    if (typeof to === "string" && (to as string).trim() !== "" && !idSet[to as string]) errors.push("edges[" + i + "].to '" + String(to) + "' not in stations");
  }
  if (sArr.length > 0 && eArr.length > 0) {
    const degree: Record<string, number> = {};
    for (const e of eArr) {
      const fr = String((e as Record<string, unknown>).from ?? "");
      const to = String((e as Record<string, unknown>).to ?? "");
      if (idSet[fr]) degree[fr] = (degree[fr] ?? 0) + 1;
      if (idSet[to] && to !== fr) degree[to] = (degree[to] ?? 0) + 1;
    }
    for (const sid of Object.keys(idSet)) if ((degree[sid] ?? 0) === 0) warnings.push("isolated station '" + sid + "' degree 0");
  } else if (sArr.length > 0 && eArr.length === 0) {
    for (const sid of Object.keys(idSet)) warnings.push("isolated station '" + sid + "' degree 0");
  }
  return { errors, warnings };
}

/** The v5 classification and pairing fields an item may carry. */
interface ItemFields {
  capability: string;
  level: string;
  pair_id: string;
  pair_role: string;
  counterfactual_of: number | null;
  grounding_box: string;
  generator: string;
  verifier: string;
  image_edit: string;
  tolerance: number | null;
  // THE ERROR-ANALYSIS AXIS. The form has always collected these; the API had no
  // column for them and discarded them on every write.
  family: string;
  relevance: string;
  unanswerable_reason: string;
}

/** Insert question + bump tag counts in one batch (atomic). */
async function insertQuestion(db: D1Database, deps: QuestionsApiDeps, payload: {
  file_id: string;
  contributor: string;
  question: string;
  answer_type: string;
  answer: string;
  choices: string;
  difficulty: string;
  tags: string[];
  status: string;
  actor_id: string;
  actor_name: string;
} & ItemFields): Promise<{ id: number; rev: number }> {
  const qnorm = deps.normQ(payload.question);
  const tagList = deps.normTags(payload.tags.join(","));
  const stmts: PreparedStatement[] = [
    db.prepare(
      "INSERT INTO questions (file_id, contributor, question, qnorm, answer_type, answer, choices, difficulty, tags, status," +
      " capability, level, pair_id, pair_role, counterfactual_of, grounding_box, generator, verifier, image_edit, tolerance," +
      " actor_id, actor_name, family, relevance, unanswerable_reason, rev)" +
      " VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,0)",
    ).bind(
      payload.file_id, payload.contributor, payload.question, qnorm,
      payload.answer_type, payload.answer, payload.choices, payload.difficulty,
      tagList.join(","), payload.status,
      payload.capability || null, payload.level || null,
      payload.pair_id || null, payload.pair_role || null,
      payload.counterfactual_of, payload.grounding_box || null,
      payload.generator || null, payload.verifier || null,
      payload.image_edit || null, payload.tolerance,
      payload.actor_id, payload.actor_name,
      payload.family || null, payload.relevance,
      payload.unanswerable_reason || null,
    ),
  ];
  for (const tag of tagList) {
    stmts.push(
      db.prepare(
        "INSERT INTO tags (tag, count) VALUES (?1, 1) ON CONFLICT(tag) DO UPDATE SET count = count + 1",
      ).bind(tag),
    );
  }
  const res = await db.batch(stmts);
  const meta = res[0]?.meta;
  return { id: Number(meta?.last_row_id ?? 0), rev: 0 };
}

interface RouteCtx {
  request: Request;
  /** narrowed D1 binding — handle() 503s before dispatch when missing */
  db: D1Database;
  deps: QuestionsApiDeps;
  url: URL;
}

interface Route {
  method: string;
  pattern: RegExp;
  handler: (ctx: RouteCtx) => Promise<Response> | Response;
}

/** One row per endpoint — single gate, single error boundary, table-driven dispatch. */
const ROUTES: Route[] = [
  {
    method: "GET",
    pattern: /^\/api\/questions\/counts$/,
    handler: async ({ request, db, deps, url }) => {
      const res = await db.prepare(
        "SELECT file_id, COUNT(*) AS n FROM questions WHERE status != 'draft' GROUP BY file_id",
      ).all<{ file_id: string; n: number }>();
      const counts: Record<string, number> = {};
      for (const row of res.results) counts[row.file_id] = row.n;
      return jsonResponse({ counts, images: Object.keys(counts).length });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/questions\/check$/,
    handler: async ({ request, db, deps, url }) => {
      const fileId = url.searchParams.get("file_id") ?? "";
      const q = url.searchParams.get("q") ?? "";
      if (!fileId || q.trim().length < 4) return jsonResponse({ matches: [] });
      const qn = deps.normQ(q);
      const res = await db.prepare(
        "SELECT id, question FROM questions WHERE file_id = ?1 AND (qnorm = ?2 OR qnorm LIKE ?3) LIMIT 5",
      ).bind(fileId, qn, qn + "%").all<{ id: number; question: string }>();
      return jsonResponse({ matches: res.results });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/questions$/,
    handler: async ({ request, db, deps, url }) => {
      // Filters are composed rather than hard-coded, so the review queue can ask
      // for exactly what needs a decision and nothing else.
      const limit = Math.min(500, Number(url.searchParams.get("limit") ?? 50));
      const where: string[] = [];
      const binds: unknown[] = [];
      const addFilter = (col: string, val: string | null) => {
        if (val === null || val === "") return;
        binds.push(val);
        where.push(col + " = ?" + binds.length);
      };
      addFilter("file_id", url.searchParams.get("file_id"));
      addFilter("status", url.searchParams.get("status"));
      addFilter("review_status", url.searchParams.get("review_status"));
      addFilter("contributor", url.searchParams.get("contributor"));
      addFilter("capability", url.searchParams.get("capability"));
      const search = url.searchParams.get("search");
      if (search) { binds.push("%" + search + "%"); where.push("question LIKE ?" + binds.length); }
      binds.push(limit);
      const sql = "SELECT * FROM questions"
        + (where.length ? " WHERE " + where.join(" AND ") : "")
        + " ORDER BY id DESC LIMIT ?" + binds.length;
      const res = await db.prepare(sql).bind(...binds).all<QuestionRow>();
      return jsonResponse({ questions: res.results });
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/questions$/,
    handler: async ({ request, db, deps, url }) => {
      const actor = actorOf(request);
      if (await overWriteLimit(db, actor.id)) {
        return jsonResponse({ error: "too many writes in the last minute — slow down" }, 429);
      }
      const body = await readBody<{
        file_id?: string;
        contributor?: string;
        question?: string;
        answer_type?: string;
        answer?: string;
        choices?: string;
        difficulty?: string;
        tags?: string;
        capability?: string;
        level?: string;
        pair_id?: string;
        pair_role?: string;
        counterfactual_of?: number | null;
        grounding_box?: string;
        generator?: string;
        verifier?: string;
        image_edit?: string;
        tolerance?: number | null;
        family?: string;
        relevance?: string;
        unanswerable_reason?: string;
      }>(request);
      const question = (body.question ?? "").trim();
      const fileId = (body.file_id ?? "").trim();
      if (!fileId || !question) return jsonResponse({ error: "file_id and question are required" }, 400);
      const answerType = ["text", "number", "choice", "yesno"].includes(body.answer_type ?? "")
        ? (body.answer_type as string) : "text";
      const answer = (body.answer ?? "").trim();
      if (answerType !== "text" && answer === "") {
        return jsonResponse({ error: `answer is required for ${answer_type_label(answerType)} questions` }, 400);
      }
      if (answerType === "choice") {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(body.choices || "[]");
        } catch {
          return jsonResponse({ error: "choices must be a JSON array" }, 400);
        }
        if (!Array.isArray(parsed) || parsed.length < 2) return jsonResponse({ error: "choice questions need at least 2 options" }, 400);
      }
      const difficulty = ["easy", "medium", "hard"].includes(body.difficulty ?? "") ? (body.difficulty as string) : "medium";
      const capability = (body.capability ?? "").trim();
      const level = (body.level ?? "").trim();
      // THE OPEN DOOR WRITES DRAFTS. A reviewer may create directly as approved,
      // which is the same thing as creating a draft and then approving it.
      const mayApprove = canApprove(request, deps);
      const status = mayApprove ? "approved" : "draft";
      if (status === "approved" && (!capability || !level)) {
        return jsonResponse({ error: "an approved item needs a capability and a level — classify it, or omit the reviewer code to save it as a draft" }, 400);
      }
      // A numeric answer needs a non-null tolerance, or the frozen grade cannot be
      // reproduced. 0 means exact.
      const tolerance = answerType === "number" ? (body.tolerance ?? 0) : null;
      // The error-analysis axis. Enforced here and not only in the form, because the
      // gate's C2.3 reads `relevance` and C2.9 reads `unanswerable_reason` — a value
      // the client forgot to send used to fail a check with no way to tell why.
      const VALID_RELEVANCE = ["visual_true_premise", "visual_false_premise", "non_visual"];
      const relevance = VALID_RELEVANCE.includes(body.relevance ?? "")
        ? (body.relevance as string) : "visual_true_premise";
      const unanswerableReason = (body.unanswerable_reason ?? "").trim();
      if (relevance !== "visual_true_premise" && !unanswerableReason) {
        return jsonResponse({ error: "say why the item is not answerable — the gate reads this" }, 400);
      }
      const family = (body.family ?? "").trim();
      try {
        const res = await insertQuestion(db, deps, {
          file_id: fileId,
          contributor: (body.contributor ?? actor.name).trim(),
          question,
          answer_type: answerType,
          answer,
          choices: body.choices ?? "",
          difficulty,
          tags: deps.normTags(body.tags ?? ""),
          status,
          actor_id: actor.id,
          actor_name: actor.name,
          capability,
          level,
          pair_id: (body.pair_id ?? "").trim(),
          pair_role: (body.pair_role ?? "").trim(),
          counterfactual_of: body.counterfactual_of ?? null,
          grounding_box: (body.grounding_box ?? "").trim(),
          generator: (body.generator ?? "").trim(),
          verifier: (body.verifier ?? "").trim(),
          image_edit: (body.image_edit ?? "").trim(),
          tolerance,
          family,
          relevance,
          unanswerable_reason: relevance === "visual_true_premise" ? "" : unanswerableReason,
        });
        return jsonResponse({ id: res.id, rev: res.rev, status });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/UNIQUE/i.test(msg)) return jsonResponse({ error: "duplicate — an identical question already exists for this image" }, 409);
        return jsonResponse({ error: msg }, 500);
      }
    },
  },
  {
    method: "DELETE",
    pattern: /^\/api\/questions$/,
    handler: async ({ request, db, deps, url }) => {
      const id = Number(url.searchParams.get("id"));
      if (!id) return jsonResponse({ error: "id required" }, 400);
      const row = await db.prepare("SELECT status, tags FROM questions WHERE id = ?1")
        .bind(id).first<{ status: string; tags: string }>();
      if (!row) return jsonResponse({ error: "not found" }, 404);
      // Deleting a DRAFT is an author discarding their own work, so it is open.
      // Deleting an APPROVED item removes ground truth from the benchmark, which is
      // the reviewer's door — the same rule as approval and restore.
      // Either way a BEFORE DELETE trigger has already written the full content into
      // question_revisions, so nothing is destroyed by even an authorised delete.
      if (row.status === "approved" && !canApprove(request, deps)) return APPROVE_ERROR();
      const tagList = deps.normTags(row.tags);
      const stmts: PreparedStatement[] = [
        db.prepare("DELETE FROM questions WHERE id = ?1").bind(id),
        // evaluations reference the question — never leave orphans behind
        db.prepare("DELETE FROM evaluations WHERE question_id = ?1").bind(id),
      ];
      for (const tag of tagList) {
        stmts.push(db.prepare("UPDATE tags SET count = MAX(0, count - 1) WHERE tag = ?1").bind(tag));
      }
      await db.batch(stmts);
      return jsonResponse({ ok: true });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/questions\/tags$/,
    handler: async ({ request, db, deps, url }) => {
      const res = await db.prepare("SELECT tag, count FROM tags ORDER BY count DESC LIMIT 200").all<{ tag: string; count: number }>();
      return jsonResponse({ tags: res.results.map((r) => [r.tag, r.count]) });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/questions\/export\.jsonl$/,
    handler: async ({ request, db, deps, url }) => {
      let last = 0;
      const parts: string[] = [];
      for (;;) {
        const res = await db.prepare(
          "SELECT * FROM questions WHERE status = 'approved' AND answer IS NOT NULL AND answer != '' AND id > ?1 ORDER BY id LIMIT 500",
        ).bind(last).all<QuestionRow>();
        if (res.results.length === 0) break;
        for (const q of res.results) {
          last = q.id;
          const row = q as unknown as Record<string, unknown>;
          parts.push(JSON.stringify({
            // canonical keys the harness consumes
            id: q.id,
            file_id: q.file_id,
            // legacy aliases, kept so existing consumers do not break
            question_id: q.id,
            image_id: q.file_id,
            question: q.question,
            answer: q.answer,
            answer_type: q.answer_type,
            choices: q.choices ? JSON.parse(q.choices) : null,
            difficulty: q.difficulty,
            tags: q.tags ? q.tags.split(",") : [],
            contributor: q.contributor,
            created_at: q.created_at,
            // v5: everything a frozen release needs to be reproducible
            status: row.status ?? null,
            review_status: row.review_status ?? null,
            blind_passed: row.blind_passed ?? null,
            annotator_2: row.annotator_2 ?? null,
            annotator_2_id: row.annotator_2_id ?? null,
            family: row.family ?? null,
            relevance: row.relevance ?? null,
            unanswerable_reason: row.unanswerable_reason ?? null,
            answer_basis: row.answer_basis ?? null,
            capability: row.capability ?? null,
            level: row.level ?? null,
            pair_id: row.pair_id ?? null,
            pair_role: row.pair_role ?? null,
            counterfactual_of: row.counterfactual_of ?? null,
            grounding_box: row.grounding_box ?? null,
            image_edit: row.image_edit ?? null,
            canary: row.canary ?? null,
            tolerance: row.tolerance ?? null,
            deleted_at: row.deleted_at ?? null,
          }));
        }
        if (res.results.length < 500) break;
      }
      return new Response(parts.join("\n") + (parts.length ? "\n" : ""), {
        headers: {
          "Content-Type": "application/x-ndjson",
          "Content-Disposition": 'attachment; filename="questions.jsonl"',
          ...CORS_HEADERS,
        },
      });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/evaluations$/,
    handler: async ({ request, db, deps, url }) => {
      const questionId = Number(url.searchParams.get("question_id") ?? 0);
      const model = url.searchParams.get("model");
      const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 100));
      let res: D1Result<EvalRow>;
      if (questionId) {
        res = await db.prepare("SELECT * FROM evaluations WHERE question_id = ?1 ORDER BY id DESC").bind(questionId).all<EvalRow>();
      } else if (model) {
        res = await db.prepare("SELECT * FROM evaluations WHERE model = ?1 ORDER BY id DESC LIMIT ?2").bind(model, limit).all<EvalRow>();
      } else {
        res = await db.prepare("SELECT * FROM evaluations ORDER BY id DESC LIMIT ?1").bind(limit).all<EvalRow>();
      }
      return jsonResponse({ evaluations: res.results });
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/evaluations$/,
    handler: async ({ request, db, deps, url }) => {
      const body = await readBody<{
        question_id?: number;
        model?: string;
        response?: string;
        verdict?: string;
        source?: string;
        graded_by?: string;
      }>(request);
      const questionId = Number(body.question_id ?? 0);
      const model = (body.model ?? "").trim();
      if (!questionId || !model) return jsonResponse({ error: "question_id and model are required" }, 400);
      const questionExists = await db.prepare("SELECT id FROM questions WHERE id = ?1").bind(questionId).first();
      if (!questionExists) return jsonResponse({ error: "question not found" }, 404);
      const verdict = ["correct", "close", "wrong", "unanswered"].includes(body.verdict ?? "")
        ? (body.verdict as string) : null;
      await db.prepare(
        // A HUMAN GRADE IS NOT PART OF A RUN, and it says so with run_id = ''. The key is
        // (question_id, model, run_id) since v5e, so an unnamed run has to be named explicitly
        // rather than left out — otherwise the conflict target does not match the constraint.
        `INSERT INTO evaluations (question_id, model, run_id, response, verdict, source, graded_by)
         VALUES (?1, ?2, '', ?3, ?4, ?5, ?6)
         ON CONFLICT(question_id, model, run_id) DO UPDATE SET
           response = COALESCE(NULLIF(?3, ''), evaluations.response),
           verdict = COALESCE(?4, evaluations.verdict),
           source = ?5,
           graded_by = COALESCE(NULLIF(?6, ''), evaluations.graded_by)`,
      ).bind(questionId, model, body.response ?? "", verdict, body.source ?? "manual", body.graded_by ?? "").run();
      return jsonResponse({ ok: true });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/excluded$/,
    handler: async ({ request, db, deps, url }) => {
      const res = await db.prepare("SELECT file_id, reason, marked_by, created_at FROM excluded ORDER BY created_at DESC").all<{ file_id: string; reason: string; marked_by: string; created_at: string }>();
      return jsonResponse({ excluded: res.results });
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/excluded$/,
    handler: async ({ request, db, deps, url }) => {
      const body = await readBody<{ file_id?: string; reason?: string; marked_by?: string }>(request);
      const fileId = (body.file_id ?? "").trim();
      if (!fileId) return jsonResponse({ error: "file_id required" }, 400);
      await db.prepare(
        `INSERT INTO excluded (file_id, reason, marked_by) VALUES (?1, ?2, ?3)
         ON CONFLICT(file_id) DO UPDATE SET reason = ?2, marked_by = ?3`,
      ).bind(fileId, (body.reason ?? "").trim(), (body.marked_by ?? "").trim()).run();
      return jsonResponse({ ok: true });
    },
  },
  {
    method: "DELETE",
    pattern: /^\/api\/excluded$/,
    handler: async ({ request, db, deps, url }) => {
      const fileId = url.searchParams.get("file_id") ?? "";
      if (!fileId) return jsonResponse({ error: "file_id required" }, 400);
      await db.prepare("DELETE FROM excluded WHERE file_id = ?1").bind(fileId).run();
      return jsonResponse({ ok: true });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/insights$/,
    handler: async ({ request, db, deps, url }) => {
      // THE RUN IS PART OF THE ROW, NOT AVERAGED AWAY.
      //
      // This grouped by model alone. Once a series is published that blends every condition:
      // run_attack writes 21, so a model's corruption ladder would collapse into ONE accuracy
      // and the slope — the actual result — would be invisible on the page while existing in
      // the trace. Same defect as collapse() and as the pre-v5e evaluations key, at the last
      // layer and the one a reader sees.
      //
      // ?run_id= selects one condition. Without it every run is its own row, which is the
      // honest default: two runs of the same model are two measurements.
      const runFilter = url.searchParams.get("run_id");
      // READ THE SUMMARY, NOT THE TABLE.
      //
      // This aggregated `evaluations` directly. Measured on the real schema against a realistic
      // campaign (29 runs x 6 models x 2,500 items = 435,000 evaluations), EXPLAIN QUERY PLAN
      // reported "SCAN evaluations USING INDEX idx_ev_model" plus two temp B-trees: **~445,000
      // rows read per page load**, against a D1 free allowance of 5,000,000 rows read per DAY.
      // That is ~11 page loads before the database refuses everyone until midnight UTC.
      //
      // `run_summary` holds one row per (run, model) — 174 of them — maintained by the ingest.
      // Reads drop ~2,500x, and the figures are the same ones the ingest computed from the rows.
      const board = await db.prepare(
        `SELECT model,
           run_id,
           graded,
           correct,
           close,
           wrong,
           -- Errors are REPORTED, never counted as wrong answers. run.py sets verdict
           -- 'wrong' on a failed call, so without this the site's accuracy fell every
           -- time the API rate-limited a request — infrastructure masquerading as
           -- model ability, and a different number from the one the paper computes.
           not_answered
         FROM run_summary
         WHERE (?1 IS NULL OR run_id = ?1)
         ORDER BY correct * 1.0 / NULLIF(graded, 0) DESC`,
      ).bind(runFilter).all<{ model: string; run_id: string; graded: number; correct: number; close: number; wrong: number; not_answered: number }>();

      // AND THE SAME FOR byTag, which scanned too. Measured on a 165,000-evaluation campaign,
      // this query read EVERY evaluation and returned one row per evaluation to the Worker:
      // "SCAN e | SEARCH q USING INTEGER PRIMARY KEY". Fixing only the leaderboard left the
      // endpoint scanning, and the assertion "the endpoint never reads evaluations" is what
      // caught the half-fix.
      //
      // `tag_summary` is grouped by the RAW tags string — one row per (tag-string, run, model),
      // 198 of them here — and split with normTags below, exactly as the joined rows were.
      const joined = await db.prepare(
        `SELECT tags, run_id AS run, model, graded, correct
         FROM tag_summary
         WHERE (?1 IS NULL OR run_id = ?1)`,
      ).bind(runFilter).all<{ tags: string; run: string; model: string; graded: number; correct: number }>();
      const tagAgg = new Map<string, { graded: number; correct: number }>();
      for (const row of joined.results) {
        // pre-aggregated: the counts arrive ready, and a raw tags string can carry several tags
        // at once, so its counts are added to each of them.
        for (const tag of deps.normTags(row.tags)) {
          const agg = tagAgg.get(tag) ?? { graded: 0, correct: 0 };
          agg.graded += row.graded;
          agg.correct += row.correct;
          tagAgg.set(tag, agg);
        }
      }
      const byTag = [...tagAgg.entries()]
        .map(([tag, v]) => ({ tag, ...v }))
        .sort((a, b) => b.graded - a.graded)
        .slice(0, 50);
      // `run_id` is echoed so a caller can tell whether they are looking at one condition or
      // at every run the model has. Without it a reader has no way to know which they got.
      return jsonResponse({ leaderboard: board.results, byTag, run_id: runFilter });
    },
  },
  {
    // ------------------------------------------------- the paper's headline
    // `v_pair_breakdown` has existed since v5 and NOTHING READ IT: the 2x2 that the
    // benchmark is built to produce had no endpoint, so the central claim could not
    // be displayed anywhere. This is its reader.
    //
    // `unpaired` is reported alongside on purpose. A model that fails a bridge item
    // is only interesting if the item HAS a twin; an unpaired bridge item inflates the
    // paired count while contributing nothing, so it is surfaced rather than hidden.
    method: "GET",
    pattern: /^\/api\/insights\/pairs$/,
    handler: async ({ db }) => {
      // An un-migrated database must degrade to "no results yet", not a 500. The
      // views are created by a migration, and a page that breaks before the
      // migration runs is a page nobody trusts.
      let raw: { model: string; cell: string; n: number }[] = [];
      try {
        const cells = await db.prepare(
          "SELECT model, cell, n FROM v_pair_breakdown ORDER BY model, cell",
        ).all<{ model: string; cell: string; n: number }>();
        raw = cells.results;
      } catch { raw = []; }
      const byModel = new Map<string, Record<string, number>>();
      for (const r of raw) {
        const m = byModel.get(r.model) ?? {};
        m[r.cell] = Number(r.n);
        byModel.set(r.model, m);
      }
      const models = [...byModel.entries()].map(([model, c]) => {
        const pairs = Object.values(c).reduce((a, b) => a + b, 0);
        const C = (k: string) => c[k] ?? 0;
        return {
          model,
          pairs,
          understands: C("understands"),
          physics_gap: C("physics_gap"),
          geometry_or_perception_gap: C("geometry_or_perception_gap"),
          guessing_from_priors: C("guessing_from_priors"),
          // the headline number: of the pairs where the geometry was read right,
          // how often did the physics still go wrong?
          physics_gap_rate: (C("understands") + C("physics_gap")) > 0
            ? C("physics_gap") / (C("understands") + C("physics_gap"))
            : null,
        };
      }).sort((a, b) => b.pairs - a.pairs);
      let unpaired = 0;
      try {
        const u = await db.prepare("SELECT COUNT(*) AS n FROM v_unpaired_bridge").first<{ n: number }>();
        unpaired = Number(u?.n ?? 0);
      } catch { unpaired = 0; }
      return jsonResponse({ models, unpaired_bridge: unpaired });
    },
  },
  {
    // ------------------------------------------------------- release state
    method: "GET",
    pattern: /^\/api\/insights\/release$/,
    handler: async ({ db }) => {
      const caps = await db.prepare(
        "SELECT capability, COUNT(*) AS n FROM v_release_items GROUP BY capability ORDER BY n DESC",
      ).all<{ capability: string; n: number }>();
      const tot = await db.prepare("SELECT COUNT(*) AS n FROM v_release_items").first<{ n: number }>();
      return jsonResponse({
        releasable_items: Number(tot?.n ?? 0),
        by_capability: caps.results,
      });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/graphs$/,
    handler: async ({ db }) => {
      try { await db.prepare("CREATE TABLE IF NOT EXISTS graph_drafts (file_id TEXT PRIMARY KEY, graph TEXT NOT NULL, updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now')))").run(); } catch {}
      const res = await db.prepare("SELECT file_id, updated_by, updated_at, graph FROM graph_drafts ORDER BY updated_at DESC").all<{ file_id: string; updated_by: string; updated_at: string; graph: string }>();
      const drafts = res.results.map((r) => {
        let stationCount = 0; let edgeCount = 0;
        try { const g = JSON.parse(r.graph) as { stations?: unknown[]; edges?: unknown[] }; stationCount = Array.isArray(g.stations) ? g.stations.length : 0; edgeCount = Array.isArray(g.edges) ? g.edges.length : 0; } catch {}
        return { file_id: r.file_id, updated_by: r.updated_by, updated_at: r.updated_at, stationCount, edgeCount };
      });
      return jsonResponse({ drafts });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/graphs\/[^/]+$/,
    handler: async ({ db, url }) => {
      try { await db.prepare("CREATE TABLE IF NOT EXISTS graph_drafts (file_id TEXT PRIMARY KEY, graph TEXT NOT NULL, updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now')))").run(); } catch {}
      const fileId = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      if (!fileId) return jsonResponse({ error: "file_id required" }, 400);
      const row = await db.prepare("SELECT file_id, graph, updated_by, updated_at FROM graph_drafts WHERE file_id = ?1").bind(fileId).first<{ file_id: string; graph: string; updated_by: string; updated_at: string }>();
      if (!row) return jsonResponse({ error: "not found", graph: null }, 404);
      let graph: unknown = null;
      try { graph = JSON.parse(row.graph); } catch { return jsonResponse({ error: "corrupt draft" }, 500); }
      return jsonResponse({ graph, file_id: row.file_id, updated_by: row.updated_by, updated_at: row.updated_at });
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/graphs\/[^/]+$/,
    handler: async ({ request, db, url }) => {
      try { await db.prepare("CREATE TABLE IF NOT EXISTS graph_drafts (file_id TEXT PRIMARY KEY, graph TEXT NOT NULL, updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now')))").run(); } catch {}
      const fileId = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      if (!fileId) return jsonResponse({ error: "file_id required" }, 400);
      let body: unknown;
      try { body = await readBody<unknown>(request); } catch { return jsonResponse({ error: "invalid JSON body" }, 400); }
      const raw = (body as Record<string, unknown>)?.graph ?? body;
      const checked = validateRawGraph(raw);
      if (checked.errors.length) return jsonResponse({ error: "validation failed", errors: checked.errors, warnings: checked.warnings }, 400);
      const graphObj = raw as Record<string, unknown>;
      if (typeof graphObj.fileId === "string" && (graphObj.fileId as string) !== fileId) (graphObj as Record<string, unknown>).fileId = fileId;
      const updatedBy = (request.headers.get("x-questions-code") ?? "").slice(0, 32) || "api";
      const graphJson = JSON.stringify(graphObj);
      await db.prepare("INSERT INTO graph_drafts (file_id, graph, updated_by, updated_at) VALUES (?1, ?2, ?3, datetime('now')) ON CONFLICT(file_id) DO UPDATE SET graph = ?2, updated_by = ?3, updated_at = datetime('now')").bind(fileId, graphJson, updatedBy).run();
      return jsonResponse({ ok: true, fileId, warnings: checked.warnings });
    },
  },
  {
    // ---------------------------------------------------------------- edit
    method: "PATCH",
    pattern: /^\/api\/questions\/\d+$/,
    handler: async ({ request, db, deps, url }) => {
      const id = Number(url.pathname.split("/").pop());
      const actor = actorOf(request);
      if (await overWriteLimit(db, actor.id)) {
        return jsonResponse({ error: "too many writes in the last minute — slow down" }, 429);
      }
      const row = await db.prepare("SELECT * FROM questions WHERE id = ?1").bind(id).first<Record<string, unknown>>();
      if (!row) return jsonResponse({ error: "not found" }, 404);
      const currentRev = Number(row.rev ?? 0);
      const ifMatch = request.headers.get("if-match");
      // REQUIRED. It used to be optional, so omitting the header meant "overwrite
      // whatever is there" — the protection was opt-in and the failure mode was the
      // silent loss of a colleague's work, which is the one thing this is for.
      if (ifMatch === null || ifMatch === "") {
        return jsonResponse({
          error: "If-Match: <rev> is required — a blind overwrite can lose an edit someone else made",
          expected_rev: currentRev,
        }, 428);
      }
      if (Number(ifMatch) !== currentRev) {
        return jsonResponse({ error: "conflict", expected_rev: currentRev, current: row }, 409);
      }
      const body = await readBody<Record<string, unknown>>(request);
      const fields: string[] = [];
      const values: unknown[] = [];
      const editable = ["question", "answer", "answer_type", "choices", "difficulty", "tags",
        "capability", "level", "pair_id", "pair_role", "grounding_box", "image_edit", "tolerance",
        "counterfactual_of", "generator", "verifier", "canary",
        "family", "relevance", "unanswerable_reason"];
      for (const k of editable) {
        if (k in body) { fields.push(k + " = ?" + (values.length + 1)); values.push(body[k]); }
      }
      if (!fields.length) return jsonResponse({ error: "no editable fields supplied" }, 400);
      if (body.question !== undefined) {
        fields.push("qnorm = ?" + (values.length + 1));
        values.push(deps.normQ(String(body.question)));
      }
      fields.push("rev = rev + 1");
      fields.push("actor_id = ?" + (values.length + 1)); values.push(actor.id);
      fields.push("actor_name = ?" + (values.length + 1)); values.push(actor.name);
      // ATOMIC. The revision is in the WHERE clause, so two writers who both read
      // revision N cannot both succeed. The previous check-then-act left that race open:
      // the rev was compared in JavaScript and then the UPDATE ran unconditionally, so
      // both writers passed the check and the second silently overwrote the first —
      // exactly what optimistic concurrency exists to prevent.
      values.push(id, currentRev);
      const updated = await db.prepare(
        "UPDATE questions SET " + fields.join(", ")
        + " WHERE id = ?" + (values.length - 1) + " AND rev = ?" + values.length,
      ).bind(...values).run<{ changes?: number }>();
      if (!updated?.meta?.changes) {
        // Someone wrote between our read and our write. Hand back the current row so the
        // caller can show a diff rather than guess.
        const now = await db.prepare("SELECT * FROM questions WHERE id = ?1").bind(id).first<Record<string, unknown>>();
        return jsonResponse({ error: "conflict", expected_rev: Number(now?.rev ?? 0), current: now }, 409);
      }
      return jsonResponse({ ok: true, id, rev: currentRev + 1 });
    },
  },
  {
    // -------------------------------------------------------------- review
    method: "POST",
    pattern: /^\/api\/questions\/\d+\/review$/,
    handler: async ({ request, db, deps, url }) => {
      if (!canApprove(request, deps)) return APPROVE_ERROR();
      const id = Number(url.pathname.split("/")[3]);
      const body = await readBody<{ decision?: string; reason?: string }>(request);
      const decision = (body.decision ?? "").trim();
      if (!["accept", "fix", "reject"].includes(decision)) {
        return jsonResponse({ error: "decision must be accept, fix or reject" }, 400);
      }
      const BEFORE = await db.prepare("SELECT * FROM questions WHERE id = ?1").bind(id).first<Record<string, unknown>>();
      if (!BEFORE) return jsonResponse({ error: "not found" }, 404);
      const reviewStatus = decision === "accept" ? "accepted" : decision === "fix" ? "fixed" : "rejected";
      const status = decision === "reject" ? "draft" : "approved";
      if (status === "approved" && (!BEFORE.capability || !BEFORE.level)) {
        return jsonResponse({ error: "cannot approve an unclassified item — set capability and level first" }, 400);
      }
      const actor = actorOf(request);
      await db.prepare(
        "UPDATE questions SET review_status = ?1, reviewer = ?2, review_reason = ?3, status = ?4, rev = rev + 1 WHERE id = ?5",
      ).bind(reviewStatus, actor.name || "reviewer", (body.reason ?? "").trim(), status, id).run();
      return jsonResponse({ ok: true, id, review_status: reviewStatus, status });
    },
  },
  {
    // ----------------------------------------------------- second opinion
    // `annotator_2` has existed since v4 with no writer, and it is the column the
    // inter-annotator agreement figure comes from. Without it there is no kappa, and
    // with no kappa the ground truth has no measured reliability — which is the first
    // thing a reviewer will ask about a human-labelled benchmark.
    //
    // Reviewer-gated. `annotator_2_id` records a STABLE ID, never an email, so the
    // ledger can compute agreement without holding anyone's address.
    //
    // The blinding is the client's job: it must not show the stored answer before this
    // is called, or the second annotation is not independent and the kappa is inflated.
    method: "POST",
    pattern: /^\/api\/questions\/\d+\/second$/,
    handler: async ({ request, db, deps, url }) => {
      if (!canApprove(request, deps)) return APPROVE_ERROR();
      const id = Number(url.pathname.split("/")[3]);
      const body = await readBody<{ answer?: string }>(request);
      const answer = (body.answer ?? "").trim();
      if (!answer) return jsonResponse({ error: "answer is required" }, 400);
      const actor = actorOf(request);
      const row = await db.prepare("SELECT id FROM questions WHERE id = ?1").bind(id).first<Record<string, unknown>>();
      if (!row) return jsonResponse({ error: "not found" }, 404);
      await db.prepare("UPDATE questions SET annotator_2 = ?1, annotator_2_id = ?2 WHERE id = ?3")
        .bind(answer, actor.id || actor.name || "reviewer", id).run();
      return jsonResponse({ ok: true, id, annotator_2: answer });
    },
  },
  {
    // ---------------------------------------------------------- history
    // A revision records the state of an item IMMEDIATELY BEFORE a change, written
    // by a database trigger rather than by this code, so nothing can bypass it.
    // Restoring revision N therefore reverts change N.
    method: "GET",
    pattern: /^\/api\/questions\/\d+\/revisions$/,
    handler: async ({ db, url }) => {
      const id = Number(url.pathname.split("/")[3]);
      const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 50));
      const res = await db.prepare(
        "SELECT rev_id, question_id, seq, op, actor_id, actor_name, created_at, patch" +
        " FROM question_revisions WHERE question_id = ?1 ORDER BY rev_id DESC LIMIT ?2",
      ).bind(id, limit).all<Record<string, unknown>>();
      return jsonResponse({
        question_id: id,
        revisions: res.results.map((r) => {
          let patch: unknown = null;
          try { patch = JSON.parse(String(r.patch ?? "{}")); } catch { patch = null; }
          return { ...r, patch };
        }),
      });
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/questions\/\d+\/restore$/,
    handler: async ({ request, db, deps, url }) => {
      const id = Number(url.pathname.split("/")[3]);
      const body = await readBody<{ rev_id?: number }>(request);
      const revId = Number(body.rev_id ?? 0);
      if (!revId) return jsonResponse({ error: "rev_id is required" }, 400);
      const row = await db.prepare("SELECT id, status FROM questions WHERE id = ?1").bind(id).first<Record<string, unknown>>();
      if (!row) return jsonResponse({ error: "not found" }, 404);
      // Restoring a DRAFT is an author undoing their own work, so it is open.
      // Restoring an APPROVED item rewrites ground truth, which is the reviewer's
      // door. Same rule as approval, for the same reason.
      if (row.status === "approved" && !canApprove(request, deps)) return APPROVE_ERROR();
      const rev = await db.prepare(
        "SELECT patch FROM question_revisions WHERE rev_id = ?1 AND question_id = ?2",
      ).bind(revId, id).first<{ patch: string }>();
      if (!rev) return jsonResponse({ error: "revision not found for this item" }, 404);
      let patch: Record<string, unknown> = {};
      try { patch = JSON.parse(rev.patch ?? "{}") as Record<string, unknown>; } catch { patch = {}; }
      // A whitelist, not a blind write: the patch is data from the past and must
      // not be able to set columns this handler was never meant to touch.
      const restorable = ["question", "answer_type", "answer", "choices", "difficulty", "tags",
        "capability", "level", "pair_id", "pair_role", "grounding_box"];
      const sets: string[] = [];
      const binds: unknown[] = [];
      for (const k of restorable) {
        if (Object.prototype.hasOwnProperty.call(patch, k)) {
          binds.push(patch[k]);
          sets.push(k + " = ?" + binds.length);
        }
      }
      if (!sets.length) return jsonResponse({ error: "that revision has nothing restorable" }, 400);
      if (typeof patch.question === "string") {
        binds.push(deps.normQ(patch.question));
        sets.push("qnorm = ?" + binds.length);
      }
      sets.push("rev = rev + 1");
      binds.push(id);
      // The trigger records the pre-restore state, so a restore is itself undoable.
      await db.prepare("UPDATE questions SET " + sets.join(", ") + " WHERE id = ?" + binds.length).bind(...binds).run();
      return jsonResponse({ ok: true, id, restored_from: revId });
    },
  },
  {
    // ---------------------------------------------------------- selections
    method: "GET",
    pattern: /^\/api\/selections$/,
    handler: async ({ db, url }) => {
      const state = url.searchParams.get("state");
      // The triage client needs the whole decision set to know what is still
      // undecided, so this cap is generous. 20k rows read is a fraction of the
      // free daily allowance and it is one indexed query.
      const limit = Math.min(20000, Number(url.searchParams.get("limit") ?? 2000));
      const res = state
        ? await db.prepare("SELECT * FROM selections WHERE state = ?1 ORDER BY updated_at DESC LIMIT ?2").bind(state, limit).all<Record<string, unknown>>()
        : await db.prepare("SELECT * FROM selections ORDER BY updated_at DESC LIMIT ?1").bind(limit).all<Record<string, unknown>>();
      return jsonResponse({ selections: res.results });
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/selections$/,
    handler: async ({ request, db, url }) => {
      const actor = actorOf(request);
      if (await overWriteLimit(db, actor.id, 600)) {
        return jsonResponse({ error: "too many writes in the last minute — slow down" }, 429);
      }
      const body = await readBody<{ file_id?: string; state?: string; reason?: string; stratum?: string }>(request);
      const fileId = (body.file_id ?? "").trim();
      const state = (body.state ?? "").trim();
      if (!fileId) return jsonResponse({ error: "file_id required" }, 400);
      if (!["proposed", "nominated", "chosen", "excluded"].includes(state)) {
        return jsonResponse({ error: "state must be proposed, nominated, chosen or excluded" }, 400);
      }
      if (state === "excluded" && !(body.reason ?? "").trim()) {
        return jsonResponse({ error: "excluding an image requires a reason — that reason is the evidence a person looked" }, 400);
      }
      // A MACHINE PROPOSAL MUST NEVER CLOBBER A HUMAN DECISION. Enforced in the
      // statement rather than by reading first, so it is atomic: re-running the
      // seeder cannot undo a morning of triage, and there is no read/write race.
      // A person may still change their own mind, so human states are unconditional.
      const isProposal = state === "proposed";
      const upsert = isProposal
        ? `INSERT INTO selections (file_id, state, reason, stratum, actor_id, actor_name, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))
           ON CONFLICT(file_id) DO UPDATE SET state = ?2, reason = ?3, stratum = ?4, actor_id = ?5, actor_name = ?6, promoted_by = NULL, updated_at = datetime('now')
           WHERE selections.state = 'proposed'`
        : `INSERT INTO selections (file_id, state, reason, stratum, actor_id, actor_name, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))
           ON CONFLICT(file_id) DO UPDATE SET state = ?2, reason = ?3, stratum = ?4, actor_id = ?5, actor_name = ?6, promoted_by = NULL, updated_at = datetime('now')`;
      const res = await db.prepare(upsert)
        .bind(fileId, state, (body.reason ?? "").trim(), (body.stratum ?? "").trim(), actor.id, actor.name)
        .run();
      const applied = Number((res.meta as { changes?: number } | undefined)?.changes ?? 0) > 0;
      return jsonResponse({ ok: true, file_id: fileId, state, applied, skipped: !applied });
    },
  },
  {
    // Undo. "Undecided" is the ABSENCE of a row, so restoring it means deleting one.
    // The change_log trigger records the removal, so the decision is not lost from
    // the history even though it is no longer in force.
    method: "DELETE",
    pattern: /^\/api\/selections$/,
    handler: async ({ request, db, url }) => {
      const fileId = (url.searchParams.get("file_id") ?? "").trim();
      if (!fileId) return jsonResponse({ error: "file_id required" }, 400);
      const actor = actorOf(request);
      // The decision is gone; its votes go with it. An orphaned vote could
      // otherwise resurrect vote arithmetic for a file that no longer carries
      // a selection at all.
      await db.prepare("DELETE FROM selection_votes WHERE file_id = ?1").bind(fileId).run();
      await db.prepare("DELETE FROM selections WHERE file_id = ?1").bind(fileId).run();
      return jsonResponse({ ok: true, file_id: fileId, state: null, by: actor.id });
    },
  },
  {
    // ------------------------------------------- the frozen selection snapshot
    // A HASH FOR THE CHOSEN SET, for the same reason a release has one.
    //
    // The chosen set is a live query: people nominate, choose, exclude and change their minds
    // over weeks. Without a frozen snapshot and a hash, "the benchmark was built from these
    // images" is unfalsifiable — the answer to the query has already changed by the time
    // anyone checks. That is exactly the drift the release hash prevents one stage later, and
    // it was missing here.
    //
    // The hash is over the SORTED ids, so two clients that agree on the set agree on the hash
    // regardless of insertion order.
    method: "GET",
    pattern: /^\/api\/selections\/snapshot$/,
    handler: async ({ db, url, request }) => {
      const state = (url.searchParams.get("state") ?? "chosen").trim();
      if (!["proposed", "nominated", "chosen", "excluded"].includes(state)) {
        return jsonResponse({ error: "state must be proposed, nominated, chosen or excluded" }, 400);
      }
      const res = await db.prepare(
        "SELECT file_id FROM selections WHERE state = ?1 ORDER BY file_id",
      ).bind(state).all<{ file_id: string }>();
      const ids = res.results.map((r) => String(r.file_id)).filter(Boolean).sort();
      // SHA-256 over "\n".join(ids). A stable separator, so no two different sets can
      // serialise to the same string.
      const bytes = new TextEncoder().encode(ids.join("\n"));
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      return jsonResponse({
        state,
        n: ids.length,
        hash,
        file_ids: ids,
        note: "frozen snapshot: the hash covers the sorted ids, so a set that changes hashes differently",
      });
    },
  },
  {
    // ------------------------------------------------------- nomination votes
    // The 2026-10-16 rule: a nomination becomes `chosen` on TWO distinct votes
    // from people other than the nominator, and a retraction below two undoes
    // ONLY a promotion this endpoint performed (promoted_by = 'votes'). A
    // human's direct pick has promoted_by = NULL and is never demoted by vote
    // arithmetic. Identity is the server-forwarded x-actor (attribution, not
    // authentication), so one person cannot vote twice by renaming themselves.
    method: "GET",
    pattern: /^\/api\/selections\/votes$/,
    handler: async ({ db, url }) => {
      const limit = Math.min(20000, Number(url.searchParams.get("limit") ?? 20000));
      const res = await db.prepare(
        "SELECT file_id, actor_id, actor_name, created_at FROM selection_votes ORDER BY created_at DESC LIMIT ?1",
      ).bind(limit).all<Record<string, unknown>>();
      return jsonResponse({ votes: res.results, threshold: VOTES_TO_PROMOTE });
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/selections\/votes$/,
    handler: async ({ request, db }) => {
      const actor = actorOf(request);
      if (!actor.id) return jsonResponse({ error: "x-actor required" }, 400);
      if (await overWriteLimit(db, actor.id, 600)) {
        return jsonResponse({ error: "too many writes in the last minute — slow down" }, 429);
      }
      const body = await readBody<{ file_id?: string }>(request);
      const fileId = (body.file_id ?? "").trim();
      if (!fileId) return jsonResponse({ error: "file_id required" }, 400);
      const row = await db.prepare(
        "SELECT file_id, state, actor_id, promoted_by FROM selections WHERE file_id = ?1",
      ).bind(fileId).first<{ file_id: string; state: string; actor_id: string; promoted_by: string | null }>();
      if (!row) return jsonResponse({ error: "not nominated — there is nothing to vote on" }, 404);
      const votable = row.state === "nominated" || (row.state === "chosen" && row.promoted_by === "votes");
      if (!votable) return jsonResponse({ error: `a ${row.state} image is not open for votes` }, 409);
      if (row.actor_id && row.actor_id === actor.id) {
        return jsonResponse({ error: "the nominator cannot vote for their own nomination" }, 400);
      }
      await db.prepare(
        `INSERT INTO selection_votes (file_id, actor_id, actor_name, created_at)
         VALUES (?1, ?2, ?3, datetime('now'))
         ON CONFLICT(file_id, actor_id) DO NOTHING`,
      ).bind(fileId, actor.id, actor.name).run();
      const n = await voteCount(db, fileId);
      let state = row.state;
      if (n >= VOTES_TO_PROMOTE && row.state !== "chosen") {
        // Guarded on the current state so a concurrent exclusion cannot be
        // clobbered by vote arithmetic.
        await db.prepare(
          "UPDATE selections SET state = 'chosen', promoted_by = 'votes', updated_at = datetime('now') WHERE file_id = ?1 AND state = 'nominated'",
        ).bind(fileId).run();
        state = "chosen";
      }
      return jsonResponse({ ok: true, file_id: fileId, votes: n, state, threshold: VOTES_TO_PROMOTE });
    },
  },
  {
    method: "DELETE",
    pattern: /^\/api\/selections\/votes$/,
    handler: async ({ request, db, url }) => {
      const actor = actorOf(request);
      if (!actor.id) return jsonResponse({ error: "x-actor required" }, 400);
      const fileId = (url.searchParams.get("file_id") ?? "").trim();
      if (!fileId) return jsonResponse({ error: "file_id required" }, 400);
      await db.prepare(
        "DELETE FROM selection_votes WHERE file_id = ?1 AND actor_id = ?2",
      ).bind(fileId, actor.id).run();
      const n = await voteCount(db, fileId);
      const row = await db.prepare(
        "SELECT state, promoted_by FROM selections WHERE file_id = ?1",
      ).bind(fileId).first<{ state: string; promoted_by: string | null }>();
      let state = row?.state ?? null;
      if (row && n < VOTES_TO_PROMOTE && row.state === "chosen" && row.promoted_by === "votes") {
        await db.prepare(
          "UPDATE selections SET state = 'nominated', promoted_by = NULL, updated_at = datetime('now') WHERE file_id = ?1 AND promoted_by = 'votes'",
        ).bind(fileId).run();
        state = "nominated";
      }
      return jsonResponse({ ok: true, file_id: fileId, votes: n, state, threshold: VOTES_TO_PROMOTE });
    },
  },
  {
    // -------------------------------------------------- sync change cursor
    method: "GET",
    pattern: /^\/api\/changes\/cursor$/,
    handler: async ({ db }) => {
      // One indexed row. A poll must never scan the item table.
      const row = await db.prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM change_log").first<{ seq: number }>();
      return jsonResponse({ seq: Number(row?.seq ?? 0) });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/changes$/,
    handler: async ({ db, url }) => {
      const since = Number(url.searchParams.get("since") ?? 0);
      const limit = Math.min(500, Number(url.searchParams.get("limit") ?? 200));
      const changes = await db.prepare(
        "SELECT seq, entity, entity_id, op, actor_id, at FROM change_log WHERE seq > ?1 ORDER BY seq LIMIT ?2",
      ).bind(since, limit).all<Record<string, unknown>>();
      const ids = changes.results.filter((c) => c.entity === "question").map((c) => Number(c.entity_id)).slice(0, 200);
      let questions: unknown[] = [];
      if (ids.length) {
        const holes = ids.map((_, i) => "?" + (i + 1)).join(",");
        const q = await db.prepare("SELECT * FROM questions WHERE id IN (" + holes + ")").bind(...ids).all<Record<string, unknown>>();
        questions = q.results;
      }
      const selIds = changes.results.filter((c) => c.entity === "selection").map((c) => String(c.entity_id)).slice(0, 200);
      let selections: unknown[] = [];
      if (selIds.length) {
        const holes = selIds.map((_, i) => "?" + (i + 1)).join(",");
        const s = await db.prepare("SELECT * FROM selections WHERE file_id IN (" + holes + ")").bind(...selIds).all<Record<string, unknown>>();
        selections = s.results;
      }
      const cursor = changes.results.length ? Number(changes.results[changes.results.length - 1].seq) : since;
      return jsonResponse({ cursor, questions, selections, n_changes: changes.results.length });
    },
  },
  {
    // ------------------------------------------- harness result ingestion
    method: "POST",
    pattern: /^\/api\/runs$/,
    handler: async ({ request, db, deps }) => {
      if (!canMeasure(request, deps)) return MEASURE_ERROR();
      const body = await readBody<{ run?: Record<string, unknown>; results?: Record<string, unknown>[] }>(request);
      const run = body.run ?? {};
      const results = Array.isArray(body.results) ? body.results : [];
      if (!results.length) return jsonResponse({ error: "results[] is required" }, 400);
      const runId = String(run.run_id ?? "");
      if (!runId) return jsonResponse({ error: "run.run_id is required" }, 400);
      // The client says when it has sent everything. The summaries are rebuilt only then, so a
      // 13-batch run recomputes once instead of thirteen times — see the note below, where the
      // per-batch version cost 1.3x the daily read allowance.
      //
      // A run whose final batch never arrives leaves the summaries un-rebuilt, which
      // `v_run_summary_drift` reports and the migration's backfill repairs. An incomplete run
      // should not be on the leaderboard anyway.
      const runFinal = run.final === true || run.final === 1 || run.final === "true";
      const stmts: PreparedStatement[] = [
        db.prepare(
          `INSERT INTO runs (run_id, model, provider, prompt_arm, temperature, max_tokens, n_items, notes)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
           ON CONFLICT(run_id) DO UPDATE SET n_items = ?7, notes = ?8`,
        ).bind(
          runId, String(run.model ?? ""), String(run.provider ?? ""), String(run.prompt_arm ?? run.prompt_id ?? "plain"),
          Number(run.temperature ?? 0), Number(run.max_tokens ?? 512),
          // The client's FULL-run count when it supplies one. A trace arrives in batches
          // and this row is upserted per batch, so binding the batch length made the
          // stored n_items equal the size of whichever batch happened to land last —
          // 100 for a 500-item run. The fallback keeps older clients working.
          Number(run.n_items ?? results.length), String(run.notes ?? ""),
        ),
      ];
      // THE SUMMARY IS RECOMPUTED ONCE PER RUN, NOT ONCE PER BATCH.
      //
      // Round 69 added these recomputes on EVERY batch, so each one scanned the run's rows
      // again. Measured on a real campaign (29 runs x 6 models x 2,500 items, batch 200):
      // 2,262 POSTs x a growing scan = **6,298,800 rows read, 1.3x the 5,000,000/day
      // allowance.** The read cost was MOVED from the leaderboard to the ingest, not removed.
      //
      // The client declares its final batch, so this runs once: 174 recomputes x 2,500 rows =
      // 435,000 rows read, 8.7% of the allowance.
      //
      // It is RECOMPUTED and never incremented, because a retry or a re-published run would
      // double-count if this added to the counters. Recomputing converges on the right answer
      // however many times it runs, which is what makes a materialised view safe here.
      if (runFinal) stmts.push(
        db.prepare(
          `INSERT OR REPLACE INTO run_summary
             (run_id, model, graded, correct, close, wrong, not_answered, updated_at)
           SELECT COALESCE(run_id, ''), model, COUNT(*),
                  SUM(CASE WHEN verdict = 'correct' THEN 1 ELSE 0 END),
                  SUM(CASE WHEN verdict = 'close'   THEN 1 ELSE 0 END),
                  SUM(CASE WHEN verdict = 'wrong'   THEN 1 ELSE 0 END),
                  SUM(CASE WHEN error IS NOT NULL  THEN 1 ELSE 0 END),
                  datetime('now')
           FROM evaluations
           WHERE verdict IS NOT NULL AND run_id = ?1
           GROUP BY COALESCE(run_id, ''), model`,
        ).bind(runId),
      );
      if (runFinal) stmts.push(
        db.prepare(
          `INSERT OR REPLACE INTO tag_summary (tags, run_id, model, graded, correct)
           SELECT COALESCE(q.tags, ''), COALESCE(e.run_id, ''), e.model,
                  COUNT(*),
                  SUM(CASE WHEN e.verdict = 'correct' THEN 1 ELSE 0 END)
           FROM evaluations e JOIN questions q ON q.id = e.question_id
           WHERE e.verdict IS NOT NULL AND e.error IS NULL AND e.run_id = ?1
           GROUP BY COALESCE(q.tags, ''), COALESCE(e.run_id, ''), e.model`,
        ).bind(runId),
      );
      for (const r of results) {
        stmts.push(
          db.prepare(
            `INSERT INTO evaluations (question_id, model, response, verdict, source, graded_by,
               abstained, confidence, frozen_verdict, groundtruth_hash, run_id, prompt_id, latency_ms, parse_ok,
               error, n_samples, unstable)
             VALUES (?1,?2,?3,?4,'harness',?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)
             -- THE RUN IS PART OF THE KEY (v5e). Without it a crop ladder or a corruption
             -- ladder had every condition overwrite the previous one, so the site kept only
             -- the last and showed 8 items while the trace held 168 — the round-30 "site and
             -- paper disagree" defect, silently, for every series.
             ON CONFLICT(question_id, model, run_id) DO UPDATE SET
               response = ?3, verdict = ?4, source = 'harness', graded_by = ?5,
               abstained = ?6, groundtruth_hash = ?9, run_id = ?10, prompt_id = ?11,
               latency_ms = ?12, parse_ok = ?13, frozen_verdict = ?8,
               error = ?14, n_samples = ?15, unstable = ?16`,
          ).bind(
            Number(r.question_id), String(r.model ?? run.model ?? ""), String(r.response ?? ""),
            r.verdict ?? null, "harness", Number(r.abstained ?? 0), r.confidence ?? null,
            r.verdict ?? null, String(r.groundtruth_hash ?? ""), String(r.run_id ?? runId),
            String(r.prompt_id ?? "plain"), r.latency_ms ?? null, Number(r.parse_ok ?? 1),
            // An errored item arrives with verdict NULL. It is stored, so the failure is
            // visible, but it can never enter an accuracy denominator.
            r.error ? String(r.error).slice(0, 300) : null,
            Number(r.n_samples ?? 1), Number(r.unstable ?? 0),
          ),
        );
      }
      await db.batch(stmts);
      return jsonResponse({ ok: true, run_id: runId, n_results: results.length });
    },
  },
  {
    // ------------------------------------------------- the blind filter result
    // `blind_passed` has existed in the schema with a comment explaining exactly
    // what it means, and nothing ever wrote or read it. This is its writer.
    //
    // Harness-gated: a blind result is a measurement, not an opinion, and letting
    // the open door set it would let anyone mark their own item as clean.
    //
    // Deliberately does NOT bump `rev`, so ingesting blind results cannot invalidate
    // an author's in-flight edit with a spurious conflict. The revision trigger still
    // records the change.
    method: "POST",
    pattern: /^\/api\/blind$/,
    handler: async ({ request, db, deps }) => {
      if (!canMeasure(request, deps)) return MEASURE_ERROR();
      const body = await readBody<{ results?: { question_id?: number; correct?: number | boolean }[] }>(request);
      const results = Array.isArray(body.results) ? body.results : [];
      if (!results.length) return jsonResponse({ error: "results[] is required" }, 400);
      const stmts: PreparedStatement[] = [];
      for (const r of results) {
        const qid = Number(r.question_id ?? 0);
        if (!qid) continue;
        stmts.push(
          db.prepare("UPDATE questions SET blind_passed = ?1 WHERE id = ?2")
            .bind(r.correct ? 1 : 0, qid),
        );
      }
      if (!stmts.length) return jsonResponse({ error: "no usable results" }, 400);
      await db.batch(stmts);
      const passed = results.filter((r) => r.correct).length;
      return jsonResponse({ ok: true, n: stmts.length, blind_passed: passed });
    },
  },
  // -------------------------------------------------------------------------
  // v6: THE VQA REVIEW ROOM. Model-drafted candidates land `pending`; only the
  // reviewer door decides. Ingest never touches the questions table.
  // -------------------------------------------------------------------------
  {
    method: "POST",
    pattern: /^\/api\/vqa\/ingest$/,
    handler: async ({ request, db, deps }) => {
      if (!canMeasure(request, deps)) return MEASURE_ERROR();
      const body = (await request.json().catch(() => null)) as
        | { batch?: string; rows?: Array<Record<string, unknown>> }
        | null;
      const batch = (body?.batch ?? "").trim().slice(0, 64);
      const rows = body?.rows;
      if (!batch || !Array.isArray(rows) || rows.length === 0) {
        return jsonResponse({ error: "batch and a non-empty rows array are required" }, 400);
      }
      if (rows.length > 250) return jsonResponse({ error: "at most 250 rows per ingest call" }, 413);
      const stmts = [];
      let invalid = 0;
      for (const r of rows) {
        const question = String(r.question ?? "").trim();
        const answer = String(r.answer ?? "").trim();
        const choices = Array.isArray(r.choices) ? r.choices.map((c) => String(c).trim()) : [];
        const fileId = String(r.file_id ?? "").trim();
        if (!fileId || question.length < 8 || !answer || choices.length < 2) { invalid++; continue; }
        stmts.push(db.prepare(
          "INSERT OR IGNORE INTO vqa_candidates (batch, file_id, ordinal, question, qnorm, choices, answer, grounding, capability, level, domain, difficulty, model, endpoint, prompt_version, run_id, image_sha256) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)",
        ).bind(
          batch, fileId, Number(r.ordinal ?? 0), question, deps.normQ(question), JSON.stringify(choices),
          answer, String(r.grounding ?? ""), String(r.capability ?? ""), String(r.level ?? ""),
          String(r.domain ?? ""), String(r.difficulty ?? ""), String(r.model ?? ""),
          String(r.endpoint ?? ""), String(r.prompt_version ?? ""), String(r.run_id ?? ""),
          String(r.image_sha256 ?? ""),
        ));
      }
      if (stmts.length) await db.batch(stmts);
      // Materialised per-image rows for the ones this request touched: indexed
      // reads on file_id, so keeping vqa_images exact is cheap even at 80k rows.
      const touched = [...new Set(rows.map((r) => String(r.file_id ?? "")).filter(Boolean))].slice(0, 250);
      if (touched.length) {
        await db.batch(touched.map((fid) => db.prepare(
          "INSERT INTO vqa_images (file_id, n, first_id, pending)"
          + " SELECT ?1, COUNT(*), MIN(id), SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END)"
          + " FROM vqa_candidates WHERE file_id = ?1"
          + " ON CONFLICT(file_id) DO UPDATE SET n = excluded.n, first_id = excluded.first_id, pending = excluded.pending",
        ).bind(fid)));
      }
      invalidateVqaCaches();
      const stored = await db.prepare("SELECT COUNT(*) AS n FROM vqa_candidates WHERE batch = ?1")
        .bind(batch).first<{ n: number }>();
      return jsonResponse({ ok: true, batch, attempted: rows.length, invalid, stored: Number(stored?.n ?? 0) });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/vqa\/candidates$/,
    handler: async ({ db, url }) => {
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));
      const where: string[] = [];
      const binds: unknown[] = [];
      const add = (col: string, val: string | null) => {
        if (!val) return;
        binds.push(val);
        where.push(col + " = ?" + binds.length);
      };
      add("status", url.searchParams.get("status"));
      add("capability", url.searchParams.get("capability"));
      add("level", url.searchParams.get("level"));
      add("domain", url.searchParams.get("domain"));
      add("file_id", url.searchParams.get("file_id"));
      const search = url.searchParams.get("search");
      if (search) { binds.push("%" + search + "%"); where.push("question LIKE ?" + binds.length); }
      const after = Number(url.searchParams.get("after") ?? 0);
      if (after > 0) { binds.push(after); where.push("id > ?" + binds.length); }
      binds.push(limit);
      const sql = "SELECT * FROM vqa_candidates"
        + (where.length ? " WHERE " + where.join(" AND ") : "")
        + " ORDER BY id ASC LIMIT ?" + binds.length;
      const res = await db.prepare(sql).bind(...binds).all();
      return jsonResponse({ candidates: res.results });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/vqa\/images$/,
    handler: async ({ db, url }) => {
      const cacheKey = url.searchParams.toString();
      const hit = vqaImagesCache.get(cacheKey);
      if (hit && Date.now() - hit.at < VQA_IMAGES_TTL_MS) {
        return new Response(hit.payload, { headers: { "content-type": "application/json; charset=utf-8" } });
      }
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 60)));
      const status = url.searchParams.get("status");
      const after = Number(url.searchParams.get("after") ?? 0);

      // Constant-cost path first: one row per image, 60 rows per page.
      const where2: string[] = [];
      const binds2: unknown[] = [];
      if (status === "pending") where2.push("pending > 0");
      if (after > 0) { binds2.push(after); where2.push("first_id > ?" + binds2.length); }
      binds2.push(limit);
      try {
        const fast = await db.prepare(
          "SELECT file_id, n, first_id, pending FROM vqa_images"
          + (where2.length ? " WHERE " + where2.join(" AND ") : "")
          + " ORDER BY first_id ASC LIMIT ?" + binds2.length,
        ).bind(...binds2).all<{ file_id: string; n: number; first_id: number; pending: number }>();
        if (fast.results.length) {
          const payload = JSON.stringify({
            images: fast.results.map((r) => ({
              file_id: r.file_id, n: r.n, first_id: r.first_id, has_pending: r.pending > 0 ? 1 : 0,
            })),
          });
          if (vqaImagesCache.size > 30) vqaImagesCache.clear();
          vqaImagesCache.set(cacheKey, { at: Date.now(), payload });
          return new Response(payload, { headers: { "content-type": "application/json; charset=utf-8" } });
        }
      } catch {
        // vqa_images not backfilled yet — fall through to the grouped query.
      }

      const where: string[] = [];
      const binds: unknown[] = [];
      if (status) { binds.push(status); where.push("status = ?" + binds.length); }
      if (after > 0) { binds.push(after); where.push("id > ?" + binds.length); }
      binds.push(limit);
      const sql = "SELECT file_id, COUNT(*) AS n, MIN(id) AS first_id,"
        + " MAX(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS has_pending"
        + " FROM vqa_candidates"
        + (where.length ? " WHERE " + where.join(" AND ") : "")
        + " GROUP BY file_id ORDER BY first_id ASC LIMIT ?" + binds.length;
      const res = await db.prepare(sql).bind(...binds).all();
      const payload = JSON.stringify({ images: res.results });
      if (vqaImagesCache.size > 30) vqaImagesCache.clear();
      vqaImagesCache.set(cacheKey, { at: Date.now(), payload });
      return new Response(payload, { headers: { "content-type": "application/json; charset=utf-8" } });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/vqa\/counts$/,
    handler: async ({ db }) => {
      if (vqaCountsCache && Date.now() - vqaCountsCache.at < VQA_COUNTS_TTL_MS) {
        return new Response(vqaCountsCache.payload, {
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }
      // Constant-cost path: three small materialised tables, but ONLY once a
      // backfill has initialised them (see vqa_meta in schema_v6b).
      try {
        const ready = await db.prepare("SELECT v FROM vqa_meta WHERE k = 'stats_initialised'").first<{ v: string }>();
        if (ready?.v === "1") {
          const stats = await db.prepare("SELECT status, n FROM vqa_stats").all<{ status: string; n: number }>();
        const dims = await db.prepare("SELECT kind, value, n FROM vqa_dims ORDER BY n DESC").all<{ kind: string; value: string; n: number }>();
        if (stats.results.length) {
          const byStatus: Record<string, number> = {};
          for (const r of stats.results) byStatus[r.status] = Number(r.n);
          const pick = (kind: string) => dims.results
            .filter((d) => d.kind === kind)
            .map((d) => ({ [kind]: d.value, n: d.n }));
          const payload = JSON.stringify({
            byStatus,
            byCapability: pick("capability"),
            byLevel: pick("level"),
            byDomain: pick("domain"),
            images: Number((await db.prepare("SELECT COUNT(*) AS n FROM vqa_images").first<{ n: number }>())?.n ?? 0),
            total: Object.values(byStatus).reduce((a, b) => a + b, 0),
          });
          vqaCountsCache = { at: Date.now(), payload };
          return new Response(payload, { headers: { "content-type": "application/json; charset=utf-8" } });
          }
        }
      } catch {
        // not backfilled yet — fall through
      }
      const status = await db.prepare("SELECT status, COUNT(*) AS n FROM vqa_candidates GROUP BY status")
        .all<{ status: string; n: number }>();
      const cap = await db.prepare("SELECT capability, COUNT(*) AS n FROM vqa_candidates GROUP BY capability ORDER BY n DESC").all();
      const lvl = await db.prepare("SELECT level, COUNT(*) AS n FROM vqa_candidates GROUP BY level ORDER BY level").all();
      const dom = await db.prepare("SELECT domain, COUNT(*) AS n FROM vqa_candidates GROUP BY domain ORDER BY n DESC").all();
      const img = await db.prepare("SELECT COUNT(DISTINCT file_id) AS n FROM vqa_candidates").first<{ n: number }>();
      const byStatus: Record<string, number> = {};
      for (const r of status.results) byStatus[r.status] = Number(r.n);
      const payload = JSON.stringify({
        byStatus, byCapability: cap.results, byLevel: lvl.results, byDomain: dom.results,
        images: Number(img?.n ?? 0),
        total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      });
      vqaCountsCache = { at: Date.now(), payload };
      return new Response(payload, { headers: { "content-type": "application/json; charset=utf-8" } });
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/vqa\/review$/,
    handler: async ({ request, db, deps }) => {
      if (!canApprove(request, deps)) return APPROVE_ERROR();
      const body = (await request.json().catch(() => null)) as
        | { candidate_id?: number; verdict?: string; reason?: string; reviewer?: string; edits?: Record<string, unknown> }
        | null;
      const id = Number(body?.candidate_id ?? 0);
      const verdict = String(body?.verdict ?? "");
      if (!id || !["approve", "edit", "reject"].includes(verdict)) {
        return jsonResponse({ error: "candidate_id and verdict approve|edit|reject are required" }, 400);
      }
      const reason = String(body?.reason ?? "").trim().slice(0, 500);
      if (verdict !== "approve" && !reason) return jsonResponse({ error: "a reason is required to edit or reject" }, 400);
      const edits = body?.edits && typeof body.edits === "object" ? body.edits : {};
      const existing = await db.prepare("SELECT id, file_id, status FROM vqa_candidates WHERE id = ?1")
        .bind(id).first<{ id: number; file_id: string; status: string }>();
      if (!existing) return jsonResponse({ error: "candidate not found" }, 404);

      const fields: string[] = [];
      const binds: unknown[] = [];
      const changed: Record<string, unknown> = {};
      for (const k of ["question", "choices", "answer", "grounding", "capability", "level", "domain", "difficulty"] as const) {
        if (!(k in edits)) continue;
        const v = edits[k];
        let val: string;
        if (k === "choices") {
          if (!Array.isArray(v) || v.length < 2) return jsonResponse({ error: "choices must be an array of at least 2" }, 400);
          val = JSON.stringify(v.map((x) => String(x).trim()));
        } else {
          val = String(v ?? "").trim();
          if ((k === "question" || k === "answer") && !val) return jsonResponse({ error: k + " cannot be empty" }, 400);
        }
        changed[k] = val;
        binds.push(val);
        fields.push(k + " = ?" + binds.length);
      }
      const status = verdict === "approve" ? "approved" : verdict === "edit" ? "edited" : "rejected";
      const reviewer = String(body?.reviewer ?? "").slice(0, 64);
      binds.push(status, reviewer, reason, id);
      const n = binds.length; // last four are ?n-3 (status), ?n-2 (reviewer), ?n-1 (reason), ?n (id)
      await db.batch([
        db.prepare("UPDATE vqa_candidates SET "
          + [...fields, "status = ?" + (n - 3), "reviewer = ?" + (n - 2),
             "reviewed_at = datetime('now')", "reason = ?" + (n - 1)].join(", ")
          + " WHERE id = ?" + n).bind(...binds),
        db.prepare("INSERT INTO vqa_reviews (candidate_id, reviewer, verdict, reason, changed) VALUES (?1, ?2, ?3, ?4, ?5)")
          .bind(id, reviewer, verdict, reason, JSON.stringify(changed)),
      ]);
      const updated = await db.prepare("SELECT * FROM vqa_candidates WHERE id = ?1").bind(id).first();
      invalidateVqaCaches();
      // Keep the materialised counters exact: one decrement for the old status,
      // one increment for the new one, and the image's pending count moves only
      // when the item crosses the pending boundary.
      if (existing && existing.status !== status) {
        try {
          const ready = await db.prepare("SELECT v FROM vqa_meta WHERE k = 'stats_initialised'").first<{ v: string }>();
          const wasPending = existing.status === "pending";
          const delta = wasPending ? -1 : 0;
          const maint = ready?.v === "1" ? [
            db.prepare("UPDATE vqa_stats SET n = MAX(0, n - 1) WHERE status = ?1").bind(existing.status),
            db.prepare("INSERT INTO vqa_stats (status, n) VALUES (?1, 1) ON CONFLICT(status) DO UPDATE SET n = n + 1").bind(status),
          ] : [];
          if (delta !== 0) {
            maint.push(db.prepare("UPDATE vqa_images SET pending = MAX(0, pending + ?1) WHERE file_id = ?2")
              .bind(delta, existing.file_id));
          }
          if (maint.length) await db.batch(maint);
        } catch {
          // Materialised tables not ready yet (migration 0011 / backfill); the
          // decision itself is already committed and is the source of truth.
        }
      }
      return jsonResponse({ ok: true, candidate: updated });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/vqa\/search$/,
    handler: async ({ db, url }) => {
      // Filtered search is the one dynamic read left. Edge-cached so a popular
      // query costs D1 one scan per TTL per colo, not one per visit.
      const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
      const key = new Request(url.toString(), { method: "GET" });
      if (cache) {
        try {
          const hit = await cache.match(key);
          if (hit) return hit;
        } catch { /* cache unavailable */ }
      }
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));
      const where: string[] = [];
      const binds: unknown[] = [];
      const add = (col: string, val: string | null) => {
        if (!val) return;
        binds.push(val);
        where.push(col + " = ?" + binds.length);
      };
      add("capability", url.searchParams.get("capability"));
      add("level", url.searchParams.get("level"));
      add("domain", url.searchParams.get("domain"));
      const search = url.searchParams.get("search");
      if (search) { binds.push("%" + search + "%"); where.push("question LIKE ?" + binds.length); }
      const after = Number(url.searchParams.get("after") ?? 0);
      if (after > 0) { binds.push(after); where.push("id > ?" + binds.length); }
      binds.push(limit);
      const rows = await db.prepare(
        "SELECT id, file_id, question, answer, capability, level, domain, difficulty"
        + " FROM vqa_candidates"
        + (where.length ? " WHERE " + where.join(" AND ") : "")
        + " ORDER BY id ASC LIMIT ?" + binds.length,
      ).bind(...binds).all();
      const response = new Response(JSON.stringify({ candidates: rows.results }), {
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60" },
      });
      if (cache) {
        try { await cache.put(key, response.clone()); } catch { /* ignore */ }
      }
      return response;
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/vqa\/decision$/,
    handler: async ({ request, db, deps }) => {
      if (!canApprove(request, deps)) return APPROVE_ERROR();
      const body = (await request.json().catch(() => null)) as
        | {
          scope?: string; id?: string; verdict?: string; reason?: string; reviewer?: string;
          edits?: Record<string, unknown>; batch?: string; file_id?: string;
        }
        | null;
      const verdict = String(body?.verdict ?? "");
      const batch = String(body?.batch ?? "").slice(0, 64);
      const fileId = String(body?.file_id ?? "").slice(0, 128);
      const reviewer = String(body?.reviewer ?? "").slice(0, 64);
      const reason = String(body?.reason ?? "").trim().slice(0, 500);

      // IMAGE SCOPE — the review room's normal verdict. A reviewer edits whatever
      // they want across the image's questions and approves (or rejects) the image
      // once. The row is keyed by the image, so a later re-export of candidates
      // cannot orphan it, and `clear` removes it (undo after approving).
      if (body?.scope === "image") {
        if (!fileId) return jsonResponse({ error: "file_id is required for an image decision" }, 400);
        if (!["approve", "reject", "clear"].includes(verdict)) {
          return jsonResponse({ error: "image verdict must be approve|reject|clear" }, 400);
        }
        if (verdict === "reject" && !reason) return jsonResponse({ error: "a reason is required to reject" }, 400);
        const id = "img:" + (await sha256Hex(`${batch}|${fileId}`)).slice(0, 24);
        if (verdict === "clear") {
          await db.prepare("DELETE FROM vqa_decisions WHERE cand_id = ?1").bind(id).run();
          return jsonResponse({ ok: true, id, verdict: "clear" });
        }
        const edits = body?.edits && typeof body.edits === "object" ? JSON.stringify(body.edits).slice(0, 20000) : "";
        await db.prepare(
          "INSERT INTO vqa_decisions (cand_id, batch, file_id, verdict, reviewer, reason, edits)"
          + " VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
          + " ON CONFLICT(cand_id) DO UPDATE SET verdict = excluded.verdict, reviewer = excluded.reviewer,"
          + " reason = excluded.reason, edits = excluded.edits, updated_at = datetime('now')",
        ).bind(id, batch, fileId, verdict, reviewer, reason, edits).run();
        return jsonResponse({ ok: true, id, verdict });
      }

      const id = String(body?.id ?? "").trim().slice(0, 32);
      if (!id || !["approve", "edit", "reject", "clear"].includes(verdict)) {
        return jsonResponse({ error: "id and verdict approve|edit|reject|clear are required" }, 400);
      }
      if (verdict === "clear") {
        await db.prepare("DELETE FROM vqa_decisions WHERE cand_id = ?1").bind(id).run();
        return jsonResponse({ ok: true, id, verdict: "clear" });
      }
      if (verdict !== "approve" && !reason) return jsonResponse({ error: "a reason is required to edit or reject" }, 400);
      const edits = body?.edits && typeof body?.edits === "object" ? JSON.stringify(body.edits).slice(0, 4000) : "";
      await db.prepare(
        "INSERT INTO vqa_decisions (cand_id, batch, file_id, verdict, reviewer, reason, edits)"
        + " VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
        + " ON CONFLICT(cand_id) DO UPDATE SET verdict = excluded.verdict, reviewer = excluded.reviewer,"
        + " reason = excluded.reason, edits = excluded.edits, updated_at = datetime('now')",
      ).bind(id, batch, fileId, verdict, reviewer, reason, edits).run();
      // Edge cache: the decisions read is cached, so a fresh decision can take up
      // to the TTL to appear for other visitors. That is the price of free reads.
      return jsonResponse({ ok: true, id, verdict });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/vqa\/decisions$/,
    handler: async ({ db, url }) => {
      // Served from the Cloudflare edge cache when warm; D1 is read at most once
      // per TTL per colo, so a million visits do not become a million reads.
      const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
      const key = new Request(url.toString(), { method: "GET" });
      if (cache) {
        try {
          const hit = await cache.match(key);
          if (hit) return hit;
        } catch { /* cache unavailable in this runtime */ }
      }
      const res = await db.prepare(
        "SELECT cand_id AS id, batch, file_id, verdict, reviewer, reason, edits, updated_at FROM vqa_decisions ORDER BY updated_at",
      ).all();
      const response = new Response(JSON.stringify({ decisions: res.results }), {
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=30" },
      });
      if (cache) {
        try {
          await cache.put(key, response.clone());
        } catch { /* ignore: a cache miss is correct, a failed put is not fatal */ }
      }
      return response;
    },
  },
];

export * from "./actor";

export interface QuestionsApi {
  /** Route /api/questions*, /api/evaluations, /api/insights, /api/excluded.
   *  Returns null for non-questions paths (let the worker decide 404). */
  handle(request: Request, url: URL): Promise<Response | null>;
  /** Prefixes owned by this API. */
  prefixRe: RegExp;
}

export function createQuestionsApi(deps: QuestionsApiDeps): QuestionsApi {
  const prefixRe = /^\/api\/(questions|evaluations|insights|excluded|graphs|selections|changes|runs|blind|vqa)/;
  return {
    prefixRe,
    async handle(request: Request, url: URL): Promise<Response | null> {
      const p = url.pathname;
      if (!prefixRe.test(p)) return null;
      if (request.method === "OPTIONS") return null; // handled by CORS preflight in worker

      if (!deps.db) {
        return jsonResponse({ error: "questions API is not configured (missing D1 binding)" }, 503);
      }

      // No global gate. Authorisation is per-route: reads and drafts are open,
      // approval and measurement check their own secret inside the handler.
      const db = deps.db;
      for (const route of ROUTES) {
        if (request.method !== route.method) continue;
        if (!route.pattern.test(p)) continue;
        try {
          return await route.handler({ request, db, deps, url });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/UNIQUE/i.test(msg)) return jsonResponse({ error: "duplicate — an identical question already exists for this image" }, 409);
          return jsonResponse({ error: msg }, 500);
        }
      }
      return jsonResponse({ error: "not found" }, 404);
    },
  };
}

function answer_type_label(t: string): string {
  return t === "yesno" ? "yes/no" : t === "choice" ? "multiple-choice" : t;
}
