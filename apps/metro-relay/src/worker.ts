/**
 * metro-eval relay — Cloudflare Worker.
 *
 * Questions + evaluations API only (D1-backed). NO AI chat: the metro site has
 * no /ask page; the AI chat lives on the foundation site only.
 *
 * All questions/evaluations/insights/excluded routes are handled by the shared
 * @questions-api factory (see packages/questions-api). The D1 database is the
 * metro-eval-questions binding (wrangler.toml) — separate from agi-eval-questions.
 */
import { createQuestionsApi } from "@questions-api";
import { normQ, normTags } from "@agi-eval/shared";
import { CORS_HEADERS, jsonResponse as json } from "./http";

/** Worker env — D1 binding + optional questions gate. */
interface Env {
  DB?: D1Database;
  QUESTIONS_CODE?: string;
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: CORS_HEADERS });

    if (url.pathname === "/api/health")
      return json({ ok: true, service: "metro-eval-relay" }, 200, { ...CORS_HEADERS });

    const qapi = createQuestionsApi({ db: env.DB, questionsCode: env.QUESTIONS_CODE, normQ, normTags });
    const questionsResponse = await qapi.handle(request, url);
    if (questionsResponse) return questionsResponse;

    return json({ error: "not found" }, 404, { ...CORS_HEADERS });
  },
} satisfies ExportedHandler<Env>;
