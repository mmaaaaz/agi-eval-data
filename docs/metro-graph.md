# Metro graph oracle — sidecar, free API, and contributor workflow

A companion to `docs/metro.md`. This doc is the full spec for the metro graph oracle.

The oracle is **graph-native and $0 forever** — no hosted Maps keys, no sync coupling,
no bytes in `data/metro.json` v4.

---

## 1. Why graph-native

Maps are dense, rotated, multilingual diagrams. The only ground truth that does not
re-introduce the same VLM failure we are measuring is an explicit graph of
stations/edges/lines authored per city. That graph can:

- answer short counting questions (S1–S5) directly,
- provide the hops/transfers/path for long routing questions (L1–L5),
- render an in-image overlay to speed authoring (MarkLayer).

No hosted visual service is needed. All routing runs locally.

### Free-API table

| Need | Free API used | Paid alternative (not used) |
|---|---|---|
| dataset artifact | `raw.githubusercontent.com` + jsDelivr fallback (same as `data/metro.json`) | hosted Maps / Distance Matrix |
| graph sidecars | `data/metro-graph.json` single file (`graphs[file_id]`) fetched at runtime (GitHub raw + jsDelivr) | Maps SDK / backend routing |
| drive metadata | `drive.metadata.readonly` scan (metadata only, never download) | — |
| routing | local `BFS` (unweighted) + `Dijkstra` for weighted edges | Directions / Distance Matrix |
| thumbnails | `lh3.googleusercontent.com/d/{id}=w400` hotlink | storing bytes |

## 2. Artifact schema

Sidecar: `data/metro-graph.json` (single file, `graphs[file_id]`; see `data/metro-graph.schema.json` v1) — illustrative sketch (canonical shape in schema):

```json
{
  "version": 1,
  "generatedAt": "2026-08-27T00:00:00Z",
  "source": "data/metro.json#v4",
  "counts": { "graphs": 85, "stations": 0, "edges": 0 },
  "graphs": {
    "1sgjdfzDyLkkn6zSy_I0egb5vy1Oso8EO": {
      "fileId": "1sgjdfzDyLkkn6zSy_I0egb5vy1Oso8EO",
      "city": "fortaleza",
      "country": "Brazil",
      "branch": "ours",
      "stations": [{ "id": "s1", "label": "Central", "lines": ["L1"], "x": 0.12, "y": 0.34, "interchange": false }],
      "edges": [{ "from": "s1", "to": "s2", "line": "L1", "bidirectional": true, "weight": 1 }],
      "lines": { "L1": { "color": "#10b981", "label": "Line 1", "stations": ["s1", "s2"] } },
      "provenance": { "annotatedBy": "human", "annotatedAt": "2026-08-27T00:00:00Z", "tool": "manual" }
    }
  }
```

> **Real = human-annotated (empty skeletons).** `data/metro-graph.json` is committed as 85 empty skeletons — every `graphs[fileId]` has `stations:[], edges:[], lines:{}` and `counts:{stations:0,edges:0}`. No demo stations/edges are pre-filled. Real `stations` + `edges` are authored only by a human in the full-screen graph editor (dedicated route/modal: zoom/pan on the `w1600` transit image, drag/place station dots, draw line edges visually, line colors + interchange toggle + live BFS path) and persisted to the single-file sidecar. The legacy `contribute` sheet is a summary + "Edit graph" CTA into that editor. `apps/metro-web/public/data/metro-graph.json` is a verbatim copy for Vite dev serving.

- `stations[].x`/`y` are normalized `0..1` viewport coordinates — when absent the
  MarkLayer falls back to a search list.
- `edges` are undirected for BFS; `line` on an edge is the carrying line.
- `lines[].stations` is the curated order for S-type line questions.

### Build & validate

```bash
# validate every sidecar against the schema (stations/edges/lines, no dangling refs)
python scripts/metro_graph_validate.py
# or via npm script
bun run check:metro-graph

# build/refresh — single-file sidecar data/metro-graph.json
python scripts/metro_graph_build.py   # normalizes & recounts data/metro-graph.json
python scripts/metro_graph_seed.py    # scaffolds 85 zeroed graphs from data/metro.json
```

Both scripts are local-only and never touch `data/metro.json` (sidecar + BFS/Dijkstra).

## 3. Local routing

All routing is client-side (`packages/site/src/metroGraph/types.ts`):

- `bfsShortest(graph, from, to)` — unweighted hops, shortest by station count.
- `transfersOf(graph, path)` — counts line changes along the path (needs edge `line`).
- `hopsOf(path)` — `max(0, len - 1)`.

When edge weights are present (distance, time), `Dijkstra` replaces BFS. No external call.

## 4. Contributor workflow (8 steps)

1. Open `/contribute` (access-code gated) — the queue shows maps sorted by fewest questions (`n/5` badges).
2. Pick a map; the sheet shows `branch/country/city` chips, existing questions, and the `n/5` count.
3. Toggle the graph assist (when `VITE_ENABLE_MAPS_ASSIST=1`): load the city's sidecar via its slug/file id.
4. Use **MarkLayer** inside the Lightbox image container — station dots + SVG lines, BFS path highlight between two selected stations; disabled for PDFs; `Esc` clears.
5. Open **AssistPanel** — coverage, marks chips, computed hops/transfers/path, and preview of the templates below.
6. Pick a template (verbatim copy — do not edit these strings):

   **S1** How many stations are on the {line} line?
   **S2** Which line(s) serve station {station}?
   **S3** How many transfer stations does this network have?
   **S4** Which station has the most lines intersecting?
   **S5** List the stations on the {line} line in order.

   **L1** How many stops (hops) from {from} to {to} via the shortest path?
   **L2** How many transfers are needed to go from {from} to {to}?
   **L3** What is the shortest path from {from} to {to} (list stations)?
   **L4** Which line(s) would you ride from {from} to {to} with the fewest transfers?
   **L5** Is there a direct (no-transfer) route from {from} to {to}? If not, where is the transfer?

7. Click **Use as question** — the panel fills the authoring fields (question/answer/tags) without auto-submit. Review, adjust difficulty, edit the answer if needed, then **submit**.
8. QA: run the same map on `/contribute/evaluate` against an OpenRouter model (BYOK) or a manual grade; the leaderboard/by-tag view updates after each grade.

### Difficulty

- `easy` — S1–S5 on a single line or single station.
- `medium` — L1–L2 on short paths (≤ 4 hops) or any counting with transfers.
- `hard` — L3–L5 or paths with ≥ 2 transfers / ≥ 7 hops / branching degree ≥ 3 on path (auto-suggest; human-overridable).

### Marking

- Use the `⦻ do-not-work` toggle with a reason for duplicates or maps slated for removal.
- Marks are per-file and visible on the gallery's marked tab and the contribute counter (`N marked →`).

### QA checklist (before submit)

- [ ] Question is verbatim from S/L or a clear paraphrase that preserves the tested reasoning.
- [ ] Answer is the BFS/Dijkstra output (or its exact count/line name), not a VLM guess.
- [ ] Tags include `branch`, `country`, `city` (one-tap chips) + any reasoning tag (`hops`, `transfer`, `path`).
- [ ] Duplicate check passed (no near-identical question for this map).
- [ ] For PDFs the graph assist was not used (MarkLayer is disabled on kind `o`).

## 5. D1 provenance

`questions` carries additive provenance columns — `source TEXT NOT NULL DEFAULT 'human'` (values `human`|`graph`), `graph_file_id TEXT`, `graph_path TEXT`, and `idx_q_source`. They are optional on read (old rows without them read fine via nullable `source?` on `QRow`). The relay's `insertQuestion` writes them when supplied (default `human`) with a fallback insert without them for DBs that have not yet been migrated. `GET /api/questions?source=` filters; tag counts are cleaned with `DELETE FROM tags WHERE count <= 0` after decrements, and `/api/questions/tags` only returns rows with `count > 0`.

## 6. Flag & regression guard

`VITE_ENABLE_MAPS_ASSIST` (env: `"true"` or `"1"` to enable, absent/off = disabled).

- `MarkLayer.tsx` + `AssistPanel.tsx` are behind `React.lazy` — when the flag is off no graph bundle is pulled and the contribute page renders the baseline `AuthorQuestions` unchanged.
- `apps/metro-web/src/routes/contribute.index.tsx` wraps with the graph provider only when the flag is set.

## 7. Limitations

- Sidecars are manual — there is no nightly sync; coverage grows by contribution.
- No hosted Maps key — geocoding/tiles are intentionally out of scope.
- `x`/`y` are viewport-relative; they do not align pixel-perfectly after cropping or non-uniform scaling (the search fallback exists for that case).
- Hourly `sync-metro` still only syncs `data/metro.json`; graph ops checks are separate (see `docs/metro.md` ops table).
