# AI Intelligence Plan — natural-language dataset Q&A

> **UPDATE:** direction moved to a dedicated chat page with an optional thin relay backend. See `AI_CHAT_PLAN.md` (supersedes the architecture below; the BYOK analysis still holds). OpenViking verdict unchanged: wrong shape for in-browser analytics.

_Question: can OpenViking (openviking.ai) give our website in-browser, natural-language intelligence over the dataset — BYOK, no backend, zero AI cost?_

---

## Verdict on OpenViking (short)

**Wrong tool for this specific job — but a candidate for a different future job.**

OpenViking (volcengine/OpenViking) is a **self-hosted context database for AI agents**: agent memory, knowledge RAG, skills, session context, MCP integrations. It is:

- a **server** you run (`pip install openviking` → `openviking-server`, or Volcengine cloud) — **not an in-browser library**
- designed for **agents that persist memory across sessions**, not one-shot analytics
- dependent on a configured LLM provider anyway (Volcengine/OpenAI/Kimi/GLM/local) — so an LLM is still required, BYOK or otherwise

Our actual need — "ask questions about one structured JSON file" — does not need a context database. The entire dataset summary fits in a few KB of prompt, and precise answers need *computation over rows*, which a RAG layer does not provide (it retrieves; it doesn't aggregate).

**Where OpenViking WOULD fit later:** if we build a persistent *data-steward agent* (watches syncs across sessions, remembers curation decisions, accumulates dataset knowledge), OpenViking is a credible memory layer — self-hosted = free. Park it for that scenario.

---

## The architecture that DOES fit: BYOK chat, in-browser, no backend

```
Browser (SPA)
  ├─ context builder: aggregates latest.json client-side → "dataset brief" (~4 KB)
  ├─ optional tool: query_dataset(filter) — model calls it, app computes locally
  ├─ BYOK key in localStorage (user's own OpenAI / Anthropic / Gemini / OpenRouter key)
  └─ fetch() straight to the provider ──► no backend, no server, no cost to us
```

### Why this works

| Concern | Answer |
|---|---|
| Backend required? | **No.** All major providers allow direct browser calls (Anthropic needs `anthropic-dangerous-direct-browser-access: true`; OpenAI/Gemini/OpenRouter work as-is) |
| Our AI cost | **Zero.** The visitor's own key pays for their own tokens |
| Data size | 21k rows never enters a prompt. Pre-aggregated brief ≈ 4 KB; tool-calls pull exact slices on demand |
| Privacy | Metadata only, sent to the provider *the visitor chose*, with *their* key. Same trust level as them using ChatGPT |
| Crawlers/SEO | Irrelevant — chat is interactive-only |

### Context builder (the actual intelligence)

The brief the model receives per conversation:
- meta counts (all/imagesRaw/unique/dupes/videos/bytes) + scan time
- per-contributor table: name, raw, unique, dupes, videos, bytes, active days, first/last upload
- day buckets (full range), weekday histogram
- extension + orientation + camera + aspect-ratio distributions
- top duplicate groups summary
- coverage notes (what the artifact does NOT contain: GPS, folder paths, image contents)

### Tool-calling drill-down (phase 2 — kills hallucinations)

Expose one function to the model:

```
query_dataset({
  who?, ext?, day_from?, day_to?, min_mp?, orientation?, kind?, dedupe?,
  group_by?: "day"|"owner"|"ext"|"camera",
  limit?
}) → aggregated rows (capped)
```

The app executes it against the in-memory rows array and returns real numbers. Questions like "how many HEICs from enad in the last two weeks?" get computed, not guessed. This is the difference between a demo and a tool.

### Provider matrix (BYOK)

| Provider | Browser-direct | Notes |
|---|---|---|
| OpenAI | ✅ | `dangerouslyAllowBrowser: true` in SDK, or raw fetch |
| Anthropic | ✅ | requires `anthropic-dangerous-direct-browser-access: true` header |
| Google Gemini | ✅ | simplest CORS of the three |
| OpenRouter | ✅ | one key → many models; good default suggestion |
| Local (ollama) | ✅ if user runs it | `http://localhost:11434` — truly zero cloud |

### UI sketch

- New route `/ask` (nav: "Ask AI") + palette entry
- Settings drawer: provider select, model text field, API key (localStorage, never logged, "stored only in this browser" notice)
- Chat panel with the dataset brief pinned as system context + suggested starter questions
- Every answer citing the tool-calls it made (transparency)

### Phasing

1. **P1 — brief + chat** (S): context builder, BYOK settings, one provider (OpenRouter), streaming responses
2. **P2 — tool-calling** (M): `query_dataset` function, multi-provider, citation of executed queries
3. **P3 — saved insights** (S): pin Q&A pairs to a page; regenerate on data refresh

### Risks / notes

- API keys in localStorage: fine for a team tool; add an explicit "anyone at this browser can see this key" warning
- Prompt-injection surface is nil (no untrusted text in the brief — it's all our own computed numbers)
- Cost control: the brief is ~4 KB in + typical answers ~300 tokens out → fractions of a cent per question on mini-tier models
- If the team later wants shared/no-key access → that's when a tiny Worker with a pooled key enters (explicitly out of scope per zero-cost constraint)

---

## Decision requested

- Approve **P1** (BYOK chat over the dataset brief) → I'll plan routes/components and implement
- Or park both docs until the "new direction" settles
