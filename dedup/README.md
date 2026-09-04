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

- Cosine similarity **> 0.95** on **open_clip ViT-B/32** embeddings (fp32; 112 images is
  trivial, no GPU needed).
- Images embedded from **Drive thumbnails (~448px)** — CLIP's native input is 224px crops.
- **The kept member is never listed as its own drop** — the CSV asserts
  `kept_file_id != dropped_file_id` and fails loudly if violated.
- Tighten to 0.97 or use ViT-L/14 for stricter perceptual matching (still trivial at 112).
