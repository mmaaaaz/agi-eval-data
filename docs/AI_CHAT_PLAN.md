# AI Chat Plan — dedicated dataset chat page

_Supersedes the OpenViking verdict in `AI_INTELLIGENCE_PLAN.md` (that doc's BYOK analysis still holds; this is the concrete architecture)._
> **STATUS (2026-08-25):** Shipped in evolved form — Cloudflare Worker relay + Vercel AI Gateway pooled key + AI SDK v7 `useChat` with client-side `run_sql`. TanStack AI and default-BYOK were **not** used. Live state: `HANDOFF.md`.

Requirements from the team: dedicated chat page · contextual + URL-aware · backend OK (Railway or free host) · BYOK · OpenAI-compatible URLs + Anthropic · auto-fetched model lists · clean, healthy context.

---

## 1. Architecture decision

Two viable shapes. The surprise: **a backend is optional**, because every provider we care about allows browser-direct calls (CORS):

| Provider | Browser-direct? | Model list |
|---|---|---|
| OpenAI-compatible (incl. OpenRouter, Groq, Together) | ✅ | `GET {base}/v1/models` (Bearer key) |
| OpenRouter | ✅ purpose-built for browsers | `GET /api/v1/models` — **public, no key, 422+ models, includes pricing metadata** |
| Anthropic | ✅ with `anthropic-dangerous-direct-browser-access: true` header | `GET /v1/models` (x-api-key) |
| Google Gemini | ✅ | `GET /v1beta/models` (key) |
| Ollama (local) | ✅ if `OLLAMA_ORIGINS` set | `/api/tags` |

### Shape A — zero backend (recommended start)
SPA calls providers directly with the visitor's key. Tools (`query_dataset`) execute **client-side** against in-memory rows. Nothing to host, nothing to pay.

**Trade-off:** TanStack AI's agent loop is endpoint-oriented (`useChat` → server chat route). Going browser-direct means hand-rolling a small message store (~100 lines) instead of using their server loop — or spiking `@tanstack/ai-client` transports (pluggable streams exist; needs a 1-hour spike).

### Shape B — thin relay (TanStack AI native, what you asked for)
A ~60-line OpenAI-compatible **passthrough relay**: client sends `{provider, base, key, messages}` → relay forwards to the real provider, streams SSE back. Holds **no secrets** (BYOK passes through), so it's useless to attackers without a provider key. Add an `ACCESS_CODE` env gate anyway.

With the relay, TanStack AI fits natively: `@tanstack/ai-openai` adapter with `baseURL` pointed at the relay → full `useChat` DX, agent loop, tool-calling, devtools. Anthropic models ride the same relay in OpenAI-compat mode, or via `@tanstack/ai-anthropic` in passthrough mode `/anthropic/*`.

**Recommendation: Shape B.** You explicitly want a backend + TanStack AI; the relay is trivially portable (any host, any time), and it keeps every provider behind one normalized shape.

---

## 2. Hosting reality check (verified today)

| Host | Free? | Catch |
|---|---|---|
| **Railway** | 30-day trial ($5 credit) → **$1/mo Lite** or $5/mo Hobby | Not permanently free — but $1/mo is the honest floor for "a real server" |
| **Cloudflare Workers** | ✅ 100k req/day | We said "no workers" for *image proxying* (high volume). A chat relay is ~100 req/day for a team of 7. **Re-proposing with numbers** — same platform we already deploy on |
| Deno Deploy | ✅ generous | TS-native, streaming supported |
| Render | ✅ | sleeps after 15 min idle → ~50 s cold start on first message |
| Koyeb / HF Spaces | ✅ | sleep policies vary |

**Cost truth:** BYOK means the *provider* tokens are the visitor's expense. The relay's compute is negligible everywhere. Railway $1/mo is the only real money in the whole system — or $0 on Workers/Deno.

---

## 3. TanStack AI — evaluation

**Fit: strong, with eyes open.**

| | |
|---|---|
| Packages | `@tanstack/ai` (agent loop, typed tools) · `@tanstack/ai-react` (`useChat`) · adapters: `ai-openai`, `ai-anthropic`, `ai-openrouter`, `ai-gemini`, `ai-ollama`, `ai-grok`, `ai-mistral`, `ai-bedrock` |
| DX | Headless + typed primitives; devtools package for inspecting streams/tool calls |
| Maturity | **v0.x, RC, "built in public"** — API churn is real |
| Mitigation | Pin exact versions; wrap all AI imports in one module (`web/src/lib/ai/*`) so adapter swaps never touch components |

Ecosystem synergy is the decider: we already run Router + Virtual; TanStack AI completes the stack, and its tool-calling is exactly the `query_dataset` shape we designed.

---

## 4. Context health (clean + healthy, by design)

1. **Dataset brief** (system prompt, ~4 KB): counts, per-contributor table, day buckets, ext/orientation/camera distributions, dup summary, coverage notes. Computed once per conversation from `latest.json`; cached; regenerated only when `scannedAt` changes (with a one-line notice injected mid-chat: "dataset updated just now — numbers above may be stale").
2. **URL awareness**: each user turn carries a 1-line prefix — `VIEWING /gallery?who=bilal…&ext=jpg` — parsed from router state. Questions like "how many of *these*?" just work.
3. **Trimming**: keep last 12–16 messages; tool results capped at ~40 rows and always truncated first when over budget; full recompute available via `query_dataset`.
4. **No silent staleness**: if `scannedAt` changed mid-conversation, chip + notice appear (same logic as the global sync chip).

## 5. Model auto-discovery

Relay endpoint `GET /api/models`:
- OpenAI-compat: `GET {base}/v1/models` → `data[].id`
- OpenRouter: public endpoint → id **+ pricing** (we can display $/M tokens per model — nice touch for BYOK users)
- Anthropic: `/v1/models` with key + `anthropic-version` header
- Ollama: `/api/tags`
Normalized to `[{id, name, context?, pricing?}]`, cached client-side per (provider, base) for the session.

## 6. Security (BYOK through a relay)

- Keys live in `localStorage`, sent per-request, **never persisted or logged server-side**; relay is fully stateless
- `ACCESS_CODE` env gate on the relay (shared with the team) so randos can't use it as an open CORS proxy
- HTTPS only; no key in URLs; error responses from providers passed through unmodified (no key echo)
- Prompt-injection surface ≈ nil: the brief is our own computed numbers, no untrusted text

## 7. Phases

| Phase | Scope | Effort |
|---|---|---|
| **P1** | Relay (OpenAI-compat passthrough + `/api/models`) · `/ask` route · provider presets + auto model fetch · brief context + URL awareness · streaming | 1–2 sessions |
| **P2** | `query_dataset` tool (client-executed, exact numbers) · context trimming · markdown/code rendering · stop/regenerate | 1 session |
| **P3** | Saved conversations (localStorage) · per-conversation share links · token/cost estimator | S |

## 8. Open items (decide before build)

1. Host: Railway $1/mo vs Workers free vs Deno Deploy (recommend Workers if $0 is hard, Railway if "real server" is preferred)
2. Default provider preset (suggest OpenRouter — one key, every model, pricing display)
3. Chat page nav label: "Ask" (fits between Composition and Contributors)
