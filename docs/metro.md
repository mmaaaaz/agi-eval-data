# Metro / Transit Dataset — design & ops

The **metro-eval** sub-project: a curated benchmark of metro network maps where
vision-language models fail. Live at [metro-eval.pages.dev](https://metro-eval.pages.dev).

---

## Dataset (verified 2026-08-27)

Drive folder `metro/transit_dataset` (`1FJCnmtmeSsWfznhL0PHjYWn_btoOTRq2`), two branches:

| Branch | Folder id | Maps | PDFs | Structure |
|---|---|---|---|---|
| `ours` | `1dOjYkK8ShSTyxRFD4hP0gZ54ipjiKBxL` | 55 | 30 | country → city |
| `reason_map(exisiting_dataset)` | `1Yey8oStH0X7SSWK7zMr9FRaFxaUHb2xQ` | 30 | 0 | country → city |

Totals: **85 maps · 38 countries · 85 cities · 0 duplicate bytes** (~315 MB).

Each file is one city's official network map. `ours` is the curated set; `reason_map` is a
reference from an existing dataset — the site keeps them as **separate toggleable branches**
and offers a `/compare` view (both / ours-only / existing-only per country).

The 30 PDFs in `ours` are official network plans (Berlin, Delhi, Prague…) — displayed
in-app via Google Drive preview + downloadable; they're not question targets.

## Why maps, why now

Part of a CVPR submission on VLM failure modes (three sub-projects: real-world images,
geometric shapes, metro/transit). Network maps are dense, rotated, multilingual diagrams —
VLMs misread station counts, line colors, transfer paths, and spatial layout. Humans read
them easily → high human/VLM accuracy gap, exactly what the benchmark measures.

Target: **5+ questions per map** (route tracing, transfer counting, line identification,
spatial reasoning). Authored on `/contribute`, graded on `/contribute/evaluate`.

## Artifact & taxonomy

`data/metro.json` (v4): rows carry a 9th `folders` column — the folder path from the root,
e.g. `["ours","Brazil"]`. Derived SQL columns: `branch` (folders[0]), `country` (folders[1]),
`city` (derived from filename — each file IS a city). `counts`: images/pdfs/countries/cities.

## Site features

- **Catalog** (`/catalog`): branch toggle (Ours 25 / Existing 13), country cards → per-country
  grid of maps + PDFs; every file opens in the in-app **Lightbox** (images via CDN full-size,
  PDFs via Drive preview iframe + download; ←/→/Esc nav across types).
- **Compare** (`/compare`): side-by-side ours vs reason_map per country.
- **Gallery** (`/gallery`): tabs — Images (searchable by city/country), PDFs, Contributors,
  Duplicates (md5 check; currently clean).
- **Overview**: hero counts, coverage dashboard (avg questions per map per country,
  color-coded vs the 5-target, links into catalog).
- **Contribute**: queue sorted by fewest questions (`n/5` badges), one-tap folder-derived
  tag chips (branch/country/city), live near-dupe check, do-not-work flagging.
- **Sync pill**: hourly countdown + refresh-on-new-data.
- **OG cards**: `og/metro/*.png`, green branding.

## Ops specifics

- Sync: **hourly** (`0 * * * *`) via `sync-metro.yml` → `scripts/metro_scan.py` →
  `data/metro.json` (change-gated commit; also re-renders OG cards on change).
- Relay: `apps/metro-relay` — **questions API only** (no AI chat). D1 `metro-eval-questions`.
- `share_sync.py` link-shares metro PDFs too (query covers `application/pdf`), so the
  Drive preview/download links work anonymously.
- Deploys: `deploy.yml` `metro-pages` + `metro-relay` jobs (direct wrangler, `deploy-metro`
  concurrency group).

## Design decisions (locked)

1. **No chat on metro** — catalog-first; the AI chat stays on the foundation site.
2. **Fresh D1** (`metro-eval-questions`) — separate benchmark lifecycle from real-world.
3. **PDFs displayed in-app** — Drive preview iframe + download, not raw downloads.
4. **reason_map as a separate branch** — toggleable, not merged (provenance matters).
5. **Green accent `#10b981`** — visually distinct from the foundation's blue.
6. **Hourly sync** — new dataset wants fresh data; foundation moved to daily (complete).
