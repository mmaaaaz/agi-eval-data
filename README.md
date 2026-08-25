# agi-eval-data

Live dataset + evaluation platform for an AGI benchmark on **visual & geometric reasoning** — real-world images where vision-language models fail, plus complex geometric shape problems.

**Live**: [agi-eval-data.pages.dev](https://agi-eval-data.pages.dev) · dataset syncs from Google Drive · questions are authored on the site · frontier VLMs are graded against them.

---

## Architecture

Turborepo workspace (bun):

```
apps/web           site — Vite · React 19 · TanStack Router · Tailwind v4 · shadcn/ui · DuckDB-WASM
apps/relay         Cloudflare Worker — AI chat relay (Vercel AI Gateway + Workers AI fallback) + questions API (D1)
packages/shared    shared text normalization (normQ / normTags / normSql) — used by web AND relay
scripts/           Python Drive scanner + OG image renderers + report tooling
data/latest.json   THE artifact — overwritten by the sync bot (cron */10, change-gated)
docs/              plans & decision log · docs/HANDOFF.md is the live state of the project
```

**Data flow**: Google Drive → (hourly bot: metadata scan + link-share) → `data/latest.json` → site reads it at runtime (raw.githubusercontent, jsDelivr fallback). Thumbnails hotlink Google's CDN. No dataset image bytes are ever stored in this repo.

**Question flow**: contributors author questions on `/contribute` (access-code gated) → stored in Cloudflare D1 (dedupe enforced at the DB) → `/evaluate` runs them against VLMs via OpenRouter (BYOK, browser-direct) → human-graded verdicts → leaderboard → export as VQA-style `questions.jsonl`.

## Local development

```bash
bun install                # workspace install (apps + packages)

bun run dev:web            # site on localhost:5173
bun run dev:relay          # worker on localhost:8787
bun run typecheck          # tsc across the workspace
bun run build              # turbo build (cached)

# dataset tooling (python)
python scripts/drive_scan.py            # full Drive scan → snapshots/ + data/latest.json
python scripts/make_report.py           # offline HTML dashboard from a snapshot
```

The site expects the relay URL + questions access code in `/settings` (stored in your browser). For local work, point the relay at `http://localhost:8787`.

## Deployment (GitHub Actions — no local deploys)

| Workflow | Trigger | Does |
|---|---|---|
| `ci` | PRs + pushes touching code | typecheck + build (gates merges) |
| `deploy` | pushes to `main` touching code | deploy relay (Workers) + site (Pages) via wrangler |
| `sync` | cron `*/10` + manual | Drive scan → `data/latest.json` → commit (change-gated) |

**Required repo secrets**: `CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit + Cloudflare Pages:Edit), `CLOUDFLARE_ACCOUNT_ID`. The data sync uses `DRIVE_CLIENT_ID` / `DRIVE_CLIENT_SECRET` / `DRIVE_REFRESH_TOKEN` (metadata-only scope; OAuth app must stay **In Production**).

`main` is protected: PR-only merges, `ci` must pass. The data-sync bot (`github-actions[bot]`) is bypass-allowed so hourly dataset commits keep flowing.

## Contributing

1. Fork / branch from `main`.
2. `bun install`, make your change, `bun run typecheck && bun run build`.
3. Open a PR — CI gates it; the maintainer merges. Merge = automatic deploy.

**Benchmark questions are NOT added via PRs** — they're authored on the gated `/contribute` page of the live site (D1-backed, duplicate-proof). The published `questions.jsonl` export lands in the repo.

## The benchmark

- **Dataset**: real-world photographs selected for verified VLM failure modes — spatial relations, object permanence, counting under clutter, perspective and shadow consistency — plus complex geometric construction problems.
- **Authoring**: contributors write questions + ground-truth answers per image (5+ per image target), tagged (`counting`, `spatial`, `perspective`, …). Duplicate questions are impossible (normalized unique constraint per image).
- **Evaluation**: each question is run against frontier VLMs (GPT / Claude / Gemini / Llama / Qwen families via OpenRouter), responses stored, humans grade `correct / close / wrong`, and the leaderboard ranks models — sliced by tag and difficulty.

## Hygiene

Byte-identical duplicates are tracked by md5 (dedupe stats on the site); images slated for removal can be flagged "do-not-work" so no one authors questions for them. Uniqueness = first occurrence per md5.
