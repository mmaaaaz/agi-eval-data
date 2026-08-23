# In-Browser SQL Analytics Plan — AI queries over the dataset

_The insight (correct): sending JSON with every question scales linearly with the dataset and dies early. Sending a **schema** costs ~300 tokens forever, regardless of whether we have 21k or 500k rows. The AI writes SQL; a database inside the browser executes it against the real data._

---

## 1. The landscape (what you saw)

| Engine | npm | What it is | Fit |
|---|---|---|---|
| **DuckDB-WASM** | `@duckdb/duckdb-wasm` | Columnar analytical OLAP engine in WASM. Reads JSON/Parquet/CSV natively, window functions, blazing group-bys. Runs in a Web Worker. Powers evidence.dev, MotherDuck local, duck-ui (605★) | ⭐ **primary pick** — built for exactly our query shape |
| SQLite-WASM (official) | `@sqlite.org/sqlite-wasm` | Official SQLite as ES module, OPFS persistence | solid fallback; row-store, less analytics-flavored |
| sql.js | `sql.js` | Older SQLite→WASM, in-memory | dated; no worker story |
| PGlite | `@electric-sql/pglite` | Postgres in WASM (+pgvector) | overkill now; pgvector becomes interesting if embeddings land later |

Community proof the pattern works: `duck-ui` (browser DuckDB workbench), `JesseVent/arcsql` ("AI-powered in-browser SQL workbench — Gemini + DuckDB WASM"), `querypad` ("local-first AI workspace that understands your datasets"), plus the standard Vercel AI SDK text-to-SQL examples. (X.com search needs auth — GitHub/npm evidence stands in.)

## 2. Architecture

```
latest.json (already cached in SPA)
   ▼  fetch buffer → DuckDB (Web Worker, in-memory, read-only)
tables: images(id,name,ext,size,day,who,md5,kind,w,h,camera)
        dup_groups(md5,count,size)   owners(email,name)
   ▼
AI gets: CREATE TABLE schema + 3 sample rows + column notes  (~300–500 tokens, CONSTANT)
   ▼  model writes SQL
run_sql(query) tool → DuckDB executes → capped result table → model interprets
```

**Token math (the whole point):**
| Approach | Tokens @21k rows | @100k rows | @500k rows |
|---|---|---|---|
| JSON in prompt | ~700k ❌ | impossible | impossible |
| Pre-aggregated brief | ~1k ✅ but only pre-computed questions | ~1k | ~1k |
| **Schema + SQL tool** | **~400 ✅ any question** | **~400** | **~400** |

Keep the brief too — hybrid: brief answers "what is this dataset" narrative questions; SQL answers anything precise.

## 3. Design decisions

1. **DuckDB-WASM, in a Web Worker, in-memory.** No persistence needed (artifact is the source of truth). Worker keeps the UI at 60fps during scans.
2. **Load path:** reuse the already-fetched `latest.json` buffer → `CREATE TABLE images AS SELECT unnest(...) FROM read_json(...)` on the registered buffer, or parameterized bulk-insert (21k rows ≈ instant). Reload when `scannedAt` changes.
3. **WASM delivery:** lazy-load from jsDelivr CDN (zero bundle cost) with self-hosted fallback from `node_modules` — same pattern as fonts.
4. **Safety rails:** single-statement execution only, `LIMIT` auto-injection when missing, statement timeout (worker terminate), read-only by construction, SQL errors returned to the model for self-correction (standard text-to-SQL loop, 1–2 retries).
5. **Schema drift:** schema text is generated from the artifact `version` + column docs — always in sync, never hand-maintained.
6. **TanStack AI fit:** this *is* the `query_dataset` tool from `AI_CHAT_PLAN.md` P2, upgraded from JS filters to SQL. Tool-calling loop via `@tanstack/ai` + provider adapter (BYOK unchanged). The chat stays URL-aware (filters injected per turn).

## 4. Phase 2 upgrade path — Parquet artifact

CI can emit `data/latest.parquet` alongside the JSON (DuckDB writes it natively): ~5–10× smaller than JSON, near-instant loads, and the AI's schema stays identical. JSON remains for the site's own rendering; Parquet becomes the SQL engine's food. Defer until row count demands it.

## 5. Later extensions (parked)

- PGlite + pgvector **if** CLIP embeddings land (similarity search in SQL)
- Persisted DB in OPFS for offline replay
- Saved queries as shareable links (SQL in URL, sanitized)

## 6. Phases

| Phase | Scope | Effort |
|---|---|---|
| **S1** | DuckDB-WASM worker + table load + `run_sql` tool wired into `/ask` (BYOK, TanStack AI) | 1 session |
| **S2** | Self-correction loop (error→retry), query result tables rendered in chat, "show the SQL" toggle | S |
| **S3** | Parquet artifact from CI + loader switch | S |

## 7. Open items

1. Confirm engine choice (recommend DuckDB-WASM)
2. CDN vs self-hosted WASM (recommend CDN primary + self-host fallback)
3. Chat route ships together with `AI_CHAT_PLAN.md` P1 (they share the `/ask` page)
