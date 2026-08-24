/**
 * agi-eval relay — two modes, one stateless server/worker:
 *
 *   POOLED (default): /api/chat {messages, system?, tools?}
 *     → Vercel AI Gateway with the team key held as a server secret.
 *     Zero-config for visitors. Gated by per-IP daily cap + optional ACCESS_CODE.
 *
 *   BYOK (power users): /api/chat {byok: {base, key, model, protocol}, messages, …}
 *     → passthrough to the visitor's own provider. No pooled quota consumed.
 *
 *   GET /api/info  → { model } so the UI can show what's serving.
 *   GET /api/health
 *
 * Env: GATEWAY_KEY (secret), GATEWAY_MODEL, GATEWAY_BASE (default Vercel GW),
 *      ACCESS_CODE (optional), RATE_LIMIT_PER_IP (default 30/day on pooled).
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

/* best-effort per-IP daily rate limit (in-memory; resets on process/isolate recycle) */
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

/**
 * Gateways are strict: every assistant tool_call needs an id, every tool
 * message needs a matching tool_call_id. Older/buggy clients may omit them —
 * synthesize deterministically here so the upstream never 400s.
 */
function sanitizeToolMessages(messages) {
  let seq = 0;
  const nextId = () => `call_auto_${Date.now().toString(36)}_${seq++}`;
  const pending = [];
  return messages.map((m) => {
    // accept both snake_case (wire) and camelCase (older clients)
    const calls = m.tool_calls ?? m.toolCalls;
    if (m.role === "assistant" && Array.isArray(calls)) {
      const norm = calls.map((tc) => {
        const fn = tc.function ?? tc;
        const id = tc.id || fn.id || nextId();
        pending.push(id);
        const args = typeof (fn.arguments ?? tc.arguments) === "string"
          ? (fn.arguments ?? tc.arguments)
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

function ipOf(request) {
  return request.headers.get("cf-connecting-ip")
    ?? (request.headers.get("x-forwarded-for") || "").split(",")[0].trim()
    ?? "unknown";
}

function providerHeaders(protocol, key) {
  if (protocol === "anthropic") {
    return {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    };
  }
  const h = { "Content-Type": "application/json" };
  if (key) h["Authorization"] = `Bearer ${key}`;
  return h;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export async function handle(request, env = {}) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: CORS });

  if (url.pathname === "/api/health")
    return json({ ok: true, service: "agi-eval-relay" }, 200, { ...CORS });

  if (url.pathname === "/api/info")
    return json({ model: env.GATEWAY_MODEL ?? "unset", pooled: true }, 200, { ...CORS });

  if (url.pathname === "/api/models" && request.method === "POST") {
    // BYOK model discovery passthrough
    const { base, key = "", protocol = "openai" } = await readJson(request);
    if (!base) return json({ error: "missing base" }, 400, { ...CORS });
    try {
      const res = await fetch(base.replace(/\/+$/, "") + "/models", {
        headers: providerHeaders(protocol, key),
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

    /* ---- BYOK passthrough (power users; no pooled quota used) ---- */
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
      if (tools && tools.length) {
        payload.tools =
          protocol === "anthropic"
            ? tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }))
            : tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
      }
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

    /* ---- POOLED: Vercel AI Gateway with team key ---- */
    const gwBase = (env.GATEWAY_BASE || "https://ai-gateway.vercel.sh/v1").replace(/\/+$/, "");
    if (!env.GATEWAY_KEY || !env.GATEWAY_MODEL)
      return json(
        { error: "pooled chat is not configured (missing GATEWAY_KEY/GATEWAY_MODEL)" },
        503,
        { ...CORS },
      );

    const limit = Number(env.RATE_LIMIT_PER_IP || 30);
    if (!allowIp(ipOf(request), limit))
      return json(
        {
          error: `daily limit reached for your address (${limit} questions/day). Add your own key via providers settings, or try again tomorrow (UTC).`,
        },
        429,
        { ...CORS },
      );

    const msgs = system ? [{ role: "system", content: system }, ...messages] : messages;
    const safeMsgs = sanitizeToolMessages(msgs);
    const payload = {
      model: env.GATEWAY_MODEL,
      messages: safeMsgs,
      stream: true,
    };
    if (tools && tools.length)
      payload.tools = tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));

    try {
      const res = await fetch(`${gwBase}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.GATEWAY_KEY}`,
          "http-referer": "https://agi-eval-data.pages.dev",
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        return json(
          { error: `gateway HTTP ${res.status}: ${detail.slice(0, 300)}` },
          res.status,
          { ...CORS },
        );
      }
      return new Response(res.body, {
        status: res.status,
        headers: {
          "Content-Type": res.headers.get("content-type") ?? "text/event-stream",
          "Cache-Control": "no-cache",
          ...CORS,
        },
      });
    } catch (e) {
      return json({ error: `gateway fetch failed: ${e.message}` }, 502, { ...CORS });
    }
  }

  return json({ error: "not found" }, 404, { ...CORS });
}
