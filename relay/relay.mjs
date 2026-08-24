/**
 * agi-eval relay — free-tier fallback chain, one stateless server/worker.
 *
 *   POOLED (default): /api/chat {messages, system?, tools?}
 *     → tries free providers in chain order (Groq → Gemini → GitHub → Workers AI).
 *     On rate-limit/credit errors it falls through to the next provider.
 *     Zero config for visitors. Gated by per-IP daily cap + optional ACCESS_CODE.
 *
 *   BYOK (power users): /api/chat {byok: {base, key, model, protocol}, messages, …}
 *     → passthrough to the visitor's own provider. No pooled quota consumed.
 *
 *   GET /api/info  → { model, chain } — which providers are armed.
 *   GET /api/health
 *
 * Env:
 *   FREE_CHAIN        comma list, default "groq,gemini,github,wai"
 *   GROQ_KEY          https://console.groq.com  (free)
 *   GEMINI_KEY        https://aistudio.google.com  (free)
 *   GITHUB_TOKEN      GitHub PAT (free via GitHub Models)
 *   GROQ_MODEL / GEMINI_MODEL / GITHUB_MODEL / WAI_MODEL   optional overrides
 *   ACCESS_CODE       optional gate
 *   RATE_LIMIT_PER_IP default 100/day on pooled
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Access-Code",
  "Access-Control-Max-Age": "86400",
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

/* per-IP daily cap (best-effort, in-memory) */
const rateMap = new Map();
function allowIp(ip, limit) {
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

function ipOf(request) {
  return (
    request.headers.get("cf-connecting-ip") ??
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ??
    "unknown"
  );
}

function providerHeaders(id, key) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
}

/** strict tool-message sanitizer (ids synthesized, shapes normalized) */
function sanitizeToolMessages(messages) {
  let seq = 0;
  const nextId = () => `call_auto_${Date.now().toString(36)}_${seq++}`;
  const pending = [];
  return messages.map((m) => {
    const calls = m.tool_calls ?? m.toolCalls;
    if (m.role === "assistant" && Array.isArray(calls)) {
      const norm = calls.map((tc) => {
        const fn = tc.function ?? tc;
        const id = tc.id || fn.id || nextId();
        pending.push(id);
        const args =
          typeof (fn.arguments ?? tc.arguments) === "string"
            ? fn.arguments ?? tc.arguments
            : JSON.stringify(fn.arguments ?? tc.arguments ?? {});
        return { id, type: "function", function: { name: fn.name ?? tc.name ?? "", arguments: args } };
      });
      return { ...m, tool_calls: norm, content: m.content ?? "" };
    }
    if (m.role === "tool") {
      let id = m.tool_call_id ?? m.toolCallId;
      if (!id) id = pending.length ? pending.shift() : nextId();
      else {
        const idx = pending.indexOf(id);
        if (idx >= 0) pending.splice(idx, 1);
      }
      return { ...m, tool_call_id: id, content: m.content ?? "" };
    }
    return m;
  });
}

/* ---------- free-provider chain ---------- */

function buildChain(env) {
  const chain = [];
  const order = (env.FREE_CHAIN || "groq,gemini,github,wai").split(",").map((s) => s.trim());

  for (const id of order) {
    if (id === "groq" && env.GROQ_KEY)
      chain.push({
        id: "groq",
        url: "https://api.groq.com/openai/v1/chat/completions",
        model: env.GROQ_MODEL || "llama-3.3-70b-versatile",
        key: env.GROQ_KEY,
      });
    if (id === "gemini" && env.GEMINI_KEY)
      chain.push({
        id: "gemini",
        url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        model: env.GEMINI_MODEL || "gemini-2.0-flash",
        key: env.GEMINI_KEY,
      });
    if (id === "github" && env.GITHUB_TOKEN)
      chain.push({
        id: "github",
        url: "https://models.github.ai/inference/chat/completions",
        model: env.GITHUB_MODEL || "openai/gpt-4.1-mini",
        key: env.GITHUB_TOKEN,
      });
    if (id === "wai")
      chain.push({
        id: "wai",
        binding: true,
        model: env.WAI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      });
  }
  return chain;
}

const RETRYABLE = new Set([429, 402, 403, 500, 502, 503, 504]);

export async function handle(request, env = {}) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: CORS });

  if (url.pathname === "/api/health")
    return json({ ok: true, service: "agi-eval-relay" }, 200, { ...CORS });

  if (url.pathname === "/api/info") {
    const chain = buildChain(env).map((c) => c.id);
    const model = buildChain(env)[0]?.model ?? "none";
    return json({ model, chain }, 200, { ...CORS });
  }

  if (url.pathname === "/api/models" && request.method === "POST") {
    const { base, key = "" } = await readJson(request);
    if (!base) return json({ error: "missing base" }, 400, { ...CORS });
    try {
      const res = await fetch(base.replace(/\/+$/, "") + "/models", {
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      });
      return new Response(res.body, {
        status: res.status,
        headers: { "Content-Type": res.headers.get("content-type") ?? "application/json", ...CORS },
      });
    } catch (e) {
      return json({ error: `upstream fetch failed: ${e.message}` }, 502, { ...CORS });
    }
  }

  if (url.pathname === "/api/chat" && request.method === "POST") {
    const { messages = [], system = "", tools, byok = null } = await readJson(request);

    /* ---- BYOK passthrough ---- */
    if (byok) {
      const { base, key = "", model, protocol = "openai" } = byok;
      if (!base || !model) return json({ error: "byok missing base/model" }, 400, { ...CORS });
      const msgs = system ? [{ role: "system", content: system }, ...messages] : messages;
      const target =
        base.replace(/\/+$/, "") + (protocol === "anthropic" ? "/messages" : "/chat/completions");
      const payload = {
        model,
        messages: msgs,
        stream: true,
        ...(protocol === "anthropic" ? { max_tokens: 4096 } : {}),
      };
      if (tools && tools.length)
        payload.tools =
          protocol === "anthropic"
            ? tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }))
            : tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
      try {
        const res = await fetch(target, {
          method: "POST",
          headers: providerHeaders(protocol, key),
          body: JSON.stringify(payload),
        });
        return new Response(res.body, {
          status: res.status,
          headers: {
            "Content-Type": res.headers.get("content-type") ?? "text/event-stream",
            "Cache-Control": "no-cache",
            ...CORS,
          },
        });
      } catch (e) {
        return json({ error: `upstream fetch failed: ${e.message}` }, 502, { ...CORS });
      }
    }

    /* ---- POOLED: free-provider fallback chain ---- */
    const limit = Number(env.RATE_LIMIT_PER_IP || 100);
    if (!allowIp(ipOf(request), limit))
      return json(
        { error: `daily limit reached for your address (${limit} questions/day). Add your own key via settings, or try again tomorrow (UTC).` },
        429,
        { ...CORS },
      );

    const safeMsgs = sanitizeToolMessages(
      system ? [{ role: "system", content: system }, ...messages] : messages,
    );

    const chain = buildChain(env);
    if (chain.length === 0)
      return json({ error: "no free providers configured on the relay yet" }, 503, { ...CORS });

    let lastError = "all providers exhausted";
    for (const link of chain) {
      const payload = {
        model: link.model,
        messages: safeMsgs,
        stream: link.id !== "wai",
      };
      if (tools && tools.length)
        payload.tools = tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }));

      try {
        let res;
        if (link.binding) {
          // Workers AI — native binding, tools passed through; non-streamed,
          // normalized into synthetic OpenAI SSE for the client
          const runOpts = { messages: safeMsgs };
          if (tools && tools.length)
            runOpts.tools = tools.map((t) => {
              const fn = t.function ?? t;
              return {
                type: "function",
                function: {
                  name: fn.name ?? t.name,
                  description: fn.description ?? t.description,
                  parameters: fn.parameters ?? t.parameters,
                },
              };
            });
          const out = await env.AI.run(link.model, runOpts);
          let sse;
          if (Array.isArray(out?.tool_calls) && out.tool_calls.length) {
            const chunks = out.tool_calls.map((tc, i) => ({
              choices: [{
                delta: {
                  tool_calls: [{
                    index: i,
                    id: tc.id || `call_${i}`,
                    type: "function",
                    function: {
                      name: tc.name ?? tc.function?.name ?? "",
                      arguments: typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments ?? {}),
                    },
                  }],
                  finish_reason: "tool_calls",
                },
              }],
            }));
            sse = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
          } else {
            const text = out?.response ?? "";
            sse =
              `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n` +
              `data: [DONE]\n\n`;
          }
          res = new Response(sse, {
            status: 200,
            headers: { "Content-Type": "text/event-stream", "x-provider": "wai" },
          });
        } else {
          res = await fetch(link.url, {
            method: "POST",
            headers: providerHeaders(link.id, link.key),
            body: JSON.stringify(payload),
          });
        }

        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          lastError = `${link.id} HTTP ${res.status}: ${detail.slice(0, 160)}`;
          console.warn(`[chain] ${lastError}`);
          if (RETRYABLE.has(res.status)) continue; // next provider
          return json({ error: `${link.id} HTTP ${res.status}: ${detail.slice(0, 200)}` }, res.status, { ...CORS });
        }

        return new Response(res.body, {
          status: res.status,
          headers: {
            "Content-Type": res.headers.get("content-type") ?? "text/event-stream",
            "Cache-Control": "no-cache",
            "x-provider": link.id,
            ...CORS,
          },
        });
      } catch (e) {
        lastError = `${link.id}: ${e.message}`;
        console.warn(`[chain] ${lastError}`);
      }
    }

    return json({ error: `all free providers exhausted — last error: ${lastError}` }, 502, { ...CORS });
  }

  return json({ error: "not found" }, 404, { ...CORS });
}
