/**
 * metro-eval relay — Cloudflare Worker.
 *
 * Questions + evaluations API only (D1-backed). NO AI chat: the metro site has
 * no /ask page; the AI chat lives on the foundation site only.
 *
 * Routes (under /api/questions and /api/evaluations):
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
 *   GET  /api/excluded                      → { excluded: [...] }
 *   POST /api/excluded                      → { ok: true }
 *   DELETE /api/excluded?file_id=           → { ok: true }
 *
 * Gate: when env.QUESTIONS_CODE is set, every request must carry header
 * `x-questions-code` with the matching value. Unset = open (local dev only —
 * set the secret before exposing this publicly).
 */
import { handleQuestionsApi, type Env } from "./questions";
import { CORS_HEADERS, jsonResponse as json } from "./http";

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: CORS_HEADERS });

    if (url.pathname === "/api/health")
      return json({ ok: true, service: "metro-eval-relay" }, 200, { ...CORS_HEADERS });

    if (
      url.pathname.startsWith("/api/questions") ||
      url.pathname.startsWith("/api/evaluations") ||
      url.pathname.startsWith("/api/insights") ||
      url.pathname.startsWith("/api/excluded")
    ) {
      if (!env.DB)
        return json({ error: "questions API is not configured (missing D1 binding)" }, 503, { ...CORS_HEADERS });
      const questionsResponse = await handleQuestionsApi(request, env, url);
      if (questionsResponse) return questionsResponse;
    }

    return json({ error: "not found" }, 404, { ...CORS_HEADERS });
  },
} satisfies ExportedHandler<Env>;
