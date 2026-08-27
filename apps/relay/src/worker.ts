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
import { createQuestionsApi } from "@questions-api";
import { normQ, normTags } from "@agi-eval/shared";
import { CORS_HEADERS, jsonResponse as json } from "./http";

/** Workers AI model used when the gateway rate-limits (free 10k neurons/day). */
const FALLBACK_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const RATE_LIMIT_RE = /rate[- ]?limit|429|free tier|quota|too many requests/i;
/** After a gateway rate-limit, route around it for this long (sticky per isolate). */
const FALLBACK_WINDOW_MS = 3 * 60_000;
let gwFallbackUntil = 0;
/** Overflow prompt: no SQL tool (Workers AI tool-calling proved unreliable) —
 *  answer narratively and say when precise numbers are unavailable. */
const FALLBACK_SYSTEM_PROMPT = `You are the assistant for agi-eval-data — an AGI benchmark dataset of real-world images where vision models fail, plus geometric reasoning problems (~45k images, 7 contributors, syncing hourly from Google Drive).
Questions ABOUT the dataset, its purpose, stats or project: answer directly and helpfully. The precise SQL tool is temporarily unavailable (the primary model is rate-limited), so if a question needs an exact count, ranking or filter, say: "Precise numbers are temporarily unavailable — ask again in a couple of minutes." Keep answers to 1-3 sentences. Off-topic questions: reply with exactly one line: "I only answer questions about the agi-eval-data dataset."`;
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
- Match contributors ONLY by their EXACT owner email (given in the user message as CONTRIBUTOR MATCHES). Never guess names or emails, never use name-pattern matching. If a CONTRIBUTOR MATCHES block lists people the user did not ask about, IGNORE it.

DATA RULES:
- "pictures/images" = kind='i'. Videos (kind='v') are excluded from picture counts.
- unique images = COUNT(DISTINCT md5). Duplicates: md5 shared by >1 row.
- day is VARCHAR 'YYYY-MM-DD'. Add a day filter ONLY when the user names a period ("in august", "last week") — then write the real dates (e.g. day LIKE '2026-08-%' for August 2026). For "total / overall / all time" questions: NO day filter.
- orientation/width/height/camera are EXIF columns; NULL when unknown — never guess.

SQL:
- Call run_sql for ANY data question — answer from the real result, never invent numbers.
- Chain multiple run_sql calls when a question needs multi-step analysis (filter → aggregate → compare). Never re-run an identical query — reuse the result you already have.
- Older tool results may be trimmed to 8 rows; re-run a query when you need rows that were trimmed.
- Single SELECT per call, LIMIT auto-added (200).

PATTERNS — copy these shapes exactly (owner is always the exact email from CONTRIBUTOR MATCHES):
- count by contributor: SELECT COUNT(*) FROM images WHERE owner = 'EMAIL' AND kind = 'i'
- unique by contributor: SELECT COUNT(DISTINCT md5) FROM images WHERE owner = 'EMAIL' AND kind = 'i'
- per-day counts: SELECT day, COUNT(*) AS uploads FROM images WHERE kind = 'i' AND day LIKE 'YYYY-MM-%' GROUP BY day ORDER BY day
- top contributors: SELECT owner, COUNT(DISTINCT md5) AS uniq FROM images WHERE kind = 'i' GROUP BY owner ORDER BY uniq DESC LIMIT 5
- orientation split: SELECT orientation, COUNT(*) AS n FROM images WHERE kind = 'i' GROUP BY orientation
- contributor shots by orientation: SELECT COUNT(*) FROM images WHERE owner = 'EMAIL' AND kind = 'i' AND orientation = 'portrait'
- duplicates by contributor: SELECT owner, COUNT(*) AS dup_copies FROM images WHERE kind = 'i' AND md5 IN (SELECT md5 FROM images WHERE kind = 'i' GROUP BY md5 HAVING COUNT(*) > 1) GROUP BY owner ORDER BY dup_copies DESC LIMIT 5
`;

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
      if (env.ACCESS_CODE && request.headers.get("x-access-code") !== env.ACCESS_CODE)
        return json({ error: "invalid access code" }, 401, { ...CORS_HEADERS });

      const limit = Number(env.RATE_LIMIT_PER_IP || 30);
      if (!allowIp(ipOf(request), limit))
        return json(
          {
            error: `daily limit reached for your address (${limit} questions/day). Add your own key via settings, or try again after 00:00 UTC.`,
          },
          429,
          { ...CORS_HEADERS },
        );

      if (!env.GATEWAY_KEY)
        return json(
          { error: "pooled chat is not configured (missing GATEWAY_KEY)" },
          503,
          { ...CORS_HEADERS },
        );

      const { messages, context } = (await request.json()) as {
        messages: UIMessage[];
        /** per-turn client context (viewing + contributor emails) — never shown to the user */
        context?: string;
      };

      const modelMessages = await convertToModelMessages(messages);
      if (context) {
        const lastUser = [...modelMessages].reverse().find((m) => m.role === "user");
        if (lastUser) {
          lastUser.content =
            typeof lastUser.content === "string"
              ? `${context}\n\n${lastUser.content}`
              : [{ type: "text", text: context }, ...lastUser.content];
        }
      }
      const gw = createGateway({ apiKey: env.GATEWAY_KEY });
      const noteError = (e: unknown) => `AI error: ${e instanceof Error ? e.message : String(e)}`;

      // sticky fallback: once the gateway rate-limits, route around it for a
      // while; FORCE_FALLBACK=1 bypasses the gateway entirely (testing)
      const force = env.FORCE_FALLBACK === "1";
      const primaryActive = !force && Date.now() >= gwFallbackUntil;

      // overflow runs WITHOUT tools and WITHOUT the AI SDK: Workers AI
      // tool-calling proved unreliable (garbled tool JSON on llama fp8-fast,
      // tools ignored on qwen-coder) and the provider duplicated stream
      // deltas — a single non-streaming env.AI.run is bulletproof
      const runFallback = async (): Promise<string> => {
        const msgs = [
          { role: "system", content: FALLBACK_SYSTEM_PROMPT },
          ...modelMessages.map((m) => ({
            role: m.role,
            content: typeof m.content === "string"
              ? m.content
              : m.content.map((p) => (p.type === "text" ? p.text : "")).join(""),
          })),
        ];
        const out = await env.AI!.run(FALLBACK_MODEL, { messages: msgs, max_tokens: 300 });
        return out?.response?.trim() || "Precise numbers are temporarily unavailable — ask again in a couple of minutes.";
      };

      const stream = createUIMessageStream({
        execute: async ({ writer }) => {
          const writeText = (text: string) => {
            writer.write({ type: "text-start", id: "fb" } as Parameters<typeof writer.write>[0]);
            writer.write({ type: "text-delta", id: "fb", delta: text } as Parameters<typeof writer.write>[0]);
            writer.write({ type: "text-end", id: "fb" } as Parameters<typeof writer.write>[0]);
          };

          if (!primaryActive) {
            // sticky window: straight to the toolless overflow engine
            writeText(await runFallback());
            return;
          }

          const result = streamText({
            model: gw(env.GATEWAY_MODEL || "openai/gpt-5-nano"),
            system: SYSTEM_PROMPT,
            messages: modelMessages,
            tools: { run_sql: runSqlTool },
            stopWhen: stepCountIs(8),
            abortSignal: request.signal,
          });
          const inner = result.toUIMessageStream({ onError: noteError });

          // peek the first chunks: a gateway rate-limit error arrives before
          // any real content — swap to the Workers AI fallback transparently
          const reader = inner.getReader();
          const buffered: unknown[] = [];
          let swap = false;
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              const chunk = value as { type?: string; errorText?: string };
              buffered.push(chunk);
              if (chunk.type === "error") {
                if (RATE_LIMIT_RE.test(chunk.errorText ?? "")) swap = true;
                break; // other errors pass through untouched
              }
              if (chunk.type !== "start" && chunk.type !== "start-step") break; // real content began
            }
          } catch {
            /* aborted mid-peek — commit whatever buffered and let merge finish */
          }
          if (swap) {
            gwFallbackUntil = Date.now() + FALLBACK_WINDOW_MS;
            try { await reader.cancel(); } catch { /* already closed */ }
            writeText(await runFallback());
          } else {
            for (const chunk of buffered) writer.write(chunk as Parameters<typeof writer.write>[0]);
            reader.releaseLock();
            writer.merge(inner);
          }
        },
        onError: noteError,
      });
      return createUIMessageStreamResponse({
        stream,
        headers: { ...UI_MESSAGE_STREAM_HEADERS, ...CORS_HEADERS },
      });
    }

    if (!env.DB) return json({ error: "questions API is not configured (missing D1 binding)" }, 503, { ...CORS_HEADERS });
    const qapi = createQuestionsApi({ db: env.DB, questionsCode: env.QUESTIONS_CODE, normQ, normTags });
    const questionsResponse = await qapi.handle(request, url);
    if (questionsResponse) return questionsResponse;

    return json({ error: "not found" }, 404, { ...CORS_HEADERS });
  },
} satisfies ExportedHandler<Env>;
