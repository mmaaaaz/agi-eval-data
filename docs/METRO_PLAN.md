# METRO PLAN — metro/transit sub-project website

**Goal**: a second, independent website inside this same Turborepo for the metro/transit
dataset, built by mirroring the foundation (`apps/web` + `apps/relay` + sync cron jobs)
with a new data source: the Google Drive folder `metro/transit_dataset`.

**Status**: PLAN — owner decisions locked (see §10). Reviewed by two independent agents
(2026-08-27); all findings folded in. Implementation-ready.

---

## 1. What we measured (verified 2026-08-27, via Drive API)

Root folder `1FJCnmtmeSsWfznhL0PHjYWn_btoOTRq2` = **`metro/transit_dataset`** (45 folders, 85 images, 30 non-image files, ~210 MB):

| Branch | Folder id | Folders | Images | Other | Bytes |
|---|---|---|---|---|---|
| `ours` | `1dOjYkK8ShSTyxRFD4hP0gZ54ipjiKBxL` | 30 | 55 | 30 (PDFs) | 67 MB |
| `reason_map(exisiting_dataset)` | `1Yey8oStH0X7SSWK7zMr9FRaFxaUHb2xQ` | 13 | 30 | 0 | 142 MB |

`ours` is organized **country → city**: Brazil, Egypt, France, Iran, South Korea, Russia,
Germany, South Africa, Denmark, Portugal, Austria, Japan, Bolivia, Czech, Germany, Scotland,
Spain, UK, Bangladesh, Indonesia, India, Turkey, Thailand, Netherlands, Estonia, Pakistan,
Canada (Quebec/Calgary/Vancouver), ... Each city has 1 image (a metro **network map** —
the dataset is "metro maps by city", not random photos).

`reason_map` is organized **country → city** too (uae, singapore, switzerland, norway,
america, italy, portugal, new_zealand, malaysia, hungary, australia, canada, china — 1 image each).

This is a **small, curated dataset** — not the 54.5k-image firehose of the foundation.
The site should be a **catalog + question-benchmark workspace**, not a heavy analytics surface.

## 2. What "same cron jobs" means here

| Job | Foundation (exists) | Metro (new) |
|---|---|---|
| `sync-data` — daily 06:00 UTC full scan → commit `data/latest.json` (change-gated) | `scripts/drive_scan.py` (whole Drive) | `scripts/metro_scan.py` (root folder only) |
| `sync-share` — every 30 min delta link-share pass | `scripts/share_sync.py` | **reuse, one-line change** — extend the mime query to also cover PDFs (§8) |
| `deploy` — main pushes → relay (Workers) + site (Pages) | existing | extend with metro app path filters + metro jobs (§7) |
| `ci` — PR gate | existing | extend with metro typecheck/build (§7) |

The sync cadence and the *shape* of the pipeline are identical; the data source is scoped to the metro root folder instead of the user's whole Drive.

## 3. Turborepo layout (new apps, new package, new scripts)

```
apps/metro-web        @metro/web   — the new site (Vite · React 19 · TanStack Router · Tailwind v4 · shadcn/ui)
apps/metro-relay      @metro/relay — Cloudflare Worker: chat (gateway + Workers AI fallback) + questions API (D1)
packages/metro-shared  @metro/shared — text normalization (normQ / normTags / normSql) + v4 types
data/metro.json       — THE metro artifact (v4 schema, below) — written by metro_scan.py
scripts/metro_scan.py — Drive scanner scoped to the metro root folder (parents-aware, v4 payload)
scripts/metro_build_data.py — bakes parquet + insights into apps/metro-web/public/data/
docs/METRO_PLAN.md     — this file
```

The foundation keeps its `apps/web`, `apps/relay`, `packages/shared`, `data/latest.json`.
The metro site is a **separate Cloudflare Pages project** (`metro-eval.pages.dev`) and the
metro relay a **separate Worker** (`metro-eval-relay`) with its **own fresh D1 database**
(`metro-eval-questions`). No shared runtime state; the only shared bits are repo-level
tooling conventions.

### Why a separate `apps/metro-web` copy rather than reusing `apps/web`?

- Different data semantics (maps by city vs. contributor firehose), different nav/UX
  (catalog-first vs. analytics-first).
- The foundation's `data.ts`/`duck.ts`/`SyncChip`/`ask.tsx` are hardwired to
  `data/latest.json` + repo constants (`mmaaaaz/agi-eval-data`, cache keys). Retrofitting
  two datasets into one app doubles the conditional complexity and risks the live site.
- A self-contained mirror keeps the foundation app 100% untouched — the deploy/CI path
  filters stay clean, and the metro site can diverge freely (folder browser, per-city pages).

## 4. The metro artifact — `data/metro.json` (v4 schema)

`scripts/metro_scan.py` walks the root folder recursively, capturing **folder ancestry**:

```jsonc
{
  "version": 4,
  "meta": {
    "scannedAt": "ISO", "cron": "0 6 * * *",
    "root": "1FJCnmtmeSsWfznhL0PHjYWn_btoOTRq2",
    "counts": {
      "all": 115, "images": 85, "pdfs": 30,
      "imagesRaw": 85, "imagesUnique": 85, "dupCopies": 0, "videos": 0,
      "bytes": 209379965, "countries": 27, "cities": 85
    }
  },
  "files": [
    // [id, name, ext, size, day, ownerEmail, md5, kind, folders]
    ["1sgjdfzDyLkkn6zSy_I0egb5vy1Oso8EO", "Fortaleza Metro Map.jpg", "jpg", 98886, "2026-08-24", "who@x", "md5", "i",
     ["ours", "Brazil"]],   // ← new: folder path, each segment a Drive folder name
    // ...
  ],
  "owners": { "email": "Display Name" },
  "exif": { "fileId": [width, height] },
  "cams": [],                // maps have no camera metadata; keep the field for schema parity
  "dupGroups": []            // md5 dupes across the metro folder only
}
```

- `folders` (last column) is the **country/city path** — it is the dataset's taxonomy.
  The site groups by it (`ours/Brazil/Fortaleza` → branch=ours, country=Brazil, city=Fortaleza).
- `kind` keeps `i` for images and `o` for PDFs (the PDFs are network maps too — they
  should be **displayed and downloadable**, not dropped).
- `reason_map` is a separate top-level branch (`reason_map/exisiting_dataset/<country>`),
  shown on the site as a **separate toggleable branch**.
- D1 `questions` table keyed by `file_id` works unchanged.

### v4 schema is plumbed END-TO-END (contract)

The 9th `folders` column is visible to every consumer — this list is the full contract:

- `packages/metro-shared/src/types.ts` declares `Row` with a 9th element `folders: string[]`
  (tuple becomes `[id,name,ext,size,day,who,md5,kind,folders]`).
- `Counts` keeps the foundation keys PLUS metro keys so the copied overview never renders
  `undefined`: `{ all, images, pdfs, imagesRaw, imagesUnique, dupCopies, videos, bytes, countries, cities }`.
  `isValid` stays `Array.isArray(d.files) && !!d.meta?.counts` — unchanged.
- `scripts/metro_build_data.py` writes `files.parquet` with a 9th column `folders`
  (JSON-serialized via `json.dumps(row[8])`), plus `exif.parquet`, `owners.parquet`,
  `version.json` (cron `0 6 * * *`), and `insights.json` (metro keys).
- `apps/metro-web/src/lib/duck.ts` maps `r[8]` in `loadArtifactInner` and the parquet
  projection derives **`country` (folders[-2]), `city` (folders[-1]), `branch` (folders[0])**
  as SQL columns (`f.folders[array_length(f.folders)-1] AS city`, …).
- Metro `ask.tsx` `SQL_TOOL` description + relay `SYSTEM_PROMPT`/`FALLBACK_SYSTEM_PROMPT`
  list the real table: **`maps(id,name,ext,size,day,md5,kind,country,city,branch,width,height)`**
  — no orientation/camera/exif promises (see below).
- Metro `index.tsx` overview tiles read `counts.images`, `counts.pdfs`, `counts.countries`,
  `counts.cities` (rewritten; no `dupCopies`/`videos`/`recoverable` tiles).

### exif and PDFs (verified 2026-08-27)

- Metro **image** files DO carry `imageMediaMetadata` (verified: Fortaleza 826×1169,
  Barcelona-v2 2102×1063). `metro_scan.py` requests `imageMediaMetadata` ONLY when
  `mimeType` starts with `image/` (wrapped in try/except) so PDFs never trigger 403s.
- `exif` has no `cameraMake/cameraModel` → `cams: []`; orientation comes from width/height,
  which DO exist for images. PDFs have no exif (dimensions NULL in `maps`).
- **PDF thumbnails work via Google's CDN** (verified: `lh3.googleusercontent.com/d/{pdfId}=w400`
  returns 200 image/png — Google renders the PDF's first page). The same `ThumbImage`
  component handles PDFs with `kind === 'o'` → `https://drive.google.com/thumbnail?id={id}&sz=w400`
  (or lh3, which also works). The detail sheet embeds `https://drive.google.com/file/d/{id}/preview`
  (verified 200) + download `https://drive.google.com/uc?export=download&id={id}`.
- Catalog rows filter `r[7] === 'i' || r[7] === 'o'` — never drop PDFs.

## 5. The metro site — `apps/metro-web`

Same stack, different surface. Routes:

| Route | Content |
|---|---|
| `/` | **Overview**: counts (85 images · 27 countries · 85 cities), country coverage, latest additions, quick jumps |
| `/catalog` | **Catalog**: folder-browser gallery — group by country (or city), thumbnails hotlinked from Google CDN, per-city detail sheet with the full-size map (`=w1600`) + PDF preview/download |
| `/catalog/country/$country` | Per-country page: cities, maps, stats |
| `/ask` | **Chat**: same AI SDK v7 chat as foundation — DuckDB-WASM over the metro artifact (parquet baked), SQL tooling on the `maps` table |
| `/contribute` | **Questions**: same authoring flow (access-gated, dedupe, tags) against the metro D1 |
| `/contribute/evaluate` | **Evaluate**: same manual model-grading + leaderboard |
| `/project` | **About**: dataset provenance, the CVPR sub-project framing, Drive link |

Key differences from the foundation:
- Default artifact URL is `data/metro.json` in the **same repo** (no new env var — see §7).
- **Branch toggle**: `ours` vs `reason_map(exisiting_dataset)` — separate toggleable
  branches in the catalog (default `ours`, one tap to switch).
- **PDFs** (`kind: o`, 30 official network plans): catalog cards with Drive preview iframe
  + direct download; no PDF bytes stored in the repo.
- **Contributors are dropped**: the metro dataset has ONE owner (a shared mailbox), so the
  Contributors tab, the `who` owner filter, `ownerStats`, and the relay's CONTRIBUTOR
  MATCHES block are removed. `owners` stays for name display only. `contributor` in metro
  questions is left blank or fixed to `"metro"`.
- **Brand**: `metro-eval` wordmark + green accent `#10b981` (foundation is blue `#0070f3`).
- **Settings default**: `DEFAULT_RELAY` → the metro Worker URL (NOT the foundation relay);
  `chats.ts` DB_NAME → `metro-eval-chats`; `data.ts` CACHE → `metro-eval-data-v1`.
- The component tree (`ThumbImage` + kind prop, `SyncChip`, `VirtualGallery`, `Lightbox`
  PDF branch, shadcn/ui) is copied from the foundation and lightly adapted (folder path
  instead of owner).

## 6. The metro relay — `apps/metro-relay`

Copy `worker.ts` / `questions.ts` / `http.ts` verbatim, then:

1. `wrangler.toml` → name `metro-eval-relay`, `database_name = "metro-eval-questions"`
   with a NEW `database_id` (from provisioning, §7), keep `[ai]` + `[vars]`
   (`GATEWAY_MODEL`, `RATE_LIMIT_PER_IP`, `FORCE_FALLBACK` — all env-driven, no code change).
2. `worker.ts`: `service: "agi-eval-relay"` → `"metro-eval-relay"`.
3. `SYSTEM_PROMPT` + `FALLBACK_SYSTEM_PROMPT` rewritten for metro: 85 metro network maps
   organized by country/city, table `maps`, columns `country/city/branch`, PDFs excluded
   from counts, **no contributor/orientation/camera promises**.
4. **Table rename `images` → `maps` applied in exactly four places** so the AI's promised
   DDL matches DuckDB: metro `duck.ts` `CREATE TABLE` (both JSON and parquet paths),
   metro `ask.tsx` `SQL_TOOL` description, metro relay `SYSTEM_PROMPT` +
   `FALLBACK_SYSTEM_PROMPT`, and the metro `duck.ts` binder-error hint column list.
5. `apps/metro-relay/package.json` pins the SAME `ai`/`zod` versions as metro-web
   (`ai: ^7.0.77`, `zod: ^3.25.0`) — the streaming contract must match the client.
6. `questions.ts` import `@agi-eval/shared` → `@metro/shared`; `schema.sql` header comment
   → `metro-eval-questions`. `RATE_LIMIT_PER_IP`/`FORCE_FALLBACK`/`GATEWAY_MODEL`/
   `QUESTIONS_CODE`/`ACCESS_CODE`/`GATEWAY_KEY` are env-driven — no code change.
   `UI_MESSAGE_STREAM_HEADERS`, `runSqlTool`, `ipOf`, `allowIp`, `rateMap` carry no
   foundation strings.
7. `schema.sql` = copy of the foundation D1 schema, checked into the repo.

## 7. GitHub Actions + provisioning (review-hardened)

### Provisioning (one-time, local — NOT auto-created)

- **Pages project does NOT auto-create** (verified: `wrangler pages project list` shows
  `agi-eval-data` but no `metro-eval`; wrangler fails on first deploy if missing):
  `npx wrangler pages project create metro-eval --production-branch=main` (one-time).
- **Fresh D1**: `npx wrangler d1 create metro-eval-questions` → paste the returned
  `database_id` into `apps/metro-relay/wrangler.toml`, then
  `npx wrangler d1 execute metro-eval-questions --remote --file=apps/metro-relay/schema.sql`
  (one-time, manual — same pattern as the foundation's HANDOFF runbook).
- First metro deploy is an explicit hand-off after provisioning — not a mystery push.

### Workflow changes

| File | Change |
|---|---|
| `ci.yml` | add metro typecheck + build steps (`bunx turbo run typecheck --filter=@metro/web`, `bunx turbo run build --filter=@metro/web` with `VITE_REPO_METRO`). Path filters already cover `apps/**` + `packages/**` — no filter change |
| `deploy.yml` | add `metro_app` (metro-relay/** or metro-shared/**) and `metro_web` (metro-web/** or metro-shared/**) filter outputs; guard the EXISTING foundation `relay` + `pages` jobs with `&& needs.changes.outputs.metro_app == 'false'` (resp. `metro_web == 'false'`) so metro-only commits never deploy the foundation app; add `packages/metro-shared/**` to the changes filter; add `deploy metro relay` job (`if: metro_app == 'true'`, wrangler deploy in `apps/metro-relay`) and `deploy metro pages` job (`if: metro_web == 'true'`: `pip install pyarrow && python scripts/metro_build_data.py` → `bunx turbo run build --filter=@metro/web` with `VITE_REPO_METRO` → `wrangler pages deploy dist --project-name=metro-eval --branch=main --commit-dirty=true`) |
| `deploy.yml` concurrency | new metro jobs get their OWN group `deploy-metro, cancel-in-progress: false` (workflow-level group `deploy-main` stays for the foundation jobs only — concurrency groups are repo-wide, so shared group would serialize foundation+metro) |
| `sync-data.yml` | change group `sync-data` → `sync-data-main`; fix the push sequence (`git config` already set → `git add data/latest.json` → commit if dirty → `git fetch` + `git pull --rebase origin main` → single `git push origin HEAD:main`) so foundation and metro bots never fight |
| `sync-metro.yml` (NEW) | `concurrency: group: sync-metro`; daily 06:00 UTC; `python scripts/metro_scan.py --ci` (same `DRIVE_*` env) → change gate normalizing `scannedAt` AND `meta.counts` → commit `git add data/metro.json` (`chore(metro): sync …`) → `git pull --rebase origin main` → single push; alert-on-failure identical to sync-data |
| `sync-share.yml` | **unchanged** (the 30-min pass keeps both datasets' thumbnails + PDF previews working after the share_sync.py query fix, §8) |

- `data/metro.json` is added to the deploy path filters so metro artifact changes trigger
  the metro Pages job (`data/**` alone only triggers the foundation job).

### Root scripts + turbo

- Root `package.json` scripts: add `dev:metro-web`, `dev:metro-relay`, `build:metro`,
  `typecheck:metro`, `data:metro` (`python scripts/metro_build_data.py`).
- `turbo.json` `globalEnv` → `["VITE_REPO", "VITE_REPO_METRO"]` (an undeclared env var is
  not part of the cache key — the metro build would silently use stale cached artifacts).
- `bun install` regenerates `bun.lock` — commit it (CI uses `--frozen-lockfile`).
- `packages/metro-shared/package.json`: `{"name":"@metro/shared","private":true,"exports":{".":"./src/text.ts"}}`; both metro apps depend on `"@metro/shared": "workspace:*"`.

## 8. What is deliberately NOT copied/duplicated (review-hardened)

- No new OAuth app, no new Drive scopes — `metro_scan.py` reuses the existing
  `DRIVE_CLIENT_ID/SECRET/REFRESH_TOKEN` (metadata-readonly scope). Zero new secrets.
- `packages/shared` stays as-is (foundation); `packages/metro-shared` is a tiny copy so
  each app's dedupe/normalization is self-contained.
- No local deployment flow — deploys stay GitHub-Actions-only, like the foundation.
- **share_sync.py one-line change**: query becomes
  `q="(mimeType contains 'image/' or mimeType = 'application/pdf') and trashed = false"`
  — otherwise the 30 metro PDFs are never link-shared and their preview/download links
  403 anonymously. The 85 images were already covered.
- **No OG cards for metro** (v1): `scripts/og/gen-route-html.mjs` + `render-og.mjs`
  hardcode `agi-eval-data` + `data/latest.json` and would stamp the foundation's OG tags
  onto the metro site; the metro site is noindex anyway. Metro ships `robots.txt`
  (`User-agent: *` / `Disallow: /`) + `_headers` (`X-Robots-Tag: noindex, nofollow`) like
  the foundation. A metro-specific OG generator can come later.
- **Metro app static files**: copy `public/fonts/` (Geist woff2), `components.json`,
  `tsconfig.json`, `vite.config.ts`, `_headers`; `_redirects` — none needed (fresh paths).

## 9. Build order

1. `scripts/metro_scan.py` — folder-aware scanner (`FIELDS` += `parents`, `--root` arg,
   recursive ancestry walk, `--ci` writes `data/metro.json`, `--from-snapshot` with a
   `folders` field, `analyze()` keeps `dup_report` with `folder_hint` from `parents`);
   run locally against the real Drive to verify counts.
2. `scripts/metro_build_data.py` — parquet (9th `folders` column) + insights →
   `apps/metro-web/public/data/`.
3. `packages/metro-shared` — package.json + `src/types.ts` (v4 Row/Counts) + `src/text.ts`.
4. `apps/metro-relay` — Worker copy + prompts + wrangler.toml + schema.sql + package.json
   (ai/zod pinned to match metro-web).
5. `apps/metro-web` — app copy, routes: Overview, Catalog (folder browse + branch toggle +
   PDF support), Country page, Ask (maps table), Contribute, Evaluate, Project.
6. Provision: `wrangler pages project create metro-eval`, `wrangler d1 create
   metro-eval-questions` → wire wrangler.toml → `d1 execute ... schema.sql`.
7. Workflows: new `sync-metro.yml`, extended `ci.yml` + `deploy.yml` (guards + metro jobs),
   `sync-data.yml` group/push fixes, share_sync.py mime fix; root scripts + turbo.json.
8. Verify: `bun install` (lockfile), `bun run typecheck`, `bun run build` (turbo), local
   `wrangler dev` for the relay, run the metro sync locally once, browser-check the site
   (catalog branch toggle, PDF preview, chat SQL over `maps`).

## 10. Owner decisions (confirmed 2026-08-27)

1. **Pages project**: `metro-eval` → `metro-eval.pages.dev`.
2. **D1**: fresh `metro-eval-questions` database (separate benchmark lifecycle).
3. **PDFs**: displayed on the site (Drive preview iframe + download), organized cleanly in the catalog.
4. **reason_map(exisiting_dataset)**: separate toggleable branch in the catalog.
5. **Questions target**: 5 per image (same as foundation; can grow later).
6. **Brand accent**: green `#10b981`.

All locked — no open questions. Implementation order in §9.
