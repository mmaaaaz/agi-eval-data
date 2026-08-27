/**
 * Questions + evaluations API factory (D1-backed).
 *
 * Routes (all under /api/questions and /api/evaluations):
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
];

export interface QuestionsApi {
  /** Route /api/questions*, /api/evaluations, /api/insights, /api/excluded.
   *  Returns null for non-questions paths (let the worker decide 404). */
  handle(request: Request, url: URL): Promise<Response | null>;
  /** Prefixes owned by this API. */
  prefixRe: RegExp;
}

export function createQuestionsApi(deps: QuestionsApiDeps): QuestionsApi {
  const prefixRe = /^\/api\/(questions|evaluations|insights|excluded)/;
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
