# Near-duplicate (CLIP) dedup

Finds same-photo-different-bytes duplicates — photos re-uploaded cropped,
re-compressed or re-sized — that MD5 exact matching (`duplicates.csv`) can't see.

## Artifacts

| Path | What it is |
|---|---|
| `dedup/colab_clip_dedup.ipynb` | One-shot notebook. Free Colab T4 · **Runtime → Run all** · leave tab ~1h. |
| `dedup/near-dup.csv` | **The output we commit.** Written by the notebook to your Drive `dedup/findings/`, downloaded via the notebook, then committed here. Schema: `group_id,kept_file_id,dropped_file_id,cosine`. One row per dropped member. |
| `dedup/bake_near_dup.py` | Bakes `apps/web/public/data/nearDup.json` from the CSV (joins names/sizes from `data/latest.json`) so the site's `/gallery/duplicates` near-dup section can render. Skipped silently if the CSV is absent. |
| `dedup/README.md` | This file. |

## How to run the pass

1. Open `dedup/colab_clip_dedup.ipynb` in Colab (File → Upload notebook, or clone the repo in Drive-adjacent way).
2. **Runtime → Run all**, leave the tab open ~1h.
3. When it finishes it writes `near-dup.csv` + a contact sheet to Drive `dedup/findings/` and downloads the CSV to your machine.
4. Commit that CSV as `dedup/near-dup.csv`.
5. `python dedup/bake_near_dup.py && bun run build` (or the normal deploy pipeline's `data:build`).

## How the UI consumes it

`apps/web/src/routes/NearDupSection.tsx` fetches `/data/nearDup.json` on
`/gallery/duplicates` and renders each group with side-by-side thumbnails,
similarity, and per-image **keep/drop** toggles plus an **export review CSV**
button. The exported CSV (`group_id,file_id,verdict,similarity,filename`) is
what you hand back to run a Drive trash pass later — the site never deletes
anything and holds no Drive credentials.

## Threshold / model notes

- Cosine similarity **> 0.95** on **open_clip ViT-B/32** embeddings.
- Images are embedded from **Drive thumbnails (~448px)** — CLIP's native input is
  224px crops, so this is more than enough detail and keeps transfer ~3–4 GB
  instead of ~200 GB.
- A 200-image dry run is recommended before the first full pass (visually
  verify ~10 flagged pairs make sense).
- Tighten to 0.97 or swap to ViT-L/14 (a flag in the notebook) for stricter
  perceptual matching — slower, still fine on T4.
