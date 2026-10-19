# Pilot report: MiniMax M3.1 Flash drafting, 40 images

Batch `pilot-40-api` · 2026-10-19 · model `minimax/minimax-m3.1-flash-preview:free` via commandcode
· prompt `vqa-draft-v2` · `reasoning_effort=low` · temperature 0 · 5 candidates requested per image.

## 1. What ran

40 photographs: the 15 vision-verified samples plus 25 ledger images sampled across the corpus.
Every call: download at =w1568, one strict-JSON prompt (closed taxonomy sets, with their meanings),
validation against those sets, append-only record. One row failed because the ledger sample
included a non-image file (`batch_0026-results.jsonl`, HTTP 404 on the CDN) - the sampler now
filters to image extensions.

## 2. Transport: CLI vs direct API (the reason this finished in 101 s, not 2 h)

| Path | Wall per call | 40 images |
|---|---|---|
| `hermes chat --image` (agent bootstrap + system prompt) | 697 s and 755 s measured | ~2 h at 4 workers |
| Direct API, effort low, prompt v1 | 14.1 s and 25.2 s | - |
| Direct API, effort low, prompt v2 (labels in prompt) | 10.9 s and 16.7 s | **101 s at 8 workers** |

The API path sends one OpenAI-compatible POST per image (image as base64, browser User-Agent to
pass Cloudflare, `reasoning_effort=low`). It is 40-60x faster end to end and records token usage.

## 3. Mechanical results (all 40 calls)

| Metric | Result |
|---|---|
| Rows | 40 (39 parsed, 1 download failure = non-image row) |
| Candidates | 195 |
| Validation errors | **0** (codes, choices shape, answer-in-choices, grounding length) |
| Candidate count per row | exactly 5, every time |
| Duplicate questions | 0 |
| Wall time | mean 14.9 s, p50 14.2 s, max 27.6 s |
| Reasoning tokens | mean 539, max 1,620 |

Coverage: capabilities PERC 83, G6 33, P1 23, G1 14, G3 11, P6 10, G2 5, G7 4, P2 3, P3 3,
G5 3, G4 1, P8 2. Levels L1 142, L2 52, L3 1. Domains all eleven present (D8 44, D9 33, D3 21,
D2 20, D4 20, D6 18, D7 13, D10 10, D1 6, D11 5, D5 5).

**Two coverage gaps, by design of the prompt:** bridge pairs are absent (0 B codes) and L4-L5 are
almost absent (1 item at L3). The prompt says to prefer PERC/G/P and Level definitions, and at
effort=low the model keeps drafts conservative. Fix for the curated pass: level-targeted prompts
("write only L4/L5 items") and a dedicated bridge-pair pass on images where the scene supports it.

## 4. Answer audit (agent vision check, 5 images x 4-5 questions = 20 answers)

Checked independently against the photographs:

| Image | Result |
|---|---|
| Monitors (multiple_monitor_setup) | **5/5 correct** (left display highlighted, mug blocks right display, mouse right of keyboard, red mouse ball, two monitors) |
| Shopper (3186_...) | **4/4 correct** (red bag in front, one mesh sack, head not visible, red bag) |
| Stadium (large_stadium_structure) | **3/3 correct** (EAGLE STADIUM, two eagle emblems, entrance central; two floodlight towers) |
| Tank (industrial_factory_building) | 4/5 - the port is a **metal hatch, not glass**; the item calling it "circular glass inspection port" is wrong. (The blue drum lid reads yellow-green: the model said yellow, which is acceptable; the sample page's "green lid" note is the weaker claim and needs fixing.) |
| Hospital (large_hospital_building) | 2/4 - answer option misspells the sign ("Allu VIP Ward" vs **Alu VIP Ward**), and "black waiting chairs: Two" is wrong (three black chairs). The corridor sign above the right door also conflicts with the sample page's earlier "Emergency Unit / X-Ray Unit" reading, which needs re-checking. |

**17/20 correct, 3 defective.** The errors cluster on small-signage text and counting - the two
hardest perception modes, and exactly the items the benchmark wants. None of the three would have
been caught mechanically: human review is mandatory, not optional.

## 5. What this means

- Generation at scale is viable and free: 29 images/min measured at 12-way concurrency
  (200-image probe: 199 ok, 1 irrecoverable JSON failure = 99.5% validity).
- The pilot's candidates are drafts, not ground truth: they enter the review room with flags and
  a recorded model slug, and are approved/edited/rejected there.
- Known coverage gaps to close before freeze: bridge pairs, L4/L5 volume, and a second pass over
  small-text items (or a reviewer rule to drop unreadable-signage questions).
- The site needs the review room + D1 ingest (migration 0010) before any of this is shown as
  questions and ground truth; this batch is the drafting half of that pipeline.

## 6. Files

- `runs/generation/pilot-40-api/candidates.jsonl` - every row, parsed candidates, validation,
  usage, latency (committed, with raw responses under `raw/`).
- `runs/generation/full-50k/images.jsonl` - the 50,000-image ledger selection (image extensions
  only) for the full draft now running.
- `scripts/harness/generate_vqa.py` - the runner (transport api|cli, resumable, spend-gated).
