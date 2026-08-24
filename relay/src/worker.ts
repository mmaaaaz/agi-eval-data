import {
  convertToModelMessages,
  createGateway,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  UI_MESSAGE_STREAM_HEADERS,
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
 * Rich schema brief — the model sees exact DDL + semantics so it writes
 * correct SQL instead of hallucinating column types.
 */
const SYSTEM_PROMPT = `You are the data analyst for agi-eval-data — an AGI benchmark dataset of real-world images where vision models fail, plus geometric reasoning problems.

SCOPE: Answer ONLY questions about this dataset, its stats, or the project. For anything else, reply with exactly one line: "I only answer questions about the agi-eval-data dataset." — nothing more.

STYLE:
- Lead with the exact answer (number/name/list). Then at most 1–2 short context sentences.
- No filler, no apologies, no restating the question, no offers to "break it down further" unless asked.

CONTRIBUTORS:
- Match contributors by their EXACT owner email (given in the user message as CONTRIBUTOR MATCHES). Never guess names or emails, never use name-pattern matching.

DATA RULES:
- "pictures/images" = kind='i'. Videos (kind='v') are excluded from picture counts.
- unique images = COUNT(DISTINCT md5). Duplicates: md5 shared by >1 row.
- day is VARCHAR 'YYYY-MM-DD': use day >= '2026-08-01' or day LIKE '2026-08-%'.
- orientation/width/height/camera are EXIF columns; NULL when unknown — never guess.

SQL:
- Call run_sql for ANY data question — answer from the real result, never invent numbers.
- Call run_sql at most ONCE per user question. After the result arrives, answer immediately.
- Single SELECT, LIMIT auto-added (200).`;

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

      const stream = createUIMessageStream({
        execute: ({ writer }) => {
          writer.merge(result.toUIMessageStream());
        },
        onError: (e) => `AI error: ${e instanceof Error ? e.message : String(e)}`,
      });

      return createUIMessageStreamResponse({
        stream,
        headers: { ...UI_MESSAGE_STREAM_HEADERS, ...CORS },
      });
    }

    return json({ error: "not found" }, 404, { ...CORS });
  },
} satisfies ExportedHandler<Env>;
