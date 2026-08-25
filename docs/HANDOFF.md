# HANDOFF — agi-eval-data dataset chat

_Document for the next AI agent taking over this project. Everything needed to continue without archaeology. Last updated: 2026-08-25, consistency pass: counts refreshed to the live artifact, dead pre-SDK BYOK client removed, docs aligned with deployed relay config._

---

## 1. What this project is

**agi-eval-data** — a live dataset ledger + natural-language chat interface for an AGI benchmark dataset: real-world images (where vision-language models fail) plus geometric reasoning problems. ~45.6k files (~44.1k unique images) from 7 contributors, syncing hourly from Google Drive.

The owner (user: mmaaaaz / devmaaaaz@gmail.com) wants:
- A dashboard anyone on the team can query in natural language — zero config, zero cost
- The AI must understand intent, write correct SQL, and **ask clarifying questions when ambiguous** (e.g., two contributors named "Bilal" → interactive "which one?" component)
- Support any kind of analytics query about the dataset

**Hard constraints:** $0/month hosting · no backend database · visitor API keys never required for the default path.

---

## 2. Current architecture (verified working)

```
Browser SPA (Cloudflare Pages: agi-eval-data.pages.dev)
  ├─ Vite + React 19 + TanStack Router (file routes) + Tailwind v4 + zod search params
  ├─ @ai-sdk/react useChat (AI SDK v7 client) ←── the chat
  │    transport: DefaultChatTransport → POST {relay}/api/chat
  ├─ DuckDB-WASM (jsDelivr bundles, lazy) — in-browser SQL over the artifact
  └─ persistence: IndexedDB "agi-eval-chats" (conversations survive refresh)

Cloudflare Worker relay (agi-eval-relay.devmaaaaz.workers.dev)
  └─ AI SDK v5 server loop:
       streamText({ model: gateway(GATEWAY_MODEL), system: SYSTEM_PROMPT,
                    messages: convertToModelMessages(uiMessages),
                    tools: { run_sql: { description, inputSchema } },   ← client-side tool (NO execute)
                    stopWhen: stepCountIs(6) })
       → createUIMessageStreamResponse / toUIMessageStream

Google Drive (source of truth for images)
GitHub Actions (hourly cron, .github/workflows/sync.yml)
  ├─ scripts/drive_scan.py --ci   → data/latest.json (metadata only, v3 schema)
  ├─ scripts/share_sync.py        → delta link-sharing for thumbnails
  └─ commit + push (bot: agi-eval-bot)

raw.githubusercontent.com/…/data/latest.json   ← the SPA fetches this at load
lh3.googleusercontent.com/d/{fileId}=w400      ← thumbnails, direct from Google CDN
```

**Key principle:** the SPA never rebuilds for data changes. The Worker holds the AI key as a secret. The dataset JSON is public on raw.githubusercontent.

---

## 3. Repository map

```
.github/workflows/sync.yml     cron */10: scan → share-sync → commit data (change-gated)
.github/workflows/ci.yml       typecheck + build — gates PRs
.github/workflows/deploy.yml   deploys relay + pages on main code pushes (secrets-gated)
apps/relay/src/worker.ts       AI SDK v7 Worker: streamText + gateway + Workers AI fallback + client-side run_sql tool
apps/relay/src/questions.ts    questions/evaluations/insights API (D1) — route-table dispatch
apps/relay/wrangler.toml       vars: GATEWAY_MODEL, RATE_LIMIT_PER_IP, FORCE_FALLBACK; [ai] binding (fallback); [[d1_databases]] DB
scripts/drive_scan.py          Drive metadata scanner (--ci for headless; --from-snapshot offline)
scripts/share_sync.py          delta link-sharing (thumbnails need "anyone-with-link")
scripts/og/render-og.mjs       OG card renderer (takumi, no headless browser)
data/latest.json               THE artifact — v3 schema (below)
apps/web                       the Vite app (shadcn/ui + Recharts)
  src/routes/ask.tsx           the chat page (useChat, IndexedDB persistence)
  src/routes/contribute.index.tsx   question authoring (gallery grid + sheet)
  src/routes/contribute.evaluate.tsx model grading (combobox + leaderboard)
  src/lib/duck.ts              DuckDB-WASM singleton: loadArtifact + guarded runSql
  src/lib/questions.ts         questions/evaluations client (workspace shared normQ)
  src/lib/chats.ts           IndexedDB conversation store (UIMessage-based)
  src/lib/ai/settings.ts     v4 settings (relay URL + access code only)
  src/lib/brief.ts           viewingContext (URL-aware line; suppressed on bare /ask)
docs/                        plans & research (AI_CHAT_PLAN, SQL_ANALYTICS_PLAN, RECOMMENDATIONS…)
```

Secrets (GitHub Actions + never in code): `DRIVE_CLIENT_ID`, `DRIVE_CLIENT_SECRET`, `DRIVE_REFRESH_TOKEN`. OAuth app is published to Production (Testing-mode tokens die weekly).

---

## 4. data/latest.json — v3 schema (exact)

```jsonc
{
  "version": 3,
  "meta": {
    "scannedAt": "ISO", "cron": "0 * * * *",
    "counts": { "all", "imagesRaw", "imagesUnique", "dupCopies", "videos", "bytes" }
  },
  "files": [["id","name","ext",size,"day","ownerEmail","md5","kind"], …],  // arrays, kind: i|v|o
  "owners": { "email": "Display Name" },
  "dupGroups": [{ "md5", "count", "size", "names": [...] }],
  "cams": ["camera names"],          // exif camera index
  "exif": { "fileId": [width, height, camIdx] }
}
```

Snapshot of record (re-read `data/latest.json` for live numbers — they move hourly): 45,597 items · 45,546 image files (44,108 unique) · 1,438 duplicate copies · 4 videos · ~95.1 GB · 7 contributors (as of scannedAt 2026-08-24T19:24Z; artifact ≈10 MB raw / 4.6 MB gzip). Owner display names in `owners` may be Drive display names OR prettified email prefixes.

---

## 5. The chat page — how it works (web/src/routes/ask.tsx)

- `useChat` from `@ai-sdk/react` v4 + `ai` v7 (UIMessage stream protocol). Transport: `DefaultChatTransport({ api: relay + "/api/chat", headers: accessCode })`.
- `prepareSendMessagesRequest` injects `{ messages, tools: [SQL_TOOL] }` into the body — **the relay needs `tools` to enable tool-calling on the model. Do not remove.**
- `onToolCall` → executes `runSql(input.sql)` **in the browser via DuckDB-WASM** → `addToolOutput({ tool, toolCallId, output: JSON.stringify(result) })` → `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls` auto-continues.
- **Contributor resolver** (in `send`): matches stopword-filtered question words against name/email TOKENS (exact token, or ≥4-char prefix — raw substring matching was removed: "the" used to match "theyellowdog123" and poison queries), injects a `CONTRIBUTOR MATCHES` block with exact emails. The relay prompt tells the model to ignore matches the user didn't ask about.
- Persistence: debounced `saveChat(activeId, messages)` to IndexedDB; restore on mount/switch via `getChat`.
- Rendering: `message.parts` — text parts + typed tool parts (`tool-run_sql`) with states (`input-streaming` → live SQL, `input-available` → running, `output-available` → result table).
- System prompt (rich schema + rules) lives **server-side** in the Worker — client never sends it.

---

## 6. Relay details (relay/src/worker.ts)

- **Primary (default)**: Vercel AI Gateway via `createGateway({ apiKey: env.GATEWAY_KEY })`, model `gateway(env.GATEWAY_MODEL)` — currently `openai/gpt-5-nano`. Relay now runs **`ai@^7`** (aligned with the web client; the old v5/v7 skew is gone).
- **Workers AI overflow (2026-08-25)**: gateway free-tier per-model rate limits caused intermittent "An error occurred." (masked for weeks by `toUIMessageStream()`'s DEFAULT onError — always pass `onError` to BOTH `createUIMessageStream` AND `result.toUIMessageStream()`). Fix: the execute() handler peeks the first stream chunks; if the error matches rate-limiting, it transparently swaps to `env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast")` — **toolless** (Workers AI tool-calling proved unreliable: garbled tool JSON on llama fp8-fast, tools ignored on qwen-coder; the provider also duplicated stream deltas — raw non-streaming `env.AI.run` is bulletproof) with `FALLBACK_SYSTEM_PROMPT` (narrative answers, says when precision is unavailable). Sticky: after any rate-limit, fallback is used for 3 min (`gwFallbackUntil`). `FORCE_FALLBACK=1` in wrangler.toml bypasses the gateway for testing — keep "0" in prod.
- **Per-IP daily cap**: `RATE_LIMIT_PER_IP` (currently **101/day**, set in relay/wrangler.toml), in-memory (resets on isolate recycle — best-effort).
- **ACCESS_CODE**: optional gate; unset.
- **Client-side tool**: `run_sql` has NO execute — the AI SDK forwards the call to the browser; DuckDB runs there. The tool result returns via `addToolOutput` and the SDK auto-continues.
- **System prompt**: rich DDL + semantics + rules (concise-only, off-topic refusal, exact-email matching, multi-step chaining allowed). Server-side so it can't be tampered with.

---

## 7. Thumbnails

`lh3.googleusercontent.com/d/{fileId}=w400` (grid) / `=w1600` (lightbox) — Google's CDN, direct from browser. Requires images link-shared (done via `scripts/share_sync.py` delta pass). No proxy, no Workers usage.

---

## 8. CURRENT KNOWN ISSUES (for the next agent)

1. **Failed/stopped turns poisoned the conversation (FIXED 2026-08-25)**: a stream that died mid-turn (NetworkError, user `stop()`) left assistant parts in non-final states (`reasoning` stuck in `streaming`, tool calls with no result). Every later send re-posted them and the API rejected tool-calls-without-results → the chat was permanently broken ("An error occurred." forever). Fix: `prepareSendMessagesRequest` in ask.tsx drops assistant messages whose parts are in `streaming` / `input-streaming` / `input-available` states; transient fetch failures get one retry via the transport's `fetch` wrapper. Repro that must keep passing: send → stop mid-stream → follow up in the same chat.
2. **Model sometimes repeats or refines tool calls** — measured 2026-08-25: gpt-5-nano re-runs a query to "verify" or refines it with extra predicates. Identical re-runs: served instantly from `sqlCache` + a stop-nudge in the cached output, and hidden in the UI (cross-message `shownSql` dedupe in ask.tsx). Refinements (different SQL) are legitimate and shown. Loops bounded by the per-turn budget of 3 `run_sql` attempts (reset on every user send).
3. **gpt-5-nano via the gateway emits long reasoning chains** — 8–9 s before the first tool call. `providerOptions: { openai: { reasoningEffort: "minimal" } }` was tested 2026-08-25 and the gateway/model **rejects it (400)** — do not retry blindly; latency relief must come from swapping `GATEWAY_MODEL`.
4. **Gateway free-tier rate limits (RESOLVED 2026-08-25 by the Workers AI overflow)**: bursts of requests hit Vercel's per-model free-tier caps → "AI error: Free tier requests on this model are rate-limited…". The relay now swaps to the toolless llama-3.3-70b overflow transparently and sticks with it for 3 min. Overflow answers are narrative-only by design.
5. **`day` column type**: forced to VARCHAR at load (DuckDB auto-types ISO strings as DATE, breaking LIKE). If the model writes date-typed SQL anyway, the binder hint in `duck.ts` guides it.
6. **routeTree.gen.ts is committed** and regenerates at build/dev — expect it to churn in diffs after any route change; include it in the same commit.

---

## 9. Owner's roadmap (discussed, not built)

1. **Interactive disambiguation**: when a contributor match is ambiguous (two Bilals), render an in-chat choice component instead of injecting all matches. AI SDK pattern: tool part with `state: 'input-available'` → render buttons → `addToolOutput` with the selection. The resolver already produces the candidate list — extend it to return ambiguity info.
2. **Any-query analytics**: the run_sql tool already covers most analytics; extend the brief with more derived columns if needed.
3. **Stronger schema understanding**: the system prompt carries exact DDL; consider few-shot Q→SQL examples in the prompt for weak models.
4. **Chat persistence upgrade**: IndexedDB is per-browser; if cross-device sync is ever wanted, that needs a backend (out of zero-cost scope).
5. **Model upgrade path**: GATEWAY_MODEL is one var — swapping models is a one-line change + relay deploy.

---

## 10. Ops runbook

```bash
# workspace (root)
bun install                                     # installs apps + packages
bun run dev:web                                 # localhost:5173
bun run dev:relay                               # localhost:8787
bun run typecheck                               # tsc across the workspace
bun run build                                   # turbo build (cached)

# deploys happen from GitHub Actions on main pushes (code paths only).
# local deploy (rare — e.g. prod incident):

# relay local dev (uses .dev.vars for secrets)
cd relay && npx wrangler dev                    # localhost:8787
npx wrangler secret put GATEWAY_KEY             # once
npx wrangler secret put GATEWAY_MODEL           # optional override

# data scan (local interactive)
python scripts/drive_scan.py                    # browser OAuth, snapshots/
python scripts/drive_scan.py --ci               # headless (secrets from env)

# manual sync trigger
gh workflow run sync --repo mmaaaaz/agi-eval-data
```

**Deploy checklist** (in order): `vite build` → `node scripts/og/gen-route-html.mjs` (per-route OG HTML) → `wrangler pages deploy dist`. **Verify the served bundle hash changed** — a deploy can silently no-op; check `/assets/index-*.js` hash vs `dist/assets/`.

SQL chip shows `ready · <current file count> rows`.

---

## 11. Fragile bits — do not break

- `UI_MESSAGE_STREAM_HEADERS` must be spread into EVERY relay stream response (the client transport checks them).
- `prepareSendMessagesRequest` tools injection (§5) — without it the model never calls run_sql.
- `CAST(day AS VARCHAR)` in duck.ts — DuckDB auto-types ISO strings as DATE, breaking LIKE.
- Tool-call id synthesis (relay sanitizer) — gateways reject empty tool_call_ids.
- OAuth refresh token: app must stay In Production on Google Cloud (Testing-mode tokens expire in 7 days).
- Version skew (deliberate): web pins `ai@^7` + `@ai-sdk/react@^4`; relay pins `ai@^5`. The UIMessage wire protocol is compatible — verified working. When upgrading either side, upgrade and re-verify the tool-call loop together.
- The hourly bot commits to main — always `git pull --rebase` before pushing.

## 11b. CI/CD + branch protection (2026-08-25)

- **`main` is protected**: PR-only merges, `ci` status check required. The data-sync bot (`github-actions[bot]`) is bypass-allowed so hourly dataset commits keep flowing. Ruleset managed via `gh api` (name: `main-protection`) — disable with:
  `gh api -X PATCH repos/mmaaaaz/agi-eval-data/rulesets/<ruleset-id> -f enforcement=disabled`
- **`deploy` workflow**: deploys relay + pages on main pushes that touch code (data-only commits skip it). Requires repo secrets `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`; the `guard` job skips deploys gracefully while they're unset.
- **Local deploys** are for incidents only — normal flow is merge-to-main.
- The questions export → `data/questions.jsonl` bot step is BACKLOG (not wired).

## 12. Verification checklist for any change

- [ ] `bunx tsc --noEmit` clean (web/)
- [ ] `bunx vite build` succeeds
- [ ] Landscape question → one run_sql → answer matches a manual `SELECT COUNT(*)` for the same filter (counts drift hourly)
- [ ] Tool chip states cycle: composing → running → result table
- [ ] Refresh restores the conversation (IndexedDB)
- [ ] New chat / switch / delete work
- [ ] Off-topic question → one-line refusal
- [ ] SQL chip shows ready; STALE badge only after 90+ min
