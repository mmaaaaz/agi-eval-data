# Near-duplicate (CLIP) dedup — metro dataset

Finds same-map-different-bytes duplicates among the **metro/transit_dataset** network
maps (85+ curated maps). These are maps re-uploaded at a different size/render, or the
same network appearing in both branches (`ours` vs `reason_map(exisiting_dataset)`) —
different bytes, same layout. MD5 exact matching (`dupGroups`) can't see these.

## Artifacts

| Path | What it is |
|---|---|
| `dedup/colab_clip_dedup_metro.ipynb` | One-shot notebook. Runs on Colab free T4 (or CPU — only 112 images). |
| `dedup/metro-near-dup.csv` | **The output we commit.** Written by the notebook to your Drive `dedup/findings/`, downloaded via the notebook, then committed here. Schema: `group_id,kept_file_id,dropped_file_id,cosine`. One row per dropped member; **kept_file_id always differs from dropped_file_id**. |
| `dedup/bake_near_dup_metro.py` | Bakes `apps/metro-web/public/data/nearDup.json` from the CSV (joins names/branch/country/city from `data/metro.json`) so the metro site's `/gallery/duplicates` near-dup section can render. Skipped silently if the CSV is absent. |
| `apps/metro-web/src/routes/MetroNearDupSection.tsx` | The review UI: side-by-side thumbnails, cosine, branch/country/city, per-image keep/drop toggles, and **export review CSV**. |
| `dedup/README.md` | This file. |

## How to run the pass

1. Open `dedup/colab_clip_dedup_metro.ipynb` in Colab (File → Upload notebook).
2. **Runtime → Run all.** At the auth prompt choose `maaaazau@gmail.com` (or whoever owns
   the metro Drive folder). Leave the tab ~10 min (112 images only).
3. It lists the metro root folder (`1FJCnmtmeSsWfznhL0PHjYWn_btoOTRq2`), fetches thumbnails,
   embeds, clusters cosine > 0.95, writes `metro-near-dup.csv` to Drive `dedup/findings/`
   and downloads it to your machine, plus a contact sheet to eyeball.
4. Commit that CSV as `dedup/metro-near-dup.csv`.
5. `bun run data:dedup:metro` (or the deploy pipeline) bakes `nearDup.json`.

## Threshold / model notes

- Cosine similarity **> 0.97** on **open_clip ViT-B/32** embeddings (fp32; 112 images
  is trivial, no GPU needed).
- Threshold was **tuned on the real set (2026-09-04)**: the highest same-STYLE
  cross-map similarity is 0.9537 (Casablanca Tramway T3~T4 — *different lines*).
  A true same-map re-encode clusters 0.97+, so 0.97 catches genuine duplicates
  without flagging distinct maps that merely share a visual style.
- **Result of the first verified pass: 0 near-duplicates.** The curated metro set
  has no same-map re-encodes (md5 already handled the one exact copy). `0.95`
  over-flags: it produced 2 false clusters (T3~T4, T1~T2) that pixel-checks
  confirmed were distinct maps.
- Images embedded from **Drive thumbnails (~448px)** — CLIP's native input is 224px.
- **The kept member is never listed as its own drop** — the CSV asserts
  `kept_file_id != dropped_file_id` and fails loudly if violated.

## Local (automatic) run

You don't need Colab at all:

```bash
uv venv C:/Users/Maaz/.dedup-venv
uv pip install --python C:/Users/Maaz/.dedup-venv/Scripts/python.exe torch open_clip_torch requests pillow
C:/Users/Maaz/.dedup-venv/Scripts/python.exe dedup/run_local_dedup.py
```

Fetches public Drive thumbnails (no auth), embeds on CPU, clusters, writes
`dedup/metro-near-dup.csv`, then:
```bash
bun run data:dedup:metro   # bakes apps/metro-web/public/data/nearDup.json
```
