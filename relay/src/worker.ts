import {
  convertToModelMessages,
  createGateway,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { z } from "zod";

export interface Env {
  GATEWAY_KEY?: string;
  GATEWAY_MODEL?: string;
  ACCESS_CODE?: string;
  RATE_LIMIT_PER_IP?: string;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Access-Code",
  "Access-Control-Max-Age": "86400",
};

const json = (obj: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

/* per-IP daily cap (best-effort, in-memory) */
const rateMap = new Map();
function allowIp(ip: string, limit: number) {
  const day = Math.floor(Date.now() / 86400000);
  const rec = rateMap.get(ip);
  if (!rec || rec.day !== day) {
    rateMap.set(ip, { day, count: 1 });
    return true;
  }
  if (rec.count >= limit) return false;
  rec.count++;
  return true;
}

function ipOf(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ??
    "unknown"
  );
}

/**
 * Rich, versioned schema brief — the model sees exact DDL + semantics, so it
 * writes correct SQL instead of hallucinating column types.
 */
const SYSTEM_PROMPT = `You are the data analyst for agi-eval-data — an AGI benchmark dataset of real-world images where vision models fail, plus geometric reasoning problems. Answer questions by writing SQL against DuckDB.

SCHEMA (exact):

CREATE TABLE images (
  id VARCHAR,          -- Google Drive file ID
  name VARCHAR,        -- original filename
  ext VARCHAR,         -- lowercase extension without dot ('jpg','png',…)
  size BIGINT,         -- bytes
  day VARCHAR,         -- upload date 'YYYY-MM-DD' (string compare/LIKE works)
  owner VARCHAR,       -- contributor email; join owners for display name
  md5 VARCHAR,         -- content hash; duplicates share md5
  kind VARCHAR,        -- 'i' image | 'v' video | 'o' other
  width INT,           -- EXIF pixel width (NULL if unknown)
  height INT,          -- EXIF pixel height (NULL if unknown)
  megapixels DOUBLE,   -- width*height/1e6 (NULL if unknown)
  camera VARCHAR,      -- EXIF camera model (NULL if unknown)
  orientation VARCHAR  -- 'landscape' | 'portrait' | 'square' (NULL if unknown)
);
CREATE TABLE owners (email VARCHAR, name VARCHAR);
CREATE TABLE dup_groups (md5 VARCHAR, copies BIGINT, bytes BIGINT);

SEMANTICS:
- "pictures/images" = kind='i'. Videos are kind='v' and are excluded from picture counts.
- unique images = COUNT(DISTINCT md5) (NULL md5 rows count separately).
- duplicates: md5 shared by >1 row. Wasted bytes = (copies-1)*size per group; dup_groups pre-aggregates this.
- orientation/width/height/camera come from EXIF; they are NULL when unknown — never guess them.
- day is a VARCHAR 'YYYY-MM-DD': filter with day >= '2026-08-01' or day LIKE '2026-08-%'.

RULES:
- You have the run_sql tool. For ANY question about the data, call it first and answer from the real result — never invent numbers.
- Ask for at most one query per step. If the first result is not enough, call run_sql again with a refined query.
- Final answers: concise, lead with the number, add one line of context.`;

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
      return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === "/api/health")
      return json({ ok: true, service: "agi-eval-relay" }, 200, { ...CORS });

    if (url.pathname === "/api/info")
      return json(
        { model: env.GATEWAY_MODEL ?? "unset", transport: "ai-sdk-v5" },
        200,
        { ...CORS },
      );

    if (url.pathname === "/api/chat" && request.method === "POST") {
      if (env.ACCESS_CODE && request.headers.get("x-access-code") !== env.ACCESS_CODE)
        return json({ error: "invalid access code" }, 401, { ...CORS });

      const limit = Number(env.RATE_LIMIT_PER_IP || 30);
      if (!allowIp(ipOf(request), limit))
        return json(
          {
            error: `daily limit reached for your address (${limit} questions/day). Add your own key via settings, or try again after 00:00 UTC.`,
          },
          429,
          { ...CORS },
        );

      if (!env.GATEWAY_KEY)
        return json(
          { error: "pooled chat is not configured (missing GATEWAY_KEY)" },
          503,
          { ...CORS },
        );

      const { messages } = (await request.json()) as { messages: UIMessage[] };

      const gw = createGateway({ apiKey: env.GATEWAY_KEY });
      const result = streamText({
        model: gw(env.GATEWAY_MODEL || "openai/gpt-5-nano"),
        system: SYSTEM_PROMPT,
        messages: await convertToModelMessages(messages),
        tools: { run_sql: runSqlTool },
        stopWhen: stepCountIs(6),
        abortSignal: request.signal,
      });

      // UI message stream (SSE) with CORS — cross-origin from pages.dev
      return new Response(result.toUIMessageStream(), {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "x-vercel-ai-ui-message-stream": "v1",
          ...CORS,
        },
      });
    }

    return json({ error: "not found" }, 404, { ...CORS });
  },
} satisfies ExportedHandler<Env>;
