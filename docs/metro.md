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
e.g. `["ours","Brazil"]`. Derived SQL columns: `branch` (folders[0] — normalized via `normalizeBranch`, `reason_map*` → `reason_map` else `ours` from `apps/metro-web/src/lib/data.ts`), `country` (folders[1], trimmed), `city` (derived from filename — each file IS a city). `counts`: images/pdfs/countries/cities.

## Graph oracle (free forever, sidecar + routing)

The graph is **graph-native and sidecar-only** — never inline into `data/metro.json` v4
(9-col `MetroRow` stays untouched) and never behind a hosted Maps key.

- **Artifact**: `data/metro-graph.json` single file (`graphs[file_id]` v1, see `data/metro-graph.schema.json`) with `stations[{id,label,lines,x,y,interchange}]/edges[{from,to,line,bidirectional,weight}]/lines{id:{color,label,stations}}/provenance`. Fetched at runtime from `raw.githubusercontent.com` (single file) with a jsDelivr fallback — same free path as `data/metro.json`. The dataset Drive (`drive.metadata.readonly`) is the only external dependency.
- **Routing**: local `BFS` (unweighted shortest path) for hops/transfers/path highlight, plus `Dijkstra` when edge weights are present. No Maps/Network-distance billing — **$0 forever**.
- **Flag**: `VITE_ENABLE_MAPS_ASSIST` (default off). `MarkLayer` + `AssistPanel` are code-split behind `React.lazy` so flag-off = zero bundle impact / zero regression. Enable with `VITE_ENABLE_MAPS_ASSIST=1 bun run dev:metro-web`.
- **Contributor assist**: `MarkLayer` overlays station dots + SVG lines inside the Lightbox image container (disabled for PDFs), highlights the BFS path between two selected stations; `AssistPanel` shows coverage, marks chips, computed hops/transfers/path, and short/long question templates (S1–S5/L1–L5) with a **Use as question** that fills the authoring fields without auto-submit. Search fallback when no `x`/`y`.
- **Provenance**: `questions` rows carry `source` (`human`|`graph`, default `human`), `graph_file_id`, `graph_path`; `GET /api/questions?source=` filters; `QRow` exposes the three fields as optional.

See `docs/metro-graph.md` for the full spec, build/validate commands, coverage workflow, and limitations.

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
  tag chips (branch/country/city), live near-dupe check, do-not-work flagging; when `VITE_ENABLE_MAPS_ASSIST=1`, the graph assist panel and in-image MarkLayer are available (code-split, off by default — `docs/metro-graph.md`).
- **Sync pill**: hourly countdown + refresh-on-new-data.
- **OG cards**: `og/metro/*.png`, green branding.

## Ops specifics

- Sync: **hourly** (`0 * * * *`) via `sync-metro.yml` → `scripts/metro_scan.py` →
  `data/metro.json` (change-gated commit; also re-renders OG cards on change). Graph sidecars are NOT synced — they are authored locally and committed manually (see `docs/metro-graph.md`); the ops check below verifies at least one sidecar parses.
- Relay: `apps/metro-relay` — **questions API only** (no AI chat). D1 `metro-eval-questions`.
  Schema includes additive provenance columns `source`/`graph_file_id`/`graph_path` (default `human`) and `idx_q_source` — apply with `npx wrangler d1 execute metro-eval-questions --remote --file apps/metro-relay/schema.sql` (fresh) or the three `ALTER TABLE` commands commented in the file for already-provisioned DBs.
- `share_sync.py` link-shares metro PDFs too (query covers `application/pdf`), so the
  Drive preview/download links work anonymously.
- Deploys: `deploy.yml` `metro-pages` + `metro-relay` jobs (direct wrangler, `deploy-metro`
  concurrency group).

| Check | Command | When |
| graph sidecars parse | `bun run check:metro-graph` (or `python scripts/metro_graph_validate.py`) | CI / before contribute |

## Design decisions (locked)

1. **No chat on metro** — catalog-first; the AI chat stays on the foundation site.
2. **Fresh D1** (`metro-eval-questions`) — separate benchmark lifecycle from real-world.
3. **PDFs displayed in-app** — Drive preview iframe + download, not raw downloads.
4. **reason_map as a separate branch** — toggleable, not merged (provenance matters).
5. **Green accent `#10b981`** — visually distinct from the foundation's blue.
6. **Hourly sync** — new dataset wants fresh data; foundation moved to daily (complete).
7. **Graph-native sidecar** — never inline into the dataset artifact; no hosted Maps keys, no sync coupling, $0 forever.
