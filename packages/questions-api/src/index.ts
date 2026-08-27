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
 * Gate: when deps.questionsCode is set, every request must carry header
 * `x-questions-code` with the matching value. Unset = open (local dev only —
 * set the secret before exposing this publicly).
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
  /** gate secret (unset = open) */
  questionsCode?: string;
  normQ: (q: string) => string;
  normTags: (raw: string) => string[];
}

/** Canonical HTTP constants + helpers for the questions API — single source of CORS. */
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Access-Code, X-Questions-Code",
  "Access-Control-Max-Age": "86400",
};

export function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function gated(request: Request, deps: QuestionsApiDeps): boolean {
  if (!deps.questionsCode) return true; // not configured — local/dev only
  return request.headers.get("x-questions-code") === deps.questionsCode;
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
}): Promise<number> {
  const qnorm = deps.normQ(payload.question);
  const status = payload.answer.trim() === "" && payload.answer_type === "text" ? "draft" : "approved";
  const tagList = deps.normTags(payload.tags.join(","));
  const stmts: PreparedStatement[] = [
    db.prepare(
      "INSERT INTO questions (file_id, contributor, question, qnorm, answer_type, answer, choices, difficulty, tags, status) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
    ).bind(
      payload.file_id, payload.contributor, payload.question, qnorm,
      payload.answer_type, payload.answer, payload.choices, payload.difficulty,
      tagList.join(","), status,
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
  return Number(meta?.last_row_id ?? 0);
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
      const fileId = url.searchParams.get("file_id");
      const search = url.searchParams.get("search");
      const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 50));
      let stmt: PreparedStatement;
      if (fileId) {
        stmt = db.prepare("SELECT * FROM questions WHERE file_id = ?1 ORDER BY id DESC").bind(fileId);
      } else if (search) {
        stmt = db.prepare("SELECT * FROM questions WHERE question LIKE ?1 ORDER BY id DESC LIMIT ?2")
          .bind("%" + search + "%", limit);
      } else {
        stmt = db.prepare("SELECT * FROM questions ORDER BY id DESC LIMIT ?1").bind(limit);
      }
      const res = await stmt.all<QuestionRow>();
      return jsonResponse({ questions: res.results });
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/questions$/,
    handler: async ({ request, db, deps, url }) => {
      const body = await readBody<{
        file_id?: string;
        contributor?: string;
        question?: string;
        answer_type?: string;
        answer?: string;
        choices?: string;
        difficulty?: string;
        tags?: string;
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
      try {
        const id = await insertQuestion(db, deps, {
          file_id: fileId,
          contributor: (body.contributor ?? "").trim(),
          question,
          answer_type: answerType,
          answer,
          choices: body.choices ?? "",
          difficulty,
          tags: deps.normTags(body.tags ?? ""),
        });
        return jsonResponse({ id });
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
      const row = await db.prepare("SELECT tags FROM questions WHERE id = ?1").bind(id).first<{ tags: string }>();
      if (!row) return jsonResponse({ error: "not found" }, 404);
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
          parts.push(JSON.stringify({
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
        `INSERT INTO evaluations (question_id, model, response, verdict, source, graded_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(question_id, model) DO UPDATE SET
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
      const board = await db.prepare(
        `SELECT model,
           COUNT(*) AS graded,
           SUM(CASE WHEN verdict = 'correct' THEN 1 ELSE 0 END) AS correct,
           SUM(CASE WHEN verdict = 'close' THEN 1 ELSE 0 END) AS close,
           SUM(CASE WHEN verdict = 'wrong' THEN 1 ELSE 0 END) AS wrong
         FROM evaluations WHERE verdict IS NOT NULL
         GROUP BY model ORDER BY SUM(verdict = 'correct') * 1.0 / COUNT(*) DESC`,
      ).all<{ model: string; graded: number; correct: number; close: number; wrong: number }>();

      const joined = await db.prepare(
        `SELECT q.tags AS tags, e.model AS model, e.verdict AS verdict
         FROM evaluations e JOIN questions q ON q.id = e.question_id
         WHERE e.verdict IS NOT NULL`,
      ).all<{ tags: string; model: string; verdict: string }>();
      const tagAgg = new Map<string, { graded: number; correct: number }>();
      for (const row of joined.results) {
        for (const tag of deps.normTags(row.tags)) {
          const agg = tagAgg.get(tag) ?? { graded: 0, correct: 0 };
          agg.graded++;
          if (row.verdict === "correct") agg.correct++;
          tagAgg.set(tag, agg);
        }
      }
      const byTag = [...tagAgg.entries()]
        .map(([tag, v]) => ({ tag, ...v }))
        .sort((a, b) => b.graded - a.graded)
        .slice(0, 50);
      return jsonResponse({ leaderboard: board.results, byTag });
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
];

export interface QuestionsApi {
  /** Route /api/questions*, /api/evaluations, /api/insights, /api/excluded.
   *  Returns null for non-questions paths (let the worker decide 404). */
  handle(request: Request, url: URL): Promise<Response | null>;
  /** Prefixes owned by this API. */
  prefixRe: RegExp;
}

export function createQuestionsApi(deps: QuestionsApiDeps): QuestionsApi {
  const prefixRe = /^\/api\/(questions|evaluations|insights|excluded|graphs)/;
  return {
    prefixRe,
    async handle(request: Request, url: URL): Promise<Response | null> {
      const p = url.pathname;
      if (!prefixRe.test(p)) return null;
      if (request.method === "OPTIONS") return null; // handled by CORS preflight in worker

      if (!deps.db) {
        return jsonResponse({ error: "questions API is not configured (missing D1 binding)" }, 503);
      }

      if (!gated(request, deps)) {
        return jsonResponse({ error: "questions API is locked — set the access code in settings" }, 401);
      }

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
