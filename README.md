# agi-eval-data

Two live dataset platforms for an AGI benchmark on **visual & geometric reasoning** — real-world
images and metro/transit network maps where vision-language models fail, plus complex geometric
shape problems.

| Site | URL | Dataset | Sync |
|---|---|---|---|
| **Real-world images** | [agi-eval-data.pages.dev](https://agi-eval-data.pages.dev) | 54.5k+ photos where VLMs fail | hourly Drive scan → `data/latest.json` |
| **Metro / transit** | [metro-eval.pages.dev](https://metro-eval.pages.dev) | 85 metro network maps · 38 countries · 30 official PDFs | daily Drive scan → `data/metro.json` |

Questions are authored on the sites (access-gated) and frontier VLMs are graded against them.

---

## Architecture

Turborepo workspace (bun):

```
apps/web           real-world images site — Vite · React 19 · TanStack Router · Tailwind v4 · shadcn/ui · DuckDB-WASM chat
apps/relay         Cloudflare Worker — AI chat relay (Vercel AI Gateway + Workers AI fallback) + questions API (D1)
apps/metro-web     metro/transit site — same stack, NO chat — catalog (branch toggle, PDF preview), questions workspace
apps/metro-relay   Cloudflare Worker — questions API only (D1 metro-eval-questions)
packages/shared    text normalization (normQ / normTags / normSql) — web + relay
packages/metro-shared  v4 types + normalization — metro-web + metro-relay
scripts/           Drive scanners (drive_scan.py, metro_scan.py), build tooling, OG renderers
data/latest.json   THE real-world artifact — overwritten by the sync bot (change-gated)
data/metro.json    THE metro artifact (v4: folders/country/city taxonomy)
docs/              plans & decision log · docs/METRO_PLAN.md is the metro design
```

**Data flow**: Google Drive → (sync bot: metadata scan + link-share) → `data/*.json` →
sites read them at runtime (raw.githubusercontent, jsDelivr fallback). Thumbnails hotlink
Google's CDN. No dataset image bytes are ever stored in this repo.

**Question flow**: contributors author questions on `/contribute` (access-code gated) →
stored in Cloudflare D1 (dedupe enforced at the DB) → `/evaluate` runs them against VLMs
via OpenRouter (BYOK, browser-direct) → human-graded verdicts → leaderboard → export as
VQA-style `questions.jsonl`.

## The metro site (apps/metro-web)

- **Catalog** — browse by country with a branch toggle: `ours` (curated) vs
  `reason_map(exisiting_dataset)` (reference). Every file — images *and* PDFs — opens
  in an in-app viewer (Google CDN full-size / Drive preview iframe + download).
- **Gallery** — all 85 maps + 30 PDFs in one grid.
- **Contribute / Evaluate** — same questions workspace as the foundation, backed by its
  own D1 (`metro-eval-questions`), target 5 questions per map.
- **Sync pill** — counts down to the daily 06:00 UTC data sync; becomes a refresh button
  when new data lands.

## Local development

```bash
bun install                # workspace install (apps + packages)

bun run dev:web             # real-world site on localhost:5173
bun run dev:metro-web       # metro site on localhost:5174 (or 5183)
bun run dev:relay           # foundation worker on localhost:8787
bun run dev:metro-relay     # metro worker on localhost:8788
bun run typecheck           # tsc across the workspace
bun run build               # turbo build (cached)

# dataset tooling (python)
python scripts/drive_scan.py            # full Drive scan → data/latest.json
python scripts/metro_scan.py            # metro folder scan → data/metro.json
python scripts/metro_build_data.py      # bake metro version.json (sync feed)
```

Each site expects its relay URL + access code in `/settings` (stored in your browser).
Defaults point at the deployed workers.

## Deployment (GitHub Actions — no local deploys)

| Workflow | Trigger | Does |
|---|---|---|
| `ci` | PRs + pushes touching code | typecheck + build both sites (gates merges) |
| `deploy` | pushes to `main` touching code | deploy both relays (Workers) + both sites (Pages), per-app path filtering |
| `sync-data` | daily 06:00 UTC + manual | real-world Drive scan → `data/latest.json` → commit (change-gated) |
| `sync-metro` | daily 06:00 UTC + manual | metro folder scan → `data/metro.json` → commit (change-gated) |
| `sync-share` | every 30 min | link-share new images + PDFs (thumbnails/previews work anonymously) |

**Required repo secrets**: `CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit + Cloudflare
Pages:Edit), `CLOUDFLARE_ACCOUNT_ID`. The data syncs use `DRIVE_CLIENT_ID` /
`DRIVE_CLIENT_SECRET` / `DRIVE_REFRESH_TOKEN` (metadata-only scope; OAuth app must stay
**In Production**).

`main` is protected: PR-only merges, `ci` must pass. The data-sync bot
(`github-actions[bot]`) is bypass-allowed so hourly dataset commits keep flowing.
Branch-protection ruleset is exported at `.github/rulesets/main-protection.json`.

## Contributing

1. Fork / branch from `main`.
2. `bun install`, make your change, `bun run typecheck && bun run build`.
3. Open a PR — CI gates it; the maintainer merges. Merge = automatic deploy.

**Benchmark questions are NOT added via PRs** — they're authored on the gated
`/contribute` pages (D1-backed, duplicate-proof).

## Hygiene

Byte-identical duplicates are tracked by md5 (dedupe stats on the sites); images slated
for removal can be flagged "do-not-work" so no one authors questions for them. Uniqueness
= first occurrence per md5.
