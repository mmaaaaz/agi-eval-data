# Feature Backlog — agi-eval-data

_Curated improvement queue. Everything here was evaluated against one question: does it make the benchmark better, or just the dashboard busier?_

Status legend: `idea` → `planned` → `shipped`

---

## Tier 1 — Benchmark science (compounds over time)

### 1. Task taxonomy + coverage matrix `idea` — **recommended next**
- JSON schema in-repo defining reasoning categories: counting, spatial relations, perspective/occlusion, mirror symmetry, shadow consistency, pattern completion, …
- Gallery tagging (keyboard-driven) writes to a review file; CI merges.
- Payoff page: **coverage matrix** (category × contributor) exposing thin spots instantly.
- Why first: turns an image collection into a benchmark. Do before the dataset doubles.

### 2. Quality-flag engine in CI `idea` — cheapest big win
- One Python pass in sync: flag screenshots (no camera + exact-pixel dims), <1MP, extreme ratios, software-edited (EXIF software tag), grayscale scans.
- `flags[]` per image in artifact; gallery filter; contributor feedback.
- Effort: S. Zero new infrastructure.

### 3. CLIP embeddings → similarity + semantic dedup `idea`
- CI computes quantized CLIP embeddings per thumbnail into the artifact.
- Unlocks: find-similar from any image, semantic cluster view, near-dup detection that catches re-compressed/re-cropped copies (beyond MD5 and pHash).
- Effort: M-L. If only one dedup upgrade ever: this one.

### 4. Failure-verification loop `idea` — scientific credibility
- Periodically run 2–3 open VLMs over a sample; record pass/fail per image + per category.
- Dashboard badge: "verified failure rate". Answers the reviewer question "did you check models actually fail?" with a number.
- Effort: L. Do once collection stabilizes.

## Tier 2 — Pipeline & hygiene

### 5. History store → real trends `idea`
- CI appends weekly summary to `data/history.json` (count, dupes, bytes, per-contributor).
- Enables honest velocity charts + growth projection ("50k by Nov 30").
- Effort: S. The sooner it starts, the sooner charts have data.

### 6. Weekly digest issue `idea`
- Sync bot posts a Friday GitHub issue: "+1,842 images · 37 dupes · 2 new contributors · biggest day: Saturday."
- Team ritual, zero UI. Effort: S.

### 7. License/consent field `idea`
- Per-contributor (or per-image) rights attestation enum. Publishing hygiene — the answer should exist before it's needed. Effort: S.

### 8. Artifact sharding tripwire `idea`
- At ~1–5k uploads/day, `latest.json` grows ~2 MB/week gzipped. Tripwire: raw > 25 MB → shard per contributor + manifest. Document threshold now; build later.

## Tier 3 — Delights (half-day total)

- **Bulk selection** in gallery (shift-click ranges) feeding the export manifest.
- **Random-image dice** — spot-check curation in team calls.
- **Milestone moments** — one-time settle/confetti at 25k & 50k (reduced-motion safe).
- **`?` shortcut cheat-sheet** overlay.

## Deliberately NOT doing

- Per-image comment threads (Discord exists)
- Multi-language UI (team of 7)
- Realtime WebSocket sync (hourly data; polling + SWR is correct)
- Custom auth/roles (Cloudflare Access exists if ever needed)

## Suggested order

1. #2 + #6 (one session, immediate value)
2. #1 taxonomy (before dataset doubles again)
3. #3 CLIP (after #1 — they multiply)
4. #5 history (anytime)
5. #4 verification loop (once collection stabilizes)
