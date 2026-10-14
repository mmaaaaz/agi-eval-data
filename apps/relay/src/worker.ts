// THE AI SDK IS NO LONGER IMPORTED. The chat route was retired and the [ai] binding removed,
// so nothing here needs it - **and the Worker bundle fell from 888 KiB to 183 KiB when it
// went.** A dependency kept for a route that cannot run is a spend surface kept for a
// capability that was taken away.
import {
  ACTOR_COOKIE,
  actorSetCookie,
  createQuestionsApi,
  hasCode,
  issueActor,
  parseCookies,
  verifyActor,
} from "@questions-api";
import { normQ, normTags } from "@agi-eval/shared";
import { CORS_HEADERS, jsonResponse as json } from "./http";
import { z } from "zod";

// Worker env - the D1 binding and the door secrets. NO AI binding: see the retirement note
interface Env {
  DB?: D1Database;
  /** reviewer secret: the only door that may approve ground truth */
  QUESTIONS_CODE?: string;
  /** harness secret: the only door that may write measurements */
  HARNESS_CODE?: string;
  /** signs the server-issued actor id. Unset = fall back to the client's id. */
  ACTOR_SECRET?: string;
  GATEWAY_MODEL?: string;
  ACCESS_CODE?: string;
  RATE_LIMIT_PER_IP?: string;
}

/** Workers AI model used when the gateway rate-limits (free 10k neurons/day). */
const FALLBACK_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/* client-side tool: executed in the visitor's browser against DuckDB WASM.
   No `execute` here — the AI SDK forwards the call to the client. */
const runSqlTool = {
  description:
    "Execute a read-only SELECT (DuckDB dialect) against the dataset tables. Use for ANY precise count, filter, group-by, ranking or listing question.",
  inputSchema: z.object({
    sql: z
      .string()
      .describe("Single SELECT statement. LIMIT is added automatically (200) if missing."),
  }),
};

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: CORS_HEADERS });

    if (url.pathname === "/api/health")
      return json({ ok: true, service: "agi-eval-relay" }, 200, { ...CORS_HEADERS });

    if (url.pathname === "/api/info")
      return json(
        { model: env.GATEWAY_MODEL ?? "unset", transport: "ai-sdk-v5" },
        200,
        { ...CORS_HEADERS },
      );

    if (url.pathname === "/api/chat" && request.method === "POST") {
      // THIS DOOR FAILS CLOSED, LIKE THE OTHER TWO. It was `if (env.ACCESS_CODE && ...)`,
      // so an UNSET secret meant no authentication at all — the opposite of the rule this
      // project states about itself in wrangler.toml: an unset secret DISABLES the door.
      //
      // ---------------------------------------------------------------------------
      // AND THE ROUTE IS NOW RETIRED, WHICH IS THE SPEND RULE RATHER THAN A PREFERENCE.
      //
      // The owner's constraint is that the ONLY thing that may cost money is inference on
      // images. This route was the last surface that could cost money on CLOUDFLARE instead:
      // it reached Workers AI through the `[ai]` binding as a fallback, and an AI gateway
      // before that.
      //
      // **The chat PAGE was deleted in round 129, so nothing in the repository calls this.**
      // The route survived as dead code that could still spend if anyone found the URL. The
      // `[ai]` binding is removed from wrangler.toml and the client library is no longer
      // imported, so the capability is GONE rather than merely unreachable.
      //
      // The door is kept and still checked FIRST, so the 401 assertions in worker.test.ts keep
      // meaning what they meant: the door closes before anything else happens.
      // ---------------------------------------------------------------------------
      if (!hasCode(request.headers.get("x-access-code"), env.ACCESS_CODE)) {
        return json({ error: env.ACCESS_CODE
          ? "invalid access code"
          : "chat is disabled: ACCESS_CODE is not set on this worker" }, 401, { ...CORS_HEADERS });
      }
      return json({
        error: "the chat endpoint is retired",
        detail: "It could spend on Cloudflare, and the only permitted spend is inference on "
          + "images. The page was removed; this route is kept only so an old client gets a "
          + "clear answer rather than a 404.",
      }, 410, { ...CORS_HEADERS });
    }

    if (!env.DB) return json({ error: "questions API is not configured (missing D1 binding)" }, 503, { ...CORS_HEADERS });
    // Two doors, and both privileged ones FAIL CLOSED. An unset secret disables the
    // door rather than opening it: reads and drafts stay open, but nothing can be
    // approved and no measurement can be written. Warning, not opening.
    if (!env.QUESTIONS_CODE) console.warn("[relay] QUESTIONS_CODE is unset: approval is DISABLED (fail closed). Set it to review items.");
    if (!env.HARNESS_CODE) console.warn("[relay] HARNESS_CODE is unset: measurement ingest is DISABLED (fail closed). Set it to record model runs.");
    // SERVER-ISSUED ACTOR IDENTITY.
    //
    // Not authentication, and it must not be described as such. The point is that
    // an id in the ledger should be one this server chose and can verify, so a
    // contributor cannot impersonate someone else by editing localStorage. If the
    // secret is unset we fall back to the client's id and say so, because
    // attribution is not a gate and blocking it would break authoring entirely.
    let setCookie: string | null = null;
    let actorId = "";
    if (env.ACTOR_SECRET) {
      const jar = parseCookies(request.headers.get("cookie"));
      actorId = (await verifyActor(env.ACTOR_SECRET, jar[ACTOR_COOKIE])) ?? "";
      if (!actorId) {
        const issued = await issueActor(env.ACTOR_SECRET);
        actorId = issued.id;
        setCookie = actorSetCookie(issued.cookie, url.protocol === "https:");
      }
    } else {
      console.warn("[relay] ACTOR_SECRET is unset: attribution falls back to the client-supplied id.");
    }
    const forwardedHeaders = new Headers(request.headers);
    if (actorId) forwardedHeaders.set("x-actor", actorId);
    forwardedHeaders.delete("cookie");
    const forwarded = new Request(request, { headers: forwardedHeaders });

    const qapi = createQuestionsApi({
      db: env.DB,
      questionsCode: env.QUESTIONS_CODE,
      harnessCode: env.HARNESS_CODE,
      normQ,
      normTags,
    });
    const questionsResponse = await qapi.handle(forwarded, url);
    if (questionsResponse) {
      if (setCookie) questionsResponse.headers.append("Set-Cookie", setCookie);
      return questionsResponse;
    }

    return json({ error: "not found" }, 404, { ...CORS_HEADERS });
  },
} satisfies ExportedHandler<Env>;
