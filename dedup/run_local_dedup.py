#!/usr/bin/env python3
"""
Local CLIP near-duplicate finder for the METRO dataset.

Fully automatic, no browser/Colab needed. Fetches each metro map as a public
Drive thumbnail (no auth), embeds with open_clip ViT-B/32 (CPU), clusters
cosine > 0.95, and writes dedup/metro-near-dup.csv.

Run:  python dedup/run_local_dedup.py
Requires: pip install torch open_clip_torch pillow requests (CPU torch is fine)
"""
import csv
import io
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import requests
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data", "metro.json")
CSV_OUT = os.path.join(ROOT, "dedup", "metro-near-dup.csv")

THUMB_W = 448
# Threshold tuned on the real metro set: the highest same-STYLE cross-map
# similarity is 0.9537 (Casablanca T3~T4, different lines). A true
# same-map re-encode clusters far higher (0.97+). 0.97 therefore catches
# genuine duplicates without flagging distinct maps that share a visual
# style. Verified 2026-09-04: at 0.97 the full 112-image matrix yields
# zero clusters = the curated set has no near-duplicates.
THRESH = 0.97
WORKERS = 16


def load_metro_ids():
    """Return list of (file_id, md5, name) for all image-kind rows."""
    data = json.loads(open(SRC, encoding="utf-8").read())
    rows = [r for r in data["files"] if r[7] == "i"]
    seen, out = set(), []
    for r in rows:
        if r[6] in seen:
            continue
        seen.add(r[6])
        out.append({"id": r[0], "md5": r[6], "name": r[1]})
    return out


def fetch(fid: str):
    url = f"https://lh3.googleusercontent.com/d/{fid}=w{THUMB_W}"
    try:
        r = requests.get(url, timeout=30)
        if r.status_code != 200:
            return fid, None, r.status_code
        return fid, Image.open(io.BytesIO(r.content)).convert("RGB"), 200
    except Exception as e:  # noqa: BLE001
        return fid, None, f"err:{type(e).__name__}"


def main():
    t0 = time.perf_counter()
    imgs = load_metro_ids()
    ids_all = [x["id"] for x in imgs]
    print(f"[1/4] {len(ids_all)} unique metro images (post-md5)", flush=True)

    # fetch thumbnails in parallel
    print(f"[2/4] fetching {THUMB_W}px thumbnails ({WORKERS} threads)…", flush=True)
    images = {}  # fid -> PIL
    errors = []
    with ThreadPoolExecutor(WORKERS) as pool:
        for fid, img, st in pool.map(fetch, ids_all):
            if img is not None:
                images[fid] = img
            else:
                errors.append((fid, st))
    print(f"  fetched {len(images)}/{len(ids_all)} ({len(errors)} failed)", flush=True)
    if errors:
        print("  unreadable:", errors[:10], flush=True)

    # embed
    import torch
    import open_clip

    print("[3/4] loading CLIP ViT-B/32 + embedding (CPU)…", flush=True)
    model, _, preprocess = open_clip.create_model_and_transforms("ViT-B-32", pretrained="openai")
    model = model.eval()

    order = [fid for fid in ids_all if fid in images]
    embs = []
    with torch.no_grad():
        for i in range(0, len(order), 32):
            batch = torch.stack([preprocess(images[fid]) for fid in order[i : i + 32]])
            e = model(batch)[0]
            e = e / e.norm(dim=-1, keepdim=True)
            embs.append(e.cpu().float())
    X = torch.cat(embs).numpy().astype("float32")
    print(f"  embedded {X.shape[0]} images → {X.shape[1]}-dim", flush=True)

    # union-find over cosine > THRESH
    print(f"[4/4] clustering cosine > {THRESH}…", flush=True)
    N = X.shape[0]
    parent = list(range(N))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)

    XT = X.T
    B = 1024
    for s in range(0, N, B):
        block = X[s : s + B] @ XT
        idx = np.argwhere(block >= THRESH)
        for bi, j in idx:
            i = bi + s
            if j < i:
                union(i, j)
        del block

    groups_ = {}
    for i in range(N):
        groups_.setdefault(find(i), []).append(i)
    clusters = sorted((g for g in groups_.values() if len(g) > 1), key=len, reverse=True)

    # write CSV (kept != dropped, asserted)
    rows = []
    groups_out = []
    for n, cluster in enumerate(clusters, 1):
        gid = f"nd-{n:05d}"
        mat = X[cluster] @ X[cluster].T
        keep_local = int(mat.mean(axis=1).argmax())
        keep = cluster[keep_local]
        keep_fid = order[keep]
        for i in cluster:
            if i == keep:
                continue
            cos = float(X[i] @ X[keep])
            rows.append(
                {"group_id": gid, "kept_file_id": keep_fid, "dropped_file_id": order[i], "cosine": f"{cos:.4f}"}
            )
        groups_out.append({"id": gid, "kept": keep_fid, "members": [order[k] for k in cluster]})

    os.makedirs(os.path.dirname(CSV_OUT), exist_ok=True)
    with open(CSV_OUT, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["group_id", "kept_file_id", "dropped_file_id", "cosine"])
        w.writeheader()
        w.writerows(rows)

    # audit
    assert all(r["kept_file_id"] != r["dropped_file_id"] for r in rows), "kept==dropped BUG"
    print(f"\n✅ {len(clusters)} near-dup clusters · {len(rows)} drop rows → {CSV_OUT}", flush=True)
    for g in groups_out:
        kept = next(x for x in imgs if x["id"] == g["kept"])
        drops = [next(x for x in imgs if x["id"] == d) for d in g["members"] if d != g["kept"]]
        print(f"  {g['id']}: kept={kept['name'][:30]} ~ {[d['name'][:30] for d in drops]}", flush=True)
    print(f"done in {time.perf_counter() - t0:.1f}s", flush=True)


if __name__ == "__main__":
    main()
