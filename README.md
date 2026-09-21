# agi-eval-data

Three live dataset platforms for an AGI benchmark on **visual & geometric reasoning** — real-world
images, metro/transit network maps, and synthetic geometry where vision-language models fail.

| Site | URL | Dataset | Sync |
|---|---|---|---|
| **Real-world images** | [agi-eval-data.pages.dev](https://agi-eval-data.pages.dev) | 54.5k+ photos where VLMs fail | daily Drive scan → `data/latest.json` |
| **Metro / transit** | [metro-eval.pages.dev](https://metro-eval.pages.dev) | 85 metro network maps · 38 countries · 30 official PDFs | hourly Drive scan → `data/metro.json` |
| **GRIP geometric reasoning** | [grip-eval.pages.dev](https://grip-eval.pages.dev) | 34 synthetic sub-benchmarks · 100k images · 500k closed + 92k open ground-truthed QA | hourly CI re-bake from [upstream dataset repo](https://github.com/bilaljawaid980/Geomatric-Reasoning-Benchmark-Dataset) → `data/grip/` |

Questions are authored on the web/metro sites (access-gated) and frontier VLMs are graded
against them. GRIP ships its own ground truth — that site browses samples with tabbed
closed (L1–L5) / open-ended questions and stages override edits (KV → one atomic commit
on the upstream repo → auto re-bake → deploy).

---

## Architecture

Turborepo workspace (bun):

```
apps/web           real-world images site — Vite · React 19 · TanStack Router · Tailwind v4 · shadcn/ui · DuckDB-WASM chat
apps/relay         Cloudflare Worker — AI chat relay (Vercel AI Gateway + Workers AI fallback) + questions API (D1)
apps/metro-web     metro/transit site — same stack, NO chat — catalog (branch toggle, PDF preview), questions workspace
apps/metro-relay   Cloudflare Worker — questions API only (D1 metro-eval-questions)
apps/grip-web      GRIP geometric-reasoning site — browse 34 sub-benchmarks, ground-truth spoilers, scene overlays
                   + /open-models  the open-model evaluation report (leaderboard, matrix, compare, audit)
apps/grip-sync     Cloudflare Worker — stages override edits in KV, syncs to the upstream dataset repo (1 atomic commit)
packages/shared    text normalization (normQ / normTags / normSql) — web + relay
packages/site       shared UI/data/questions + metroGraph (MarkLayer, AssistPanel, types, routing)
packages/questions-api  shared D1 API factory (source filtering + tags GC)
scripts/           Drive scanners (drive_scan.py, metro_scan.py), build tooling, OG renderers
data/latest.json   THE real-world artifact — overwritten by the sync bot (change-gated)
data/metro.json    THE metro artifact (v4: folders/country/city taxonomy)
data/grip/         THE grip artifacts (tree.json + {slug}.json.gz ×34) — baked by scripts/grip_scan.py
data/open-models/  THE open-model artifacts — models.json (baked by scripts/open_models_bake.py from the raw
                   runs in data/open-model-analysis/), reanalysis.json (baselines + adjusted scores) and
                   grain.json (the grain sweep over data/grain_test/)
docs/              plans & decision log · docs/METRO_PLAN.md is the metro design · docs/grip.md is the grip design
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
- **Sync pill** — counts down to the hourly data sync; becomes a refresh button
  when new data lands.

## The grip site (apps/grip-web)

- **Browse** — 34 sub-benchmarks · 100k synthetic geometry images · 500k questions, each
  with its validator-recomputed ground truth (spoiler-hidden per question).
- **Categories** — full folder tree incl. legacy snapshot subsuites (`sample_test`, …).
- **Edits & sync** — stage an override on any question/scene value (KV + local mirror),
  then sync: the grip-sync worker lands all staged edits on the upstream repo as ONE
  atomic commit (`data/overrides/`) and dispatches `grip-rebake` → CI re-bakes from
  upstream → Pages redeploys. Drift-checked at both ends (`baseCommitAtEdit` SHA anchor);
  conflicts block the sync instead of overwriting.

## The open-model report (`/open-models`, inside apps/grip-web)

A nested report on the grip site — no separate deployment. Every answer that each open VLM
produced on the GRIP benchmark is re-graded by **one frozen rule**, so each model has exactly
one accuracy; the runs' own scorer is reported beside it as a grader-quality check.

| Page | What it shows |
|---|---|
| `/open-models` | Leaderboard, findings, difficulty curve, family bars, head-to-head |
| `/open-models/domains` | Every domain / family / level as a sortable, filterable table (+ TSV export) |
| `/open-models/domains/$slug` | Domain detail: level ladder, oracle, question formats, sampled disagreements |
| `/open-models/matrix` | Domain × level heat grid for one model and one metric |
| `/open-models/compare` | Any two runs: wins, per-family/level gaps, 1:1 scatter, paired table |
| `/open-models/audit` | Grader disagreements classified, zero levels, single-answer levels, ground-truth drift |
| `/open-models/reanalysis` | Test-1 reanalysis: constant-answer baselines on the evaluated sample, the adjusted transform, image-level bootstrap CIs, cross-checks |
| `/open-models/grain` | Grain-robustness sweep (σ 15/25/40): each condition paired against the clean run of the same model on the same images |
| `/open-models/method` | The frozen rule, what was verified, exact vs rule-dependent, caveats, reproduce |
| `/open-models/models/$id` | Per-run card: levels, families, strengths, grader disagreements |

**Adding a model is a data change, not a code change.**

```bash
# 1. drop the run: one JSONL per domain (question_id / level / prediction / groundtruth / correct / ...)
#    data/open-model-analysis/<run-dir>/<model-id>/*.jsonl      <- either layout works
bun run data:open-models     # bake + publish into apps/grip-web/public/data/
# 2. the bake seeds a models.meta.json entry for the new run — fill in label / org / params /
#    license / links (params and licence are on the model's Hugging Face card), then re-bake:
bun run data:open-models
bun run dev:grip-web         # /open-models
```

The bake refuses to ship an unpaired comparison: every run must record the **same ground truth
for the same question id** as the reference run (it prints `N mismatches / M missing`, and the
Method page states it), so a run from another team is either comparable or visibly not.

The raw runs (hundreds of MB) are git-ignored; the baked artifact (~140 KB) is committed and
read by the site at runtime (same-origin first, then raw.githubusercontent / jsDelivr), so a
re-bake goes live without touching a component. `open_models_bake.py` asserts its own
invariants before writing, and `src/lib/openModelsReport.test.ts` cross-checks the headline
figures against the standalone report this section replaced
(`data/open-model-analysis/legacy/`).

## Local development

```bash
bun install                # workspace install (apps + packages)

bun run dev:web             # real-world site on localhost:5173
bun run dev:metro-web       # metro site on localhost:5174 (or 5183)
bun run dev:grip-web        # grip site (incl. /open-models) on localhost:5175
bun run dev:relay           # foundation worker on localhost:8787
bun run dev:metro-relay     # metro worker on localhost:8788
bun run typecheck           # tsc across the workspace
bun run build               # turbo build (cached)

# dataset tooling (python)
python scripts/drive_scan.py            # full Drive scan → data/latest.json
python scripts/metro_scan.py            # metro folder scan → data/metro.json
python scripts/grip_fetch.py            # upstream annotations+overrides → .grip-cache/
python scripts/grip_scan.py             # bake → data/grip/*.json.gz (+ public copy)
python scripts/grip_validate.py         # dataset invariants + override conflict check
python scripts/metro_build_data.py      # bake metro version.json (sync feed)
python scripts/open_models_bake.py      # re-grade the open-model runs -> data/open-models/models.json
python scripts/open_models_public.py    # copy that artifact into apps/grip-web/public/data/
python scripts/open_models_test1_reanalysis.py   # baselines + adjusted scores + bootstrap CIs -> reanalysis.json
python scripts/open_models_test1_report.py       # render docs/open-models-test1-reanalysis.md from it
python scripts/open_models_grain.py             # grain sweep -> data/open-models/grain.json (paired deltas + CIs)
python scripts/open_models_grain_report.py      # render docs/open-models-grain-sweep.md from it
```

Each site expects its relay URL + access code in `/settings` (stored in your browser).
Defaults point at the deployed workers.

## Deployment (GitHub Actions — no local deploys)

| Workflow | Trigger | Does |
|---|---|---|
| `ci` | PRs + pushes touching code | typecheck + build both sites (gates merges) |
| `deploy` | pushes to `main` touching code | deploy both relays (Workers) + both sites (Pages), per-app path filtering |
| `sync-data` | daily 06:00 UTC + manual | real-world Drive scan → `data/latest.json` → commit (change-gated) |
| `sync-metro` | hourly (every :00) + manual | metro folder scan → `data/metro.json` → commit (change-gated) |
| `sync-share` | every 30 min | link-share new images + PDFs (thumbnails/previews work anonymously) |

**Required repo secrets**: `CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit + Cloudflare
Pages:Edit), `CLOUDFLARE_ACCOUNT_ID`. The data syncs use `DRIVE_CLIENT_ID` /
`DRIVE_CLIENT_SECRET` / `DRIVE_REFRESH_TOKEN` (metadata-only scope; OAuth app must stay
**In Production**).

`main` is protected: PR-only merges, `ci` must pass. The data-sync bot
(`github-actions[bot]`) is bypass-allowed so scheduled dataset commits keep flowing.
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
