# AI Gateway Research — pooled-key chat feasibility

_Question: can we make /ask "just work" for everyone without per-person API keys — using Vercel AI Gateway ($5/mo free credit) or Cloudflare — and what does each idea cost?_
> **STATUS (2026-08-25):** G1 shipped as a single pooled path only (Vercel AI Gateway behind a Worker secret; no Workers-AI overflow, no BYOK tier). G2 shipped (IndexedDB chats + sidebar). G3 (`/sql` workbench) **not built**. Live state: `HANDOFF.md`.

---

## Verified facts (from official pricing/docs pages, checked today)

### Vercel AI Gateway
- ✅ **$5/month free AI credit included on every Vercel team account** (user was right)
- ✅ Zero markup on tokens — provider list price, pay-as-you-go from the credit balance
- ✅ **OpenAI-compatible endpoint** (`ai-gateway.vercel.sh/v1`) — our existing client works with just a base-URL change
- ✅ BYOK supported (zero markup with your own provider keys) — but **not on the free tier**
- ⚠️ Free tier = **subset of "eligible models"** + lower per-model rate limits (need to verify at signup that a good cheap model — nano/flash class — is in the eligible list)
- ⚠️ Paid tier = purchase credits (all models)

### Cloudflare AI Gateway
- It is a **proxy/analytics/caching layer in front of providers** — caching, rate limiting, logs, DLP, BYOK key storage (beta)
- ❌ **No free model credits** — it forwards to providers; you pay the provider
- ✅ The gateway features themselves are free
- Useful to us mainly for: response **caching** (identical questions = free answers; our brief changes hourly so cache windows align) and **analytics**

### Cloudflare Workers AI (the sleeper)
- ✅ **10,000 Neurons/day free**, resets daily 00:00 UTC — real model compute hosted by Cloudflare (llama 3.3 70B fast, llama 3.1 8B fast, qwen, deepseek distills…)
- $0.011 per 1,000 Neurons beyond the free allowance
- ✅ Pairs **natively** with a Cloudflare Worker relay via an `env.AI` binding — no external account, no key management at all
- Neuron math per typical chat turn (~3k input incl. brief + ~400 output):
  - `llama-3.3-70b-fast`: ≈ **160 neurons/turn → ~60 turns/day free**
  - `llama-3.1-8b-fast`: ≈ **26 neurons/turn → ~380 turns/day free**
- Quality: below frontier models, but with our `run_sql` tool-calling the model only needs to write decent SQL — 70B-fast is very capable of that

---

## Feasibility verdicts

| Idea | Verdict | Notes |
|---|---|---|
| Vercel AI Gateway + pooled key | ✅ feasible | $5/mo credit ≈ **7,000+ turns/mo** on nano/flash-class models. Gateway key MUST live in a Worker secret — never client-side |
| CF Workers AI free neurons | ✅ feasible | Truly $0, zero external accounts. ~60 turns/day (70B) or ~380 (8B) |
| CF AI Gateway as a layer | ✅ optional | Caching + analytics over the above; skip for v1 |
| Multiple chats + persistence | ✅ trivial | IndexedDB conversation store; new/rename/delete/switch; per-conversation model memory |
| Dedicated SQL page (/sql) | ✅ trivial | DuckDB is already wired — workbench = editor + run + schema sidebar + history + CSV export |
| "Just works, no config" | ✅ via tiered fallback | pooled gateway (default) → Workers AI (overflow) → BYOK (power users) |

---

## Recommended architecture — tiered model access on the existing relay

```
/ask (no config needed)
  ▼
Worker relay (already exists)
  ├─ /api/chat/pooled   → Vercel AI Gateway  [key = Worker secret, $5/mo credit]
  │    per-IP daily cap (e.g. 25 turns) + ACCESS_CODE for the team
  ├─ /api/chat/wai      → env.AI Workers AI   [10k neurons/day free] (overflow)
  ├─ /api/chat/byok     → existing passthrough                     (power users)
  └─ /api/models        → pooled model list + BYOK lists
```

- **Default experience**: open /ask, type, get an answer. No key, no config.
- **Abuse protection**: per-IP daily cap on pooled path; pooled key never leaves the Worker; ACCESS_CODE optional for team-only mode.
- **Cost ceiling**: $5/mo hard-capped by Vercel credit exhaustion (gateway just errors when empty → UI falls back to Workers AI → then BYOK prompt). Worst case = $0 extra.
- **Quality ladder**: nano/flash-class on the pooled path is fine for SQL Q&A — the `run_sql` tool does the precise work; prose quality is secondary.

## Chat persistence design

- IndexedDB store (`agi-eval-chats`): conversations `{id, title, createdAt, model, messages[]}`
- Sidebar on /ask: list + new + rename + delete; active conversation in URL (`/ask?c=id`) — same-browser only (no backend storage), stated in UI
- Auto-title: first question truncated
- Cap: keep last 50 conversations, trim oldest (IndexedDB has no practical limit for text)

## Dedicated SQL page (/sql)

- Route + nav ("SQL")
- Left: schema reference (tables/columns from a static doc, generated from the artifact shape)
- Center: query editor (textarea now; CodeMirror later), Ctrl+Enter run
- Right/bottom: results table + row count + **export CSV** + "copy as JSONL"
- Query history (localStorage, last 50) + example queries
- Reuses `duck.ts` guards (read-only, auto-LIMIT, timeout) unchanged
- Effort: S–M

---

## Phases

| Phase | Scope | Effort |
|---|---|---|
| G1 | Relay: pooled path (Vercel GW secret) + per-IP cap + Workers AI fallback; /ask uses pooled by default, BYOK stays | M |
| G2 | Multiple chats + IndexedDB persistence + sidebar | S–M |
| G3 | /sql workbench page | S–M |
| G4 (optional) | CF AI Gateway layer for caching/analytics | S |

## Decisions requested

1. Approve pooled-key direction (Maaz's Vercel account, $5/mo credit, rate-limited)?
2. Confirm Workers AI fallback inclusion (free, lower quality)?
3. Chat storage scope: local-only per browser (recommended v1) vs backend-persisted (needs DB — out of zero-cost scope for now)?
