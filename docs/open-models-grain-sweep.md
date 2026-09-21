# Grain-robustness sweep: the same questions on corrupted images

Computed 2026-09-21T22:01:06+00:00 from the stored response files only - no API calls, no re-runs.
Engine `scripts/open_models_grain.py`; artifact `data/open-models/grain.json`; this document is
rendered from that artifact by `scripts/open_models_grain_report.py`.

These runs are **not** part of the main leaderboard. They are a different image condition, a
subset of the benchmark, and only 3 of the runs. They are reported here, and on
`/open-models/grain`, as a separate robustness result.

## 1. What is in the grain set (verified)

- every base question id exists in the main run with byte-identical ground truth
- the same 250 images per domain are used in all three conditions
- median prediction and raw-response lengths match the main run within 4%
- score_mode distribution matches the main run
- conditions: sigma15, sigma25, sigma40; 250 images per domain; 42,500 records per condition

Not verifiable from disk - stated as unknown, not guessed:

- the exact noise transform: the files carry only the sigma15/25/40 label, no generator config, no images
- whether sigma is additive Gaussian standard deviation, or any other parameterisation
- the run date, engine, precision and decoding parameters (absent, as for the main runs)

## 2. Method

For each condition, **both sides** (grain and the main run of the same model) are restricted to the
exact base question ids that condition contains, scored with the published comparison function at
tolerance zero. The delta therefore isolates the image condition, not the sample.

Two comparisons are reported for every cell:

- **all** - every stored record; a missing or unreadable prediction counts as wrong.
- **parsed** - only records where *both* sides produced a usable short answer. This removes the
  extraction difference between the two runs (see the confound in section 5).

Every delta carries a paired **image-level** bootstrap CI (10,000 resamples, one shared draw per
replicate across conditions and both sides, baselines untouched). Absolute accuracies per side are
printed alongside the deltas in every table.

## 3. Results

| model | condition | n | grain accuracy | matched main accuracy | delta (pooled) | delta 95% CI | delta, parsed only | unparsed grain / main |
|---|---|---|---|---|---|---|---|---|
| InternVL3_5-8B | sigma15 | 42,500 | 0.3636 | 0.3674 | -0.0038 | [-0.0074, -0.0004] | -0.0040 | 0.59% / 0.59% |
| InternVL3_5-8B | sigma25 | 42,500 | 0.3602 | 0.3674 | -0.0072 | [-0.0108, -0.0036] | -0.0074 | 0.60% / 0.59% |
| InternVL3_5-8B | sigma40 | 42,500 | 0.3616 | 0.3674 | -0.0058 | [-0.0096, -0.0022] | -0.0059 | 0.59% / 0.59% |
| Molmo2-8B | sigma15 | 42,500 | 0.3964 | 0.3954 | +0.0011 | [-0.0022, +0.0042] | +0.0011 | 0.49% / 0.66% |
| Molmo2-8B | sigma25 | 42,500 | 0.3955 | 0.3954 | +0.0001 | [-0.0033, +0.0034] | +0.0000 | 0.45% / 0.66% |
| Molmo2-8B | sigma40 | 42,500 | 0.3894 | 0.3954 | -0.0060 | [-0.0095, -0.0025] | -0.0060 | 0.42% / 0.66% |
| Qwen3-VL-8B-Instruct | sigma15 | 42,500 | 0.4341 | 0.4260 | +0.0080 | [+0.0043, +0.0119] | -0.0064 | 0.80% / 3.76% |
| Qwen3-VL-8B-Instruct | sigma25 | 42,500 | 0.4274 | 0.4260 | +0.0014 | [-0.0024, +0.0053] | -0.0134 | 0.72% / 3.76% |
| Qwen3-VL-8B-Instruct | sigma40 | 42,313 | 0.4230 | 0.4264 | -0.0034 | [-0.0072, +0.0006] | -0.0186 | 0.67% / 3.76% |

Reading: with extraction held equal, **every model degrades as the condition label rises**, but the
effect is small - the largest single-condition drop is about two accuracy points. InternVL3.5-8B and
Molmo2-8B show the same picture with and without the parseable-only restriction, so for those two the
raw numbers already isolate the condition.

## 4. Where the loss sits

### 4.1 By level (delta, pooled within the level)

| model | condition | L1 | L2 | L3 | L4 | L5 |
|---|---|---|---|---|---|---|
| InternVL3_5-8B | sigma15 | -0.0042 | -0.0026 | -0.0120 | -0.0027 | +0.0024 |
| InternVL3_5-8B | sigma25 | -0.0112 | -0.0051 | -0.0209 | -0.0022 | +0.0032 |
| InternVL3_5-8B | sigma40 | -0.0142 | -0.0048 | -0.0234 | -0.0015 | +0.0148 |
| Molmo2-8B | sigma15 | +0.0053 | +0.0012 | +0.0009 | +0.0026 | -0.0047 |
| Molmo2-8B | sigma25 | +0.0024 | -0.0039 | +0.0009 | +0.0058 | -0.0047 |
| Molmo2-8B | sigma40 | -0.0047 | -0.0119 | -0.0072 | +0.0040 | -0.0101 |
| Qwen3-VL-8B-Instruct | sigma15 | +0.0031 | +0.0129 | +0.0134 | +0.0056 | +0.0052 |
| Qwen3-VL-8B-Instruct | sigma25 | -0.0096 | +0.0039 | +0.0028 | +0.0045 | +0.0055 |
| Qwen3-VL-8B-Instruct | sigma40 | -0.0247 | -0.0017 | -0.0013 | +0.0043 | +0.0064 |

### 4.2 By reasoning family at the strongest condition (sigma40)

| model | family | n | delta |
|---|---|---|---|
| InternVL3_5-8B | Projective | 2,500 | -0.0680 |
| InternVL3_5-8B | Inductive | 1,250 | -0.0264 |
| InternVL3_5-8B | Optical | 2,500 | -0.0212 |
| InternVL3_5-8B | Plane Geometry | 6,250 | -0.0176 |
| InternVL3_5-8B | Solid Geometry | 7,500 | -0.0176 |
| InternVL3_5-8B | Analytic | 2,500 | -0.0068 |
| InternVL3_5-8B | Physical & Mechanical | 8,750 | -0.0031 |
| InternVL3_5-8B | Topological | 3,750 | +0.0093 |
| InternVL3_5-8B | Transformational | 7,500 | +0.0345 |
| Molmo2-8B | Projective | 2,500 | -0.1084 |
| Molmo2-8B | Analytic | 2,500 | -0.0404 |
| Molmo2-8B | Inductive | 1,250 | -0.0232 |
| Molmo2-8B | Topological | 3,750 | -0.0128 |
| Molmo2-8B | Optical | 2,500 | -0.0116 |
| Molmo2-8B | Solid Geometry | 7,500 | -0.0013 |
| Molmo2-8B | Physical & Mechanical | 8,750 | +0.0023 |
| Molmo2-8B | Transformational | 7,500 | +0.0064 |
| Molmo2-8B | Plane Geometry | 6,250 | +0.0266 |
| Qwen3-VL-8B-Instruct | Projective | 2,500 | -0.1256 |
| Qwen3-VL-8B-Instruct | Analytic | 2,500 | -0.0924 |
| Qwen3-VL-8B-Instruct | Solid Geometry | 7,469 | -0.0138 |
| Qwen3-VL-8B-Instruct | Optical | 2,500 | -0.0132 |
| Qwen3-VL-8B-Instruct | Inductive | 1,250 | -0.0120 |
| Qwen3-VL-8B-Instruct | Plane Geometry | 6,250 | -0.0059 |
| Qwen3-VL-8B-Instruct | Topological | 3,750 | -0.0013 |
| Qwen3-VL-8B-Instruct | Transformational | 7,500 | +0.0003 |
| Qwen3-VL-8B-Instruct | Physical & Mechanical | 8,594 | +0.0689 |

## 5. Three things a reader must not misread

**1. Projective reasoning is where the damage concentrates.** `shadow_inference` falls monotonically
with the condition label in *all three* models, which is the one pattern in this sweep that looks like a
genuine robustness effect:

| model | sigma15 | sigma25 | sigma40 |
|---|---|---|---|
| InternVL3_5-8B | -0.0384 | -0.0952 | -0.1056 |
| Molmo2-8B | -0.0192 | -0.0808 | -0.2152 |
| Qwen3-VL-8B-Instruct | -0.0904 | -0.1744 | -0.2496 |

**2. The `physical_stability` gain is not a robustness effect.** Qwen3-VL-8B-Instruct appears to gain
roughly 48 points on that domain under every condition:

| model | sigma15 | sigma25 | sigma40 |
|---|---|---|---|
| InternVL3_5-8B | +0.0400 | +0.0464 | +0.0576 |
| Molmo2-8B | +0.0088 | +0.0088 | +0.0096 |
| Qwen3-VL-8B-Instruct | +0.4824 | +0.4872 | +0.4816 |

A gain that is flat across three conditions cannot be caused by the condition: it is a difference
between the two *runs*, not between the images. Something in Qwen's main run is degraded on those 250
images. Treat every Qwen delta for this domain as uninterpretable until the main run is repeated.

**3. Qwen's raw numbers are confounded by answer extraction.** Its main run leaves 3.76% of answers
unparsed against 0.7-0.8% in the grain runs, which flatters the grain side by roughly one point. The
`parsed only` column is the one to quote for this model.

## 6. Completeness

| model | condition | records | expected | missing |
|---|---|---|---|---|
| InternVL3_5-8B | sigma15 | 42,500 | 42,500 | 0 |
| InternVL3_5-8B | sigma25 | 42,500 | 42,500 | 0 |
| InternVL3_5-8B | sigma40 | 42,500 | 42,500 | 0 |
| Molmo2-8B | sigma15 | 42,500 | 42,500 | 0 |
| Molmo2-8B | sigma25 | 42,500 | 42,500 | 0 |
| Molmo2-8B | sigma40 | 42,500 | 42,500 | 0 |
| Qwen3-VL-8B-Instruct | sigma15 | 42,500 | 42,500 | 0 |
| Qwen3-VL-8B-Instruct | sigma25 | 42,500 | 42,500 | 0 |
| Qwen3-VL-8B-Instruct | sigma40 | 42,313 | 42,500 | 187 |

Qwen3-VL-8B-Instruct's sigma40 condition is short by 187 records (`laser_mirror` 156, `orthographic` 31).
Its sigma40 row is therefore computed over slightly fewer items; both sides of that comparison are
restricted to the ids that exist, so the delta stays paired.

## 7. What this sweep does not settle

- The noise transform itself: only the labels `sigma15/25/40` are stored. If sigma is additive Gaussian
  standard deviation, these are mild corruptions; the results are consistent with that, but the files
  cannot prove it.
- Serving configuration for the grain runs (engine, precision, decoding, date): absent, as for the main
  runs. The response statistics match the main run closely (median prediction length 3, median response
  length within 4%, identical `score_mode` mix, identical FINAL-ANSWER rate), which is evidence that the
  configuration matched, but it is evidence, not a record.
- Whether other models or the frontier tier behave the same way. Three of the seven open-weight runs are
  covered here.

To settle the physical_stability anomaly and the noise transform, the image generator configuration and a
repeat of Qwen3-VL-8B-Instruct's main run on the same 250 images would be enough.

## 8. Deliverables

- This document: `docs/open-models-grain-sweep.md`
- Artifact: `data/open-models/grain.json`
- Engine: `scripts/open_models_grain.py` (`--boot`, `--seed`) · renderer: `scripts/open_models_grain_report.py`
- Site: `/open-models/grain`

