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
apps/metro-relay    Cloudflare Worker — questions API only (D1 metro-eval-questions)
packages/shared     text normalization (normQ/normTags/normSql) — web + relay
packages/metro-shared  v4 types (folders column) + normalization — metro-web + metro-relay
scripts/            Drive scanners, build tooling, OG renderers (below)
data/latest.json    real-world artifact (v3 schema, 8-col rows)
data/metro.json     metro artifact (v4 schema, 9-col rows: + folders path)
docs/               this handbook + metro.md
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

## Data flow

```
Google Drive
  ├─ sync-data (daily 06:00)  ── drive_scan.py ──> data/latest.json ──commit──┐
  └─ sync-metro (hourly :00)  ── metro_scan.py ──> data/metro.json  ──commit──┤
                                                                              ▼
        raw.githubusercontent.com/…/data/*.json   ◄── sites fetch at runtime (jsDelivr fallback)
        lh3.googleusercontent.com/d/{id}=w400      ◄── thumbnails hotlinked (no bytes in repo)
        sync-share (every 30 min) ── share_sync.py ──> anyone:reader on new images + PDFs
```

Both scanners are **metadata-only** (never download file contents). `share_sync.py`
link-shares every image AND PDF so Google's CDN/preview links work anonymously.

## Question flow (both sites, identical)

1. Contributor opens `/contribute` (access-code gated via `QUESTIONS_CODE` secret).
2. Picks an image from the queue (sorted by fewest questions, `n/5` badges).
3. Writes question + ground truth (text/number/yesno/choice) + tags; live near-dupe check.
4. Stored in D1 `questions` (UNIQUE(file_id, qnorm) dedupe at the DB).
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
bun run dev:metro-web       # metro site :5183
bun run dev:relay           # foundation worker :8787
bun run dev:metro-relay     # metro worker :8788
bun run typecheck           # tsc across the workspace
bun run build               # turbo build (cached)

python scripts/metro_scan.py            # metro scan (needs token.json or DRIVE_* env)
python scripts/metro_build_data.py      # bake metro version.json
python scripts/og/render-metro-og.mjs   # render metro OG cards (after npm install in scripts/og)
```

## Ops runbook

```bash
# manual sync (incident / bootstrap)
gh workflow run sync-metro              # or sync-data
# manual deploy (rare — CI normally does it)
VITE_REPO_METRO=mmaaaaz/agi-eval-data bunx turbo run build --filter=@metro/web
cd apps/metro-web && CLOUDFLARE_ACCOUNT_ID=… bunx --bun wrangler@4 pages deploy dist --project-name=metro-eval --branch=main --commit-dirty=true
# D1
npx wrangler d1 execute metro-eval-questions --remote --file apps/metro-relay/schema.sql
```

## Known constraints / fragile bits

- **DuckDB/AI SDK only in the foundation app** — metro deliberately has no chat (keeps the
  bundle at 524 kB vs 1.34 MB and the surface catalog-first).
- **`day` is VARCHAR** in DuckDB (auto-typed DATE otherwise) — `CAST(day AS VARCHAR)` in duck.ts.
- **Wrangler deploy uses `bunx --bun wrangler@4.125.0`** — bump the version pin deliberately.
- **Sync bots push directly to `main`** — always `git pull --rebase` before local pushes.
- **OAuth refresh token**: Google app must stay In Production (testing-mode tokens die weekly).
