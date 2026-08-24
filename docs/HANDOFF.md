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
.github/workflows/sync.yml   hourly cron: scan → share-sync → commit data
relay/src/worker.ts          AI SDK v5 Worker: streamText + gateway + client-side run_sql tool
relay/wrangler.toml          vars: GATEWAY_MODEL, RATE_LIMIT_PER_IP; [ai] binding NOT used anymore
scripts/drive_scan.py        Drive metadata scanner (--ci for headless; --from-snapshot offline)
scripts/share_sync.py        delta link-sharing (thumbnails need "anyone-with-link")
scripts/gen_og.py            social card generator (Pillow)
data/latest.json             THE artifact — v3 schema (below)
web/                         the Vite app
  src/routes/ask.tsx         the chat page (useChat, IndexedDB persistence, sidebar)
  src/lib/duck.ts            DuckDB-WASM singleton: loadArtifact + guarded runSql
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
- **Contributor resolver** (in `send`): tokenizes the question, matches words ≥3 chars against owner names/emails (both directions), injects a `CONTRIBUTOR MATCHES` block into the message text with exact emails.
- Persistence: debounced `saveChat(activeId, messages)` to IndexedDB; restore on mount/switch via `getChat`.
- Rendering: `message.parts` — text parts + typed tool parts (`tool-run_sql`) with states (`input-streaming` → live SQL, `input-available` → running, `output-available` → result table).
- System prompt (rich schema + rules) lives **server-side** in the Worker — client never sends it.

---

## 6. Relay details (relay/src/worker.ts)

- **Pooled path (default)**: AI Gateway via `createGateway({ apiKey: env.GATEWAY_KEY })`, model `gateway(env.GATEWAY_MODEL)` — currently `openai/gpt-5-nano`. Fixed model, no selector (owner's choice).
- **Per-IP daily cap**: `RATE_LIMIT_PER_IP` (currently **101/day**, set in relay/wrangler.toml), in-memory (resets on isolate recycle — best-effort).
- **ACCESS_CODE**: optional gate; unset.
- **Client-side tool**: `run_sql` has NO execute — the AI SDK forwards the call to the browser; DuckDB runs there. The tool result returns via `addToolOutput` and the SDK auto-continues.
- **System prompt**: rich DDL + semantics + rules (concise-only, off-topic refusal, single-SQL, exact-email matching). ~2 KB. Server-side so it can't be tampered with.

---

## 7. Thumbnails

`lh3.googleusercontent.com/d/{fileId}=w400` (grid) / `=w1600` (lightbox) — Google's CDN, direct from browser. Requires images link-shared (done via `scripts/share_sync.py` delta pass). No proxy, no Workers usage.

---

## 8. CURRENT KNOWN ISSUES (for the next agent)

1. **NetworkError on tool-result continuation** (latest report): after `addToolOutput`, the automatic re-send to the relay failed with a fetch NetworkError. Likely transient network OR a race between the stream closing and the auto-send. Fix direction: add a one-shot retry with backoff around the automatic continuation (AI SDK `Chat` transport level), or catch + surface a "retry" affordance. Not yet reproduced server-side (relay logs were clean).
2. **Model sometimes repeats identical tool calls** — mitigated: client-side `sqlCache` (identical SQL → instant cached result) + `ranSqlCount` cap (3 attempts → "answer from the summary" nudge). If it recurs with a better model, consider server-side dedup in the relay.
3. **gpt-5-nano via the gateway emits long reasoning chains** — 8–9 s before the first tool call. `reasoning_effort: "none"` auto-retry exists in the client for gateways that 400 on tools+reasoning (opencode gateway). For the Vercel gateway, reasoning is on by default — a `providerOptions` reasoning-effort override could speed it up (untested).
4. **`day` column type**: forced to VARCHAR at load (DuckDB auto-types ISO strings as DATE, breaking LIKE). If the model writes date-typed SQL anyway, the binder hint in `duck.ts` guides it.
5. **routeTree.gen.ts is untracked** (regenerates at build/dev). Fresh clones need one `vite build`/`dev` before tsc passes.

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
# web dev
cd web && bun install && bun run dev            # localhost:5173
bun run build                                   # → dist/
npx wrangler pages deploy dist --project-name agi-eval-data --branch main

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

## 12. Verification checklist for any change

- [ ] `bunx tsc --noEmit` clean (web/)
- [ ] `bunx vite build` succeeds
- [ ] Landscape question → one run_sql → answer matches a manual `SELECT COUNT(*)` for the same filter (counts drift hourly)
- [ ] Tool chip states cycle: composing → running → result table
- [ ] Refresh restores the conversation (IndexedDB)
- [ ] New chat / switch / delete work
- [ ] Off-topic question → one-line refusal
- [ ] SQL chip shows ready; STALE badge only after 90+ min
