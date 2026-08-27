# Architecture & Ops Handbook

Living doc for the **agi-eval-data** repo — two live dataset platforms, one Turborepo.
Last verified: 2026-08-27 (both sites deployed, syncs green).

---

## What this repo is

AGI benchmark datasets targeting **visual & geometric reasoning failures** of frontier
vision-language models. Two independent sub-projects share this repo:

| | Real-world images | Metro / transit |
|---|---|---|
| Site | [agi-eval-data.pages.dev](https://agi-eval-data.pages.dev) | [metro-eval.pages.dev](https://metro-eval.pages.dev) |
| Dataset | 54.5k+ photos where VLMs fail | 85 metro network maps · 38 countries · 30 official PDFs |
| Artifact | `data/latest.json` | `data/metro.json` |
| Sync | **daily** 06:00 UTC (dataset complete) | **hourly** (:00) (new dataset, wants fresh data) |
| Source | user's whole Drive | Drive folder `metro/transit_dataset` |
| Questions DB | Cloudflare D1 `agi-eval-questions` | Cloudflare D1 `metro-eval-questions` |
| Chat AI | ✅ (DuckDB-WASM + gateway relay) | ❌ (no chat — catalog-first) |

## Repository map

```
apps/web            real-world site — Vite · React 19 · TanStack Router · Tailwind v4 · shadcn/ui
                    routes: / (overview) /gallery(/insights,/duplicates,/contributors) /ask /contribute(/evaluate) /project /settings
apps/relay          Cloudflare Worker — AI chat relay (Vercel AI Gateway + Workers AI fallback) + questions API (D1)
apps/metro-web      metro site — same stack, NO chat. routes: / /catalog(/compare) /gallery(/pdfs,/contributors,/duplicates) /contribute(/evaluate) /project /settings
                    components/GraphAssist.tsx (lazy, behind VITE_ENABLE_MAPS_ASSIST)
apps/metro-relay    Cloudflare Worker — questions API only (D1 metro-eval-questions), provenance columns source/graph_file_id/graph_path
packages/shared     text normalization (normQ/normTags/normSql) — web + relay
packages/site       shared UI/data/questions shell + metroGraph (MarkLayer, AssistPanel, types, routing) — @site/metroGraph is code-split
packages/questions-api  shared D1 API factory — source filtering + tags GC (count>0)
scripts/            Drive scanners, build tooling, OG renderers + metro_graph_validate.py / metro_graph_build.py / metro_graph_seed.py (graph sidecars)
data/latest.json    real-world artifact (v3 schema, 8-col rows)
data/metro.json     metro artifact (v4 schema, 9-col rows: + folders path)
data/metro-graph.json   single-file sidecar (`graphs[file_id]`, v1; see data/metro-graph.schema.json) — single file, never per-city — $0 forever
docs/               this handbook + metro.md + metro-graph.md + project guide (project.tsx)
og/                 OG cards (foundation: og/*.png · metro: og/metro/*.png)
.github/workflows/  ci · deploy · sync-data · sync-metro · sync-share
```

### Data artifacts

**`data/latest.json` (v3)** — `files: [[id, name, ext, size, day, ownerEmail, md5, kind]]`,
plus `owners`, `dupGroups`, `cams`, `exif`. `kind`: `i` image, `v` video, `o` other.

**`data/metro.json` (v4)** — same shape plus a 9th column `folders` = folder-name path
from the dataset root (`["ours","Brazil"]`, `["reason_map(exisiting_dataset)","china"]`).
`kind`: `i` image, `o` PDF. `counts` adds `countries`/`cities` (cities == image count —
each file is one city's map).

**`data/metro-graph.json` (sidecar, NOT v4 inline)** — single file `graphs[file_id]` with `{fileId,city,country,branch,stations:[{id,label,lines,x,y,interchange}],edges:[{from,to,line,bidirectional,weight}],lines:{id:{color,label,stations}},provenance}`. Fetched at runtime from GitHub raw / jsDelivr fallback (free forever, `drive.metadata.readonly`, no hosted Maps keys, no sync coupling). Routing: local `BFS` (unweighted) + `Dijkstra` when weights present. Flag: `VITE_ENABLE_MAPS_ASSIST` (default off — no bundle impact). See `docs/metro-graph.md`.

## Data flow

```
Google Drive
  ├─ sync-data (daily 06:00)  ── drive_scan.py ──> data/latest.json ──commit──┐
  └─ sync-metro (hourly :00)  ── metro_scan.py ──> data/metro.json  ──commit──┤
                                                                              ▼
        raw.githubusercontent.com/…/data/*.json   ◄── sites fetch at runtime (jsDelivr fallback)
        raw.githubusercontent.com/…/data/metro-graph.json  ◄── graph sidecar (single file) when flag on (same fallback)
        lh3.googleusercontent.com/d/{id}=w400      ◄── thumbnails hotlinked (no bytes in repo)
        sync-share (every 30 min) ── share_sync.py ──> anyone:reader on new images + PDFs
```

Both scanners are **metadata-only** (never download file contents). `share_sync.py`
link-shares every image AND PDF so Google's CDN/preview links work anonymously. Graph sidecars are NOT scanned — they are authored and committed manually.

```
Branch selection: folders[0] normalized via normalizeBranch() (apps/metro-web/src/lib/data.ts)
  "reason_map(exisiting_dataset)" / "reason_map(existing_dataset)" / "reason_map" → "reason_map"
  else → "ours"; catalog validates ?branch= through normalizeBranch; compare uses branchOf().

Contribute graph path: select map → MarkLayer (image container overlay, disabled for PDFs k=o)
  → station dots (x/y) + SVG lines + BFS shortest highlight → AssistPanel (coverage, marks,
  hops/transfers/path, S/L templates, "Use as question" fills fields without submit)
  — code-split behind VITE_ENABLE_MAPS_ASSIST (React.lazy), Esc clears selection.
```

## Question flow (both sites, identical)

1. Contributor opens `/contribute` (access-code gated via `QUESTIONS_CODE` secret).
2. Picks an image from the queue (sorted by fewest questions, `n/5` badges).
3. Writes question + ground truth (text/number/yesno/choice) + tags; live near-dupe check.
4. Stored in D1 `questions` (UNIQUE(file_id, qnorm) dedupe at the DB). Metro rows carry provenance: `source` (`human`|`graph`, default `human`), `graph_file_id`, `graph_path`; `GET /api/questions?source=` filters (backward-compat on old DBs — missing columns fall back gracefully).
5. `/contribute/evaluate`: run a question against any OpenRouter model (BYOK, browser-direct)
   or paste a manual response; grade `correct/close/wrong/unanswered` → leaderboard + by-tag accuracy.
6. Export: `GET /api/questions/export.jsonl` → VQA-superset `questions.jsonl`.

## Sync pill (both sites)

Header pill counts down to the next sync (`next 45:21` → `next 3h 05m` → `next 2d 3h`),
polls `/data/version.json` every minute, becomes a `↻ new data — refresh` button when a
newer sync lands. `version.json` is baked at deploy by `scripts/build_data.py` (foundation)
and `scripts/metro_build_data.py` (metro).

## Deploy + CI (GitHub Actions only)

| Workflow | Trigger | Does |
|---|---|---|
| `ci` | PRs + pushes touching `apps/**`/`packages/**` | typecheck + build both sites (gates merges) |
| `deploy` | pushes to `main` touching code/data | per-app path filter → deploy affected relays (Workers) + sites (Pages) |
| `sync-data` | daily 06:00 + manual | real-world scan → commit `data/latest.json` (change-gated) |
| `sync-metro` | hourly + manual | metro scan → commit `data/metro.json` + OG cards (change-gated) |
| `sync-share` | every 30 min | link-share new images + PDFs |

`deploy.yml` jobs use **direct `bunx --bun wrangler@4.125.0`** (not wrangler-action — npm
can't resolve `workspace:*` deps). Foundation jobs are guarded so metro-only commits never
redeploy the foundation app (and vice versa). Each app pair (relay+pages) shares a
`deploy-metro` / `deploy-main` concurrency group; syncs use `sync-data-main` / `sync-metro`.

**Secrets**: `CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit + Pages:Edit),
`CLOUDFLARE_ACCOUNT_ID`, `DRIVE_CLIENT_ID` / `DRIVE_CLIENT_SECRET` / `DRIVE_REFRESH_TOKEN`
(metadata-only scope; OAuth app must stay **In Production**). `QUESTIONS_CODE` optional gate.

`main` is protected: PR-only merges, `ci` must pass; the data-sync bot
(`github-actions[bot]`) is bypass-allowed. Ruleset export: `.github/rulesets/main-protection.json`.

## Provisioning (one-time, already done)

- Pages projects: `agi-eval-data`, `metro-eval` (created via `wrangler pages project create`).
- D1: `agi-eval-questions`, `metro-eval-questions` — schema applied via
  `wrangler d1 execute <db> --remote --file apps/<relay>/schema.sql`.
  Metro provenance delta (already in schema for fresh DBs; run ALTERs on an old DB):
  `ALTER TABLE questions ADD COLUMN source TEXT NOT NULL DEFAULT 'human'` (+ graph_file_id, graph_path, idx_q_source) — see `apps/metro-relay/schema.sql` comments.
- Workers: `agi-eval-relay`, `metro-eval-relay`.

## OG cards

- Foundation: `scripts/og/render-og.mjs` (takumi) → `og/*.png` + `og/contributors/*.png`;
  `gen-route-html.mjs` stamps per-route OG meta into `apps/web/dist` after build.
- Metro: `scripts/og/render-metro-og.mjs` → `og/metro/*.png` (green branding);
  `gen-metro-route-html.mjs` stamps into `apps/metro-web/dist`.
- Rendered in `deploy` (always) and `sync-metro` (on data change); committed.

## Local development

```bash
bun install                 # workspace install
bun run dev:web             # real-world site :5173
bun run dev:metro-web       # metro site :5183 (add VITE_ENABLE_MAPS_ASSIST=1 for graph assist)
bun run dev:relay           # foundation worker :8787
bun run dev:metro-relay     # metro worker :8788
bun run typecheck           # tsc across the workspace
bun run build               # turbo build (cached)

python scripts/metro_scan.py            # metro scan (needs token.json or DRIVE_* env)
python scripts/metro_build_data.py      # bake metro version.json
python scripts/metro_graph_validate.py   # validate graph sidecar (single file)
python scripts/metro_graph_build.py      # normalizes & recounts data/metro-graph.json
python scripts/metro_graph_seed.py       # scaffolds 85 zeroed graphs from data/metro.json

## Ops runbook

```bash
# manual sync (incident / bootstrap)
gh workflow run sync-metro              # or sync-data
# manual deploy (rare — CI normally does it)
VITE_REPO_METRO=mmaaaaz/agi-eval-data bunx turbo run build --filter=@metro/web
cd apps/metro-web && CLOUDFLARE_ACCOUNT_ID=… bunx --bun wrangler@4 pages deploy dist --project-name=metro-eval --branch=main --commit-dirty=true
# D1
npx wrangler d1 execute metro-eval-questions --remote --file apps/metro-relay/schema.sql
# graph sidecars (ops check)
bun run check:metro-graph  # or python scripts/metro_graph_validate.py
```

## Known constraints / fragile bits

- **DuckDB/AI SDK only in the foundation app** — metro deliberately has no chat (keeps the
  bundle at 524 kB vs 1.34 MB and the surface catalog-first).
- **`day` is VARCHAR** in DuckDB (auto-typed DATE otherwise) — `CAST(day AS VARCHAR)` in duck.ts.
- **Wrangler deploy uses `bunx --bun wrangler@4.125.0`** — bump the version pin deliberately.
- **Sync bots push directly to `main`** — always `git pull --rebase` before local pushes.
- **OAuth refresh token**: Google app must stay In Production (testing-mode tokens die weekly).
- **Graph sidecar + flag** — `VITE_ENABLE_MAPS_ASSIST` is default-off. When off, `MarkLayer`/`AssistPanel` are not bundled (React.lazy) and `/contribute` renders the baseline `AuthorQuestions`. Sidecar is `data/metro-graph.json` (single file, `graphs[file_id]`; see `data/metro-graph.schema.json` v1) and is never merged into `data/metro.json` v4 (9-col MetroRow) — the Drive scope stays `drive.metadata.readonly` with no hosted Maps keys and no sync coupling ($0 forever).
- **Branch normalization** — `normalizeBranch()` lives in `apps/metro-web/src/lib/data.ts` (not a separate package — `packages/metro-shared` drift is corrected by re-exporting or removing the duplicate normalization there). All `?branch=` reads go through it; `branchOf()` dev-warns (instead of silently returning `ours`) when `folders` is missing, per B9.
